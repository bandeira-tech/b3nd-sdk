/**
 * IndexedDBClient - Browser IndexedDB implementation of NodeProtocolInterface
 *
 * Provides large-scale persistent storage in browser environments using IndexedDB.
 * Supports efficient querying.
 */

/// <reference lib="dom" />

import type {
  IndexedDBClientConfig,
  Message,
  NodeProtocolInterface,

  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";

// Type definitions for IndexedDB (simplified for cross-platform compatibility)
interface IDBDatabase {
  name: string;
  version: number;
  close(): void;
  transaction(
    storeNames: string | string[],
    mode?: IDBTransactionMode,
  ): IDBTransaction;
}

interface IDBTransaction {
  objectStore(name: string): IDBObjectStore;
}

interface IDBObjectStore {
  get(key: any): IDBRequest;
  put(value: any): IDBRequest;
  delete(key: any): IDBRequest;
  clear(): IDBRequest;
  index(name: string): IDBIndex;
}

interface IDBIndex {
  openCursor(range?: IDBKeyRange | IDBValidKey): IDBRequest;
}

interface IDBRequest {
  result: any;
  error: Error | null;
  onsuccess: ((this: IDBRequest, ev: Event) => any) | null;
  onerror: ((this: IDBRequest, ev: Event) => any) | null;
}

interface IDBOpenDBRequest extends IDBRequest {
  onupgradeneeded:
    | ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => any)
    | null;
}

type IDBTransactionMode = "readonly" | "readwrite";

declare global {
  interface Window {
    indexedDB: IDBFactory;
  }

  interface IDBFactory {
    open(name: string, version?: number): IDBOpenDBRequest;
    deleteDatabase(name: string): IDBRequest;
  }

  // Use existing DOM types instead of redeclaring them
  // These are already defined in lib.dom.d.ts
}

interface StoredRecord {
  uri: string;
  values: Record<string, number>;
  data: unknown;
}

export class IndexedDBClient implements NodeProtocolInterface {
  private config: {
    databaseName: string;
    storeName: string;
    version: number;
  };
  private db: IDBDatabase | null = null;
  private indexedDB: IDBFactory;

  constructor(config: IndexedDBClientConfig) {
    this.config = {
      databaseName: config.databaseName || "b3nd",
      storeName: config.storeName || "records",
      version: config.version || 1,
    };

    // Use injected indexedDB or default to global indexedDB
    this.indexedDB = config.indexedDB ||
      (typeof (globalThis as any).indexedDB !== "undefined"
        ? (globalThis as any).indexedDB
        : null!);

    // Check if IndexedDB is available
    if (!this.indexedDB) {
      throw new Error("IndexedDB is not available in this environment");
    }
  }

  /**
   * Initialize the database connection
   */
  private async initDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    try {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.indexedDB.open(
          this.config.databaseName,
          this.config.version,
        );

        request.onerror = () => {
          reject(new Error(`Failed to open IndexedDB: ${request.error}`));
        };

        request.onsuccess = () => {
          const db = request.result;
          if (db) {
            this.db = db;
            resolve(db);
          } else {
            reject(
              new Error("IndexedDB open succeeded but no database returned"),
            );
          }
        };

        request.onupgradeneeded = () => {
          try {
            const db = request.result;

            // Create object store if it doesn't exist
            if (
              !db.objectStoreNames ||
              !db.objectStoreNames.contains(this.config.storeName)
            ) {
              const store = db.createObjectStore(this.config.storeName, {
                keyPath: "uri",
              });
              // Create index for efficient querying by URI prefix
              store.createIndex("uri_index", "uri");
            }
          } catch (error) {
            reject(new Error(`Failed to upgrade database: ${error}`));
          }
        };
      });
    } catch (error) {
      throw new Error(`IndexedDB initialization failed: ${error}`);
    }
  }

  /**
   * Get a transaction and object store
   */
  private async getStore(
    mode: IDBTransactionMode = "readonly",
  ): Promise<IDBObjectStore> {
    const db = await this.initDB();
    const transaction = db.transaction([this.config.storeName], mode);
    return transaction.objectStore(this.config.storeName);
  }

  /**
   * Receive a batch of messages — mechanical: delete inputs, write outputs.
   * @param msgs - Array of Message tuples [uri, values, data]
   * @returns Array of ReceiveResult, one per message
   */
  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const msg of msgs) {
      const [, , data] = msg;
      const { inputs, outputs } = data as {
        inputs: string[];
        outputs: [string, Record<string, number>, unknown][];
      };

      try {
        const store = await this.getStore("readwrite");

        // Delete every URI in inputs
        for (const inputUri of inputs) {
          await new Promise<void>((resolve, reject) => {
            const request = store.delete(inputUri);
            request.onsuccess = () => resolve();
            request.onerror = () =>
              reject(new Error(`Failed to delete ${inputUri}: ${request.error}`));
          });
        }

        // Write every output
        for (const [outUri, outValues, outData] of outputs) {
          const storedRecord: StoredRecord = {
            uri: outUri,
            values: outValues,
            data: outData,
          };

          await new Promise<void>((resolve, reject) => {
            const request = store.put(storedRecord);
            request.onsuccess = () => resolve();
            request.onerror = () =>
              reject(
                new Error(`Failed to store ${outUri}: ${request.error}`),
              );
          });
        }

        results.push({ accepted: true });
      } catch (error) {
        results.push({
          accepted: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  public async read<T = unknown>(
    uris: string | string[],
  ): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    const results: ReadResult<T>[] = [];

    for (const uri of uriList) {
      if (uri.endsWith("/")) {
        const listed = await this._list<T>(uri);
        results.push(...listed);
      } else {
        results.push(await this._readOne<T>(uri));
      }
    }

    return results;
  }

  private async _readOne<T>(uri: string): Promise<ReadResult<T>> {
    try {
      const store = await this.getStore();

      return new Promise<ReadResult<T>>((resolve) => {
        const request = store.get(uri);

        request.onsuccess = () => {
          const storedRecord = request.result as StoredRecord | undefined;

          if (!storedRecord) {
            resolve({
              success: false,
              error: "Not found",
            });
            return;
          }

          const record = {
            values: storedRecord.values,
            data: storedRecord.data as T,
          };

          resolve({
            success: true,
            record,
          });
        };

        request.onerror = () => {
          resolve({
            success: false,
            error: `Failed to read record: ${request.error}`,
          });
        };
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async _list<T>(uri: string): Promise<ReadResult<T>[]> {
    try {
      const store = await this.getStore();
      const index = store.index("uri_index");

      return new Promise<ReadResult<T>[]>((resolve) => {
        const results: ReadResult<T>[] = [];
        const request = index.openCursor();

        request.onsuccess = () => {
          const cursor = request.result;

          if (cursor) {
            const record = cursor.value as StoredRecord;
            if (record.uri.startsWith(uri)) {
              results.push({
                success: true,
                uri: record.uri,
                record: {
                  values: record.values,
                  data: record.data as T,
                },
              });
            }
            cursor.continue();
          } else {
            resolve(results);
          }
        };

        request.onerror = () => {
          resolve([]);
        };
      });
    } catch {
      return [];
    }
  }

  // deno-lint-ignore require-yield
  async *observe<T = unknown>(
    _pattern: string,
    _signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    // Not implemented — observe requires transport-specific support.
  }

  public async status(): Promise<StatusResult> {
    try {
      const db = await this.initDB();

      if (!db) {
        return {
          status: "unhealthy",
          schema: [],
        };
      }

      return {
        status: "healthy",
        schema: [],
      };
    } catch {
      return {
        status: "unhealthy",
        schema: [],
      };
    }
  }
}

// Store implementation (new pattern — prefer over IndexedDBClient)
export { IndexedDBStore } from "./store.ts";

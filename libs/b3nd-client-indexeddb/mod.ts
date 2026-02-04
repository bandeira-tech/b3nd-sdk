/**
 * IndexedDBClient - Browser IndexedDB implementation of NodeProtocolInterface
 *
 * Provides large-scale persistent storage in browser environments using IndexedDB.
 * Supports schema validation and efficient querying.
 */

/// <reference lib="dom" />

import type {
  DeleteResult,
  HealthStatus,
  IndexedDBClientConfig,
  ListItem,
  ListOptions,
  ListResult,
  Message,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  Schema,
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
  data: unknown;
  ts: number;
}

export class IndexedDBClient implements NodeProtocolInterface {
  private config: {
    databaseName: string;
    storeName: string;
    version: number;
  };
  private schema: Schema;
  private db: IDBDatabase | null = null;
  private indexedDB: IDBFactory;

  constructor(config: IndexedDBClientConfig) {
    this.config = {
      databaseName: config.databaseName || "b3nd",
      storeName: config.storeName || "records",
      version: config.version || 1,
    };
    this.schema = config.schema || {};

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
              // Create index for timestamp-based sorting
              store.createIndex("ts_index", "ts");
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
   * Validate write operation against schema
   */
  private async validateWrite(
    uri: string,
    value: unknown,
  ): Promise<{ valid: boolean; error?: string }> {
    // Find matching schema validation function
    const programKey = this.findMatchingProgram(uri);
    if (programKey && this.schema[programKey]) {
      const validator = this.schema[programKey];
      return await validator({ uri, value, read: this.read.bind(this) });
    }

    // No schema defined for this URI, allow write
    return { valid: true };
  }

  /**
   * Find matching program key for URI
   */
  private findMatchingProgram(uri: string): string | null {
    // Look for exact matches first
    if (this.schema[uri]) {
      return uri;
    }

    // Look for prefix matches (e.g., "users://" matches "users://alice/profile")
    for (const programKey of Object.keys(this.schema)) {
      if (uri.startsWith(programKey)) {
        return programKey;
      }
    }

    return null;
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
   * Receive a message - the unified entry point for all state changes
   * @param msg - Message tuple [uri, data]
   * @returns ReceiveResult indicating acceptance
   */
  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    const [uri, data] = msg;

    // Basic URI validation
    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Message URI is required" };
    }

    try {
      // Validate against schema if present
      const validation = await this.validateWrite(uri, data);
      if (!validation.valid) {
        return {
          accepted: false,
          error: validation.error || "Validation failed",
        };
      }

      const store = await this.getStore("readwrite");
      const record: PersistenceRecord<D> = {
        ts: Date.now(),
        data,
      };

      const storedRecord: StoredRecord = {
        uri,
        data,
        ts: record.ts,
      };

      return new Promise<ReceiveResult>((resolve) => {
        const request = store.put(storedRecord);

        request.onsuccess = () => {
          resolve({ accepted: true });
        };

        request.onerror = () => {
          resolve({
            accepted: false,
            error: `Failed to store message: ${request.error}`,
          });
        };
      });
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
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

          const record: PersistenceRecord<T> = {
            ts: storedRecord.ts,
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

  async readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    if (uris.length === 0) {
      return {
        success: false,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      };
    }

    if (uris.length > 50) {
      return {
        success: false,
        results: [],
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    }

    try {
      // Optimized: single transaction for all gets instead of N separate transactions
      const store = await this.getStore();
      const results: ReadMultiResultItem<T>[] = [];
      let succeeded = 0;

      // Fire all get requests within the same transaction
      const promises = uris.map(
        (uri) =>
          new Promise<ReadMultiResultItem<T>>((resolve) => {
            const request = store.get(uri);

            request.onsuccess = () => {
              const storedRecord = request.result as StoredRecord | undefined;
              if (storedRecord) {
                resolve({
                  uri,
                  success: true,
                  record: {
                    ts: storedRecord.ts,
                    data: storedRecord.data as T,
                  },
                });
              } else {
                resolve({ uri, success: false, error: "Not found" });
              }
            };

            request.onerror = () => {
              resolve({
                uri,
                success: false,
                error: `Read failed: ${request.error}`,
              });
            };
          }),
      );

      const settled = await Promise.all(promises);
      for (const item of settled) {
        results.push(item);
        if (item.success) succeeded++;
      }

      return {
        success: succeeded > 0,
        results,
        summary: {
          total: uris.length,
          succeeded,
          failed: uris.length - succeeded,
        },
      };
    } catch (error) {
      return {
        success: false,
        results: uris.map((uri) => ({
          uri,
          success: false as const,
          error: error instanceof Error ? error.message : "Read failed",
        })),
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    }
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const {
        page = 1,
        limit = 50,
        pattern,
        sortBy = "name",
        sortOrder = "asc",
      } = options || {};
      const store = await this.getStore();
      const index = store.index("uri_index");

      const items: ListItem[] = [];

      return new Promise<ListResult>((resolve) => {
        const request = index.openCursor();

        request.onsuccess = () => {
          const cursor = request.result;

          if (cursor) {
            const record = cursor.value as StoredRecord;

            // Check if this record matches our URI criteria
            if (record.uri.startsWith(uri)) {
              // Apply pattern filter if specified
              if (!pattern || record.uri.includes(pattern)) {
                items.push({
                  uri: record.uri,
                });
              }
            }

            cursor.continue();
          } else {
            // All records processed, apply sorting and pagination
            this.processListResults(items, { page, limit, sortBy, sortOrder })
              .then(resolve)
              .catch((error) => {
                resolve({
                  success: false,
                  error: error instanceof Error
                    ? error.message
                    : "Failed to process list results",
                });
              });
          }
        };

        request.onerror = () => {
          resolve({
            success: false,
            error: `Failed to list records: ${request.error}`,
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

  /**
   * Process list results with sorting and pagination
   */
  private async processListResults(
    items: ListItem[],
    options: { page: number; limit: number; sortBy: string; sortOrder: string },
  ): Promise<ListResult> {
    const { page, limit, sortBy, sortOrder } = options;

    let finalItems = [...items];
    if (sortBy === "timestamp") {
      // Get timestamps for all items
      const itemsWithTimestamps = await Promise.all(
        itemsWithTypes.map(async (item) => {
          const record = await this.getStoredRecord(item.uri);
          return {
            ...item,
            ts: record?.ts || 0,
          };
        }),
      );

      itemsWithTimestamps.sort((a, b) => {
        const comparison = a.ts - b.ts;
        return sortOrder === "asc" ? comparison : -comparison;
      });

      finalItems = itemsWithTimestamps.map(({ uri }) => ({ uri }));
    } else {
      // Sort by name
      finalItems.sort((a, b) => {
        const comparison = a.uri.localeCompare(b.uri);
        return sortOrder === "asc" ? comparison : -comparison;
      });
    }

    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedItems = finalItems.slice(startIndex, endIndex);

    return {
      success: true,
      data: paginatedItems,
      pagination: {
        page,
        limit,
        total: itemsWithTypes.length,
      },
    };
  }

  /**
   * Get stored record for timestamp sorting
   */
  private async getStoredRecord(uri: string): Promise<StoredRecord | null> {
    try {
      const store = await this.getStore();
      return new Promise<StoredRecord | null>((resolve) => {
        const request = store.get(uri);
        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => {
          resolve(null);
        };
      });
    } catch {
      return null;
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const store = await this.getStore("readwrite");

      return new Promise<DeleteResult>((resolve) => {
        // First check if it exists
        const getRequest = store.get(uri);

        getRequest.onsuccess = () => {
          if (!getRequest.result) {
            resolve({
              success: false,
              error: "Not found",
            });
            return;
          }

          // Delete the record
          const deleteRequest = store.delete(uri);

          deleteRequest.onsuccess = () => {
            resolve({
              success: true,
            });
          };

          deleteRequest.onerror = () => {
            resolve({
              success: false,
              error: `Failed to delete record: ${deleteRequest.error}`,
            });
          };
        };

        getRequest.onerror = () => {
          resolve({
            success: false,
            error: `Failed to check record existence: ${getRequest.error}`,
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

  async health(): Promise<HealthStatus> {
    try {
      // Try to open the database
      const db = await this.initDB();

      if (!db) {
        return {
          status: "unhealthy",
          message: "Failed to connect to IndexedDB",
        };
      }

      const stats = await this.getDatabaseStats();

      return {
        status: "healthy",
        message: "IndexedDB client is operational",
        details: {
          databaseName: this.config.databaseName,
          storeName: this.config.storeName,
          version: this.config.version,
          ...stats,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get database statistics
   */
  private async getDatabaseStats(): Promise<Record<string, unknown>> {
    try {
      const store = await this.getStore();
      const index = store.index("uri_index");

      return new Promise<Record<string, unknown>>((resolve) => {
        let totalRecords = 0;

        const request = index.openCursor();

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            totalRecords++;
            cursor.continue();
          } else {
            resolve({
              totalRecords,
            });
          }
        };

        request.onerror = () => {
          resolve({
            totalRecords: 0,
          });
        };
      });
    } catch {
      return {
        totalRecords: 0,
      };
    }
  }

  async getSchema(): Promise<string[]> {
    return Object.keys(this.schema);
  }

  async cleanup(): Promise<void> {
    // Clear all data from the object store BEFORE closing the database
    try {
      const store = await this.getStore("readwrite");
      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(new Error(`Failed to clear store: ${request.error}`));
      });
    } catch {
      // Ignore cleanup errors
    }

    // Wait for any pending operations to complete
    // fake-indexeddb uses setTimeout internally, so we need to wait a few ticks
    // to ensure all queued operations have had a chance to execute
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

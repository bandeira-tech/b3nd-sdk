/**
 * LocalStorageClient - Browser localStorage implementation of NodeProtocolInterface
 *
 * Provides persistent storage in browser environments using localStorage.
 * Supports custom serialization.
 */

import type {
  LocalStorageClientConfig,
  Message,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";
import { decodeBase64, encodeBase64 } from "../b3nd-core/encoding.ts";

/** Wrap Uint8Array as a JSON-safe marker object for localStorage round-tripping */
function serializeData(data: unknown): unknown {
  if (data instanceof Uint8Array) {
    return {
      __b3nd_binary__: true,
      encoding: "base64",
      data: encodeBase64(data),
    };
  }
  return data;
}

/** Unwrap the binary marker back to Uint8Array on read */
function deserializeData(data: unknown): unknown {
  if (
    data && typeof data === "object" &&
    (data as Record<string, unknown>).__b3nd_binary__ === true &&
    (data as Record<string, unknown>).encoding === "base64" &&
    typeof (data as Record<string, unknown>).data === "string"
  ) {
    return decodeBase64((data as Record<string, unknown>).data as string);
  }
  return data;
}

export class LocalStorageClient implements NodeProtocolInterface {
  private config: {
    keyPrefix: string;
    serializer: {
      serialize: (data: unknown) => string;
      deserialize: (data: string) => unknown;
    };
  };
  private storage: Storage;

  constructor(config: LocalStorageClientConfig) {
    this.config = {
      keyPrefix: config.keyPrefix || "b3nd:",
      serializer: {
        serialize: (data) => JSON.stringify(data),
        deserialize: (data) => JSON.parse(data),
        ...config.serializer,
      },
    };

    // Use injected storage or default to global localStorage
    this.storage = config.storage ||
      (typeof localStorage !== "undefined" ? localStorage : null!);

    // Check if storage is available
    if (!this.storage) {
      throw new Error("localStorage is not available in this environment");
    }
  }

  /**
   * Get the localStorage key for a URI
   */
  private getKey(uri: string): string {
    return `${this.config.keyPrefix}${uri}`;
  }

  /**
   * Serialize data using configured serializer
   */
  private serialize(data: unknown): string {
    return this.config.serializer!.serialize!(data);
  }

  /**
   * Deserialize data using configured serializer
   */
  private deserialize(data: string): unknown {
    return this.config.serializer!.deserialize!(data);
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
        // Delete every URI in inputs
        for (const inputUri of inputs) {
          this.storage.removeItem(this.getKey(inputUri));
        }

        // Write every output
        for (const [outUri, outValues, outData] of outputs) {
          const record = {
            values: outValues,
            data: serializeData(outData),
          };
          const serialized = this.serialize(record);
          this.storage.setItem(this.getKey(outUri), serialized);
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

  public read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    const results: ReadResult<T>[] = [];

    for (const uri of uriList) {
      if (uri.endsWith("/")) {
        results.push(...this._list<T>(uri));
      } else {
        results.push(this._readOne<T>(uri));
      }
    }

    return Promise.resolve(results);
  }

  private _readOne<T>(uri: string): ReadResult<T> {
    try {
      const key = this.getKey(uri);
      const serialized = this.storage.getItem(key);

      if (serialized === null) {
        return {
          success: false,
          error: "Not found",
        };
      }

      const raw = this.deserialize(serialized) as {
        values?: Record<string, number>;
        data: unknown;
      };
      const record: PersistenceRecord<T> = {
        values: raw.values || {},
        data: deserializeData(raw.data) as T,
      };
      return {
        success: true,
        record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private _list<T>(uri: string): ReadResult<T>[] {
    const results: ReadResult<T>[] = [];
    const prefix = this.getKey(uri);

    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(prefix)) {
        const childUri = key.substring(this.config.keyPrefix.length);
        results.push(this._readOne<T>(childUri));
      }
    }

    return results;
  }

  // deno-lint-ignore require-yield
  async *observe<T = unknown>(
    _pattern: string,
    _signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    // Not implemented — observe requires transport-specific support.
  }

  public status(): Promise<StatusResult> {
    try {
      const testKey = `${this.config.keyPrefix}health-check`;
      this.storage.setItem(testKey, "test");
      this.storage.removeItem(testKey);

      return Promise.resolve({
        status: "healthy",
        schema: [],
      });
    } catch {
      return Promise.resolve({
        status: "unhealthy",
        schema: [],
      });
    }
  }
}

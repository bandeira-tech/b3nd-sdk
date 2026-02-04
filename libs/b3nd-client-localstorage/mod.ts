/**
 * LocalStorageClient - Browser localStorage implementation of NodeProtocolInterface
 *
 * Provides persistent storage in browser environments using localStorage.
 * Supports schema validation and custom serialization.
 */

import type {
  DeleteResult,
  HealthStatus,
  ListItem,
  ListOptions,
  ListResult,
  LocalStorageClientConfig,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  Schema,
} from "../b3nd-core/types.ts";
import type { Node, ReceiveResult, Transaction } from "../b3nd-compose/types.ts";

export class LocalStorageClient implements NodeProtocolInterface, Node {
  private config: {
    keyPrefix: string;
    serializer: {
      serialize: (data: unknown) => string;
      deserialize: (data: string) => unknown;
    };
  };
  private schema: Schema;
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
    this.schema = config.schema || {};

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
    // Look for prefix matches (e.g., "users://" matches "users://alice/profile")
    for (const programKey of Object.keys(this.schema)) {
      if (uri.startsWith(programKey)) {
        return programKey;
      }
    }

    return null;
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
   * Receive a transaction - the unified entry point for all state changes
   * @param tx - Transaction tuple [uri, data]
   * @returns ReceiveResult indicating acceptance
   */
  async receive<D = unknown>(tx: Transaction<D>): Promise<ReceiveResult> {
    const [uri, data] = tx;

    // Basic URI validation
    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Transaction URI is required" };
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

      const key = this.getKey(uri);
      const record: PersistenceRecord<D> = {
        ts: Date.now(),
        data,
      };

      const serialized = this.serialize(record);
      this.storage.setItem(key, serialized);

      return { accepted: true };
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const key = this.getKey(uri);
      const serialized = this.storage.getItem(key);

      if (serialized === null) {
        return {
          success: false,
          error: "Not found",
        };
      }

      const record = this.deserialize(serialized) as PersistenceRecord<T>;
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

  async readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    if (uris.length > 50) {
      return {
        success: false,
        results: [],
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    }

    const results: ReadMultiResultItem<T>[] = await Promise.all(
      uris.map(async (uri): Promise<ReadMultiResultItem<T>> => {
        const result = await this.read<T>(uri);
        if (result.success && result.record) {
          return { uri, success: true, record: result.record };
        }
        return { uri, success: false, error: result.error || "Read failed" };
      }),
    );

    const succeeded = results.filter((r) => r.success).length;
    return {
      success: succeeded > 0,
      results,
      summary: {
        total: uris.length,
        succeeded,
        failed: uris.length - succeeded,
      },
    };
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

      const items: ListItem[] = [];
      const prefix = this.getKey(uri);

      // Iterate through all localStorage keys
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key && key.startsWith(prefix)) {
          const uri = key.substring(this.config.keyPrefix.length);

          // Apply pattern filter if specified
          if (pattern && !uri.includes(pattern)) {
            continue;
          }

          items.push({
            uri,
          });
        }
      }

      // Sort items
      items.sort((a, b) => {
        let comparison = 0;
        if (sortBy === "name") {
          comparison = a.uri.localeCompare(b.uri);
        } else if (sortBy === "timestamp") {
          // Get timestamps from stored data for comparison
          const aData = this.getStoredData(a.uri);
          const bData = this.getStoredData(b.uri);
          const aTs = aData?.ts || 0;
          const bTs = bData?.ts || 0;
          comparison = aTs - bTs;
        }

        return sortOrder === "asc" ? comparison : -comparison;
      });

      // Apply pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedItems = items.slice(startIndex, endIndex);

      return {
        success: true,
        data: paginatedItems,
        pagination: {
          page,
          limit,
          total: items.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if a URI has children (is a directory)
   */
  private hasChildren(uri: string): boolean {
    const prefix = this.getKey(uri) + "/";
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get stored data for a URI (for timestamp sorting)
   */
  private getStoredData(uri: string): PersistenceRecord | null {
    try {
      const key = this.getKey(uri);
      const serialized = this.storage.getItem(key);
      if (serialized) {
        return this.deserialize(serialized) as PersistenceRecord;
      }
    } catch {
      // Ignore errors, return null
    }
    return null;
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const key = this.getKey(uri);
      const exists = this.storage.getItem(key) !== null;

      if (!exists) {
        return {
          success: false,
          error: "Not found",
        };
      }

      this.storage.removeItem(key);
      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(): Promise<HealthStatus> {
    try {
      // Check if localStorage is accessible
      const testKey = `${this.config.keyPrefix}health-check`;
      this.storage.setItem(testKey, "test");
      this.storage.removeItem(testKey);

      const stats = this.getStorageStats();

      return {
        status: "healthy",
        message: "LocalStorage client is operational",
        details: stats,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get localStorage usage statistics
   */
  private getStorageStats(): Record<string, unknown> {
    try {
      let totalKeys = 0;
      let b3ndKeys = 0;
      let totalSize = 0;

      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key) {
          totalKeys++;
          const value = this.storage.getItem(key) || "";
          totalSize += key.length + value.length;

          if (key.startsWith(this.config.keyPrefix)) {
            b3ndKeys++;
          }
        }
      }

      return {
        totalKeys,
        b3ndKeys,
        totalSize,
        keyPrefix: this.config.keyPrefix,
        estimatedRemainingSpace: this.estimateRemainingSpace(),
      };
    } catch {
      return {};
    }
  }

  /**
   * Estimate remaining localStorage space (rough approximation)
   */
  private estimateRemainingSpace(): number {
    try {
      // This is a rough estimate - localStorage limit is typically 5-10MB
      const typicalLimit = 5 * 1024 * 1024; // 5MB
      let currentSize = 0;

      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key) {
          const value = this.storage.getItem(key) || "";
          currentSize += key.length + value.length;
        }
      }

      return Math.max(0, typicalLimit - currentSize);
    } catch {
      return 0;
    }
  }

  async getSchema(): Promise<string[]> {
    return Object.keys(this.schema);
  }

  async cleanup(): Promise<void> {
    // Remove all keys with our prefix
    const keysToRemove: string[] = [];

    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(this.config.keyPrefix)) {
        keysToRemove.push(key);
      }
    }

    // Remove the keys
    for (const key of keysToRemove) {
      this.storage.removeItem(key);
    }
  }
}

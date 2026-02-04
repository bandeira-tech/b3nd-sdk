/**
 * @module
 * FunctionalClient - A client that takes functions as config.
 *
 * Replaces createNode() for cases where you want to wire up
 * custom behavior without class inheritance.
 */

import type {
  DeleteResult,
  HealthStatus,
  ListOptions,
  ListResult,
  NodeProtocolInterface,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  Transaction,
} from "./types.ts";

/**
 * Configuration for FunctionalClient.
 * Each method is optional — missing methods return sensible defaults.
 */
export interface FunctionalClientConfig {
  receive?: <D = unknown>(
    tx: Transaction<D>,
  ) => Promise<ReceiveResult>;
  read?: <T = unknown>(uri: string) => Promise<ReadResult<T>>;
  readMulti?: <T = unknown>(uris: string[]) => Promise<ReadMultiResult<T>>;
  list?: (uri: string, options?: ListOptions) => Promise<ListResult>;
  delete?: (uri: string) => Promise<DeleteResult>;
  health?: () => Promise<HealthStatus>;
  getSchema?: () => Promise<string[]>;
  cleanup?: () => Promise<void>;
}

/**
 * A client that delegates each method to a config function.
 *
 * If a method is not provided, it returns a sensible default:
 * - receive → { accepted: false, error: "not implemented" }
 * - read → { success: false, error: "not implemented" }
 * - readMulti → auto-derived from read if not provided
 * - list → { success: true, data: [], pagination: { page: 1, limit: 50, total: 0 } }
 * - delete → { success: false, error: "not implemented" }
 * - health → { status: "healthy" }
 * - getSchema → []
 * - cleanup → no-op
 *
 * @example
 * ```typescript
 * const client = new FunctionalClient({
 *   receive: async (tx) => backend.receive(tx),
 *   read: async (uri) => backend.read(uri),
 * });
 * ```
 */
export class FunctionalClient implements NodeProtocolInterface {
  private config: FunctionalClientConfig;

  constructor(config: FunctionalClientConfig) {
    this.config = config;
  }

  receive<D = unknown>(tx: Transaction<D>): Promise<ReceiveResult> {
    if (this.config.receive) {
      return this.config.receive(tx);
    }
    return Promise.resolve({ accepted: false, error: "not implemented" });
  }

  read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    if (this.config.read) {
      return this.config.read<T>(uri);
    }
    return Promise.resolve({ success: false, error: "not implemented" });
  }

  readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    if (this.config.readMulti) {
      return this.config.readMulti<T>(uris);
    }
    // Auto-derive from read
    return this.defaultReadMulti<T>(uris);
  }

  private async defaultReadMulti<T = unknown>(
    uris: string[],
  ): Promise<ReadMultiResult<T>> {
    if (uris.length === 0) {
      return {
        success: false,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      };
    }

    const results: ReadMultiResultItem<T>[] = [];
    let succeeded = 0;

    for (const uri of uris) {
      const result = await this.read<T>(uri);
      if (result.success && result.record) {
        results.push({ uri, success: true, record: result.record });
        succeeded++;
      } else {
        results.push({
          uri,
          success: false,
          error: result.error || "Read failed",
        });
      }
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
  }

  list(uri: string, options?: ListOptions): Promise<ListResult> {
    if (this.config.list) {
      return this.config.list(uri, options);
    }
    return Promise.resolve({
      success: true,
      data: [],
      pagination: { page: 1, limit: 50, total: 0 },
    });
  }

  delete(uri: string): Promise<DeleteResult> {
    if (this.config.delete) {
      return this.config.delete(uri);
    }
    return Promise.resolve({ success: false, error: "not implemented" });
  }

  health(): Promise<HealthStatus> {
    if (this.config.health) {
      return this.config.health();
    }
    return Promise.resolve({ status: "healthy" });
  }

  getSchema(): Promise<string[]> {
    if (this.config.getSchema) {
      return this.config.getSchema();
    }
    return Promise.resolve([]);
  }

  cleanup(): Promise<void> {
    if (this.config.cleanup) {
      return this.config.cleanup();
    }
    return Promise.resolve();
  }
}

/**
 * IpfsClient - IPFS implementation of NodeProtocolInterface
 *
 * Stores data as JSON objects pinned to IPFS. Each record is serialized
 * as `{ ts, data }` and added via the IPFS API. The CID becomes the
 * content address. A local index maps URIs → CIDs for mutable lookups.
 *
 * Uses an injected executor so the SDK does not depend on a specific
 * IPFS library. Works with Kubo HTTP RPC, Helia, or any wrapper that
 * implements the IpfsExecutor interface.
 *
 * URL format: ipfs://localhost:5001 (Kubo API endpoint)
 */

import {
  Errors,
  type DeleteResult,
  type HealthStatus,
  type ListItem,
  type ListOptions,
  type ListResult,
  type Message,
  type NodeProtocolInterface,
  type PersistenceRecord,
  type ReadMultiResult,
  type ReadMultiResultItem,
  type ReadResult,
  type ReceiveResult,
  type Schema,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";

/**
 * Configuration for IpfsClient
 */
export interface IpfsClientConfig {
  /**
   * IPFS API endpoint URL (e.g., "http://localhost:5001").
   */
  apiUrl: string;

  /**
   * Schema for validation — must be explicitly provided.
   */
  schema: Schema;
}

/**
 * IPFS executor interface.
 * Abstracts the IPFS API so the client works with Kubo, Helia, or test stubs.
 */
export interface IpfsExecutor {
  /** Add content to IPFS and return the CID. */
  add: (content: string) => Promise<string>;
  /** Retrieve content by CID. Returns the raw string. */
  cat: (cid: string) => Promise<string>;
  /** Pin a CID so it isn't garbage-collected. */
  pin: (cid: string) => Promise<void>;
  /** Unpin a CID. */
  unpin: (cid: string) => Promise<void>;
  /** List all pinned CIDs. Returns an array of CID strings. */
  listPins: () => Promise<string[]>;
  /** Check if the IPFS node is reachable. */
  isOnline: () => Promise<boolean>;
  /** Optional cleanup (close connections, etc.) */
  cleanup?: () => Promise<void>;
}

/**
 * Internal index entry mapping a URI to its IPFS CID.
 */
interface IndexEntry {
  cid: string;
  ts: number;
}

export class IpfsClient implements NodeProtocolInterface {
  private readonly schema: Schema;
  private readonly apiUrl: string;
  private readonly executor: IpfsExecutor;

  /**
   * URI → CID index. Kept in memory and optionally persisted to IPFS
   * itself (the index CID can be stored externally for recovery).
   */
  private readonly index = new Map<string, IndexEntry>();

  constructor(config: IpfsClientConfig, executor?: IpfsExecutor) {
    if (!config) {
      throw new Error("IpfsClientConfig is required");
    }
    if (!config.apiUrl) {
      throw new Error("apiUrl is required in IpfsClientConfig");
    }
    if (!config.schema) {
      throw new Error("schema is required in IpfsClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    this.schema = config.schema;
    this.apiUrl = config.apiUrl.replace(/\/+$/, "");
    this.executor = executor;
  }

  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    const [uri, data] = msg;

    if (!uri || typeof uri !== "string") {
      return {
        accepted: false,
        error: "Message URI is required",
        errorDetail: Errors.invalidUri(uri ?? "", "Message URI is required"),
      };
    }

    try {
      const programKey = this.extractProgramKey(uri);
      const validator = this.schema[programKey];

      if (!validator) {
        const msg = `No schema defined for program key: ${programKey}`;
        return {
          accepted: false,
          error: msg,
          errorDetail: Errors.invalidSchema(uri, msg),
        };
      }

      const validation = await validator({
        uri,
        value: data,
        read: this.read.bind(this),
      });

      if (!validation.valid) {
        const msg = validation.error || "Validation failed";
        return {
          accepted: false,
          error: msg,
          errorDetail: Errors.invalidSchema(uri, msg),
        };
      }

      const encodedData = encodeBinaryForJson(data);
      const ts = Date.now();
      const record: PersistenceRecord = { ts, data: encodedData };
      const content = JSON.stringify(record);

      const cid = await this.executor.add(content);
      await this.executor.pin(cid);

      // Remove old pin if updating
      const existing = this.index.get(uri);
      if (existing) {
        try {
          await this.executor.unpin(existing.cid);
        } catch {
          // Old CID may already be unpinned — ignore
        }
      }

      this.index.set(uri, { cid, ts });

      // If MessageData, also store each output at its own URI
      if (isMessageData(data)) {
        for (const [outputUri, outputValue] of data.payload.outputs) {
          const outputEncoded = encodeBinaryForJson(outputValue);
          const outputTs = Date.now();
          const outputRecord: PersistenceRecord = { ts: outputTs, data: outputEncoded };
          const outputContent = JSON.stringify(outputRecord);

          const outputCid = await this.executor.add(outputContent);
          await this.executor.pin(outputCid);

          const existingOutput = this.index.get(outputUri);
          if (existingOutput) {
            try {
              await this.executor.unpin(existingOutput.cid);
            } catch {
              // ignore
            }
          }

          this.index.set(outputUri, { cid: outputCid, ts: outputTs });
        }
      }

      return { accepted: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        accepted: false,
        error: msg,
        errorDetail: Errors.storageError(msg, uri),
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const entry = this.index.get(uri);

      if (!entry) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }

      const content = await this.executor.cat(entry.cid);
      const record = JSON.parse(content) as PersistenceRecord;
      const decodedData = decodeBinaryFromJson(record.data) as T;

      return {
        success: true,
        record: { ts: record.ts, data: decodedData },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: msg,
        errorDetail: Errors.storageError(msg, uri),
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

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      // Filter index entries whose URIs start with the given prefix
      const prefix = uri.endsWith("/") ? uri : uri + "/";
      let items: ListItem[] = [];

      for (const [indexUri] of this.index) {
        if (indexUri.startsWith(prefix) || indexUri === uri) {
          items.push({ uri: indexUri });
        }
      }

      // Apply pattern filter
      if (options?.pattern) {
        const regex = new RegExp(options.pattern);
        items = items.filter((item) => regex.test(item.uri));
      }

      // Sort
      if (options?.sortBy === "timestamp") {
        items.sort((a, b) => {
          const aTs = this.index.get(a.uri)?.ts ?? 0;
          const bTs = this.index.get(b.uri)?.ts ?? 0;
          return aTs - bTs;
        });
      } else {
        items.sort((a, b) => a.uri.localeCompare(b.uri));
      }

      if (options?.sortOrder === "desc") {
        items.reverse();
      }

      const total = items.length;
      const page = options?.page ?? 1;
      const limit = options?.limit ?? 50;
      const offset = (page - 1) * limit;
      const paginated = items.slice(offset, offset + limit);

      return {
        success: true,
        data: paginated,
        pagination: { page, limit, total },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const entry = this.index.get(uri);

      if (!entry) {
        return {
          success: false,
          error: "Not found",
          errorDetail: Errors.notFound(uri),
        };
      }

      await this.executor.unpin(entry.cid);
      this.index.delete(uri);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: msg,
        errorDetail: Errors.storageError(msg, uri),
      };
    }
  }

  async health(): Promise<HealthStatus> {
    try {
      const online = await this.executor.isOnline();
      if (!online) {
        return {
          status: "unhealthy",
          message: "IPFS node is not reachable",
        };
      }

      return {
        status: "healthy",
        message: "IPFS client is operational",
        details: {
          apiUrl: this.apiUrl,
          indexedUris: this.index.size,
          schemaKeys: Object.keys(this.schema),
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getSchema(): Promise<string[]> {
    return Object.keys(this.schema);
  }

  async cleanup(): Promise<void> {
    if (this.executor.cleanup) {
      await this.executor.cleanup();
    }
  }

  private extractProgramKey(uri: string): string {
    const url = new URL(uri);
    return `${url.protocol}//${url.hostname}`;
  }
}

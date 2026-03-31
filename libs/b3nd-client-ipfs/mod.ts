/**
 * IpfsClient - IPFS implementation of NodeProtocolInterface
 *
 * Stores data as JSON objects pinned to IPFS. Pure storage — validation is the rig's concern.
 *
 * Uses an injected executor so the SDK does not depend on a specific IPFS library.
 *
 * URL format: ipfs://localhost:5001 (Kubo API endpoint)
 */

import {
  Errors,
  type DeleteResult,
  type ListItem,
  type ListOptions,
  type ListResult,
  type Message,
  type NodeProtocolInterface,
  type NodeStatus,
  type PersistenceRecord,
  type ReadMultiResult,
  type ReadMultiResultItem,
  type ReadResult,
  type ReceiveResult,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";

export interface IpfsClientConfig {
  apiUrl: string;
}

export interface IpfsExecutor {
  add: (content: string) => Promise<string>;
  cat: (cid: string) => Promise<string>;
  pin: (cid: string) => Promise<void>;
  unpin: (cid: string) => Promise<void>;
  listPins: () => Promise<string[]>;
  isOnline: () => Promise<boolean>;
  cleanup?: () => Promise<void>;
}

interface IndexEntry {
  cid: string;
  ts: number;
}

export class IpfsClient implements NodeProtocolInterface {
  private readonly apiUrl: string;
  private readonly executor: IpfsExecutor;
  private readonly index = new Map<string, IndexEntry>();

  constructor(config: IpfsClientConfig, executor?: IpfsExecutor) {
    if (!config) {
      throw new Error("IpfsClientConfig is required");
    }
    if (!config.apiUrl) {
      throw new Error("apiUrl is required in IpfsClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

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
      const encodedData = encodeBinaryForJson(data);
      const ts = Date.now();
      const record: PersistenceRecord = { ts, data: encodedData };
      const content = JSON.stringify(record);

      const cid = await this.executor.add(content);
      await this.executor.pin(cid);

      const existing = this.index.get(uri);
      if (existing) {
        try {
          await this.executor.unpin(existing.cid);
        } catch {
          // Old CID may already be unpinned — ignore
        }
      }

      this.index.set(uri, { cid, ts });

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
      const prefix = uri.endsWith("/") ? uri : uri + "/";
      let items: ListItem[] = [];

      for (const [indexUri] of this.index) {
        if (indexUri.startsWith(prefix) || indexUri === uri) {
          items.push({ uri: indexUri });
        }
      }

      if (options?.pattern) {
        const regex = new RegExp(options.pattern);
        items = items.filter((item) => regex.test(item.uri));
      }

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

  async status(): Promise<NodeStatus> {
    try {
      const online = await this.executor.isOnline();
      if (!online) {
        return { healthy: false, message: "IPFS node is not reachable" };
      }

      return {
        healthy: true,
        message: "IPFS client is operational",
        apiUrl: this.apiUrl,
        indexedUris: this.index.size,
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async cleanup(): Promise<void> {
    if (this.executor.cleanup) {
      await this.executor.cleanup();
    }
  }
}

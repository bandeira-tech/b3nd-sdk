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
  type Message,
  type NodeProtocolInterface,
  type PersistenceRecord,
  type ReadResult,
  type ReceiveResult,
  type StatusResult,
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
          const outputRecord: PersistenceRecord = {
            ts: outputTs,
            data: outputEncoded,
          };
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

  async read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    const results: ReadResult<T>[] = [];

    for (const uri of uriList) {
      if (uri.endsWith("/")) {
        results.push(...this._list<T>(uri));
      } else {
        results.push(await this._readOne<T>(uri));
      }
    }

    return results;
  }

  private async _readOne<T>(uri: string): Promise<ReadResult<T>> {
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

  private _list<T>(uri: string): ReadResult<T>[] {
    const prefix = uri.endsWith("/") ? uri : uri + "/";
    const results: ReadResult<T>[] = [];

    for (const [indexUri, entry] of this.index) {
      if (indexUri.startsWith(prefix) || indexUri === uri.replace(/\/$/, "")) {
        // We can't async-fetch content here synchronously, so return index metadata
        // For list, we include the URI in the record for identification
        results.push({
          success: true,
          record: {
            ts: entry.ts,
            data: undefined as unknown as T,
            uri: indexUri,
          } as PersistenceRecord<T>,
        });
      }
    }

    return results;
  }

  async status(): Promise<StatusResult> {
    try {
      const online = await this.executor.isOnline();
      if (!online) {
        return {
          status: "unhealthy",
          message: "IPFS node is not reachable",
        };
      }

      // Derive schema from indexed URIs
      const programs = new Set<string>();
      for (const uri of this.index.keys()) {
        try {
          const url = new URL(uri);
          programs.add(`${url.protocol}//${url.hostname}`);
        } catch {
          // skip malformed URIs
        }
      }

      return {
        status: "healthy",
        schema: [...programs],
        details: {
          apiUrl: this.apiUrl,
          indexedUris: this.index.size,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

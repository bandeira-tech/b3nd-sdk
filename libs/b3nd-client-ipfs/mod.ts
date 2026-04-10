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

  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const msg of msgs) {
      const [uri, , data] = msg;

      if (!uri || typeof uri !== "string") {
        results.push({
          accepted: false,
          error: "Message URI is required",
          errorDetail: Errors.invalidUri(uri ?? "", "Message URI is required"),
        });
        continue;
      }

      try {
        const { inputs, outputs } = data as {
          inputs: string[];
          outputs: [string, Record<string, number>, unknown][];
        };

        // Delete inputs
        for (const inputUri of inputs) {
          const existing = this.index.get(inputUri);
          if (existing) {
            try {
              await this.executor.unpin(existing.cid);
            } catch {
              // Old CID may already be unpinned — ignore
            }
            this.index.delete(inputUri);
          }
        }

        // Write outputs
        for (const [outUri, outValues, outData] of outputs) {
          const encodedData = encodeBinaryForJson(outData);
          const record: PersistenceRecord = { values: outValues, data: encodedData };
          const content = JSON.stringify(record);

          const cid = await this.executor.add(content);
          await this.executor.pin(cid);

          const existingOutput = this.index.get(outUri);
          if (existingOutput) {
            try {
              await this.executor.unpin(existingOutput.cid);
            } catch {
              // ignore
            }
          }

          this.index.set(outUri, { cid });
        }

        results.push({ accepted: true });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        results.push({
          accepted: false,
          error: msg,
          errorDetail: Errors.storageError(msg, uri),
        });
      }
    }

    return results;
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
      const record = JSON.parse(content) as { values: Record<string, number>; data: unknown };
      const decodedData = decodeBinaryFromJson(record.data) as T;

      return {
        success: true,
        record: { values: record.values || {}, data: decodedData },
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

    for (const [indexUri] of this.index) {
      if (indexUri.startsWith(prefix) || indexUri === uri.replace(/\/$/, "")) {
        // We can't async-fetch content here synchronously, so return index metadata
        // For list, we include the URI in the record for identification
        results.push({
          success: true,
          record: {
            values: {},
            data: undefined as unknown as T,
            uri: indexUri,
          } as PersistenceRecord<T>,
        });
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

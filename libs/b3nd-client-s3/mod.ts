/**
 * S3Client - Amazon S3 implementation of NodeProtocolInterface
 *
 * Stores data as JSON objects in an S3 bucket. Pure storage — validation is the rig's concern.
 *
 * Uses an injected executor so the SDK does not depend on a specific S3 library.
 */

import {
  Errors,
  type Message,
  type NodeProtocolInterface,

  type ReadResult,
  type ReceiveResult,
  type S3ClientConfig,
  type StatusResult,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";

export interface S3Executor {
  putObject: (key: string, body: string, contentType: string) => Promise<void>;
  getObject: (key: string) => Promise<string | null>;
  deleteObject: (key: string) => Promise<void>;
  listObjects: (prefix: string) => Promise<string[]>;
  headBucket: () => Promise<boolean>;
  cleanup?: () => Promise<void>;
}

function uriToKey(uri: string): string {
  const clean = uri.replace("://", "/");
  const parts = clean.split("/").filter((p) =>
    p !== ".." && p !== "." && p !== ""
  );
  return parts.join("/") + ".json";
}

export class S3Client implements NodeProtocolInterface {
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly executor: S3Executor;

  constructor(config: S3ClientConfig, executor?: S3Executor) {
    if (!config) {
      throw new Error("S3ClientConfig is required");
    }
    if (!config.bucket) {
      throw new Error("bucket is required in S3ClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    this.bucket = config.bucket;
    this.prefix = config.prefix ?? "";
    this.executor = executor;
  }

  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const msg of msgs) {
      results.push(await this.receiveOne(msg));
    }

    return results;
  }

  private async receiveOne(msg: Message): Promise<ReceiveResult> {
    const [uri, values, data] = msg;

    if (!uri || typeof uri !== "string") {
      return {
        accepted: false,
        error: "Message URI is required",
        errorDetail: Errors.invalidUri(uri ?? "", "Message URI is required"),
      };
    }

    try {
      const msgData = data as { inputs?: unknown; outputs?: unknown } | null;
      const isEnvelope = msgData != null &&
        typeof msgData === "object" &&
        Array.isArray(msgData.inputs) &&
        Array.isArray(msgData.outputs);

      if (isEnvelope) {
        const inputs = msgData!.inputs as string[];
        const outputs = msgData!.outputs as [string, Record<string, number>, unknown][];

        for (const inputUri of inputs) {
          await this.executor.deleteObject(this.resolveKey(inputUri));
        }

        for (const [outUri, outValues, outData] of outputs) {
          const encodedData = encodeBinaryForJson(outData);
          const record = {
            values: outValues,
            data: encodedData,
          };
          const key = this.resolveKey(outUri);
          await this.executor.putObject(
            key,
            JSON.stringify(record),
            "application/json",
          );
        }
      } else {
        // Direct write — store data at the message URI
        const encodedData = encodeBinaryForJson(data);
        const record = {
          values: values || {},
          data: encodedData,
        };
        const key = this.resolveKey(uri);
        await this.executor.putObject(
          key,
          JSON.stringify(record),
          "application/json",
        );
      }

      return { accepted: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        accepted: false,
        error: errMsg,
        errorDetail: Errors.storageError(errMsg, uri),
      };
    }
  }

  async read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    const results: ReadResult<T>[] = [];

    for (const uri of uriList) {
      if (uri.endsWith("/")) {
        results.push(...await this._list<T>(uri));
      } else {
        results.push(await this._readOne<T>(uri));
      }
    }

    return results;
  }

  private async _readOne<T>(uri: string): Promise<ReadResult<T>> {
    try {
      const key = this.resolveKey(uri);
      const content = await this.executor.getObject(key);

      if (content === null) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }

      const record = JSON.parse(content) as { values?: Record<string, number>; data: unknown };
      const decodedData = decodeBinaryFromJson(record.data) as T;

      return {
        success: true,
        uri,
        record: { values: record.values ?? {}, data: decodedData },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        uri,
        error: msg,
        errorDetail: Errors.storageError(msg, uri),
      };
    }
  }

  private async _list<T>(uri: string): Promise<ReadResult<T>[]> {
    try {
      const relKey = uriToKey(uri).replace(/\.json$/, "");
      const listPrefix = `${this.prefix}${relKey}/`;

      const keys = await this.executor.listObjects(listPrefix);

      const results: ReadResult<T>[] = [];
      for (const k of keys.filter((k) => k.endsWith(".json"))) {
        const rel = k.startsWith(this.prefix) ? k.slice(this.prefix.length) : k;
        const withoutExt = rel.replace(/\.json$/, "");
        const parts = withoutExt.split("/");
        const protocol = parts[0];
        const hostname = parts[1];
        const path = parts.slice(2).join("/");
        const itemUri = `${protocol}://${hostname}/${path}`;

        const content = await this.executor.getObject(k);
        if (content !== null) {
          try {
            const record = JSON.parse(content) as { values?: Record<string, number>; data: unknown };
            const decodedData = decodeBinaryFromJson(record.data) as T;
            results.push({
              success: true,
              uri: itemUri,
              record: { values: record.values ?? {}, data: decodedData },
            });
          } catch {
            // Skip malformed records
          }
        }
      }

      return results;
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

  async status(): Promise<StatusResult> {
    try {
      const ok = await this.executor.headBucket();
      if (!ok) {
        return {
          status: "unhealthy",
          message: `Bucket not accessible: ${this.bucket}`,
        };
      }

      // List top-level prefixes as schema
      const keys = await this.executor.listObjects(this.prefix);
      const programs = new Set<string>();
      for (const k of keys.filter((k) => k.endsWith(".json"))) {
        const rel = k.startsWith(this.prefix) ? k.slice(this.prefix.length) : k;
        const parts = rel.split("/");
        if (parts.length >= 2) {
          programs.add(`${parts[0]}://${parts[1]}`);
        }
      }

      return {
        status: "healthy",
        schema: [...programs],
        details: {
          bucket: this.bucket,
          prefix: this.prefix || "(none)",
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private resolveKey(uri: string): string {
    return `${this.prefix}${uriToKey(uri)}`;
  }
}

// Store implementation (new pattern — prefer over S3Client)
export { S3Store } from "./store.ts";

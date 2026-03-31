/**
 * S3Client - Amazon S3 implementation of NodeProtocolInterface
 *
 * Stores data as JSON objects in an S3 bucket. Pure storage — validation is the rig's concern.
 *
 * Uses an injected executor so the SDK does not depend on a specific S3 library.
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
  type S3ClientConfig,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";

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
  const parts = clean.split("/").filter((p) => p !== ".." && p !== "." && p !== "");
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
      const key = this.resolveKey(uri);

      await this.executor.putObject(
        key,
        JSON.stringify(record),
        "application/json",
      );

      if (isMessageData(data)) {
        for (const [outputUri, outputValue] of data.payload.outputs) {
          const outputEncoded = encodeBinaryForJson(outputValue);
          const outputTs = Date.now();
          const outputRecord: PersistenceRecord = { ts: outputTs, data: outputEncoded };
          const outputKey = this.resolveKey(outputUri);
          await this.executor.putObject(
            outputKey,
            JSON.stringify(outputRecord),
            "application/json",
          );
        }
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

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
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

    const settled = await Promise.all(
      uris.map(async (uri): Promise<ReadMultiResultItem<T>> => {
        const result = await this.read<T>(uri);
        if (result.success && result.record) {
          return { uri, success: true, record: result.record };
        }
        return { uri, success: false, error: result.error || "Read failed" };
      }),
    );

    const succeeded = settled.filter((r) => r.success).length;

    return {
      success: succeeded > 0,
      results: settled,
      summary: {
        total: uris.length,
        succeeded,
        failed: uris.length - succeeded,
      },
    };
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const relKey = uriToKey(uri).replace(/\.json$/, "");
      const listPrefix = `${this.prefix}${relKey}/`;

      const keys = await this.executor.listObjects(listPrefix);

      let items: ListItem[] = keys
        .filter((k) => k.endsWith(".json"))
        .map((k) => {
          const rel = k.startsWith(this.prefix)
            ? k.slice(this.prefix.length)
            : k;
          const withoutExt = rel.replace(/\.json$/, "");
          const parts = withoutExt.split("/");
          const protocol = parts[0];
          const hostname = parts[1];
          const path = parts.slice(2).join("/");
          return { uri: `${protocol}://${hostname}/${path}` };
        });

      if (options?.pattern) {
        const regex = new RegExp(options.pattern);
        items = items.filter((item) => regex.test(item.uri));
      }

      if (options?.sortBy === "name" || !options?.sortBy) {
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
      const key = this.resolveKey(uri);

      const content = await this.executor.getObject(key);
      if (content === null) {
        return {
          success: false,
          error: "Not found",
          errorDetail: Errors.notFound(uri),
        };
      }

      await this.executor.deleteObject(key);
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
      const ok = await this.executor.headBucket();
      if (!ok) {
        return {
          healthy: false,
          message: `Bucket not accessible: ${this.bucket}`,
        };
      }

      return {
        healthy: true,
        message: "S3 client is operational",
        bucket: this.bucket,
        prefix: this.prefix || "(none)",
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

  private resolveKey(uri: string): string {
    return `${this.prefix}${uriToKey(uri)}`;
  }
}

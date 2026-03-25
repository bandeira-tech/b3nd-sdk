/**
 * S3Client - Amazon S3 implementation of NodeProtocolInterface
 *
 * Stores data as JSON objects in an S3 bucket using the URI structure
 * as the object key layout. Each record becomes a `.json` object
 * containing `{ ts, data }`.
 *
 * Uses an injected executor so the SDK does not depend on a specific
 * S3 library. Works with AWS SDK v3, minio-js, or any wrapper that
 * implements the S3Executor interface.
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
 * Configuration for S3Client
 */
export interface S3ClientConfig {
  /**
   * S3 bucket name
   */
  bucket: string;

  /**
   * Optional key prefix for all objects (e.g., "b3nd/" or "prod/data/")
   * Must end with "/" if provided.
   */
  prefix?: string;

  /**
   * Schema for validation — must be explicitly provided.
   */
  schema: Schema;
}

/**
 * S3 executor interface.
 * Abstracts S3 I/O so the client works with any S3-compatible SDK.
 */
export interface S3Executor {
  /**
   * Put an object into the bucket.
   * @param key - Object key
   * @param body - Object body as a UTF-8 string
   * @param contentType - MIME type (always "application/json")
   */
  putObject: (key: string, body: string, contentType: string) => Promise<void>;

  /**
   * Get an object's body as a UTF-8 string.
   * Returns null if the object does not exist.
   */
  getObject: (key: string) => Promise<string | null>;

  /**
   * Delete an object.
   * Should not throw if the object does not exist.
   */
  deleteObject: (key: string) => Promise<void>;

  /**
   * List object keys under a prefix.
   * Returns keys relative to the given prefix.
   * @param prefix - Key prefix to list under
   */
  listObjects: (prefix: string) => Promise<string[]>;

  /**
   * Check that the bucket is accessible.
   * Returns true if healthy, false otherwise.
   */
  headBucket: () => Promise<boolean>;

  /** Optional cleanup (close connections, etc.) */
  cleanup?: () => Promise<void>;
}

/**
 * Validate schema key format.
 * Keys must be in format: "protocol://hostname"
 */
function validateSchemaKey(key: string): boolean {
  return /^[a-z]+:\/\/[a-z0-9-]+$/.test(key);
}

/**
 * Convert a b3nd URI to an S3 object key.
 * "mutable://accounts/alice/profile" → "mutable/accounts/alice/profile.json"
 */
function uriToKey(uri: string): string {
  const clean = uri.replace("://", "/");
  const parts = clean.split("/").filter((p) => p !== ".." && p !== "." && p !== "");
  return parts.join("/") + ".json";
}

export class S3Client implements NodeProtocolInterface {
  private readonly schema: Schema;
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
    if (!config.schema) {
      throw new Error("schema is required in S3ClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    const invalidKeys = Object.keys(config.schema).filter(
      (key) => !validateSchemaKey(key),
    );
    if (invalidKeys.length > 0) {
      throw new Error(
        `Invalid schema key format: ${
          invalidKeys.map((k) => `"${k}"`).join(", ")
        }. ` +
          `Keys must be in "protocol://hostname" format (e.g., "mutable://accounts", "immutable://data").`,
      );
    }

    this.schema = config.schema;
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
      const key = this.resolveKey(uri);

      await this.executor.putObject(
        key,
        JSON.stringify(record),
        "application/json",
      );

      // If MessageData, also store each output at its own URI
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
      const relKey = uriToKey(uri).replace(/\.json$/, "");
      const listPrefix = `${this.prefix}${relKey}/`;

      const keys = await this.executor.listObjects(listPrefix);

      // Convert S3 keys back to URIs
      let items: ListItem[] = keys
        .filter((k) => k.endsWith(".json"))
        .map((k) => {
          // Strip prefix and .json, reconstruct URI
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

      // Apply pattern filter
      if (options?.pattern) {
        const regex = new RegExp(options.pattern);
        items = items.filter((item) => regex.test(item.uri));
      }

      // Sort
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

      // Check existence first
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

  async health(): Promise<HealthStatus> {
    try {
      const ok = await this.executor.headBucket();
      if (!ok) {
        return {
          status: "unhealthy",
          message: `Bucket not accessible: ${this.bucket}`,
        };
      }

      return {
        status: "healthy",
        message: "S3 client is operational",
        details: {
          bucket: this.bucket,
          prefix: this.prefix || "(none)",
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

  private resolveKey(uri: string): string {
    return `${this.prefix}${uriToKey(uri)}`;
  }
}

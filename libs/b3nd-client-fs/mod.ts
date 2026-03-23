/**
 * FilesystemClient - Filesystem implementation of NodeProtocolInterface
 *
 * Stores data as JSON files on disk using the URI structure as the
 * directory layout. Each record becomes a `.json` file containing
 * `{ ts, data }`.
 *
 * Uses an injected executor so the SDK does not depend on a specific
 * filesystem API. Works with Deno, Node fs, or any wrapper that
 * implements the FsExecutor interface.
 *
 * URL format: file:///path/to/root
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
 * Configuration for FilesystemClient
 */
export interface FsClientConfig {
  /**
   * Root directory for data storage.
   * All URI paths are stored relative to this root.
   */
  rootDir: string;

  /**
   * Schema for validation — must be explicitly provided.
   */
  schema: Schema;
}

/**
 * Filesystem executor interface.
 * Abstracts file I/O so the client works with Deno, Node, or test stubs.
 */
export interface FsExecutor {
  /** Read a file's contents as a UTF-8 string. Throws if not found. */
  readFile: (path: string) => Promise<string>;
  /** Write a UTF-8 string to a file, creating parent dirs as needed. */
  writeFile: (path: string, content: string) => Promise<void>;
  /** Delete a file. Throws if not found. */
  removeFile: (path: string) => Promise<void>;
  /** Check if a path exists (file or directory). */
  exists: (path: string) => Promise<boolean>;
  /**
   * Recursively list all files under a directory.
   * Returns paths relative to the given directory.
   * Returns empty array if directory doesn't exist.
   */
  listFiles: (dir: string) => Promise<string[]>;
  /** Optional cleanup (close handles, etc.) */
  cleanup?: () => Promise<void>;
}

/**
 * Sanitize a URI into a safe filesystem path segment.
 * Replaces `://` with `/` and ensures no path traversal.
 */
function uriToRelPath(uri: string): string {
  // "mutable://accounts/alice/profile" → "mutable/accounts/alice/profile.json"
  const clean = uri.replace("://", "/");
  // Prevent path traversal
  const parts = clean.split("/").filter((p) => p !== ".." && p !== "." && p !== "");
  return parts.join("/") + ".json";
}

export class FilesystemClient implements NodeProtocolInterface {
  private readonly schema: Schema;
  private readonly rootDir: string;
  private readonly executor: FsExecutor;

  constructor(config: FsClientConfig, executor?: FsExecutor) {
    if (!config) {
      throw new Error("FsClientConfig is required");
    }
    if (!config.rootDir) {
      throw new Error("rootDir is required in FsClientConfig");
    }
    if (!config.schema) {
      throw new Error("schema is required in FsClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    this.schema = config.schema;
    this.rootDir = config.rootDir.replace(/\/+$/, ""); // strip trailing slashes
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
      const filePath = this.resolvePath(uri);

      await this.executor.writeFile(filePath, JSON.stringify(record));

      // If MessageData, also store each output at its own URI
      if (isMessageData(data)) {
        for (const [outputUri, outputValue] of data.payload.outputs) {
          const outputEncoded = encodeBinaryForJson(outputValue);
          const outputTs = Date.now();
          const outputRecord: PersistenceRecord = { ts: outputTs, data: outputEncoded };
          const outputPath = this.resolvePath(outputUri);
          await this.executor.writeFile(outputPath, JSON.stringify(outputRecord));
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
      const filePath = this.resolvePath(uri);
      const fileExists = await this.executor.exists(filePath);

      if (!fileExists) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }

      const content = await this.executor.readFile(filePath);
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
      const relDir = uriToRelPath(uri).replace(/\.json$/, "");
      const dirPath = `${this.rootDir}/${relDir}`;

      const files = await this.executor.listFiles(dirPath);

      // Convert file paths back to URIs
      let items: ListItem[] = files
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          // relDir + "/" + f (minus .json) → reconstruct URI
          const fullRel = `${relDir}/${f}`.replace(/\.json$/, "");
          const parts = fullRel.split("/");
          // First part is protocol, second is hostname, rest is path
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
      } else if (options?.sortBy === "timestamp") {
        // For timestamp sort we'd need to read each file — just sort by name
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
      const filePath = this.resolvePath(uri);
      const fileExists = await this.executor.exists(filePath);

      if (!fileExists) {
        return {
          success: false,
          error: "Not found",
          errorDetail: Errors.notFound(uri),
        };
      }

      await this.executor.removeFile(filePath);
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
      const rootExists = await this.executor.exists(this.rootDir);
      if (!rootExists) {
        return {
          status: "unhealthy",
          message: `Root directory does not exist: ${this.rootDir}`,
        };
      }

      return {
        status: "healthy",
        message: "Filesystem client is operational",
        details: {
          rootDir: this.rootDir,
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

  private resolvePath(uri: string): string {
    return `${this.rootDir}/${uriToRelPath(uri)}`;
  }
}

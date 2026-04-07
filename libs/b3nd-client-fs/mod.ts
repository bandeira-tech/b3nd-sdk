/**
 * FilesystemClient - Filesystem implementation of NodeProtocolInterface
 *
 * Stores data as JSON files on disk using the URI structure as the
 * directory layout. Pure storage — validation is the rig's concern.
 *
 * Uses an injected executor so the SDK does not depend on a specific
 * filesystem API.
 *
 * URL format: file:///path/to/root
 */

import {
  Errors,
  type FsClientConfig,
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

export interface FsExecutor {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  listFiles: (dir: string) => Promise<string[]>;
  cleanup?: () => Promise<void>;
}

function uriToRelPath(uri: string): string {
  const clean = uri.replace("://", "/");
  const parts = clean.split("/").filter((p) =>
    p !== ".." && p !== "." && p !== ""
  );
  return parts.join("/") + ".json";
}

export class FilesystemClient implements NodeProtocolInterface {
  private readonly rootDir: string;
  private readonly executor: FsExecutor;

  constructor(config: FsClientConfig, executor?: FsExecutor) {
    if (!config) {
      throw new Error("FsClientConfig is required");
    }
    if (!config.rootDir) {
      throw new Error("rootDir is required in FsClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    this.rootDir = config.rootDir.replace(/\/+$/, "");
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
      const filePath = this.resolvePath(uri);

      await this.executor.writeFile(filePath, JSON.stringify(record));

      if (isMessageData(data)) {
        for (const [outputUri, outputValue] of data.payload.outputs) {
          const outputEncoded = encodeBinaryForJson(outputValue);
          const outputTs = Date.now();
          const outputRecord: PersistenceRecord = {
            ts: outputTs,
            data: outputEncoded,
          };
          const outputPath = this.resolvePath(outputUri);
          await this.executor.writeFile(
            outputPath,
            JSON.stringify(outputRecord),
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

  public async read<T = unknown>(
    uris: string | string[],
  ): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    const results: ReadResult<T>[] = [];

    for (const uri of uriList) {
      if (uri.endsWith("/")) {
        const listed = await this._list<T>(uri);
        results.push(...listed);
      } else {
        results.push(await this._readOne<T>(uri));
      }
    }

    return results;
  }

  private async _readOne<T>(uri: string): Promise<ReadResult<T>> {
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

  private async _list<T>(uri: string): Promise<ReadResult<T>[]> {
    try {
      const relDir = uriToRelPath(uri).replace(/\.json$/, "");
      const dirPath = `${this.rootDir}/${relDir}`;

      const files = await this.executor.listFiles(dirPath);

      const results: ReadResult<T>[] = [];
      for (const f of files.filter((f) => f.endsWith(".json"))) {
        const fullRel = `${relDir}/${f}`.replace(/\.json$/, "");
        const parts = fullRel.split("/");
        const protocol = parts[0];
        const hostname = parts[1];
        const path = parts.slice(2).join("/");
        const childUri = `${protocol}://${hostname}/${path}`;
        results.push(await this._readOne<T>(childUri));
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

  public async status(): Promise<StatusResult> {
    try {
      const rootExists = await this.executor.exists(this.rootDir);
      if (!rootExists) {
        return {
          status: "unhealthy",
          schema: [],
        };
      }

      return {
        status: "healthy",
        schema: [],
      };
    } catch {
      return {
        status: "unhealthy",
        schema: [],
      };
    }
  }

  private resolvePath(uri: string): string {
    return `${this.rootDir}/${uriToRelPath(uri)}`;
  }
}

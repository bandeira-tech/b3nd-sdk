/**
 * SqliteClient - SQLite implementation of NodeProtocolInterface
 *
 * Stores data in a SQLite database. Pure storage — validation is the rig's concern.
 * Uses an injected executor so the SDK does not depend on a specific SQLite driver.
 */

import {
  Errors,
  type Message,
  type NodeProtocolInterface,
  type PersistenceRecord,
  type ReadResult,
  type ReceiveResult,
  type SqliteClientConfig,
  type StatusResult,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";
import { generateSqliteSchema } from "./schema.ts";

export interface SqliteExecutorResult {
  rows: Record<string, unknown>[];
  rowCount?: number;
}

export interface SqliteExecutor {
  query: (sql: string, args?: unknown[]) => SqliteExecutorResult;
  transaction: <T>(fn: (tx: SqliteExecutor) => T) => T;
  cleanup?: () => void;
}

export class SqliteClient implements NodeProtocolInterface {
  private readonly tablePrefix: string;
  private readonly tableName: string;
  private readonly executor: SqliteExecutor;
  private connected = false;

  constructor(config: SqliteClientConfig, executor?: SqliteExecutor) {
    if (!config) {
      throw new Error("SqliteClientConfig is required");
    }
    if (!config.path) {
      throw new Error("path is required in SqliteClientConfig");
    }
    if (!config.tablePrefix) {
      throw new Error("tablePrefix is required in SqliteClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    this.tablePrefix = config.tablePrefix;
    this.tableName = `${config.tablePrefix}_data`;
    this.executor = executor;

    const ddl = generateSqliteSchema(config.tablePrefix);
    for (const stmt of ddl.split(";").map((s) => s.trim()).filter(Boolean)) {
      this.executor.query(stmt);
    }

    this.connected = true;
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
      const jsonData = JSON.stringify(encodedData);

      if (isMessageData(data)) {
        this.executor.transaction((tx) => {
          tx.query(
            `INSERT INTO ${this.tableName} (uri, data, timestamp, updated_at)
             VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(uri) DO UPDATE SET
               data = excluded.data,
               timestamp = excluded.timestamp,
               updated_at = datetime('now')`,
            [uri, jsonData, String(ts)],
          );

          for (const [outputUri, outputValue] of data.payload.outputs) {
            const outputEncoded = JSON.stringify(encodeBinaryForJson(outputValue));
            const outputTs = Date.now();
            tx.query(
              `INSERT INTO ${this.tableName} (uri, data, timestamp, updated_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(uri) DO UPDATE SET
                 data = excluded.data,
                 timestamp = excluded.timestamp,
                 updated_at = datetime('now')`,
              [outputUri, outputEncoded, String(outputTs)],
            );
          }
        });
      } else {
        this.executor.query(
          `INSERT INTO ${this.tableName} (uri, data, timestamp, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(uri) DO UPDATE SET
             data = excluded.data,
             timestamp = excluded.timestamp,
             updated_at = datetime('now')`,
          [uri, jsonData, String(ts)],
        );
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
        results.push(this._readOne<T>(uri));
      }
    }

    return results;
  }

  private _readOne<T = unknown>(uri: string): ReadResult<T> {
    try {
      const result = this.executor.query(
        `SELECT data, timestamp FROM ${this.tableName} WHERE uri = ?`,
        [uri],
      );

      if (!result.rows.length) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }

      const row = result.rows[0];
      const rawData = typeof row.data === "string"
        ? JSON.parse(row.data)
        : row.data;
      const decodedData = decodeBinaryFromJson(rawData) as T;
      const ts = typeof row.timestamp === "string"
        ? Number(row.timestamp)
        : Number(row.timestamp);

      return {
        success: true,
        record: { ts, data: decodedData },
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

  private _list<T = unknown>(uri: string): ReadResult<T>[] {
    try {
      const prefixBase = uri.endsWith("/") ? uri : `${uri}/`;

      const result = this.executor.query(
        `SELECT uri, data, timestamp FROM ${this.tableName} WHERE uri LIKE ?`,
        [`${prefixBase}%`],
      );

      if (!result.rows.length) {
        return [];
      }

      const results: ReadResult<T>[] = [];
      for (const row of result.rows) {
        const rawData = typeof row.data === "string"
          ? JSON.parse(row.data as string)
          : row.data;
        const decodedData = decodeBinaryFromJson(rawData) as T;
        const ts = typeof row.timestamp === "string"
          ? Number(row.timestamp)
          : Number(row.timestamp);
        results.push({
          success: true,
          record: {
            ts,
            data: decodedData,
            uri: row.uri as string,
          } as PersistenceRecord<T>,
        });
      }

      return results;
    } catch (_error) {
      return [];
    }
  }

  async status(): Promise<StatusResult> {
    try {
      if (!this.connected) {
        return {
          status: "unhealthy",
          message: "Not connected to SQLite",
        };
      }

      this.executor.query("SELECT 1");

      return {
        status: "healthy",
        schema: [],
        message: "SQLite client is operational",
        details: {
          tablePrefix: this.tablePrefix,
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

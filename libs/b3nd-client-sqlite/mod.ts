/**
 * SqliteClient - SQLite implementation of NodeProtocolInterface
 *
 * Stores data in a SQLite database with schema-based validation.
 * Uses an injected executor so the SDK does not depend on a specific SQLite driver.
 * Works with Deno's built-in SQLite, better-sqlite3, sql.js, or any wrapper
 * that implements the SqliteExecutor interface.
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
  type SqliteClientConfig,
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
  /** Execute a SQL query with positional parameters */
  query: (sql: string, args?: unknown[]) => SqliteExecutorResult;
  /** Run multiple statements within a transaction */
  transaction: <T>(fn: (tx: SqliteExecutor) => T) => T;
  /** Clean up resources (close the database) */
  cleanup?: () => void;
}

export class SqliteClient implements NodeProtocolInterface {
  private readonly schema: Schema;
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
    if (!config.schema) {
      throw new Error("schema is required in SqliteClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    this.schema = config.schema;
    this.tablePrefix = config.tablePrefix;
    this.tableName = `${config.tablePrefix}_data`;
    this.executor = executor;

    // Initialize schema
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
      const jsonData = JSON.stringify(encodedData);

      // Use transaction for MessageData with outputs
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

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
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

    try {
      const placeholders = uris.map(() => "?").join(", ");
      const result = this.executor.query(
        `SELECT uri, data, timestamp FROM ${this.tableName} WHERE uri IN (${placeholders})`,
        uris,
      );

      const found = new Map<string, PersistenceRecord<T>>();
      for (const row of result.rows) {
        const docUri = row.uri as string;
        const rawData = typeof row.data === "string"
          ? JSON.parse(row.data as string)
          : row.data;
        const decodedData = decodeBinaryFromJson(rawData) as T;
        const ts = typeof row.timestamp === "string"
          ? Number(row.timestamp)
          : Number(row.timestamp);
        found.set(docUri, { ts, data: decodedData });
      }

      const results: ReadMultiResultItem<T>[] = [];
      let succeeded = 0;

      for (const uri of uris) {
        const record = found.get(uri);
        if (record) {
          results.push({ uri, success: true, record });
          succeeded++;
        } else {
          results.push({ uri, success: false, error: `Not found: ${uri}` });
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
    } catch (error) {
      // Fallback to individual reads
      const results: ReadMultiResultItem<T>[] = [];
      for (const uri of uris) {
        const result = await this.read<T>(uri);
        if (result.success && result.record) {
          results.push({ uri, success: true, record: result.record });
        } else {
          results.push({
            uri,
            success: false,
            error: result.error || "Read failed",
          });
        }
      }

      const succeeded = results.filter((r) => r.success).length;
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
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const prefixBase = uri.endsWith("/") ? uri : `${uri}/`;

      const page = options?.page ?? 1;
      const limit = options?.limit ?? 50;
      const offset = (page - 1) * limit;

      // Build WHERE clause
      const conditions = ["uri LIKE ?"];
      const params: unknown[] = [`${prefixBase}%`];

      if (options?.pattern) {
        // SQLite doesn't have native regex — use GLOB for simple patterns
        // For full regex, callers should filter client-side
        conditions.push("uri LIKE ?");
        params.push(`%${options.pattern}%`);
      }

      const where = conditions.join(" AND ");

      // Sort
      const sortField = options?.sortBy === "timestamp" ? "timestamp" : "uri";
      const sortDir = options?.sortOrder === "desc" ? "DESC" : "ASC";

      // Count total
      const countResult = this.executor.query(
        `SELECT COUNT(*) as cnt FROM ${this.tableName} WHERE ${where}`,
        params,
      );
      const total = Number((countResult.rows[0] as { cnt: number }).cnt);

      // Fetch page
      const dataResult = this.executor.query(
        `SELECT uri FROM ${this.tableName} WHERE ${where} ORDER BY ${sortField} ${sortDir} LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

      const data: ListItem[] = dataResult.rows.map((row) => ({
        uri: row.uri as string,
      }));

      return {
        success: true,
        data,
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
      const result = this.executor.query(
        `DELETE FROM ${this.tableName} WHERE uri = ?`,
        [uri],
      );

      const deleted = (result.rowCount ?? 0) > 0;
      if (!deleted) {
        return {
          success: false,
          error: "Not found",
          errorDetail: Errors.notFound(uri),
        };
      }
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
      if (!this.connected) {
        return {
          status: "unhealthy",
          message: "Not connected to SQLite",
        };
      }

      // Simple health check — run a trivial query
      this.executor.query("SELECT 1");

      return {
        status: "healthy",
        message: "SQLite client is operational",
        details: {
          tablePrefix: this.tablePrefix,
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
    return this.schema ? Object.keys(this.schema) : [];
  }

  async cleanup(): Promise<void> {
    if (this.executor.cleanup) {
      this.executor.cleanup();
    }
    this.connected = false;
  }

  private extractProgramKey(uri: string): string {
    const url = new URL(uri);
    return `${url.protocol}//${url.hostname}`;
  }
}

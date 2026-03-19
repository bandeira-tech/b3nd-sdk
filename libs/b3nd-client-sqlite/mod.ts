/**
 * SqliteClient - SQLite implementation of NodeProtocolInterface
 *
 * Stores data in a SQLite database with schema-based validation.
 * Uses an injected executor so the SDK does not depend on a specific driver.
 * Works with Deno's native `@db/sqlite`, `better-sqlite3`, or any driver
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

export type { SqliteClientConfig } from "../b3nd-core/types.ts";

/**
 * Result shape returned by SQLite executor queries.
 * Mirrors PostgresClient's SqlExecutorResult so drivers can share patterns.
 */
export interface SqliteExecutorResult {
  rows: unknown[];
  rowCount?: number;
}

/**
 * Minimal interface for a SQLite executor.
 * Keeps the client driver-agnostic.
 */
export interface SqliteExecutor {
  query: (sql: string, args?: unknown[]) => SqliteExecutorResult;
  /**
   * Run multiple operations atomically.
   * For most SQLite drivers this wraps BEGIN/COMMIT/ROLLBACK.
   */
  transaction: <T>(fn: (tx: SqliteExecutor) => T) => T;
  cleanup?: () => void;
}

export class SqliteClient implements NodeProtocolInterface {
  private readonly config: SqliteClientConfig;
  private readonly schema: Schema;
  private readonly tablePrefix: string;
  private readonly executor: SqliteExecutor;
  private connected = false;

  constructor(config: SqliteClientConfig, executor?: SqliteExecutor) {
    if (!config) throw new Error("SqliteClientConfig is required");
    if (!config.path) throw new Error("path is required in SqliteClientConfig");
    if (!config.tablePrefix) {
      throw new Error("tablePrefix is required in SqliteClientConfig");
    }
    if (!config.schema) {
      throw new Error("schema is required in SqliteClientConfig");
    }
    if (!executor) throw new Error("executor is required");

    this.config = config;
    this.schema = config.schema;
    this.tablePrefix = config.tablePrefix;
    this.executor = executor;
    this.connected = true;
  }

  // ── Write ────────────────────────────────────────────────

  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    return this.receiveWithExecutor(msg, this.executor);
  }

  private async receiveWithExecutor<D = unknown>(
    msg: Message<D>,
    executor: SqliteExecutor,
  ): Promise<ReceiveResult> {
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

      // Validate — read via the same executor so in-transaction reads
      // see in-flight state.
      const readFn = <T = unknown>(readUri: string): Promise<ReadResult<T>> =>
        Promise.resolve(this.readWithExecutor<T>(readUri, executor));
      const validation = await validator({ uri, value: data, read: readFn });

      if (!validation.valid) {
        const msg = validation.error || "Validation failed";
        return {
          accepted: false,
          error: msg,
          errorDetail: Errors.invalidSchema(uri, msg),
        };
      }

      const encodedData = encodeBinaryForJson(data);
      const record: PersistenceRecord<typeof encodedData> = {
        ts: Date.now(),
        data: encodedData,
      };

      const table = `${this.tablePrefix}_data`;
      const jsonData = JSON.stringify(record.data);

      if (isMessageData(data)) {
        // Wrap envelope + all outputs in a single SQLite transaction
        executor.transaction((tx) => {
          tx.query(
            `INSERT INTO ${table} (uri, data, timestamp) VALUES (?, ?, ?)
             ON CONFLICT (uri) DO UPDATE SET data = excluded.data, timestamp = excluded.timestamp, updated_at = datetime('now')`,
            [uri, jsonData, String(record.ts)],
          );

          for (const [outputUri, outputValue] of data.payload.outputs) {
            const outEncoded = encodeBinaryForJson(outputValue);
            const outRecord = { ts: Date.now(), data: outEncoded };
            tx.query(
              `INSERT INTO ${table} (uri, data, timestamp) VALUES (?, ?, ?)
               ON CONFLICT (uri) DO UPDATE SET data = excluded.data, timestamp = excluded.timestamp, updated_at = datetime('now')`,
              [outputUri, JSON.stringify(outRecord.data), String(outRecord.ts)],
            );
          }
        });
      } else {
        executor.query(
          `INSERT INTO ${table} (uri, data, timestamp) VALUES (?, ?, ?)
           ON CONFLICT (uri) DO UPDATE SET data = excluded.data, timestamp = excluded.timestamp, updated_at = datetime('now')`,
          [uri, jsonData, String(record.ts)],
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

  // ── Read ─────────────────────────────────────────────────

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    return this.readWithExecutor<T>(uri, this.executor);
  }

  private readWithExecutor<T = unknown>(
    uri: string,
    executor: SqliteExecutor,
  ): ReadResult<T> {
    try {
      const table = `${this.tablePrefix}_data`;
      const res = executor.query(
        `SELECT data, timestamp AS ts FROM ${table} WHERE uri = ?`,
        [uri],
      );
      if (!res.rows || res.rows.length === 0) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }
      const row = res.rows[0] as { data: string; ts: string | number };
      const parsed = JSON.parse(row.data);
      const decodedData = decodeBinaryFromJson(parsed) as T;
      const record: PersistenceRecord<T> = {
        ts: typeof row.ts === "number" ? row.ts : Number(row.ts),
        data: decodedData,
      };
      return { success: true, record };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: msg,
        errorDetail: Errors.storageError(msg, uri),
      };
    }
  }

  // ── ReadMulti ────────────────────────────────────────────

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
      const table = `${this.tablePrefix}_data`;
      const placeholders = uris.map(() => "?").join(",");
      const res = this.executor.query(
        `SELECT uri, data, timestamp AS ts FROM ${table} WHERE uri IN (${placeholders})`,
        uris,
      );

      const found = new Map<string, PersistenceRecord<T>>();
      for (const raw of res.rows || []) {
        const row = raw as { uri: string; data: string; ts: string | number };
        const parsed = JSON.parse(row.data);
        const decodedData = decodeBinaryFromJson(parsed) as T;
        found.set(row.uri, {
          ts: typeof row.ts === "number" ? row.ts : Number(row.ts),
          data: decodedData,
        });
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
      const results: ReadMultiResultItem<T>[] = uris.map((uri) => {
        const result = this.readWithExecutor<T>(uri, this.executor);
        if (result.success && result.record) {
          return { uri, success: true as const, record: result.record };
        }
        return {
          uri,
          success: false as const,
          error: result.error || "Read failed",
        };
      });

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

  // ── List ─────────────────────────────────────────────────

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const table = `${this.tablePrefix}_data`;
      const prefix = uri.endsWith("/") ? uri : `${uri}/`;
      const page = options?.page ?? 1;
      const limit = options?.limit ?? 50;
      const offset = (page - 1) * limit;

      const args: unknown[] = [`${prefix}%`];
      let patternClause = "";

      if (options?.pattern) {
        // SQLite doesn't have native regex in all builds, so use GLOB or LIKE.
        // We'll use a custom check in the WHERE clause.
        // For broad compatibility, fetch with prefix then filter in JS for regex.
        // But for the common case (no pattern), this stays server-side.
      }

      // Count total matching rows
      const countRes = this.executor.query(
        `SELECT COUNT(*) AS cnt FROM ${table} WHERE uri LIKE ?${patternClause}`,
        args,
      );
      let total = Number(
        (countRes.rows[0] as { cnt: unknown })?.cnt ?? 0,
      );

      // Determine ORDER BY column (whitelist to prevent SQL injection)
      const orderCol = options?.sortBy === "timestamp" ? "timestamp" : "uri";
      const orderDir = options?.sortOrder === "desc" ? "DESC" : "ASC";

      // Fetch rows
      const rowsRes = this.executor.query(
        `SELECT uri FROM ${table} WHERE uri LIKE ?${patternClause} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`,
        [...args, limit, offset],
      );

      let data: ListItem[] = [];
      for (const raw of rowsRes.rows || []) {
        const row = raw as { uri?: unknown };
        if (typeof row.uri === "string") {
          data.push({ uri: row.uri });
        }
      }

      // Apply regex pattern filter if specified (SQLite lacks native regex)
      if (options?.pattern) {
        const regex = new RegExp(options.pattern);
        data = data.filter((item) => regex.test(item.uri));
        // Recount since we filtered client-side
        const allRes = this.executor.query(
          `SELECT uri FROM ${table} WHERE uri LIKE ?`,
          [`${prefix}%`],
        );
        const allUris = (allRes.rows || [])
          .map((r) => (r as { uri: string }).uri)
          .filter((u) => regex.test(u));
        total = allUris.length;
      }

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

  // ── Delete ───────────────────────────────────────────────

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const table = `${this.tablePrefix}_data`;
      // Check existence first — SQLite drivers vary in rowCount support
      const check = this.executor.query(
        `SELECT 1 FROM ${table} WHERE uri = ?`,
        [uri],
      );
      if (!check.rows || check.rows.length === 0) {
        return {
          success: false,
          error: "Not found",
          errorDetail: Errors.notFound(uri),
        };
      }
      this.executor.query(`DELETE FROM ${table} WHERE uri = ?`, [uri]);
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

  // ── Health / Schema / Cleanup ────────────────────────────

  async health(): Promise<HealthStatus> {
    try {
      if (!this.connected) {
        return { status: "unhealthy", message: "Not connected to SQLite" };
      }
      this.executor.query("SELECT 1");
      return {
        status: "healthy",
        message: "SQLite client is operational",
        details: {
          tablePrefix: this.tablePrefix,
          path: this.config.path,
          schemaKeys: Object.keys(this.schema),
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: `SQLite health check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
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

  /**
   * Initialize database schema.
   * Creates the necessary table and indexes for b3nd data storage.
   */
  initializeSchema(): void {
    try {
      const schemaSQL = generateSqliteSchema(this.tablePrefix);
      this.executor.query(schemaSQL);
    } catch (error) {
      throw new Error(
        `Failed to initialize SQLite schema: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private extractProgramKey(uri: string): string {
    const url = new URL(uri);
    return `${url.protocol}//${url.hostname}`;
  }
}

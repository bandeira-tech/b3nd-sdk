/**
 * SqliteClient - SQLite implementation of NodeProtocolInterface
 *
 * Mechanical storage: delete inputs, write outputs. No validation — the rig's concern.
 * Uses an injected executor so the SDK does not depend on a specific SQLite driver.
 *
 * Message primitive: [uri, values, data] where data is always
 * { inputs: string[], outputs: Output[] }.
 */

import {
  Errors,
  type Message,
  type NodeProtocolInterface,
  type ReadResult,
  type ReceiveResult,
  type SqliteClientConfig,
  type StatusResult,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
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

  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const msg of msgs) {
      results.push(this._receiveOne(msg));
    }

    return results;
  }

  private _receiveOne(msg: Message): ReceiveResult {
    const [uri, , data] = msg;

    if (!uri || typeof uri !== "string") {
      return {
        accepted: false,
        error: "Message URI is required",
        errorDetail: Errors.invalidUri(uri ?? "", "Message URI is required"),
      };
    }

    try {
      const msgData = data as {
        inputs?: string[];
        outputs?: [string, Record<string, number>, unknown][];
      } | null;

      if (!msgData || typeof msgData !== "object") {
        return { accepted: false, error: "Message data must be { inputs, outputs }" };
      }

      const inputs: string[] = Array.isArray(msgData.inputs) ? msgData.inputs : [];
      const outputs: [string, Record<string, number>, unknown][] =
        Array.isArray(msgData.outputs) ? msgData.outputs : [];

      this.executor.transaction((tx) => {
        // Delete inputs
        for (const inputUri of inputs) {
          tx.query(
            `DELETE FROM ${this.tableName} WHERE uri = ?`,
            [inputUri],
          );
        }

        // Write outputs
        for (const [outUri, outValues, outData] of outputs) {
          const encodedData = encodeBinaryForJson(outData);
          const jsonData = JSON.stringify(encodedData);
          const jsonValues = JSON.stringify(outValues || {});

          tx.query(
            `INSERT INTO ${this.tableName} (uri, data, "values", updated_at)
             VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(uri) DO UPDATE SET
               data = excluded.data,
               "values" = excluded."values",
               updated_at = datetime('now')`,
            [outUri, jsonData, jsonValues],
          );
        }
      });

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
        `SELECT data, "values" FROM ${this.tableName} WHERE uri = ?`,
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
      const values = typeof row.values === "string"
        ? JSON.parse(row.values)
        : (row.values || {});

      return {
        success: true,
        record: { values, data: decodedData },
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errMsg,
        errorDetail: Errors.storageError(errMsg, uri),
      };
    }
  }

  private _list<T = unknown>(uri: string): ReadResult<T>[] {
    try {
      const prefixBase = uri.endsWith("/") ? uri : `${uri}/`;

      const result = this.executor.query(
        `SELECT uri, data, "values" FROM ${this.tableName} WHERE uri LIKE ?`,
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
        const values = typeof row.values === "string"
          ? JSON.parse(row.values as string)
          : (row.values || {});
        results.push({
          success: true,
          uri: row.uri as string,
          record: { values, data: decodedData },
        });
      }

      return results;
    } catch (_error) {
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

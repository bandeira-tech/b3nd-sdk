/**
 * PostgresClient - PostgreSQL implementation of NodeProtocolInterface
 *
 * Mechanical storage: delete inputs, write outputs. No validation — the rig's concern.
 * Uses connection pooling for performance and supports SSL connections.
 *
 * Message primitive: [uri, values, data] where data is always
 * { inputs: string[], outputs: Output[] }.
 */

import {
  Errors,
  type Message,
  type NodeProtocolInterface,
  type PostgresClientConfig,
  type ReadResult,
  type ReceiveResult,
  type StatusResult,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { generatePostgresSchema } from "./schema.ts";

// Local executor types scoped to Postgres client to avoid leaking DB concerns
export interface SqlExecutorResult {
  rows: unknown[];
  rowCount?: number;
}

export interface SqlExecutor {
  query: (sql: string, args?: unknown[]) => Promise<SqlExecutorResult>;
  transaction: <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
  cleanup?: () => Promise<void>;
}

export class PostgresClient implements NodeProtocolInterface {
  private readonly config: PostgresClientConfig;
  private readonly tablePrefix: string;
  private readonly executor: SqlExecutor;
  private connected = false;

  constructor(config: PostgresClientConfig, executor?: SqlExecutor) {
    if (!config) {
      throw new Error("PostgresClientConfig is required");
    }
    if (!config.connection) {
      throw new Error("connection is required in PostgresClientConfig");
    }
    if (!config.tablePrefix) {
      throw new Error("tablePrefix is required in PostgresClientConfig");
    }
    if (config.poolSize == null) {
      throw new Error("poolSize is required in PostgresClientConfig");
    }
    if (config.connectionTimeout == null) {
      throw new Error("connectionTimeout is required in PostgresClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    this.config = config;
    this.tablePrefix = config.tablePrefix;
    this.executor = executor;
    this.connected = true;
  }

  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const msg of msgs) {
      results.push(await this._receiveOne(msg));
    }

    return results;
  }

  private async _receiveOne(msg: Message): Promise<ReceiveResult> {
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

      const table = `${this.tablePrefix}_data`;

      await this.executor.transaction(async (tx) => {
        // Delete inputs
        for (const inputUri of inputs) {
          await tx.query(
            `DELETE FROM ${table} WHERE uri = $1`,
            [inputUri],
          );
        }

        // Write outputs
        for (const [outUri, outValues, outData] of outputs) {
          const encodedData = encodeBinaryForJson(outData);
          await tx.query(
            `INSERT INTO ${table} (uri, data, "values") VALUES ($1, $2::jsonb, $3::jsonb)
             ON CONFLICT (uri) DO UPDATE SET data = EXCLUDED.data, "values" = EXCLUDED."values", updated_at = CURRENT_TIMESTAMP`,
            [outUri, JSON.stringify(encodedData), JSON.stringify(outValues || {})],
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
        results.push(...await this._list<T>(uri));
      } else {
        results.push(await this._readOne<T>(uri));
      }
    }

    return results;
  }

  private async _readOne<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const table = `${this.tablePrefix}_data`;
      const res = await this.executor.query(
        `SELECT data, "values" FROM ${table} WHERE uri = $1`,
        [uri],
      );
      if (!res.rows || res.rows.length === 0) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }
      const row: any = res.rows[0];
      const rawData = row.data;
      const decodedData = decodeBinaryFromJson(rawData) as T;
      const values = row.values || {};
      return { success: true, record: { values, data: decodedData } };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errMsg,
        errorDetail: Errors.storageError(errMsg, uri),
      };
    }
  }

  private async _list<T = unknown>(uri: string): Promise<ReadResult<T>[]> {
    try {
      const table = `${this.tablePrefix}_data`;
      const prefix = uri.endsWith("/") ? uri : `${uri}/`;

      const res = await this.executor.query(
        `SELECT uri, data, "values" FROM ${table} WHERE uri LIKE $1 || '%'`,
        [prefix],
      );

      if (!res.rows || res.rows.length === 0) {
        return [];
      }

      const results: ReadResult<T>[] = [];
      for (const raw of res.rows) {
        const row = raw as { uri: string; data: unknown; values: unknown };
        const decodedData = decodeBinaryFromJson(row.data) as T;
        results.push({
          success: true,
          uri: row.uri,
          record: { values: (row.values || {}) as Record<string, number>, data: decodedData },
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
          message: "Not connected to PostgreSQL",
        };
      }
      await this.executor.query("SELECT 1");
      return {
        status: "healthy",
        schema: [],
        message: "PostgreSQL client is operational",
        details: {
          tablePrefix: this.tablePrefix,
          connectionType: typeof this.config.connection === "string"
            ? "connection_string"
            : "config_object",
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: `PostgreSQL health check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  async initializeSchema(): Promise<void> {
    try {
      const schemaSQL = generatePostgresSchema(this.tablePrefix);
      await this.executor.query(schemaSQL);
    } catch (error) {
      throw new Error(
        `Failed to initialize PostgreSQL schema: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  getConnectionInfo(): string {
    if (typeof this.config.connection === "string") {
      const masked = this.config.connection.replace(/:([^@]+)@/, ":****@");
      return masked;
    } else {
      return `postgresql://${this.config.connection.user}:****@${this.config.connection.host}:${this.config.connection.port}/${this.config.connection.database}`;
    }
  }
}

// Store implementation (new pattern — prefer over PostgresClient)
export { PostgresStore } from "./store.ts";

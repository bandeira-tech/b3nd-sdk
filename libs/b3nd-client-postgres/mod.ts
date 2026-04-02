/**
 * PostgresClient - PostgreSQL implementation of NodeProtocolInterface
 *
 * Stores data in PostgreSQL database. Pure storage — validation is the rig's concern.
 * Uses connection pooling for performance and supports SSL connections.
 */

import {
  Errors,
  type Message,
  type NodeProtocolInterface,
  type PersistenceRecord,
  type PostgresClientConfig,
  type ReadResult,
  type ReceiveResult,
  type StatusResult,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";
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

  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    return this.receiveWithExecutor(msg, this.executor);
  }

  private async receiveWithExecutor<D = unknown>(
    msg: Message<D>,
    executor: SqlExecutor,
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
      const encodedData = encodeBinaryForJson(data);
      const record: PersistenceRecord<typeof encodedData> = {
        ts: Date.now(),
        data: encodedData,
      };

      const table = `${this.tablePrefix}_data`;

      if (isMessageData(data)) {
        await executor.transaction(async (tx) => {
          await tx.query(
            `INSERT INTO ${table} (uri, data, timestamp) VALUES ($1, $2::jsonb, $3)
             ON CONFLICT (uri) DO UPDATE SET data = EXCLUDED.data, timestamp = EXCLUDED.timestamp, updated_at = CURRENT_TIMESTAMP`,
            [uri, JSON.stringify(record.data), record.ts],
          );

          for (const [outputUri, outputValue] of data.payload.outputs) {
            const outputResult = await this.receiveWithExecutor(
              [outputUri, outputValue],
              tx,
            );
            if (!outputResult.accepted) {
              throw new Error(
                outputResult.error || `Failed to store output: ${outputUri}`,
              );
            }
          }
        });
      } else {
        await executor.query(
          `INSERT INTO ${table} (uri, data, timestamp) VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (uri) DO UPDATE SET data = EXCLUDED.data, timestamp = EXCLUDED.timestamp, updated_at = CURRENT_TIMESTAMP`,
          [uri, JSON.stringify(record.data), record.ts],
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
        `SELECT data, timestamp as ts FROM ${table} WHERE uri = $1`,
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
      // pg driver auto-parses jsonb — row.data is already a native JS value.
      // Do NOT JSON.parse string values; that breaks scalar strings like "hello".
      const rawData = row.data;
      const decodedData = decodeBinaryFromJson(rawData) as T;
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

  private async _list<T = unknown>(uri: string): Promise<ReadResult<T>[]> {
    try {
      const table = `${this.tablePrefix}_data`;
      const prefix = uri.endsWith("/") ? uri : `${uri}/`;

      const res = await this.executor.query(
        `SELECT uri, data, timestamp as ts FROM ${table} WHERE uri LIKE $1 || '%'`,
        [prefix],
      );

      if (!res.rows || res.rows.length === 0) {
        return [];
      }

      const results: ReadResult<T>[] = [];
      for (const raw of res.rows) {
        const row = raw as { uri: string; data: unknown; ts: unknown };
        const decodedData = decodeBinaryFromJson(row.data) as T;
        results.push({
          success: true,
          record: {
            ts: typeof row.ts === "number" ? row.ts : Number(row.ts),
            data: decodedData,
            uri: row.uri,
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

  /**
   * Initialize database schema
   * Creates the necessary tables for b3nd data storage
   */
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

  /**
   * Get connection info for logging/debugging
   */
  getConnectionInfo(): string {
    if (typeof this.config.connection === "string") {
      const masked = this.config.connection.replace(/:([^@]+)@/, ":****@");
      return masked;
    } else {
      return `postgresql://${this.config.connection.user}:****@${this.config.connection.host}:${this.config.connection.port}/${this.config.connection.database}`;
    }
  }
}

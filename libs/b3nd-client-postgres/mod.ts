/**
 * PostgresClient - PostgreSQL implementation of NodeProtocolInterface
 *
 * Stores data in PostgreSQL database with schema-based validation.
 * Uses connection pooling for performance and supports SSL connections.
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
  type PostgresClientConfig,
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
  private readonly schema: Schema;
  private readonly tablePrefix: string;
  private readonly executor: SqlExecutor;
  private connected = false;

  constructor(config: PostgresClientConfig, executor?: SqlExecutor) {
    // Validate required configuration
    if (!config) {
      throw new Error("PostgresClientConfig is required");
    }
    if (!config.connection) {
      throw new Error("connection is required in PostgresClientConfig");
    }
    if (!config.tablePrefix) {
      throw new Error("tablePrefix is required in PostgresClientConfig");
    }
    if (!config.schema) {
      throw new Error("schema is required in PostgresClientConfig");
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
    this.schema = config.schema;
    this.tablePrefix = config.tablePrefix;
    this.executor = executor;
    this.connected = true;
  }

  /**
   * Receive a message - the unified entry point for all state changes
   * @param msg - Message tuple [uri, data]
   * @returns ReceiveResult indicating acceptance
   */
  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    return this.receiveWithExecutor(msg, this.executor);
  }

  private async receiveWithExecutor<D = unknown>(
    msg: Message<D>,
    executor: SqlExecutor,
  ): Promise<ReceiveResult> {
    const [uri, data] = msg;

    // Basic URI validation
    if (!uri || typeof uri !== "string") {
      return {
        accepted: false,
        error: "Message URI is required",
        errorDetail: Errors.invalidUri(uri ?? "", "Message URI is required"),
      };
    }

    try {
      // Extract program key (protocol://toplevel)
      const programKey = this.extractProgramKey(uri);

      // Find matching validation function
      const validator = this.schema[programKey];

      if (!validator) {
        const msg = `No schema defined for program key: ${programKey}`;
        return {
          accepted: false,
          error: msg,
          errorDetail: Errors.invalidSchema(uri, msg),
        };
      }

      // Validate the write — use the provided executor so reads within
      // a transaction see the in-flight state, not the committed state.
      const readFn = <T = unknown>(readUri: string): Promise<ReadResult<T>> =>
        this.readWithExecutor<T>(readUri, executor);
      const validation = await validator({
        uri,
        value: data,
        read: readFn,
      });

      if (!validation.valid) {
        const msg = validation.error || "Validation failed";
        return {
          accepted: false,
          error: msg,
          errorDetail: Errors.invalidSchema(uri, msg),
        };
      }

      // Create record with timestamp
      // Encode binary data for JSON storage
      const encodedData = encodeBinaryForJson(data);
      const record: PersistenceRecord<typeof encodedData> = {
        ts: Date.now(),
        data: encodedData,
      };

      const table = `${this.tablePrefix}_data`;

      // If MessageData with multiple outputs, wrap in a transaction for atomicity
      if (isMessageData(data)) {
        await executor.transaction(async (tx) => {
          // Store the envelope itself
          await tx.query(
            `INSERT INTO ${table} (uri, data, timestamp) VALUES ($1, $2::jsonb, $3)
             ON CONFLICT (uri) DO UPDATE SET data = EXCLUDED.data, timestamp = EXCLUDED.timestamp, updated_at = CURRENT_TIMESTAMP`,
            [uri, JSON.stringify(record.data), record.ts],
          );

          // Store each output within the same transaction
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
        // Single write — no transaction needed
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

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    return this.readWithExecutor<T>(uri, this.executor);
  }

  private async readWithExecutor<T = unknown>(
    uri: string,
    executor: SqlExecutor,
  ): Promise<ReadResult<T>> {
    try {
      const table = `${this.tablePrefix}_data`;
      const res = await executor.query(
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
      // Decode binary data if encoded
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
      // Single query using ANY($1) instead of N individual queries
      const table = `${this.tablePrefix}_data`;
      const res = await this.executor.query(
        `SELECT uri, data, timestamp as ts FROM ${table} WHERE uri = ANY($1)`,
        [uris],
      );

      // Build a map of found records for O(1) lookup
      const found = new Map<string, PersistenceRecord<T>>();
      for (const raw of res.rows || []) {
        const row = raw as { uri: string; data: unknown; ts: unknown };
        // pg driver auto-parses jsonb — no manual JSON.parse needed
        const decodedData = decodeBinaryFromJson(row.data) as T;
        found.set(row.uri, {
          ts: typeof row.ts === "number" ? row.ts : Number(row.ts),
          data: decodedData,
        });
      }

      // Build results in the original URI order
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
      // Fallback to individual reads on query failure
      const results: ReadMultiResultItem<T>[] = await Promise.all(
        uris.map(async (uri): Promise<ReadMultiResultItem<T>> => {
          const result = await this.read<T>(uri);
          if (result.success && result.record) {
            return { uri, success: true, record: result.record };
          }
          return {
            uri,
            success: false,
            error: result.error || "Read failed",
          };
        }),
      );

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
      const table = `${this.tablePrefix}_data`;
      const prefix = uri.endsWith("/") ? uri : `${uri}/`;
      const page = options?.page ?? 1;
      const limit = options?.limit ?? 50;
      const offset = (page - 1) * limit;

      const args: unknown[] = [prefix];
      let patternClause = "";

      if (options?.pattern) {
        patternClause = ` AND uri ~ $2`;
        args.push(options.pattern);
      }

      // Count total matching rows for pagination
      const countRes = await this.executor.query(
        `SELECT COUNT(*) as cnt FROM ${table} WHERE uri LIKE $1 || '%'${patternClause}`,
        args,
      );
      const total = Number((countRes.rows[0] as { cnt: unknown })?.cnt ?? 0);

      // Determine ORDER BY column (whitelist to prevent SQL injection)
      const orderCol = options?.sortBy === "timestamp" ? "timestamp" : "uri";
      const orderDir = options?.sortOrder === "desc" ? "DESC" : "ASC";

      // Build parameterized query with sort/limit/offset pushed to SQL
      const dataArgs = [...args, limit, offset];
      const limitIdx = args.length + 1;
      const offsetIdx = args.length + 2;

      const rowsRes = await this.executor.query(
        `SELECT uri FROM ${table} WHERE uri LIKE $1 || '%'${patternClause} ORDER BY ${orderCol} ${orderDir} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataArgs,
      );

      const data: ListItem[] = [];
      for (const raw of rowsRes.rows || []) {
        const row = raw as { uri?: unknown };
        if (typeof row.uri === "string") {
          data.push({ uri: row.uri });
        }
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

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const table = `${this.tablePrefix}_data`;
      const res = await this.executor.query(
        `DELETE FROM ${table} WHERE uri = $1`,
        [uri],
      );
      const affected = typeof res.rowCount === "number" ? res.rowCount : 0;
      if (affected === 0) {
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
          message: "Not connected to PostgreSQL",
        };
      }
      // Simple health check
      await this.executor.query("SELECT 1");
      return {
        status: "healthy",
        message: "PostgreSQL client is operational",
        details: {
          tablePrefix: this.tablePrefix,
          schemaKeys: Object.keys(this.schema),
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

  async getSchema(): Promise<string[]> {
    return this.schema ? Object.keys(this.schema) : [];
  }

  async cleanup(): Promise<void> {
    if (this.executor.cleanup) {
      await this.executor.cleanup();
    }
    this.connected = false;
  }

  /**
   * Initialize database schema
   * Creates the necessary tables for b3nd data storage
   */
  async initializeSchema(): Promise<void> {
    try {
      // Generate schema SQL using the utility function
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
   * Extract program key from URI (protocol://toplevel)
   * Mirrors MemoryClient behavior:
   *   "users://alice/profile" -> "users://alice"
   *   "cache://session/123" -> "cache://session"
   */
  private extractProgramKey(uri: string): string {
    const url = new URL(uri);
    return `${url.protocol}//${url.hostname}`;
  }

  /**
   * Get connection info for logging/debugging
   */
  getConnectionInfo(): string {
    if (typeof this.config.connection === "string") {
      // Mask password in connection string
      const masked = this.config.connection.replace(/:([^@]+)@/, ":****@");
      return masked;
    } else {
      return `postgresql://${this.config.connection.user}:****@${this.config.connection.host}:${this.config.connection.port}/${this.config.connection.database}`;
    }
  }
}

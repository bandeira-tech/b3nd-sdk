/**
 * PostgresClient - PostgreSQL implementation of NodeProtocolInterface
 *
 * Stores data in PostgreSQL database with schema-based validation.
 * Uses connection pooling for performance and supports SSL connections.
 */

import type {
  DeleteResult,
  HealthStatus,
  ListItem,
  ListOptions,
  ListResult,
  NodeProtocolInterface,
  PostgresClientConfig,
  PersistenceRecord,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  Schema,
} from "../../src/types.ts";
import type { Node, ReceiveResult, Transaction } from "../../src/node/types.ts";
import { encodeBinaryForJson, decodeBinaryFromJson } from "../../src/binary.ts";
import { generatePostgresSchema } from "./schema.ts";

// Local executor types scoped to Postgres client to avoid leaking DB concerns
export interface SqlExecutorResult {
  rows: unknown[];
  rowCount?: number;
}

export interface SqlExecutor {
  query: (sql: string, args?: unknown[]) => Promise<SqlExecutorResult>;
  cleanup?: () => Promise<void>;
}

export class PostgresClient implements NodeProtocolInterface, Node {
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
   * Receive a transaction - the unified entry point for all state changes
   * @param tx - Transaction tuple [uri, data]
   * @returns ReceiveResult indicating acceptance
   */
  async receive<D = unknown>(tx: Transaction<D>): Promise<ReceiveResult> {
    const [uri, data] = tx;

    // Basic URI validation
    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Transaction URI is required" };
    }

    try {
      // Extract program key (protocol://toplevel)
      const programKey = this.extractProgramKey(uri);

      // Find matching validation function
      const validator = this.schema[programKey];

      if (!validator) {
        return {
          accepted: false,
          error: `No schema defined for program key: ${programKey}`,
        };
      }

      // Validate the write
      const validation = await validator({ uri, value: data, read: this.read.bind(this) });

      if (!validation.valid) {
        return {
          accepted: false,
          error: validation.error || "Validation failed",
        };
      }

      // Create record with timestamp
      // Encode binary data for JSON storage
      const encodedData = encodeBinaryForJson(data);
      const record: PersistenceRecord<typeof encodedData> = {
        ts: Date.now(),
        data: encodedData,
      };

      // Upsert into table directly to avoid dependency on DB function
      const table = `${this.tablePrefix}_data`;
      await this.executor.query(
        `INSERT INTO ${table} (uri, data, timestamp) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (uri) DO UPDATE SET data = EXCLUDED.data, timestamp = EXCLUDED.timestamp, updated_at = CURRENT_TIMESTAMP`,
        [uri, JSON.stringify(record.data), record.ts],
      );

      return { accepted: true };
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const table = `${this.tablePrefix}_data`;
      const res = await this.executor.query(
        `SELECT data, timestamp as ts FROM ${table} WHERE uri = $1`,
        [uri],
      );
      if (!res.rows || res.rows.length === 0) {
        return { success: false, error: `Not found: ${uri}` };
      }
      const row: any = res.rows[0];
      const rawData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      // Decode binary data if encoded
      const decodedData = decodeBinaryFromJson(rawData) as T;
      const record: PersistenceRecord<T> = {
        ts: typeof row.ts === 'number' ? row.ts : Number(row.ts),
        data: decodedData,
      };
      return { success: true, record };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    if (uris.length > 50) {
      return {
        success: false,
        results: [],
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    }

    const results: ReadMultiResultItem<T>[] = await Promise.all(
      uris.map(async (uri): Promise<ReadMultiResultItem<T>> => {
        const result = await this.read<T>(uri);
        if (result.success && result.record) {
          return { uri, success: true, record: result.record };
        }
        return { uri, success: false, error: result.error || "Read failed" };
      })
    );

    const succeeded = results.filter((r) => r.success).length;
    return {
      success: succeeded > 0,
      results,
      summary: { total: uris.length, succeeded, failed: uris.length - succeeded },
    };
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const table = `${this.tablePrefix}_data`;

      // In Postgres, URIs are stored as full strings (e.g., "users://alice/profile").
      // To emulate MemoryClient's directory semantics, we:
      //   - Treat the input URI as the "directory" prefix.
      //   - Find all rows whose URI starts with that prefix + "/".
      //   - Derive immediate children as either "file" or "directory" items.

      const prefix = uri.endsWith("/") ? uri : `${uri}/`;

      const rowsRes = await this.executor.query(
        `SELECT uri, timestamp FROM ${table} WHERE uri LIKE $1 || '%'`,
        [prefix],
      );

      type ItemWithTs = { uri: string; type: "file" | "directory"; ts: number };

      const directories = new Map<string, ItemWithTs>();
      const files: ItemWithTs[] = [];

      for (const raw of rowsRes.rows || []) {
        const row = raw as { uri?: unknown; timestamp?: unknown };
        if (typeof row.uri !== "string") continue;

        const fullUri = row.uri;
        if (!fullUri.startsWith(prefix)) continue;

        const relative = fullUri.slice(prefix.length);
        if (!relative) continue;

        const [firstSegment, ...rest] = relative.split("/");
        if (!firstSegment) continue;

        const ts =
          typeof row.timestamp === "number"
            ? row.timestamp
            : row.timestamp != null
              ? Number(row.timestamp)
              : 0;

        if (rest.length === 0) {
          // Leaf file directly under the prefix
          files.push({ uri: fullUri, type: "file", ts });
        } else {
          // Directory directly under the prefix (may have many rows under it)
          const dirUri = `${prefix}${firstSegment}`;
          if (!directories.has(dirUri)) {
            directories.set(dirUri, {
              uri: dirUri,
              type: "directory",
              ts: 0,
            });
          }
        }
      }

      let items: ItemWithTs[] = [
        ...directories.values(),
        ...files,
      ];

      if (options?.pattern) {
        const regex = new RegExp(options.pattern);
        items = items.filter((item) => regex.test(item.uri));
      }

      if (options?.sortBy === "name") {
        items.sort((a, b) => a.uri.localeCompare(b.uri));
      } else if (options?.sortBy === "timestamp") {
        items.sort((a, b) => a.ts - b.ts);
      }

      if (options?.sortOrder === "desc") {
        items.reverse();
      }

      const page = options?.page ?? 1;
      const limit = options?.limit ?? 50;
      const offset = (page - 1) * limit;
      const paginated = items.slice(offset, offset + limit);

      const data: ListItem[] = paginated.map((item) => ({
        uri: item.uri,
        type: item.type,
      }));

      return {
        success: true,
        data,
        pagination: {
          page,
          limit,
          total: items.length,
        },
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
      const res = await this.executor.query(`DELETE FROM ${table} WHERE uri = $1`, [uri]);
      const affected = typeof res.rowCount === 'number' ? res.rowCount : 0;
      if (affected === 0) {
        return { success: false, error: 'Not found' };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
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
      await this.executor.query('SELECT 1');
      return { status: 'healthy', message: 'PostgreSQL client is operational', details: {
        tablePrefix: this.tablePrefix,
        schemaKeys: Object.keys(this.schema),
        connectionType: typeof this.config.connection === 'string' ? 'connection_string' : 'config_object',
      }};
    } catch (error) {
      return {
        status: "unhealthy",
        message: `PostgreSQL health check failed: ${error instanceof Error ? error.message : String(error)}`,
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
      throw new Error(`Failed to initialize PostgreSQL schema: ${error instanceof Error ? error.message : String(error)}`);
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
    if (typeof this.config.connection === 'string') {
      // Mask password in connection string
      const masked = this.config.connection.replace(/:([^@]+)@/, ':****@');
      return masked;
    } else {
      return `postgresql://${this.config.connection.user}:****@${this.config.connection.host}:${this.config.connection.port}/${this.config.connection.database}`;
    }
  }
}

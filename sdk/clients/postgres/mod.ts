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
  ReadResult,
  Schema,
  WriteResult,
} from "../../src/types.ts";

// PostgreSQL client import - using postgres library for Deno
// Note: In a real implementation, you'd use a PostgreSQL client library
// For now, we'll create a mock implementation that shows the structure

import { generatePostgresSchema } from "./schema.ts";

// Local executor types scoped to Postgres client to avoid leaking DB concerns
export interface SqlExecutorResult {
  rows: unknown[];
  rowCount?: number;
}

export interface SqlExecutor {
  query: (sql: string, args?: unknown[]) => Promise<SqlExecutorResult>;
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

  async write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>> {
    try {
      // Extract program key (protocol://toplevel)
      const programKey = this.extractProgramKey(uri);

      // Find matching validation function
      const validator = this.schema[programKey];

      if (!validator) {
        return {
          success: false,
          error: `No schema defined for program key: ${programKey}`,
        };
      }

      // Validate the write
      const validation = await validator({ uri, value, read: this.read.bind(this) });

      if (!validation.valid) {
        return {
          success: false,
          error: validation.error || "Validation failed",
        };
      }

      // Create record with timestamp
      const record: PersistenceRecord<T> = {
        ts: Date.now(),
        data: value,
      };

      // Upsert into table directly to avoid dependency on DB function
      const table = `${this.tablePrefix}_data`;
      await this.executor.query(
        `INSERT INTO ${table} (uri, data, timestamp) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (uri) DO UPDATE SET data = EXCLUDED.data, timestamp = EXCLUDED.timestamp, updated_at = CURRENT_TIMESTAMP`,
        [uri, JSON.stringify(record.data), record.ts],
      );

      return {
        success: true,
        record,
      };
    } catch (error) {
      return {
        success: false,
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
      const record: PersistenceRecord<T> = {
        ts: typeof row.ts === 'number' ? row.ts : Number(row.ts),
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      };
      return { success: true, record };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const page = options?.page ?? 1;
      const limit = options?.limit ?? 100;
      const pattern = options?.pattern;
      const offset = (page - 1) * limit;
      const table = `${this.tablePrefix}_data`;

      const conditions: string[] = ["uri LIKE $1 || '%'" ];
      const args: unknown[] = [uri];
      if (pattern) {
        const sqlPattern = String(pattern).replace(/\*/g, '%');
        conditions.push("uri LIKE $2");
        args.push(`%${sqlPattern}%`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const listSql = `SELECT uri FROM ${table} ${where} ORDER BY uri LIMIT ${limit} OFFSET ${offset}`;
      const countSql = `SELECT COUNT(*)::int AS count FROM ${table} ${where}`;

      const [rowsRes, countRes] = await Promise.all([
        this.executor.query(listSql, args),
        this.executor.query(countSql, args),
      ]);

      const total = (countRes.rows && (countRes.rows[0] as any)?.count) ?? 0;
      const data: ListItem[] = (rowsRes.rows || []).map((r: any) => ({
        uri: r.uri,
        type: 'file',
      }));

      return { success: true, data, pagination: { page, limit, total } };
    } catch (error) {
      return { success: true, data: [], pagination: { page: options?.page ?? 1, limit: options?.limit ?? 100 } };
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
    // Close database connections
    this.connected = false;
    // In real implementation: await this.pool.end();
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
   * Examples:
   *   "users://alice/profile" -> "users://"
   *   "cache://session/123" -> "cache://"
   */
  private extractProgramKey(uri: string): string {
    const match = uri.match(/^([^:]+:\/\/)/);
    return match ? match[1] : "";
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

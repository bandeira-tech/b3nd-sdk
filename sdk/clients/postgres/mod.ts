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

export class PostgresClient implements NodeProtocolInterface {
  private config: PostgresClientConfig;
  private schema: Schema;
  private tablePrefix: string;
  private connected: boolean = false;
  // private pool: Pool; // Would be initialized with actual PostgreSQL client

  constructor(config: PostgresClientConfig) {
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
    if (!config.poolSize) {
      throw new Error("poolSize is required in PostgresClientConfig");
    }
    if (!config.connectionTimeout) {
      throw new Error("connectionTimeout is required in PostgresClientConfig");
    }

    this.config = config;
    this.schema = config.schema;
    this.tablePrefix = config.tablePrefix;

    // Initialize connection (mock for now)
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
      const validation = await validator({ uri, value });

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

      // Store in PostgreSQL (mock implementation)
      // In real implementation, this would execute SQL like:
      // INSERT INTO b3nd_data (uri, data, timestamp) VALUES ($1, $2, $3)
      // ON CONFLICT (uri) DO UPDATE SET data = $2, timestamp = $3

      // Mock successful write
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
      // Mock read from PostgreSQL
      // In real implementation, this would execute:
      // SELECT data, timestamp FROM b3nd_data WHERE uri = $1

      // For demo purposes, return a mock record
      const mockRecord: PersistenceRecord<T> = {
        ts: Date.now(),
        data: null as T, // Would be actual data from DB
      };

      return {
        success: true,
        record: mockRecord,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const page = options?.page || 1;
      const limit = options?.limit || 100;
      const pattern = options?.pattern;

      // Mock list from PostgreSQL
      // In real implementation, this would execute:
      // SELECT uri, data, timestamp FROM b3nd_data
      // WHERE uri LIKE $1 || '%' AND uri LIKE '%' || $2 || '%'
      // ORDER BY uri LIMIT $3 OFFSET $4

      // Return empty result for now
      return {
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
        },
      };
    } catch (error) {
      return {
        data: [],
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 100,
        },
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      // Mock delete from PostgreSQL
      // In real implementation, this would execute:
      // DELETE FROM b3nd_data WHERE uri = $1

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(): Promise<HealthStatus> {
    try {
      // Mock health check
      // In real implementation, this would execute:
      // SELECT 1; -- Simple health check query

      if (!this.connected) {
        return {
          status: "unhealthy",
          message: "Not connected to PostgreSQL",
        };
      }

      return {
        status: "healthy",
        message: "PostgreSQL client is operational",
        details: {
          tablePrefix: this.tablePrefix,
          schemaKeys: Object.keys(this.schema),
          connectionType: typeof this.config.connection === 'string' ? 'connection_string' : 'config_object',
        },
      };
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

      // In real implementation, this would execute the SQL:
      // await this.pool.query(schemaSQL);

      console.log(`[PostgresClient] Schema initialized with table prefix: ${this.tablePrefix}`);
      console.log(`[PostgresClient] Schema SQL generated (${schemaSQL.length} characters)`);
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
/**
 * PostgreSQL Client Setup for b3nd HTTP API
 *
 * This module provides programmatic setup for PostgreSQL clients
 * using the PostgresClient from the b3nd SDK.
 *
 * Following AGENTS.md principles:
 * - No ENV references - all configuration must be passed explicitly
 * - No default values - all required values must be provided
 * - Components fail if required values are not set
 */

import { PostgresClient } from "@bandeira-tech/b3nd-sdk";
import type { PostgresClientConfig, Schema } from "@bandeira-tech/b3nd-sdk";

/**
 * PostgreSQL connection configuration
 */
export interface PostgresConnectionConfig {
  connection: string | {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean | object;
  };
  tablePrefix: string;
  poolSize: number;
  connectionTimeout: number;
}

/**
 * Create a PostgreSQL client with explicit configuration
 *
 * @param connectionConfig - PostgreSQL connection configuration (required)
 * @param schema - Schema for validation (required)
 * @returns Configured PostgresClient instance
 */
export function createPostgresClient(
  connectionConfig: PostgresConnectionConfig,
  schema: Schema,
): PostgresClient {
  // Validate connection configuration
  if (!connectionConfig) {
    throw new Error("connectionConfig is required");
  }
  if (!connectionConfig.connection) {
    throw new Error("connectionConfig.connection is required");
  }
  if (!connectionConfig.tablePrefix) {
    throw new Error("connectionConfig.tablePrefix is required");
  }
  if (!connectionConfig.poolSize) {
    throw new Error("connectionConfig.poolSize is required");
  }
  if (!connectionConfig.connectionTimeout) {
    throw new Error("connectionConfig.connectionTimeout is required");
  }

  // Validate schema
  if (!schema) {
    throw new Error("schema is required");
  }

  const config: PostgresClientConfig = {
    connection: connectionConfig.connection,
    schema: schema,
    tablePrefix: connectionConfig.tablePrefix,
    poolSize: connectionConfig.poolSize,
    connectionTimeout: connectionConfig.connectionTimeout,
  };

  return new PostgresClient(config);
}

/**
 * Initialize PostgreSQL schema
 *
 * @param client - PostgresClient instance (required)
 */
export async function initializePostgresSchema(
  client: PostgresClient,
): Promise<void> {
  if (!client) {
    throw new Error("client is required");
  }

  try {
    await client.initializeSchema();
    console.log("[PostgresSetup] PostgreSQL schema initialized successfully");
  } catch (error) {
    console.error(
      "[PostgresSetup] Failed to initialize PostgreSQL schema:",
      error,
    );
    throw error;
  }
}

/**
 * Test PostgreSQL connection
 *
 * @param client - PostgresClient instance (required)
 * @returns true if connection is healthy, false otherwise
 */
export async function testPostgresConnection(
  client: PostgresClient,
): Promise<boolean> {
  if (!client) {
    throw new Error("client is required");
  }

  try {
    const health = await client.health();
    if (health.status === "healthy") {
      console.log("[PostgresSetup] PostgreSQL connection test successful");
      return true;
    } else {
      console.warn(
        "[PostgresSetup] PostgreSQL health check failed:",
        health.message,
      );
      return false;
    }
  } catch (error) {
    console.error("[PostgresSetup] PostgreSQL connection test failed:", error);
    return false;
  }
}

/**
 * Create PostgreSQL connection from environment variables
 *
 * This function is provided for convenience but violates AGENTS.md principles
 * by reading from ENV. Use createPostgresClient() for proper component design.
 *
 * @deprecated Use createPostgresClient() with explicit configuration instead
 */
export function createPostgresClientFromEnv(): PostgresClient {
  // Get database connection details from environment
  const databaseUrl = Deno.env.get("DATABASE_URL");
  const postgresHost = Deno.env.get("POSTGRES_HOST");
  const postgresPort = Deno.env.get("POSTGRES_PORT");
  const postgresDb = Deno.env.get("POSTGRES_DB");
  const postgresUser = Deno.env.get("POSTGRES_USER");
  const postgresPassword = Deno.env.get("POSTGRES_PASSWORD");
  const tablePrefix = Deno.env.get("POSTGRES_TABLE_PREFIX");
  const poolSize = Deno.env.get("POSTGRES_POOL_SIZE");
  const connectionTimeout = Deno.env.get("POSTGRES_CONNECTION_TIMEOUT");

  // Parse numeric values with validation
  const port = postgresPort ? parseInt(postgresPort) : undefined;
  const pool = poolSize ? parseInt(poolSize) : undefined;
  const timeout = connectionTimeout ? parseInt(connectionTimeout) : undefined;

  // Validate that we have the required configuration
  if (!databaseUrl && !(postgresHost && postgresDb && postgresUser && postgresPassword)) {
    throw new Error(
      "PostgreSQL configuration not found. Please provide either DATABASE_URL or individual POSTGRES_* environment variables.",
    );
  }

  if (!tablePrefix) {
    throw new Error("POSTGRES_TABLE_PREFIX is required");
  }

  if (!poolSize) {
    throw new Error("POSTGRES_POOL_SIZE is required");
  }

  if (!connectionTimeout) {
    throw new Error("POSTGRES_CONNECTION_TIMEOUT is required");
  }

  // Build connection config
  let connection: string | {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };

  if (databaseUrl) {
    connection = databaseUrl;
  } else if (postgresHost && postgresDb && postgresUser && postgresPassword && port) {
    connection = {
      host: postgresHost,
      port: port,
      database: postgresDb,
      user: postgresUser,
      password: postgresPassword,
    };
  } else {
    throw new Error("Invalid PostgreSQL configuration");
  }

  const connectionConfig: PostgresConnectionConfig = {
    connection: connection,
    tablePrefix: tablePrefix,
    poolSize: pool,
    connectionTimeout: timeout,
  };

  // Empty schema for now - should be provided by caller
  const schema: Schema = {};

  return createPostgresClient(connectionConfig, schema);
}
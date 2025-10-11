/**
 * PostgreSQL Client Setup for b3nd HTTP API
 *
 * This module provides programmatic setup for PostgreSQL clients
 * using the PostgresClient from the b3nd SDK.
 */

import { PostgresClient } from "@bandeira-tech/b3nd-sdk";
import type { Schema } from "@bandeira-tech/b3nd-sdk";

/**
 * Create a PostgreSQL client from environment variables
 */
export function createPostgresClientFromEnv(): PostgresClient {
  // Get database connection details from environment
  const databaseUrl = Deno.env.get("DATABASE_URL");
  const postgresHost = Deno.env.get("POSTGRES_HOST");
  const postgresPort = parseInt(Deno.env.get("POSTGRES_PORT") || "5432");
  const postgresDb = Deno.env.get("POSTGRES_DB");
  const postgresUser = Deno.env.get("POSTGRES_USER");
  const postgresPassword = Deno.env.get("POSTGRES_PASSWORD");

  let connection: string | {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };

  // Use DATABASE_URL if provided, otherwise build from individual components
  if (databaseUrl) {
    connection = databaseUrl;
  } else if (postgresHost && postgresDb && postgresUser && postgresPassword) {
    connection = {
      host: postgresHost,
      port: postgresPort,
      database: postgresDb,
      user: postgresUser,
      password: postgresPassword,
    };
  } else {
    throw new Error(
      "PostgreSQL configuration not found. Please provide either DATABASE_URL or individual POSTGRES_* environment variables."
    );
  }

  // Define schema (can be customized per deployment)
  const schema: Schema = {
    "users://": async ({ uri, value }) => {
      // Add validation logic here
      return { valid: true };
    },
    "posts://": async ({ uri, value }) => {
      // Add validation logic here
      return { valid: true };
    },
    "cache://": async ({ uri, value }) => {
      // Add validation logic here
      return { valid: true };
    },
    "files://": async ({ uri, value }) => {
      // Add validation logic here
      return { valid: true };
    },
    "data://": async ({ uri, value }) => {
      // Add validation logic here
      return { valid: true };
    },
  };

  // Create and return the PostgreSQL client
  const client = new PostgresClient({
    connection,
    schema,
    tablePrefix: Deno.env.get("POSTGRES_TABLE_PREFIX") || "b3nd",
    poolSize: parseInt(Deno.env.get("POSTGRES_POOL_SIZE") || "10"),
    connectionTimeout: parseInt(Deno.env.get("POSTGRES_CONNECTION_TIMEOUT") || "30000"),
  });

  return client;
}

/**
 * Create a PostgreSQL client from a connection string
 */
export function createPostgresClient(connectionString: string): PostgresClient {
  const schema: Schema = {
    "users://": async ({ uri, value }) => ({ valid: true }),
    "posts://": async ({ uri, value }) => ({ valid: true }),
    "cache://": async ({ uri, value }) => ({ valid: true }),
    "files://": async ({ uri, value }) => ({ valid: true }),
    "data://": async ({ uri, value }) => ({ valid: true }),
  };

  return new PostgresClient({
    connection: connectionString,
    schema,
    tablePrefix: "b3nd",
    poolSize: 10,
    connectionTimeout: 30000,
  });
}

/**
 * Create a PostgreSQL client with custom schema
 */
export function createPostgresClientWithSchema(
  connection: string | {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  },
  schema: Schema
): PostgresClient {
  return new PostgresClient({
    connection,
    schema,
    tablePrefix: Deno.env.get("POSTGRES_TABLE_PREFIX") || "b3nd",
    poolSize: parseInt(Deno.env.get("POSTGRES_POOL_SIZE") || "10"),
    connectionTimeout: parseInt(Deno.env.get("POSTGRES_CONNECTION_TIMEOUT") || "30000"),
  });
}

/**
 * Initialize PostgreSQL schema
 */
export async function initializePostgresSchema(client: PostgresClient): Promise<void> {
  try {
    await client.initializeSchema();
    console.log("[PostgresSetup] PostgreSQL schema initialized successfully");
  } catch (error) {
    console.error("[PostgresSetup] Failed to initialize PostgreSQL schema:", error);
    throw error;
  }
}

/**
 * Test PostgreSQL connection
 */
export async function testPostgresConnection(client: PostgresClient): Promise<boolean> {
  try {
    const health = await client.health();
    if (health.status === "healthy") {
      console.log("[PostgresSetup] PostgreSQL connection test successful");
      return true;
    } else {
      console.warn("[PostgresSetup] PostgreSQL health check failed:", health.message);
      return false;
    }
  } catch (error) {
    console.error("[PostgresSetup] PostgreSQL connection test failed:", error);
    return false;
  }
}
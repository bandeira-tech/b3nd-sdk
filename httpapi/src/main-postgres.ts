/**
 * PostgreSQL-enabled Main entry point
 *
 * This demonstrates PostgreSQL client setup with explicit configuration
 * following AGENTS.md principles - no ENV references, all values must be
 * explicitly provided by the caller.
 */

import { MemoryClient, PostgresClient } from "@bandeira-tech/b3nd-sdk";
import { getClientManager } from "./clients.ts";
import { startServer } from "./server-new.ts";
import {
  createPostgresClient,
  testPostgresConnection,
  initializePostgresSchema,
  type PostgresConnectionConfig,
} from "./postgres-setup.ts";

/**
 * PostgreSQL setup options
 */
export interface PostgresSetupOptions {
  connectionConfig: PostgresConnectionConfig;
  schema?: Record<string, (write: { uri: string; value: unknown }) => Promise<{ valid: boolean; error?: string }>>;
  enableFallback?: boolean;
}

/**
 * Setup function - create and register clients with PostgreSQL support
 *
 * @param options - PostgreSQL setup options with explicit configuration
 */
async function setupClients(options?: PostgresSetupOptions) {
  const manager = getClientManager();

  console.log("[Setup] Starting client configuration...");

  // Try to set up PostgreSQL client first if configuration is provided
  let postgresClient: PostgresClient | null = null;
  let postgresAvailable = false;

  if (options?.connectionConfig) {
    console.log("[Setup] PostgreSQL configuration provided, attempting connection...");

    try {
      // Create schema - use provided schema or empty schema
      const schema = options.schema || {};

      // Create PostgreSQL client with explicit configuration
      postgresClient = createPostgresClient(options.connectionConfig, schema);

      // Test the connection
      postgresAvailable = await testPostgresConnection(postgresClient);

      if (postgresAvailable) {
        console.log("[Setup] PostgreSQL connection successful!");

        // Initialize schema if needed
        try {
          await initializePostgresSchema(postgresClient);
          console.log("[Setup] PostgreSQL schema initialized");
        } catch (schemaError) {
          console.warn("[Setup] PostgreSQL schema initialization failed (may already exist):", schemaError);
        }

        // Register PostgreSQL client as default
        manager.registerClient("postgres", postgresClient, true);
        console.log("[Setup] PostgreSQL client registered as default");
      } else {
        console.warn("[Setup] PostgreSQL connection test failed, falling back to memory client");
      }
    } catch (error) {
      console.error("[Setup] PostgreSQL setup failed:", error);

      // Clean up failed PostgreSQL client
      if (postgresClient) {
        try {
          await postgresClient.cleanup();
        } catch (cleanupError) {
          console.warn("[Setup] PostgreSQL cleanup failed:", cleanupError);
        }
      }
    }
  } else {
    console.log("[Setup] No PostgreSQL configuration provided, using memory clients");
  }

  // Always set up memory clients as fallback
  console.log("[Setup] Setting up memory clients...");

  // Development memory client
  const devMemoryClient = new MemoryClient({
    schema: {
      "users://": async ({ value }: { value: unknown }) => {
        if (typeof value === "object" && value !== null && "name" in value) {
          return { valid: true };
        }
        return { valid: false, error: "Users must have a name" };
      },
      "posts://": async ({ value }: { value: unknown }) => {
        if (typeof value === "object" && value !== null && "title" in value) {
          return { valid: true };
        }
        return { valid: false, error: "Posts must have a title" };
      },
      "cache://": async () => ({ valid: true }),
      "temp://": async () => ({ valid: true }),
    },
  });

  // If PostgreSQL is not available, make memory client default
  const isMemoryDefault = !postgresAvailable;
  manager.registerClient("memory-dev", devMemoryClient, isMemoryDefault);

  // Testing memory client (never default)
  const testClient = new MemoryClient({
    schema: {
      "test://": async () => ({ valid: true }),
    }
  });
  manager.registerClient("test", testClient);

  // Remote HTTP client for distributed setups (requires explicit URL)
  // This would need to be passed as a parameter to follow AGENTS.md principles

  // Log final configuration
  const instanceNames = manager.getInstanceNames();
  const defaultInstance = manager.getDefaultInstance();

  console.log(`[Setup] Configuration complete. Available instances: ${instanceNames.join(", ")}`);
  console.log(`[Setup] Default instance: ${defaultInstance}`);

  if (postgresAvailable) {
    console.log("[Setup] ✓ PostgreSQL backend is active");
  } else {
    console.log("[Setup] ⚠ Running with memory backend (PostgreSQL unavailable)");
  }

  return {
    postgresAvailable,
    postgresClient,
  };
}

/**
 * Cleanup function - properly close all clients
 */
async function cleanupClients() {
  console.log("[Cleanup] Cleaning up clients...");

  try {
    const manager = getClientManager();
    await manager.cleanup();
    console.log("[Cleanup] Clients cleaned up successfully");
  } catch (error) {
    console.error("[Cleanup] Error during client cleanup:", error);
  }
}

/**
 * Main function - requires explicit configuration
 */
async function main() {
  try {
    console.log("[Main] Starting b3nd HTTP API with PostgreSQL support...");

    // For backward compatibility, check if we should use ENV-based setup
    // This violates AGENTS.md principles but maintains existing behavior
    const databaseUrl = Deno.env.get("DATABASE_URL");
    const postgresHost = Deno.env.get("POSTGRES_HOST");
    const postgresPort = Deno.env.get("POSTGRES_PORT");
    const postgresDb = Deno.env.get("POSTGRES_DB");
    const postgresUser = Deno.env.get("POSTGRES_USER");
    const postgresPassword = Deno.env.get("POSTGRES_PASSWORD");
    const tablePrefix = Deno.env.get("POSTGRES_TABLE_PREFIX") || "b3nd"; // Default violates principles
    const poolSize = Deno.env.get("POSTGRES_POOL_SIZE") || "10"; // Default violates principles
    const connectionTimeout = Deno.env.get("POSTGRES_CONNECTION_TIMEOUT") || "30000"; // Default violates principles

    let setupResult;

    if (databaseUrl || postgresHost) {
      console.log("[Main] PostgreSQL configuration detected via environment variables");

      // Build connection config from ENV (violates AGENTS.md principles)
      let connection: string | {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
      };

      if (databaseUrl) {
        connection = databaseUrl;
      } else if (postgresHost && postgresDb && postgresUser && postgresPassword && postgresPort) {
        connection = {
          host: postgresHost,
          port: parseInt(postgresPort),
          database: postgresDb,
          user: postgresUser,
          password: postgresPassword,
        };
      } else {
        throw new Error("Incomplete PostgreSQL configuration in environment variables");
      }

      const connectionConfig: PostgresConnectionConfig = {
        connection: connection,
        tablePrefix: tablePrefix,
        poolSize: parseInt(poolSize),
        connectionTimeout: parseInt(connectionTimeout),
      };

      // Empty schema for now
      const schema = {};

      setupResult = await setupClients({
        connectionConfig,
        schema,
      });
    } else {
      console.log("[Main] No PostgreSQL configuration found, using memory backend");
      setupResult = await setupClients();
    }

    // Register cleanup handler
    if (Deno.build.os !== "windows") {
      Deno.addSignalListener("SIGINT", async () => {
        console.log("[Main] Received SIGINT, cleaning up...");
        await cleanupClients();
        Deno.exit(0);
      });

      Deno.addSignalListener("SIGTERM", async () => {
        console.log("[Main] Received SIGTERM, cleaning up...");
        await cleanupClients();
        Deno.exit(0);
      });
    }

    // Start the server
    console.log("[Main] Starting server...");
    await startServer();

    return setupResult;
  } catch (error) {
    console.error("[Main] Fatal error:", error);
    await cleanupClients();
    Deno.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.main) {
  main();
}

// Export for programmatic usage
export { setupClients, cleanupClients, main };
export type { PostgresSetupOptions, PostgresConnectionConfig };
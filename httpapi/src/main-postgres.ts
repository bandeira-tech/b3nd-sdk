/**
 * PostgreSQL-enabled Main entry point
 *
 * This demonstrates PostgreSQL client setup with environment-based configuration
 * and fallback to memory clients for development.
 */

import { MemoryClient, PostgresClient } from "@bandeira-tech/b3nd-sdk";
import { getClientManager } from "./clients.ts";
import { startServer } from "./server-new.ts";
import {
  createPostgresClientFromEnv,
  createPostgresClient,
  testPostgresConnection,
  initializePostgresSchema,
} from "./postgres-setup.ts";

/**
 * Setup function - create and register clients with PostgreSQL support
 */
async function setupClients() {
  const manager = getClientManager();

  console.log("[Setup] Starting client configuration...");

  // Try to set up PostgreSQL client first
  let postgresClient: PostgresClient | null = null;
  let postgresAvailable = false;

  try {
    // Check if PostgreSQL configuration is available
    const databaseUrl = Deno.env.get("DATABASE_URL");
    const postgresHost = Deno.env.get("POSTGRES_HOST");

    if (databaseUrl || postgresHost) {
      console.log("[Setup] PostgreSQL configuration detected, attempting connection...");

      postgresClient = createPostgresClientFromEnv();

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
    } else {
      console.log("[Setup] No PostgreSQL configuration found, using memory clients");
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

  // Remote HTTP client for distributed setups
  const remoteApiUrl = Deno.env.get("REMOTE_API_URL");
  if (remoteApiUrl) {
    try {
      // Dynamic import to avoid issues if HttpClient is not available
      const { HttpClient } = await import("@bandeira-tech/b3nd-sdk");
      const httpClient = new HttpClient({
        url: remoteApiUrl,
        timeout: 30000,
      });
      manager.registerClient("remote", httpClient);
      console.log("[Setup] Remote HTTP client registered");
    } catch (error) {
      console.warn("[Setup] Failed to set up remote HTTP client:", error);
    }
  }

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
 * Main function
 */
async function main() {
  try {
    console.log("[Main] Starting b3nd HTTP API with PostgreSQL support...");

    // Setup clients programmatically
    await setupClients();

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
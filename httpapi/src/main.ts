/**
 * Main entry point with programmatic client setup
 *
 * This demonstrates the new approach where developers create and configure
 * their own clients with full flexibility, then register them with the manager.
 */

import { MemoryClient, HttpClient } from "@bandeira-tech/b3nd-sdk";
import { getClientManager } from "./clients.ts";
import { startServer } from "./server-new.ts";

/**
 * Setup function - create and register your clients here
 */
async function setupClients() {
  const manager = getClientManager();

  // Example 1: Simple memory client (default)
  const memoryClient = new MemoryClient({
    schema: {
      "users://": async ({ value }: { value: unknown }) => {
        if (typeof value === "object" && value !== null && "name" in value) {
          return { valid: true };
        }
        return { valid: false, error: "Users must have a name" };
      },
    },
  });
  manager.registerClient("memory", memoryClient, true); // Set as default

  // Example 2: HTTP client for remote API
  const httpClient = new HttpClient({
    url: Deno.env.get("REMOTE_API_URL") || "http://localhost:8081",
  });
  manager.registerClient("remote", httpClient);

  // Example 3: Another memory client for testing
  const testClient = new MemoryClient({ schema: {} });
  manager.registerClient("test", testClient);

  console.log("[Setup] Clients registered successfully");
}

/**
 * Main function
 */
async function main() {
  try {
    // Setup clients programmatically
    await setupClients();

    // Start the server - clients are already registered
    console.log("[Main] Starting server...");
    await startServer();
  } catch (error) {
    console.error("[Main] Fatal error:", error);
    Deno.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.main) {
  main();
}

// Also export for programmatic usage
export { setupClients, main };
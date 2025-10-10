/**
 * Example: Client Setup
 *
 * This file demonstrates how developers can create and configure their own clients
 * with full flexibility, then register them with the ClientManager.
 *
 * Instead of static JSON configuration, developers write TypeScript code that can:
 * - Use environment variables
 * - Import schemas dynamically
 * - Apply complex logic for client creation
 * - Take advantage of full TypeScript intellisense
 */

import {
  MemoryClient,
  HttpClient,
  WebSocketClient,
  LocalStorageClient,
  IndexedDBClient
} from "@bandeira-tech/b3nd-sdk";
import { getClientManager } from "./clients.ts";

/**
 * Example 1: Simple memory client with schema
 */
function setupMemoryClient() {
  const schema = {
    "users://": async ({ value }: { value: unknown }) => {
      if (typeof value === "object" && value !== null && "name" in value) {
        return { valid: true };
      }
      return { valid: false, error: "Users must have a name" };
    },
  };

  const memoryClient = new MemoryClient({ schema });
  getClientManager().registerClient("memory", memoryClient, true); // Set as default
}

/**
 * Example 2: HTTP client with environment-based configuration
 */
function setupHttpClient() {
  const baseUrl = Deno.env.get("B3ND_API_URL") || "http://localhost:8080";
  const apiKey = Deno.env.get("B3ND_API_KEY");

  const httpClient = new HttpClient({
    url: baseUrl,
    // Can add headers, timeouts, retry logic, etc.
    headers: apiKey ? { "Authorization": `Bearer ${apiKey}` } : {},
  });

  getClientManager().registerClient("remote", httpClient);
}

/**
 * Example 3: WebSocket client with dynamic URL construction
 */
function setupWebSocketClient() {
  const host = Deno.env.get("B3ND_WS_HOST") || "localhost";
  const port = Deno.env.get("B3ND_WS_PORT") || "8080";
  const useSecure = Deno.env.get("B3ND_WS_SECURE") === "true";

  const protocol = useSecure ? "wss" : "ws";
  const url = `${protocol}://${host}:${port}`;

  const wsClient = new WebSocketClient({
    url,
    // Can add reconnection logic, message handlers, etc.
  });

  getClientManager().registerClient("realtime", wsClient);
}

/**
 * Example 4: IndexedDB client for browser environments
 */
function setupIndexedDBClient() {
  const dbName = `b3nd-${Deno.env.get("ENVIRONMENT") || "development"}`;

  const indexedDBClient = new IndexedDBClient({
    databaseName: dbName,
    // Can add version, schema migrations, etc.
  });

  getClientManager().registerClient("persistent", indexedDBClient);
}

/**
 * Example 5: Multiple clients with different configurations
 */
export async function setupClients() {
  const manager = getClientManager();

  // Production client - connects to remote API
  if (Deno.env.get("NODE_ENV") === "production") {
    const prodClient = new HttpClient({
      url: "https://api.b3nd.io",
      headers: { "Authorization": `Bearer ${Deno.env.get("API_KEY")}` }
    });
    manager.registerClient("prod", prodClient, true);
  }

  // Development client - local memory with schema validation
  else {
    const devSchema = await import("./schemas/development.ts");
    const devClient = new MemoryClient({ schema: devSchema.default });
    manager.registerClient("dev", devClient, true);
  }

  // Testing client - ephemeral memory
  const testClient = new MemoryClient();
  manager.registerClient("test", testClient);

  // Analytics client - separate IndexedDB for analytics data
  const analyticsClient = new IndexedDBClient({
    databaseName: "b3nd-analytics",
  });
  manager.registerClient("analytics", analyticsClient);
}

/**
 * Example 6: Advanced client with custom middleware
 */
function setupAdvancedClient() {
  // Create a client with custom configuration
  const advancedClient = new HttpClient({
    url: "https://custom.b3nd.io",
    // Custom headers, timeouts, retry logic
    headers: {
      "X-Custom-Header": "value",
      "User-Agent": "MyApp/1.0"
    },
  });

  // You could add middleware, logging, caching, etc.
  // All in TypeScript with full type safety

  getClientManager().registerClient("advanced", advancedClient);
}

/**
 * Example usage in main.ts or server.ts:
 *
 * import { setupClients } from "./client-setup-example.ts";
 *
 * // Setup clients programmatically
 * await setupClients();
 *
 * // Or setup individual clients
 * setupMemoryClient();
 * setupHttpClient();
 *
 * // Start server - clients are already registered
 * const app = await createApp();
 */
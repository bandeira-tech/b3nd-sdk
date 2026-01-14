/**
 * Test HTTP Server for E2E Tests
 *
 * Simple in-memory HTTP server for testing the SDK's HTTP client and validation.
 * Starts on port 8000 and runs until interrupted.
 *
 * Usage:
 *   deno run --allow-net test-server.ts
 *   E2E_SERVER_PORT=8080 deno run --allow-net test-server.ts
 */

import { httpServer } from "../../sdk/servers/http.ts";
import { MemoryClient } from "../../sdk/clients/memory/mod.ts";
import type { Schema } from "../../sdk/src/types.ts";

// Create a permissive schema that allows any program key
// The schema needs exact matches on "program key" format: protocol://domain
// Create a base schema with common test keys and use a Proxy for dynamic keys
const baseSchema: Schema = {
  // Test protocol - all test domains
  "test://write-test": async ({ uri, value }) => ({ valid: true }),
  "test://read-test": async ({ uri, value }) => ({ valid: true }),
  "test://list-test": async ({ uri, value }) => ({ valid: true }),
  "test://auth-test": async ({ uri, value }) => ({ valid: true }),
  "test://encrypt-test": async ({ uri, value }) => ({ valid: true }),
  "test://signed-encrypted-test": async ({ uri, value }) => ({ valid: true }),

  // Notes protocol (for fixtures)
  "notes://alicedoe": async ({ uri, value }) => ({ valid: true }),

  // Users protocol (for fixture profile)
  "users://alicedoe": async ({ uri, value }) => ({ valid: true }),

  // Example protocol
  "example://demo": async ({ uri, value }) => ({ valid: true }),
};

// Create a schema proxy that allows any program key
// If a key isn't explicitly defined, it returns a permissive validator
const testSchema = new Proxy(baseSchema, {
  get(target, prop: string | symbol) {
    if (typeof prop === 'string') {
      if (prop in target) {
        return target[prop as keyof Schema];
      }
      // Default validator for any undefined program key
      return async ({ uri, value }: { uri: string; value: unknown }) => ({
        valid: true,
      });
    }
    // For symbol keys, return undefined or use Object.getOwnProperty
    return undefined;
  },
}) as Schema;


// Create in-memory backend
const memoryClient = new MemoryClient({
  schema: testSchema,
});

// Create Hono app
import { Hono } from "hono";
const app = new Hono();

// Create HTTP server frontend and configure it
const frontend = httpServer(app as any);
frontend.configure({
  backend: {
    write: memoryClient,
    read: memoryClient,
  },
  schema: testSchema,
});

// Start server
const PORT = parseInt(Deno.env.get("E2E_SERVER_PORT") || "8000");
console.log(`🚀 Test HTTP server starting on port ${PORT}...`);

try {
  Deno.serve({ port: PORT }, (req) => app.fetch(req));
} catch (error) {
  console.error(`❌ Failed to start server: ${error}`);
  Deno.exit(1);
}

// Handle shutdown gracefully
Deno.addSignalListener("SIGINT", () => {
  console.log("\n🛑 Server shutting down...");
  Deno.exit(0);
});

console.log(`✅ Server running at http://localhost:${PORT}`);

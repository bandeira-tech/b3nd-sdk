/**
 * Test HTTP Server for E2E Tests
 *
 * Simple in-memory HTTP server for testing the SDK's HTTP client and validation.
 * Uses the Rig as the single entry point — no direct b3nd-servers dependency.
 *
 * Usage:
 *   deno run --allow-net test-server.ts
 *   E2E_SERVER_PORT=8080 deno run --allow-net test-server.ts
 */

import { Rig } from "../libs/b3nd-rig/mod.ts";
import { MemoryClient } from "../libs/b3nd-client-memory/mod.ts";
import type { Schema } from "../libs/b3nd-core/types.ts";

// Create a permissive schema that allows any program key
// The schema needs exact matches on "program key" format: protocol://domain
const baseSchema: Schema = {
  "test://write-test": async () => ({ valid: true }),
  "test://read-test": async () => ({ valid: true }),
  "test://list-test": async () => ({ valid: true }),
  "test://auth-test": async () => ({ valid: true }),
  "test://encrypt-test": async () => ({ valid: true }),
  "test://signed-encrypted-test": async () => ({ valid: true }),
  "notes://alicedoe": async () => ({ valid: true }),
  "users://alicedoe": async () => ({ valid: true }),
  "example://demo": async () => ({ valid: true }),
};

// Proxy that allows any program key (permissive test schema)
const testSchema = new Proxy(baseSchema, {
  get(target, prop: string | symbol) {
    if (typeof prop === "string") {
      if (prop in target) return target[prop as keyof Schema];
      return async () => ({ valid: true });
    }
    return undefined;
  },
}) as Schema;

// Create rig with in-memory backend + schema validation
const rig = await Rig.init({
  client: new MemoryClient({ schema: {} }),
  schema: testSchema,
});

// Get the HTTP handler from the rig
const handler = rig.handler();

// Start server
const PORT = parseInt(Deno.env.get("E2E_SERVER_PORT") || "8000");
console.log(`🚀 Test HTTP server starting on port ${PORT}...`);

try {
  Deno.serve({ port: PORT }, handler);
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

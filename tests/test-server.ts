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

import { connection, httpApi, Rig } from "../libs/b3nd-rig/mod.ts";
import { MemoryStore } from "../libs/b3nd-client-memory/store.ts";
import { DataStoreClient } from "../libs/b3nd-core/data-store-client.ts";
import {
  messageDataHandler,
  messageDataProgram,
} from "../libs/b3nd-msg/data/canon.ts";

// Permissive test rig: no per-prefix programs, so every receive runs
// process() (returns the default `{ code: "ok" }`), then handle()
// (default-dispatch returns the input tuple as-is), then broadcast.
// Inputs land at their URIs; no validation gates them.
//
// MessageData canon is installed for the hash:// envelope path so E2E
// tests using `send()` / `AuthenticatedRig.send()` get their inner
// outputs decomposed and persisted automatically.
const rig = new Rig({
  connections: [
    connection(
      new DataStoreClient(new MemoryStore()),
      { receive: ["*"], read: ["*"] },
    ),
  ],
  programs: { "hash://sha256": messageDataProgram },
  handlers: { "msgdata:valid": messageDataHandler },
});

// httpApi() is a standalone function — the rig stays pure
const handler = httpApi(rig);

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

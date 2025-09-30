#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * WebSocket Server Runner
 *
 * Standalone runner for the WebSocket server with a local persistence backend
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write main.ts
 *
 * Environment variables:
 *   - WS_PORT: WebSocket server port (default: 8001)
 *   - WS_HOSTNAME: Hostname to bind (default: 0.0.0.0)
 *   - SCHEMA_PATH: Path to schema module (optional)
 */

import { WebSocketServer } from "./mod.ts";
import { createLocalClient } from "../client-sdk/mod.ts";
import { Persistence } from "../persistence/mod.ts";

async function main() {
  const port = parseInt(Deno.env.get("WS_PORT") || "8001");
  const hostname = Deno.env.get("WS_HOSTNAME") || "0.0.0.0";
  const schemaPath = Deno.env.get("SCHEMA_PATH");

  console.log("🔌 b3nd WebSocket Server");
  console.log("=" + "=".repeat(39));
  console.log(`Port:     ${port}`);
  console.log(`Hostname: ${hostname}`);
  console.log(`Schema:   ${schemaPath || "(none)"}`);
  console.log("=" + "=".repeat(39) + "\n");

  // Load schema if provided
  let schema = {};
  if (schemaPath) {
    try {
      const schemaUrl = new URL(schemaPath, `file://${Deno.cwd()}/`).href;
      const schemaModule = await import(schemaUrl);
      schema = schemaModule.default || schemaModule.schema || {};
      console.log(`✓ Loaded schema with ${Object.keys(schema).length} entries`);
    } catch (error) {
      console.error(`✗ Failed to load schema: ${error}`);
      Deno.exit(1);
    }
  }

  // Create persistence instance
  const persistence = new Persistence({ schema });

  // Create local client wrapper
  const client = createLocalClient(persistence);

  // Create and start WebSocket server
  const server = new WebSocketServer({
    port,
    hostname,
    persistence: client,
  });

  try {
    await server.start();
    console.log(`✓ WebSocket server started on ws://${hostname}:${port}\n`);

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log("\n\nShutting down...");
      await server.stop();
      await client.cleanup();
      console.log("✓ Server stopped");
      Deno.exit(0);
    };

    // Listen for termination signals
    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    console.error("✗ Server error:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}
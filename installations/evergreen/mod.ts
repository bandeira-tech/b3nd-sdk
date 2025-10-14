/// <reference lib="deno.ns" />
import { createServerNode, MemoryClient, servers } from "../../sdk/src/mod.ts";
import type { Schema } from "../../sdk/src/types.ts";

const SCHEMA_MODULE = Deno.env.get("SCHEMA_MODULE") || "./example-schema.ts";
const PORT = Number(Deno.env.get("PORT") || "8080");

if (!SCHEMA_MODULE) throw new Error("SCHEMA_MODULE env var is required");

// Dynamically import schema module provided by user
const imported = await import(SCHEMA_MODULE);
const schema: Schema = imported.default as Schema;
if (!schema || typeof schema !== "object") {
  throw new Error("SCHEMA_MODULE must export default Schema object");
}

const mem = new MemoryClient({ schema });

// Build backend composition: broadcast write to Postgres only, read from Postgres
const backend = { write: mem, read: mem };

// HTTP server frontend (Hono-based)
const http = servers.httpServer();
// Expose app for user middleware: http.app.use(...)

// Create node and start
const node = createServerNode({ frontend: http, backend, schema });
node.listen(PORT);
console.log(`B3nd HTTP Node - Evergreen:${PORT}`);

/// <reference lib="deno.ns" />
import { createServerNode, servers, PostgresClient } from "../../sdk/src/mod.ts";
import type { Schema } from "../../sdk/src/types.ts";
import { createPostgresExecutor } from "./pg-executor.ts";

// Read env strictly; throw if missing to follow repo design rules
const DATABASE_URL = Deno.env.get("DATABASE_URL");
const SCHEMA_MODULE = Deno.env.get("SCHEMA_MODULE");
const PORT = Number(Deno.env.get("PORT") || "8080");

if (!DATABASE_URL) throw new Error("DATABASE_URL env var is required");
if (!SCHEMA_MODULE) throw new Error("SCHEMA_MODULE env var is required");

// Dynamically import schema module provided by user
const imported = await import(SCHEMA_MODULE);
const schema: Schema = imported.default as Schema;
if (!schema || typeof schema !== "object") {
  throw new Error("SCHEMA_MODULE must export default Schema object");
}

// Create a real executor using deno_postgres
const executor = await createPostgresExecutor(DATABASE_URL);

// Create Postgres client wired to executor
const pg = new PostgresClient({
  connection: DATABASE_URL,
  tablePrefix: "b3nd",
  schema,
  poolSize: 5,
  connectionTimeout: 10_000,
}, executor as any);

// Initialize schema on startup
await pg.initializeSchema();

// Build backend composition: broadcast write to Postgres only, read from Postgres
const backend = { write: pg, read: pg };

// HTTP server frontend (Hono-based)
const http = servers.httpServer();
// Expose app for user middleware: http.app.use(...)

// Create node and start
const node = createServerNode({ frontend: http, backend, schema });
node.listen(PORT);
console.log(`HTTP Postgres node listening on :${PORT}`);

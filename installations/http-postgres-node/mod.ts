/// <reference lib="deno.ns" />
import {
  createServerNode,
  PostgresClient,
  servers,
} from "../../sdk/src/mod.ts";
import type { Schema } from "../../sdk/src/types.ts";
import { createPostgresExecutor } from "./pg-executor.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";

const SCHEMA_MODULE = Deno.env.get("SCHEMA_MODULE") || "./example-schema.ts";
const PORT = Number(Deno.env.get("PORT") || "8080");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN") || "*";
const DATABASE_URL = Deno.env.get("DATABASE_URL");

if (!DATABASE_URL) throw new Error("DATABASE_URL env var is required");
if (!SCHEMA_MODULE) throw new Error("SCHEMA_MODULE env var is required");

// Dynamically import schema module provided by user
const imported = await import(SCHEMA_MODULE);
const schema: Schema = imported.default as Schema;
if (!schema || typeof schema !== "object") {
  throw new Error("SCHEMA_MODULE must export default Schema object");
}

// Create a real executor using Postgres
const executor = await createPostgresExecutor(DATABASE_URL);

// Create Postgres client wired to executor
const pg = new PostgresClient(
  {
    connection: DATABASE_URL,
    tablePrefix: "b3nd",
    schema,
    poolSize: 5,
    connectionTimeout: 10_000,
  },
  executor as any,
);

// Initialize schema on startup
await pg.initializeSchema();

// Build backend composition: write/read through Postgres
const backend = { write: pg, read: pg };

// Custom logger middleware with timestamp and response timing
const customLogger = async (c: any, next: any) => {
  const startTime = Date.now();
  const startDate = new Date().toISOString();
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  await next();

  const duration = Date.now() - startTime;
  const status = c.res.status;
  console.log(
    `[${startDate}] ${method} ${path} ${status} - ${duration}ms`,
  );
};

// HTTP server frontend (Hono-based)
const app = new Hono();
app.use(
  "/*",
  cors({ origin: (origin) => (CORS_ORIGIN === "*" ? origin : CORS_ORIGIN) }),
);
app.use(customLogger);

const frontend = servers.httpServer(app);
// Expose app for user middleware: frontend.app.use(...) via Hono instance if needed

// Create node and start
const node = createServerNode({ frontend, backend, schema });
node.listen(PORT);
console.log(`B3nd HTTP Postgres Node:${PORT}`);

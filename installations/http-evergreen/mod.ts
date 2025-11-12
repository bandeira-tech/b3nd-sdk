/// <reference lib="deno.ns" />
import { createServerNode, MemoryClient, servers } from "../../sdk/src/mod.ts";
import type { Schema } from "../../sdk/src/types.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";

const SCHEMA_MODULE = Deno.env.get("SCHEMA_MODULE") || "./example-schema.ts";
const PORT = Number(Deno.env.get("PORT") || "8080");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN") || "*";

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
//
const app = new Hono();
app.use(
  "/*",
  cors({ origin: (origin) => CORS_ORIGIN === "*" ? origin : CORS_ORIGIN }),
);
app.use(customLogger);

const frontend = servers.httpServer(app);
// Expose app for user middleware: http.app.use(...)

// Create node and start
const node = createServerNode({ frontend, backend, schema });
node.listen(PORT);
console.log(`B3nd HTTP Node - Evergreen:${PORT}`);

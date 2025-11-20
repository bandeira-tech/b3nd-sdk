/// <reference lib="deno.ns" />
import {
  createServerNode,
  MongoClient,
  servers,
} from "../../sdk/src/mod.ts";
import type { Schema } from "../../sdk/src/types.ts";
import { createMongoExecutor } from "./mongo-executor.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";

const SCHEMA_MODULE = Deno.env.get("SCHEMA_MODULE") || "./example-schema.ts";
const PORT = Number(Deno.env.get("PORT") || "8080");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN") || "*";
const MONGODB_URL = Deno.env.get("MONGODB_URL");
const MONGODB_DB = Deno.env.get("MONGODB_DB");
const MONGODB_COLLECTION = Deno.env.get("MONGODB_COLLECTION");

if (!MONGODB_URL) throw new Error("MONGODB_URL env var is required");
if (!MONGODB_DB) throw new Error("MONGODB_DB env var is required");
if (!MONGODB_COLLECTION) {
  throw new Error("MONGODB_COLLECTION env var is required");
}
if (!SCHEMA_MODULE) throw new Error("SCHEMA_MODULE env var is required");

// Dynamically import schema module provided by user
const imported = await import(SCHEMA_MODULE);
const schema: Schema = imported.default as Schema;
if (!schema || typeof schema !== "object") {
  throw new Error("SCHEMA_MODULE must export default Schema object");
}

// Create a real executor using MongoDB
const executor = await createMongoExecutor(
  MONGODB_URL,
  MONGODB_DB,
  MONGODB_COLLECTION,
);

// Create Mongo client wired to executor
const mongo = new MongoClient(
  {
    connectionString: MONGODB_URL,
    schema,
    collectionName: MONGODB_COLLECTION,
  },
  executor,
);

// Build backend composition: write/read through MongoDB
const backend = { write: mongo, read: mongo };

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

// Create node and start
const node = createServerNode({ frontend, backend, schema });
node.listen(PORT);
console.log(`B3nd HTTP Mongo Node:${PORT}`);


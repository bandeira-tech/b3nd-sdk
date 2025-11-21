/// <reference lib="deno.ns" />
import {
  MongoClient,
  MemoryClient,
  PostgresClient,
  createServerNode,
  parallelBroadcast,
  firstMatchSequence,
  servers,
} from "../../sdk/src/mod.ts";
import type {
  NodeProtocolInterface,
  Schema,
} from "../../sdk/src/types.ts";
import { createPostgresExecutor } from "../http-postgres/pg-executor.ts";
import { createMongoExecutor } from "../http-mongo/mongo-executor.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";

const SCHEMA_MODULE = Deno.env.get("SCHEMA_MODULE");
const PORT_VALUE = Deno.env.get("PORT");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN");
const BACKEND_URL = Deno.env.get("BACKEND_URL");

if (!BACKEND_URL) {
  throw new Error("BACKEND_URL env var is required");
}
if (!SCHEMA_MODULE) {
  throw new Error("SCHEMA_MODULE env var is required");
}
if (!CORS_ORIGIN) {
  throw new Error("CORS_ORIGIN env var is required");
}
if (!PORT_VALUE) {
  throw new Error("PORT env var is required");
}

const PORT = Number(PORT_VALUE);
if (!Number.isFinite(PORT)) {
  throw new Error("PORT env var must be a valid number");
}

// Dynamically import schema module provided by user
const imported = await import(SCHEMA_MODULE);
const schema: Schema = imported.default as Schema;
if (!schema || typeof schema !== "object") {
  throw new Error("SCHEMA_MODULE must export default Schema object");
}

// Parse BACKEND_URL into individual backend descriptors
const backendSpecs = BACKEND_URL.split(",").map((s) => s.trim()).filter(
  Boolean,
);
if (backendSpecs.length === 0) {
  throw new Error("BACKEND_URL must contain at least one backend spec");
}

const clients: NodeProtocolInterface[] = [];

for (const spec of backendSpecs) {
  if (spec.startsWith("memory://")) {
    // In-memory backend shares schema with others
    clients.push(
      new MemoryClient({
        schema,
      }),
    );
    continue;
  }

  if (spec.startsWith("postgres://")) {
    // Treat spec as full PostgreSQL connection string
    const connectionString = spec;
    const executor = await createPostgresExecutor(connectionString);

    const pg = new PostgresClient(
      {
        connection: connectionString,
        tablePrefix: "b3nd",
        schema,
        poolSize: 5,
        connectionTimeout: 10_000,
      },
      executor as any,
    );

    await pg.initializeSchema();
    clients.push(pg);
    continue;
  }

  if (spec.startsWith("mongodb://")) {
    const url = new URL(spec);
    const dbName = url.pathname.replace(/^\//, "");
    if (!dbName) {
      throw new Error(
        `MongoDB backend spec must include database in path: ${spec}`,
      );
    }
    const collectionName =
      url.searchParams.get("collection") ?? "b3nd_data";

    const executor = await createMongoExecutor(
      spec,
      dbName,
      collectionName,
    );

    const mongo = new MongoClient(
      {
        connectionString: spec,
        schema,
        collectionName,
      },
      executor,
    );

    clients.push(mongo);
    continue;
  }

  throw new Error(`Unsupported BACKEND_URL entry: ${spec}`);
}

if (clients.length === 0) {
  throw new Error("No valid BACKEND_URL entries resolved to backends");
}

// Compose multiple backends:
// - writes are broadcast to all backends
// - reads/lists/deletes consult backends in order until one succeeds
const writeBackend = parallelBroadcast(clients);
const readBackend = firstMatchSequence(clients);

const backend = {
  write: writeBackend,
  read: readBackend,
};

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
console.log(
  `B3nd Multi-Backend Node:${PORT} (BACKEND_URL=${BACKEND_URL})`,
);

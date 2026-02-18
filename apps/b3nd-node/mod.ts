/// <reference lib="deno.ns" />
import {
  createServerNode,
  createValidatedClient,
  firstMatchSequence,
  HttpClient,
  MemoryClient,
  MongoClient,
  msgSchema,
  parallelBroadcast,
  PostgresClient,
  servers,
} from "@bandeira-tech/b3nd-sdk";
import type { NodeProtocolInterface, Schema } from "@bandeira-tech/b3nd-sdk";
import { createPostgresExecutor } from "./pg-executor.ts";
import { createMongoExecutor } from "./mongo-executor.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";

// ── Phase 1: Standard node from env vars ─────────────────────────────

const SCHEMA_MODULE = Deno.env.get("SCHEMA_MODULE");
const PORT_VALUE = Deno.env.get("PORT");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN");
const BACKEND_URL = Deno.env.get("BACKEND_URL");

if (!BACKEND_URL) {
  throw new Error("BACKEND_URL env var is required");
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

// Schema: load from module if provided, otherwise accept all
let schema: Schema;
if (SCHEMA_MODULE) {
  const imported = await import(SCHEMA_MODULE);
  schema = imported.default as Schema;
  if (!schema || typeof schema !== "object") {
    throw new Error("SCHEMA_MODULE must export default Schema object");
  }
} else {
  // Permissive schema — accepts any URI pattern
  schema = new Proxy({} as Schema, {
    get: (_target, prop) => {
      if (typeof prop === "string") {
        return async () => ({ valid: true });
      }
      return undefined;
    },
    has: () => true,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => ({
      configurable: true,
      enumerable: true,
    }),
  });
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
    clients.push(
      new MemoryClient({
        schema,
      }),
    );
    continue;
  }

  if (spec.startsWith("postgresql://")) {
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
    const collectionName = url.searchParams.get("collection") ?? "b3nd_data";

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

  if (spec.startsWith("http://") || spec.startsWith("https://")) {
    const httpClient = new HttpClient({
      url: spec,
    });
    clients.push(httpClient);
    continue;
  }

  throw new Error(`Unsupported BACKEND_URL entry: ${spec}`);
}

if (clients.length === 0) {
  throw new Error("No valid BACKEND_URL entries resolved to backends");
}

// Compose multiple backends into a single validated client
const client = createValidatedClient({
  write: parallelBroadcast(clients),
  read: firstMatchSequence(clients),
  validate: msgSchema(schema),
});

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

const backendTypes = backendSpecs.map((s) => s.split("://")[0]);
const frontend = servers.httpServer(app, {
  healthMeta: { backends: backendTypes },
});

// Create server node and start
const serverNode = createServerNode({ frontend, client });
serverNode.listen(PORT);
console.log(
  `B3nd Node :${PORT} (backends=${BACKEND_URL})`,
);

// ── Phase 2: Managed mode (conditional on CONFIG_URL) ────────────────

const CONFIG_URL = Deno.env.get("CONFIG_URL");

if (CONFIG_URL) {
  const OPERATOR_KEY = Deno.env.get("OPERATOR_KEY");
  const NODE_ID = Deno.env.get("NODE_ID");
  const NODE_PRIVATE_KEY_PEM = Deno.env.get("NODE_PRIVATE_KEY_PEM");
  const NODE_ENCRYPTION_PRIVATE_KEY_HEX = Deno.env.get("NODE_ENCRYPTION_PRIVATE_KEY_HEX");
  const OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX = Deno.env.get("OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX");

  if (!OPERATOR_KEY) throw new Error("OPERATOR_KEY env var required when CONFIG_URL is set");
  if (!NODE_ID) throw new Error("NODE_ID env var required when CONFIG_URL is set");
  if (!NODE_PRIVATE_KEY_PEM) throw new Error("NODE_PRIVATE_KEY_PEM env var required when CONFIG_URL is set");

  // Dynamic imports — no cost when managed mode is not activated
  const { pemToCryptoKey } = await import("@b3nd/encrypt");
  const {
    buildClientsFromSpec,
    createConfigWatcher,
    createHeartbeatWriter,
    createMetricsCollector,
    loadConfig,
  } = await import("@b3nd/managed-node");

  const privateKey = await pemToCryptoKey(NODE_PRIVATE_KEY_PEM, "Ed25519");
  const signer = { privateKey, publicKeyHex: NODE_ID };

  // Load encryption key if provided
  let nodeEncryptionPrivateKey: CryptoKey | undefined;
  if (NODE_ENCRYPTION_PRIVATE_KEY_HEX) {
    const { decodeHex } = await import("@std/encoding/hex");
    nodeEncryptionPrivateKey = await crypto.subtle.importKey(
      "pkcs8",
      decodeHex(NODE_ENCRYPTION_PRIVATE_KEY_HEX).buffer,
      { name: "X25519", namedCurve: "X25519" },
      false,
      ["deriveBits"],
    );
  }

  console.log(`[managed] Node ID: ${NODE_ID}`);
  console.log(`[managed] Operator: ${OPERATOR_KEY}`);
  console.log(`[managed] Config URL: ${CONFIG_URL}`);

  // Config client: use the Phase 1 client directly — the node reads config
  // from a b3nd backend, and the simplest path is through its own client.
  // For self-hosting (CONFIG_URL points at this node), this avoids HTTP
  // round-trips. For remote config, add an HttpClient to BACKEND_URL.
  const configClient = client;

  // Load initial config — graceful degradation for bootstrap scenarios
  let currentConfig: import("@b3nd/managed-node/types").ManagedNodeConfig | undefined;
  try {
    const loaded = await loadConfig(configClient, OPERATOR_KEY, NODE_ID, {
      nodeEncryptionPrivateKey,
    });
    currentConfig = loaded.config;
    console.log(`[managed] Loaded config: "${currentConfig.name}" (v${currentConfig.configVersion})`);
  } catch (err) {
    console.warn(`[managed] Config not available yet: ${(err as Error).message}`);
    console.warn(`[managed] Running with Phase 1 backends; config watcher will retry`);
  }

  // If config loaded, hot-swap backends from remote config
  if (currentConfig) {
    try {
      const newClients = await buildClientsFromSpec(currentConfig.backends, schema, {
        postgres: createPostgresExecutor,
        mongo: createMongoExecutor,
      });
      const newClient = createValidatedClient({
        write: parallelBroadcast(newClients),
        read: firstMatchSequence(newClients),
        validate: msgSchema(schema),
      });
      frontend.configure({ client: newClient });
      console.log(`[managed] Backends hot-swapped from config`);
    } catch (err) {
      console.error(`[managed] Failed to build backends from config: ${(err as Error).message}`);
      console.error(`[managed] Continuing with Phase 1 backends`);
    }
  }

  // Metrics collector
  const metrics = createMetricsCollector({
    metricsClient: configClient,
    nodeId: NODE_ID,
    intervalMs: 30_000,
    signer,
    operatorEncryptionPubKeyHex: OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX,
  });

  // Heartbeat writer
  const heartbeat = createHeartbeatWriter({
    statusClient: configClient,
    nodeId: NODE_ID,
    name: currentConfig?.name ?? NODE_ID,
    port: PORT,
    intervalMs: currentConfig?.monitoring.heartbeatIntervalMs ?? 60_000,
    signer,
    operatorEncryptionPubKeyHex: OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX,
    getBackendStatuses: () =>
      (currentConfig?.backends ?? []).map((b) => ({
        type: b.type,
        status: "connected" as const,
      })),
    getMetrics: currentConfig?.monitoring.metricsEnabled ? () => metrics.snapshot() : undefined,
  });

  // Config watcher (hot-reload)
  const configWatcher = createConfigWatcher({
    configClient,
    operatorPubKeyHex: OPERATOR_KEY,
    nodeId: NODE_ID,
    intervalMs: currentConfig?.monitoring.configPollIntervalMs ?? 30_000,
    async onConfigChange(newConfig: import("@b3nd/managed-node/types").ManagedNodeConfig) {
      console.log(`[managed] Config change detected, applying...`);
      try {
        const newClients = await buildClientsFromSpec(newConfig.backends, schema, {
          postgres: createPostgresExecutor,
          mongo: createMongoExecutor,
        });
        const newClient = createValidatedClient({
          write: parallelBroadcast(newClients),
          read: firstMatchSequence(newClients),
          validate: msgSchema(schema),
        });

        const wrappedClient = newConfig.monitoring.metricsEnabled
          ? metrics.wrapClient(newClient)
          : newClient;
        frontend.configure({ client: wrappedClient });

        currentConfig = newConfig;
        console.log(`[managed] Config applied: "${newConfig.name}"`);
      } catch (err) {
        console.error(`[managed] Failed to apply config:`, err);
      }
    },
    onError(err: Error) {
      console.error(`[managed] Config poll error:`, err.message);
    },
  });

  // Start managed services
  heartbeat.start();
  if (currentConfig?.monitoring.metricsEnabled) {
    metrics.start();
  }
  configWatcher.start();

  console.log(`[managed] Managed mode active`);
}

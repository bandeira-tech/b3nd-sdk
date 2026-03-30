/// <reference lib="deno.ns" />
import { createClientFromUrl, Rig } from "@b3nd/rig";
import type { Schema } from "@bandeira-tech/b3nd-sdk/types";
import { parallelBroadcast } from "../../libs/b3nd-combinators/parallel-broadcast.ts";
import { firstMatchSequence } from "../../libs/b3nd-combinators/first-match-sequence.ts";
import firecatSchema from "@firecat/protocol";
import { createPostgresExecutor } from "./pg-executor.ts";
import { createMongoExecutor } from "./mongo-executor.ts";
import { createSqliteExecutor } from "./sqlite-executor.ts";
import { createFsExecutor } from "./fs-executor.ts";
import { createIpfsExecutor } from "./ipfs-executor.ts";
import { createS3Executor } from "./s3-executor.ts";

// ── Phase 1: Standard node from env vars ─────────────────────────────

const SCHEMA_MODULE = Deno.env.get("SCHEMA_MODULE");
const PORT_VALUE = Deno.env.get("PORT");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN");
const BACKEND_URL = Deno.env.get("BACKEND_URL");

if (!BACKEND_URL) throw new Error("BACKEND_URL env var is required");
if (!CORS_ORIGIN) throw new Error("CORS_ORIGIN env var is required");
if (!PORT_VALUE) throw new Error("PORT env var is required");

const PORT = Number(PORT_VALUE);
if (!Number.isFinite(PORT)) {
  throw new Error("PORT env var must be a valid number");
}

// Schema: load from module if provided, otherwise use Firecat protocol
let schema: Schema;
if (SCHEMA_MODULE) {
  const imported = await import(SCHEMA_MODULE);
  schema = imported.default as Schema;
  if (!schema || typeof schema !== "object") {
    throw new Error("SCHEMA_MODULE must export default Schema object");
  }
} else {
  schema = firecatSchema;
}

// Parse BACKEND_URL into individual backend specs
const backendSpecs = BACKEND_URL.split(",").map((s) => s.trim()).filter(
  Boolean,
);

// ── Build clients outside the rig — clients are pure plumbing ──

const executors = {
  postgres: createPostgresExecutor,
  mongo: (connStr: string, dbName: string, collectionName: string) =>
    createMongoExecutor(connStr, dbName, collectionName),
  sqlite: createSqliteExecutor,
  fs: createFsExecutor,
  ipfs: createIpfsExecutor,
  s3: createS3Executor,
};

const backends = await Promise.all(
  backendSpecs.map((url) => createClientFromUrl(url, { schema, executors })),
);

// Single backend → use directly; multi-backend → compose
const client = backends.length === 1
  ? backends[0]
  : {
    receive: (msg: Parameters<typeof backends[0]["receive"]>[0]) =>
      parallelBroadcast(backends).receive(msg),
    read: <T = unknown>(uri: string) =>
      firstMatchSequence(backends).read<T>(uri),
    readMulti: <T = unknown>(uris: string[]) =>
      firstMatchSequence(backends).readMulti<T>(uris),
    list: (uri: string, opts?: Parameters<typeof backends[0]["list"]>[1]) =>
      firstMatchSequence(backends).list(uri, opts),
    delete: (uri: string) => parallelBroadcast(backends).delete(uri),
    health: () => backends[0].health(),
    getSchema: () => backends[0].getSchema(),
    cleanup: () => Promise.all(backends.map((b) => b.cleanup())).then(() => {}),
  };

// ── The Rig: schema validation, events, hooks ──

const rig = await Rig.init({
  client,
  schema,
  on: {
    "receive:error": [(e) => {
      console.error(`[rig] receive failed: ${e.uri ?? "unknown"} — ${e.error}`);
    }],
    "read:error": [(e) => {
      console.error(`[rig] read failed: ${e.uri ?? "unknown"} — ${e.error}`);
    }],
  },
});

const backendTypes = backendSpecs.map((s) => s.split("://")[0]);

// The rig produces a generic fetch handler — the app owns the server.
const b3ndHandler = rig.handler({
  healthMeta: { backends: backendTypes },
});

// CORS and port binding are the app's responsibility.
const { Hono } = await import("npm:hono");
const { cors } = await import("npm:hono/cors");
const app = new Hono();
if (CORS_ORIGIN) app.use("*", cors({ origin: CORS_ORIGIN }));
app.all("/api/*", (c: any) => b3ndHandler(c.req.raw));

Deno.serve({ port: PORT }, app.fetch);

console.log(`B3nd Node :${PORT} (backends=${BACKEND_URL})`);

// ── Phase 2: Managed mode (conditional on OPERATOR_KEY) ──────────────

const OPERATOR_KEY = Deno.env.get("OPERATOR_KEY");

if (OPERATOR_KEY) {
  const NODE_PRIVATE_KEY_PEM = Deno.env.get("NODE_PRIVATE_KEY_PEM");
  const NODE_ENCRYPTION_PRIVATE_KEY_HEX = Deno.env.get(
    "NODE_ENCRYPTION_PRIVATE_KEY_HEX",
  );
  const OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX = Deno.env.get(
    "OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX",
  );

  if (!NODE_PRIVATE_KEY_PEM) {
    throw new Error(
      "NODE_PRIVATE_KEY_PEM env var required when OPERATOR_KEY is set",
    );
  }

  const { extractPublicKeyHex, pemToCryptoKey } = await import(
    "@bandeira-tech/b3nd-sdk/encrypt"
  );
  const {
    bestEffortClient,
    buildClientsFromSpec,
    createConfigWatcher,
    createHeartbeatWriter,
    createMetricsCollector,
    createModuleWatcher,
    createPeerClients,
    createUpdateChecker,
    loadConfig,
    loadSchemaModule,
  } = await import("@b3nd/managed-node");
  const {
    createValidatedClient,
    parallelBroadcast,
    firstMatchSequence,
    msgSchema,
  } = await import("@bandeira-tech/b3nd-sdk");

  // Derive node identity from PEM
  const privateKey = await pemToCryptoKey(
    NODE_PRIVATE_KEY_PEM,
    "Ed25519",
    true,
  );
  const nodeId = await extractPublicKeyHex(privateKey);

  // Load encryption key if provided
  let nodeEncryptionPrivateKey: CryptoKey | undefined;
  let encPubHex: string | undefined;
  if (NODE_ENCRYPTION_PRIVATE_KEY_HEX) {
    const { decodeHex, encodeHex } = await import("@std/encoding/hex");
    nodeEncryptionPrivateKey = await crypto.subtle.importKey(
      "pkcs8",
      decodeHex(NODE_ENCRYPTION_PRIVATE_KEY_HEX).buffer,
      { name: "X25519", namedCurve: "X25519" },
      true,
      ["deriveBits"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", nodeEncryptionPrivateKey);
    const pub = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, key_ops: [] },
      { name: "X25519", namedCurve: "X25519" },
      true,
      [],
    );
    encPubHex = encodeHex(
      new Uint8Array(await crypto.subtle.exportKey("raw", pub)),
    );
  }

  // Set the node identity on the rig
  rig.identity = await Identity.fromPem(
    NODE_PRIVATE_KEY_PEM,
    nodeId,
    NODE_ENCRYPTION_PRIVATE_KEY_HEX,
    encPubHex,
  );

  const signer = rig.identity.signer;

  console.log(`[managed] Node ID: ${nodeId} (derived from PEM)`);
  console.log(`[managed] Operator: ${OPERATOR_KEY}`);

  // Rig satisfies NodeProtocolInterface — pass it directly so
  // hooks/events/observe fire for all operations.
  const configClient = rig;

  // Load initial config
  let currentConfig:
    | import("@b3nd/managed-node/types").ManagedNodeConfig
    | undefined;
  try {
    const loaded = await loadConfig(configClient, OPERATOR_KEY, nodeId, {
      nodeEncryptionPrivateKey,
    });
    currentConfig = loaded.config;
    console.log(
      `[managed] Loaded config: "${currentConfig.name}" (v${currentConfig.configVersion})`,
    );
  } catch (err) {
    console.warn(
      `[managed] Config not available yet: ${(err as Error).message}`,
    );
    console.warn(
      `[managed] Running with Phase 1 backends; config watcher will retry`,
    );
  }

  let activeSchema = schema;
  if (currentConfig?.schemaModuleUrl) {
    try {
      activeSchema = await loadSchemaModule(currentConfig.schemaModuleUrl);
      console.log(
        `[managed] Schema loaded from ${currentConfig.schemaModuleUrl}`,
      );
    } catch (err) {
      console.error(
        `[managed] Failed to load schema module: ${(err as Error).message}`,
      );
    }
  }

  async function buildManagedClient(
    config: import("@b3nd/managed-node/types").ManagedNodeConfig,
    schemaToUse: Schema,
  ) {
    const localClients = await buildClientsFromSpec(
      config.backends,
      schemaToUse,
      {
        postgres: createPostgresExecutor,
        mongo: createMongoExecutor,
        sqlite: createSqliteExecutor,
        fs: createFsExecutor,
        ipfs: createIpfsExecutor,
        s3: createS3Executor,
      },
    );
    const { pushClients, pullClients } = createPeerClients(config.peers ?? []);
    return createValidatedClient({
      write: parallelBroadcast([
        ...localClients,
        ...pushClients.map(bestEffortClient),
      ]),
      read: firstMatchSequence([...localClients, ...pullClients]),
      validate: msgSchema(schemaToUse),
    });
  }

  if (currentConfig) {
    try {
      const _newClient = await buildManagedClient(currentConfig, activeSchema);
      console.log(`[managed] Backends ready from config`);
    } catch (err) {
      console.error(
        `[managed] Failed to build backends from config: ${
          (err as Error).message
        }`,
      );
    }
  }

  const metrics = createMetricsCollector({
    metricsClient: configClient,
    nodeId,
    intervalMs: 30_000,
    signer,
    operatorEncryptionPubKeyHex: OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX,
  });

  const heartbeat = createHeartbeatWriter({
    statusClient: configClient,
    nodeId,
    name: currentConfig?.name ?? nodeId,
    port: PORT,
    intervalMs: currentConfig?.monitoring.heartbeatIntervalMs ?? 60_000,
    signer,
    operatorEncryptionPubKeyHex: OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX,
    getBackendStatuses: () =>
      (currentConfig?.backends ?? []).map((b) => ({
        type: b.type,
        status: "connected" as const,
      })),
    getMetrics: currentConfig?.monitoring.metricsEnabled
      ? () => metrics.snapshot()
      : undefined,
  });

  const moduleWatcher = createModuleWatcher({
    currentUrl: currentConfig?.schemaModuleUrl,
    intervalMs: 60_000,
    async onModuleChange(newSchema, url) {
      console.log(`[managed] Schema module changed: ${url}`);
      activeSchema = newSchema;
    },
    onError(err) {
      console.error(`[managed] Schema module error:`, err.message);
    },
  });

  const configWatcher = createConfigWatcher({
    configClient,
    operatorPubKeyHex: OPERATOR_KEY,
    nodeId,
    intervalMs: currentConfig?.monitoring.configPollIntervalMs ?? 30_000,
    async onConfigChange(
      newConfig: import("@b3nd/managed-node/types").ManagedNodeConfig,
    ) {
      console.log(`[managed] Config change detected, applying...`);
      try {
        moduleWatcher.setUrl(newConfig.schemaModuleUrl);
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

  const updateChecker = createUpdateChecker({
    client: configClient,
    operatorPubKeyHex: OPERATOR_KEY,
    nodeId,
    intervalMs: currentConfig?.monitoring.configPollIntervalMs ?? 60_000,
    async onUpdateAvailable(update) {
      console.log(
        `[managed] Update available: v${update.version} at ${update.moduleUrl}`,
      );
    },
    onError(err) {
      console.error(`[managed] Update check error:`, err.message);
    },
    nodeEncryptionPrivateKey,
  });

  heartbeat.start();
  if (currentConfig?.monitoring.metricsEnabled) metrics.start();
  moduleWatcher.start();
  configWatcher.start();
  updateChecker.start();

  console.log(`[managed] Managed mode active`);
}

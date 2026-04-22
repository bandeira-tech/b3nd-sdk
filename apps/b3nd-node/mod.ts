/// <reference lib="deno.ns" />
import { connection, createClientFromUrl, httpApi, Rig } from "@b3nd/rig";
import type { Program } from "@bandeira-tech/b3nd-sdk/types";
import { flood, peer } from "@bandeira-tech/b3nd-sdk/network";
import { createPostgresExecutor } from "./pg-executor.ts";
import { createMongoExecutor } from "./mongo-executor.ts";
import { createSqliteExecutor } from "./sqlite-executor.ts";
import { createFsExecutor } from "./fs-executor.ts";
import { createIpfsExecutor } from "./ipfs-executor.ts";
import { createS3Executor } from "./s3-executor.ts";

// ── Phase 1: Standard node from env vars ─────────────────────────────

const PROGRAMS_MODULE = Deno.env.get("PROGRAMS_MODULE");
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

// Programs: load from module if provided, otherwise run open (no validation).
// A programs module exports `{ default: Record<string, Program> }` where each
// key is a URI prefix and each value classifies messages by protocol code.
let programs: Record<string, Program> | undefined;
if (PROGRAMS_MODULE) {
  const imported = await import(PROGRAMS_MODULE);
  programs = imported.default as Record<string, Program>;
  if (!programs || typeof programs !== "object") {
    throw new Error(
      "PROGRAMS_MODULE must export default Record<string, Program>",
    );
  }
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
  backendSpecs.map((url) => createClientFromUrl(url, { executors })),
);

// Single backend → use directly; multi-backend → compose via flood
// (broadcast write, first-match read).
const client = backends.length === 1
  ? backends[0]
  : flood(backends.map((b, i) => peer(b, { id: `local-${i}` })));

// ── The Rig: programs classify messages, events observe, hooks audit ──

const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  ...(programs ? { programs } : {}),
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

// httpApi() is a standalone function — the rig stays pure, transport is external.
const b3ndHandler = httpApi(rig, {
  statusMeta: { backends: backendTypes },
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
  const { Identity } = await import("@b3nd/rig");
  const {
    createConfigWatcher,
    createHeartbeatWriter,
    createMetricsCollector,
    createUpdateChecker,
    loadConfig,
  } = await import("@b3nd/managed-node");
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

  // Build the node identity (separate from the rig — rig is pure orchestration)
  const nodeIdentity = await Identity.fromPem(
    NODE_PRIVATE_KEY_PEM,
    nodeId,
    NODE_ENCRYPTION_PRIVATE_KEY_HEX,
    encPubHex,
  );

  const signer = nodeIdentity.signer;

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

  // A managed rebuild of the serving rig from the config's backends +
  // peers lives in a future PR — until then Phase 2 only drives the
  // heartbeat / metrics / config watcher side-channels using the Phase 1
  // rig as its client. Drop any prior `buildManagedClient` scaffolding.

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
  configWatcher.start();
  updateChecker.start();

  console.log(`[managed] Managed mode active`);
}

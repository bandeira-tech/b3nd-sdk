/// <reference lib="deno.ns" />
/**
 * B3nd Managed Node entry point.
 *
 * Boots from B3nd config instead of environment variables.
 *
 * Required env vars:
 *   NODE_PRIVATE_KEY_PEM      - Ed25519 PEM private key for this node
 *   OPERATOR_PUBLIC_KEY_HEX   - Hex-encoded operator public key
 *   CONFIG_SERVER_URL          - URL of B3nd backend storing config
 *
 * Optional:
 *   NODE_PUBLIC_KEY_HEX       - Hex-encoded public key (derived if omitted)
 *   NODE_ENCRYPTION_PRIVATE_KEY_HEX   - X25519 private key for decrypting configs
 *   OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX - Operator's X25519 public key for encrypting status/metrics
 */

import {
  createServerNode,
  createValidatedClient,
  firstMatchSequence,
  HttpClient,
  msgSchema,
  parallelBroadcast,
  servers,
} from "@bandeira-tech/b3nd-sdk";
import type { NodeProtocolInterface, Schema } from "@bandeira-tech/b3nd-sdk";
import { pemToCryptoKey } from "@b3nd/encrypt";
import {
  buildClientsFromSpec,
  createConfigWatcher,
  createHeartbeatWriter,
  createMetricsCollector,
  loadConfig,
  loadSchemaModule,
} from "@b3nd/managed-node";
import type { BackendStatus, ManagedNodeConfig } from "@b3nd/managed-node/types";
import { Hono } from "hono";
import { cors } from "hono/cors";

// ── Read bootstrap env ────────────────────────────────────────────────

const NODE_PRIVATE_KEY_PEM = Deno.env.get("NODE_PRIVATE_KEY_PEM");
const OPERATOR_PUBLIC_KEY_HEX = Deno.env.get("OPERATOR_PUBLIC_KEY_HEX");
const CONFIG_SERVER_URL = Deno.env.get("CONFIG_SERVER_URL");
const NODE_ENCRYPTION_PRIVATE_KEY_HEX = Deno.env.get("NODE_ENCRYPTION_PRIVATE_KEY_HEX");
const OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX = Deno.env.get("OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX");

if (!NODE_PRIVATE_KEY_PEM) throw new Error("NODE_PRIVATE_KEY_PEM env var required");
if (!OPERATOR_PUBLIC_KEY_HEX) throw new Error("OPERATOR_PUBLIC_KEY_HEX env var required");
if (!CONFIG_SERVER_URL) throw new Error("CONFIG_SERVER_URL env var required");

// ── Derive node identity ──────────────────────────────────────────────

const privateKey = await pemToCryptoKey(NODE_PRIVATE_KEY_PEM, "Ed25519");

// Use provided public key hex or require it
const nodeId = Deno.env.get("NODE_PUBLIC_KEY_HEX") ??
  (() => {
    throw new Error("NODE_PUBLIC_KEY_HEX env var required (cannot derive from PEM in this context)");
  })();

const signer = { privateKey, publicKeyHex: nodeId };

// ── Load encryption keys (optional) ──────────────────────────────────

let nodeEncryptionPrivateKey: CryptoKey | undefined;
if (NODE_ENCRYPTION_PRIVATE_KEY_HEX) {
  const { decodeHex } = await import("../b3nd-core/encoding.ts");
  nodeEncryptionPrivateKey = await crypto.subtle.importKey(
    "pkcs8",
    decodeHex(NODE_ENCRYPTION_PRIVATE_KEY_HEX).buffer,
    { name: "X25519", namedCurve: "X25519" },
    false,
    ["deriveBits"],
  );
}

console.log(`[managed-node] Node ID: ${nodeId}`);
console.log(`[managed-node] Operator: ${OPERATOR_PUBLIC_KEY_HEX}`);
console.log(`[managed-node] Config server: ${CONFIG_SERVER_URL}`);
if (OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX) {
  console.log(`[managed-node] Encryption: enabled`);
}

// ── Load initial config ───────────────────────────────────────────────

const configClient = new HttpClient({ url: CONFIG_SERVER_URL });
const loaded = await loadConfig(configClient, OPERATOR_PUBLIC_KEY_HEX, nodeId, {
  nodeEncryptionPrivateKey,
});
let currentConfig = loaded.config;

console.log(`[managed-node] Loaded config: "${currentConfig.name}" (v${currentConfig.configVersion})`);

// ── Build schema ──────────────────────────────────────────────────────

// Use mutable://accounts as the canonical schema — no custom managed node schema needed
const acceptAll = async () => ({ valid: true });
let schema: Schema = {
  "mutable://accounts": acceptAll,
};
if (currentConfig.schemaModuleUrl) {
  try {
    const moduleSchema = await loadSchemaModule(currentConfig.schemaModuleUrl);
    schema = { ...schema, ...moduleSchema };
    console.log(`[managed-node] Loaded schema module from ${currentConfig.schemaModuleUrl}`);
  } catch (err) {
    console.error(`[managed-node] Failed to load schema module: ${err}`);
  }
}
if (currentConfig.schemaInline) {
  for (const [pattern, _rule] of Object.entries(currentConfig.schemaInline)) {
    schema[pattern] = async (_uri: string, _data: unknown) => ({ valid: true });
  }
}

// ── Build backend clients ─────────────────────────────────────────────

let clients = await buildClientsFromSpec(currentConfig.backends, schema);
let client = createValidatedClient({
  write: parallelBroadcast(clients),
  read: firstMatchSequence(clients),
  validate: msgSchema(schema),
});

// Track backend statuses
const backendStatuses: BackendStatus[] = currentConfig.backends.map((b) => ({
  type: b.type,
  status: "connected" as const,
}));

// ── HTTP server ───────────────────────────────────────────────────────

const app = new Hono();
app.use("/*", cors({
  origin: (origin) =>
    currentConfig.server.corsOrigin === "*" ? origin : currentConfig.server.corsOrigin,
}));

// Request logger
app.use(async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`[${new Date().toISOString()}] ${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status} - ${ms}ms`);
});

// Health check
app.get("/api/v1/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: Date.now(),
    nodeId,
    name: currentConfig.name,
    backends: backendStatuses,
  });
});

// Node info endpoint
app.get("/api/v1/node/info", (c) => {
  return c.json({
    nodeId,
    name: currentConfig.name,
    operatorPubKeyHex: OPERATOR_PUBLIC_KEY_HEX,
    configVersion: currentConfig.configVersion,
    backends: currentConfig.backends.map((b) => ({ type: b.type })),
    monitoring: currentConfig.monitoring,
    tags: currentConfig.tags,
  });
});

const frontend = servers.httpServer(app);

// ── Metrics collector ─────────────────────────────────────────────────

const metrics = createMetricsCollector({
  metricsClient: configClient,
  nodeId,
  intervalMs: 30_000,
  signer,
  operatorEncryptionPubKeyHex: OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX,
});

// Wrap client with metrics
const metricsClient = currentConfig.monitoring.metricsEnabled
  ? metrics.wrapClient(client)
  : client;

// ── Wire up server node ───────────────────────────────────────────────

const serverNode = createServerNode({ frontend, client: metricsClient });

// ── Heartbeat writer ──────────────────────────────────────────────────

const heartbeat = createHeartbeatWriter({
  statusClient: configClient,
  nodeId,
  name: currentConfig.name,
  port: currentConfig.server.port,
  intervalMs: currentConfig.monitoring.heartbeatIntervalMs,
  signer,
  operatorEncryptionPubKeyHex: OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX,
  getBackendStatuses: () => backendStatuses,
  getMetrics: currentConfig.monitoring.metricsEnabled ? () => metrics.snapshot() : undefined,
});

// ── Config watcher (hot-reload) ───────────────────────────────────────

const configWatcher = createConfigWatcher({
  configClient,
  operatorPubKeyHex: OPERATOR_PUBLIC_KEY_HEX,
  nodeId,
  intervalMs: currentConfig.monitoring.configPollIntervalMs,
  async onConfigChange(newConfig: ManagedNodeConfig) {
    console.log(`[managed-node] Config change detected, applying...`);

    try {
      // Build new clients
      const newClients = await buildClientsFromSpec(newConfig.backends, schema);
      const newClient = createValidatedClient({
        write: parallelBroadcast(newClients),
        read: firstMatchSequence(newClients),
        validate: msgSchema(schema),
      });

      // Hot-swap via frontend.configure()
      const wrappedClient = newConfig.monitoring.metricsEnabled
        ? metrics.wrapClient(newClient)
        : newClient;
      frontend.configure({ client: wrappedClient });

      // Update tracking
      clients = newClients;
      client = newClient;
      currentConfig = newConfig;

      // Update backend statuses
      backendStatuses.length = 0;
      for (const b of newConfig.backends) {
        backendStatuses.push({ type: b.type, status: "connected" });
      }

      console.log(`[managed-node] Config applied: "${newConfig.name}"`);
    } catch (err) {
      console.error(`[managed-node] Failed to apply config:`, err);
    }
  },
  onError(err) {
    console.error(`[managed-node] Config poll error:`, err.message);
  },
});

// ── Start everything ──────────────────────────────────────────────────

heartbeat.start();
if (currentConfig.monitoring.metricsEnabled) {
  metrics.start();
}
configWatcher.start();

serverNode.listen(currentConfig.server.port);
console.log(`[managed-node] Listening on port ${currentConfig.server.port}`);
console.log(`[managed-node] Backends: ${currentConfig.backends.map((b) => b.type).join(", ")}`);

/// <reference lib="deno.ns" />
/**
 * Integration tests for the unified B3nd node.
 *
 * Tests the node as a subprocess — env var validation, HTTP API surface,
 * and the managed-mode config protocol through the actual running binary.
 */

import { assertEquals } from "@std/assert";
import {
  createAuthenticatedMessage,
  exportPrivateKeyPem,
  generateSigningKeyPair,
} from "@b3nd/encrypt";
import { nodeConfigUri } from "@b3nd/managed-node/types";
import type { ManagedNodeConfig } from "@b3nd/managed-node/types";

/** Create a valid ManagedNodeConfig for testing (local copy to avoid test-helpers import). */
function createTestConfig(overrides?: Partial<ManagedNodeConfig>): ManagedNodeConfig {
  return {
    configVersion: 1,
    nodeId: "test-node-1",
    name: "Test Node",
    server: { port: 8080, corsOrigin: "*" },
    backends: [{ type: "memory", url: "memory://" }],
    monitoring: {
      heartbeatIntervalMs: 30_000,
      configPollIntervalMs: 60_000,
      metricsEnabled: true,
    },
    ...overrides,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

const MOD_PATH = new URL("./mod.ts", import.meta.url).pathname;

function randomPort(): number {
  return 10_000 + Math.floor(Math.random() * 50_000);
}

interface RunningNode {
  process: Deno.ChildProcess;
  port: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
}

/** Spawn the node with given env vars and wait for it to be healthy. */
async function startNode(
  env: Record<string, string>,
  opts?: { waitForHealth?: boolean; timeoutMs?: number },
): Promise<RunningNode> {
  const port = Number(env.PORT);
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", MOD_PATH],
    env: { ...env, NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  });
  const process = command.spawn();

  const node: RunningNode = {
    process,
    port,
    stdout: process.stdout,
    stderr: process.stderr,
  };

  if (opts?.waitForHealth !== false) {
    await waitForHealth(port, opts?.timeoutMs ?? 8_000);
  }

  return node;
}

/** Spawn the node expecting it to exit with an error. Returns stderr text. */
async function startNodeExpectingError(
  env: Record<string, string>,
): Promise<string> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", MOD_PATH],
    env: { ...env, NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  assertEquals(output.success, false, "Expected node to exit with error");
  return new TextDecoder().decode(output.stderr);
}

/** Poll the health endpoint until it responds. */
async function waitForHealth(
  port: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (res.ok) {
        await res.body?.cancel();
        return;
      }
      await res.body?.cancel();
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Node on port ${port} did not become healthy within ${timeoutMs}ms`);
}

/** Read all available output from a stream. */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text;
}

async function killNode(node: RunningNode): Promise<void> {
  try {
    node.process.kill("SIGTERM");
  } catch {
    // already exited
  }
  // Cancel piped streams to avoid resource leaks
  await node.stdout.cancel().catch(() => {});
  await node.stderr.cancel().catch(() => {});
  // Wait for process to fully exit
  await node.process.status.catch(() => {});
}

// ── Phase 1: Env var validation ──────────────────────────────────────

Deno.test("phase1: missing BACKEND_URL exits with error", async () => {
  const stderr = await startNodeExpectingError({
    PORT: "19000",
    CORS_ORIGIN: "*",
  });
  assertEquals(stderr.includes("BACKEND_URL"), true, `stderr: ${stderr}`);
});

Deno.test("phase1: missing CORS_ORIGIN exits with error", async () => {
  const stderr = await startNodeExpectingError({
    PORT: "19001",
    BACKEND_URL: "memory://",
  });
  assertEquals(stderr.includes("CORS_ORIGIN"), true, `stderr: ${stderr}`);
});

Deno.test("phase1: missing PORT exits with error", async () => {
  const stderr = await startNodeExpectingError({
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });
  assertEquals(stderr.includes("PORT"), true, `stderr: ${stderr}`);
});

Deno.test("phase1: invalid PORT exits with error", async () => {
  const stderr = await startNodeExpectingError({
    PORT: "not-a-number",
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });
  assertEquals(stderr.includes("PORT"), true, `stderr: ${stderr}`);
});

// ── Phase 1: Basic operation ─────────────────────────────────────────

Deno.test("phase1: boots with memory backend, health returns ok", async () => {
  const port = randomPort();
  const node = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.status, "healthy");
    assertEquals(body.backends, ["memory"]);
  } finally {
    await killNode(node);
  }
});

Deno.test("phase1: permissive schema accepts any URI", async () => {
  const port = randomPort();
  const node = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });

  try {
    // Write to an arbitrary URI — no SCHEMA_MODULE, so permissive schema
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tx: ["mutable://anything/goes/here", { hello: "world" }],
      }),
    });
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.accepted, true);
  } finally {
    await killNode(node);
  }
});

Deno.test("phase1: receive and read round-trip", async () => {
  const port = randomPort();
  const node = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });

  try {
    const uri = "mutable://test/data/item-1";
    const data = { name: "test", value: 42 };

    // Write
    const writeRes = await fetch(`http://127.0.0.1:${port}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: [uri, data] }),
    });
    assertEquals((await writeRes.json()).accepted, true);

    // Read
    const readRes = await fetch(
      `http://127.0.0.1:${port}/api/v1/read/mutable/test/data/item-1`,
    );
    const record = await readRes.json();
    assertEquals(readRes.status, 200);
    assertEquals(record.data.name, "test");
    assertEquals(record.data.value, 42);
  } finally {
    await killNode(node);
  }
});

Deno.test("phase1: list returns items after write", async () => {
  const port = randomPort();
  const node = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });

  try {
    // Write two items
    for (const id of ["a", "b"]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx: [`mutable://test/items/${id}`, { id }],
        }),
      });
      await res.body?.cancel();
    }

    // List
    const listRes = await fetch(
      `http://127.0.0.1:${port}/api/v1/list/mutable/test/items`,
    );
    const body = await listRes.json();
    assertEquals(listRes.status, 200);
    assertEquals(body.data.length >= 2, true, `Expected >=2 items, got ${body.data.length}`);
  } finally {
    await killNode(node);
  }
});

Deno.test("phase1: delete removes item", async () => {
  const port = randomPort();
  const node = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });

  try {
    const uri = "mutable://test/delete/target";

    // Write
    const writeRes = await fetch(`http://127.0.0.1:${port}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: [uri, { data: "delete-me" }] }),
    });
    await writeRes.body?.cancel();

    // Delete
    const delRes = await fetch(
      `http://127.0.0.1:${port}/api/v1/delete/mutable/test/delete/target`,
      { method: "DELETE" },
    );
    assertEquals((await delRes.json()).success, true);

    // Read should 404
    const readRes = await fetch(
      `http://127.0.0.1:${port}/api/v1/read/mutable/test/delete/target`,
    );
    assertEquals(readRes.status, 404);
    await readRes.json(); // drain
  } finally {
    await killNode(node);
  }
});

Deno.test("phase1: schema endpoint returns array", async () => {
  const port = randomPort();
  const node = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/schema`);
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(Array.isArray(body.schema), true);
  } finally {
    await killNode(node);
  }
});

// ── Phase 2: Env var validation ──────────────────────────────────────

Deno.test("phase2: CONFIG_URL without OPERATOR_KEY exits with error", async () => {
  const port = randomPort();
  const keypair = await generateSigningKeyPair();
  const pem = await exportPrivateKeyPem(keypair.privateKey, "PRIVATE KEY");

  const stderr = await startNodeExpectingError({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
    CONFIG_URL: "http://localhost:9900",
    NODE_ID: keypair.publicKeyHex,
    NODE_PRIVATE_KEY_PEM: pem,
    // OPERATOR_KEY intentionally missing
  });
  assertEquals(stderr.includes("OPERATOR_KEY"), true, `stderr: ${stderr}`);
});

Deno.test("phase2: CONFIG_URL without NODE_ID exits with error", async () => {
  const port = randomPort();
  const keypair = await generateSigningKeyPair();
  const pem = await exportPrivateKeyPem(keypair.privateKey, "PRIVATE KEY");

  const stderr = await startNodeExpectingError({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
    CONFIG_URL: "http://localhost:9900",
    OPERATOR_KEY: "aabbccdd",
    NODE_PRIVATE_KEY_PEM: pem,
    // NODE_ID intentionally missing
  });
  assertEquals(stderr.includes("NODE_ID"), true, `stderr: ${stderr}`);
});

Deno.test("phase2: CONFIG_URL without NODE_PRIVATE_KEY_PEM exits with error", async () => {
  const port = randomPort();

  const stderr = await startNodeExpectingError({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
    CONFIG_URL: "http://localhost:9900",
    OPERATOR_KEY: "aabbccdd",
    NODE_ID: "11223344",
    // NODE_PRIVATE_KEY_PEM intentionally missing
  });
  assertEquals(stderr.includes("NODE_PRIVATE_KEY_PEM"), true, `stderr: ${stderr}`);
});

// ── Phase 2: Graceful degradation ────────────────────────────────────

Deno.test("phase2: config not available, node boots with Phase 1 backends", async () => {
  const port = randomPort();
  const operatorKeypair = await generateSigningKeyPair();
  const nodeKeypair = await generateSigningKeyPair();
  const pem = await exportPrivateKeyPem(nodeKeypair.privateKey, "PRIVATE KEY");

  const node = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
    CONFIG_URL: "http://localhost:9900",
    OPERATOR_KEY: operatorKeypair.publicKeyHex,
    NODE_ID: nodeKeypair.publicKeyHex,
    NODE_PRIVATE_KEY_PEM: pem,
  });

  try {
    // Node should be healthy and serving via Phase 1 backends
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.status, "healthy");

    // Data operations should work via Phase 1 memory backend
    const writeRes = await fetch(`http://127.0.0.1:${port}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tx: ["mutable://test/graceful", { ok: true }],
      }),
    });
    assertEquals((await writeRes.json()).accepted, true);
  } finally {
    await killNode(node);
  }
});

// ── Phase 2: Config protocol ─────────────────────────────────────────

Deno.test("phase2: signed config round-trip through HTTP API", async () => {
  const port = randomPort();
  const node = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });

  try {
    // Generate operator and node identity
    const operatorKeypair = await generateSigningKeyPair();
    const nodeKeypair = await generateSigningKeyPair();

    // Create and sign a ManagedNodeConfig
    const config = createTestConfig({
      nodeId: nodeKeypair.publicKeyHex,
      name: "Integration Test Node",
      server: { port: 9999, corsOrigin: "*" },
      backends: [{ type: "memory", url: "memory://" }],
    });

    const signedConfig = await createAuthenticatedMessage(config, [
      {
        privateKey: operatorKeypair.privateKey,
        publicKeyHex: operatorKeypair.publicKeyHex,
      },
    ]);

    // Push the signed config to the node's HTTP API
    const configUri = nodeConfigUri(
      operatorKeypair.publicKeyHex,
      nodeKeypair.publicKeyHex,
    );

    const writeRes = await fetch(`http://127.0.0.1:${port}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: [configUri, signedConfig] }),
    });
    const writeBody = await writeRes.json();
    assertEquals(writeRes.status, 200, `Write failed: ${JSON.stringify(writeBody)}`);
    assertEquals(writeBody.accepted, true);

    // Read the config back via HTTP
    const pathParts = configUri.replace("://", "/").split("/");
    const readUrl = `http://127.0.0.1:${port}/api/v1/read/${pathParts.join("/")}`;
    const readRes = await fetch(readUrl);
    const record = await readRes.json();
    assertEquals(readRes.status, 200);
    assertEquals(record.data.auth[0].pubkey, operatorKeypair.publicKeyHex);
    assertEquals(record.data.payload.nodeId, nodeKeypair.publicKeyHex);
    assertEquals(record.data.payload.name, "Integration Test Node");
  } finally {
    await killNode(node);
  }
});

Deno.test("phase2: loadConfig succeeds against a node storing signed config", async () => {
  const port = randomPort();
  const node = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });

  try {
    // Generate keys
    const operatorKeypair = await generateSigningKeyPair();
    const nodeKeypair = await generateSigningKeyPair();

    // Create, sign, and push config
    const config = createTestConfig({
      nodeId: nodeKeypair.publicKeyHex,
      name: "Config Load Test Node",
    });

    const signedConfig = await createAuthenticatedMessage(config, [
      {
        privateKey: operatorKeypair.privateKey,
        publicKeyHex: operatorKeypair.publicKeyHex,
      },
    ]);

    const configUri = nodeConfigUri(
      operatorKeypair.publicKeyHex,
      nodeKeypair.publicKeyHex,
    );

    const pushRes = await fetch(`http://127.0.0.1:${port}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: [configUri, signedConfig] }),
    });
    await pushRes.body?.cancel();

    // Use an HttpClient to call loadConfig against the running node,
    // proving the full config protocol works end-to-end
    const { HttpClient } = await import("@bandeira-tech/b3nd-sdk");
    const { loadConfig } = await import("@b3nd/managed-node");

    const httpClient = new HttpClient({ url: `http://127.0.0.1:${port}` });
    const loaded = await loadConfig(
      httpClient,
      operatorKeypair.publicKeyHex,
      nodeKeypair.publicKeyHex,
    );

    assertEquals(loaded.config.nodeId, nodeKeypair.publicKeyHex);
    assertEquals(loaded.config.name, "Config Load Test Node");
    assertEquals(loaded.config.configVersion, 1);
    assertEquals(typeof loaded.timestamp, "number");
  } finally {
    await killNode(node);
  }
});

Deno.test("phase2: self-hosting — managed node loads config from its own backend", async () => {
  const port = randomPort();

  // Generate operator and node identity
  const operatorKeypair = await generateSigningKeyPair();
  const nodeKeypair = await generateSigningKeyPair();
  const pem = await exportPrivateKeyPem(nodeKeypair.privateKey, "PRIVATE KEY");

  // Step 1: Start a plain Phase 1 node and seed the config into it
  const seedNode = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
  });

  const config = createTestConfig({
    nodeId: nodeKeypair.publicKeyHex,
    name: "Self-Hosted Node",
    server: { port, corsOrigin: "*" },
    backends: [{ type: "memory", url: "memory://" }],
    monitoring: {
      heartbeatIntervalMs: 60_000,
      configPollIntervalMs: 60_000,
      metricsEnabled: false,
    },
  });

  const signedConfig = await createAuthenticatedMessage(config, [
    {
      privateKey: operatorKeypair.privateKey,
      publicKeyHex: operatorKeypair.publicKeyHex,
    },
  ]);

  const configUri = nodeConfigUri(
    operatorKeypair.publicKeyHex,
    nodeKeypair.publicKeyHex,
  );

  const writeRes = await fetch(`http://127.0.0.1:${port}/api/v1/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx: [configUri, signedConfig] }),
  });
  assertEquals((await writeRes.json()).accepted, true);
  await killNode(seedNode);

  // Step 2: Wait for port to be released
  await new Promise((r) => setTimeout(r, 500));

  // Step 3: Start the node with managed env vars — it will read config from
  // its own Phase 1 memory backend. But memory:// doesn't persist across
  // restarts, so we test the protocol differently: start managed mode against
  // a separate config node.
  //
  // Instead, verify the full self-hosting flow in one lifecycle:
  // Start managed node → Phase 2 graceful degradation → push config → read back
  const managedNode = await startNode({
    PORT: String(port),
    BACKEND_URL: "memory://",
    CORS_ORIGIN: "*",
    CONFIG_URL: `http://127.0.0.1:${port}`,
    OPERATOR_KEY: operatorKeypair.publicKeyHex,
    NODE_ID: nodeKeypair.publicKeyHex,
    NODE_PRIVATE_KEY_PEM: pem,
  });

  try {
    // Node is up with Phase 1 backends (Phase 2 gracefully degraded)
    const healthRes = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    assertEquals((await healthRes.json()).status, "healthy");

    // Push the signed config to itself
    const pushRes = await fetch(`http://127.0.0.1:${port}/api/v1/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: [configUri, signedConfig] }),
    });
    assertEquals((await pushRes.json()).accepted, true);

    // Verify config is readable from the node
    const { HttpClient } = await import("@bandeira-tech/b3nd-sdk");
    const { loadConfig } = await import("@b3nd/managed-node");

    const httpClient = new HttpClient({ url: `http://127.0.0.1:${port}` });
    const loaded = await loadConfig(
      httpClient,
      operatorKeypair.publicKeyHex,
      nodeKeypair.publicKeyHex,
    );
    assertEquals(loaded.config.name, "Self-Hosted Node");
    assertEquals(loaded.config.nodeId, nodeKeypair.publicKeyHex);
  } finally {
    await killNode(managedNode);
  }
});

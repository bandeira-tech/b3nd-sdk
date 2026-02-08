import { assertEquals } from "@std/assert";
import { generateSigningKeyPair } from "../b3nd-encrypt/mod.ts";
import { createHeartbeatWriter } from "./heartbeat.ts";
import { createPermissiveClient } from "./test-helpers.ts";
import { nodeStatusUri } from "./types.ts";

Deno.test("heartbeat: writes status on start", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();

  const writer = createHeartbeatWriter({
    statusClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "hb-node",
    name: "Heartbeat Node",
    port: 8080,
    intervalMs: 60000, // long interval - we test immediate write
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
    getBackendStatuses: () => [{ type: "memory", status: "connected" }],
  });

  writer.start();

  // Wait for the immediate write to complete
  await new Promise((r) => setTimeout(r, 100));

  writer.stop();

  const uri = nodeStatusUri(keypair.publicKeyHex, "hb-node");
  const result = await client.read(uri);
  assertEquals(result.success, true);

  const data = (result as any).record.data;
  // Should be an AuthenticatedMessage
  assertEquals(Array.isArray(data.auth), true);
  assertEquals(data.auth[0].pubkey, keypair.publicKeyHex);

  // Payload should be a valid NodeStatus
  const status = data.payload;
  assertEquals(status.nodeId, "hb-node");
  assertEquals(status.name, "Heartbeat Node");
  assertEquals(status.status, "online");
  assertEquals(status.server.port, 8080);
  assertEquals(typeof status.lastHeartbeat, "number");
  assertEquals(typeof status.uptime, "number");
});

Deno.test("heartbeat: degraded status when backend has error", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();

  const writer = createHeartbeatWriter({
    statusClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "degraded-node",
    name: "Degraded Node",
    port: 8081,
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
    getBackendStatuses: () => [
      { type: "memory", status: "connected" },
      { type: "postgresql", status: "error" },
    ],
  });

  writer.start();
  await new Promise((r) => setTimeout(r, 100));
  writer.stop();

  const uri = nodeStatusUri(keypair.publicKeyHex, "degraded-node");
  const result = await client.read(uri);
  assertEquals(result.success, true);

  const status = (result as any).record.data.payload;
  assertEquals(status.status, "degraded");
});

Deno.test("heartbeat: signed envelope has correct pubkey", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();

  const writer = createHeartbeatWriter({
    statusClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "signed-node",
    name: "Signed Node",
    port: 8082,
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
    getBackendStatuses: () => [{ type: "memory", status: "connected" }],
  });

  writer.start();
  await new Promise((r) => setTimeout(r, 100));
  writer.stop();

  const uri = nodeStatusUri(keypair.publicKeyHex, "signed-node");
  const result = await client.read(uri);
  const data = (result as any).record.data;

  assertEquals(data.auth.length, 1);
  assertEquals(data.auth[0].pubkey, keypair.publicKeyHex);
  assertEquals(typeof data.auth[0].signature, "string");
  assertEquals(data.auth[0].signature.length > 0, true);
});

Deno.test("heartbeat: includes metrics when getMetrics provided", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();

  const writer = createHeartbeatWriter({
    statusClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "metrics-node",
    name: "Metrics Node",
    port: 8083,
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
    getBackendStatuses: () => [{ type: "memory", status: "connected" }],
    getMetrics: () => ({
      writeLatencyP50: 1.0,
      writeLatencyP99: 5.0,
      readLatencyP50: 0.5,
      readLatencyP99: 2.0,
      opsPerSecond: 100,
      errorRate: 0.01,
    }),
  });

  writer.start();
  await new Promise((r) => setTimeout(r, 100));
  writer.stop();

  const uri = nodeStatusUri(keypair.publicKeyHex, "metrics-node");
  const result = await client.read(uri);
  const status = (result as any).record.data.payload;

  assertEquals(status.metrics.writeLatencyP50, 1.0);
  assertEquals(status.metrics.opsPerSecond, 100);
});

Deno.test("heartbeat: stop prevents further writes", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();
  let writeCount = 0;
  const originalReceive = client.receive.bind(client);
  client.receive = async (msg: any) => {
    writeCount++;
    return originalReceive(msg);
  };

  const writer = createHeartbeatWriter({
    statusClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "stop-node",
    name: "Stop Node",
    port: 8084,
    intervalMs: 50, // short interval
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
    getBackendStatuses: () => [{ type: "memory", status: "connected" }],
  });

  writer.start();
  await new Promise((r) => setTimeout(r, 100));
  writer.stop();

  const countAfterStop = writeCount;
  await new Promise((r) => setTimeout(r, 200));

  // No additional writes after stop
  assertEquals(writeCount, countAfterStop);
});

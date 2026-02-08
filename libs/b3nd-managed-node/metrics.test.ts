import { assertEquals, assertAlmostEquals } from "@std/assert";
import { generateSigningKeyPair } from "../b3nd-encrypt/mod.ts";
import { createMetricsCollector } from "./metrics.ts";
import { createPermissiveClient } from "./test-helpers.ts";

function createCollector() {
  const keypair = generateSigningKeyPair();
  // We use a sync-returning helper for the collector options
  // but the collector needs CryptoKey. We'll create async tests.
  return keypair;
}

Deno.test("metrics: snapshot returns zeros with no data", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();
  const collector = createMetricsCollector({
    metricsClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "test-node",
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  });

  const snap = collector.snapshot();
  assertEquals(snap.writeLatencyP50, 0);
  assertEquals(snap.writeLatencyP99, 0);
  assertEquals(snap.readLatencyP50, 0);
  assertEquals(snap.readLatencyP99, 0);
  assertEquals(snap.errorRate, 0);
});

Deno.test("metrics: recordWrite updates snapshot", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();
  const collector = createMetricsCollector({
    metricsClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "test-node",
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  });

  collector.recordWrite(5.0);
  collector.recordWrite(10.0);
  collector.recordWrite(15.0);

  const snap = collector.snapshot();
  assertEquals(snap.writeLatencyP50, 10.0);
  assertEquals(snap.writeLatencyP99, 15.0);
  assertEquals(snap.readLatencyP50, 0);
});

Deno.test("metrics: recordRead updates snapshot", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();
  const collector = createMetricsCollector({
    metricsClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "test-node",
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  });

  collector.recordRead(2.0);
  collector.recordRead(4.0);

  const snap = collector.snapshot();
  // P50 of [2.0, 4.0]: ceil(2*50/100)-1 = 0 → sorted[0] = 2.0
  assertEquals(snap.readLatencyP50, 2.0);
  assertEquals(snap.readLatencyP99, 4.0);
  assertEquals(snap.writeLatencyP50, 0);
});

Deno.test("metrics: single value percentile", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();
  const collector = createMetricsCollector({
    metricsClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "test-node",
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  });

  collector.recordWrite(7.5);
  const snap = collector.snapshot();
  assertEquals(snap.writeLatencyP50, 7.5);
  assertEquals(snap.writeLatencyP99, 7.5);
});

Deno.test("metrics: 100 values percentile", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();
  const collector = createMetricsCollector({
    metricsClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "test-node",
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  });

  // Record values 1-100
  for (let i = 1; i <= 100; i++) {
    collector.recordWrite(i);
  }

  const snap = collector.snapshot();
  assertEquals(snap.writeLatencyP50, 50);
  assertEquals(snap.writeLatencyP99, 99);
});

Deno.test("metrics: opsPerSecond calculation", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();
  const collector = createMetricsCollector({
    metricsClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "test-node",
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  });

  // Record 10 ops
  for (let i = 0; i < 10; i++) {
    collector.recordWrite(1.0);
  }

  const snap = collector.snapshot();
  // opsPerSecond should be > 0 (exact value depends on elapsed time)
  assertEquals(snap.opsPerSecond > 0, true);
});

Deno.test("metrics: errorRate calculation", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();
  const collector = createMetricsCollector({
    metricsClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "test-node",
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  });

  // 2 successful ops + 1 error = 3 total, 1/3 error rate
  collector.recordWrite(1.0);
  collector.recordRead(1.0);
  collector.recordError();

  const snap = collector.snapshot();
  assertAlmostEquals(snap.errorRate, 1 / 3, 0.01);
});

Deno.test("metrics: wrapClient records write latency", async () => {
  const keypair = await generateSigningKeyPair();
  const innerClient = createPermissiveClient();
  const collector = createMetricsCollector({
    metricsClient: createPermissiveClient(),
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "test-node",
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  });

  const wrapped = collector.wrapClient(innerClient);
  await wrapped.receive(["mutable://nodes/abc/n1/config", { some: "data" }]);

  const snap = collector.snapshot();
  assertEquals(snap.writeLatencyP50 > 0, true);
});

Deno.test("metrics: wrapClient records read latency", async () => {
  const keypair = await generateSigningKeyPair();
  const innerClient = createPermissiveClient();
  const collector = createMetricsCollector({
    metricsClient: createPermissiveClient(),
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "test-node",
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  });

  const wrapped = collector.wrapClient(innerClient);

  // Write something first, then read it
  await wrapped.receive(["mutable://nodes/abc/n1/config", { foo: "bar" }]);
  await wrapped.read("mutable://nodes/abc/n1/config");

  const snap = collector.snapshot();
  assertEquals(snap.readLatencyP50 > 0, true);
  assertEquals(snap.writeLatencyP50 > 0, true);
});

Deno.test("metrics: start and stop do not throw", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();
  const collector = createMetricsCollector({
    metricsClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "test-node",
    intervalMs: 60000,
    signer: { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  });

  collector.start();
  collector.stop();
});

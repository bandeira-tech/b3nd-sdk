import { assertEquals } from "@std/assert";
import {
  validateConfig,
  validateMetrics,
  validateNetwork,
  validateStatus,
} from "./validators.ts";
import {
  createTestConfig,
  createTestMetrics,
  createTestStatus,
} from "./test-helpers.ts";

// ── Config Validation ───────────────────────────────────────────────

Deno.test("validators: valid config is accepted", () => {
  const config = createTestConfig();
  const result = validateConfig(config);
  assertEquals(result.valid, true);
});

Deno.test("validators: config missing configVersion is rejected", () => {
  const config = createTestConfig();
  const { configVersion: _, ...noVersion } = config;
  const result = validateConfig(noVersion);
  assertEquals(result.valid, false);
  assertEquals(result.error, "configVersion must be 1");
});

Deno.test("validators: config missing server is rejected", () => {
  const config = createTestConfig();
  const { server: _, ...noServer } = config;
  const result = validateConfig(noServer);
  assertEquals(result.valid, false);
  assertEquals(result.error, "server object required");
});

Deno.test("validators: config missing backends is rejected", () => {
  const config = createTestConfig();
  const { backends: _, ...noBackends } = config;
  const result = validateConfig(noBackends);
  assertEquals(result.valid, false);
  assertEquals(result.error, "backends array required");
});

Deno.test("validators: config with empty backends is rejected", () => {
  const config = createTestConfig({ backends: [] });
  const result = validateConfig(config);
  assertEquals(result.valid, false);
  assertEquals(result.error, "backends array required");
});

Deno.test("validators: config with port 0 is rejected", () => {
  const config = createTestConfig({
    server: { port: 0, corsOrigin: "*" },
  });
  const result = validateConfig(config);
  assertEquals(result.valid, false);
  assertEquals(result.error, "server.port must be 1-65535");
});

Deno.test("validators: config with port 70000 is rejected", () => {
  const config = createTestConfig({
    server: { port: 70000, corsOrigin: "*" },
  });
  const result = validateConfig(config);
  assertEquals(result.valid, false);
  assertEquals(result.error, "server.port must be 1-65535");
});

Deno.test("validators: config with invalid backend type is rejected", () => {
  const config = createTestConfig({
    backends: [{ type: "redis" as any, url: "redis://localhost" }],
  });
  const result = validateConfig(config);
  assertEquals(result.valid, false);
});

Deno.test("validators: config missing monitoring is rejected", () => {
  const config = createTestConfig();
  const { monitoring: _, ...noMonitoring } = config;
  const result = validateConfig(noMonitoring);
  assertEquals(result.valid, false);
  assertEquals(result.error, "monitoring object required");
});

// ── Status Validation ───────────────────────────────────────────────

Deno.test("validators: valid status is accepted", () => {
  const status = createTestStatus();
  const result = validateStatus(status);
  assertEquals(result.valid, true);
});

Deno.test("validators: status missing nodeId is rejected", () => {
  const { nodeId: _, ...noNodeId } = createTestStatus();
  const result = validateStatus(noNodeId);
  assertEquals(result.valid, false);
  assertEquals(result.error, "nodeId required");
});

Deno.test("validators: status with invalid status string is rejected", () => {
  const status = createTestStatus({ status: "broken" as any });
  const result = validateStatus(status);
  assertEquals(result.valid, false);
});

Deno.test("validators: status missing lastHeartbeat is rejected", () => {
  const status = createTestStatus();
  const { lastHeartbeat: _, ...noHb } = status;
  const result = validateStatus(noHb);
  assertEquals(result.valid, false);
  assertEquals(result.error, "lastHeartbeat required");
});

// ── Metrics Validation ──────────────────────────────────────────────

Deno.test("validators: valid metrics is accepted", () => {
  const metrics = createTestMetrics();
  const result = validateMetrics(metrics);
  assertEquals(result.valid, true);
});

Deno.test("validators: metrics missing writeLatencyP50 is rejected", () => {
  const { writeLatencyP50: _, ...partial } = createTestMetrics();
  const result = validateMetrics(partial);
  assertEquals(result.valid, false);
  assertEquals(result.error, "writeLatencyP50 must be a number");
});

Deno.test("validators: metrics with string value is rejected", () => {
  const metrics = { ...createTestMetrics(), opsPerSecond: "fast" };
  const result = validateMetrics(metrics);
  assertEquals(result.valid, false);
  assertEquals(result.error, "opsPerSecond must be a number");
});

// ── Network Validation ──────────────────────────────────────────────

Deno.test("validators: valid network manifest is accepted", () => {
  const manifest = {
    networkId: "net-1",
    name: "Test Net",
    nodes: [],
  };
  const result = validateNetwork(manifest);
  assertEquals(result.valid, true);
});

Deno.test("validators: network missing networkId is rejected", () => {
  const result = validateNetwork({
    name: "Test",
    nodes: [],
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "networkId required");
});

Deno.test("validators: network missing name is rejected", () => {
  const result = validateNetwork({
    networkId: "net-1",
    nodes: [],
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "name required");
});

Deno.test("validators: network missing nodes is rejected", () => {
  const result = validateNetwork({
    networkId: "net-1",
    name: "Test",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "nodes array required");
});

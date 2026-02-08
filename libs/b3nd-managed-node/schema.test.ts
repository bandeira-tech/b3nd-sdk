import { assertEquals } from "@std/assert";
import { managedNodeSchema } from "./schema.ts";
import {
  createTestConfig,
  createTestMetrics,
  createTestStatus,
} from "./test-helpers.ts";

// The managedNodeSchema validators accept ({uri, value, read}) per ValidationFn.
// We call them directly with the write object shape.
const configValidator = managedNodeSchema["mutable://nodes/*/config"];
const statusValidator = managedNodeSchema["mutable://nodes/*/status"];
const metricsValidator = managedNodeSchema["mutable://nodes/*/metrics"];
const networkValidator = managedNodeSchema["mutable://networks"];

function write(uri: string, value: unknown) {
  return { uri, value, read: (() => {}) as any };
}

// ── Config Validation ───────────────────────────────────────────────

Deno.test("schema: valid config is accepted", async () => {
  const config = createTestConfig();
  const result = await configValidator(write("mutable://nodes/abc/n1/config", config));
  assertEquals(result.valid, true);
});

Deno.test("schema: config wrapped in auth envelope is accepted", async () => {
  const config = createTestConfig();
  const wrapped = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: config,
  };
  const result = await configValidator(write("mutable://nodes/abc/n1/config", wrapped));
  assertEquals(result.valid, true);
});

Deno.test("schema: config missing configVersion is rejected", async () => {
  const config = createTestConfig();
  const { configVersion: _, ...noVersion } = config;
  const result = await configValidator(write("mutable://nodes/abc/n1/config", noVersion));
  assertEquals(result.valid, false);
  assertEquals(result.error, "configVersion must be 1");
});

Deno.test("schema: config missing server is rejected", async () => {
  const config = createTestConfig();
  const { server: _, ...noServer } = config;
  const result = await configValidator(write("mutable://nodes/abc/n1/config", noServer));
  assertEquals(result.valid, false);
  assertEquals(result.error, "server object required");
});

Deno.test("schema: config missing backends is rejected", async () => {
  const config = createTestConfig();
  const { backends: _, ...noBackends } = config;
  const result = await configValidator(write("mutable://nodes/abc/n1/config", noBackends));
  assertEquals(result.valid, false);
  assertEquals(result.error, "backends array required");
});

Deno.test("schema: config with empty backends is rejected", async () => {
  const config = createTestConfig({ backends: [] });
  const result = await configValidator(write("mutable://nodes/abc/n1/config", config));
  assertEquals(result.valid, false);
  assertEquals(result.error, "backends array required");
});

Deno.test("schema: config with port 0 is rejected", async () => {
  const config = createTestConfig({
    server: { port: 0, corsOrigin: "*" },
  });
  const result = await configValidator(write("mutable://nodes/abc/n1/config", config));
  assertEquals(result.valid, false);
  assertEquals(result.error, "server.port must be 1-65535");
});

Deno.test("schema: config with port 70000 is rejected", async () => {
  const config = createTestConfig({
    server: { port: 70000, corsOrigin: "*" },
  });
  const result = await configValidator(write("mutable://nodes/abc/n1/config", config));
  assertEquals(result.valid, false);
  assertEquals(result.error, "server.port must be 1-65535");
});

Deno.test("schema: config with invalid backend type is rejected", async () => {
  const config = createTestConfig({
    backends: [{ type: "redis" as any, url: "redis://localhost" }],
  });
  const result = await configValidator(write("mutable://nodes/abc/n1/config", config));
  assertEquals(result.valid, false);
});

Deno.test("schema: config missing monitoring is rejected", async () => {
  const config = createTestConfig();
  const { monitoring: _, ...noMonitoring } = config;
  const result = await configValidator(write("mutable://nodes/abc/n1/config", noMonitoring));
  assertEquals(result.valid, false);
  assertEquals(result.error, "monitoring object required");
});

// ── Status Validation ───────────────────────────────────────────────

Deno.test("schema: valid status is accepted", async () => {
  const status = createTestStatus();
  const result = await statusValidator(write("mutable://nodes/abc/n1/status", status));
  assertEquals(result.valid, true);
});

Deno.test("schema: status wrapped in auth envelope is accepted", async () => {
  const status = createTestStatus();
  const wrapped = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: status,
  };
  const result = await statusValidator(write("mutable://nodes/abc/n1/status", wrapped));
  assertEquals(result.valid, true);
});

Deno.test("schema: status missing nodeId is rejected", async () => {
  const { nodeId: _, ...noNodeId } = createTestStatus();
  const result = await statusValidator(write("mutable://nodes/abc/n1/status", noNodeId));
  assertEquals(result.valid, false);
  assertEquals(result.error, "nodeId required");
});

Deno.test("schema: status with invalid status string is rejected", async () => {
  const status = createTestStatus({ status: "broken" as any });
  const result = await statusValidator(write("mutable://nodes/abc/n1/status", status));
  assertEquals(result.valid, false);
});

Deno.test("schema: status missing lastHeartbeat is rejected", async () => {
  const status = createTestStatus();
  const { lastHeartbeat: _, ...noHb } = status;
  const result = await statusValidator(write("mutable://nodes/abc/n1/status", noHb));
  assertEquals(result.valid, false);
  assertEquals(result.error, "lastHeartbeat required");
});

// ── Metrics Validation ──────────────────────────────────────────────

Deno.test("schema: valid metrics is accepted", async () => {
  const metrics = createTestMetrics();
  const result = await metricsValidator(write("mutable://nodes/abc/n1/metrics", metrics));
  assertEquals(result.valid, true);
});

Deno.test("schema: metrics wrapped in auth envelope is accepted", async () => {
  const metrics = createTestMetrics();
  const wrapped = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: metrics,
  };
  const result = await metricsValidator(write("mutable://nodes/abc/n1/metrics", wrapped));
  assertEquals(result.valid, true);
});

Deno.test("schema: metrics missing writeLatencyP50 is rejected", async () => {
  const { writeLatencyP50: _, ...partial } = createTestMetrics();
  const result = await metricsValidator(write("mutable://nodes/abc/n1/metrics", partial));
  assertEquals(result.valid, false);
  assertEquals(result.error, "writeLatencyP50 must be a number");
});

Deno.test("schema: metrics with string value is rejected", async () => {
  const metrics = { ...createTestMetrics(), opsPerSecond: "fast" };
  const result = await metricsValidator(write("mutable://nodes/abc/n1/metrics", metrics));
  assertEquals(result.valid, false);
  assertEquals(result.error, "opsPerSecond must be a number");
});

// ── Network Validation ──────────────────────────────────────────────

Deno.test("schema: valid network manifest is accepted", async () => {
  const manifest = {
    networkId: "net-1",
    name: "Test Net",
    nodes: [],
  };
  const result = await networkValidator(write("mutable://networks/abc/net-1", manifest));
  assertEquals(result.valid, true);
});

Deno.test("schema: network wrapped in auth envelope is accepted", async () => {
  const manifest = {
    networkId: "net-1",
    name: "Test Net",
    nodes: [],
  };
  const wrapped = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: manifest,
  };
  const result = await networkValidator(write("mutable://networks/abc/net-1", wrapped));
  assertEquals(result.valid, true);
});

Deno.test("schema: network missing networkId is rejected", async () => {
  const result = await networkValidator(write("mutable://networks/abc/net-1", {
    name: "Test",
    nodes: [],
  }));
  assertEquals(result.valid, false);
  assertEquals(result.error, "networkId required");
});

Deno.test("schema: network missing name is rejected", async () => {
  const result = await networkValidator(write("mutable://networks/abc/net-1", {
    networkId: "net-1",
    nodes: [],
  }));
  assertEquals(result.valid, false);
  assertEquals(result.error, "name required");
});

Deno.test("schema: network missing nodes is rejected", async () => {
  const result = await networkValidator(write("mutable://networks/abc/net-1", {
    networkId: "net-1",
    name: "Test",
  }));
  assertEquals(result.valid, false);
  assertEquals(result.error, "nodes array required");
});

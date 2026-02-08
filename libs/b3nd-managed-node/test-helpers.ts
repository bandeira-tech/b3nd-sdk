/**
 * Shared test helpers for managed node tests.
 */

import { MemoryClient } from "../b3nd-client-memory/mod.ts";
import {
  createAuthenticatedMessage,
  generateSigningKeyPair,
  type KeyPair,
} from "../b3nd-encrypt/mod.ts";
import { managedNodeSchema } from "./schema.ts";
import type {
  BackendSpec,
  ManagedNodeConfig,
  NetworkManifest,
  NodeMetrics,
  NodeStatus,
} from "./types.ts";

/**
 * Create a valid ManagedNodeConfig for testing.
 */
export function createTestConfig(
  overrides?: Partial<ManagedNodeConfig>,
): ManagedNodeConfig {
  return {
    configVersion: 1,
    nodeId: "test-node-1",
    name: "Test Node",
    server: {
      port: 8080,
      corsOrigin: "*",
    },
    backends: [{ type: "memory", url: "memory://" }],
    monitoring: {
      heartbeatIntervalMs: 30000,
      configPollIntervalMs: 60000,
      metricsEnabled: true,
    },
    ...overrides,
  };
}

/**
 * Create a valid NetworkManifest for testing.
 */
export function createTestManifest(nodeCount = 1): NetworkManifest {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    nodeId: `node-${i}`,
    name: `Node ${i}`,
    role: "worker",
    config: createTestConfig({
      nodeId: `node-${i}`,
      name: `Node ${i}`,
      server: { port: 8080 + i, corsOrigin: "*" },
    }),
  }));

  return {
    networkId: "test-network",
    name: "Test Network",
    description: "A test network",
    nodes,
  };
}

/**
 * Create a valid NodeStatus for testing.
 */
export function createTestStatus(
  overrides?: Partial<NodeStatus>,
): NodeStatus {
  return {
    nodeId: "test-node-1",
    name: "Test Node",
    status: "online",
    lastHeartbeat: Date.now(),
    uptime: 1000,
    configTimestamp: Date.now(),
    server: { port: 8080 },
    backends: [{ type: "memory", status: "connected" }],
    ...overrides,
  };
}

/**
 * Create valid NodeMetrics for testing.
 */
export function createTestMetrics(
  overrides?: Partial<NodeMetrics>,
): NodeMetrics {
  return {
    writeLatencyP50: 1.5,
    writeLatencyP99: 10.2,
    readLatencyP50: 0.8,
    readLatencyP99: 5.1,
    opsPerSecond: 100,
    errorRate: 0.01,
    ...overrides,
  };
}

/**
 * Generate an operator keypair and sign a config.
 */
export async function signConfig(config: ManagedNodeConfig): Promise<{
  signed: { auth: Array<{ pubkey: string; signature: string }>; payload: ManagedNodeConfig };
  keypair: KeyPair;
}> {
  const keypair = await generateSigningKeyPair();
  const signed = await createAuthenticatedMessage(config, [
    { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  ]);
  return { signed, keypair };
}

/**
 * Create a MemoryClient with schema keys compatible with managed node URIs.
 *
 * MemoryClient requires schema keys in "protocol://hostname" format,
 * so we register "mutable://nodes" and "mutable://networks" with
 * validators adapted from managedNodeSchema.
 */
export function createSchemaClient(): MemoryClient {
  // The managedNodeSchema keys have wildcards (mutable://nodes/*/config).
  // MemoryClient needs "protocol://hostname" keys. We adapt by creating
  // validators that route based on URI path suffix.
  const nodeValidator = async (write: { uri: string; value: unknown }) => {
    const { uri, value } = write;
    if (uri.endsWith("/config")) {
      return managedNodeSchema["mutable://nodes/*/config"]({ uri, value, read: (() => {}) as any });
    }
    if (uri.endsWith("/status")) {
      return managedNodeSchema["mutable://nodes/*/status"]({ uri, value, read: (() => {}) as any });
    }
    if (uri.endsWith("/metrics")) {
      return managedNodeSchema["mutable://nodes/*/metrics"]({ uri, value, read: (() => {}) as any });
    }
    return { valid: true };
  };

  const networkValidator = async (write: { uri: string; value: unknown }) => {
    return managedNodeSchema["mutable://networks"]({ uri: write.uri, value: write.value, read: (() => {}) as any });
  };

  return new MemoryClient({
    schema: {
      "mutable://nodes": nodeValidator as any,
      "mutable://networks": networkValidator as any,
    },
  });
}

/**
 * Create a MemoryClient that accepts all writes to node/network URIs.
 * Useful when you need to store data without validation (e.g., testing
 * config-loader which does its own verification).
 */
export function createPermissiveClient(): MemoryClient {
  const acceptAll = async () => ({ valid: true });
  return new MemoryClient({
    schema: {
      "mutable://nodes": acceptAll,
      "mutable://networks": acceptAll,
    },
  });
}

/**
 * Shared test helpers for managed node tests.
 */

import { MemoryClient } from "../b3nd-client-memory/mod.ts";
import {
  createAuthenticatedMessage,
  generateSigningKeyPair,
  type KeyPair,
} from "../b3nd-encrypt/mod.ts";
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
    publicKey: `pubkey-${i}`,
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
 * Create a MemoryClient that accepts all writes to accounts URIs.
 * Uses mutable://accounts as the canonical program.
 */
export function createPermissiveClient(): MemoryClient {
  const acceptAll = async () => ({ valid: true });
  return new MemoryClient({
    schema: {
      "mutable://accounts": acceptAll,
    },
  });
}

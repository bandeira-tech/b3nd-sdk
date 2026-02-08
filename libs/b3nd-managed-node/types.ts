/**
 * Core types for B3nd Managed Nodes.
 *
 * URI scheme:
 *   mutable://nodes/{operatorPubKeyHex}/{nodeId}/config   - signed config
 *   mutable://nodes/{operatorPubKeyHex}/{nodeId}/status   - heartbeat + status
 *   mutable://nodes/{operatorPubKeyHex}/{nodeId}/metrics  - performance data
 *   mutable://networks/{operatorPubKeyHex}/{networkId}    - network manifest
 */

// ── Node Configuration ────────────────────────────────────────────────

export interface ManagedNodeConfig {
  configVersion: 1;
  nodeId: string;
  name: string;
  server: {
    port: number;
    corsOrigin: string;
  };
  backends: BackendSpec[];
  schemaModuleUrl?: string;
  schemaInline?: Record<string, SchemaRule>;
  peers?: PeerSpec[];
  monitoring: {
    heartbeatIntervalMs: number;
    configPollIntervalMs: number;
    metricsEnabled: boolean;
  };
  networkId?: string;
  tags?: Record<string, string>;
}

export interface BackendSpec {
  type: "memory" | "postgresql" | "mongodb" | "http";
  url: string;
  options?: Record<string, unknown>;
}

export interface PeerSpec {
  url: string;
  direction: "push" | "pull" | "bidirectional";
}

export interface SchemaRule {
  validate?: string;
  description?: string;
}

// ── Node Status & Metrics ─────────────────────────────────────────────

export interface NodeStatus {
  nodeId: string;
  name: string;
  status: "online" | "degraded" | "offline";
  lastHeartbeat: number;
  uptime: number;
  configTimestamp: number;
  server: { port: number };
  backends: BackendStatus[];
  metrics?: NodeMetrics;
}

export interface BackendStatus {
  type: string;
  status: "connected" | "error";
}

export interface NodeMetrics {
  writeLatencyP50: number;
  writeLatencyP99: number;
  readLatencyP50: number;
  readLatencyP99: number;
  opsPerSecond: number;
  errorRate: number;
}

// ── Network ───────────────────────────────────────────────────────────

export interface NetworkManifest {
  networkId: string;
  name: string;
  description?: string;
  nodes: NetworkNodeEntry[];
}

export interface NetworkNodeEntry {
  nodeId: string;
  name: string;
  role: string;
  config: ManagedNodeConfig;
}

// ── Software Updates ──────────────────────────────────────────────────

export interface ModuleUpdate {
  version: string;
  moduleUrl: string;
  checksum: string;
  releaseNotes?: string;
}

// ── URI Helpers ───────────────────────────────────────────────────────

export function nodeConfigUri(operatorPubKeyHex: string, nodeId: string): string {
  return `mutable://nodes/${operatorPubKeyHex}/${nodeId}/config`;
}

export function nodeStatusUri(operatorPubKeyHex: string, nodeId: string): string {
  return `mutable://nodes/${operatorPubKeyHex}/${nodeId}/status`;
}

export function nodeMetricsUri(operatorPubKeyHex: string, nodeId: string): string {
  return `mutable://nodes/${operatorPubKeyHex}/${nodeId}/metrics`;
}

export function networkManifestUri(operatorPubKeyHex: string, networkId: string): string {
  return `mutable://networks/${operatorPubKeyHex}/${networkId}`;
}

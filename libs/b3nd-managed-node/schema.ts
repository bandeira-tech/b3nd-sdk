/**
 * Schema validation rules for managed node config URIs.
 *
 * Validates writes to:
 *   mutable://nodes/{pubkey}/{nodeId}/config
 *   mutable://nodes/{pubkey}/{nodeId}/status
 *   mutable://nodes/{pubkey}/{nodeId}/metrics
 *   mutable://networks/{pubkey}/{networkId}
 */

import type { Schema } from "@bandeira-tech/b3nd-sdk";
import type {
  ManagedNodeConfig,
  NetworkManifest,
  NodeMetrics,
  NodeStatus,
} from "./types.ts";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateBackendSpec(b: unknown): string | null {
  if (!isObject(b)) return "backend must be an object";
  const types = ["memory", "postgresql", "mongodb", "http"];
  if (!types.includes(b.type as string)) return `backend.type must be one of: ${types.join(", ")}`;
  if (typeof b.url !== "string" || b.url.length === 0) return "backend.url must be a non-empty string";
  return null;
}

function validateConfig(data: unknown): { valid: boolean; error?: string } {
  if (!isObject(data)) return { valid: false, error: "config must be an object" };
  const c = data as Record<string, unknown>;

  if (c.configVersion !== 1) return { valid: false, error: "configVersion must be 1" };
  if (typeof c.nodeId !== "string" || c.nodeId.length === 0) return { valid: false, error: "nodeId required" };
  if (typeof c.name !== "string" || c.name.length === 0) return { valid: false, error: "name required" };

  if (!isObject(c.server)) return { valid: false, error: "server object required" };
  const srv = c.server as Record<string, unknown>;
  if (typeof srv.port !== "number" || srv.port < 1 || srv.port > 65535) return { valid: false, error: "server.port must be 1-65535" };
  if (typeof srv.corsOrigin !== "string") return { valid: false, error: "server.corsOrigin required" };

  if (!Array.isArray(c.backends) || c.backends.length === 0) return { valid: false, error: "backends array required" };
  for (const b of c.backends) {
    const err = validateBackendSpec(b);
    if (err) return { valid: false, error: err };
  }

  if (!isObject(c.monitoring)) return { valid: false, error: "monitoring object required" };
  const mon = c.monitoring as Record<string, unknown>;
  if (typeof mon.heartbeatIntervalMs !== "number") return { valid: false, error: "monitoring.heartbeatIntervalMs required" };
  if (typeof mon.configPollIntervalMs !== "number") return { valid: false, error: "monitoring.configPollIntervalMs required" };
  if (typeof mon.metricsEnabled !== "boolean") return { valid: false, error: "monitoring.metricsEnabled required" };

  return { valid: true };
}

function validateStatus(data: unknown): { valid: boolean; error?: string } {
  if (!isObject(data)) return { valid: false, error: "status must be an object" };
  const s = data as Record<string, unknown>;
  if (typeof s.nodeId !== "string") return { valid: false, error: "nodeId required" };
  if (typeof s.name !== "string") return { valid: false, error: "name required" };
  const statuses = ["online", "degraded", "offline"];
  if (!statuses.includes(s.status as string)) return { valid: false, error: `status must be one of: ${statuses.join(", ")}` };
  if (typeof s.lastHeartbeat !== "number") return { valid: false, error: "lastHeartbeat required" };
  if (typeof s.uptime !== "number") return { valid: false, error: "uptime required" };
  if (typeof s.configTimestamp !== "number") return { valid: false, error: "configTimestamp required" };
  return { valid: true };
}

function validateMetrics(data: unknown): { valid: boolean; error?: string } {
  if (!isObject(data)) return { valid: false, error: "metrics must be an object" };
  const m = data as Record<string, unknown>;
  const required = ["writeLatencyP50", "writeLatencyP99", "readLatencyP50", "readLatencyP99", "opsPerSecond", "errorRate"];
  for (const key of required) {
    if (typeof m[key] !== "number") return { valid: false, error: `${key} must be a number` };
  }
  return { valid: true };
}

function validateNetwork(data: unknown): { valid: boolean; error?: string } {
  if (!isObject(data)) return { valid: false, error: "network manifest must be an object" };
  const n = data as Record<string, unknown>;
  if (typeof n.networkId !== "string") return { valid: false, error: "networkId required" };
  if (typeof n.name !== "string") return { valid: false, error: "name required" };
  if (!Array.isArray(n.nodes)) return { valid: false, error: "nodes array required" };
  return { valid: true };
}

/**
 * Schema rules for managed node URIs.
 * Merge this into your node's schema to enable config storage validation.
 */
export const managedNodeSchema: Schema = {
  // Config documents: mutable://nodes/{pubkey}/{nodeId}/config
  "mutable://nodes/*/config": async (_uri: string, data: unknown) => {
    // If wrapped in auth envelope, validate the payload
    const payload = isObject(data) && Array.isArray((data as any).auth)
      ? (data as any).payload
      : data;
    return validateConfig(payload);
  },

  // Status documents: mutable://nodes/{pubkey}/{nodeId}/status
  "mutable://nodes/*/status": async (_uri: string, data: unknown) => {
    const payload = isObject(data) && Array.isArray((data as any).auth)
      ? (data as any).payload
      : data;
    return validateStatus(payload);
  },

  // Metrics documents: mutable://nodes/{pubkey}/{nodeId}/metrics
  "mutable://nodes/*/metrics": async (_uri: string, data: unknown) => {
    const payload = isObject(data) && Array.isArray((data as any).auth)
      ? (data as any).payload
      : data;
    return validateMetrics(payload);
  },

  // Network manifests: mutable://networks/{pubkey}/{networkId}
  "mutable://networks": async (_uri: string, data: unknown) => {
    const payload = isObject(data) && Array.isArray((data as any).auth)
      ? (data as any).payload
      : data;
    return validateNetwork(payload);
  },
};

export default managedNodeSchema;

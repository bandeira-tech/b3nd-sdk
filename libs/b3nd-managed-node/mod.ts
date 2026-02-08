/**
 * B3nd Managed Node library.
 *
 * Provides types, URI helpers, schema validation, and runtime components
 * for self-configuring B3nd nodes that load configuration from the network.
 *
 * @module
 */

// Types and URI helpers
export type {
  BackendSpec,
  BackendStatus,
  ManagedNodeConfig,
  ModuleUpdate,
  NetworkManifest,
  NetworkNodeEntry,
  NodeMetrics,
  NodeStatus,
  PeerSpec,
  SchemaRule,
} from "./types.ts";

export {
  networkManifestUri,
  nodeConfigUri,
  nodeMetricsUri,
  nodeStatusUri,
} from "./types.ts";

// Schema validation
export { managedNodeSchema } from "./schema.ts";

// Config loader
export { loadConfig } from "./config-loader.ts";

// Config watcher
export { createConfigWatcher } from "./config-watcher.ts";

// Node builder
export { buildClientsFromSpec } from "./node-builder.ts";

// Heartbeat writer
export { createHeartbeatWriter } from "./heartbeat.ts";

// Metrics collector
export { createMetricsCollector } from "./metrics.ts";

// Module loader
export { loadSchemaModule, createModuleWatcher } from "./module-loader.ts";

// Update protocol
export { createUpdateChecker } from "./update-protocol.ts";

// Orchestration
export { generateCompose } from "./compose-generator.ts";
export { startLocalNetwork } from "./local-runner.ts";

import { create } from "zustand";

// ── Types (mirrored from libs/b3nd-managed-node/types.ts for browser use) ──

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
  schemaInline?: Record<string, { validate?: string; description?: string }>;
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

export interface NodeStatus {
  nodeId: string;
  name: string;
  status: "online" | "degraded" | "offline";
  lastHeartbeat: number;
  uptime: number;
  configTimestamp: number;
  server: { port: number };
  backends: { type: string; status: "connected" | "error" }[];
  metrics?: NodeMetrics;
}

export interface NodeMetrics {
  writeLatencyP50: number;
  writeLatencyP99: number;
  readLatencyP50: number;
  readLatencyP99: number;
  opsPerSecond: number;
  errorRate: number;
}

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
  encryptionPublicKeyHex?: string;
  generatedKeys?: {
    privateKeyPem: string;
    encryptionPrivateKeyHex: string;
    encryptionPublicKeyHex: string;
  };
}

// ── Store ─────────────────────────────────────────────────────────────

export interface NodesState {
  networks: NetworkManifest[];
  activeNetworkId: string | null;
  activeNodeId: string | null;
  nodeStatuses: Record<string, NodeStatus>;
  nodeMetrics: Record<string, NodeMetrics>;
  configDrafts: Record<string, ManagedNodeConfig>;
  configEditorMode: "form" | "json";
  pushingConfig: boolean;
  pushError: string | null;
}

export interface NodesActions {
  setActiveNetwork: (networkId: string | null) => void;
  setActiveNode: (nodeId: string | null) => void;
  addNetwork: (manifest: NetworkManifest) => void;
  removeNetwork: (networkId: string) => void;
  updateNodeStatus: (nodeId: string, status: NodeStatus) => void;
  updateNodeMetrics: (nodeId: string, metrics: NodeMetrics) => void;
  setConfigDraft: (nodeId: string, config: ManagedNodeConfig) => void;
  clearConfigDraft: (nodeId: string) => void;
  setConfigEditorMode: (mode: "form" | "json") => void;
  setPushingConfig: (pushing: boolean) => void;
  setPushError: (error: string | null) => void;
  addNodeToNetwork: (networkId: string, entry: NetworkNodeEntry) => void;
  removeNodeFromNetwork: (networkId: string, nodeId: string) => void;
}

export interface NodesStore extends NodesState, NodesActions {}

const initialState: NodesState = {
  networks: [],
  activeNetworkId: null,
  activeNodeId: null,
  nodeStatuses: {},
  nodeMetrics: {},
  configDrafts: {},
  configEditorMode: "form",
  pushingConfig: false,
  pushError: null,
};

export const useNodesStore = create<NodesStore>((set) => ({
  ...initialState,

  setActiveNetwork: (networkId) => set({ activeNetworkId: networkId, activeNodeId: null }),

  setActiveNode: (nodeId) => set({ activeNodeId: nodeId }),

  addNetwork: (manifest) =>
    set((state) => ({ networks: [...state.networks, manifest] })),

  removeNetwork: (networkId) =>
    set((state) => ({
      networks: state.networks.filter((n) => n.networkId !== networkId),
      activeNetworkId: state.activeNetworkId === networkId ? null : state.activeNetworkId,
    })),

  updateNodeStatus: (nodeId, status) =>
    set((state) => ({
      nodeStatuses: { ...state.nodeStatuses, [nodeId]: status },
    })),

  updateNodeMetrics: (nodeId, metrics) =>
    set((state) => ({
      nodeMetrics: { ...state.nodeMetrics, [nodeId]: metrics },
    })),

  setConfigDraft: (nodeId, config) =>
    set((state) => ({
      configDrafts: { ...state.configDrafts, [nodeId]: config },
    })),

  clearConfigDraft: (nodeId) =>
    set((state) => {
      const { [nodeId]: _, ...rest } = state.configDrafts;
      return { configDrafts: rest };
    }),

  setConfigEditorMode: (mode) => set({ configEditorMode: mode }),

  setPushingConfig: (pushing) => set({ pushingConfig: pushing }),

  setPushError: (error) => set({ pushError: error }),

  addNodeToNetwork: (networkId, entry) =>
    set((state) => ({
      networks: state.networks.map((n) =>
        n.networkId === networkId
          ? { ...n, nodes: [...n.nodes, entry] }
          : n
      ),
    })),

  removeNodeFromNetwork: (networkId, nodeId) =>
    set((state) => ({
      networks: state.networks.map((n) =>
        n.networkId === networkId
          ? { ...n, nodes: n.nodes.filter((e) => e.nodeId !== nodeId) }
          : n
      ),
    })),
}));

// ── Selectors ─────────────────────────────────────────────────────────

export function useActiveNetwork(): NetworkManifest | null {
  const networks = useNodesStore((s) => s.networks);
  const activeNetworkId = useNodesStore((s) => s.activeNetworkId);
  return networks.find((n) => n.networkId === activeNetworkId) ?? null;
}

export function useActiveNodeConfig(): ManagedNodeConfig | null {
  const networks = useNodesStore((s) => s.networks);
  const activeNodeId = useNodesStore((s) => s.activeNodeId);
  if (!activeNodeId) return null;
  for (const network of networks) {
    const entry = network.nodes.find((n) => n.nodeId === activeNodeId);
    if (entry) return entry.config;
  }
  return null;
}

export function useActiveNodeStatus(): NodeStatus | null {
  const statuses = useNodesStore((s) => s.nodeStatuses);
  const activeNodeId = useNodesStore((s) => s.activeNodeId);
  if (!activeNodeId) return null;
  return statuses[activeNodeId] ?? null;
}

// ── Default config factory ────────────────────────────────────────────

export function createDefaultConfig(nodeId: string, name: string): ManagedNodeConfig {
  return {
    configVersion: 1,
    nodeId,
    name,
    server: {
      port: 3000,
      corsOrigin: "*",
    },
    backends: [{ type: "memory", url: "memory://" }],
    monitoring: {
      heartbeatIntervalMs: 30000,
      configPollIntervalMs: 10000,
      metricsEnabled: true,
    },
  };
}

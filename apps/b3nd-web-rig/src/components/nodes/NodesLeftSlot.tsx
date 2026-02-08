import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Network,
  Plus,
  Server,
} from "lucide-react";
import { cn } from "../../utils";
import {
  createDefaultConfig,
  useNodesStore,
  type NetworkManifest,
} from "./stores/nodesStore";

export function NodesLeftSlot() {
  const {
    networks,
    activeNetworkId,
    activeNodeId,
    nodeStatuses,
    setActiveNetwork,
    setActiveNode,
    addNetwork,
    addNodeToNetwork,
  } = useNodesStore();

  const [expandedNetworks, setExpandedNetworks] = useState<Set<string>>(
    new Set()
  );
  const [showNewNetwork, setShowNewNetwork] = useState(false);
  const [newNetworkName, setNewNetworkName] = useState("");

  const toggleExpand = (networkId: string) => {
    setExpandedNetworks((prev) => {
      const next = new Set(prev);
      if (next.has(networkId)) next.delete(networkId);
      else next.add(networkId);
      return next;
    });
  };

  const handleCreateNetwork = () => {
    if (!newNetworkName.trim()) return;
    const networkId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const manifest: NetworkManifest = {
      networkId,
      name: newNetworkName.trim(),
      nodes: [],
    };
    addNetwork(manifest);
    setActiveNetwork(networkId);
    setExpandedNetworks((prev) => new Set([...prev, networkId]));
    setNewNetworkName("");
    setShowNewNetwork(false);
  };

  const handleAddNode = (networkId: string) => {
    const nodeId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const name = `node-${nodeId.slice(0, 6)}`;
    addNodeToNetwork(networkId, {
      nodeId,
      name,
      role: "replica",
      config: createDefaultConfig(nodeId, name),
    });
    setActiveNode(nodeId);
  };

  const statusColor = (nodeId: string) => {
    const s = nodeStatuses[nodeId];
    if (!s) return "text-muted-foreground";
    if (s.status === "online") return "text-green-500";
    if (s.status === "degraded") return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border bg-card flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Networks</span>
        </div>
        <button
          onClick={() => setShowNewNetwork(true)}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Create network"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* New network input */}
      {showNewNetwork && (
        <div className="p-2 border-b border-border">
          <input
            type="text"
            value={newNetworkName}
            onChange={(e) => setNewNetworkName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateNetwork();
              if (e.key === "Escape") setShowNewNetwork(false);
            }}
            placeholder="Network name..."
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
        </div>
      )}

      {/* Network tree */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {networks.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground text-center">
            No networks yet. Click + to create one.
          </div>
        )}

        {networks.map((network) => {
          const isExpanded = expandedNetworks.has(network.networkId);
          const isActive = activeNetworkId === network.networkId;

          return (
            <div key={network.networkId}>
              {/* Network row */}
              <button
                onClick={() => {
                  setActiveNetwork(network.networkId);
                  toggleExpand(network.networkId);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 shrink-0" />
                )}
                <Network className="w-3.5 h-3.5 shrink-0 text-primary" />
                <span className="truncate font-medium">{network.name}</span>
                <span className="ml-auto text-muted-foreground">
                  {network.nodes.length}
                </span>
              </button>

              {/* Node list */}
              {isExpanded && (
                <div>
                  {network.nodes.map((entry) => (
                    <button
                      key={entry.nodeId}
                      onClick={() => {
                        setActiveNetwork(network.networkId);
                        setActiveNode(entry.nodeId);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs transition-colors",
                        activeNodeId === entry.nodeId
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-accent/50 text-foreground"
                      )}
                    >
                      <CircleDot
                        className={cn("w-3 h-3 shrink-0", statusColor(entry.nodeId))}
                      />
                      <Server className="w-3 h-3 shrink-0" />
                      <span className="truncate">{entry.name}</span>
                      <span className="ml-auto text-muted-foreground text-[10px]">
                        {entry.role}
                      </span>
                    </button>
                  ))}

                  {/* Add node button */}
                  <button
                    onClick={() => handleAddNode(network.networkId)}
                    className="w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add node</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

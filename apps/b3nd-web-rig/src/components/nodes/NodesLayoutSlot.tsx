import { Server } from "lucide-react";
import { useNodesStore, useActiveNetwork } from "./stores/nodesStore";
import { NetworkOverview } from "./NetworkOverview";
import { NodeDetail } from "./NodeDetail";
import { useNodeStatusPolling } from "./hooks/useNodeStatus";

export function NodesLayoutSlot() {
  const activeNetworkId = useNodesStore((s) => s.activeNetworkId);
  const activeNodeId = useNodesStore((s) => s.activeNodeId);
  const activeNetwork = useActiveNetwork();

  // Poll node statuses
  useNodeStatusPolling();

  // No selection - show welcome
  if (!activeNetworkId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
        <Server className="w-12 h-12 opacity-30" />
        <div className="text-lg font-medium">Managed Nodes</div>
        <div className="text-sm max-w-md text-center">
          Select a network from the sidebar to view nodes, or create a new
          network to get started with self-configuring B3nd nodes.
        </div>
      </div>
    );
  }

  // Network selected, no specific node
  if (!activeNodeId && activeNetwork) {
    return <NetworkOverview network={activeNetwork} />;
  }

  // Specific node selected
  if (activeNodeId && activeNetwork) {
    const entry = activeNetwork.nodes.find((n) => n.nodeId === activeNodeId);
    if (entry) {
      return <NodeDetail entry={entry} networkId={activeNetwork.networkId} />;
    }
  }

  return (
    <div className="h-full flex items-center justify-center text-muted-foreground">
      Node not found
    </div>
  );
}

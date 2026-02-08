import {
  Activity,
  CircleDot,
  Clock,
  Network,
  Server,
  Zap,
} from "lucide-react";
import { cn } from "../../utils";
import { useNodesStore, type NetworkManifest, type NetworkNodeEntry } from "./stores/nodesStore";

interface Props {
  network: NetworkManifest;
}

export function NetworkOverview({ network }: Props) {
  const nodeStatuses = useNodesStore((s) => s.nodeStatuses);
  const nodeMetrics = useNodesStore((s) => s.nodeMetrics);
  const setActiveNode = useNodesStore((s) => s.setActiveNode);

  const onlineCount = network.nodes.filter(
    (n) => nodeStatuses[n.nodeId]?.status === "online"
  ).length;

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Network className="w-5 h-5 text-primary" />
          <div>
            <h1 className="font-semibold text-lg">{network.name}</h1>
            {network.description && (
              <p className="text-xs text-muted-foreground">
                {network.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {onlineCount}/{network.nodes.length} online
          </span>
        </div>
      </header>

      {/* Node grid */}
      <div className="flex-1 overflow-auto p-4">
        {network.nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Server className="w-8 h-8 opacity-30" />
            <p className="text-sm">No nodes in this network yet.</p>
            <p className="text-xs">
              Add a node from the sidebar to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {network.nodes.map((entry) => (
              <NodeCard
                key={entry.nodeId}
                entry={entry}
                status={nodeStatuses[entry.nodeId]}
                metrics={nodeMetrics[entry.nodeId]}
                onClick={() => setActiveNode(entry.nodeId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NodeCard({
  entry,
  status,
  metrics,
  onClick,
}: {
  entry: NetworkNodeEntry;
  status?: { status: string; lastHeartbeat: number; backends: { type: string; status: string }[] };
  metrics?: { opsPerSecond: number; writeLatencyP50: number; readLatencyP50: number; errorRate: number };
  onClick: () => void;
}) {
  const isOnline = status?.status === "online";
  const isDegraded = status?.status === "degraded";

  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left p-4 rounded-lg border transition-all hover:shadow-sm",
        "bg-card hover:bg-accent/30",
        isOnline && "border-green-500/30",
        isDegraded && "border-yellow-500/30",
        !status && "border-border"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">{entry.name}</span>
        </div>
        <CircleDot
          className={cn(
            "w-3.5 h-3.5",
            isOnline && "text-green-500",
            isDegraded && "text-yellow-500",
            !status && "text-muted-foreground"
          )}
        />
      </div>

      {/* Backend badges */}
      <div className="flex flex-wrap gap-1 mb-3">
        {entry.config.backends.map((b, i) => (
          <span
            key={i}
            className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary/10 text-primary"
          >
            {b.type}
          </span>
        ))}
        <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">
          {entry.role}
        </span>
      </div>

      {/* Metrics */}
      {metrics ? (
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Zap className="w-3 h-3" />
            <span>{metrics.opsPerSecond} ops/s</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>w:{metrics.writeLatencyP50}ms</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Activity className="w-3 h-3" />
            <span>{(metrics.errorRate * 100).toFixed(1)}% err</span>
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground">
          {status ? "No metrics yet" : "Waiting for heartbeat..."}
        </div>
      )}

      {/* Last heartbeat */}
      {status && (
        <div className="mt-2 text-[10px] text-muted-foreground">
          Last seen {formatAgo(status.lastHeartbeat)}
        </div>
      )}
    </button>
  );
}

function formatAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

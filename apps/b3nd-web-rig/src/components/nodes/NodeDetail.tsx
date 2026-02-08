import { useState } from "react";
import {
  ArrowLeft,
  CircleDot,
  Clock,
  Server,
  Settings,
  Zap,
} from "lucide-react";
import { cn } from "../../utils";
import { useNodesStore, type NetworkNodeEntry, type NodeMetrics, type NodeStatus } from "./stores/nodesStore";
import { ConfigEditor } from "./ConfigEditor";

interface Props {
  entry: NetworkNodeEntry;
  networkId: string;
}

export function NodeDetail({ entry, networkId }: Props) {
  const nodeStatuses = useNodesStore((s) => s.nodeStatuses);
  const nodeMetricsMap = useNodesStore((s) => s.nodeMetrics);
  const setActiveNode = useNodesStore((s) => s.setActiveNode);
  const [tab, setTab] = useState<"status" | "config" | "metrics">("status");

  const status = nodeStatuses[entry.nodeId];
  const metrics = nodeMetricsMap[entry.nodeId];

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
        <button
          onClick={() => setActiveNode(null)}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Back to network"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <Server className="w-5 h-5 text-primary" />
        <div className="flex-1">
          <h1 className="font-semibold">{entry.name}</h1>
          <p className="text-xs text-muted-foreground">
            {entry.nodeId.slice(0, 12)}... &middot; {entry.role}
          </p>
        </div>
        <CircleDot
          className={cn(
            "w-4 h-4",
            status?.status === "online" && "text-green-500",
            status?.status === "degraded" && "text-yellow-500",
            (!status || status?.status === "offline") && "text-muted-foreground"
          )}
        />
      </header>

      {/* Tabs */}
      <div className="flex border-b border-border bg-card">
        {(
          [
            { id: "status", label: "Status", icon: CircleDot },
            { id: "config", label: "Configuration", icon: Settings },
            { id: "metrics", label: "Metrics", icon: Zap },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors",
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === "status" && (
          <StatusPanel entry={entry} status={status} metrics={metrics} />
        )}
        {tab === "config" && (
          <ConfigEditor entry={entry} networkId={networkId} />
        )}
        {tab === "metrics" && (
          <MetricsPanel metrics={metrics} />
        )}
      </div>
    </div>
  );
}

function StatusPanel({
  entry,
  status,
  metrics,
}: {
  entry: NetworkNodeEntry;
  status?: NodeStatus;
  metrics?: NodeMetrics;
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Status card */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Node Status</h3>
        {status ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">Status</span>
              <div className="font-medium mt-0.5 capitalize">{status.status}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Port</span>
              <div className="font-medium mt-0.5">{status.server.port}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Uptime</span>
              <div className="font-medium mt-0.5">{formatUptime(status.uptime)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Last Heartbeat</span>
              <div className="font-medium mt-0.5">
                {new Date(status.lastHeartbeat).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Waiting for node to report status...
          </p>
        )}
      </div>

      {/* Backends card */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Backends</h3>
        <div className="space-y-2">
          {(status?.backends ?? entry.config.backends.map((b) => ({ type: b.type, status: "connected" as const }))).map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/30"
            >
              <span className="text-xs font-medium">{b.type}</span>
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded",
                  b.status === "connected"
                    ? "bg-green-500/10 text-green-600"
                    : "bg-red-500/10 text-red-600"
                )}
              >
                {b.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick metrics */}
      {metrics && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-3">Quick Metrics</h3>
          <div className="grid grid-cols-3 gap-3">
            <MetricBox label="Ops/s" value={String(metrics.opsPerSecond)} icon={<Zap className="w-3.5 h-3.5" />} />
            <MetricBox label="Write P50" value={`${metrics.writeLatencyP50}ms`} icon={<Clock className="w-3.5 h-3.5" />} />
            <MetricBox label="Read P50" value={`${metrics.readLatencyP50}ms`} icon={<Clock className="w-3.5 h-3.5" />} />
          </div>
        </div>
      )}

      {/* Tags */}
      {entry.config.tags && Object.keys(entry.config.tags).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-3">Tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(entry.config.tags).map(([k, v]) => (
              <span
                key={k}
                className="px-2 py-0.5 text-[10px] rounded bg-muted text-muted-foreground"
              >
                {k}: {v}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricsPanel({ metrics }: { metrics?: NodeMetrics }) {
  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No metrics available yet. Enable monitoring in the node config.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-4">Performance</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricBox label="Write P50" value={`${metrics.writeLatencyP50}ms`} icon={<Clock className="w-3.5 h-3.5" />} />
          <MetricBox label="Write P99" value={`${metrics.writeLatencyP99}ms`} icon={<Clock className="w-3.5 h-3.5" />} />
          <MetricBox label="Read P50" value={`${metrics.readLatencyP50}ms`} icon={<Clock className="w-3.5 h-3.5" />} />
          <MetricBox label="Read P99" value={`${metrics.readLatencyP99}ms`} icon={<Clock className="w-3.5 h-3.5" />} />
          <MetricBox label="Ops/s" value={String(metrics.opsPerSecond)} icon={<Zap className="w-3.5 h-3.5" />} />
          <MetricBox label="Error Rate" value={`${(metrics.errorRate * 100).toFixed(2)}%`} icon={<CircleDot className="w-3.5 h-3.5" />} />
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-muted/30">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

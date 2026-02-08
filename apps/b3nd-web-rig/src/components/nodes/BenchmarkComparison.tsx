import { BarChart3, Clock, Zap } from "lucide-react";
import { cn } from "../../utils";
import {
  useNodesStore,
  type NetworkManifest,
  type NodeMetrics,
} from "./stores/nodesStore";

interface Props {
  network: NetworkManifest;
}

/**
 * Side-by-side latency/throughput comparison for nodes in a network.
 * Shows bar charts comparing performance metrics across different backends.
 */
export function BenchmarkComparison({ network }: Props) {
  const nodeMetrics = useNodesStore((s) => s.nodeMetrics);

  const nodesWithMetrics = network.nodes
    .map((n) => ({
      ...n,
      metrics: nodeMetrics[n.nodeId],
    }))
    .filter((n) => n.metrics);

  if (nodesWithMetrics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <BarChart3 className="w-8 h-8 opacity-30" />
        <p className="text-sm">No metrics data available yet.</p>
        <p className="text-xs">
          Enable monitoring on nodes and wait for data to accumulate.
        </p>
      </div>
    );
  }

  const maxOps = Math.max(...nodesWithMetrics.map((n) => n.metrics!.opsPerSecond), 1);
  const maxWriteP99 = Math.max(...nodesWithMetrics.map((n) => n.metrics!.writeLatencyP99), 1);
  const maxReadP99 = Math.max(...nodesWithMetrics.map((n) => n.metrics!.readLatencyP99), 1);

  return (
    <div className="p-4 space-y-6 max-w-4xl">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className="w-5 h-5 text-primary" />
        <h2 className="font-semibold">Benchmark Comparison</h2>
      </div>

      {/* Throughput */}
      <MetricChart
        title="Throughput (ops/s)"
        icon={<Zap className="w-4 h-4" />}
        nodes={nodesWithMetrics}
        getValue={(m) => m.opsPerSecond}
        formatValue={(v) => `${v} ops/s`}
        maxValue={maxOps}
        colorClass="bg-blue-500"
      />

      {/* Write Latency */}
      <MetricChart
        title="Write Latency"
        icon={<Clock className="w-4 h-4" />}
        nodes={nodesWithMetrics}
        getValue={(m) => m.writeLatencyP99}
        formatValue={(v) => `${v}ms (P99)`}
        maxValue={maxWriteP99}
        colorClass="bg-amber-500"
        lowerIsBetter
      />

      {/* Read Latency */}
      <MetricChart
        title="Read Latency"
        icon={<Clock className="w-4 h-4" />}
        nodes={nodesWithMetrics}
        getValue={(m) => m.readLatencyP99}
        formatValue={(v) => `${v}ms (P99)`}
        maxValue={maxReadP99}
        colorClass="bg-emerald-500"
        lowerIsBetter
      />

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Node</th>
              <th className="text-left px-3 py-2 font-medium">Backend</th>
              <th className="text-right px-3 py-2 font-medium">Ops/s</th>
              <th className="text-right px-3 py-2 font-medium">Write P50</th>
              <th className="text-right px-3 py-2 font-medium">Write P99</th>
              <th className="text-right px-3 py-2 font-medium">Read P50</th>
              <th className="text-right px-3 py-2 font-medium">Read P99</th>
              <th className="text-right px-3 py-2 font-medium">Errors</th>
            </tr>
          </thead>
          <tbody>
            {nodesWithMetrics.map((n) => (
              <tr key={n.nodeId} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{n.name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {n.config.backends.map((b) => b.type).join(", ")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{n.metrics!.opsPerSecond}</td>
                <td className="px-3 py-2 text-right tabular-nums">{n.metrics!.writeLatencyP50}ms</td>
                <td className="px-3 py-2 text-right tabular-nums">{n.metrics!.writeLatencyP99}ms</td>
                <td className="px-3 py-2 text-right tabular-nums">{n.metrics!.readLatencyP50}ms</td>
                <td className="px-3 py-2 text-right tabular-nums">{n.metrics!.readLatencyP99}ms</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {(n.metrics!.errorRate * 100).toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricChart({
  title,
  icon,
  nodes,
  getValue,
  formatValue,
  maxValue,
  colorClass,
  lowerIsBetter,
}: {
  title: string;
  icon: React.ReactNode;
  nodes: Array<{ nodeId: string; name: string; metrics?: NodeMetrics; config: { backends: { type: string }[] } }>;
  getValue: (m: NodeMetrics) => number;
  formatValue: (v: number) => string;
  maxValue: number;
  colorClass: string;
  lowerIsBetter?: boolean;
}) {
  const sorted = [...nodes].sort((a, b) => {
    const aVal = getValue(a.metrics!);
    const bVal = getValue(b.metrics!);
    return lowerIsBetter ? aVal - bVal : bVal - aVal;
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3 text-muted-foreground">
        {icon}
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      <div className="space-y-2">
        {sorted.map((n, i) => {
          const value = getValue(n.metrics!);
          const width = (value / maxValue) * 100;
          const isBest = i === 0;
          return (
            <div key={n.nodeId} className="flex items-center gap-3">
              <span className={cn("w-32 text-xs truncate", isBest && "font-medium")}>
                {n.name}
              </span>
              <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden">
                <div
                  className={cn("h-full rounded transition-all", colorClass, isBest && "opacity-100", !isBest && "opacity-60")}
                  style={{ width: `${Math.max(width, 2)}%` }}
                />
              </div>
              <span className="w-24 text-xs text-right tabular-nums text-muted-foreground">
                {formatValue(value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

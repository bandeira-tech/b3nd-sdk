import { useEffect, useRef } from "react";
import { useAppStore } from "../../../stores/appStore";
import { HttpAdapter } from "../../../adapters/HttpAdapter";
import { useNodesStore } from "../stores/nodesStore";
import type { NodeStatus, NodeMetrics } from "../stores/nodesStore";

/**
 * Polling hook that reads node status/metrics URIs via HttpAdapter.
 * Polls all nodes in the active network at the specified interval.
 */
export function useNodeStatusPolling(intervalMs = 15000) {
  const backends = useAppStore((s) => s.backends);
  const activeBackendId = useAppStore((s) => s.activeBackendId);
  const networks = useNodesStore((s) => s.networks);
  const updateNodeStatus = useNodesStore((s) => s.updateNodeStatus);
  const updateNodeMetrics = useNodesStore((s) => s.updateNodeMetrics);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const activeBackend = backends.find((b) => b.id === activeBackendId);
    if (!activeBackend?.adapter || activeBackend.type !== "http") return;

    const adapter = activeBackend.adapter as HttpAdapter;

    async function pollAll() {
      for (const network of networks) {
        for (const node of network.nodes) {
          try {
            // Read status URI
            const statusPath = `/mutable/nodes/${node.nodeId}/status`;
            const statusRecord = await adapter.readRecord(statusPath);
            if (statusRecord?.data) {
              // Unwrap auth envelope if present
              const raw = statusRecord.data as any;
              const statusData = raw.payload ?? raw;
              updateNodeStatus(node.nodeId, statusData as NodeStatus);
            }
          } catch {
            // Node may not have reported yet
          }

          try {
            // Read metrics URI
            const metricsPath = `/mutable/nodes/${node.nodeId}/metrics`;
            const metricsRecord = await adapter.readRecord(metricsPath);
            if (metricsRecord?.data) {
              const raw = metricsRecord.data as any;
              const metricsData = raw.payload ?? raw;
              updateNodeMetrics(node.nodeId, metricsData as NodeMetrics);
            }
          } catch {
            // Metrics may not be available
          }
        }
      }
    }

    // Initial poll
    pollAll();

    // Set up interval
    timerRef.current = setInterval(pollAll, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [backends, activeBackendId, networks, intervalMs, updateNodeStatus, updateNodeMetrics]);
}

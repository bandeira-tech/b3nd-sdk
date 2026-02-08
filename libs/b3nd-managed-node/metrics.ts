/**
 * Metrics collector for managed nodes.
 *
 * Wraps a NodeProtocolInterface to collect latency/throughput stats
 * and periodically writes them to the metrics URI.
 */

import type { NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk";
import type { AuthenticatedMessage } from "@b3nd/encrypt";
import { createAuthenticatedMessage } from "@b3nd/encrypt";
import type { NodeMetrics } from "./types.ts";
import { nodeMetricsUri } from "./types.ts";

interface LatencyBucket {
  values: number[];
  errors: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

export interface MetricsCollectorOptions {
  metricsClient: NodeProtocolInterface;
  operatorPubKeyHex: string;
  nodeId: string;
  intervalMs: number;
  signer: { privateKey: CryptoKey; publicKeyHex: string };
}

export interface MetricsCollector {
  /** Record a write operation latency in ms */
  recordWrite(latencyMs: number): void;
  /** Record a read operation latency in ms */
  recordRead(latencyMs: number): void;
  /** Record an error */
  recordError(): void;
  /** Get the current snapshot */
  snapshot(): NodeMetrics;
  /** Start periodic reporting */
  start(): void;
  /** Stop periodic reporting */
  stop(): void;
  /** Wrap a client to auto-collect metrics */
  wrapClient(client: NodeProtocolInterface): NodeProtocolInterface;
}

export function createMetricsCollector(opts: MetricsCollectorOptions): MetricsCollector {
  let timer: ReturnType<typeof setInterval> | null = null;
  const writes: LatencyBucket = { values: [], errors: 0 };
  const reads: LatencyBucket = { values: [], errors: 0 };
  let totalOps = 0;
  let totalErrors = 0;
  let windowStart = Date.now();

  function snapshot(): NodeMetrics {
    const wSorted = [...writes.values].sort((a, b) => a - b);
    const rSorted = [...reads.values].sort((a, b) => a - b);
    const elapsed = Math.max(1, (Date.now() - windowStart) / 1000);

    return {
      writeLatencyP50: percentile(wSorted, 50),
      writeLatencyP99: percentile(wSorted, 99),
      readLatencyP50: percentile(rSorted, 50),
      readLatencyP99: percentile(rSorted, 99),
      opsPerSecond: Math.round(totalOps / elapsed),
      errorRate: totalOps > 0 ? totalErrors / totalOps : 0,
    };
  }

  async function report() {
    const metrics = snapshot();

    try {
      const message: AuthenticatedMessage<NodeMetrics> = await createAuthenticatedMessage(
        metrics,
        [opts.signer],
      );

      const uri = nodeMetricsUri(opts.operatorPubKeyHex, opts.nodeId);
      await opts.metricsClient.receive([uri, message]);
    } catch (error) {
      console.error("[metrics] Failed to write metrics:", error);
    }

    // Reset window
    writes.values = [];
    reads.values = [];
    totalOps = 0;
    totalErrors = 0;
    windowStart = Date.now();
  }

  function wrapClient(client: NodeProtocolInterface): NodeProtocolInterface {
    return {
      receive: async (...args: Parameters<NodeProtocolInterface["receive"]>) => {
        const start = performance.now();
        try {
          const result = await client.receive(...args);
          collector.recordWrite(performance.now() - start);
          return result;
        } catch (err) {
          collector.recordError();
          throw err;
        }
      },
      read: async (...args: Parameters<NodeProtocolInterface["read"]>) => {
        const start = performance.now();
        try {
          const result = await client.read(...args);
          collector.recordRead(performance.now() - start);
          return result;
        } catch (err) {
          collector.recordError();
          throw err;
        }
      },
      list: client.list.bind(client),
      delete: client.delete.bind(client),
      health: client.health?.bind(client),
      getSchema: client.getSchema?.bind(client),
    } as NodeProtocolInterface;
  }

  const collector: MetricsCollector = {
    recordWrite(latencyMs: number) {
      writes.values.push(latencyMs);
      totalOps++;
    },
    recordRead(latencyMs: number) {
      reads.values.push(latencyMs);
      totalOps++;
    },
    recordError() {
      totalErrors++;
      totalOps++;
    },
    snapshot,
    start() {
      if (timer) return;
      timer = setInterval(report, opts.intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    wrapClient,
  };

  return collector;
}

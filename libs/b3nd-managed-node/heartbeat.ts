/**
 * Heartbeat writer for managed nodes.
 *
 * Periodically writes a NodeStatus document to the node's status URI,
 * making it visible to the web UI and other monitoring tools.
 */

import type { NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk";
import type { AuthenticatedMessage } from "@b3nd/encrypt";
import { createAuthenticatedMessage } from "@b3nd/encrypt";
import type { BackendStatus, NodeMetrics, NodeStatus } from "./types.ts";
import { nodeStatusUri } from "./types.ts";

export interface HeartbeatWriterOptions {
  statusClient: NodeProtocolInterface;
  operatorPubKeyHex: string;
  nodeId: string;
  name: string;
  port: number;
  intervalMs: number;
  signer: { privateKey: CryptoKey; publicKeyHex: string };
  getBackendStatuses: () => BackendStatus[];
  getMetrics?: () => NodeMetrics | undefined;
}

export interface HeartbeatWriter {
  start(): void;
  stop(): void;
}

export function createHeartbeatWriter(opts: HeartbeatWriterOptions): HeartbeatWriter {
  let timer: ReturnType<typeof setInterval> | null = null;
  const startTime = Date.now();
  let configTimestamp = Date.now();

  async function writeHeartbeat() {
    const backends = opts.getBackendStatuses();
    const hasError = backends.some((b) => b.status === "error");

    const status: NodeStatus = {
      nodeId: opts.nodeId,
      name: opts.name,
      status: hasError ? "degraded" : "online",
      lastHeartbeat: Date.now(),
      uptime: Date.now() - startTime,
      configTimestamp,
      server: { port: opts.port },
      backends,
      metrics: opts.getMetrics?.(),
    };

    try {
      const message: AuthenticatedMessage<NodeStatus> = await createAuthenticatedMessage(
        status,
        [opts.signer],
      );

      const uri = nodeStatusUri(opts.operatorPubKeyHex, opts.nodeId);
      await opts.statusClient.receive([uri, message]);
    } catch (error) {
      console.error("[heartbeat] Failed to write status:", error);
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(writeHeartbeat, opts.intervalMs);
      writeHeartbeat();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

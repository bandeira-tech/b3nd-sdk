/**
 * Heartbeat writer for managed nodes.
 *
 * Periodically writes a signed+encrypted NodeStatus document to:
 *   mutable://accounts/{nodeKey}/status
 *
 * The node signs with its own Ed25519 key and encrypts to the operator's
 * X25519 key so only the operator/dashboard can read it.
 */

import type { NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk";
import { createSignedEncryptedMessage, encrypt, sign } from "@b3nd/encrypt";
import type { SignedEncryptedMessage } from "@b3nd/encrypt";
import type { BackendStatus, NodeMetrics, NodeStatus } from "./types.ts";
import { nodeStatusUri } from "./types.ts";

export interface HeartbeatWriterOptions {
  statusClient: NodeProtocolInterface;
  nodeId: string;
  name: string;
  port: number;
  intervalMs: number;
  signer: { privateKey: CryptoKey; publicKeyHex: string };
  operatorEncryptionPubKeyHex?: string;
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
      let message: SignedEncryptedMessage | { auth: Array<{ pubkey: string; signature: string }>; payload: NodeStatus };

      if (opts.operatorEncryptionPubKeyHex) {
        message = await createSignedEncryptedMessage(
          status,
          [opts.signer],
          opts.operatorEncryptionPubKeyHex,
        );
      } else {
        // Fallback: signed but not encrypted (for tests / local dev)
        const { createAuthenticatedMessage } = await import("@b3nd/encrypt");
        message = await createAuthenticatedMessage(status, [opts.signer]);
      }

      const uri = nodeStatusUri(opts.signer.publicKeyHex);
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

/**
 * Peer replication for managed nodes.
 *
 * Splits PeerSpec[] into push/pull client sets and wraps push clients
 * for best-effort delivery (non-fatal receive failures).
 */

import {
  HttpClient,
  type NodeProtocolInterface,
  type ReadResult,
} from "@bandeira-tech/b3nd-sdk";
import type { PeerSpec } from "./types.ts";

/**
 * Split peers into push and pull HttpClient sets.
 *
 * - Push peers (direction "push" or "bidirectional") receive writes via broadcast.
 * - Pull peers (direction "pull" or "bidirectional") serve as read fallbacks.
 */
export function createPeerClients(peers: PeerSpec[]): {
  pushClients: NodeProtocolInterface[];
  pullClients: NodeProtocolInterface[];
} {
  const pushClients: NodeProtocolInterface[] = [];
  const pullClients: NodeProtocolInterface[] = [];

  for (const peer of peers) {
    const client = new HttpClient({ url: peer.url });

    if (peer.direction === "push" || peer.direction === "bidirectional") {
      pushClients.push(client);
    }
    if (peer.direction === "pull" || peer.direction === "bidirectional") {
      pullClients.push(client);
    }
  }

  return { pushClients, pullClients };
}

/**
 * Wrap a client so receive() failures are non-fatal (best-effort push).
 *
 * On receive() error, logs a warning and returns `{ accepted: true }`.
 * All other methods delegate unchanged.
 */
export function bestEffortClient(
  client: NodeProtocolInterface,
): NodeProtocolInterface {
  return {
    async receive(msgs) {
      try {
        return await client.receive(msgs);
      } catch (err) {
        console.warn(
          `[peer] Best-effort push failed: ${(err as Error).message}`,
        );
        return msgs.map(() => ({ accepted: true }));
      }
    },
    read: (uris) => client.read(uris),
    // deno-lint-ignore require-yield
    async *observe<T = unknown>(
      _pattern: string,
      _signal: AbortSignal,
    ): AsyncIterable<ReadResult<T>> {
      // Not implemented.
    },
    status: () => client.status(),
  };
}

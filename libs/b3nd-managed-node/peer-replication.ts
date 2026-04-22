/**
 * @module
 * Peer replication for managed nodes.
 *
 * Splits `PeerSpec[]` into push/pull `Peer[]` lists suitable for passing
 * to `flood(peers)`, `pathVector(peers)`, or the `network()` verb from
 * `@bandeira-tech/b3nd-sdk/network`.
 *
 * Push peers come pre-wrapped with `bestEffort` so a single peer's
 * transient failure does not abort the broadcast fan-out.
 */

import { HttpClient } from "@bandeira-tech/b3nd-sdk";
import {
  bestEffort,
  peer,
  type Peer,
} from "@bandeira-tech/b3nd-sdk/network";
import type { PeerSpec } from "./types.ts";

/**
 * Split peers into push and pull `Peer[]` lists.
 *
 * - Push peers (direction `"push"` or `"bidirectional"`) receive writes
 *   via broadcast. Each is wrapped with `bestEffort` so transient
 *   per-peer failures are logged rather than fatal.
 * - Pull peers (direction `"pull"` or `"bidirectional"`) serve as read
 *   fallbacks. Not wrapped — read paths want transparent failures.
 *
 * Peer ids default to the peer's URL. Override by extending `PeerSpec`
 * and mapping to `peer(client, { id: myId })` before passing to the
 * network primitives.
 */
export function createPeerClients(peers: PeerSpec[]): {
  pushPeers: Peer[];
  pullPeers: Peer[];
} {
  const pushPeers: Peer[] = [];
  const pullPeers: Peer[] = [];

  for (const spec of peers) {
    const client = new HttpClient({ url: spec.url });

    if (spec.direction === "push" || spec.direction === "bidirectional") {
      pushPeers.push(peer(client, { id: spec.url, via: [bestEffort] }));
    }
    if (spec.direction === "pull" || spec.direction === "bidirectional") {
      pullPeers.push(peer(client, { id: spec.url }));
    }
  }

  return { pushPeers, pullPeers };
}

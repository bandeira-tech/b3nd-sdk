/**
 * @module
 * `createNetwork(peers, policy?)` — construct the **participant primitive**.
 *
 * The returned `Network` holds peers, policy, and a stable local id. It is
 * consumed by `work(rig, network)` to make a rig participate in the
 * network via observe bridges.
 *
 * Network is NOT a `NodeProtocolInterface`. For the remote-client shape
 * (outbound writes/reads through the same peer set) use `createFederation`.
 * Keeping the two as distinct types prevents the class of bugs where a
 * single object is used both as a connection AND as a work-bridge target,
 * which would loop on unauthenticated content.
 */

import { flood } from "./policies/flood.ts";
import type { Network, Peer, Policy } from "./types.ts";

/**
 * Build a Network from peers and a Policy (defaults to `flood()`).
 *
 * @example
 * ```ts
 * import { createNetwork, peer, work, pathVector } from "@bandeira-tech/b3nd-sdk/network";
 *
 * const n = createNetwork(
 *   [peer(clientB, { id: "B" }), peer(clientC, { id: "C" })],
 *   pathVector(),
 * );
 * const unbind = work(rig, n);
 * ```
 */
export function createNetwork(
  peers: Peer[],
  policy: Policy = flood(),
): Network {
  return buildSpec(peers, policy);
}

/**
 * Shared construction path used by both `createNetwork` and
 * `createFederation`. Validates peers, enforces unique ids, assigns a
 * stable `originId`. Internal — not exported.
 */
export function buildSpec(peers: Peer[], policy: Policy): Network {
  if (!peers || peers.length === 0) {
    throw new Error("createNetwork: peers[] must be non-empty");
  }
  const ids = new Set<string>();
  for (const p of peers) {
    if (ids.has(p.id)) {
      throw new Error(`createNetwork: duplicate peer id "${p.id}"`);
    }
    ids.add(p.id);
  }
  return {
    originId: `net-${crypto.randomUUID()}`,
    peers: Object.freeze([...peers]),
    policy,
  };
}

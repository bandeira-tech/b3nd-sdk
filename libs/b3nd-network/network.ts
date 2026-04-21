/**
 * @module
 * `createNetwork(peers, policy?)` — construct the **participant primitive**.
 *
 * Returns a callable: given a receive-target (typically a Rig) and an
 * optional options bag, it subscribes each peer's observe stream, passes
 * events through `Policy.receive` (pass-through when absent), and forwards
 * yielded events into `target.receive`. Returns an async unbind.
 *
 * ```ts
 * const net = createNetwork(peers, pathVector());
 * const unbind = net(rig, { pattern: "mutable://chat/*" });
 * await unbind();  // awaits clean teardown of every peer loop
 * ```
 *
 * Network is deliberately NOT a `NodeProtocolInterface`. Passing it to
 * `connection()` is a compile error. For the remote-client role, use
 * `createFederation()` instead.
 */

import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
} from "../b3nd-core/types.ts";
import { flood } from "./policies/flood.ts";
import type {
  InboundCtx,
  Network,
  NetworkOptions,
  Peer,
  Policy,
} from "./types.ts";

/**
 * Build a Network from peers and a Policy (defaults to `flood()`).
 *
 * @example
 * ```ts
 * import { createNetwork, peer, pathVector } from "@bandeira-tech/b3nd-sdk/network";
 *
 * const net = createNetwork(
 *   [peer(clientB, { id: "B" }), peer(clientC, { id: "C" })],
 *   pathVector(),
 * );
 * const unbind = net(rig);
 * ```
 */
export function createNetwork(
  peers: Peer[],
  policy: Policy = flood(),
): Network {
  const { originId, peers: frozenPeers } = buildSpec(peers, policy);

  return function attach(target, opts = {}) {
    const pattern = opts.pattern ?? "*";
    const ac = new AbortController();
    const onError = opts.onError ?? (() => {});

    const tasks = frozenPeers.map((peer) =>
      runPeer(peer, policy, originId, target, pattern, ac.signal, onError)
    );

    let unbound = false;
    return async () => {
      if (unbound) return;
      unbound = true;
      ac.abort();
      // Wait for every per-peer loop to exit so the caller can rely on
      // clean teardown (no leaked observe connections, no in-flight
      // receive calls). Resource-sanitizer-safe.
      await Promise.allSettled(tasks);
    };
  };
}

/**
 * Shared construction path used by both `createNetwork` and
 * `createFederation`. Validates peers, enforces unique ids, assigns a
 * stable `originId`, freezes the peer list.
 *
 * Internal, exported for `federation.ts` only.
 */
export function buildSpec(
  peers: Peer[],
  policy: Policy,
): { originId: string; peers: readonly Peer[]; policy: Policy } {
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

// ── Internals: the bridge ─────────────────────────────────────────────

/**
 * One peer's subscription loop. Kept as a separate function (not an
 * inline IIFE) so error stacks identify the misbehaving peer.
 */
async function runPeer(
  peer: Peer,
  policy: Policy,
  originId: string,
  target: Pick<NodeProtocolInterface, "receive">,
  pattern: string,
  signal: AbortSignal,
  onError: (err: Error, ctx: { peerId?: string }) => void,
): Promise<void> {
  const ctx: InboundCtx = { originId, source: peer };

  try {
    for await (const ev of peer.client.observe(pattern, signal)) {
      if (signal.aborted) break;
      const stream = policy.receive
        ? policy.receive(ev, peer, ctx)
        : passthrough(ev);
      for await (const out of stream) {
        if (signal.aborted) break;
        await forward(target, out, onError, peer.id);
      }
    }
  } catch (err) {
    onError(toError(err), { peerId: peer.id });
  }
}

/** Pass-through generator used when `policy.receive` is absent. */
async function* passthrough<T>(
  ev: ReadResult<T>,
): AsyncIterable<ReadResult<T>> {
  yield ev;
}

/** Forward one event into the target's `receive`. Swallows errors via `onError`. */
async function forward(
  target: Pick<NodeProtocolInterface, "receive">,
  ev: ReadResult<unknown>,
  onError: (err: Error, ctx: { peerId?: string }) => void,
  peerId: string,
): Promise<void> {
  if (!ev.uri || !ev.record) return;
  const msg: Message = [ev.uri, ev.record.values, ev.record.data];
  try {
    await target.receive([msg]);
  } catch (err) {
    onError(toError(err), { peerId });
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

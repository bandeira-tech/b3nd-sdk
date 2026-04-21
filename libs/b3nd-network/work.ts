/**
 * @module
 * `work(target, network, opts?)` — bind a Network's inbound observe streams
 * to a target's `receive` pipeline.
 *
 * Each configured peer has its `observe(pattern, signal)` subscribed
 * independently; events are tagged with their source peer and passed
 * through the Network's `Policy.receive` hook (pass-through when absent).
 * Yielded events are forwarded to `target.receive`.
 *
 * The `target` is typically a Rig — feeding events in via `rig.receive`
 * runs the full hooks/programs/reactions pipeline, so remote writes look
 * identical to local writes from the Rig's perspective. Any
 * `NodeProtocolInterface` works though.
 *
 * ## Scope
 *
 * The bridge only concerns itself with routing events. It does not carry
 * data sources on behalf of policies. Policies that need a store/cache/
 * index accept those at construction time:
 *
 * ```ts
 * tellAndRead({ local: myStore, ... })       // policy's own dependency
 * work(rig, createNetwork(peers, policy))    // bridge just wires events
 * ```
 *
 * ## Teardown
 *
 * `work()` returns an async unbind function. Calling it aborts every
 * peer's observe signal and awaits the per-peer loops to unwind so
 * sanitizer-clean shutdown is guaranteed.
 *
 * @example
 * ```ts
 * const unbind = work(rig, network);
 * // later:
 * await unbind();
 * ```
 */

import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
} from "../b3nd-core/types.ts";
import type { InboundCtx, Network, Peer, WorkOptions } from "./types.ts";

/**
 * Bind a Network's inbound observe streams to a target's receive pipeline.
 *
 * Returns an async unbind function. The unbind fully awaits per-peer
 * teardown so sanitizer-clean shutdown is guaranteed.
 */
export function work(
  target: Pick<NodeProtocolInterface, "receive">,
  network: Network,
  opts: WorkOptions = {},
): () => Promise<void> {
  const pattern = opts.pattern ?? "*";
  const ac = new AbortController();
  const onError = opts.onError ?? (() => {});

  const tasks = network.peers.map((peer) =>
    runPeer(peer, network, target, pattern, ac.signal, onError)
  );

  let unbound = false;
  return async () => {
    if (unbound) return;
    unbound = true;
    ac.abort();
    // Wait for all peer loops to exit so the caller can rely on clean
    // teardown (no leaked observe connections, no in-flight receive calls).
    await Promise.allSettled(tasks);
  };
}

// ── Internals ─────────────────────────────────────────────────────────

/**
 * One peer's subscription loop.
 *
 * Kept as a separate function (not an inline IIFE) so the stack trace on
 * errors identifies which peer misbehaved.
 */
async function runPeer(
  peer: Peer,
  network: Network,
  target: Pick<NodeProtocolInterface, "receive">,
  pattern: string,
  signal: AbortSignal,
  onError: (err: Error, ctx: { peerId?: string }) => void,
): Promise<void> {
  const { policy, originId } = network;
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
  if (!ev.uri || !ev.record) return; // incomplete / error events: skip
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

/**
 * @module
 * Types for `@bandeira-tech/b3nd-sdk/network` — the peer/network primitive.
 *
 * A **Network** is a `NodeProtocolInterface` composed of **Peer**s, governed
 * by a **Policy** that decides how outbound writes are transformed per peer
 * and how inbound events are translated before they reach a local rig.
 *
 * Loop avoidance, tell/read synchronization, rate-limiting, authenticated
 * relay — all expressed as Policies over the same primitive.
 */

import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
} from "../b3nd-core/types.ts";

/**
 * A peer is a client plus a stable id used for local routing control.
 *
 * The id is always present — auto-generated at runtime via `peer()` when
 * not supplied. Protocols that key on cryptographic identity (e.g.,
 * path-vector loop avoidance) pass their pubkey hex as the id explicitly.
 *
 * The id is not advertised on the wire by the network itself; it is
 * purely local bookkeeping used by Policies.
 */
export interface Peer {
  readonly id: string;
  readonly client: NodeProtocolInterface;
}

/**
 * A PeerDecorator wraps a client with middleware (best-effort, retry,
 * rate-limit, logging, etc.) while preserving the `NodeProtocolInterface`
 * shape. Applied via `peer(client, { via: [decoratorA, decoratorB] })`.
 */
export type PeerDecorator = (
  client: NodeProtocolInterface,
) => NodeProtocolInterface;

/**
 * Context passed to `Policy.send` — outbound path (rig → peer).
 */
export interface OutboundCtx {
  /** Local network identity (stable across the lifetime of this network). */
  readonly originId: string;
}

/**
 * Context passed to `Policy.receive` — inbound path (peer → rig).
 *
 * Carries only information the bridge uniquely knows at call time. Any
 * data sources a policy needs (local store, cache, index, etc.) are
 * the policy's own concern and should be injected at its construction,
 * not plumbed through the bridge.
 */
export interface InboundCtx {
  /** Local network identity. Useful for policies that stamp outbound
   *  messages with "from me"; most policies will ignore it. */
  readonly originId: string;
  /** The peer this event came from. `source.client` exposes `read`/`receive`
   *  for side-requests to the sender (e.g., pulling a full payload after
   *  an announcement). This is the only bridge-unique piece of state —
   *  without it, a policy cannot direct replies back to the origin. */
  readonly source: Peer;
}

/**
 * A Policy shapes the Network's behavior.
 *
 * All three hooks are optional. A Policy with no hooks is a pass-through
 * (equivalent to `flood()`): outbound messages fan to every peer unchanged,
 * inbound events pass through unchanged, reads try peers in order.
 *
 * Hooks are called on a per-peer basis — the same outbound batch is
 * offered to each peer separately, and each inbound event is tagged
 * with its source peer before being transformed.
 */
export interface Policy {
  /**
   * Per-peer batch transform on the outbound path. Called once per peer
   * for each `network.receive(msgs)`. Return the messages that should
   * actually be delivered to that peer. Return an empty array to skip
   * the peer entirely.
   *
   * Defaults to identity (`msgs`).
   */
  send?(msgs: Message[], peer: Peer, ctx: OutboundCtx): Message[];

  /**
   * Per-event transform on the inbound path. Bound by `work(rig, network)`
   * to observe streams from each peer. Yield zero or more events that
   * should be delivered into the consuming rig's pipeline.
   *
   * The async-generator shape lets the policy:
   *  - consume a control-plane event silently (yield nothing)
   *  - trigger a side-read from the source peer and yield the fetched
   *    content to the rig
   *  - pass the event through unchanged
   *
   * Defaults to identity (single-event pass-through).
   */
  receive?(
    ev: ReadResult<unknown>,
    source: Peer,
    ctx: InboundCtx,
  ): AsyncIterable<ReadResult<unknown>>;

  /**
   * Strategy for `network.read()`. `first-match` tries peers in order and
   * returns the first success. `merge-unique` fans out in parallel and
   * deduplicates results. Defaults to `first-match`.
   */
  read?: "first-match" | "merge-unique";
}

/**
 * A Network is a `NodeProtocolInterface` composed of peers.
 *
 * Two integration surfaces:
 *  - Use as a rig connection via `connection(network, patterns)` — the
 *    network becomes an outbound client the rig writes to / reads from /
 *    observes through.
 *  - Use as a bridge via `work(rig, network)` (shipped in a follow-up
 *    release) — binds the network's inbound observe streams to feed the
 *    rig's receive pipeline with side-effects routed via `Policy.receive`.
 */
export interface Network extends NodeProtocolInterface {
  /** Stable local id for this network instance. */
  readonly originId: string;
  /** Snapshot of the configured peers. Treat as immutable. */
  readonly peers: readonly Peer[];
  /** The Policy this network was built with. Exposed so the `work()`
   *  bridge and debugging tools can inspect/apply it. */
  readonly policy: Policy;
}

/**
 * Options for `work(target, network, opts?)`.
 *
 * Strictly bridge-level concerns. Policies carry their own data
 * dependencies (stores, caches, indexes) via factory construction — the
 * bridge does not plumb them.
 */
export interface WorkOptions {
  /**
   * Observe pattern subscribed to on each peer. Defaults to `"*"` —
   * every event is bridged. Narrow to reduce noise in busy networks.
   */
  pattern?: string;

  /**
   * Called when a peer's observe stream or `target.receive` throws.
   * Defaults to a silent catch so one bad peer/message does not tear
   * down the whole bridge.
   */
  onError?: (err: Error, ctx: { peerId?: string }) => void;
}

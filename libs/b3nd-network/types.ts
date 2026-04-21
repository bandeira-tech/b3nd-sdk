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
   * Per-event transform on the inbound path. Invoked by a Network's
   * attach call with the events observed from each peer. Yield zero or
   * more events that should be delivered into the consuming target's
   * pipeline.
   *
   * The async-generator shape lets the policy:
   *  - consume a control-plane event silently (yield nothing)
   *  - trigger a side-read from the source peer and yield the fetched
   *    content to the target
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
/**
 * A Network is the **participant primitive**: a function that, given a
 * receive-target (typically a Rig), wires the peers' observe streams into
 * the target's receive pipeline and returns an async unbind.
 *
 * Network is produced by `createNetwork(peers, policy?)` and encapsulates
 * everything about the participant mode in a single callable. Because it
 * is NOT a `NodeProtocolInterface`, it cannot be passed to `connection()`
 * — the type-level guard against the accidental loop that would otherwise
 * arise from composing the participant and remote-client roles on the
 * same object.
 *
 * For the remote-client role (outbound, `connection()`), construct a
 * `Federation` via `createFederation()` — same inputs, different output
 * type that *is* a `NodeProtocolInterface`.
 */
export type Network = (
  target: Pick<NodeProtocolInterface, "receive">,
  opts?: NetworkOptions,
) => () => Promise<void>;

/**
 * A Federation is the **remote-client primitive** — peers + policy
 * presented as a single `NodeProtocolInterface`. Consumed by
 * `connection(federation, patterns)` in a rig's connection list.
 *
 * Federation is deliberately *not* a `Network`. Passing one to
 * `work(rig, ...)` is a compile error. If your node needs both to
 * participate (Mode 3 / "full participant"), construct one of each
 * from the same inputs — they will cooperate correctly only if a
 * loop-avoidance Policy like `pathVector()` is in play, because the
 * outbound path cannot know the origin of an inbound message.
 */
export interface Federation extends NodeProtocolInterface {
  // Nominally distinct from Network via the absence of peers/policy/originId;
  // structurally it's just a NodeProtocolInterface.
}

/**
 * Options passed to the Network attach call — strictly bridge-level
 * concerns. Policies carry their own data dependencies (stores, caches,
 * indexes) via factory construction.
 */
export interface NetworkOptions {
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

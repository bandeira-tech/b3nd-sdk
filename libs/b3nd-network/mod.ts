/**
 * @module @bandeira-tech/b3nd-sdk/network
 *
 * Peer-network primitive: compose `NodeProtocolInterface` clients into a
 * single `Network` (also a `NodeProtocolInterface`) governed by a `Policy`.
 *
 * See `./types.ts` for the shape of `Peer`, `Policy`, `Network`, and the
 * inbound/outbound contexts. See `./policies/flood.ts` for the trivial
 * fan-out baseline.
 */

export type {
  Federation,
  InboundCtx,
  Network,
  NetworkOptions,
  OutboundCtx,
  Peer,
  PeerDecorator,
  Policy,
} from "./types.ts";
export { peer } from "./peer.ts";
export { createNetwork } from "./network.ts";
export { createFederation } from "./federation.ts";

// ── Policies ──────────────────────────────────────────────────────────
export { flood } from "./policies/flood.ts";
export { pathVector } from "./policies/path-vector.ts";
export { compose } from "./policies/compose.ts";

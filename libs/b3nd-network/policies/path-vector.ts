/**
 * @module
 * `pathVector()` — loop avoidance via the message's signer chain.
 *
 * Treats the `auth: [{pubkey, signature}]` array of an
 * `AuthenticatedMessage`-shaped payload as a path record. Before
 * forwarding to peer P, check whether P's `id` appears in that chain;
 * if yes, P has already seen (or signed) the message — skip it.
 *
 * This handles arbitrary-length cycles (A → B → C → A) without a
 * stateful seen-set, because the chain grows with every relay that
 * re-signs. It's free when messages already flow through
 * `AuthenticatedRig.send`; for plain messages without auth the filter
 * is a no-op and every peer receives the message.
 *
 * ## Peer id convention
 *
 * For this to work, `peer.id` must match the peer's signing pubkey
 * (typically the hex-encoded Ed25519 key). If you want pathVector
 * semantics, construct peers explicitly:
 *
 * ```ts
 * peer(client, { id: peerPubkeyHex })
 * ```
 *
 * Auto-assigned uuid ids won't match any signer and pathVector becomes
 * a no-op (not harmful, just ineffective).
 *
 * ## Scope
 *
 * pathVector only *reads* the chain. It does not add the local
 * identity's signature on relay — that's an orthogonal "relay-signing"
 * policy you'd compose on top when the downstream is expected to prune
 * via pathVector too.
 */

import type { Message } from "../../b3nd-core/types.ts";
import type { Peer, Policy } from "../types.ts";

export function pathVector(): Policy {
  return {
    send(msgs: Message[], peer: Peer): Message[] {
      return msgs.filter((msg) => !signerChain(msg).includes(peer.id));
    },
  };
}

/**
 * Extract the list of signer pubkeys from an `AuthenticatedMessage`-
 * shaped payload. Returns `[]` for any payload that doesn't carry an
 * `auth` array — non-authenticated messages flow freely.
 */
function signerChain(msg: Message): string[] {
  const [, , data] = msg;
  if (!data || typeof data !== "object") return [];
  const auth = (data as { auth?: unknown }).auth;
  if (!Array.isArray(auth)) return [];
  const keys: string[] = [];
  for (const entry of auth) {
    const pubkey = (entry as { pubkey?: unknown } | null)?.pubkey;
    if (typeof pubkey === "string") keys.push(pubkey);
  }
  return keys;
}

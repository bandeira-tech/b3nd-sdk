/**
 * @module
 * `compose(...policies)` — sequence multiple Policies into one.
 *
 * Outbound (`send`): each policy's `send` runs in listed order, passing
 * its output as input to the next. Use this to filter-then-rewrite
 * (e.g., `compose(pathVector(), tellAndRead(...))` — first drop peers
 * already in the signer chain, then transform remaining messages into
 * announcements per peer).
 *
 * Inbound (`receive`): each policy's `receive` runs in listed order as
 * an async-iterator chain. Every event yielded by `policies[i]` is fed
 * through `policies[i+1]`. A policy that yields nothing stops the
 * chain for that event; a policy that yields many produces a fan-out.
 *
 * `read`: first policy in the list that specifies `read` wins. Left-to-
 * right precedence keeps composition predictable.
 */

import type { ReadResult } from "../../b3nd-core/types.ts";
import type { InboundCtx, Peer, Policy } from "../types.ts";

export function compose(...policies: Policy[]): Policy {
  return {
    send(msgs, peer, ctx) {
      return policies.reduce<typeof msgs>(
        (current, p) => (p.send ? p.send(current, peer, ctx) : current),
        msgs,
      );
    },

    async *receive(ev, source, ctx) {
      const receives = policies
        .map((p) => p.receive?.bind(p))
        .filter((r): r is NonNullable<typeof r> => r !== undefined);
      yield* fold(ev, receives, source, ctx);
    },

    // First policy that declared a read strategy wins.
    read: policies.find((p) => p.read !== undefined)?.read,
  };
}

/**
 * Fold `fns` over `ev`: apply `fns[0]` to `ev`, then `fns[1]` to each
 * yielded event, etc. Returns a single async iterable of final events.
 */
async function* fold(
  ev: ReadResult<unknown>,
  fns: Array<
    (
      ev: ReadResult<unknown>,
      source: Peer,
      ctx: InboundCtx,
    ) => AsyncIterable<ReadResult<unknown>>
  >,
  source: Peer,
  ctx: InboundCtx,
): AsyncIterable<ReadResult<unknown>> {
  if (fns.length === 0) {
    yield ev;
    return;
  }
  const [first, ...rest] = fns;
  for await (const out of first(ev, source, ctx)) {
    yield* fold(out, rest, source, ctx);
  }
}

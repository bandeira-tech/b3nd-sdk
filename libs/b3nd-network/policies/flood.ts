/**
 * @module
 * `flood()` — the trivial policy: deliver every outbound message to every
 * peer unchanged, pass every inbound event through unchanged, read via
 * first-match.
 *
 * This is the baseline that makes a Network behave like the old
 * `parallelBroadcast` combinator. Use as a starting point; compose with
 * loop-avoidance policies (`splitHorizon`, `pathVector`) when peers are
 * bidirectional.
 */

import type { Policy } from "../types.ts";

export function flood(): Policy {
  return {
    send: (msgs) => msgs,
    // receive: identity pass-through — default behaviour in the network
    //   impl when `receive` is omitted, so no need to define here.
    read: "first-match",
  };
}

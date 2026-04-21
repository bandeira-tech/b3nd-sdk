# @bandeira-tech/b3nd-sdk/network

Peer-composition primitive for B3nd. Compose `NodeProtocolInterface` clients
into a single **Network** governed by a **Policy** that shapes outbound
fan-out, inbound event translation, and read strategy.

This is the building block for multi-node deployments, gossip protocols,
loop avoidance, and tell/read content synchronization. It does *not* ship
any of those behaviors by default — it ships the substrate they compose
against.

## Install & import

```ts
import {
  createNetwork,
  peer,
  flood,
  type Policy,
} from "@bandeira-tech/b3nd-sdk/network";
```

## Mental model

```
            outbound (rig → peers)                 inbound (peers → rig)
            ──────────────────────                 ──────────────────────
rig.receive ─▶ Network ─▶ Policy.send ─▶ peers    peers ─▶ Policy.receive ─▶ rig.receive
                         (per peer)                 (PR-2: via work(rig, network))

rig.read    ─▶ Network ─▶ Policy.read strategy ─▶ peers
rig.observe ─▶ Network ─▶ merged peer streams
```

A Network is a `NodeProtocolInterface`, so anywhere a rig accepts a client,
it accepts a network:

```ts
const net = createNetwork([
  peer(new HttpClient({ url: "https://node-b" })),
  peer(new HttpClient({ url: "https://node-c" })),
]);

const rig = new Rig({
  connections: [
    connection(localStore, { receive: ["*"], read: ["*"], observe: ["*"] }),
    connection(net, {
      receive: ["mutable://chat/*"],
      read:    ["mutable://chat/*"],
      observe: ["mutable://chat/*"],
    }),
  ],
});
```

## Concepts

### Peer

A `Peer` is a client plus a stable id used for local routing control.

```ts
peer(client)                           // id auto-assigned (runtime UUID)
peer(client, { id: "B" })              // explicit id — use for cryptographic
                                       // identities (e.g., pubkey-based
                                       // path-vector loop avoidance)
peer(client, { via: [bestEffort] })    // stack middleware
```

The id is *not* advertised on the wire by the Network itself. It is purely
local bookkeeping used by Policies. Protocols that need on-wire peer
identity attach it via message content (signed envelopes, auth chains,
etc.) — the Network does not assume a shape.

### Policy

```ts
interface Policy {
  send?(msgs: Message[], peer: Peer, ctx: OutboundCtx): Message[];
  receive?(ev: ReadResult, source: Peer, ctx: InboundCtx):
    AsyncIterable<ReadResult>;
  read?: "first-match" | "merge-unique";
}
```

- **`send`** is called once per peer for each outbound batch. Return the
  messages to actually deliver to that peer. Return an empty array to skip.
  Return a different set of messages to rewrite (e.g., announce instead of
  deliver full payload).
- **`receive`** translates inbound events. Useful for consuming
  control-plane messages silently, or pulling full content on demand via
  `ctx.source.client.read(uri)`. Wired in PR-2 via `work(rig, network)`.
- **`read`** picks the fan-out strategy. Default `first-match` tries peers
  in order until one has the URI. `merge-unique` parallelizes.

A Policy with no hooks is pass-through — equivalent to `flood()`.

### Network

A Network is a `NodeProtocolInterface` with two extra bits:

```ts
interface Network extends NodeProtocolInterface {
  readonly originId: string;           // stable local id for this instance
  readonly peers: readonly Peer[];     // snapshot of configured peers
}
```

## Composing a Policy

Policies are plain objects. The canonical policies (`splitHorizon`,
`pathVector`, `tellAndRead`) each ship as small factory functions that
return a `Policy`. Combine them with the `compose()` helper (PR-3):

```ts
const policy = compose(
  pathVector({ identity }),                  // skip peers already in signer chain
  tellAndRead({                              // advertise content, pull on interest
    announce: (msg) => myAnnounce(msg),
    onAnnounce: (ev, _, ctx) => myInterest(ev, ctx),
  }),
);
```

Policies are stateless from the framework's perspective. If yours needs
state (`inflight` sets, LRUs, etc.), close over it in the factory:

```ts
export function myPolicy(): Policy {
  const inflight = new Set<string>();
  return {
    send: (msgs, peer, ctx) => {
      // ... inflight tracked per factory invocation
    },
  };
}
```

## Ergonomics

**Batch-native.** `send` takes and returns `Message[]`, matching the rest
of the SDK. This lets policies batch announcements, compound INVs, or
split per-peer shaping in whatever way makes sense.

**URI-agnostic.** The framework never peeks at a URI scheme. `hash://`,
`mutable://`, `inv://`, `net://`, anything else — all opaque to the
Network. Protocols define URI layout and Policies act on it.

**Content-routed side-channels.** When a Policy needs to reply to a
specific peer (e.g., pull a full payload after an announcement), it calls
`ctx.source.client.read(uri)` or `ctx.source.client.receive([msg])`. There
is no special side-channel API — everything is addressed content flowing
through `NodeProtocolInterface`. Works in browsers, serverless, embedded.

**Loop avoidance is a Policy concern.** The rig core has no dedup. Use
`pathVector` (PR-3) for arbitrary cycles, `splitHorizon` for simple
bidirectional pairs. If your topology is a DAG (push-only on one side of
each edge), you need no policy — flood is safe.

## Roadmap

| PR | Status | Scope |
|----|--------|-------|
| PR-1 | ✅ merged | `peer`, `createNetwork`, `flood`, subpath export, tests |
| PR-2 | pending  | `work(rig, network)` — observe-bridge, source tagging, unbind |
| PR-3 | pending  | `splitHorizon`, `pathVector`, `compose` |
| PR-4 | pending  | `tellAndRead` helper + content-sync example |
| PR-5 | pending  | retire `b3nd-combinators`, port `createPeerClients` to `Peer[]` |

## Example: flood network

```ts
import { createNetwork, peer } from "@bandeira-tech/b3nd-sdk/network";
import { Rig, connection, HttpClient } from "@bandeira-tech/b3nd-sdk";

const net = createNetwork([
  peer(new HttpClient({ url: "https://node-b" }), { id: "B" }),
  peer(new HttpClient({ url: "https://node-c" }), { id: "C" }),
]);

const rig = new Rig({
  connections: [
    connection(net, { receive: ["*"], read: ["*"], observe: ["*"] }),
  ],
});

// Writes fan out to both peers.
await rig.receive([["mutable://shared/hello", {}, { text: "hi" }]]);

// Reads try B first, then C.
const r = await rig.read("mutable://shared/hello");

// Observe streams from both peers, merged.
const ac = new AbortController();
for await (const ev of rig.observe("mutable://shared/*", ac.signal)) {
  console.log(ev.uri, ev.record?.data);
}
```

## Example: per-peer rewrite (preview of PR-4)

```ts
import { createNetwork, peer, type Policy } from "@bandeira-tech/b3nd-sdk/network";

// Send full payload to trusted peers, announcement-only to untrusted ones.
const asymmetric: Policy = {
  send: (msgs, p) =>
    p.id.startsWith("trusted-") ? msgs : msgs.map(([uri]) => [
      `net://inv/${uri}`,
      {},
      { have: uri },
    ]),
};

const net = createNetwork(peers, asymmetric);
```

This shape is exactly what `tellAndRead` (PR-4) packages behind a clean
factory.

## Tests

See `network.test.ts`. Run with `deno test --allow-all libs/b3nd-network/`.
No sanitizer overrides — Deno's op and resource sanitizers are active on
every test.

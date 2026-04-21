# @bandeira-tech/b3nd-sdk/network

Peer-composition primitives for B3nd. Compose `NodeProtocolInterface`
clients into a peer set governed by a **Policy** that shapes outbound
fan-out, inbound event translation, and read strategy.

The library exposes **two deliberately distinct primitives** so the
wrong composition fails at the type level instead of silently looping:

- **`createNetwork(peers, policy?)` → Network** — the *participant* view.
  Consumed by `work(rig, network)` to make a rig receive events from peers
  via observe bridges. Network is **not** a `NodeProtocolInterface`; it
  cannot be passed to `connection()`.
- **`createFederation(peers, policy?)` → Federation** — the *remote-client*
  view. Consumed as a rig connection (`connection(federation, patterns)`)
  to fan writes/reads out across peers. Federation **is** a
  `NodeProtocolInterface` but hides `peers`/`policy`/`originId`, so it
  cannot be passed to `work()`.

Same input shape, different output types. No accidental both-ways.

## Install & import

```ts
import {
  createNetwork,
  createFederation,
  peer,
  work,
  pathVector,
  compose,
  type Policy,
} from "@bandeira-tech/b3nd-sdk/network";
```

## Mental model

```
Two primitives — same inputs, different consumers, disjoint types:

         peers + policy                peers + policy
              │                             │
              ▼                             ▼
     createNetwork(...)           createFederation(...)
              │                             │
              ▼                             ▼
            Network                      Federation
              │                             │
              ▼                             ▼
       work(rig, network)            connection(federation,
       (inbound observe bridge)        patterns)
                                      (outbound as NPI)
```

If you need both (full participant, Mode 3), construct one of each from
the same inputs — two objects, two roles. `pathVector()` with signed
messages makes this safe across unauthenticated loops.

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

Policies are plain objects. Canonical policies (`pathVector`, future
`tellAndRead`) each ship as small factory functions that return a
`Policy`. Combine them with the `compose()` helper:

```ts
const policy = compose(
  pathVector(),                              // skip peers already in signer chain
  tellAndRead({                              // advertise content, pull on interest
    announce: (msg) => myAnnounce(msg),
    onAnnounce: (ev, source) => myInterest(ev, source),
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

## Three deployment shapes

### Mode 1 — remote-client (Federation only)

```ts
const fed = createFederation(peers);
const rig = new Rig({
  connections: [connection(fed, { receive: ["*"], read: ["*"] })],
});
```

Use when the local rig is a *consumer* of the network. Writes fan to
every peer via `Policy.send`; reads delegate to peers by strategy.
Typical for browser apps, CLI tools, background workers — anything that
doesn't itself *participate* in gossip by serving observe streams back
to peers.

### Mode 2 — participant (Network only)

```ts
const net = createNetwork(peers);
const unbind = work(rig, net);
```

Use when the local rig *joins* the mesh by pulling from peers over
their observe streams. `work()` feeds the rig's receive pipeline with
events observed on each peer, tagged by source. Typical for nodes that
run their own HTTP/SSE server and are observed by other nodes in
return.

### Mode 3 — full participant (both — requires pathVector + signing)

```ts
const net = createNetwork(peers, pathVector());
const fed = createFederation(peers, pathVector());
work(rig, net);
new Rig({ connections: [connection(fed, patterns)] });
```

Two separate objects, two roles. `pathVector()` with
`AuthenticatedRig`-signed messages makes this safe: each message carries
a signer chain, and `pathVector` filters outbound peers that already
appear in it. Unsigned messages will loop infinitely because the
outbound path cannot know which peer an inbound message came from —
`pathVector` puts the origin *on the wire* so both paths can read it
without coordination.

For unsigned content, either:
- Use a DAG topology (push-only on one side of each edge).
- Write a `beforeReceive` rig hook that de-duplicates URIs (content-
  based seen-set). A canonical helper may ship in a later release.

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

**Loop avoidance is a Policy concern.** The rig core has no dedup.
`pathVector()` handles arbitrary cycles by inspecting the signer chain
on authenticated messages — stateless and correct by construction.
Unsigned bidirectional meshes need either a DAG topology or a rig-level
seen-set hook (see "Two modes" above).

## Roadmap

| PR | Status | Scope |
|----|--------|-------|
| PR-1 | ✅ merged | `peer`, `createNetwork`, `flood`, subpath export, tests |
| PR-2 | ✅ shipped | `work(target, network, opts?)` — observe-bridge, source tagging, unbind |
| PR-3 | ✅ shipped | `pathVector()`, `compose()` — loop avoidance via signer chain + policy composition |
| PR-4 | pending  | `tellAndRead` helper + content-sync example |
| PR-5 | pending  | retire `b3nd-combinators`, port `createPeerClients` to `Peer[]` |

## Example: bridging peers into a Rig

```ts
import { createNetwork, peer, work } from "@bandeira-tech/b3nd-sdk/network";
import {
  HttpClient,
  MemoryStore,
  Rig,
  SimpleClient,
  connection,
} from "@bandeira-tech/b3nd-sdk";

const local = new SimpleClient(new MemoryStore());
const net = createNetwork([
  peer(new HttpClient({ url: "https://node-b" }), { id: "B" }),
  peer(new HttpClient({ url: "https://node-c" }), { id: "C" }),
]);

const rig = new Rig({
  connections: [connection(local, { receive: ["*"], read: ["*"] })],
  reactions: {
    "mutable://chat/:id": (uri) => console.log("saw", uri),
  },
});

// Peer writes stream into the rig's receive pipeline and fire
// reactions / programs / hooks as if they were local writes.
const unbind = work(rig, net);
// later:
await unbind();
```

Note: `net` cannot be passed to `connection()` — it's a Network, not a
Federation. If you want the rig to also fan its own writes out to peers,
construct a Federation (Mode 3, see above).

### Policies carry their own dependencies

The bridge does **not** plumb data sources into policies. If a policy
needs a store, cache, or index to make decisions (e.g., "do I already
have this hash?"), it takes that dependency at construction time:

```ts
function myPolicy(opts: { store: NodeProtocolInterface }): Policy {
  return {
    async *receive(ev, source) {
      if (await hasLocal(opts.store, ev.uri)) return;
      yield ev;
    },
  };
}

const net = createNetwork(peers, myPolicy({ store: local }));
work(rig, net);
```

This keeps `WorkOptions` to pure bridge concerns (`pattern`, `onError`)
and keeps each policy's data needs explicit where they're used.

## Example: federation (remote-client)

```ts
import { createFederation, peer } from "@bandeira-tech/b3nd-sdk/network";
import { Rig, connection, HttpClient } from "@bandeira-tech/b3nd-sdk";

const fed = createFederation([
  peer(new HttpClient({ url: "https://node-b" }), { id: "B" }),
  peer(new HttpClient({ url: "https://node-c" }), { id: "C" }),
]);

const rig = new Rig({
  connections: [
    connection(fed, { receive: ["*"], read: ["*"], observe: ["*"] }),
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

## Example: signed full-participant mesh

```ts
import {
  createNetwork,
  createFederation,
  peer,
  pathVector,
  work,
} from "@bandeira-tech/b3nd-sdk/network";
import { AuthenticatedRig, Rig, connection, HttpClient } from "@bandeira-tech/b3nd-sdk";

// Peer ids MUST be the peers' signing pubkey (hex) for pathVector to
// recognize them in the signer chain.
const peers = [
  peer(new HttpClient({ url: "https://node-b" }), { id: bPubkeyHex }),
  peer(new HttpClient({ url: "https://node-c" }), { id: cPubkeyHex }),
];
const policy = pathVector();

// One object for each role. Same inputs, different output types —
// you cannot accidentally pass either to the wrong consumer.
const net = createNetwork(peers, policy);          // for work()
const fed = createFederation(peers, policy);       // for connection()

const rig = new Rig({
  connections: [
    connection(localStore, { receive: ["*"], read: ["*"] }),
    connection(fed,        { receive: ["mutable://*"] }),
  ],
});
work(rig, net);

// Use AuthenticatedRig so outbound messages carry a signer chain.
// When A signs a message and it reaches B, pathVector on B's fed drops
// the re-broadcast to A because A is already in the chain. Arbitrary
// longer cycles are also cut as the chain grows per relay.
```

## Example: per-peer rewrite (preview of PR-4)

```ts
import { createFederation, peer, type Policy } from "@bandeira-tech/b3nd-sdk/network";

// Send full payload to trusted peers, announcement-only to untrusted ones.
const asymmetric: Policy = {
  send: (msgs, p) =>
    p.id.startsWith("trusted-") ? msgs : msgs.map(([uri]) => [
      `net://inv/${uri}`,
      {},
      { have: uri },
    ]),
};

const fed = createFederation(peers, asymmetric);
```

This shape is exactly what `tellAndRead` (PR-4) packages behind a clean
factory.

## Tests

See `network.test.ts`. Run with `deno test --allow-all libs/b3nd-network/`.
No sanitizer overrides — Deno's op and resource sanitizers are active on
every test.

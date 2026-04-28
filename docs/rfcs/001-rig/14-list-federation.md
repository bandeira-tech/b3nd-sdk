# 14. Multi-source replicas — `flood(peers)`

A topology with two nodes holding overlapping state — primary and
mirror, regional shards, offline cache plus remote source — needs the
Rig to *talk to all of them* on writes and *gather from all of them* on
list reads. The Rig itself stays neutral: it dispatches by URI and
returns whatever each connection's client returns. Multi-source
behavior lives one layer down, in a client whose internal topology is
"these N peers."

That client ships in `@bandeira-tech/b3nd-sdk/network` as `flood(peers)`.

## What `flood(peers)` is

A `ProtocolInterfaceNode` factory. Given a list of `Peer` records, it
builds a single client that fans operations across every peer:

```ts
import { flood, peer, network, connection, Rig } from "@bandeira-tech/b3nd-sdk";

const peers = [
  peer("primary",    primaryClient),
  peer("mirror-east", mirrorClient),
  peer("mirror-west", mirrorClient2),
];

const rig = new Rig({
  connections: [
    connection(flood(peers), { receive: ["mutable://*"], read: ["mutable://*"] }),
  ],
});
```

From the Rig's perspective there is one connection. From the wire's
perspective every write reaches three nodes and every list read pulls
from all three.

## Behavior

- **`receive`** — fans every write out to every peer in parallel.
  Returns a single `ReceiveResult[]` aggregated across peers (one entry
  per input message). Per-peer outcomes surface through the Rig's
  `route:success` / `route:error` events on the operation handle (see
  Ch 13).
- **`read`** — tries peers in order; returns the first successful hit
  for point reads. For list reads (trailing-slash URIs) it gathers from
  every peer and merges the result set. The merged set is returned
  in the order peers are declared, with each peer's results appended
  in the order they were collected.
- **`observe`** — merges every peer's observe stream so subscribers
  see all changes regardless of which peer wrote them.
- **`status`** — aggregates peer health. Healthy if any peer is
  healthy; degraded if some are; unhealthy only when all fail.

De-duplication and ordering of merged list results is the caller's
concern — the right strategy depends on the protocol (timestamp
winner, vector-clock merge, content-address dedupe). Canon helpers
live in the SDK; `flood` itself stays mechanical.

## Why a peer-list client and not a Rig flag

Two reasons.

**The Rig is neutral.** A `federate` flag on the Rig would bake one
multi-source policy — "fan out to every connection that accepts" —
into the framework. Topologies that want different fan-out (round
robin, primary-with-fallback, quorum-of-three, gossip with
hop-counting) would each need a new flag. Instead, fan-out lives in a
client whose factory parameter is the peer list, and different
strategies are different factories: `flood(peers)`, `pathVector(peers)`,
and any future ones share the same `ProtocolInterfaceNode` shape.

**Composition is uniform.** Because `flood(peers)` returns a normal
client, it composes the same way every other client does — wrap it in
a `connection`, register patterns, hand it to the Rig. The same
operation handle, the same `route:success`/`route:error` events, the
same `read`/`observe`/`status` surface. There is no second framework
to learn.

## Other peer strategies that ship today

`@bandeira-tech/b3nd-sdk/network` exports a small family:

- **`flood(peers)`** — fan to all peers; gather list reads from all
  peers. The default for "I want every write to reach every replica."
- **`pathVector(peers)`** — gossip with hop counting and path-vector
  routing. Used by nodes that want to participate in a peer mesh
  rather than just talk to a fixed list.
- **`tellAndRead({...})`** — small sync helper that posts a write and
  immediately reads back from a target peer. Useful for read-after-write
  semantics across asymmetric topologies.
- **`bestEffort(peer)`** — peer decorator that turns transient peer
  failures into observe-stream gaps instead of receive errors. Used to
  wrap individual peers when the topology should keep running with
  some peers down.
- **`network(target, peers, policies?, opts?)`** — the participant verb
  for nodes that want to subscribe peer observe streams and forward
  inbound messages into a target's receive pipeline. Typically the
  target *is* a Rig.

All of them are clients (or client decorators, or participant verbs)
with the same `ProtocolInterfaceNode` shape. The Rig is the consumer.

## Per-peer observability via Rig events

`flood`'s internal fan-out is opaque to the Rig — the Rig sees one
connection and one `ReceiveResult[]` return. Per-peer detail is
surfaced through the Rig's operation handle:

```ts
const op = rig.receive(msgs);

op.on("route:success", (e) => metrics.write_success.inc({ peer: e.connectionId }));
op.on("route:error",   (e) => retryQueue.push({ peer: e.connectionId, msg: e.emission }));

const results = await op;
await op.settled;
```

Connection IDs flow through. Inside `flood`, each peer's outcome
becomes one `route:*` event with `connectionId` set to the peer's
declared name (the first argument to `peer(name, client)`).

## What this chapter does not introduce

- **No new Rig methods.** `flood(peers)` is just a client. The Rig
  treats it like every other connection.
- **No federate flag, no broadcast policy on the Rig.** The fan-out
  lives in the client. The Rig stays neutral.
- **No Rig-level dedupe or sort.** Canon helpers handle the common
  cases; protocol-specific merge strategies live in protocol packages.

## Relationship to Ch 13

Chapter 13 turned per-route observability into events on an operation
handle. Chapter 14 supplies the topology where those events are most
useful: when one Rig connection is itself a client over N peers, the
`route:success` / `route:error` events are how callers see per-peer
outcomes. The two chapters compose: `flood(peers)` for the topology,
`OperationHandle` events for the visibility.

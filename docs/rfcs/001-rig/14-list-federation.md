# 14. Multi-source replicas — `flood(peers)`

A topology with overlapping state across nodes — primary and mirror,
regional shards, offline cache plus remote source — needs writes to
reach every replica and list reads to gather across them.

That logic lives in a client. The rig stays neutral; it routes by
URI and trusts each connection's client to handle its own internal
topology. `flood(peers)` is the canon client for the multi-replica
shape.

## What `flood(peers)` is

A `ProtocolInterfaceNode` factory. Given a list of `Peer` records,
it returns a single client that fans operations across every peer:

```ts
import {
  Rig, connection, flood, peer,
} from "@bandeira-tech/b3nd-sdk";

const peers = [
  peer("primary",     primaryClient),
  peer("mirror-east", mirrorClient),
  peer("mirror-west", mirrorClient2),
];

const replicaSet = connection(flood(peers), ["mutable://*"]);

const rig = new Rig({
  routes: {
    receive: [replicaSet],
    read:    [replicaSet],
    observe: [replicaSet],
  },
});
```

From the rig's perspective there's one connection. From the wire's
perspective every write reaches three nodes and every list read
pulls from all three.

## Behavior

| Op | What flood does |
|---|---|
| `receive` | Fans every write to every peer in parallel. Per-peer outcomes surface as `route:*` events on the operation handle, with `connectionId` set to the peer name. |
| `read` (point) | Tries peers in declaration order; returns the first successful hit. |
| `read` (trailing-slash list) | Gathers from every peer; merges the result set in declaration order. |
| `observe` | Merges every peer's observe stream into one iterator. |
| `status` | Aggregates peer health: healthy if all peers are; degraded if some; unhealthy only when all fail. |

De-duplication and ordering of merged list results is the caller's
choice — timestamp winner, vector-clock merge, content-address
dedupe — because the right strategy depends on the protocol. The
SDK ships canon helpers; `flood` itself stays mechanical.

## Per-peer observability

`flood`'s fan-out shows up on the rig's operation handle. The
`connectionId` on each `route:*` event is the peer's name (the
first argument to `peer(name, client)`).

```ts
const op = rig.receive(msgs);
op.on("route:success", (e) => metrics.write_success.inc({ peer: e.connectionId }));
op.on("route:error",   (e) => retryQueue.push({ peer: e.connectionId, msg: e.emission }));

await op;
await op.settled;
```

## Other peer strategies that ship today

`@bandeira-tech/b3nd-sdk/network` exports a small family. Each
returns a `ProtocolInterfaceNode` (or a participant verb) and
plugs into the rig the same way:

| Export | What it does |
|---|---|
| `flood(peers)` | Fan to all peers; first-match point reads; gather list reads. |
| `pathVector(peers)` | Gossip with hop counting and path-vector loop avoidance. |
| `tellAndRead({...})` | INV/READ-style sync — post a small announcement, peers pull on demand. |
| `bestEffort(peer)` | Peer decorator: transient peer failures become observe-stream gaps instead of receive errors. |
| `network(target, peers, policies?, opts?)` | Participant verb — subscribes peer observe streams and forwards inbound events into `target.receive`. The target is typically a rig. |

All compose with the rig through `connection(...)` (or, for
`network`, by being called with the rig as target).

## Composition with operation events

Chapter 13 introduced per-route events on the operation handle.
Chapter 14 supplies the topology where those events earn their
keep: when one rig connection wraps `flood(peers)`, each peer's
outcome shows up as a `route:*` event tagged with the peer name.
Strict policies, best-effort policies, and quorum policies are all
composed in caller code from the events.

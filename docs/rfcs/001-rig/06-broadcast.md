# 6. Broadcast — what the rig does with a handler's return

A handler returns `Output[]`. The rig dispatches each tuple through
connection routing. The step in between is **broadcast**.

```
handler → Output[] → rig.broadcast(outs) → connection routing → clients
```

Broadcast is internal — handlers don't call it, app code doesn't call
it. The rig invokes it after each `handle` step.

## What broadcast does

For each tuple a handler returned:

1. Match the URI against every connection in `routes.receive`.
2. Dispatch to every accepting connection's client.
3. Fire `route:success` or `route:error` on the operation handle for
   each `(emission, connection)` pair (Ch 13).
4. Once at least one route accepts, schedule reactions whose URI
   patterns match the tuple's URI.

The same dispatch engine that handles top-level direct writes runs
here.

## Handler emissions skip classification

The handler is the canonical interpreter of the protocol code its
classification produced. By the time it returned, the protocol's
logic already decided what should land on the wire. Broadcast runs
the routing matcher and the client dispatch only — programs do not
run again on handler emissions.

For "I want my emissions classified" semantics — defense-in-depth,
or emitting into namespaces governed by other programs — use a
reaction instead. Reactions flow through `rig.send`, which runs the
full pipeline (Ch 7).

## Direction is set once

The direction (`send` or `receive`) is established by the caller and
applies to the whole call. Subscribers to `send:success` see one
event per top-level call — for the original tuple the host
dispatched. A handler that decomposes one envelope into ten outputs
fires one `send:success` for the envelope; the ten emissions land
without firing more direction-level events.

For per-emission detail — including detail on the handler's outputs
— subscribe to the operation handle's scoped events (Ch 13):

| Event | Fires when |
|---|---|
| `process:done` | A program produced a classification |
| `handle:emit` | A handler returned its emissions |
| `route:success` | One connection accepted one emission |
| `route:error` | One connection rejected one emission |
| `settled` | All routes for the operation reported |

```ts
const op = rig.send([envelope]);
op.on("route:success", (e) => {
  metrics.write_success.inc({ uri: e.emission[0], conn: e.connectionId });
});
op.on("route:error", (e) => {
  retryQueue.push({ tuple: e.emission, target: e.connectionId });
});
await op;          // pipeline ack
await op.settled;   // all routes finished
```

`connectionId` is the `id` passed to `connection(..., opts)` or an
auto-generated `conn-{N}`. When the underlying client itself fans
across peers (`flood(peers)`, Ch 14), the peer name surfaces as the
connection ID.

## Aggregation policy lives in callers

The rig stays neutral about what "accepted" means when N routes
accepted and M rejected. Callers compose their policy — strict (all
routes must accept), best-effort (any route is fine), quorum
(majority) — by listening to `route:*` events.

## Reactions

Broadcast fires reactions on each successfully-broadcast tuple's URI.
Reaction emissions go through `rig.send` (full pipeline) and produce
their own operation handles. Chapter 7 walks the reaction layer in
full.

## Routes recap

`routes.receive` is the fan-out target. `routes.read` and
`routes.observe` are consulted for those ops. Each connection is
`(client, patterns: string[])` — a flat pattern list per connection,
with the same connection bound into multiple routes when the same
filter applies to multiple ops.

```ts
import { connection, Rig } from "@bandeira-tech/b3nd-sdk";

const primary = connection(httpClient, ["mutable://*"], { id: "primary" });
const cache   = connection(redisClient, ["mutable://accounts/*"]);

const rig = new Rig({
  routes: {
    receive: [primary],
    read:    [cache, primary], // try cache first
    observe: [primary],
  },
});
```

A handler emits a URI; the URI flows through `routes.receive` and
lands at the matching connections.

## What's coming next

Reactions — productive observation. Reaction emissions go through
the full pipeline (programs and all), and that's where chains of
notifications, indexes, and audit logs come from.

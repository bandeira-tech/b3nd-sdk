# 6. Broadcast — what the Rig does with a handler's return

A handler returns `Output[]`. The Rig takes those tuples and puts them
on the wire. The step in between is **broadcast**.

```
handler → Output[] → Rig.broadcast(outs) → connection routing → clients
```

Broadcast is internal — handlers don't call it, app code doesn't call
it directly. It's the Rig's mechanism for translating a handler's
return into actual connection-level dispatches.

## What broadcast does

For each tuple a handler returned:

1. Match the URI against every registered connection's `receive`
   patterns.
2. For every connection that accepts, dispatch the tuple to that
   connection's client.
3. Emit a `route:success` or `route:error` event on the operation
   handle for each `(emission, connection)` pair (Ch 13).
4. Schedule reactions whose URI patterns match the tuple's URI, once
   at least one route accepted.

The same dispatch engine that handles top-level direct writes runs
here. There's no second routing engine for handler emissions; it's
the same one, called by the Rig as part of finishing a `handle` step.

## Why broadcast skips classification

A handler is the canonical interpreter of the protocol code its
classification produced. By the time the handler returned, the
protocol's logic has already decided what should land on the wire.
Re-running programs on each handler-emitted tuple would either
duplicate work the handler already did, or — worse — re-classify a
tuple in a state that has changed since the handler decided to emit
it.

So broadcast doesn't run programs. It runs the routing matcher and
the client dispatch. Programs are entered through `process`, exited
by the time `handle` runs, and stay exited for everything `handle`
produces.

If a protocol genuinely wants its handler emissions classified — for
defense-in-depth, or because a handler emits tuples claimed by
*other* programs the handler doesn't trust — the right shape is to
make those emissions reactions instead of handler outputs. Reactions
flow through `rig.send`, which runs programs (Ch 7).

## Why broadcast is direction-free

A handler runs *inside* a `send` or a `receive`. The direction was
established by the caller; the handler doesn't get to relabel it.
Broadcast emits the handler's tuples without a new direction.

Observationally: subscribers to `send:success` see one event for the
original send (the tuple the host put into the pipeline), not one for
every emission the handler produced. A handler that decomposes one
envelope into ten output tuples doesn't fire ten `send:success`
events; it fires one for the original envelope and the ten emissions
are dispatched as part of completing that send.

If a host wants observable per-tuple events for handler emissions, the
right shape is to make those emissions reactions instead — reactions
go through full `rig.send` and do fire `send:*` events for each.

## Per-route events on the operation handle

Each connection that accepts a broadcast tuple becomes a route. The
operation handle fires:

- `route:success` — `{ emission, connectionId, result }` once the
  connection's client returned a successful `ReceiveResult`.
- `route:error` — `{ emission, connectionId, error }` if the
  connection's client returned `accepted: false` or threw.

`connectionId` is either the explicit `id` passed to `connection(...,
opts)` or an auto-generated `conn-{N}`. When the underlying client
fans across peers (`flood(peers)`, Ch 14), the peer name flows
through as the connection ID at that level.

Aggregation across routes — what counts as "accepted" when N routes
accepted and M rejected — is **not** the Rig's job. The Rig stays
neutral; callers compose the policy they want from `route:*` events.

## What broadcast doesn't fire

- **No `send:*` or `receive:*` events** for the broadcast tuples.
  Only the original direction call's events fire, once, for the
  triggering tuple.
- **No re-classification.** Broadcast bypasses `process`.
- **No new hook firings.** `beforeReceive`/`afterReceive` etc. fire
  only at the direction-call boundary, not for each broadcast.

These exclusions are what makes broadcast cheap. A handler can emit
many tuples without paying for a full pipeline pass per tuple. The
cost is the connection-routing dispatch and the reaction scheduling.

## Reactions on broadcast tuples

Broadcast does fire reactions, because reactions observe writes
regardless of how the write arrived. If a handler emits a tuple
addressed at `mutable://app/users/alice/profile`, any reaction
registered on `mutable://app/users/:id/profile` fires for it. This is
the right behavior: reactions are about what changed in the state,
not about how the change was triggered.

Reaction handling happens after the broadcast finishes. The Rig
collects matching reactions, runs them with the broadcast tuple as
input, takes their `Output[]` returns, and feeds them through
`rig.send` as a new pipeline pass with its own operation handle.
Chapter 7 walks through the reaction layer in full.

## When a handler's return is empty

A handler can return `[]`. The Rig has nothing to broadcast for that
tuple. No reactions fire (nothing was written). The pipeline records
the result as accepted (the handler ran, it just chose not to emit)
and moves on. This is the "classify, then drop" shape — rare, usually
expressible as a program rejection instead, but allowed.

## Broadcast and connection routing — the hand-off

Connection-pattern routing is the single point of fan-out control.
The Rig is configured with a list of connections; each connection has
patterns for `receive` (and optionally `read`, `observe`); each
pattern is matched against the URI of every tuple the Rig is
dispatching. The match decides where the tuple goes.

Broadcast is the mechanism that hands off to this engine. A handler
benefits from this without having to think about it. It says "emit
these URIs," and the URIs carry the routing decision with them.

## What's coming next

Reactions — productive observation. What it means for a reaction
handler to return `Output[]`, why those go through `rig.send` (full
pipeline) instead of broadcast (skip programs), and how to think
about the chain of reactions firing reactions firing reactions.

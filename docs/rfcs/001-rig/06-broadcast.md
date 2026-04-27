# 6. Broadcast — what the Rig does with a handler's return

A handler returns `Output[]`. The Rig takes those tuples and puts them
on the wire. The step in between is **broadcast**.

```
handler → Output[] → Rig.broadcast(outs) → connection routing → clients
```

Broadcast is internal — handlers don't call it, app code doesn't call
it directly. It's the Rig's mechanism for translating a handler's
return into actual connection-level dispatches. Naming it matters
because the same word covered the imperative API in earlier proposals;
here it's the orchestration step the Rig performs after `handle`
returns.

## What broadcast does

For each tuple a handler returned:

1. Match the URI against every registered connection's `receive`
   patterns.
2. For every connection that accepts, dispatch the tuple to that
   connection's client.
3. Aggregate the per-connection results into a single `ReceiveResult`
   per tuple.
4. Schedule reactions whose URI patterns match the tuple's URI.

That's it. The same dispatch engine that handles top-level direct
writes to the Rig runs here. There's no second routing engine for
handler emissions; it's the same one, called by the Rig as part of
finishing a `handle` step.

## Why broadcast skips classification

A handler is the canonical interpreter of the protocol code its
classification produced. By the time the handler returned, the
protocol's logic has already decided what should land on the wire.
Re-running programs on each handler-emitted tuple would either
duplicate work the handler already did, or — worse — re-classify a
tuple in a state that has changed since the handler decided to emit
it.

So broadcast doesn't run programs. It runs the routing matcher and the
client dispatch. Programs are entered through `process`, exited by the
time `handle` runs, and stay exited for everything `handle` produces.

If a protocol genuinely wants its handler emissions classified — for
defense-in-depth, or because a handler emits tuples claimed by
*other* programs the handler doesn't trust — the host application
calls `rig.receive` or `rig.send` from outside the handler with those
tuples. That's a fresh top-level call, not a handler-internal escape
hatch. (Reactions are the framework's blessed shape for "I want my
emissions to flow through programs"; see chapter 7.)

## Why broadcast is direction-free

A handler runs *inside* a `send` or a `receive`. The direction was
established by the caller; the handler doesn't get to relabel it.
Broadcast emits the handler's tuples without a new direction.

What this means observationally: subscribers to `send:success` see one
event for the original send (the tuple the host put into the
pipeline), not one for every emission the handler produced. A handler
that decomposes one envelope into ten output tuples doesn't fire ten
`send:success` events; it fires one for the original envelope and the
ten emissions are dispatched as part of completing that send.

If a host genuinely wants observable per-tuple events for handler
emissions, the right shape is to make those emissions reactions
instead — reactions go through full `rig.send` and do fire `send:*`
events for each. (Chapter 7 again.)

## Per-connection results

Each connection that accepted a broadcast tuple returns its own
result. The aggregation rule — what counts as accepted when N
connections accepted and M rejected — is covered in chapter 13. For
now: broadcast returns aggregated per-tuple results, with the
per-connection breakdown attached when more than one connection was
involved.

## What broadcast doesn't fire

- **No `send:*` or `receive:*` events** for the broadcast tuples. Only
  the original direction call's events fire, once, for the triggering
  tuple.
- **No re-classification.** Broadcast bypasses `process`. If
  classification is wanted, the handler made the wrong choice — it
  should have returned its emissions through a path that re-enters
  the pipeline, which today means making them reactions, not handler
  outputs.
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
`rig.send` as a new pipeline pass. Chapter 7 walks through the
reaction layer in full.

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

Broadcast is the mechanism that hands off to this engine. It's how
"the handler said to emit this URI" becomes "this URI lands at
whichever connections accept it." A handler benefits from this without
having to think about it. It says "emit these URIs," and the URIs
carry the routing decision with them.

## What changed in this chapter

- Broadcast is the Rig's internal step that takes a handler's
  returned `Output[]` and dispatches each tuple through connection
  routing.
- It's not in the handler signature. Handlers don't have a broadcast
  function to call; they return data and the Rig broadcasts.
- Broadcast skips classification (handlers are canonical) and skips
  direction events (the original direction event fired once at the
  top of the call).
- Broadcast does fire reactions on dispatched tuples, because
  reactions observe writes.
- A handler returning `[]` is a no-op broadcast; the call still
  completes successfully.

## What's coming next

Reactions — productive observation. What it means for a reaction
handler to return `Output[]`, why those go through `rig.send` (full
pipeline) instead of broadcast (skip programs), and how to think about
the chain of reactions firing reactions firing reactions.

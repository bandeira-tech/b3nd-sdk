# 6. Broadcast — the only fan-out

A handler has one tool for putting tuples on the wire. It's called
`broadcast`. It takes an `Output[]` and dispatches each tuple through
connection routing.

```ts
type BroadcastFn = (outs: Output[]) => Promise<ReceiveResult[]>;
```

That's the entire fan-out story. There is no other primitive. There is no
"send to peer X", no "write to backend Y", no "fan out to subscribers" —
just `broadcast(outs)` and the connection patterns that decide where each
tuple lands.

## What broadcast does

For each tuple:

1. Match the URI against every registered connection's `receive` patterns.
2. For every connection that accepts, dispatch the tuple to that
   connection's client.
3. Aggregate the per-connection results into a single `ReceiveResult` per
   tuple.
4. Fire any reactions whose URI patterns match.

That's it. The same dispatch engine the Rig uses for default-write tuples
runs here. Handlers don't get a different routing story; they get the same
one, exposed to them as a function.

This means if a handler emits ten tuples with ten different URIs, those
ten tuples can land in ten different topologies — some written only to
local memory, some replicated across primary and mirror, some forwarded
to peers, some sent to a webhook. The handler doesn't know or care; it
trusts the connection patterns the Rig was configured with.

## Why broadcast is direction-free

A handler runs *inside* a `send` or a `receive`. The direction is already
established by the caller; the handler doesn't get to relabel it. So when
the handler calls `broadcast`, the tuples it emits are direction-free —
they don't fire `send:*` events for a downstream broadcast and they don't
fire `receive:*` either.

The reasoning: the original direction was the caller's intent at the top
of the pipeline. "I am sending this" or "I received this." Whatever the
handler decides to do with the tuple internally — broadcast its
constituent parts, broadcast a derived audit record, broadcast a fee
charge — those emissions are consequences of the original act, not new
acts of their own. A subscriber to `send:success` should see one event
for the original send, not one for every constituent the handler chose
to emit.

If a handler genuinely needs to start a new act of its own — to invoke
the pipeline as a fresh `send` or `receive` — that's re-entry, covered in
the next chapter, and it's deliberately a different verb.

## What broadcast does fire

**Reactions.** Reactions observe writes regardless of how the write
arrived. If a handler broadcasts to `mutable://app/users/alice/profile`,
any reaction registered on `mutable://app/users/:id/profile` fires. This
is the right behavior: reactions are about what changed in the state, not
about how the change was triggered.

**Per-connection results.** Each connection that accepted the broadcast
returns its own result. The aggregation rules — what counts as accepted
when N connections accepted and M rejected — are covered in chapter 13.
For now: `broadcast` returns a `ReceiveResult[]` parallel to its input,
each carrying the aggregated per-tuple result.

**Default dispatch for downstream pipelines.** When a tuple broadcast
reaches a connection whose backend is itself a Rig (e.g., a `Rig`-as-client
composition), that downstream Rig receives the tuple as input to its own
`receive`. That downstream pipeline runs its own programs, its own
handlers, its own reactions. From the upstream handler's perspective, the
downstream Rig is just another client.

## What broadcast doesn't fire

- No `send:*` or `receive:*` events for the broadcast tuples themselves
  (only the original direction call's events fire, once, for the
  triggering tuple).
- No re-classification — broadcast bypasses `process`. If the handler
  wants the tuples it's emitting to be re-classified, it calls `receive`
  or `send` instead. (See chapter 7.)
- No new hook firings — `beforeReceive`/`afterReceive` etc. fire only at
  the direction-call boundary, not for each broadcast.

These exclusions are what makes `broadcast` cheap. A handler can emit
many tuples without paying for a full pipeline pass per tuple. The cost
is the connection-routing dispatch and the reactions, which scale with
how many connections accept and how many reactions match.

## Broadcast and connection routing — the hand-off

The connection-pattern routing engine is the single point of fan-out
control. The Rig is configured with a list of connections; each
connection has patterns for `receive` (and optionally `read`,
`observe`); each pattern is matched against the URI of every tuple
that's broadcast or received-as-default. The match decides where the
tuple goes.

This is why the framework needs to know URIs (chapter 2). URIs are the
only piece of a tuple that's used for routing. Programs use URIs to
classify; connections use URIs to accept or refuse. Everything else
about the tuple is opaque to the routing layer.

A handler benefits from this without having to think about it. It says
"broadcast this URI", and the URI carries the routing decision with it.

## When a handler doesn't broadcast

A handler can choose to do nothing. If it returns without calling
`broadcast`, the original tuple does not get persisted, no reactions
fire, no events emit. This is "classify, then drop" — the protocol
decides the tuple is acceptable but should not be retained.

It's rare. Most cases are better expressed as the program returning an
error code in the first place. But the framework allows it for protocols
where "process for telemetry only, don't persist" is a real shape.

## What changed in this chapter

- `broadcast(outs)` is the handler's only tool for emitting tuples.
- `broadcast` dispatches through the same connection-pattern routing the
  Rig uses for default writes.
- `broadcast` is direction-free: emitted tuples don't fire `send:*` or
  `receive:*` events; only the original direction call's events fire.
- `broadcast` does fire reactions, because reactions observe writes, not
  acts.
- `broadcast` skips re-classification by design — handlers that need
  re-classification call `receive` or `send` (next chapter).

## What's coming next

Re-entry. When a handler legitimately needs to start a new direction
call — typically because the tuples it's emitting must run a different
protocol's programs — and how to keep that explicit instead of magical.

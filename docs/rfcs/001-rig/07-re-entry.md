# 7. Re-entry, when a handler needs another pass

Most handlers broadcast and stop. Some need to do more.

A handler runs inside the pipeline. It already has a tuple, a
classification, a `broadcast` function, a `read` function. For most
protocols those tools cover everything: classify, decompose, broadcast,
done. But occasionally a handler needs to start a new pipeline pass — to
treat some derived tuple as if it had arrived freshly through `receive`,
running its own programs and its own handlers in turn.

That's re-entry. The framework allows it; it just makes you ask for it
explicitly.

## What re-entry means

A handler can call `rig.receive(outs)` or `rig.send(outs)` from inside
its body. The pipeline runs, fully — `process` classifies the new tuples,
`handle` dispatches each to its registered handler (which can itself
re-enter), reactions fire, the direction's hooks and events fire. From
the framework's perspective the re-entry call is indistinguishable from
the host application calling `receive` or `send` directly.

```ts
const compoundHandler: CodeHandler = async (out, broadcast, read) => {
  // Step 1: persist the original tuple
  await broadcast([out]);
  // Step 2: derive a downstream tuple and run a *new* pipeline pass on it
  //         (because the downstream tuple has its own program logic)
  const derived = await deriveDownstreamTuple(out);
  await rig.receive([derived]);
};
```

Re-entry is a recursive call into the same Rig. It's deliberately written
out long-form (`rig.receive(...)`) instead of being smuggled in via some
implicit recursion, because protocol authors should see when they're
asking for a fresh pipeline pass and what direction they're declaring
when they do.

## When re-entry is the right tool

Three situations, in our experience.

**A handler that emits tuples needing different programs.** Suppose a
handler for code `"envelope:msgdata"` decomposes a `MessageData` envelope
into per-output tuples. If those per-output tuples themselves have URI
prefixes governed by *other* programs (signature verification on
`mutable://accounts/...`, fee enforcement on `fees://...`), the handler
needs those other programs to run before the tuples persist. Plain
`broadcast` skips programs. `rig.receive(outs)` runs them.

**A handler that bridges directions.** A handler running inside `send`
might need to re-enter as `receive` for tuples that should be treated as
"arrived from elsewhere" — because the host's local replication should
treat them with the inbound rate limits, not the outbound ones. Re-entry
with the opposite direction is allowed and is sometimes the cleanest way
to make the policy split visible.

**A handler that schedules later work.** A handler that wants to defer
some part of its dispatch — write the immediate tuple now, queue a
follow-up tuple for later — can use re-entry as the consistent shape for
both the immediate and the deferred work. The deferred call goes through
the same `receive`/`send` body; nothing is lost in the queue.

## When `broadcast` is the right tool, not re-entry

If the handler already knows what it wants to write and doesn't need
those tuples re-classified, `broadcast` is right. The most common case —
"persist the envelope plus its outputs plus its input deletions" — is
just `broadcast`. The handler is the canonical interpreter; it has
already done the protocol-level reasoning; the constituent tuples are
known-correct in the protocol's eyes; classification would be redundant.

If the handler also knows the connection topology will route the tuples
correctly without further programs interfering, `broadcast` is right.
Re-entry is the escape hatch for when programs *should* re-fire on the
emitted tuples.

A useful test: would your handler want a peer's classification policy to
apply to the tuples it emits? If yes, re-entry. If no, broadcast.

## What re-entry costs

Re-entry runs the full pipeline for each call. That includes hook
overhead, event emissions, reaction matching for each emitted tuple. For
multi-tuple emissions, prefer `rig.receive(outs)` over a loop of
`rig.receive([out])` — batch through the pipeline once.

Re-entry can recurse without bound. The framework does not detect
cycles; if your handler re-enters with a tuple whose code triggers a
handler that re-enters with the same tuple, you have an infinite loop.
This is a protocol-level concern. The convention we'd suggest in canon:
re-entry should descend the URI namespace (handler at `link://envelope/x`
re-enters with tuples at `mutable://state/y`, never at the same prefix
that brought it in). Programs and handlers that observe this convention
cannot recurse indefinitely.

If a protocol genuinely needs unbounded recursion, it should encode a
depth bound in the tuple itself and check it in the program — the
framework will not.

## What re-entry is not

Re-entry is not a primitive distinct from `send` and `receive`. There is
no `rig.recurse` or `rig.continue`. The same direction-flavored entry
points the host application uses are what handlers use to re-enter. This
keeps the surface small and keeps the meaning consistent — a re-entry as
`receive` carries the same observational semantics as any other
`receive`.

Re-entry is not how decomposition works. Decomposition (chapter 8) uses
`broadcast` because the decomposed tuples are protocol-valid by
construction — the canonical decomposition handler has already done the
protocol-level reasoning. Re-entry is for the rarer case where decomposed
tuples need to flow through *other* programs that the original handler
isn't responsible for.

## What changed in this chapter

- Re-entry is the explicit `rig.receive(outs)` / `rig.send(outs)` call
  from inside a handler.
- The framework offers no implicit recursion mechanism. If you want a
  full pipeline pass, you ask for one.
- Re-entry is the right tool when emitted tuples need to flow through
  other programs; `broadcast` is the right tool when the handler is the
  canonical interpreter and emitted tuples are protocol-valid by
  construction.
- Re-entry runs the full pipeline (hooks, events, reactions). Cycle
  detection is a protocol concern, not a framework one.

## What's coming next

Part IV — conventions live in protocols. Decomposition is first:
how `MessageData` envelopes get unpacked, why that unpacking lives in a
protocol-supplied handler instead of a framework-blessed client, and how
N-level nested envelopes flow through the same pattern.

# 3. Process, handle, react

A tuple arrives at the Rig. Three things happen, in order, on a single
codepath. This is the pipeline.

```
process  →  handle  →  react
```

Three pure transforms. None of them fire side effects directly. Each
returns data; the Rig is what does anything with that data. The
direction-flavored entry points (`send` and `receive`, Ch 4) wrap the
pipeline in different hooks and events but run the same body. One
pipeline, run twice for two reasons.

## The shape

```
input: outs: Output[]
       │
       ▼
┌──────────────┐
│  process     │ ─────► ProgramResult[]   (one per output)
└──────────────┘
       │
       ▼
┌──────────────┐
│  handle      │ ─────► Output[]          (handler-emitted broadcasts)
└──────────────┘
       │
       │   the Rig dispatches handler outputs through connection
       │   routing (no re-classification — handlers are canonical)
       │
       ▼
┌──────────────┐
│  react       │ ─────► Output[]          (reaction-emitted tuples)
└──────────────┘
       │
       │   the Rig sends reaction outputs back through `rig.send` —
       │   they re-enter the pipeline (programs do classify them)
       │
       ▼
   (further pipeline activity, until the chain settles)
```

Each phase is a function with no externally-visible side effects of
its own. The Rig orchestrates: it calls `process`, takes the codes,
calls `handle`, takes the broadcasts, dispatches them, observes for
reaction matches, calls `react`, takes the resulting tuples, and feeds
them back through the pipeline as new sends. Every effect on the wire
happens inside the Rig's orchestration layer.

That property is the chapter's whole point. Handlers and reactions are
data transforms; the Rig is the engine. Bugs in a handler can't
accidentally write to the wrong URI because the handler doesn't have
write authority — it just returns tuples and the Rig decides what to
do with them.

## Process — classify the tuple

`process` runs the registered programs. A program is a pure function
that looks at a tuple and returns a code:

```ts
type ProgramResult = { code: string; error?: string };

type Program<T = unknown> = (
  out: Output<T>,
  upstream: Output | undefined,
  read: ReadFn,
) => Promise<ProgramResult>;
```

A program is registered against a URI prefix. When `process` is called
on a tuple, the Rig finds the longest-prefix-matching program and
invokes it. The program decides what the tuple *means* in protocol
terms — `"valid"`, `"insufficient-funds"`, `"replay"`,
`"requires-signature"`, whatever the protocol's vocabulary says. The
framework doesn't interpret the code; it just hands it to the next
phase.

Programs are pure. They can read from the Rig (the `read` argument is
the Rig's read interface) but they don't write, broadcast, or mutate
anything. A program either classifies or it errors. If it errors, the
pipeline stops for that tuple — no handle, no react, the result
bubbles up as `{ accepted: false, error }`.

`process` is a public verb on the Rig — useful for dry-runs, for
protocol authors who want to classify without dispatching, for tools
that batch classify and route in some other way.

## Handle — return the broadcasts

`handle` takes a tuple and the result of its classification and runs
the handler registered for that code. A handler returns the `Output[]`
it wants the Rig to broadcast:

```ts
type CodeHandler = (
  out: Output,
  result: ProgramResult,
  read: ReadFn,
) => Promise<Output[]>;
```

The handler's job is interpretation — given a classified tuple,
decide what should land on the wire as a result. It returns those
outputs. The Rig receives them and dispatches them through connection
routing **without re-classification**. The handler is the canonical
interpreter; its outputs are protocol-valid by handler-fiat. Programs
running again would be redundant and, in some protocols, wrong (the
classification could depend on state that has now changed).

Common handler shapes:

- **persist** — `return [out]` (the simple "write this" case)
- **decompose** — `return [envelope, ...payload.outputs, ...deletions]`
- **conditional** — `return existing.success ? [] : [out]`
- **refuse** — `return []`

If no handler is registered for the returned code, the Rig dispatches
the tuple itself directly. This is the default-write path — the
equivalent of a one-line handler that returns `[out]`. It exists so
that simple protocols don't need to register trivial passthrough
handlers.

`handle` is also a public verb. Callers who want to skip
classification — because they already classified elsewhere, or
because they're constructing a synthetic flow — call `handle`
directly. There is no `{ skipPrograms: true }` flag on `send` or
`receive`; if you want "trust this tuple, just dispatch it", you call
`handle(out, { code: "trusted" })` and register a handler for
`"trusted"` that returns `[out]`. Everything is explicit.

## React — return more tuples

`react` matches each successfully-dispatched tuple's URI against
registered URI patterns and runs any matching reaction handlers.
Reactions, like handlers, are pure: they receive the tuple and return
`Output[]`:

```ts
type Reaction = (
  out: Output,
  read: ReadFn,
) => Promise<Output[]>;
```

What the Rig does with a reaction's returned outputs is different
from what it does with a handler's. **Reaction outputs flow back
through `rig.send` — they re-enter the pipeline.** Programs run on
them. Handlers run on them. More reactions can fire. The chain
unfolds until some level returns no further outputs.

The reasoning for the asymmetry: a handler is the protocol's
canonical interpreter and its outputs are *known* protocol-valid by
virtue of the handler having produced them. A reaction is an
application-level observer responding to what just happened, and its
emissions might target URIs governed by entirely different programs —
programs that the reaction author may not even know about. Those need
full classification.

Reactions are not exposed as a public verb. There is no
`rig.react(out)` callable. Reactions run automatically by the Rig in
response to successful dispatches inside the pipeline. This keeps
observation bound to actual side effects and prevents callers from
firing fake reactions for real ones.

Loops in reactions — a reaction fires a tuple that fires the same
reaction — are usage error. The framework does not detect them. Cycle
prevention is a protocol-design concern: arrange URIs so reaction
emissions descend the URI namespace rather than re-targeting the
prefix that fired them, and chains terminate naturally.

## The public surface

The Rig has these methods related to the pipeline:

```ts
class Rig {
  process(outs: Output[]): Promise<ProgramResult[]>;
  handle(out: Output, result: ProgramResult): Promise<Output[]>;

  // Direction-flavored wrappers (Ch 4) — return OperationHandle.
  receive(outs: Output[]): OperationHandle;
  send(outs: Output[]): OperationHandle;
}
```

`process` and `handle` are first-class verbs — how protocols compose
the framework. `receive` and `send` are the most common entry points;
they wrap the pipeline in direction-specific hooks and events,
trigger reactions, and return an `OperationHandle` (Ch 13) that's
both awaitable (for the pipeline result) and a scoped event emitter
(for per-route detail).

## Why three phases instead of one

Programs are useful on their own. A linter, a dry-run, a batch
validator — these need `process` exposed. Hiding it inside a
monolithic dispatch forces tools to re-implement classification.

Handlers are useful on their own. A protocol that already has a
classification (because it just received a peer's `ProgramResult`
over the wire, or because it's replaying a log of pre-classified
tuples) needs `handle` exposed. Forcing a re-classification would be
redundant and, in some protocols, incorrect.

The `process → handle → react` triple is the natural composition.
Splitting the public surface there matches how protocols already
think.

## Why pure transforms instead of imperative effects

A pure-return contract makes the framework smaller and protocols
testable in isolation. A handler is a function from input to output
that you can test by calling it and asserting on the return value. No
Rig instance, no mock. Same for reactions.

A pure-return contract also moves every effect to the boundary. A
handler that wants an HTTP call to happen returns an `Output` to a
URI that an outbound-HTTP client claims, and the call happens through
routing. Side effects are visible on the wire, testable, replicable.
The same machinery that fans out a UTXO write to two stores fans out
a "user update" notification to an email service. One uniform model.

## What's coming next

`send` and `receive` — the two direction-flavored wrappers around the
pipeline, and why they differ only in hooks and events.

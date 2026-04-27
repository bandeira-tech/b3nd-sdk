# 3. Process, handle, react

A tuple arrives at the Rig. Three things happen, in order, on a single
codepath. This is the pipeline.

```
process  →  handle  →  react
```

Three pure transforms. None of them fire side effects directly. Each
returns data; the Rig is what does anything with that data. The
direction-flavored entry points (`send` and `receive`, covered in the
next chapter) wrap the pipeline in different hooks and events but run
the same body. One pipeline, run twice for two reasons.

## The shape, in one diagram

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
the Rig's read interface, idempotent and effect-free in the protocol's
eyes) but they don't write, broadcast, or mutate anything. A program
either classifies or it errors. If it errors, the pipeline stops for
that tuple — no handle, no react, the result bubbles up as
`{ accepted: false, error }`.

Process exposed publicly:

```ts
class Rig {
  async process(outs: Output[]): Promise<ProgramResult[]>;
}
```

Callers can run process on its own — useful for dry-runs, for protocol
authors who want to classify without dispatching, for tools that batch
classify and route in some other way.

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

The handler's job is interpretation — given a classified tuple, decide
what should land on the wire as a result. It returns those outputs. The
Rig receives them and dispatches them through connection routing
**without re-classification**. The handler is the canonical
interpreter; its outputs are protocol-valid by handler-fiat. Programs
running again would be redundant and, in some protocols, wrong (the
classification could depend on state that has now changed).

If a handler wants to do nothing, it returns `[]`. If it wants to emit
the original tuple as-is (the simplest "persist this" case), it returns
`[out]`. If it wants to decompose an envelope, it returns the
decomposed pieces (chapter 8). Whatever it returns gets dispatched.

If no handler is registered for the returned code, the Rig dispatches
the tuple itself directly. This is the default-write path — the
equivalent of a one-line handler that returns `[out]`. It exists so
that simple protocols don't need to register trivial passthrough
handlers.

Handle exposed publicly:

```ts
class Rig {
  async handle(out: Output, result: ProgramResult): Promise<Output[]>;
}
```

Callers who want to skip classification — because they already
classified elsewhere, or because they're constructing a synthetic flow
— call `handle` directly with a code they know the Rig has a handler
for. This is the only way to bypass classification. There is no
`{ skipPrograms: true }` flag on `send` or `receive`. If you want the
effect of "trust this tuple, just dispatch it", you call
`handle(out, { code: "trusted" })` and register a handler for
`"trusted"` that returns `[out]`. Everything is explicit; there are no
hidden modes.

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

What the Rig does with a reaction's returned outputs is different from
what it does with a handler's. **Reaction outputs flow back through
`rig.send` — they re-enter the pipeline.** Programs run on them.
Handlers run on them. More reactions can fire. The chain unfolds until
some level returns no further outputs.

The reasoning for the asymmetry: a handler is the protocol's canonical
interpreter and its outputs are *known* protocol-valid by virtue of
the handler having produced them. A reaction is an application-level
observer responding to what just happened, and its emissions might
target URIs governed by entirely different programs — programs that
the reaction author may not even know about. Those need full
classification.

The other consequence: reactions are not exposed as a public verb.
There is no `rig.react(out)` you can invoke. Reactions run
automatically by the Rig in response to successful dispatches inside
the pipeline. This keeps observation bound to actual side effects and
prevents callers from firing fake reactions for real ones.

Loops in reactions — a reaction fires a tuple that fires the same
reaction — are usage error. The framework does not detect them. Cycle
prevention is a protocol-design concern: arrange URIs so reaction
emissions descend the URI namespace rather than re-targeting the
prefix that fired them, and chains terminate naturally.

## What the public surface looks like

After this chapter, the Rig has these methods related to the pipeline:

```ts
class Rig {
  async process(outs: Output[]): Promise<ProgramResult[]>;
  async handle(out: Output, result: ProgramResult): Promise<Output[]>;

  // Direction-flavored wrappers from the next chapter:
  async receive(outs: Output[]): Promise<ReceiveResult[]>;
  async send(outs: Output[]): Promise<ReceiveResult[]>;
}
```

`process` and `handle` are first-class verbs — how protocols compose
the framework. `receive` and `send` are the most common entry points;
they wrap the pair in direction-specific hooks and events and trigger
the reaction phase after dispatch.

## Why three phases instead of one

We considered collapsing process and handle into a single
`dispatch(outs)` that does both. We rejected it for two reasons.

First, programs are useful on their own. Tooling that wants to
classify without acting — a linter, a dry-run, a batch validator —
needs `process` exposed. Hiding it inside a monolithic dispatch forces
these tools to re-implement classification.

Second, handlers are useful on their own. A protocol that already has
a classification (because it just received a peer's `ProgramResult`
over the wire, or because it's replaying a log of pre-classified
tuples) needs `handle` exposed. Forcing a re-classification would be
redundant and, in some protocols, incorrect — a tuple's classification
can depend on state that has since changed.

The `process → handle → react` triple is the natural composition.
Splitting the public surface there matches how protocols already
think.

## Why pure transforms instead of imperative effects

We considered keeping today's signature where handlers receive a
`broadcast` function and call it imperatively. We rejected it.

A pure-return contract makes the framework smaller and protocols
testable in isolation. A handler today needs a mock `broadcast` to be
unit-tested; after this proposal, it's a function from input to output
that you can test by calling it and asserting on the return value. No
Rig instance, no mock. Same for reactions.

A pure-return contract also moves every effect to the boundary. Today
a handler can fetch from an external HTTP API, write to a queue, push
to a webhook — invisibly. After this proposal, those effects all
become tuples emitted to URIs that some client claims, dispatched
through the same routing the rest of the system uses. Side effects
are visible on the wire, testable, replicable. The same machinery
that fans out a UTXO write to two stores fans out a "user update"
notification to an email service. One uniform model.

The cost is conceptual: you have to think of handlers as "build the
emissions list" rather than "do the work imperatively." In practice
this is a one-line change for the simple persist case (`return [out]`)
and a clearer-to-read change for everything else.

## What changed in this chapter

- `process(outs)` returns `ProgramResult[]`. Pure.
- `handle(out, result)` returns `Output[]`. Pure. The Rig dispatches
  those outputs via broadcast (no re-classification).
- `react(out)` runs registered reaction handlers, each of which returns
  `Output[]`. The Rig sends those through `rig.send`, re-entering the
  pipeline (programs run, handlers run, more reactions can fire).
- The asymmetry is deliberate: handlers are canonical interpreters,
  reactions are application observers.
- No handler for a code → Rig dispatches the tuple directly (default
  persist).
- Process and handle are public verbs; react is internal.
- Loops in reactions are usage error.

## What's coming next

`send` and `receive` — the two direction-flavored wrappers around the
pipeline, and why they differ only in hooks and events.

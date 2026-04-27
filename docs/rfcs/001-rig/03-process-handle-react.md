# 3. Process, handle, react

A tuple arrives at the Rig. Three things happen, in order, on a single
codepath. This is the pipeline.

```
process  →  handle  →  react
```

That's the whole shape. The direction-flavored entry points (`send` and
`receive`, covered in the next chapter) wrap this pipeline in different
hooks and events but run the same body. There is one pipeline, run twice
for two reasons.

## Process — classify the tuple

`process` runs the registered programs. A program is a pure function that
looks at a tuple and returns a code:

```ts
type ProgramResult = { code: string; error?: string };

type Program<T = unknown> = (
  out: Output<T>,
  upstream: Output | undefined,
  read: ReadFn,
) => Promise<ProgramResult>;
```

A program is registered against a URI prefix. When `process` is called on a
tuple, the Rig finds the longest-prefix-matching program and invokes it. The
program decides what the tuple *means* in protocol terms — `"valid"`,
`"insufficient-funds"`, `"replay"`, `"requires-signature"`, whatever the
protocol's vocabulary says. The framework doesn't interpret the code; it just
hands it to the next phase.

Programs are pure. They can read from the Rig (the `read` argument is the
Rig's read interface) but they don't write, broadcast, or mutate anything.
A program either classifies or it errors. If it errors, the pipeline stops
for that tuple — no handle, no react, the result bubbles up as
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

## Handle — dispatch on the code

`handle` takes a tuple and the result of its classification and runs the
handler registered for that code. A handler is the canonical interpreter
of what should happen when a tuple is classified as `code`:

```ts
type CodeHandler = (
  out: Output,
  broadcast: (outs: Output[]) => Promise<ReceiveResult[]>,
  read: ReadFn,
) => Promise<void>;
```

The handler receives the tuple, a `broadcast` function for putting more
tuples on the wire, and `read` for inspecting state. What it does with
those is the protocol's choice — chapter 5 dwells on this.

If no handler is registered for the returned code, the Rig dispatches the
tuple directly through connection routing. This is the default-write path:
no protocol-specific handling, just persist via whichever connections accept
the URI.

Handle exposed publicly:

```ts
class Rig {
  async handle(out: Output, result: ProgramResult): Promise<void>;
}
```

Callers who want to skip classification — because they already classified
elsewhere, or because they're constructing a synthetic flow — can call
`handle` directly with a code they know the Rig has a handler for.

This is the only way to bypass classification. There is no `{ skipPrograms:
true }` flag on `send` or `receive`. If you want the effect of "trust this
tuple, just dispatch it", you call `handle(out, { code: "trusted" })` and
register a handler for `"trusted"` that broadcasts. Everything is explicit;
there are no hidden modes.

## React — fire pattern-matched observers

`react` matches the tuple's URI against registered URI patterns and fires
any matching observer functions. Reactions are fire-and-forget — they don't
block, they don't return values, they don't affect the pipeline outcome.

Reactions are not exposed as a public verb. There is no `rig.react(out)` you
can invoke. They run automatically at the end of `handle` for any tuple that
the handler-or-default-dispatch successfully wrote. This keeps observation
where it belongs — bound to actual side-effects — and prevents callers from
firing fake reactions for real ones.

Reactions are how a host application responds to messages — render an
update in a UI, send a notification, log to an analytics pipeline, kick off
a job. They observe; they don't decide.

## What the public surface looks like

After this chapter, the Rig has these methods related to the pipeline:

```ts
class Rig {
  async process(outs: Output[]): Promise<ProgramResult[]>;
  async handle(out: Output, result: ProgramResult): Promise<void>;

  // Plus the direction-flavored wrappers from the next chapter:
  async receive(outs: Output[]): Promise<ReceiveResult[]>;
  async send(outs: Output[]): Promise<ReceiveResult[]>;
}
```

`process` and `handle` are first-class verbs. They're how protocols compose
the framework. `receive` and `send` are the most common entry points — they
wrap the pair in direction-specific hooks and events.

## Why three phases instead of one

We considered collapsing process and handle into a single `dispatch(outs)`
that does both. We rejected it for two reasons.

First, programs are useful on their own. Tooling that wants to classify
without acting — a linter, a dry-run, a batch validator — needs `process`
exposed. Hiding it inside a monolithic dispatch forces these tools to
re-implement classification.

Second, handlers are useful on their own. A protocol that already has a
classification (because it just received a peer's `ProgramResult` over the
wire, or because it's replaying a log of pre-classified tuples) needs
`handle` exposed. Forcing a re-classification would be redundant and, in
some protocols, incorrect — a tuple's classification can depend on state
that has since changed.

The `process → handle → react` triple is the natural composition. Splitting
the public surface there matches how protocols already think.

## What changed in this chapter

- `process(outs)` and `handle(out, result)` are public methods on `Rig`.
- Programs are pure classifiers; handlers are protocol-defined dispatchers;
  reactions are pattern-matched observers fired automatically after a
  successful write.
- There is no `{ skipPrograms: true }` flag. Bypass is `handle` called
  directly with an explicit code.

## What's coming next

`send` and `receive` — the two direction-flavored wrappers around the
pipeline, and why they differ only in hooks and events.

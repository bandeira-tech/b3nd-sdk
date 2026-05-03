# 3. Process, handle, react

A tuple arrives. Three phases run on a single codepath.

```
process  →  handle  →  react
```

Each phase is a pure function: it returns data, the rig acts on the
data. `send` and `receive` (Ch 4) are direction-flavored wrappers
that share this body and differ only in which hooks fire and which
events emit.

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
       │   the rig dispatches handler outputs through connection
       │   routing — handlers are canonical, no re-classification
       │
       ▼
┌──────────────┐
│  react       │ ─────► Output[]          (reaction-emitted tuples)
└──────────────┘
       │
       │   the rig runs reaction outputs through `rig.send` — they
       │   re-enter the pipeline (programs classify them again)
       │
       ▼
   (further pipeline activity, until the chain settles)
```

The rig is the engine. Handlers and reactions are data transforms.
A handler that wants something on the wire returns it; the rig
dispatches. This makes every effect visible at the data layer and
keeps handlers easy to unit-test (call them, assert on the return).

## Process — classify the tuple

A program looks at a tuple and returns a code:

```ts
type ProgramResult = { code: string; error?: string };

type Program<T = unknown> = (
  out: Output<T>,
  upstream: Output | undefined,
  read: ReadFn,
) => Promise<ProgramResult>;
```

Programs are registered against URI prefixes. `process` finds the
longest-prefix match and invokes it. The code names what the tuple
*means* in protocol terms: `"valid"`, `"insufficient-funds"`,
`"replay"`, `"requires-signature"`, whatever the protocol's
vocabulary says.

```ts
const balanceCheck: Program = async ([uri, payload], _upstream, read) => {
  const existing = await read(uri);
  const current = (existing.record?.data as { coin: number })?.coin ?? 0;
  const next = (payload as { coin: number }).coin;
  if (next < current) return { code: "rejected", error: "negative delta" };
  return { code: "valid" };
};

const rig = new Rig({
  routes: { ... },
  programs: { "mutable://balance": balanceCheck },
});
```

If a program throws or returns `error`, the pipeline stops for that
tuple — `handle` and `react` are skipped, and the result bubbles up
as `{ accepted: false, error }`.

`process` is also a public method on the rig — useful for dry-runs,
linters, and batch validators that want to classify without
dispatching.

## Handle — return the broadcasts

`handle` runs the handler registered for the program's code:

```ts
type CodeHandler = (
  out: Output,
  result: ProgramResult,
  read: ReadFn,
) => Promise<Output[]>;
```

The handler returns the tuples it wants the rig to broadcast. The
rig dispatches them through connection routing — handlers are
canonical, so programs do not run again on handler emissions.

Common shapes:

```ts
// Persist as-is
const persist: CodeHandler = async (out) => [out];

// Decompose an envelope
const decompose: CodeHandler = async (out) => {
  const [, payload] = out as Output<MessageData>;
  const deletions = payload.inputs.map((uri) => [uri, null] as Output);
  return [out, ...payload.outputs, ...deletions];
};

// Conditional write — first writer wins
const firstWins: CodeHandler = async (out, _result, read) => {
  const [uri] = out;
  const existing = await read(uri);
  return existing.success ? [] : [out];
};

// Refuse silently
const refuse: CodeHandler = async () => [];
```

If no handler is registered for the returned code, the rig dispatches
the input tuple as-is — the default-write path. Simple protocols can
register programs without trivial passthrough handlers.

`handle` is also public. Calling it directly skips classification —
useful when you've already classified the tuple elsewhere (a peer
sent the `ProgramResult`, or you're replaying a pre-classified log).

## React — return more tuples

`react` matches each successfully-dispatched tuple's URI against
registered patterns and runs the matching reactions:

```ts
type Reaction = (
  out: Output,
  read: ReadFn,
) => Promise<Output[]>;
```

Reactions return `Output[]` like handlers, but the rig treats their
output differently: **reaction emissions flow back through
`rig.send`**, re-entering the pipeline. Programs run on them.
Handlers run on them. More reactions can fire. The chain unfolds
until a level returns no further outputs.

The asymmetry exists because a handler is the protocol's own
interpreter — its outputs are protocol-valid by construction. A
reaction is an application-level observer that may emit into URI
namespaces governed by other programs entirely; those programs
should still get to classify.

```ts
// On every user update, emit a notification tuple
const notify: Reaction = async ([uri, data]) => {
  if (data === null) return [];
  const userId = uri.split("/")[3];
  return [[`notify://email/${userId}`, { kind: "user-updated", data }]];
};

const rig = new Rig({
  routes: { ... },
  reactions: {
    "mutable://app/users/:id": notify,
  },
});
```

A reaction can emit into the same URI it observes — that's a loop,
and the framework runs it. Cycle prevention is a protocol-design
concern; the convention is to descend the namespace
(`mutable://app/users/:id` reactions emit to `notify://...` or
`index://...`, never back into `mutable://app/users/*`).

Reactions are internal — the rig fires them in response to
successful dispatches. There is no `rig.react(out)` to call from
outside.

## The public surface

```ts
class Rig {
  // First-class verbs — for tools that want to compose the pipeline.
  process(outs: Output[]): Promise<ProgramResult[]>;
  handle(out: Output, result: ProgramResult): Promise<Output[]>;

  // The everyday entry points — direction-flavored.
  receive(outs: Output[]): OperationHandle;
  send(outs: Output[]): OperationHandle;
}
```

`receive` and `send` return an `OperationHandle` (Ch 13) that's
awaitable (for the pipeline result) and a scoped event emitter (for
per-route detail).

## What's coming next

`send` and `receive` — the two direction-flavored wrappers around
the pipeline, and what their hooks and events look like.

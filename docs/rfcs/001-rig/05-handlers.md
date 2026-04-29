# 5. A handler is an interpretation

A program classifies. A handler interprets and returns the
broadcasts.

```ts
type CodeHandler = (
  out: Output,
  result: ProgramResult,
  read: ReadFn,
) => Promise<Output[]>;
```

A handler is keyed on a code. When `process` classifies a tuple as
`"valid"`, the handler registered for `"valid"` runs. The handler
gets the tuple, the classification, and a `read` for inspecting
state. It returns the tuples it wants the rig to broadcast.

## Why handlers are protocol-defined

Codes are protocol vocabulary. `"valid"` for a UTXO ledger means
"balances conserve, signatures verify, inputs unspent" — and the
operational consequence is "emit the new outputs and emit
null-payload deletions for the consumed inputs." `"valid"` for a
content-addressed pub/sub means "hash matches, signature attached" —
and the consequence is "emit the content tuple and emit fan-out
tuples to subscribers." `"valid"` for a chat protocol means "message
under size limit, sender on the room's allowlist" — and the
consequence is "emit the message tuple and emit a delivery tuple for
each room member."

Three different "valid"s, three different return values. The rig
gives you the slot; the protocol fills it.

## The four shapes

Most handlers do one of these:

```ts
// Persist as-is — most common. (Default if no handler is registered.)
const persist: CodeHandler = async (out) => [out];

// Decompose an envelope into its constituents (Ch 8).
const decompose: CodeHandler = async (out) => {
  const [, payload] = out as Output<MessageData>;
  const deletions = payload.inputs.map((uri) => [uri, null] as Output);
  return [out, ...payload.outputs, ...deletions];
};

// Conditional — first writer wins.
const firstWins: CodeHandler = async (out, _result, read) => {
  const [uri] = out;
  const existing = await read(uri);
  return existing.success ? [] : [out];
};

// Refuse silently — classify, then drop.
const refuse: CodeHandler = async () => [];
```

The handler returns data; the rig dispatches.

## What `read` provides

`read` is the rig's read interface — same view as any other reader.
Handlers use it to consult state before deciding what to emit:

```ts
const balanceTransfer: CodeHandler = async (out, _result, read) => {
  const [uri, payload] = out;
  const { from, to, amount } = payload as Transfer;
  const fromBalance = (await read<{ coin: number }>(from))
    .record?.data.coin ?? 0;
  if (fromBalance < amount) return []; // refuse insufficient funds
  return [
    [from, { coin: fromBalance - amount }],
    [to, { coin: ((await read<{ coin: number }>(to)).record?.data.coin ?? 0) + amount }],
  ];
};
```

## What the rig does with the return

For each tuple in the handler's `Output[]`:

1. Match the URI against `routes.receive`.
2. Dispatch to every accepting connection.
3. Skip classification — the handler is the canonical interpreter,
   so handler emissions don't run programs again.
4. Fire reactions on the emission's URI once at least one route
   accepted (Ch 7).

Chapter 6 covers the dispatch step.

## Default dispatch

If a program returns a code with no registered handler, the rig
broadcasts the input tuple as-is:

```ts
const rig = new Rig({
  routes: { ... },
  programs: {
    "mutable://open/notes": async () => ({ code: "ok" }),
  },
  // no handler for "ok" — default-dispatch persists.
});

await rig.receive([["mutable://open/notes/1", { text: "hi" }]]);
// → classifies as "ok"
// → no handler → broadcasts the input
// → storage clients receive it
```

Simple protocols register programs and let default dispatch handle
the persistence.

## Boundaries

A handler's job is to return the dispatch list. Validation belongs
in the program (it runs first; by the time a handler runs the tuple
is already accepted). External effects belong in clients — a
handler that wants an HTTP call returns a tuple with a URI a
webhook client owns, and the rig routes it there. Reactions and
events fire automatically from successful dispatches; a handler
shapes the dispatch list and the rest follows.

## What's coming next

Chapter 6 — what the rig does between a handler returning and the
tuples landing in clients. The dispatch step, route events, and
reaction scheduling.

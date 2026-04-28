# 5. A handler is an interpretation

A program classifies. A handler interprets and returns the broadcasts.

```ts
type CodeHandler = (
  out: Output,
  result: ProgramResult,
  read: ReadFn,
) => Promise<Output[]>;
```

A handler is keyed on a code. When a tuple is classified — by `process`
— into code `"valid"`, the handler registered for `"valid"` runs. It
receives the tuple, the classification result, and a `read` function
for inspecting state. It returns `Output[]` — the tuples it wants the
Rig to broadcast.

What it returns is deliberately wide open. That openness is the
handler's whole job.

## Why handlers are protocol-defined

A program returns a code. Codes are protocol vocabulary. `"valid"`,
`"insufficient-funds"`, `"requires-fee"`, `"first-write-wins"`,
`"replay-detected"` — these are all things a program might say, and
what they *mean operationally* is up to the protocol that coined them.

The framework can't decide what `"valid"` means because the framework
doesn't know what kind of valid. Valid for a UTXO ledger means
"balances conserve, signatures verify, inputs unspent" — and the
operational consequence is "emit the new outputs and emit
null-payload deletions for the consumed inputs." Valid for a
content-addressed pub/sub means "hash matches, signature attached" —
and the operational consequence is "emit the content tuple and emit
fan-out tuples to subscribers." Valid for a chat protocol means
"message under size limit, sender on the room's allowlist" — and the
operational consequence is "emit the message tuple and emit a
delivery tuple for each room member."

Three different "valid"s, three different return values. The framework
gives you the slot; the protocol fills it.

## What a handler does

In practice, handlers do one of a small number of things:

- **Persist.** The most common case. The handler returns `[out]` so
  the Rig dispatches the input tuple through connection routing.
  Storage clients persist it, replicas mirror it, observers fire. For
  many protocols this is all the handler does. (For tuples whose code
  has no registered handler, the Rig does this automatically.)

- **Decompose.** When the tuple's payload encodes more state than the
  tuple itself — a `MessageData` envelope with several outputs and
  several inputs to consume — the handler unpacks it and returns the
  constituent tuples plus the original envelope. Each constituent
  goes through connection routing on its own URI. (Chapter 8 covers
  decomposition.)

- **Conditionally write.** A handler might consult `read` and decide
  what to return based on existing state. "Only first writer wins" is
  a handler that reads the URI and returns `[out]` only if the URI is
  unset, otherwise `[]`.

- **Refuse.** A handler can return `[]`. Nothing dispatches, nothing
  reacts, nothing persists. This is rare — usually the right shape is
  to have the program return an error code and let the pipeline
  reject — but the framework allows it for protocols where "classify,
  then conditionally drop" is the natural shape.

The handler does not call broadcast. It does not have a broadcast
function. It returns data and the Rig dispatches.

## What `read` lets a handler see

`read` is the same `ReadFn` that programs receive — single-URI,
returns the latest state. Handlers use it to make conditional
decisions:

```ts
const firstWriteWinsHandler: CodeHandler = async (out, _result, read) => {
  const [uri] = out;
  const existing = await read(uri);
  if (existing.success) return [];     // already written, no-op
  return [out];                         // first writer
};
```

`read` always reads from the Rig's connection topology — same
trying-each-connection-in-order rules. It's idempotent and effect-free
in the protocol's eyes; "pure" handler doesn't mean "no I/O at all,"
it means "no externally-visible side effects produced by the handler
itself."

A handler reads the same view of state that any other reader would.

## What the Rig does with the return

The handler returns `Output[]`. The Rig:

1. Takes the returned tuples.
2. Dispatches each through connection routing — same matcher the Rig
   uses for top-level direct writes. Each tuple lands at every
   connection whose `receive` patterns accept the URI.
3. **Does not re-classify.** Handler outputs skip programs. The
   handler is the canonical interpreter; running programs again would
   be redundant and, in some protocols, wrong (the classification
   could depend on state the handler just changed).
4. After successful dispatch, fires reactions on each emitted tuple's
   URI. (Chapter 7 covers what reactions do with their returns.)

Chapter 6 covers the dispatch step in detail.

## What happens when there's no handler

If a program returns a code with no registered handler, the Rig
dispatches the input tuple directly. This is the default-write path:
persist via whichever connections accept the URI, no protocol-specific
handling. It exists so that simple protocols can register programs
without also having to write trivial "just persist this" handlers.

```ts
const rig = new Rig({
  programs: {
    "mutable://open/notes": async () => ({ code: "ok" }),
  },
  // no handlers registered for "ok"
});

await rig.receive([["mutable://open/notes/1", { text: "hi" }]]);
// → process classifies as "ok"
// → no handler for "ok" → default dispatch
// → reaches storage clients via connection routing
```

A protocol that wants different handling for `"ok"` registers a
handler that returns whatever it wants; otherwise the framework's
behavior is to dispatch the tuple as-is.

## What a handler is *not*

A handler is not a place to validate. Validation is the program's job
— it should already have happened by the time the handler runs.
Putting "is this signature valid?" inside a handler means the check
runs after you've decided the tuple is acceptable, which is too late.

A handler is not a place to mutate. The handler doesn't have write
authority — it returns data and the Rig dispatches. "Mutating" the
input is just returning a different tuple instead. The data flow stays
visible because what the Rig dispatches is exactly what the handler
returns.

A handler is not a place to fire reactions or events. Both fire
automatically based on what the Rig dispatches and how the original
direction-call resolves. The handler shapes the dispatch list by what
it returns; everything downstream follows from that.

A handler is not a place to call external APIs imperatively. If a
handler wants an HTTP call to happen, it returns an `Output` to a URI
that an outbound-HTTP client claims, and the call happens through
routing. Side effects move to the boundary; the handler stays pure.

## What's coming next

Chapter 6 — what the Rig does between a handler returning and the
tuples landing in connections. The dispatch step, the reaction
matching, the "broadcast" name and what it covers.

# 5. A handler is an interpretation

A program classifies. A handler interprets.

```ts
type CodeHandler = (
  out: Output,
  broadcast: (outs: Output[]) => Promise<ReceiveResult[]>,
  read: ReadFn,
) => Promise<void>;
```

A handler is keyed on a code. When a tuple is classified — by `process` —
into code `"valid"`, the handler registered for `"valid"` runs. It
receives the tuple, a `broadcast` function for putting more tuples on the
wire, and a `read` for inspecting state. What it does with those is
deliberately wide open. That openness is the handler's whole job.

## Why handlers are protocol-defined

A program returns a code. Codes are protocol vocabulary. `"valid"`,
`"insufficient-funds"`, `"requires-fee"`, `"first-write-wins"`,
`"replay-detected"` — these are all things a program might say, and what
they *mean operationally* is up to the protocol that coined them.

The framework can't decide what `"valid"` means because the framework
doesn't know what kind of valid. Valid for a UTXO ledger means "balances
conserve, signatures verify, inputs unspent" — and the operational
consequence is "persist the outputs, mark the inputs spent". Valid for a
content-addressed pub/sub means "hash matches, signature attached" — and
the operational consequence is "persist the content, fan out to
subscribers". Valid for a chat protocol means "message under size limit,
sender on the room's allowlist" — and the operational consequence is
"persist the message, deliver to room members".

Three different "valid"s, three different handlers. The framework gives
you the slot; the protocol fills it.

## What a handler does

In practice, handlers do one of a small number of things:

- **Persist via broadcast.** The most common case. The handler calls
  `broadcast([out])` to dispatch the tuple through connection routing —
  storage clients persist it, replicas mirror it, observers fire. For
  many protocols this is all the handler does. (For tuples whose code
  has no registered handler, the Rig does this automatically — see below.)

- **Decompose and broadcast.** When the tuple's payload encodes more
  state than the tuple itself — a `MessageData` envelope with several
  outputs and several inputs to consume — the handler unpacks it and
  broadcasts the constituent tuples. Each constituent goes through
  connection routing on its own URI. (Chapter 8 covers decomposition.)

- **Conditionally write.** A handler might consult `read` and decide
  whether to broadcast based on existing state. "Only first writer wins"
  is a handler that reads the URI and broadcasts only if the URI is
  unset.

- **Side effect, then broadcast.** A handler might fire an outbound HTTP
  call, push to a message queue, or update an in-memory cache before
  broadcasting. The handler is the right place for protocol-specific
  side effects because it has the classification context the rest of
  the framework lacks.

- **Refuse silently.** A handler can choose not to broadcast at all.
  This is rare and usually the wrong tool — better to have the program
  return an error code and let the pipeline reject — but it's available
  for protocols where "classify, then conditionally drop" is the
  natural shape.

The handler does not return a result. It either completes (success, the
tuple is considered handled) or throws (failure, the tuple's
`ReceiveResult` becomes `{ accepted: false, error }`). Whatever the handler
broadcasts is dispatched in the order the handler emits it.

## What `read` lets a handler see

`read` is the same `ReadFn` that programs receive — single-URI, returns
the latest state. Handlers use it to make conditional decisions:

```ts
const firstWriteWinsHandler: CodeHandler = async (out, broadcast, read) => {
  const [uri] = out;
  const existing = await read(uri);
  if (existing.success) return; // already written, no-op
  await broadcast([out]);
};
```

`read` always reads from the Rig's connection topology — same
trying-each-connection-in-order rules. A handler reads the same view of
state that any other reader would.

## What `broadcast` does

`broadcast` is the only tool a handler has for putting tuples on the wire.
Chapter 6 dwells on it; the short version is: `broadcast(outs)` dispatches
each tuple through the Rig's connection-pattern routing exactly as if the
Rig were doing a default write. It does not re-classify (you've already
classified — you're the handler). It does not run hooks for a new
direction (you're already inside one). It is direction-free — broadcasts
emitted from a `send`-direction handler don't fire `send:*` events for the
broadcast tuples. (Chapter 6 explains why.)

`broadcast` does fire reactions, because reactions observe successful
writes regardless of how they got written. This means a UI that re-renders
on `mutable://app/users/:id` updates as soon as the handler broadcasts the
update — not when the original triggering tuple arrived, but when the
handler decides to commit the consequence.

## What happens when there's no handler

If a program returns a code with no registered handler, the Rig dispatches
the tuple through connection routing directly. This is the default-write
path: persist via whichever connections accept the URI, no protocol-specific
handling. It exists so that simple protocols can register programs without
also having to write trivial "just persist this" handlers.

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

A protocol that wants different handling for `"ok"` registers a handler;
otherwise the framework's behavior is to broadcast the tuple as-is. Same
result a trivial pass-through handler would produce, less code.

## What a handler is *not*

A handler is not a place to validate. Validation is the program's job —
it should already have happened by the time the handler runs. Putting
"is this signature valid?" inside a handler means the check runs after
you've decided the tuple is acceptable, which is too late.

A handler is not a place to mutate the original tuple. The handler can
choose what to broadcast; what it broadcasts is what gets dispatched.
"Mutating" the original is just broadcasting a different tuple instead.
This keeps the data flow visible — you can see what the handler emits by
looking at its `broadcast` calls, instead of inspecting how it modified
its input.

A handler is not a place to fire reactions or events. Both fire
automatically based on what the handler broadcasts and how the original
direction-call resolves. Calling them manually means firing them for
things that didn't actually happen.

## What changed in this chapter

- Handlers are protocol-defined interpretations of program codes.
- A handler receives the tuple, a `broadcast` function for emitting more
  tuples, and a `read` function for inspecting state.
- Common handler shapes: persist-via-broadcast, decompose-and-broadcast,
  conditional-write, side-effect-then-broadcast.
- No handler for a code → Rig does default dispatch (persist via
  connection routing).
- Handlers are not places to validate, not places to mutate, not places to
  fire reactions/events.

## What's coming next

`broadcast` itself — what it does, why it's direction-free, why it's the
*only* fan-out mechanism in the framework.

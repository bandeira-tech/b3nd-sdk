# 8. Decomposition is the protocol's job

A tuple's payload often encodes more state than the tuple itself.

The canonical example is `MessageData`: a payload of the form
`{ inputs: string[], outputs: Output[], auth?: Signature[] }` that says
"persist these outputs and consume these inputs as a single intent." One
tuple on the wire; many tuples worth of effect when interpreted.

Today the framework recognizes this shape and decomposes it inside
`MessageDataClient`. The proposal moves that knowledge out of the
framework and into a protocol-supplied handler. The mechanism it uses —
broadcast — is the same one any handler has. Decomposition stops being
special.

## What `MessageData` looks like, after the move

`MessageData` survives. It's a useful protocol convention with a long
track record. The SDK ships it as canon — a typed payload shape, a
program that classifies tuples carrying it, and a handler that knows how
to decompose it. Three parts, all opt-in:

```ts
// libs/.../message-data.ts (SDK canon)

export interface MessageData {
  inputs: string[];
  outputs: Output[];
  auth?: Signature[];
}

export const messageDataProgram: Program = async (out) => {
  const [, , payload] = out;
  if (!isMessageData(payload)) return { code: "not-msgdata" };
  // optional protocol-level checks: signature shape, etc.
  return { code: "msgdata:valid" };
};

export const messageDataHandler: CodeHandler = async (out, broadcast) => {
  const [, , payload] = out as Output<MessageData>;
  const inputDeletions: Output[] = payload.inputs.map(
    (uri) => [uri, {}, null]
  );
  await broadcast([out, ...payload.outputs, ...inputDeletions]);
};
```

A protocol that wants `MessageData` semantics installs both — registers
the program against the URI prefix it uses for envelopes (often
`hash://sha256` for content-addressed envelopes) and registers the
handler against the `"msgdata:valid"` code:

```ts
const rig = new Rig({
  programs:  { "hash://sha256": messageDataProgram },
  handlers:  { "msgdata:valid": messageDataHandler },
  connections: [...],
});
```

That's the whole wire-up. The framework knows nothing about envelopes;
the SDK provides the canon; the protocol opts in.

## How a decomposition flows

A user calls `authRig.send({ inputs, outputs })`. `AuthenticatedRig`
builds the canonical envelope tuple, signs it, calls `rig.send([envelope])`.
The pipeline runs:

1. `process` calls `messageDataProgram` (because the envelope's URI is
   `hash://sha256/...`). It returns `{ code: "msgdata:valid" }`.
2. `handle` calls `messageDataHandler`. The handler reads
   `payload.inputs` and `payload.outputs`, builds the constituent
   broadcast — the envelope itself, each output, each input as a
   null-payload deletion tuple — and calls `broadcast(allOfThem)`.
3. `broadcast` dispatches each tuple through connection routing.
   Storage clients persist the writes. The `DataStoreClient` (chapter 9)
   sees the null-payload tuples and translates them to `store.delete`.
   Other clients react per their role.
4. Reactions fire for each emitted URI that matches a registered pattern.

End to end, the framework didn't need to know about `MessageData`.
The protocol's handler did the unpacking; the framework did the routing.

## What about nested envelopes?

A `MessageData` envelope can have outputs that are themselves
`MessageData` envelopes — a transaction containing sub-transactions, a
batch of intents wrapped in an outer batch. Today this works because
`MessageDataClient` recurses internally. After the move, it works the
same way, but explicitly:

The outer envelope's handler broadcasts the inner envelope tuple as one
of its outputs. Connection routing dispatches that inner envelope to the
clients that accept its URI. If one of those "clients" is the same Rig
re-entered (unusual, but allowed), the inner envelope flows through the
pipeline — `messageDataProgram` classifies it again, `messageDataHandler`
unpacks it again. N levels deep, same shape every level.

If the protocol wants the inner envelope re-classified by the same Rig
even when its URI didn't route back through dispatch, the outer handler
uses re-entry (chapter 7) instead of plain broadcast. Either path works;
the protocol picks based on intent.

## Why this is better than a framework-blessed `MessageDataClient`

Three reasons.

**Composability.** Today, a Rig that wants `MessageData` semantics for
some URIs and *different* envelope semantics (a different schema, a
different decomposition) for others has nowhere to put the alternative
— `MessageDataClient` is built into the receive path, and it's
all-or-nothing. After the move, both protocols install their own
handlers; they coexist trivially.

**Inspectability.** A reader of the framework can no longer wonder
"what does the framework do with my envelope?" because the framework
does nothing. The handler does the unpacking, in plain code that lives
in a protocol package. You read the handler to know what happens.

**Testability.** A protocol-supplied handler is a single function that
takes an `Output` and a `broadcast` and returns nothing. It's directly
unit-testable without standing up a Rig. Today the equivalent test
needs the whole `MessageDataClient` + `Store` machinery to observe
side-effects.

## What `MessageDataClient` becomes

`MessageDataClient` as a name retires. The decomposition logic moves to
`messageDataHandler` (SDK canon, opt-in). The "wrap a Store with the
NodeProtocolInterface" function that `MessageDataClient` also did —
that's a separate, generic concern, and it becomes `DataStoreClient`,
which is the topic of the next chapter.

The split is honest: the old `MessageDataClient` was doing two things
poorly fused — translating wire tuples to Store calls *and* knowing
about envelopes. We unfuse them.

## What changed in this chapter

- `MessageData` survives as SDK canon: a typed payload shape, a
  classifier program, and a decomposition handler. Three pieces, all
  opt-in.
- The framework no longer recognizes `MessageData`. Decomposition lives
  entirely in the protocol-supplied handler.
- The handler unpacks the envelope and `broadcast`s the constituents:
  the envelope itself, the outputs, the inputs as null-payload deletions.
- N-level nesting falls out of the connection-routing dispatch (or
  re-entry, when needed).
- `MessageDataClient` retires; the storage-adapter half of its old job
  becomes `DataStoreClient` (chapter 9); the envelope half becomes
  `messageDataHandler`.

## What's coming next

Deletion as data — what `[uri, values, null]` means on the wire, why
`DataStoreClient` is the canonical translator, and what happens to
clients that aren't storage backends when they see a null-payload tuple
go by.

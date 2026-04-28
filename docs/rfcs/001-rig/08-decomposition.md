# 8. Decomposition is the protocol's job

A tuple's payload often encodes more state than the tuple itself.

The canonical example is `MessageData`: a payload of the form
`{ inputs: string[], outputs: Output[], auth?: Signature[] }` that says
"persist these outputs and consume these inputs as a single intent."
One tuple on the wire; many tuples worth of effect when interpreted.

Decomposition is a protocol act. The Rig does not split anything. The
SDK ships `MessageData`'s decomposition as opt-in canon — a typed
payload shape, a program, and a handler — and protocols register the
pieces they want.

## What `MessageData` looks like

```ts
// libs/b3nd-msg/data/canon.ts (SDK canon)

export interface MessageData {
  inputs: string[];
  outputs: Output[];
  auth?: Signature[];
}

export const messageDataProgram: Program = async (out) => {
  const [, payload] = out;
  if (isMessageData(payload)) return { code: "msgdata:valid" };
  return { code: "ok" }; // default-dispatch for non-envelopes
};

export const messageDataHandler: CodeHandler = async (out) => {
  const [, payload] = out as Output<MessageData>;
  const inputDeletions: Output[] = payload.inputs.map(
    (uri) => [uri, null] as Output,
  );
  return [out, ...payload.outputs, ...inputDeletions];
};
```

A protocol that wants `MessageData` semantics installs both —
registers the program against the URI prefix it uses for envelopes
(typically `hash://sha256` for content-addressed envelopes) and
registers the handler against the `"msgdata:valid"` code:

```ts
const rig = new Rig({
  programs:  { "hash://sha256": messageDataProgram },
  handlers:  { "msgdata:valid": messageDataHandler },
  connections: [...],
});
```

That's the whole wire-up. The framework knows nothing about
envelopes; the SDK provides the canon; the protocol opts in.

## How a decomposition flows

A caller signs an intent with `Identity.sign`, builds the canonical
envelope tuple with `message(...)`, and calls `rig.send([envelope])`.
The pipeline runs:

1. `process` calls `messageDataProgram` (because the envelope's URI
   is `hash://sha256/...`). Returns `{ code: "msgdata:valid" }`.
2. `handle` calls `messageDataHandler`. The handler reads
   `payload.inputs` and `payload.outputs` and **returns** the
   constituent emissions — the envelope itself, each output, each
   input as a null-payload deletion tuple.
3. The Rig dispatches each returned tuple through connection routing
   (broadcast). Storage clients persist the writes. The
   `DataStoreClient` (Ch 9) sees the null-payload tuples and
   translates them to `store.delete`. Other clients react per their
   role.
4. Reactions fire for each emitted URI that matches a registered
   pattern. Reaction-emitted tuples flow back through `rig.send` (Ch
   7).

End to end, the framework didn't need to know about `MessageData`.
The protocol's handler did the unpacking; the framework did the
routing.

## Nested envelopes

A `MessageData` envelope can have outputs that are themselves
`MessageData` envelopes — a transaction containing sub-transactions,
a batch of intents wrapped in an outer batch. The outer envelope's
handler returns the inner envelope tuple as one of its emissions.
The Rig dispatches that inner envelope to the clients that accept
its URI. If a client downstream is itself a Rig (a Rig-as-client
composition), the inner envelope re-enters that downstream pipeline
naturally — `messageDataProgram` classifies it,
`messageDataHandler` unpacks it. N levels deep, same shape every
level.

Within a single Rig, handler emissions skip classification (Ch 6).
If a protocol wants the inner envelope to be re-classified by the
same Rig that's processing the outer one — for defense-in-depth or
because the inner envelope is governed by different programs — the
protocol expresses that as a reaction instead of a handler emission.
Reactions flow through `rig.send`, which runs programs.

## Why protocol-supplied instead of framework-blessed

Three reasons.

**Composability.** A Rig that wants `MessageData` semantics for some
URIs and *different* envelope semantics (a different schema, a
different decomposition) for others can do both — install
`messageDataHandler` for the `MessageData` codes and a different
handler for the alternative protocol's codes. Nothing in the
framework is shared between them.

**Inspectability.** A reader of the framework can no longer wonder
"what does the framework do with my envelope?" because the framework
does nothing. The handler does the unpacking, in plain code that
lives in `libs/b3nd-msg/data/canon.ts`.

**Testability.** `messageDataHandler` is a single function that
takes an `Output` and returns `Output[]`. It's directly
unit-testable without standing up a Rig — call it, assert on what it
returned.

## `DataStoreClient`

The "wrap a Store with the `ProtocolInterfaceNode`" function lives
separately as `DataStoreClient` (Ch 9). The split is honest:
translating wire tuples to Store calls is a generic concern;
knowing about envelopes is `MessageData`-specific. The two live in
different files.

## What's coming next

Deletion as data — what `[uri, null]` means on the wire, why
`DataStoreClient` is the canonical translator, and what happens to
clients that aren't storage backends when they see a null-payload
tuple go by.

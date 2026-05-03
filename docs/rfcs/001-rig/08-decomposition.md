# 8. Decomposition is the protocol's job

A tuple's payload often encodes more state than the tuple itself.

The canonical case is `MessageData`:

```ts
interface MessageData {
  inputs: string[];        // URIs to consume (deleted on accept)
  outputs: Output[];       // tuples to persist
  auth?: Signature[];      // optional signature(s)
}
```

One envelope tuple on the wire — many tuples worth of effect when
unpacked. The unpacking is a handler the protocol installs.

## Wire-up

The SDK ships the program and handler. A protocol that wants
envelope semantics registers both:

```ts
import {
  Rig, connection, DataStoreClient, MemoryStore,
  messageDataProgram, messageDataHandler,
} from "@bandeira-tech/b3nd-sdk";

const local = connection(new DataStoreClient(new MemoryStore()), ["*"]);

const rig = new Rig({
  routes: { receive: [local], read: [local], observe: [local] },
  programs: { "hash://sha256": messageDataProgram },
  handlers: { "msgdata:valid": messageDataHandler },
});
```

That's the wire-up. The program classifies any tuple under
`hash://sha256` as `msgdata:valid` if its payload looks like a
`MessageData` envelope. The handler returns the envelope tuple plus
its constituent outputs and the input-deletion tuples.

```ts
// What messageDataHandler returns:
[
  out,                                                  // envelope (audit trail)
  ...payload.outputs,                                   // each declared output
  ...payload.inputs.map((uri) => [uri, null] as Output) // null-payload deletions
]
```

## End-to-end flow

```ts
import { Identity, message } from "@bandeira-tech/b3nd-sdk";

const id = await Identity.fromSeed(seed);

const inputs = ["utxo://abc/0"];
const outputs: Output[] = [
  ["utxo://def/0", { owner: bobPubkey, values: { coin: 70 } }],
  ["utxo://def/1", { owner: alicePubkey, values: { coin: 30 } }],
];

const auth = [await id.sign({ inputs, outputs })];
const envelope = await message({ auth, inputs, outputs });

await rig.send([envelope]);
```

Pipeline:

1. **process** — `messageDataProgram` runs against the envelope's
   `hash://sha256` URI. Returns `{ code: "msgdata:valid" }`.
2. **handle** — `messageDataHandler` returns
   `[envelope, ...outputs, [inputs[0], null]]`.
3. **broadcast** — each emission dispatches through `routes.receive`.
   `DataStoreClient` sees the null-payload tuple at `utxo://abc/0`
   and calls `store.delete()` (Ch 9). The two new UTXOs land at
   their URIs.
4. **react** — registered reactions fire on each emission; their
   returns flow through `rig.send` (Ch 7).

## Nested envelopes

A `MessageData` envelope can carry envelopes inside its outputs — a
transaction containing sub-transactions, a batch wrapping batches.
The outer handler returns the inner envelope tuple as one of its
emissions; broadcast routes it to whichever connections accept the
inner envelope's URI.

If a downstream client is itself a Rig (Rig-as-client composition),
the inner envelope re-enters that downstream pipeline —
`messageDataProgram` classifies it again, `messageDataHandler`
unpacks it. N levels deep, same shape every level.

Within one rig, handler emissions skip classification (Ch 6). For
"re-classify the inner envelope under a different program" — say,
defense-in-depth — express it as a reaction. Reactions go through
`rig.send` and run programs.

## Trust model

`messageDataProgram` only checks shape (`{ inputs, outputs, auth? }`).
Signature verification, conservation, replay protection — those live
in protocol-specific programs that compose on top of `messageDataProgram`:

```ts
import { messageDataProgram, verifyAuthInPayload } from "@bandeira-tech/b3nd-sdk";

const txProgram: Program = async (out, upstream, read) => {
  const base = await messageDataProgram(out, upstream, read);
  if (base.code !== "msgdata:valid") return base;

  const [, payload] = out as Output<MessageData>;
  // ...sum inputs vs outputs (conservation)
  // ...verify each input owner's signature
  return { code: "tx:valid" };
};

const rig = new Rig({
  routes: { ... },
  programs: { "hash://sha256": txProgram },
  handlers: { "tx:valid": messageDataHandler },
});
```

The protocol composes the canon program with its own checks and
swaps the code its handler is registered against (`tx:valid` here).

## What's coming next

Deletion as data — what `[uri, null]` means on the wire and how
`DataStoreClient` translates it.

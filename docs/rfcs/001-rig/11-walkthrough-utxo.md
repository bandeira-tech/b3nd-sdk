# 11. A UTXO ledger, end to end

This chapter walks one transaction through the whole pipeline. The
protocol is a small UTXO ledger — accounts hold balances of a single
asset called `coin`, transactions consume input UTXOs and produce
output UTXOs, balances must conserve, and only the input owner can
spend an input.

The point of the walkthrough is not the ledger. It's to show every
chapter's idea participating in one concrete flow: `Output<T>`
primitives, payload-agnostic Rig, `process` / `handle`, send/receive
direction, handler-as-interpreter, broadcast as fan-out, MessageData
as SDK canon, deletion-as-data, auth in the protocol — and how a
protocol that needs conserved quantities expresses them inside
`payload`, without the framework needing to know about quantities at
all.

## Setup — the protocol

URIs:

- `utxo://{txhash}/{n}` — a single UTXO output.
  Payload `{ owner, values: { coin } }`.
- `hash://sha256/{hex}` — content-addressed envelope (the transaction).
  Payload is `MessageData`.

Note where the conserved quantity lives: inside the payload, at
`payload.values.coin`. The framework doesn't see it; only the
protocol's program does.

Programs:

```ts
import {
  messageDataProgram,         // SDK canon
  verifyAuthInPayload,        // SDK canon
} from "@bandeira-tech/b3nd-sdk";

type UtxoPayload = { owner: string; values: { coin: number } };

const utxoProgram: Program = async (out) => {
  const [, payload] = out;
  if (payload === null) return { code: "tombstone" };  // deletion of consumed UTXO
  if (typeof payload !== "object") {
    return { code: "rejected", error: "utxo payload must be an object" };
  }
  const u = payload as UtxoPayload;
  if (typeof u.owner !== "string") {
    return { code: "rejected", error: "utxo missing owner" };
  }
  const coin = u.values?.coin;
  if (typeof coin !== "number" || coin < 0) {
    return { code: "rejected", error: "utxo coin must be a non-negative number" };
  }
  return { code: "valid-utxo" };
};

const txProgram: Program = async (out, upstream, read) => {
  const base = await messageDataProgram(out, upstream, read);
  if (base.code !== "msgdata:valid") return base;

  const [, payload] = out as Output<MessageData>;

  // Conservation: sum of inputs' payload.values.coin must equal sum of
  // outputs' payload.values.coin. The protocol reads quantities out of
  // the payload — the framework has no concept of quantities.
  let inputSum = 0;
  for (const inputUri of payload.inputs) {
    const r = await read<UtxoPayload>(inputUri);
    if (!r.success) {
      return { code: "rejected", error: `input not found: ${inputUri}` };
    }
    inputSum += (r.record.data.values?.coin ?? 0);
  }
  const outputSum = payload.outputs.reduce(
    (s, [, outPayload]) => s + ((outPayload as UtxoPayload).values?.coin ?? 0),
    0,
  );
  if (inputSum !== outputSum) {
    return { code: "rejected", error: `conservation: in=${inputSum} out=${outputSum}` };
  }

  // Auth: every input's owner must have signed the envelope.
  for (const inputUri of payload.inputs) {
    const r = await read<UtxoPayload>(inputUri);
    const owner = r.record!.data.owner;
    if (!await verifyAuthInPayload(out, { pubkey: owner })) {
      return { code: "rejected", error: `missing/invalid signature for ${owner}` };
    }
  }

  return { code: "tx:valid" };
};
```

Handlers:

```ts
import {
  Rig,
  connection,
  DataStoreClient,
  MemoryStore,
  messageDataHandler,
} from "@bandeira-tech/b3nd-sdk";

const local = connection(new DataStoreClient(new MemoryStore()), ["*"]);

const rig = new Rig({
  programs: {
    "utxo://": utxoProgram,
    "hash://sha256": txProgram,
  },
  handlers: {
    "tx:valid": messageDataHandler, // SDK canon: returns envelope + outputs + null-payload deletions for inputs
    // No handler for "valid-utxo" — default dispatch persists.
  },
  routes: { receive: [local], read: [local], observe: [local] },
});
```

That's the whole protocol installation.

## The transaction

Alice has UTXO `utxo://abc.../0` worth 100 coin. She wants to pay Bob
70 coin and keep 30 as change. She constructs the intent and signs
it:

```ts
import { Identity, message } from "@bandeira-tech/b3nd-sdk";

const aliceIdentity = await Identity.fromSeed(aliceSeed);

const inputs = ["utxo://abc.../0"];
const outputs: Output[] = [
  ["utxo://def.../0", { owner: bobPubkey,   values: { coin: 70 } }],
  ["utxo://def.../1", { owner: alicePubkey, values: { coin: 30 } }],
];

const auth = [await aliceIdentity.sign({ inputs, outputs })];
const envelope = await message({ auth, inputs, outputs });

const op = rig.send([envelope]);
const [result] = await op;       // pipeline ack
await op.settled;                 // every route reported
```

`message(...)` builds the envelope tuple — content-addressed at
`hash://sha256/{computed}`. `rig.send([envelope])` runs the pipeline.

## What the pipeline does

**Direction wrapper.** `rig.send` runs `beforeSend` hooks (none
configured), then enters `_pipeline(outs, "send")`.

**Process.** The Rig finds `txProgram` for the envelope's URI prefix
(`hash://sha256`). The program runs:

1. Calls `messageDataProgram` to validate envelope shape — passes.
2. Reads `utxo://abc.../0` from connections. Finds it. Sums
   `payload.values.coin` over inputs: `inputSum = 100`.
3. Sums `payload.values.coin` over outputs:
   `outputSum = 70 + 30 = 100`. Conservation holds.
4. Verifies the envelope's `payload.auth` against Alice's pubkey
   (the owner of the consumed input). Signature checks out.
5. Returns `{ code: "tx:valid" }`.

**Handle.** The Rig dispatches to the `"tx:valid"` handler, which is
`messageDataHandler`. The handler reads the envelope:

```
inputs:  ["utxo://abc.../0"]
outputs: [
  ["utxo://def.../0", { owner: bobPubkey,   values: { coin: 70 } }],
  ["utxo://def.../1", { owner: alicePubkey, values: { coin: 30 } }],
]
```

It returns the constituent emissions:

```ts
[
  // The envelope itself, for audit trail
  ["hash://sha256/{computed}", { inputs, outputs, auth }],
  // Each new UTXO
  ["utxo://def.../0", { owner: bobPubkey,   values: { coin: 70 } }],
  ["utxo://def.../1", { owner: alicePubkey, values: { coin: 30 } }],
  // Each consumed input as a deletion
  ["utxo://abc.../0", null],
]
```

The Rig takes that array and broadcasts each tuple.

**Broadcast.** Each tuple is dispatched through connection routing.
The `MemoryStore`-backed `DataStoreClient` is the only connection;
it accepts everything. For each tuple:

- The envelope tuple is written at its hash URI. Audit trail in place.
- The two new UTXO tuples are written at their URIs.
- The null-payload tuple at `utxo://abc.../0` is *deleted* by
  `DataStoreClient` (because it sees `payload === null`).

The new UTXO tuples have URIs starting with `utxo://`, and the Rig
has a program registered there (`utxoProgram`). Broadcast does *not*
re-run programs (Ch 6). The `messageDataHandler` already classified
each constituent in the protocol's eyes by deciding to emit them.
The new UTXO tuples land in storage without re-running `utxoProgram`.

If we wanted `utxoProgram` to re-run on each output (for
defense-in-depth, or because some emissions are governed by programs
the handler doesn't trust), the protocol would shape those emissions
as reactions instead of handler returns — reactions go through
`rig.send`, which runs programs (Ch 7). For this protocol, the
conservation and auth checks in `txProgram` already cover everything,
so plain handler emissions are right.

**React.** Reactions fire on each broadcast tuple's URI. Suppose the
host application registered a reaction that maintains a per-owner
balance index:

```ts
const indexBalance: Reaction = async (out, read) => {
  const [uri, payload] = out;
  const owner = payload === null
    ? await ownerOfDeletedUtxo(uri, read)
    : (payload as UtxoPayload).owner;
  const total = await sumBalanceFor(owner, read);
  return [[`index://balances/${owner}`, { coin: total }]];
};

rig.reaction("utxo://:txhash/:n", indexBalance);
```

This reaction fires three times for our transaction — twice for the
new outputs and once for the deleted input. Each call returns an
`Output` for the affected owner's balance index URI. The Rig sends
those through `rig.send`; programs registered on `index://balances`
classify them, an indexer's handler persists them, and any UI
subscribed to balance updates sees the change.

**Events and per-route observability.** `send:success` fires once
for the original `rig.send` caller's tuple (the envelope). Per-route
detail flows through the operation handle's events — `route:success`
or `route:error` per `(emission, connection)` pair — for callers
that want to see exactly which connections accepted each broadcast
emission (Ch 13).

**Hooks.** `afterSend` fires (none configured).

## What ended up in storage

After `await op.settled` resolves, the store contains:

- `hash://sha256/{computed}` → the envelope (audit record)
- `utxo://def.../0` → Bob's new UTXO of 70 coin
- `utxo://def.../1` → Alice's change of 30 coin

`utxo://abc.../0` is gone — deleted as a null-payload broadcast,
translated by `DataStoreClient` to a `store.delete()` call.

The data is consistent. The conservation is provable from the audit
record. The reaction-driven index matches storage.

## What didn't happen at the framework level

The framework didn't:

- Know that the protocol was a UTXO ledger.
- Know that `coin` was a conserved quantity (the framework has no
  concept of conservation — quantities live entirely inside the
  payload, where only the protocol's programs read them).
- Know that `MessageData` was the envelope shape.
- Know that `payload.auth` was where signatures live.
- Know that `null` meant deletion (the `DataStoreClient` knew, the
  framework didn't).
- Verify a single signature.
- Sum a single balance.
- Decompose a single envelope.

Every protocol-specific behavior happened in protocol-supplied code —
`utxoProgram`, `txProgram`, `messageDataHandler` (SDK canon),
`verifyAuthInPayload` (SDK canon helper), `DataStoreClient` (SDK
canon adapter). The framework ran the pipeline and routed by URI.

## What this demonstrates

- A protocol can be installed in maybe 50 lines of code on top of the
  SDK canon.
- Conservation, auth, deletion, audit trail, reactive index all work
  through a single pipeline pass on a single envelope.
- Conserved quantities don't need a framework-level slot; embedding
  them in the payload at a protocol-defined key works just as well
  and keeps the framework smaller.
- The framework's surface is small enough that you could review the
  Rig's own code and feel confident nothing was happening behind your
  back.

## What's coming next

Chapter 12 — the network walkthrough. One envelope, three publishers
(meta ads, google ads, a webhook), demonstrating connection-pattern
routing and showing what happens when broadcast fans out to backends
that aren't storage.

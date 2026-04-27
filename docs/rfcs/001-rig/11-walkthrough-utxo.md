# 11. A UTXO ledger, end to end

This chapter walks one transaction through the whole pipeline. The
protocol is a small UTXO ledger — accounts hold balances of a single
asset called `coin`, transactions consume input UTXOs and produce output
UTXOs, balances must conserve, and only the input owner can spend an
input.

The point of the walkthrough is not the ledger. It's to show every
chapter's idea participating in one concrete flow: `Output<T>`
primitives, payload-agnostic Rig, `process` / `handle`, send/receive
direction, handler-as-interpreter, broadcast as fan-out, MessageData as
SDK canon, deletion-as-data, auth in the protocol.

## Setup — the protocol

URIs:

- `utxo://{txhash}/{n}` — a single UTXO output. Payload `{ owner, amount }`.
  Values `{ coin: amount }`.
- `hash://sha256/{hex}` — content-addressed envelope (the transaction).
  Payload is `MessageData`.

Programs:

```ts
import {
  messageDataProgram,         // SDK canon
  verifyAuthInPayload,        // SDK canon
} from "@b3nd/sdk/canon";

const utxoProgram: Program = async (out, _upstream, read) => {
  const [, , payload] = out;
  if (payload === null) return { code: "tombstone" };  // deletion of consumed UTXO
  if (typeof payload !== "object") {
    return { code: "rejected", error: "utxo payload must be an object" };
  }
  if (typeof (payload as any).owner !== "string") {
    return { code: "rejected", error: "utxo missing owner" };
  }
  if (typeof (payload as any).amount !== "number" || (payload as any).amount < 0) {
    return { code: "rejected", error: "utxo amount must be a non-negative number" };
  }
  return { code: "valid-utxo" };
};

const txProgram: Program = async (out, upstream, read) => {
  // Reuses the SDK MessageData program first to do envelope-shape checks.
  const base = await messageDataProgram(out, upstream, read);
  if (base.code !== "msgdata:valid") return base;

  const [, , payload] = out as Output<MessageData>;

  // Conservation: sum of input values.coin must equal sum of output values.coin
  let inputSum = 0;
  for (const inputUri of payload.inputs) {
    const r = await read(inputUri);
    if (!r.success) {
      return { code: "rejected", error: `input not found: ${inputUri}` };
    }
    inputSum += (r.record.values?.coin ?? 0);
  }
  const outputSum = payload.outputs.reduce(
    (s, [, vals]) => s + (vals.coin ?? 0),
    0,
  );
  if (inputSum !== outputSum) {
    return { code: "rejected", error: `conservation: in=${inputSum} out=${outputSum}` };
  }

  // Auth: every input's owner must have signed the envelope.
  for (const inputUri of payload.inputs) {
    const r = await read<{ owner: string }>(inputUri);
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
import { messageDataHandler } from "@b3nd/sdk/canon";

const rig = new Rig({
  programs: {
    "utxo://": utxoProgram,
    "hash://sha256": txProgram,
  },
  handlers: {
    "tx:valid": messageDataHandler,   // SDK canon: broadcasts envelope + outputs + null-payload deletions for inputs
    "valid-utxo": defaultPersistHandler,  // optional explicit; if omitted, default dispatch persists
  },
  connections: [
    connection(new DataStoreClient(new MemoryStore()), {
      receive: ["*"], read: ["*"],
    }),
  ],
});
```

That's the whole protocol installation.

## The transaction

Alice has UTXO `utxo://abc.../0` worth 100 coin. She wants to pay Bob 70
coin and keep 30 as change.

She constructs the intent and signs it via `AuthenticatedRig`:

```ts
const aliceAuthRig = new AuthenticatedRig(aliceIdentity, rig);

const result = await aliceAuthRig.send({
  inputs: ["utxo://abc.../0"],
  outputs: [
    ["utxo://def.../0", { coin: 70 }, { owner: bobPubkey,   amount: 70 }],
    ["utxo://def.../1", { coin: 30 }, { owner: alicePubkey, amount: 30 }],
  ],
});
```

`AuthenticatedRig` signs the intent with Alice's identity, builds the
envelope tuple — content-addressed at `hash://sha256/{computed}` — and
calls `rig.send([envelope])`.

## What the pipeline does

**Direction wrapper.** `rig.send` runs `beforeSend` hooks (none
configured), then calls `_pipeline(outs, "send")`.

**Process.** The Rig finds `txProgram` for the envelope's URI prefix
(`hash://sha256`). The program runs:

1. Calls `messageDataProgram` to validate envelope shape — passes.
2. Reads `utxo://abc.../0` from connections. Finds it. Sums
   `inputSum = 100`.
3. Sums output values: `outputSum = 70 + 30 = 100`. Conservation holds.
4. Verifies the envelope's `payload.auth` against Alice's pubkey (the
   owner of the consumed input). Signature checks out.
5. Returns `{ code: "tx:valid" }`.

**Handle.** The Rig dispatches to the `"tx:valid"` handler, which is
`messageDataHandler`. The handler reads the envelope:

```
inputs:  ["utxo://abc.../0"]
outputs: [
  ["utxo://def.../0", { coin: 70 }, { owner: bobPubkey,   amount: 70 }],
  ["utxo://def.../1", { coin: 30 }, { owner: alicePubkey, amount: 30 }],
]
```

It builds the broadcast list:

```ts
[
  // The envelope itself, for audit trail
  ["hash://sha256/{computed}", {}, { inputs, outputs, auth }],
  // Each new UTXO
  ["utxo://def.../0", { coin: 70 }, { owner: bobPubkey,   amount: 70 }],
  ["utxo://def.../1", { coin: 30 }, { owner: alicePubkey, amount: 30 }],
  // Each consumed input as a deletion
  ["utxo://abc.../0", {}, null],
]
```

It calls `broadcast(thatList)`.

**Broadcast.** Each tuple is dispatched through connection routing. The
`MemoryStore`-backed `DataStoreClient` is the only connection; it
accepts everything. For each tuple:

- The envelope tuple is written at its hash URI. Audit trail in place.
- The two new UTXO tuples are written at their URIs.
- The null-payload tuple at `utxo://abc.../0` is *deleted* by
  `DataStoreClient` (because it sees `payload === null`).

Wait — what about the new UTXO tuples? They have URIs starting with
`utxo://`, and the Rig has a program registered there (`utxoProgram`).
Does `broadcast` re-run programs?

No — and this is the key point of chapter 6. `broadcast` skips
classification. The `messageDataHandler` already classified each
constituent in the protocol's eyes by deciding to emit them. The new
UTXO tuples land in storage without re-running `utxoProgram`.

If we *wanted* `utxoProgram` to re-run on each output (for paranoia,
defense-in-depth, or to support arbitrary protocols downstream), the
handler would call `rig.receive(decomposed)` instead of `broadcast`
(chapter 7 — re-entry). For this protocol, the conservation and auth
checks in `txProgram` already cover everything, so plain `broadcast` is
right.

**React.** Reactions fire on each broadcast tuple's URI. Suppose the
host application registered:

```ts
rig.reaction("utxo://:txhash/:n", (uri, data, params) => {
  if (data === null) {
    removeFromUtxoSet(params.txhash, params.n);
  } else {
    addToUtxoSet(params.txhash, params.n, data);
  }
});
```

This reaction fires three times for our transaction — twice for the new
outputs (added), once for the deleted input (removed). The host UI sees
the UTXO set update without polling.

**Events.** `send:success` fires once for the original `rig.send`
caller's tuple (the envelope). `broadcast` does not fire `send:*`
events for the constituent tuples — those are consequences of the
original send, not new sends. (Chapter 6.)

**Hooks.** `afterSend` fires (none configured).

## What ended up in storage

After the call returns, the store contains:

- `hash://sha256/{computed}` → the envelope (audit record)
- `utxo://def.../0` → Bob's new UTXO of 70 coin
- `utxo://def.../1` → Alice's change of 30 coin

`utxo://abc.../0` is gone — deleted as a null-payload broadcast,
translated by `DataStoreClient` to a `store.delete()` call.

The data is consistent. The conservation is provable from the audit
record. The reaction-driven UI matches storage.

## What didn't happen at the framework level

The framework didn't:

- Know that the protocol was a UTXO ledger.
- Know that `MessageData` was the envelope shape.
- Know that `payload.auth` was where signatures live.
- Know that `null` meant deletion (the `DataStoreClient` knew, the
  framework didn't).
- Verify a single signature.
- Sum a single balance.
- Decompose a single envelope.

Every protocol-specific behavior happened in protocol-supplied code —
`utxoProgram`, `txProgram`, `messageDataHandler` (SDK canon, but
opt-in), `verifyAuthInPayload` (SDK canon helper), `DataStoreClient`
(SDK canon adapter). The framework ran the pipeline and routed by URI.

## What this demonstrates

- A protocol can be installed in maybe 50 lines of code on top of the
  SDK canon.
- Conservation, auth, deletion, audit trail, reactive UI all work
  through a single pipeline pass on a single envelope.
- The framework's surface is small enough that you could review the
  Rig's own code and feel confident nothing was happening behind your
  back.

## What's coming next

Chapter 12 — the network walkthrough. One envelope, three publishers
(meta ads, google ads, a webhook), demonstrating connection-pattern
routing and showing what happens when broadcast fans out to backends
that aren't storage.

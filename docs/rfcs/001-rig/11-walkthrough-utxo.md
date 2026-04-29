# 11. A UTXO ledger, end to end

A small UTXO ledger walks every chapter's idea through one
transaction: `Output<T>` primitives, `process` / `handle`,
`messageDataHandler`, deletion-as-data, signed envelopes,
reactions, and per-route observability.

## Setup

URIs:

- `utxo://{txhash}/{n}` — a single UTXO output.
  Payload: `{ owner, values: { coin } }`.
- `hash://sha256/{hex}` — the transaction (a `MessageData` envelope).

The conserved quantity sits at `payload.values.coin` — a key the
protocol's program reads.

```ts
import {
  Identity, Rig, connection, message,
  DataStoreClient, MemoryStore,
  messageDataProgram, messageDataHandler,
  verifyAuthInPayload,
} from "@bandeira-tech/b3nd-sdk";

type UtxoPayload = { owner: string; values: { coin: number } };

// UTXO shape check — runs on each utxo:// tuple as it's persisted.
const utxoProgram: Program = async (out) => {
  const [, payload] = out;
  if (payload === null) return { code: "tombstone" };
  const u = payload as UtxoPayload;
  if (typeof u.owner !== "string" ||
      typeof u.values?.coin !== "number" ||
      u.values.coin < 0) {
    return { code: "rejected", error: "malformed utxo" };
  }
  return { code: "valid-utxo" };
};

// Transaction validation — runs on the envelope.
const txProgram: Program = async (out, upstream, read) => {
  const base = await messageDataProgram(out, upstream, read);
  if (base.code !== "msgdata:valid") return base;

  const [, payload] = out as Output<MessageData>;

  // Conservation: input sum == output sum.
  let inputSum = 0;
  for (const inputUri of payload.inputs) {
    const r = await read<UtxoPayload>(inputUri);
    if (!r.success) return { code: "rejected", error: `input not found: ${inputUri}` };
    inputSum += r.record!.data.values.coin;
  }
  const outputSum = payload.outputs.reduce(
    (s, [, p]) => s + (p as UtxoPayload).values.coin,
    0,
  );
  if (inputSum !== outputSum) {
    return { code: "rejected", error: `conservation: in=${inputSum} out=${outputSum}` };
  }

  // Auth: every input owner must have signed.
  for (const inputUri of payload.inputs) {
    const r = await read<UtxoPayload>(inputUri);
    const owner = r.record!.data.owner;
    if (!await verifyAuthInPayload(out, { pubkey: owner })) {
      return { code: "rejected", error: `missing/invalid signature for ${owner}` };
    }
  }

  return { code: "tx:valid" };
};

const local = connection(new DataStoreClient(new MemoryStore()), ["*"]);

const rig = new Rig({
  routes: { receive: [local], read: [local], observe: [local] },
  programs: {
    "utxo://": utxoProgram,
    "hash://sha256": txProgram,
  },
  handlers: {
    "tx:valid": messageDataHandler,
    // No handler for "valid-utxo" — default dispatch persists.
  },
});
```

That's the whole protocol installation.

## A transaction

Alice has UTXO `utxo://abc/0` worth 100 coin. She pays Bob 70 and
keeps 30 as change:

```ts
const aliceIdentity = await Identity.fromSeed(aliceSeed);

const inputs = ["utxo://abc/0"];
const outputs: Output[] = [
  ["utxo://def/0", { owner: bobPubkey,   values: { coin: 70 } }],
  ["utxo://def/1", { owner: alicePubkey, values: { coin: 30 } }],
];

const auth = [await aliceIdentity.sign({ inputs, outputs })];
const envelope = await message({ auth, inputs, outputs });

const op = rig.send([envelope]);
await op;            // pipeline ack
await op.settled;     // every route reported
```

## Pipeline trace

**process** — `txProgram` runs on the envelope:
1. Calls `messageDataProgram` to validate envelope shape — passes.
2. Reads `utxo://abc/0`, sums input coin: 100.
3. Sums output coin: 70 + 30 = 100. Conservation holds.
4. Verifies `payload.auth` against Alice's pubkey — passes.
5. Returns `{ code: "tx:valid" }`.

**handle** — `messageDataHandler` returns:

```ts
[
  ["hash://sha256/{computed}", { inputs, outputs, auth }], // envelope (audit)
  ["utxo://def/0", { owner: bobPubkey,   values: { coin: 70 } }],
  ["utxo://def/1", { owner: alicePubkey, values: { coin: 30 } }],
  ["utxo://abc/0", null],                                  // deletion
]
```

**broadcast** — each tuple dispatches through `routes.receive`.
`DataStoreClient` writes the three non-null payloads and deletes
`utxo://abc/0` (translated from the null payload).

Handler emissions skip program re-classification — the new UTXOs
land directly. For "re-classify on the way out" semantics, shape the
emissions as reactions instead.

**react** — a reaction maintains a per-owner balance index:

```ts
const indexBalance: Reaction = async ([uri, payload], read) => {
  const owner = payload === null
    ? await ownerOfDeletedUtxo(uri, read)
    : (payload as UtxoPayload).owner;
  const total = await sumBalanceFor(owner, read);
  return [[`index://balances/${owner}`, { coin: total }]];
};

rig.reaction("utxo://:txhash/:n", indexBalance);
```

It fires three times — twice for new outputs, once for the deletion.
Each return flows through `rig.send`; an indexer's program
classifies, an indexer's handler persists, balance-watching UIs
update.

## Final state

After `await op.settled`:

- `hash://sha256/{computed}` — the envelope (audit record)
- `utxo://def/0` — Bob's UTXO (70 coin)
- `utxo://def/1` — Alice's change (30 coin)
- `utxo://abc/0` — gone

Conservation is provable from the audit record. The balance index
matches.

## Where each chapter shows up

| Chapter | What runs |
|---|---|
| 1 — Output | `[uri, payload]` shape; UTXOs and the envelope are both `Output<T>` |
| 2 — Payload-agnostic rig | The rig routes by URI; conservation lives in the protocol |
| 3 — Process / handle / react | Pipeline phases; programs return codes, handler returns emissions |
| 4 — Send / receive | `rig.send([envelope])` is the entry point |
| 5 — Handlers | `messageDataHandler` decomposes envelopes |
| 6 — Broadcast | Handler emissions skip classification, dispatch through routes |
| 7 — Reactions | `indexBalance` fires per dispatched UTXO; emissions flow back through the pipeline |
| 8 — Decomposition | `messageDataProgram` + `messageDataHandler` is canon |
| 9 — Deletion as data | Inputs become `[uri, null]` tuples; `DataStoreClient` translates |
| 10 — Auth | `verifyAuthInPayload` checks every input owner's signature |
| 13 — OperationHandle | `op.settled` waits for every route to report |

## What's coming next

Chapter 12 — fan-out across multiple channels via connection
routing. One envelope, three publishers, no protocol-specific
fan-out code.

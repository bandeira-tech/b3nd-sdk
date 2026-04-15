# Option E Walkthrough: Roster Discovery + Inputs as Consumption

> No shift IDs. Inputs mean consumption. The roster is a phone book.

---

## Core Rules

1. **Inputs = consumption.** If a URI appears as an input, it's being spent. Not
   referenced, not acknowledged — consumed. References to other resources go in
   output values (URI pointers) or URI paths.

2. **The roster is the phone book.** A well-known mutable directory at
   `mutable://roster/{role}/{key}`. Anyone can list it to discover active
   workers. The operator manages who's on it.

3. **Work lives in account spaces.** Each worker writes consensus artifacts to
   their own account under `/consensus/`. Pubkey auth means only the worker can
   write there. Write-once means they can't change their mind.

4. **Discovery = list roster, then watch accounts.** A validator lists
   `mutable://roster/gateway/` to find gateways, then watches each gateway's
   `immutable://accounts/{gatewayKey}/consensus/pending/` for new work.

---

## The Roster

The roster is a flat, well-known, mutable directory. No operator key needed to
read it — just `list()`.

```
mutable://roster/gateway/{gatewayKey}      → true
mutable://roster/validator/{validatorKey}  → true
mutable://roster/confirmer/{confirmerKey}  → true
mutable://roster/producer/{producerKey}    → true
```

**Discovery:**

```typescript
// "Who are all the gateways right now?"
const gateways = await client.list("mutable://roster/gateway/");
// → ["mutable://roster/gateway/abc1", "mutable://roster/gateway/def2", ...]
```

**Who writes to it:** The operator. The roster validator enforces that only the
operator can add/remove entries. But reading and listing is open to everyone.

**Why mutable:** Workers come and go. The operator adds a gateway, removes a
validator, replaces a confirmer. The roster is a living directory, not a ledger.

**Why flat:** No eras, no scoping. The roster tells you who's active _right
now_. Reward eligibility and era-scoping are separate concerns tracked
elsewhere.

---

## Full Message Flow

### Stage 0: User Submits Content

Alice publishes content with a fee payment. She doesn't know or care about
consensus — she just writes content and pays.

```
hash://sha256/aaa111 → {
  auth: [{ pubkey: "alice", signature: "..." }],
  payload: {
    inputs: ["immutable://balance/alice/utxo1"],
    outputs: [
      ["immutable://balance/alice/utxo2", 949],
      ["immutable://balance/ROOT_KEY/aaa111", 1],
      ["hash://sha256/content_abc", { title: "Hello", body: "World" }]
    ]
  }
}
```

Inputs consume alice's balance. Outputs create change, pay the fee, and store
content. No `immutable://consumed/` marker — the input declaration IS the
consumption. No `consensus://record/` — that's the protocol's job, not the
user's.

The gateway receives this, validates locally (balance exists, conservation
holds, auth checks out), and stores it.

### Stage 1: Gateway Creates Pending

The gateway signals "this content is ready for validation" by writing to its own
account space under `/consensus/pending/`.

```
hash://sha256/pend_msg → {
  auth: [{ pubkey: "gateway_01", signature: "..." }],
  payload: {
    inputs: [],
    outputs: [
      ["immutable://accounts/gateway_01/consensus/pending/content_abc", "hash://sha256/aaa111"]
    ]
  }
}
```

**Written:** `immutable://accounts/gateway_01/consensus/pending/content_abc` →
`hash://sha256/aaa111`

No inputs — the gateway isn't consuming anything. It's publishing a fact: "I
received content `content_abc` and it's at `hash://sha256/aaa111`."

The pending lives in the gateway's account space
(`immutable://accounts/gateway_01/...`). The `immutable://accounts` validator
already enforces that only `gateway_01` can write there (pubkey auth).
Write-once is enforced by `immutable://`.

**Discovery:** Other nodes know to watch `gateway_01` because the roster lists
it:

```typescript
const gateways = await client.list("mutable://roster/gateway/");
for (const gw of gateways) {
  const gwKey = extractLastSegment(gw);
  const pending = await client.list(
    `immutable://accounts/${gwKey}/consensus/pending/`,
  );
  // → new work items
}
```

### Stage 2: Validators Attest

Validators discover pending items by watching gateway accounts listed on the
roster. They read the envelope, replay validation, and write attestations to
their own accounts.

**Validator 1:**

```
hash://sha256/att_v1 → {
  auth: [{ pubkey: "validator_01", signature: "..." }],
  payload: {
    inputs: [],
    outputs: [
      ["immutable://accounts/validator_01/consensus/attestation/content_abc", "hash://sha256/aaa111"]
    ]
  }
}
```

**Validator 2:**

```
hash://sha256/att_v2 → {
  auth: [{ pubkey: "validator_02", signature: "..." }],
  payload: {
    inputs: [],
    outputs: [
      ["immutable://accounts/validator_02/consensus/attestation/content_abc", "hash://sha256/aaa111"]
    ]
  }
}
```

**Written:**

```
immutable://accounts/validator_01/consensus/attestation/content_abc → hash://sha256/aaa111
immutable://accounts/validator_02/consensus/attestation/content_abc → hash://sha256/aaa111
```

No inputs — nothing consumed. The attestation is a fact published by the
validator. Pubkey auth ensures only `validator_01` can write to
`immutable://accounts/validator_01/...`. Write-once ensures they can't change
their mind.

**Discovery:** Confirmers know to watch validators because:

```typescript
const validators = await client.list("mutable://roster/validator/");
for (const v of validators) {
  const vKey = extractLastSegment(v);
  const attestations = await client.list(
    `immutable://accounts/${vKey}/consensus/attestation/`,
  );
  // → attestations to bundle
}
```

### Stage 3: Confirmer Bundles

The confirmer sees enough attestations for `content_abc`. It selects which
validators to credit and writes a confirmation. **This is where
inputs-as-consumption first matters** in the consensus flow:

```
hash://sha256/conf_msg → {
  auth: [{ pubkey: "confirmer_01", signature: "..." }],
  payload: {
    inputs: [
      "immutable://accounts/validator_01/consensus/attestation/content_abc",
      "immutable://accounts/validator_02/consensus/attestation/content_abc",
      "immutable://accounts/validator_07/consensus/attestation/content_abc"
    ],
    outputs: [
      ["immutable://accounts/confirmer_01/consensus/confirmation/content_abc", "hash://sha256/aaa111"]
    ]
  }
}
```

**Written:**
`immutable://accounts/confirmer_01/consensus/confirmation/content_abc` →
`hash://sha256/aaa111`

**The inputs consume the attestations.** Those three attestations are now spent
— they can't be included in another confirmation. The other 97 attestations
(from validators who weren't selected) remain unconsumed. This is the thin
market: the confirmer's selection determines which validators get credit.

An attestation that's consumed = that validator's work counted. An attestation
that's never consumed = that validator's work was wasted. This creates the
economic signal without any reward distribution logic — consumption IS the
crediting mechanism.

### Stage 4: Producer Creates Consensus Slot

The producer bundles confirmed content into temporal coordinates. It consumes
confirmations:

```
hash://sha256/block_msg → {
  auth: [{ pubkey: "producer_01", signature: "..." }],
  payload: {
    inputs: [
      "immutable://accounts/confirmer_01/consensus/confirmation/content_abc",
      "immutable://accounts/confirmer_01/consensus/confirmation/content_def",
      "immutable://accounts/confirmer_02/consensus/confirmation/content_ghi"
    ],
    outputs: [
      ["immutable://consensus/0/42/0/content_abc", "hash://sha256/aaa111"],
      ["immutable://consensus/0/42/1/content_def", "hash://sha256/ddd444"],
      ["immutable://consensus/0/42/2/content_ghi", "hash://sha256/ggg777"]
    ]
  }
}
```

**Written:**

```
immutable://consensus/0/42/0/content_abc → hash://sha256/aaa111
immutable://consensus/0/42/1/content_def → hash://sha256/ddd444
immutable://consensus/0/42/2/content_ghi → hash://sha256/ggg777
```

Inputs consume the confirmations — each confirmation can only be placed in one
block. Era 0, block 42, slots 0-2.

---

## Discovery Pattern

```
 ┌────────────────────────────────────────────┐
 │              ROSTER                         │
 │  mutable://roster/{role}/{key} → true       │
 │  (well-known, anyone can list)              │
 └──────────────────┬─────────────────────────┘
                    │
   ┌────────────────┼────────────────┐
   ▼                ▼                ▼
list(roster/     list(roster/     list(roster/
gateway/)        validator/)      confirmer/)
   │                │                │
   ▼                ▼                ▼
┌──────────┐   ┌──────────┐   ┌──────────┐
│gateway_01│   │validator_│   │confirmer_│
│  /consensus  │  01/consensus │  01/consensus
│  /pending/│   │/attestation/ │/confirmation/│
└────┬─────┘   └────┬─────┘   └────┬─────┘
     │               │               │
watch for new   watch for new   watch for new
content         attestations    confirmations
```

Each role watches the previous role's accounts for new outputs:

- Validators list `mutable://roster/gateway/` → watch each gateway's
  `.../consensus/pending/`
- Confirmers list `mutable://roster/validator/` → watch each validator's
  `.../consensus/attestation/`
- Producers list `mutable://roster/confirmer/` → watch each confirmer's
  `.../consensus/confirmation/`

The roster tells you WHOSE accounts to watch. No polling across the whole
namespace — you list specific accounts.

---

## Validators

### Roster Check (shared pattern)

All consensus validators need to verify the writer is on the roster. The roster
is a `mutable://` read:

```typescript
async function isOnRoster(
  read: ReadFn,
  role: string,
  key: string,
): Promise<boolean> {
  const roster = await read(`mutable://roster/${role}/${key}`);
  return roster.success;
}
```

### Pending (under `immutable://accounts`)

The existing `immutable://accounts` validator handles pubkey auth + write-once.
The pending-specific check is: the value must be a valid `hash://` reference and
the referenced envelope must exist.

```typescript
// Additional check layered on immutable://accounts for /consensus/pending/ paths:
if (uri.includes("/consensus/pending/")) {
  if (typeof value !== "string" || !value.startsWith("hash://sha256/")) {
    return { valid: false, error: "Pending value must be envelope hash URI" };
  }

  const envelope = await read(value);
  if (!envelope.success) {
    return { valid: false, error: "Referenced envelope not found" };
  }

  // Gateway must be on roster
  const gatewayKey = extractAccountKey(uri);
  if (!await isOnRoster(read, "gateway", gatewayKey)) {
    return { valid: false, error: "Gateway not on roster" };
  }
}
```

### Attestation (under `immutable://accounts`)

```typescript
if (uri.includes("/consensus/attestation/")) {
  if (typeof value !== "string" || !value.startsWith("hash://sha256/")) {
    return {
      valid: false,
      error: "Attestation value must be envelope hash URI",
    };
  }

  // Validator must be on roster
  const validatorKey = extractAccountKey(uri);
  if (!await isOnRoster(read, "validator", validatorKey)) {
    return { valid: false, error: "Validator not on roster" };
  }

  // Content must be pending at some gateway
  // (The value points to the envelope — validator already replayed validation before writing)
}
```

### Confirmation (under `immutable://accounts`)

```typescript
if (uri.includes("/consensus/confirmation/")) {
  if (typeof value !== "string" || !value.startsWith("hash://sha256/")) {
    return {
      valid: false,
      error: "Confirmation value must be envelope hash URI",
    };
  }

  // Confirmer must be on roster
  const confirmerKey = extractAccountKey(uri);
  if (!await isOnRoster(read, "confirmer", confirmerKey)) {
    return { valid: false, error: "Confirmer not on roster" };
  }

  // Message must consume CONFIRMATION_THRESHOLD attestations as inputs
  const msg = message as MessageData;
  const contentHash = extractContentHash(uri);
  const attInputs = msg.payload.inputs.filter((i) =>
    i.includes("/consensus/attestation/" + contentHash)
  );

  if (attInputs.length < CONFIRMATION_THRESHOLD) {
    return {
      valid: false,
      error:
        `Need ${CONFIRMATION_THRESHOLD} attestation inputs, got ${attInputs.length}`,
    };
  }

  // Each attestation input must exist (not already consumed)
  for (const attUri of attInputs) {
    const att = await read(attUri);
    if (!att.success) {
      return {
        valid: false,
        error: `Attestation not found or already consumed: ${attUri}`,
      };
    }
  }
}
```

### Consensus Slot

```typescript
export const consensusSlotValidator: ValidationFn = async (
  { uri, value, read, message },
) => {
  if ((await read(uri)).success) {
    return { valid: false, error: "Slot already filled" };
  }

  if (typeof value !== "string" || !value.startsWith("hash://sha256/")) {
    return { valid: false, error: "Value must be envelope hash URI" };
  }

  const msg = message as MessageData;
  const producerKey = msg.auth?.[0]?.pubkey;
  if (!producerKey) {
    return { valid: false, error: "Must be signed" };
  }

  // Producer on roster
  if (!await isOnRoster(read, "producer", producerKey)) {
    return { valid: false, error: "Producer not on roster" };
  }

  // Must consume confirmation as input
  const contentHash = extractSegment(uri, 4); // consensus/{era}/{block}/{slot}/{contentHash}
  const confInputs = msg.payload.inputs.filter((i) =>
    i.includes("/consensus/confirmation/" + contentHash)
  );
  if (confInputs.length === 0) {
    return { valid: false, error: "Must consume a confirmation as input" };
  }

  const conf = await read(confInputs[0]);
  if (!conf.success) {
    return {
      valid: false,
      error: "Confirmation not found or already consumed",
    };
  }

  return { valid: true };
};
```

---

## What the Roster Replaces

| Old concept              | Replaced by                                                |
| ------------------------ | ---------------------------------------------------------- |
| Shift ID                 | Not needed — roster membership + pubkey auth is sufficient |
| Recency proof            | Not needed for now (see Open questions)                    |
| `VALIDATOR_SET` constant | Roster entries (operator-managed, queryable)               |
| `getCurrentBlock()`      | Block number declared in consensus slot URI                |

---

## Consumption Chain

Every stage consumes the previous stage's outputs:

```
User's balance (input)
  └→ content + fee (outputs)

Gateway writes pending (no consumption — just publishes)

Validators write attestations (no consumption — just publishes)

Confirmer consumes attestations (inputs)
  └→ confirmation (output)

Producer consumes confirmations (inputs)
  └→ consensus slots (outputs)
```

Pending and attestation are publication — free to write (gated by roster, not by
consumption). Confirmation and slot assignment are consumption — each input can
only be spent once.

---

## What's NOT Here

- **Proof-of-work** — gone. Roster membership is the anti-spam layer.
- **Shift IDs** — gone. Roster + pubkey auth covers identity and authorization.
- **`immutable://consumed/`** — gone. Inputs = consumption.
- **`consensus://record/`** in user envelope — gone. Consensus is the protocol's
  concern.
- **`list()` in validators** — not needed. Confirmers declare attestation
  inputs. Validators `read()` each one.
- **Block chaining** — the producer declares block numbers in the URI. Slot
  validator checks the confirmation exists.
- **Operator key for discovery** — not needed. Roster is at well-known
  `mutable://roster/` URIs.

---

## Open After This

- **Reward mechanism.** The roster is a phone book, not a ticket. How do workers
  claim rewards? Options: (a) consuming an era-scoped immutable resource, (b)
  the consumption chain itself tracks credit (your attestation was consumed =
  you're credited), (c) the producer's block message includes reward outputs.
  This is the next design question.

- **How does `inputs = consumption` work at the framework level?** Today
  MemoryStore doesn't enforce consumption semantics — it would need to mark
  consumed URIs as spent and reject reads/re-consumption. This is a framework
  change.

- **Sub-path dispatch in validators.** `immutable://accounts` currently has one
  validator. Pending, attestation, and confirmation need sub-path-specific
  validation logic. Either the accounts validator gains a dispatch table, or
  these become separate programs.

- **Roster access control.** Who can write to `mutable://roster/`? The operator
  — but how is "the operator" defined? Is there a `mutable://roster/operator`
  entry that bootstraps the whole thing? Or is it hardcoded in the roster
  validator?

- **Era transitions and temporal scoping.** The roster itself is era-less, but
  consensus slots are era-scoped (`consensus/{era}/{block}/{slot}`). How does
  the network know which era it's in?

# Firecat Temporal Consensus Protocol

> Multi-stage confirmation with unbounded attestation and selective confirmation
> markets.

## Overview

This protocol extends Firecat's base consensus with temporal structure
(era/block/slot) and multi-stage validation:

1. **Pending** — Node receives and validates content locally
2. **Attestation** — Validators sign content (unbounded, many participate)
3. **Confirmation** — Confirmer selects N attestations and bundles them (thin
   market)
4. **Consensus Slot** — Block producer places confirmed content in temporal
   coordinates

**Key principle:** Everything is a message. Signatures are values. The URI
encodes identity and stage. Validation reads from message inputs.

## URI Structure

```
immutable://pending/{contentHash}/{submitterKey} → signature
immutable://attestation/{contentHash}/{validatorKey} → signature
immutable://confirmation/{contentHash} → signature
immutable://consensus/{era}/{block}/{slot}/{contentHash} → signature
```

Each stage:

- **URI** tells you: what content, which stage, whose action
- **Value** proves: that key committed to that content (signature)
- **Message inputs** declare: what prior stage resources this
  consumes/references

## Message Flow

### Stage 1: Original Content

```typescript
hash://sha256/abc123 → {
  auth: [{pubkey: "alice", signature: "..."}],
  payload: {
    inputs: ["immutable://balance/alice/utxo1"],  // fee
    outputs: [
      ["immutable://balance/alice/utxo2", 950],
      ["immutable://balance/fee_pool/xyz", 50],
      ["consensus://record/abc123", "hash://sha256/abc123"]
    ]
  }
}
```

User submits content (fee-paying message with actual data).

### Stage 2: Pending Submission

```typescript
hash://pending_msg → {
  auth: [{pubkey: "node_xyz", signature: sign(nodePriv, hash(pending_msg))}],
  payload: {
    inputs: [],
    outputs: [
      ["immutable://pending/abc123/node_xyz", sign(nodePriv, "abc123")]
    ]
  }
}
```

**Written:** `immutable://pending/abc123/node_xyz → signature_over_abc123`

Node validates locally (balance, conservation, auth) and creates pending marker
if valid.

### Stage 3: Attestation (Unbounded)

Many validators attest. No limit, no race. All succeed.

```typescript
// Validator 1
hash://att_v1 → {
  auth: [{pubkey: "validator_001", signature: sign(v1Priv, hash(att_v1))}],
  payload: {
    inputs: ["immutable://pending/abc123/node_xyz"],
    outputs: [
      ["immutable://attestation/abc123/validator_001", sign(v1Priv, "abc123")]
    ]
  }
}

// Validator 2
hash://att_v2 → {
  auth: [{pubkey: "validator_002", signature: sign(v2Priv, hash(att_v2))}],
  payload: {
    inputs: ["immutable://pending/abc123/node_xyz"],
    outputs: [
      ["immutable://attestation/abc123/validator_002", sign(v2Priv, "abc123")]
    ]
  }
}

// ... validators 3-100 all attest ...
```

**Result:** 100 attestation leaves exist:

- `immutable://attestation/abc123/validator_001 → sig1`
- `immutable://attestation/abc123/validator_002 → sig2`
- ...
- `immutable://attestation/abc123/validator_100 → sig100`

### Stage 4: Confirmation (Selective)

Confirmer **chooses** which attestations to include. This is the thin market.

```typescript
hash://confirm_msg → {
  auth: [{pubkey: "confirmer_bob", signature: sign(bobPriv, hash(confirm_msg))}],
  payload: {
    inputs: [
      "immutable://attestation/abc123/validator_042",  // chosen
      "immutable://attestation/abc123/validator_017",  // chosen
      "immutable://attestation/abc123/validator_091"   // chosen
    ],
    outputs: [
      ["immutable://confirmation/abc123", sign(bobPriv, "abc123")]
    ]
  }
}
```

**Written:** `immutable://confirmation/abc123 → signature_over_abc123`

**Thin market:** Confirmer picks 3 out of 100 attestations. Only those 3 get
credited (eligible for rewards). The other 97 attestations exist but are unused.

### Stage 5: Consensus Slot (Bundling)

Block producer bundles many confirmations into temporal coordinates.

```typescript
hash://block_msg → {
  auth: [{pubkey: "producer_carol", signature: sign(carolPriv, hash(block_msg))}],
  payload: {
    inputs: [
      "immutable://confirmation/abc123",
      "immutable://confirmation/def456",
      "immutable://confirmation/ghi789",
      // ... many confirmations
    ],
    outputs: [
      ["immutable://consensus/0/42/7/abc123", sign(carolPriv, "abc123")],
      ["immutable://consensus/0/42/7/def456", sign(carolPriv, "def456")],
      ["immutable://consensus/0/42/7/ghi789", sign(carolPriv, "ghi789")],
      // ... corresponding slots
    ]
  }
}
```

**Written:** `immutable://consensus/0/42/7/abc123 → signature_over_abc123`

Slots encode: era 0, block 42, slot 7.

## Validators

### pendingValidator

```typescript
export const pendingValidator: ProgramValidator = async (
  { uri, value, message, read },
) => {
  // Write-once
  if ((await read(uri)).success) {
    return { valid: false, error: "Already pending" };
  }

  // Value must be signature
  if (typeof value !== "string" || !/^[0-9a-f]+$/i.test(value)) {
    return { valid: false, error: "Value must be hex signature" };
  }

  // Extract from URI: pending/{contentHash}/{submitterKey}
  const contentHash = extractSegment(uri, 1);
  const submitterKey = extractSegment(uri, 2);

  // Verify signature over content hash
  if (!await verify(submitterKey, value, contentHash)) {
    return { valid: false, error: "Invalid signature" };
  }

  // Message must be signed by submitter
  if (message.auth[0]?.pubkey !== submitterKey) {
    return { valid: false, error: "Auth mismatch" };
  }

  return { valid: true };
};
```

### attestationValidator

```typescript
export const attestationValidator: ProgramValidator = async (
  { uri, value, message, read },
) => {
  // Write-once
  if ((await read(uri)).success) {
    return { valid: false, error: "Already attested" };
  }

  // Value must be signature
  if (typeof value !== "string" || !/^[0-9a-f]+$/i.test(value)) {
    return { valid: false, error: "Value must be hex signature" };
  }

  // Extract from URI: attestation/{contentHash}/{validatorKey}
  const contentHash = extractSegment(uri, 1);
  const validatorKey = extractSegment(uri, 2);

  // Verify signature over content hash
  if (!await verify(validatorKey, value, contentHash)) {
    return { valid: false, error: "Invalid signature" };
  }

  // Message must reference pending as input
  const pendingPattern = `immutable://pending/${contentHash}/`;
  const hasPendingInput = message.payload.inputs.some((i) =>
    i.startsWith(pendingPattern)
  );
  if (!hasPendingInput) {
    return { valid: false, error: "Must reference pending record" };
  }

  // Verify at least one pending input exists
  let foundPending = false;
  for (const input of message.payload.inputs) {
    if (input.startsWith(pendingPattern)) {
      const pending = await read(input);
      if (pending.success) {
        foundPending = true;
        break;
      }
    }
  }
  if (!foundPending) {
    return { valid: false, error: "No valid pending input" };
  }

  // Check validator authorization (if using static set)
  if (VALIDATOR_SET && !VALIDATOR_SET.includes(validatorKey)) {
    return { valid: false, error: "Not in validator set" };
  }

  // Message must be signed by validator
  if (message.auth[0]?.pubkey !== validatorKey) {
    return { valid: false, error: "Auth mismatch" };
  }

  return { valid: true };
};
```

### confirmationValidator

```typescript
export const confirmationValidator: ProgramValidator = async (
  { uri, value, message, read },
) => {
  // Write-once
  if ((await read(uri)).success) {
    return { valid: false, error: "Already confirmed" };
  }

  // Value must be signature
  if (typeof value !== "string" || !/^[0-9a-f]+$/i.test(value)) {
    return { valid: false, error: "Value must be hex signature" };
  }

  // Extract from URI: confirmation/{contentHash}
  const contentHash = extractSegment(uri, 1);

  // Extract attestation inputs from message
  const attestationInputs = message.payload.inputs.filter(
    (i) => i.startsWith(`immutable://attestation/${contentHash}/`),
  );

  // Must have threshold
  if (attestationInputs.length < CONFIRMATION_THRESHOLD) {
    return {
      valid: false,
      error:
        `Need ${CONFIRMATION_THRESHOLD} attestations, got ${attestationInputs.length}`,
    };
  }

  // Verify each attestation input exists and is valid
  const seenValidators = new Set<string>();

  for (const inputUri of attestationInputs) {
    // Read attestation
    const att = await read(inputUri);
    if (!att.success) {
      return { valid: false, error: `Attestation ${inputUri} does not exist` };
    }

    // Extract validator key
    const validatorKey = extractSegment(inputUri, 2);

    // No duplicates
    if (seenValidators.has(validatorKey)) {
      return { valid: false, error: `Duplicate validator ${validatorKey}` };
    }
    seenValidators.add(validatorKey);

    // Verify attestation signature
    const attSig = att.record.data as string;
    if (!await verify(validatorKey, attSig, contentHash)) {
      return {
        valid: false,
        error: `Invalid attestation from ${validatorKey}`,
      };
    }

    // Check authorization
    if (VALIDATOR_SET && !VALIDATOR_SET.includes(validatorKey)) {
      return { valid: false, error: `${validatorKey} not authorized` };
    }
  }

  // Verify confirmation signature
  const confirmerKey = message.auth[0]?.pubkey;
  if (!confirmerKey) {
    return { valid: false, error: "No auth signature" };
  }

  if (!await verify(confirmerKey, value, contentHash)) {
    return { valid: false, error: "Invalid confirmation signature" };
  }

  return { valid: true };
};
```

### consensusSlotValidator

```typescript
export const consensusSlotValidator: ProgramValidator = async (
  { uri, value, message, read },
) => {
  // Write-once
  if ((await read(uri)).success) {
    return { valid: false, error: "Slot already filled" };
  }

  // Value must be signature
  if (typeof value !== "string" || !/^[0-9a-f]+$/i.test(value)) {
    return { valid: false, error: "Value must be hex signature" };
  }

  // Extract from URI: consensus/{era}/{block}/{slot}/{contentHash}
  const era = parseInt(extractSegment(uri, 1));
  const block = parseInt(extractSegment(uri, 2));
  const slot = parseInt(extractSegment(uri, 3));
  const contentHash = extractSegment(uri, 4);

  // Message must include confirmation as input
  const confirmationInput = `immutable://confirmation/${contentHash}`;
  if (!message.payload.inputs.includes(confirmationInput)) {
    return { valid: false, error: "Must include confirmation as input" };
  }

  // Verify confirmation exists
  const conf = await read(confirmationInput);
  if (!conf.success) {
    return { valid: false, error: "Confirmation does not exist" };
  }

  // Verify signature
  const producerKey = message.auth[0]?.pubkey;
  if (!producerKey) {
    return { valid: false, error: "No auth signature" };
  }

  if (!await verify(producerKey, value, contentHash)) {
    return { valid: false, error: "Invalid slot signature" };
  }

  // Temporal validation
  // TODO: validate era/block/slot timing
  // - era must be current or recent
  // - block must be sequential
  // - slot must be within block capacity

  // Check producer authorization
  if (PRODUCER_SET && !PRODUCER_SET.includes(producerKey)) {
    return { valid: false, error: "Not authorized block producer" };
  }

  return { valid: true };
};
```

## Market Dynamics

### Attestation Market (Commodity)

- **Cost:** Gas/storage fee to write attestation
- **Revenue:** Potential reward if selected by confirmer
- **Strategy:** Attest to everything, hope to get selected
- **Result:** 100 validators → 100 attestations → all valid

No scarcity. No race. Validators just submit and wait to be chosen.

### Confirmation Market (Selective)

- **Cost:** Gas to bundle N attestations
- **Revenue:** Confirmation fee + potential block inclusion
- **Strategy:** Pick attestations strategically
  - Fastest N? (speed incentive for validators)
  - Highest reputation? (quality incentive)
  - Random N? (fairness)
  - Auction? (validators bid for inclusion)
- **Result:** 1 confirmer picks 3 out of 100 → 97 attestations unused

This is the thin market. Confirmers create scarcity by choosing which
attestations get credited.

### Block Production Market (Bundling)

- **Cost:** Compute to bundle many confirmations
- **Revenue:** Block reward + fees
- **Strategy:** Fill slots efficiently
  - Maximum confirmations per block
  - Optimize for fee revenue
- **Result:** 1 producer bundles 100+ confirmations into era/block/slots

Block producers aggregate confirmed content into temporal coordinates for
efficient querying and consensus finality.

## State Queries

```typescript
// "What's pending for content abc123?"
await client.list("immutable://pending/abc123/");
// → ["immutable://pending/abc123/node_xyz"]

// "Who attested to abc123?"
await client.list("immutable://attestation/abc123/");
// → 100 URIs, one per validator

// "Is abc123 confirmed?"
await client.read("immutable://confirmation/abc123");
// → signature by confirmer (if confirmed), or not found

// "Which attestations were used in confirmation?"
const confirmMsg = await client.read("hash://sha256/confirm_msg");
confirmMsg.record.data.payload.inputs;
// → ["attestation/abc123/validator_042", ...]

// "Where did abc123 land in consensus?"
await client.list("immutable://consensus/*/*/*/abc123");
// → ["immutable://consensus/0/42/7/abc123"]

// "What's in era 0, block 42, slot 7?"
await client.list("immutable://consensus/0/42/7/");
// → all content hashes in that slot
```

## Design Rationale

### Why signatures as values?

The message's auth signature is "lost" when outputs are written to state. Later
readers of `immutable://attestation/abc123/validator_001` only get the value,
not the original message's auth field. So we explicitly store the signature as
the value, creating a receipt that proves the validator committed to that
content.

### Why unbounded attestation?

No need to create artificial scarcity at the attestation layer. Let all
validators participate. The market coordination happens at confirmation (where
confirmers choose which attestations to include).

### Why inputs in validators?

Validators check that the message declares the right inputs (pending,
attestations, confirmations). This ensures the confirmation graph is well-formed
without requiring validators to do arbitrary state queries. The message
structure encodes the provenance.

### Why temporal coordinates?

Block producers assign era/block/slot to create:

- **Temporal ordering** — content gets placed in time
- **Efficient queries** — "what happened in block 42?"
- **Archival checkpoints** — prune by era
- **Consensus finality** — slot placement is the final confirmation

## Open Questions

### Node Identity & Registration

Currently any pubkey can be a validator/confirmer/producer. This enables spam
and lacks accountability. Need:

- First-class node identity abstraction
- Registration resource that gets referenced in submissions
- Stricter validation rules for node credentials
- Predictable schedules/pools of workers
- Spam prevention on consensus process

**Next:** Design node registration and identity resources.

### Timing & Liveness

- How do we enforce era/block/slot timing?
- What happens if no confirmers are online?
- How long do we wait for attestations before timeout?
- Should there be deadlines enforced in validators?

### Reward Distribution

- How do validators claim rewards for selected attestations?
- How do confirmers get paid for bundling?
- How do block producers collect fees?
- Should there be UTXO outputs for each role?

### Reorg & Finality

- Can blocks be reorganized?
- When is a slot considered final?
- What's the finality gadget?

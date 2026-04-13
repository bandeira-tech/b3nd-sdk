# Firecat Confirmation Protocol

> How nodes validate and confirm consensus messages across a multi-node network.

## Problem

Today a Firecat node validates a `consensus://record/{hash}` locally — one node
decides validity. For a decentralized protocol, we need **N-of-M independent
nodes** to agree before a record is considered confirmed. The challenge is doing
this without introducing a consensus engine, leader election, or any machinery
foreign to B3nd's message primitive.

## Design Principles

1. **Everything is `[uri, values, data]`.** Confirmation is just more messages — signed
   attestations stored at self-describing URIs.

2. **The URI is the identity.** The URL encodes who, what, and why. The value is
   the thing being identified — a scalar, a boolean marker, or a URI reference.
   Never a JSON metadata blob. If you're tempted to put a field in the value,
   ask whether it belongs in the URI path instead.

Look at the existing Firecat patterns:

| URI                                       | Value                         | Why                                             |
| ----------------------------------------- | ----------------------------- | ----------------------------------------------- |
| `immutable://balance/{account}/{utxoId}`  | `number`                      | The balance amount — the thing at this location |
| `immutable://consumed/{account}/{utxoId}` | `string` (URI ref)            | Points to the balance being consumed            |
| `immutable://genesis/{pubkey}`            | `true`                        | Marker — existence is the fact                  |
| `consensus://record/{contentHash}`        | `hash://sha256/{contentHash}` | Points to the content                           |

The URI carries the relationship graph. The value is minimal.

---

## 1. URI Design

### New Programs

```
immutable://pending/{contentHash}/{submitterNodeKey}    → hash://sha256/{envelopeHash}
immutable://attestation/{envelopeHash}/{nodeKey}        → true
immutable://rejection/{envelopeHash}/{nodeKey}          → string (reason)
immutable://confirmation/{contentHash}/{envelopeHash}   → true
```

Reading these as sentences:

- **Pending:** "Content `{contentHash}`, submitted by node `{submitterNodeKey}`,
  is the envelope at `hash://sha256/{envelopeHash}`." The value is a pointer to
  the envelope — the actual thing being submitted.

- **Attestation:** "Node `{nodeKey}` endorses envelope `{envelopeHash}`." Value
  is `true` — existence is the endorsement. Write-once = no equivocation.

- **Rejection:** "Node `{nodeKey}` rejects envelope `{envelopeHash}` because
  `{reason}`." The verdict is the program itself (`attestation` vs `rejection`),
  not a field inside a JSON blob. The value is the reason string — the thing you
  want to know when you read a rejection.

- **Confirmation:** "Content `{contentHash}` is confirmed via envelope
  `{envelopeHash}`." Value is `true` — existence is the fact. The attestation
  proofs are already at their own URIs.

### Why This Shape

Every field that was a JSON property in the previous draft is now either:

- **In the URI** (submitter, node key, content hash, envelope hash) — because
  it's part of the identity
- **Gone** (timestamp, attestation list) — because it's derivable or stored
  elsewhere
- **The value itself** (envelope reference, reason string, boolean marker) —
  because it's the thing being located

No JSON objects anywhere in the confirmation flow.

---

## 2. Message Lifecycle

```
PENDING  →  ATTESTED  →  CONFIRMED
  (1 node)    (threshold)   (finalized)
```

### Stage 0: Submission

A client submits a signed envelope containing a
`consensus://record/{contentHash}` output. The receiving node runs existing
Firecat validators (balance, consumed, fee, conservation, auth). If local
validation passes, the node:

1. Stores the envelope at `hash://sha256/{envelopeHash}`
2. Writes the pending marker:

```
immutable://pending/{contentHash}/{nodeKey}  →  hash://sha256/{envelopeHash}
```

3. Does **not** yet write `consensus://record/{contentHash}` — that's the
   finalized output.

The pending URI encodes both the content being submitted and the node that
received it. The value points to the full envelope. Any node can
`list("immutable://pending/")` to discover work, or
`list("immutable://pending/{contentHash}/")` to find all submissions for
specific content.

### Stage 1: Attestation (Per-Node Endorsement)

Every node in the network monitors `immutable://pending/` for new entries. When
a node sees a pending record, it:

1. Reads the envelope from the pending record's value
   (`hash://sha256/{envelopeHash}`)
2. Replays full validation locally (fee check, conservation, auth, double-spend)
3. Writes its verdict:

If valid:

```
immutable://attestation/{envelopeHash}/{nodeKey}  →  true
```

If invalid:

```
immutable://rejection/{envelopeHash}/{nodeKey}  →  "Conservation violated: inputs (500) < outputs (600)"
```

The program name IS the verdict. No need for a `verdict` field — you query
`attestation` to check endorsement, `rejection` to check failure. Both are
write-once per node per envelope.

### Stage 2: Confirmation (Threshold Reached)

Any node can attempt to finalize. When a node counts enough attestations for an
envelope:

1. Lists `immutable://attestation/{envelopeHash}/` — each entry is a node
   endorsement
2. Counts entries (each is `true` at a distinct `{nodeKey}` path)
3. If count >= threshold, writes confirmation + the final consensus record:

```
immutable://confirmation/{contentHash}/{envelopeHash}  →  true
consensus://record/{contentHash}                       →  hash://sha256/{contentHash}
```

The confirmation URI captures the relationship between content and the specific
envelope that achieved consensus. The consensus record is the same as today.

---

## 3. Validators

### `pendingValidator`

```typescript
(async ({ uri, value, read }) => {
  // Write-once
  if ((await read(uri)).success) {
    return { valid: false, error: "Already pending" };
  }

  // Value must be an envelope hash reference
  if (typeof value !== "string" || !value.startsWith("hash://sha256/")) {
    return { valid: false, error: "Value must be envelope hash URI" };
  }

  // Envelope must exist
  const envelope = await read(value);
  if (!envelope.success) {
    return { valid: false, error: "Referenced envelope not found" };
  }

  return { valid: true };
});
```

### `attestationValidator`

```typescript
(async ({ uri, value, read }) => {
  // Write-once
  if ((await read(uri)).success) {
    return { valid: false, error: "Already attested" };
  }

  // Value must be true (existence is the endorsement)
  if (value !== true) {
    return { valid: false, error: "Attestation value must be true" };
  }

  // Extract envelopeHash from URI
  const envelopeHash = extractSegment(uri, 1); // attestation/{envelopeHash}/{nodeKey}

  // Envelope must be pending somewhere
  // (Read the envelope directly — if it exists at hash://, it was submitted)
  const envelope = await read(`hash://sha256/${envelopeHash}`);
  if (!envelope.success) {
    return { valid: false, error: "Envelope not found" };
  }

  return { valid: true };
});
```

### `rejectionValidator`

```typescript
(async ({ uri, value, read }) => {
  // Write-once
  if ((await read(uri)).success) {
    return { valid: false, error: "Already rejected" };
  }

  // Value must be a reason string
  if (typeof value !== "string" || value.length === 0) {
    return { valid: false, error: "Rejection value must be a reason string" };
  }

  // Envelope must exist
  const envelopeHash = extractSegment(uri, 1);
  const envelope = await read(`hash://sha256/${envelopeHash}`);
  if (!envelope.success) {
    return { valid: false, error: "Envelope not found" };
  }

  return { valid: true };
});
```

### `confirmationValidator`

```typescript
(async ({ uri, value, read, list }) => {
  // Write-once
  if ((await read(uri)).success) {
    return { valid: false, error: "Already confirmed" };
  }

  // Value must be true
  if (value !== true) {
    return { valid: false, error: "Confirmation value must be true" };
  }

  // Extract envelopeHash from URI
  const envelopeHash = extractSegment(uri, 2); // confirmation/{contentHash}/{envelopeHash}

  // Count attestations by listing immutable://attestation/{envelopeHash}/
  const attestations = await list(`immutable://attestation/${envelopeHash}/`);
  if (
    !attestations.success || attestations.uris.length < CONFIRMATION_THRESHOLD
  ) {
    return {
      valid: false,
      error: `Need ${CONFIRMATION_THRESHOLD} attestations, got ${
        attestations.uris?.length ?? 0
      }`,
    };
  }

  return { valid: true };
});
```

### Updated `consensusRecordValidator`

The existing validator gains one check — confirmation must exist for the
content:

```typescript
// After existing checks (fee, content exists, write-once)...

// In multi-node mode: confirmation required
if (CONFIRMATION_THRESHOLD > 1) {
  const confirmations = await list(`immutable://confirmation/${contentHash}/`);
  if (!confirmations.success || confirmations.uris.length === 0) {
    return { valid: false, error: "Not yet confirmed by network" };
  }
}
```

---

## 4. Node Behavior

### Discovery: How Nodes See Pending Messages

Nodes poll `immutable://pending/` via `list()`. In a peer-replicated network,
pending records propagate to all peers automatically. Each peer:

1. Runs `list("immutable://pending/")` on interval
2. For each new entry, extracts the envelope hash from the value
3. Checks if it already attested:
   `read("immutable://attestation/{envelopeHash}/{selfKey}")`
4. If not attested, reads the envelope and validates

### Validation Replay

```typescript
async function replayValidation(
  client: NodeProtocolInterface,
  envelopeUri: string,
): Promise<{ verdict: "valid" } | { verdict: "invalid"; reason: string }> {
  const envelope = await client.read(envelopeUri);
  if (!envelope.success) {
    return { verdict: "invalid", reason: "Envelope not found" };
  }

  const msg = envelope.record.data as MessageData;

  for (const [outputUri, outputValue] of msg.payload.outputs) {
    const program = extractProgram(outputUri);
    const validator = schema[program];
    if (!validator) {
      return { verdict: "invalid", reason: `Unknown program: ${program}` };
    }

    const result = await validator({
      uri: outputUri,
      value: outputValue,
      read: client.read.bind(client),
      message: msg,
    });
    if (!result.valid) {
      return {
        verdict: "invalid",
        reason: result.error ?? "Validation failed",
      };
    }
  }

  return { verdict: "valid" };
}
```

After replay, the node writes either:

```
immutable://attestation/{envelopeHash}/{selfKey}  →  true
```

or:

```
immutable://rejection/{envelopeHash}/{selfKey}  →  "Conservation violated: ..."
```

### Finalization Race

Multiple nodes may attempt to finalize simultaneously. Since
`immutable://confirmation/{contentHash}/{envelopeHash}` is write-once, exactly
one succeeds. Losing nodes get `"Already confirmed"` and move on. No
coordination needed.

### Timing

| Parameter                  | Default                       | Tunable         |
| -------------------------- | ----------------------------- | --------------- |
| Pending poll interval      | 5s                            | Per-node config |
| Attestation timeout        | 60s                           | Schema constant |
| Confirmation threshold     | 2-of-3                        | Schema constant |
| Finalization attempt delay | jittered 1-5s after threshold | Per-node        |

---

## 5. Network Topology

```
        ┌──────────┐
 submit │  Node A   │ attest
───────►│ (receives)│──────►  immutable://attestation/{h}/A  →  true
        └─────┬─────┘
              │ replicates pending
              ▼
        ┌──────────┐
        │  Node B   │ attest
        │ (peer)    │──────►  immutable://attestation/{h}/B  →  true
        └─────┬─────┘
              │ replicates pending
              ▼
        ┌──────────┐
        │  Node C   │ attest
        │ (peer)    │──────►  immutable://attestation/{h}/C  →  true
        └──────────┘
              │
              ▼  (any node sees 2/3 attestations)
        ┌──────────┐
        │ Finalizer │──► immutable://confirmation/{c}/{h}  →  true
        │ (any node)│──► consensus://record/{c}  →  hash://sha256/{c}
        └──────────┘
```

---

## 6. Trust Model

### Who can attest?

**A. Static set (simplest):** Schema constant lists node pubkeys.

```typescript
export const VALIDATOR_SET = [NODE_A_KEY, NODE_B_KEY, NODE_C_KEY];
export const CONFIRMATION_THRESHOLD = 2;
```

Attestation validator checks: `nodeKey ∈ VALIDATOR_SET`.

**B. Dynamic set (registry-based):**

```
mutable://accounts/{operatorKey}/validators/{nodeKey}  →  true
```

Each validator is a marker at its own URI. Operator adds/removes by
writing/deleting. Attestation validator reads the marker to check authorization.

**C. Stake-weighted (future):** Validators must hold a minimum balance at
`immutable://balance/{nodeKey}/...`. Weight proportional to stake.

### What prevents equivocation?

Write-once URIs. `immutable://attestation/{hash}/{nodeKey}` can only be written
once. Second attempt fails. The URI is the commitment.

### What about offline nodes?

The threshold handles this. 2-of-3 means one node can be offline. Attestation
timeout prevents indefinite waiting.

---

## 7. Schema Extension

```typescript
// New programs in mod.ts:
"immutable://pending":      pendingValidator,
"immutable://attestation":  attestationValidator,
"immutable://rejection":    rejectionValidator,
"immutable://confirmation": confirmationValidator,
```

New constants:

```typescript
export const CONFIRMATION_THRESHOLD = 2;
export const ATTESTATION_TIMEOUT_MS = 60_000;
```

---

## 8. Client-Facing API

The client still sends a signed envelope with `consensus://record/{hash}`. What
changes is that `receive()` returns when the pending marker is created, and the
client polls for confirmation:

```typescript
const result = await client.receive(envelope);
// accepted = true means "pending, awaiting confirmation"

// Poll for confirmation:
const confirmed = await client.read(
  `immutable://confirmation/${contentHash}/${envelopeHash}`,
);
if (confirmed.success) {
  // Record is finalized across the network
}
```

Helper:

```typescript
export async function waitForConfirmation(
  client: NodeProtocolInterface,
  contentHash: string,
  envelopeHash: string,
  timeoutMs = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const uri = `immutable://confirmation/${contentHash}/${envelopeHash}`;
  while (Date.now() < deadline) {
    const result = await client.read(uri);
    if (result.success) return true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}
```

---

## 9. Querying the Confirmation Graph

Because the identity is in the URIs, the full confirmation graph is queryable
without parsing any values:

```typescript
// "Who submitted pending records for this content?"
await client.list(`immutable://pending/${contentHash}/`);
// → ["immutable://pending/{contentHash}/{nodeA}", ...]

// "Which nodes endorsed this envelope?"
await client.list(`immutable://attestation/${envelopeHash}/`);
// → ["immutable://attestation/{h}/{nodeA}", "immutable://attestation/{h}/{nodeB}"]

// "Which nodes rejected this envelope?"
await client.list(`immutable://rejection/${envelopeHash}/`);
// → ["immutable://rejection/{h}/{nodeC}"]

// "Why did node C reject?"
await client.read(`immutable://rejection/${envelopeHash}/${nodeC}`);
// → "Conservation violated: inputs (500) < outputs (600)"

// "Is this content confirmed, and by which envelope?"
await client.list(`immutable://confirmation/${contentHash}/`);
// → ["immutable://confirmation/{contentHash}/{envelopeHash}"]
```

No JSON parsing. The URI namespace is the index.

---

## 10. Migration Path

Controlled by `CONFIRMATION_THRESHOLD`:

- `threshold = 1` → single-node mode, behaves like today
- `threshold = 2` → requires 2-of-N agreement
- `threshold = N` → unanimous

---

## 11. What This Doesn't Solve

- **Total ordering** — partially ordered by hash chains. Conflicting
  simultaneous submissions resolve by write-once (first to confirm wins).

- **Liveness** — fewer than threshold nodes online = no new confirmations.
  Inherent to quorum systems.

- **State sync after partition** — eventually consistent via peer replication.
  Write-once semantics prevent conflicts.

- **Sybil resistance** — validator set must be controlled (static, registry, or
  stake).

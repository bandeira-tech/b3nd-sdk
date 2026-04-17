# Consensus in B3nd: Work, Lifecycle, and Blocks

> Design proposal for multi-stage consensus through roster-based work
> coordination. This is an outline with open design questions — not a
> specification.

---

## What This Book Covers

This book documents how B3nd's validation pipeline — validators that check
`[uri, values, data]` outputs — can be extended into a multi-stage consensus mechanism.
The validation stages (Pending → Attestation → Confirmation → Consensus Slot)
are structurally similar to BFT multi-phase commit. The difference is in where
the boundary sits between protocol and client.

### Protocol vs. client concerns

A core design heuristic in B3nd — consistent with every real-world blockchain —
is the separation between what the protocol enforces and what clients decide:

**Protocol-level (validator enforcement):**

- Write-once semantics (immutable URIs reject duplicate writes)
- Signature verification (auth must match URI identity)
- Threshold checks (confirmation requires N valid attestations from distinct
  validators)
- Conservation rules (inputs >= outputs)
- Stage ordering (each stage references prior stage outputs as inputs)

**Client-level (infrastructure/social decisions):**

- Storage backend and replication strategy
- Discovery timing (how often to poll, which pending items to process)
- Confirmer selection strategy (which attestations to bundle)
- Data availability and serving policy
- Censorship decisions (filtering by signer, IP, content)
- Liveness (whether to process work at all)

No blockchain guarantees liveness at the protocol level. Bitcoin nodes can
filter inscription transactions. Ethereum validators can run MEV-boost or refuse
transactions. Law enforcement can compel censorship. The protocol guarantees
that _if_ something passes validation, it followed the rules. Whether valid work
gets processed is a social/infrastructure/economic outcome.

### Safety property

The protocol _does_ guarantee: **once a record is written to an immutable URI
and passes validation, no subsequent valid message can revert it.** This follows
from write-once semantics enforced at the validator layer. This is the core
safety property — confirmed records are irreversible at the protocol level.

### What this proposes

1. **Roster-based discovery** — Workers publish availability at known URIs,
   others find work by reading the roster
2. **Staged validation** — Pending → Attestation → Confirmation → Consensus
   slots, each stage validated independently
3. **Market-driven selection** — Attestation is open (many participate),
   confirmation is selective (confirmer chooses N)
4. **Block-based timing** — Temporal coordinates (era/block/slot) without
   wall-clock assumptions
5. **Ephemeral shift identities** — Session IDs prove work provenance, used for
   reward claims

## Chapter Outline

### Part 1: Foundations

**Chapter 1: Consensus as Staged Validation** How BFT-style multi-phase commit
maps onto B3nd's validator pipeline. What the protocol enforces vs. what clients
decide. Structural comparison to Tendermint (propose/prevote/precommit/commit
vs. pending/attestation/confirmation/slot) and where the approaches diverge
(client sovereignty over infrastructure).

**Chapter 2: Core Principles in Consensus** Discrete resources, primitive
values, message structure as data surface. Why these matter for consensus
validation.

---

### Part 2: Roles & Markets

**Chapter 3: The Four Roles**

- Gateway — Frontends bringing users in
- Validator — Light nodes attesting to validity
- Confirmer — Bandwidth nodes bundling attestations
- Producer — Heavy nodes creating blocks

Capabilities, incentives, hardware requirements for each.

**Chapter 4: Roster - The Living Work Index** What is a roster? Discovery
pattern (read roster → read worker accounts). Renewal mechanism. How it differs
from schedules.

---

### Part 3: Work Lifecycle

**Chapter 5: Stage 1 - Pending (Gateway)** Gateway receives user content,
validates locally, writes to own account. Message flow, validator
implementation.

**Chapter 6: Stage 2 - Attestation (Validator)** Discover pending via roster,
validate, write attestation. Unbounded participation. Validator implementation.

**Chapter 7: Stage 3 - Confirmation (Confirmer)** Discover attestations, select
N, bundle into confirmation. Selection strategy is a client concern — the
protocol only enforces threshold and distinctness. Validator implementation.

**Chapter 8: Stage 4 - Consensus Slot (Producer)** Discover confirmations,
assign to era/block/slot coordinates. Block structure. Validator traces inputs
through stages.

---

### Part 4: Block Structure & Timing

**Chapter 9: Block-Based Time** Why not wall-clock? Block numbers as temporal
reference. TTL in blocks. Shift ID mechanics (see Open Questions).

**Chapter 10: Era/Block/Slot Coordinates** Temporal structure. Queryability.
Archival strategies.

**Chapter 11: Validation at Slot Assignment** Producer creates slots.
`consensusSlotValidator` extracts block number from the URI being written
(`consensus/{era}/{block}/{slot}/{hash}`), then validates shift ID staleness and
input legitimacy relative to that declared block. No global "current block"
state needed — the block is declared in the data (URI path) and validated for
consistency.

---

### Part 5: Economics & Incentives

**Chapter 12: Market Dynamics** Attestation (open), Confirmation (selective),
Production (bundling). How each market layer creates different incentives.

**Chapter 13: Reward Distribution** Rewards allocated to shift IDs. Claiming
mechanism. Anti-gaming design.

---

### Part 6: Implementation

**Chapter 14: URI Patterns Reference** Complete URI catalog with examples.

**Chapter 15: Validator Implementations** Full validator code using B3nd's
`ValidationFn` interface (`{ uri, value, read, message } → { valid, error? }`).

**Chapter 16: Message Flows** End-to-end example with concrete data. Discovery
patterns. Reading patterns.

**Chapter 17: Running a Consensus Network** Node setup. Roster management.
Monitoring. Reward claiming.

---

### Appendices

**Appendix A: Design Rationale** Why this architecture? Trade-offs. Alternatives
considered. What this doesn't solve.

**Appendix B: Protocol Constants**

```
SHIFT_TTL_BLOCKS = 100
CONFIRMATION_THRESHOLD = 3
SLOTS_PER_BLOCK = 1000
BLOCKS_PER_ERA = 10000
```

**Appendix C: Comparison to Other Consensus** vs. Tendermint/BFT, Nakamoto
consensus, Avalanche. Structural similarities, where the boundary between
protocol and client differs, and what each system actually guarantees at the
protocol level.

---

## Open Design Questions

These are protocol-level decisions that must be resolved before chapters can be
written. Each determines what validators check and accept.

### 1. Shift ID Mechanism

**Problem:** Shift IDs must be mechanically irreproducible (can't fake), prove
provenance, reference recent block, but allow slack for nodes with poor
infrastructure.

**Current thinking:**

```
shiftID = sign(workerKey, recentBlockHash + nonce)
where:
  - recentBlockHash must be within last N blocks
  - nonce requires brute force search (proof-of-work-lite)
  - allows wiggle room for slower nodes (warzones, poor infra)
  - proves worker saw recent state (not making offline decisions on stale data)
```

**Questions:**

- How much work for the nonce? (balance accessibility vs. spam prevention)
- How many blocks back is "recent enough"? (balance freshness vs. network slack)
- Should shift ID encode role? (e.g., `v_` prefix for validator, `c_` for
  confirmer)
- How to extract/verify these components in validators?

**Format options:**

```
Option A: shiftID = "v_" + base64(sign(workerKey, blockHash + nonce))
Option B: shiftID = sign(workerKey, blockHash + nonce)  // signature IS the ID
Option C: shiftID = hash(sign(workerKey, blockHash + nonce))  // shorter
```

### 2. Block Timing

**Problem:** Balance fast throughput (many apps), retail hardware support, spam
defense, democratic access.

**Resolved insight:** Block timing is declarative, not coordinated. The producer
declares "this work goes in block 42" by writing to
`consensus/{era}/{block}/{slot}/{hash}`. The validator checks if that
declaration is legitimate given the inputs (shift staleness, confirmation
validity). No synchronization needed.

**Remaining questions:**

- What prevents a producer from declaring arbitrary future blocks? (Should
  validators check block progression?)
- Should there be a "block must reference previous block hash" chain constraint?
- How to handle competing producers writing to the same block number? (First
  valid write wins via write-once?)
- Should producers be on a roster with rotation/scheduling, or is it open
  competition?

**Current thinking:**

- Producers compete to fill blocks (open market, not scheduled rotation)
- Write-once semantics mean first valid slot assignment wins
- Validators check shift staleness and input validity, not absolute timing
- Block progression constraint (block N must reference block N-1 hash) could
  prevent spam future blocks

### 3. Block Number from URI (Resolved)

**Solution:** Block number is only validated at slot assignment, where it's
declared in the URI itself: `consensus/{era}/{block}/{slot}/{hash}`. The
`consensusSlotValidator` extracts the block number from the URI path and
validates shift ID staleness relative to that declared block.

**Example:**

```typescript
const consensusSlotValidator: ValidationFn = async (
  { uri, value, read, message },
) => {
  // Block number is RIGHT HERE in the URI
  const block = parseInt(extractSegment(uri, 2)); // consensus/{era}/{block}/{slot}/{hash}

  // Extract shift ID from attestation inputs
  const shiftID = extractShiftIDFromInputs(message.inputs);
  const shiftBlock = extractBlockFromShiftID(shiftID);

  // Validate staleness relative to the declared target block
  if (block - shiftBlock > SHIFT_TTL_BLOCKS) {
    return { valid: false, error: "Shift too stale for target block" };
  }

  return { valid: true };
};
```

**Why this works:**

- No global state needed — the producer declares "this goes in block 42" via the
  URI
- Validator checks: "Is block 42 a legitimate claim given the inputs?"
- Other validators (pending, attestation, confirmation) don't need block timing
- Block timing only matters at the moment of consensus finality (slot
  assignment)
- This is **information vs. data**: the URI path (data) contains the block
  number (information)

### 4. Network Reality Accommodation

**Design principle:** No assumption of sync, low bandwidth OK, poor
infrastructure supported.

**How staleness is validated:**

- Shift ID references a block: `shiftID = sign(workerKey, blockHash_40 + nonce)`
- Work sits in worker's account with that shift ID
- Producer assigns to a slot: `consensus/0/50/7/hash` (block 50)
- Validator checks: `50 - 40 = 10 blocks age` — is this within
  `SHIFT_TTL_BLOCKS`?

**This accommodates network reality:**

- Node with 10-minute latency creates shift ID referencing block 40
- Work might not get picked up until block 50 (10 blocks later)
- Validator checks age relative to the target block, not "now" (which doesn't
  exist)
- If within slack window (e.g., 100 blocks), valid. If too stale, invalid.

**Remaining questions:**

- What's the right `SHIFT_TTL_BLOCKS` value? (balance freshness vs.
  accessibility)
- Should TTL vary by role? (gateway = tight, validator = loose)
- Should proof-of-work difficulty in shift ID scale with staleness?

**Note:** Whether a node chooses to process work from slow peers is a client
concern. The protocol enforces maximum staleness, but clients may apply stricter
policies.

---

## Style & Format

**Code examples:** Must use B3nd's actual `ValidationFn` interface:
`({ uri, value, read, message }) => { valid, error? }`. Not test assertions, not
pseudocode that can't map to real validators.

**Example:**

```typescript
// pendingValidator
const pendingValidator: ValidationFn = async (
  { uri, value, read, message },
) => {
  // Write-once
  if ((await read(uri)).success) {
    return { valid: false, error: "Already pending" };
  }

  // Extract from URI: pending/{contentHash}/{submitterKey}
  const contentHash = extractSegment(uri, 1);
  const submitterKey = extractSegment(uri, 2);

  // Value must be signature over content hash
  if (typeof value !== "string") {
    return { valid: false, error: "Value must be signature string" };
  }

  if (!await verify(submitterKey, value, contentHash)) {
    return { valid: false, error: "Invalid signature" };
  }

  // Message must be signed by submitter
  if (!message?.auth?.[0] || message.auth[0].pubkey !== submitterKey) {
    return { valid: false, error: "Auth mismatch" };
  }

  return { valid: true };
};
```

**Chapter structure:** Progressive disclosure. Start with what the protocol
enforces, show URI patterns, then validators, then what's left to clients.

---

## What This Book Does and Doesn't Cover

**Protocol-level (this book):**

- Validation rules for each consensus stage
- URI patterns and their structural meaning
- Safety guarantees (write-once irreversibility)
- Fault tolerance parameters (N-of-M threshold)
- Stage ordering constraints

**Client/infrastructure-level (out of scope):**

- Liveness and availability guarantees — no protocol can enforce these
- Specific replication strategies — storage is a client concern
- Confirmer selection algorithms — the protocol enforces threshold, not strategy
- Censorship resistance — a social/infrastructure property
- Data availability proofs — not part of this protocol

---

## FAQ: Reviewed Questions

These questions emerged from adversarial review of this design. Each was
examined, and either resolved or identified as a client-concern mismatch. They
are documented here so the reasoning doesn't need to be repeated.

### Isn't this just BFT with extra steps?

Yes, structurally. The validation pipeline (pending → attestation → confirmation
→ slot) is isomorphic to BFT multi-phase commit (propose → prevote → precommit →
commit). The difference is not in the pipeline shape but in **where the protocol
boundary sits**. Tendermint mandates gossip behavior, timeout rules, and locking
mechanics at the protocol level. B3nd enforces only validation rules —
write-once, signature verification, threshold, conservation, stage ordering.
Everything else (discovery, propagation, storage, selection strategy, timing) is
a client decision. The protocol validates outputs; clients decide how to produce
them.

### What about equivocation across distributed nodes?

Write-once is enforced per-node at validation time. During a network partition,
two nodes could independently accept conflicting writes to the same URI before
replication converges. This is not a protocol bug — it's the same situation as
two Bitcoin miners finding blocks at the same height. Bitcoin resolves it via
longest-chain rule; B3nd resolves it via write-once-first-wins-per-node +
eventual convergence through replication.

Guaranteeing cross-node write consistency during partitions would require
synchronous consensus, which is the opposite of this design's goals. Storage and
replication are client concerns.

### Where are the liveness guarantees?

There are none at the protocol level, and there shouldn't be. No blockchain
guarantees liveness at the protocol layer. Bitcoin doesn't guarantee your
transaction gets mined. Ethereum doesn't guarantee block inclusion. Nodes can
refuse any work for any reason — law enforcement, operator policy, inscription
filtering, or simply not having received it. The protocol guarantees: _if_
something passes validation, it followed the rules. Whether valid work
eventually gets processed is a social, infrastructure, and economic outcome.
Demanding liveness proofs from a consensus protocol is demanding something no
system delivers at this layer.

### Why doesn't the protocol specify confirmer selection strategy?

Because it's a client concern. The protocol enforces "confirmation requires N
valid attestations from distinct authorized validators." _Which_ attestations
the confirmer picks is their business — exactly like a Bitcoin miner choosing
which transactions to include in a block. Different strategies (fastest, highest
reputation, random, auction) create different emergent behavior, but the
protocol doesn't need to mandate one. This is intentional: it allows market
competition between confirmers without protocol-level rigidity.

### How does block timing work without clock synchronization?

Block timing is declarative. The producer declares "this work goes in block 42"
by writing to `consensus/{era}/{block}/{slot}/{hash}`. The
`consensusSlotValidator` extracts the block number from the URI path and checks
whether the declaration is legitimate given the inputs (shift ID staleness,
confirmation validity). No node needs to agree on "what time it is" or "what
block we're on." The block number is data in the URI, validated for consistency
— not a synchronized global counter.

### How do validators access "current block" without global state?

They don't need to. Block awareness is only relevant at slot assignment, where
the block number is declared in the URI itself. The `consensusSlotValidator`
extracts it from the URI path (`consensus/{era}/{block}/{slot}/{hash}`) and
validates shift staleness relative to that declared block. Earlier-stage
validators (pending, attestation, confirmation) don't need block numbers at all.
This fits cleanly within B3nd's `ValidationFn` interface
(`{ uri, value, read, message }`) with no context extensions.

### How does this relate to CONFIRMATION.md?

CONFIRMATION.md specifies the confirmation process: how pending records get
attested, reach threshold, and finalize. It's a concrete design for one layer of
the pipeline.

This document extends that into the _work lifecycle_ layer: how work gets
discovered (roster), how workers prove provenance (shift IDs), how confirmed
work gets temporal coordinates (era/block/slot), and how rewards distribute to
participants. It's the layer above confirmation — the part that enables stake
constraints, reward economics, and sybil resistance. They are complementary
documents at different layers.

### What does the protocol actually guarantee?

**Safety:** Once a record is written to an immutable URI and passes validation,
no subsequent valid message can revert it. Write-once + validation rules =
irreversibility.

**Fault tolerance:** Valid confirmations require `CONFIRMATION_THRESHOLD`
attestations from distinct authorized validators. Below threshold, work
accumulates in pending/attestation state but nothing invalid gets confirmed.
Malicious validators cannot produce false confirmations because each attestation
is individually verified.

**What it does not guarantee:** Liveness, availability, data existence,
censorship resistance, or cross-node consistency during partitions. These are
infrastructure and social properties — real and important, but not protocol
invariants.

---

## Related Documentation

- `docs/book/README.md` — "What's in a Message" (foundational B3nd concepts)
- `skills/b3nd/FRAMEWORK.md` — DePIN protocol SDK patterns

---

## Status

**Current:** Outline complete, design questions documented **Next:** Resolve
shift ID mechanism and block timing (protocol-level decisions) **Then:** Write
chapters 1-4 (foundations + roles) **Finally:** Implementation chapters (14-17)
with full validator code

---

## Contributing

This book is a living document. As implementation progresses, lessons
learned should flow back into these chapters. Open questions should be resolved
through prototyping, not speculation.

**Process:**

1. Prototype shift ID mechanism
2. Document findings in this README
3. Update chapter outlines with learnings
4. Write chapter once design is stable
5. Test code examples in actual validator implementations
6. Iterate based on real-world deployment

---

_The chapters will be written once the open questions are resolved and the
design is validated through implementation._

# Consensus in B3nd: Work, Lifecycle, and Blocks

> A technical guide to multi-stage consensus through roster-based work coordination

---

## What This Book Covers

This book documents how B3nd principles—discrete resources, primitive values, message structure as data—combine to create a consensus mechanism without central coordination. Unlike traditional consensus protocols that require leader election, Byzantine fault tolerance machinery, or synchronized voting rounds, B3nd consensus emerges from:

1. **Roster-based discovery** — Workers publish availability, others find work by reading the roster
2. **Staged validation** — Pending → Attestation → Confirmation → Consensus slots
3. **Market-driven selection** — Attestation is commodity (many participate), confirmation is selective (choose N)
4. **Block-based timing** — No wall-clock assumptions, everything references block numbers
5. **Ephemeral shift identities** — Session IDs prove work provenance, used for reward claims

The goal is to show that **formalization is possible in accessible code**, that **protocol rules handle edge cases** (no parametric configuration), and that **real-world network conditions** (latency, poor infrastructure, warzones) are accommodated through data-layer slack, not synchronization assumptions.

## Chapter Outline

### Part 1: Foundations

**Chapter 1: Consensus Without Coordination**
Traditional consensus vs. B3nd approach. How coordination happens through data structure, not protocol handshakes.

**Chapter 2: Core Principles in Consensus**
Discrete resources, primitive values, message structure as data surface. Why these matter for consensus validation.

---

### Part 2: Roles & Markets

**Chapter 3: The Four Roles**
- Gateway — Frontends bringing users in
- Validator — Light nodes attesting to validity
- Confirmer — Bandwidth nodes bundling attestations
- Producer — Heavy nodes creating blocks

Capabilities, incentives, hardware requirements for each.

**Chapter 4: Roster - The Living Work Index**
What is a roster? Discovery pattern (read roster → read worker accounts). Renewal mechanism. How it differs from schedules.

---

### Part 3: Work Lifecycle

**Chapter 5: Stage 1 - Pending (Gateway)**
Gateway receives user content, validates locally, writes to own account. Message flow, validator implementation.

**Chapter 6: Stage 2 - Attestation (Validator)**
Discover pending via roster, validate, write attestation. Unbounded participation. Validator implementation.

**Chapter 7: Stage 3 - Confirmation (Confirmer)**
Discover attestations, select N (thin market), bundle into confirmation. Selection strategies. Validator implementation.

**Chapter 8: Stage 4 - Consensus Slot (Producer)**
Discover confirmations, assign to era/block/slot coordinates. Block structure. Validator traces inputs through stages.

---

### Part 4: Block Structure & Timing

**Chapter 9: Block-Based Time**
Why not wall-clock? Block numbers as temporal reference. TTL in blocks. Shift ID mechanics (see Open Questions).

**Chapter 10: Era/Block/Slot Coordinates**
Temporal structure. Queryability. Archival strategies.

**Chapter 11: Validation at Slot Assignment**
Producer creates slots. `consensusSlotValidator` checks entire message graph. Enforces timing rules.

---

### Part 5: Economics & Incentives

**Chapter 12: Market Dynamics**
Attestation (commodity), Confirmation (selective), Production (bundling). How each market layer creates different incentives.

**Chapter 13: Reward Distribution**
Rewards allocated to shift IDs. Claiming mechanism. Anti-gaming design.

---

### Part 6: Implementation

**Chapter 14: URI Patterns Reference**
Complete URI catalog with examples.

**Chapter 15: Validator Implementations**
Full validator code (pseudocode, JS-rigorous). Test case style showing formalized expectations.

**Chapter 16: Message Flows**
End-to-end example with concrete data. Discovery patterns. Reading patterns.

**Chapter 17: Running a Consensus Network**
Node setup. Roster management. Monitoring. Reward claiming.

---

### Appendices

**Appendix A: Design Rationale**
Why this architecture? Trade-offs. Alternatives considered. What this doesn't solve.

**Appendix B: Protocol Constants**
```
SHIFT_TTL_BLOCKS = 100
CONFIRMATION_THRESHOLD = 3
SLOTS_PER_BLOCK = 1000
BLOCKS_PER_ERA = 10000
```

**Appendix C: Comparison to Other Consensus**
vs. Tendermint/BFT, Nakamoto consensus, Avalanche.

---

## Open Design Questions

### 1. Shift ID Mechanism

**Problem:** Shift IDs must be mechanically irreproducible (can't fake), prove provenance, reference recent block, but allow slack for nodes with poor infrastructure.

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
- Should shift ID encode role? (e.g., `v_` prefix for validator, `c_` for confirmer)
- How to extract/verify these components in validators?

**Format options:**
```
Option A: shiftID = "v_" + base64(sign(workerKey, blockHash + nonce))
Option B: shiftID = sign(workerKey, blockHash + nonce)  // signature IS the ID
Option C: shiftID = hash(sign(workerKey, blockHash + nonce))  // shorter
```

### 2. Block Timing

**Problem:** Balance fast throughput (many apps), retail hardware support, spam defense, democratic access.

**Questions:**
- Fixed block time vs. variable (first confirmation triggers)?
- How to reference "current block" without sync assumption?
- What's the block production trigger? (timer? confirmation threshold? producer decision?)
- How do validators agree on block boundaries without coordination?
- Should there be a "block production market" similar to confirmation selection?

**Candidate approaches:**
```
Option A: Deterministic (every N seconds, producer rotates)
  - Pro: Predictable, simple
  - Con: Requires time sync, producer coordination

Option B: Threshold-triggered (N confirmations → new block)
  - Pro: Demand-driven, no time sync
  - Con: Variable latency, potential spam

Option C: Producer commitment (producer declares "I'm making block X at time T")
  - Pro: Market-driven, flexible
  - Con: How to prevent spam producers?
```

### 3. Network Reality Accommodation

**Design principle:** No assumption of sync, low bandwidth OK, poor infrastructure supported.

**Challenges:**
- Node in warzone has 10-minute latency — how to participate without stale roster?
- Shift ID must reference "recent" block, but what's recent for a node 100 blocks behind?
- How to validate work from a node whose shift ID references an old block?

**Potential solutions:**
- Validator checks: "shift references block X, we're now at block Y, is Y - X < SLACK_THRESHOLD?"
- Larger slack window for certain roles (gateway = tight, validator = loose)?
- Proof-of-work in shift ID scales with staleness (old block = more work required)?

---

## Style & Format

**Code examples:** Pseudocode with JS rigor. Not full TypeScript, but formalized and executable-looking. Focus on test case style (formalized expectations).

**Example:**
```javascript
// pendingValidator (pseudocode)
async function pendingValidator({ uri, value, message, read }) {
  // Extract from URI: accounts/{worker}/consensus/{shiftID}/pending/{hash}
  const worker = uri.segments[1];
  const shiftID = uri.segments[3];
  const contentHash = uri.segments[5];

  // Value must be signature over content hash
  expect(typeof value).toBe("string");
  expect(await verify(worker, value, contentHash)).toBe(true);

  // Shift must be on roster
  const roster = await read(`mutable://roster/gateway/${shiftID}`);
  expect(roster.success).toBe(true);
  expect(roster.data).toBe(worker);  // roster value is worker key

  // Shift must not be expired (block-based TTL)
  const shiftBlock = extractBlockFromShiftID(shiftID);
  const currentBlock = getCurrentBlock();  // TODO: how to get this?
  expect(currentBlock - shiftBlock).toBeLessThan(SHIFT_TTL_BLOCKS);

  return { valid: true };
}
```

**Chapter structure:** Progressive disclosure. Start with "why", show URI patterns, then validators, then edge cases.

**Tone:** Rigorous but accessible. Show formalization is possible without gatekeeping. Code should read like prose with examples.

---

## Why This Book Matters

Traditional consensus documentation shows **algorithms** (PBFT, Raft, Tendermint). This book shows **architecture**—how to build consensus from message primitives without algorithm machinery.

It demonstrates that:
1. **Coordination emerges from data** (roster, not leader election)
2. **Validation is local** (check inputs, no global state queries)
3. **Markets create incentives** (no hardcoded rewards)
4. **Protocol rules scale** (no parametric configuration hell)
5. **Real networks are messy** (latency, poor infra, warzones are accommodated)

The goal is to make this **foundational knowledge for building B3nd protocols**, not just Firecat-specific. Once these patterns are clear, any multi-node consensus problem can be solved with messages + validators + markets.

---

## Related Documentation

- `libs/firecat-protocol/TEMPORAL_CONSENSUS.md` — Initial proposal (superseded by this book)
- `libs/firecat-protocol/CONFIRMATION.md` — Original confirmation design
- `docs/book/README.md` — "What's in a Message" (foundational B3nd concepts)
- `skills/b3nd/FRAMEWORK.md` — DePIN protocol SDK patterns

---

## Status

**Current:** Outline complete, design questions documented
**Next:** Resolve shift ID mechanism and block timing
**Then:** Write chapters 1-4 (foundations + roles)
**Finally:** Implementation chapters (14-17) with full validator code

---

## Contributing

This book is a living document. As Firecat implementation progresses, lessons learned should flow back into these chapters. Open questions should be resolved through prototyping, not speculation.

**Process:**
1. Prototype shift ID mechanism in `libs/firecat-protocol/`
2. Document findings in this README
3. Update chapter outlines with learnings
4. Write chapter once design is stable
5. Test code examples in actual validator implementations
6. Iterate based on real-world deployment

---

*The chapters will be written once the open questions are resolved and the design is validated through implementation.*

# Consensus Design: Remaining Open Work

> Unresolved protocol-level decisions that must be defined before chapters can
> be written. Reviewed questions that have been addressed are documented in the
> README FAQ section.

---

## 1. Shift ID Mechanism

Protocol-level. Validators must check this — it's the sybil resistance layer.

**Current proposal:** `sign(workerKey, blockHash + nonce)`

**What needs to be defined:**

- Concrete nonce difficulty — what proof-of-work target? Must balance
  accessibility (retail hardware, warzones) vs. spam prevention
- Staleness window — what value for `SHIFT_TTL_BLOCKS`? Determines how much
  network lag is tolerable
- Extraction logic — how does a validator decompose a shift ID into
  `(workerKey, blockRef, nonce)` and verify each component within a
  `ValidationFn`?
- Role encoding — does the shift ID encode whether the worker is a
  validator/confirmer/producer, or is that determined by which URI they write
  to?

**Why this blocks chapters:** Without a concrete shift ID, the
pending/attestation/confirmation validators can't be fully specified — they need
to verify shift provenance.

## 2. Block Progression Constraints

The declarative insight (producer declares block number in URI, validator checks
consistency) resolves _how_ blocks get numbers. What's unresolved is _what
constrains_ the sequence.

**Questions:**

- Must block N reference block N-1's hash? A chain constraint would prevent
  producers from declaring arbitrary future blocks, but adds a read dependency
  to the slot validator
- Can block numbers be sparse? If producer writes block 42 then block 50, are
  blocks 43-49 empty or invalid?
- Competing producers — if two producers race to fill block 42, write-once on
  slot URIs means first valid write wins. Is that sufficient, or do producers
  need authorization (roster, stake)?
- Block capacity — `SLOTS_PER_BLOCK = 1000` is a constant. What happens when a
  block is full? Next producer starts block 43?

## 3. Reward Distribution

Protocol-level. Without this, the market dynamics are untestable — you can't
evaluate whether rational actors would participate.

**Questions:**

- How do selected attestors claim rewards? Is there a
  `immutable://reward/{shiftID}/{blockNumber}` output in the slot assignment
  message?
- Are rewards UTXO outputs in the same conservation model as protocol balances?
  If so, the slot assignment message would have balance outputs for each
  credited worker
- How does the confirmer get paid for bundling? Fee from the attestation
  selection?
- How does the producer get paid? Block reward + fee share?
- Shift ID → reward mapping: rewards go to the shift, then the worker claims
  from the shift. What does that claim validator look like?

**Why this blocks chapters:** Chapters 12-13 (Market Dynamics, Reward
Distribution) can't be written. But more importantly, the incentive structure
determines whether the four-role market is viable at all.

## 4. Stake and Authorization

The work lifecycle layer opens the door to stake constraints. Currently
`VALIDATOR_SET` is a static array. The roster proposal replaces this but doesn't
specify what it takes to get on the roster.

**Questions:**

- Minimum stake to be a validator/confirmer/producer? Different amounts per
  role?
- Where is stake held? `immutable://stake/{workerKey}/{utxoId}` with a lock
  period?
- Slashing — can stake be burned for misbehavior? What constitutes misbehavior
  at the protocol level? (Conflicting attestations? Stale work? Invalid
  confirmations are already rejected by validators, so what's left to slash?)
- Dynamic sets — if stake-weighted, how does the attestation validator check "is
  this worker staked?" at validation time? Read from a stake URI?
- Interaction with shift IDs — must a shift reference a staked account?

**Why this blocks chapters:** Chapter 3 (The Four Roles) describes capabilities
and requirements per role. Without stake/authorization rules, the role
descriptions are informal.

## 5. Fault Tolerance Statement

Should be straightforward once the above are resolved, but worth calling out as
a deliverable:

- "Valid confirmations require `CONFIRMATION_THRESHOLD` attestations from
  distinct authorized validators"
- "Below threshold, work accumulates but nothing invalid gets confirmed"
- "Safety holds regardless of how many malicious validators participate" (from
  validation rules, not honest majority)
- What's the maximum fraction of malicious validators that preserves safety?
  (With write-once + individual attestation verification, safety holds even with
  a malicious majority — they can only _block_ work, not forge confirmations. Is
  this correct? Needs verification.)

## 6. Validation Replay Non-Determinism

The attestation flow assumes validators replay the original envelope's
validation and reach the same verdict. But state may have changed between the
submitting node's validation and a peer's replay.

**Example:** Alice submits an envelope spending
`immutable://balance/alice/utxo1`. Node A validates — utxo1 exists, conservation
passes, attestation written. Between that moment and Node B's replay, a
_different_ envelope consuming the same utxo1 gets confirmed. Node B replays,
sees utxo1 is consumed, rejects. Honest nodes disagree.

**Questions:**

- Is this a feature (replay correctly reflects current state) or a bug (nodes
  disagree on identical envelopes)?
- Should pending records snapshot the relevant state, or is it sufficient that
  the threshold is "N of M honest nodes agree" and some disagreement is
  expected?
- Does the pending → attestation window need to be short enough that state churn
  is unlikely?

**Why this matters:** If replay non-determinism is frequent, the threshold may
never be reached for legitimate envelopes in high-throughput scenarios.

## 7. Dead Entry Accumulation

All consensus artifacts are `immutable://` — write-once, never deleted. Failed
flows (pending that never reaches threshold, attestations for rejected content,
expired shifts) persist forever.

**Questions:**

- What is the long-term storage cost of dead entries?
- Should there be an archival/pruning convention? (e.g., nodes may drop
  `immutable://pending/` entries older than N eras, but never drop
  `immutable://consensus/` entries)
- Do dead entries affect `list()` performance? Validators calling
  `list("immutable://pending/")` will increasingly return stale entries that
  must be filtered.
- Should the roster discovery pattern mitigate this? (Only process pending
  entries from workers on the current roster, ignore the rest)

**Why this matters:** Without cleanup conventions, the namespace grows
monotonically. Discovery by `list()` degrades linearly.

## 8. `list()` Not Available in Validators

The `confirmationValidator` needs `list()` to count attestations, but
`ValidationFn` in `libs/b3nd-core/types.ts` only provides `read()`. This is a
framework-level API gap.

**Options:**

- Add `list()` to `ValidationFn` signature — cascading change through
  `msgSchema`, `createValidatedClient`, and every client
- Avoid `list()` in validators — require the confirmer's message inputs to
  declare which attestations it references (the TEMPORAL_CONSENSUS.md approach),
  so the validator only needs `read()` to check each declared input exists
- The inputs-based approach is better: it's already how confirmation works in
  TEMPORAL_CONSENSUS.md, makes the validator self-contained, and doesn't require
  framework changes

**Recommendation:** Use message inputs to declare attestation references.
Validator checks each input with `read()`. No `list()` needed. This also makes
the confirmation message a self-contained proof — you can verify it without
querying the namespace.

## 9. URI Design Inconsistency Across Documents

Three documents propose different URI shapes for the same concepts:

| Concept      | CONFIRMATION.md                                        | TEMPORAL_CONSENSUS.md                                       | README pseudocode                                    |
| ------------ | ------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| Pending      | `immutable://pending/{content}/{node}` → envelope ref  | `immutable://pending/{content}/{node}` → signature          | `accounts/{worker}/consensus/{shift}/pending/{hash}` |
| Attestation  | `immutable://attestation/{envelope}/{node}` → true     | `immutable://attestation/{content}/{validator}` → signature | (same pattern)                                       |
| Confirmation | `immutable://confirmation/{content}/{envelope}` → true | `immutable://confirmation/{content}` → signature            | (same pattern)                                       |

**Discrepancies:**

- Attestation keyed by `envelopeHash` (CONFIRMATION.md) vs `contentHash`
  (TEMPORAL_CONSENSUS.md) — different things. Envelope hash is safer (specific
  submission attempt), content hash allows multiple attestation paths
- Confirmation includes envelope hash (CONFIRMATION.md) vs omits it
  (TEMPORAL_CONSENSUS.md) — affects re-submission after partial failure
- Value type: `true` (CONFIRMATION.md) vs signature (TEMPORAL_CONSENSUS.md) —
  affects whether the value is a verifiable receipt or just a marker
- The README pseudocode nests under `accounts/{worker}/consensus/{shift}/` —
  entirely different namespace strategy

**Must resolve:** One canonical URI design for the protocol. The shift-based
`accounts/` nesting from the README is the most recent and most complete
(encodes worker + shift + stage), but it's only in pseudocode.

## 10. Genesis Bootstrapping

The circular dependency: shift IDs reference recent block hashes, but blocks
require shifts to produce. How does the network start?

**Questions:**

- Is there a genesis block with a known hash that all nodes share?
- Can the first shift IDs reference a hardcoded genesis hash?
- Who produces the first block? Is it the operator who deployed the network?
- How do validators register before any blocks exist?

**This is not an edge case** — every new network deployment hits it. Needs a
concrete bootstrap sequence.

## 11. Confirmer Selection Strategy

The confirmer "selects N attestations" but the selection mechanism is
unspecified. This isn't a detail — it's the core incentive signal for
validators.

**Impact of selection strategy:**

- Fastest N → validators optimize for speed, disadvantages nodes with poor
  infrastructure (contradicts warzone accommodation goal)
- Random N → no validator optimization, fair but no quality signal
- Reputation-weighted → requires reputation system (circular dependency with
  rewards)
- Auction → validators bid for inclusion, but who receives the bid? adds
  economic complexity

**Why this matters for protocol level:** If selection is purely client-level
(confirmer chooses freely), then validators have no predictable incentive to
participate beyond "maybe I get picked." The thin market claim requires that
getting selected is _worth_ the attestation cost. Without a defined selection
mechanism, the economic model can't be validated.

---

## Resolution order

Suggested sequence based on dependencies:

1. **Shift ID** — gates all validator implementations
2. **URI design convergence** — gates consistent validator specs across
   documents
3. **Block progression + genesis bootstrap** — gates slot validator and Chapter
   11
4. **Stake/authorization** — gates Chapter 3 (roles) and roster design
5. **Confirmer selection** — gates market viability analysis
6. **Reward distribution** — gates Chapters 12-13
7. **Fault tolerance statement** — falls out of the above once concrete

Framework-level items (dead entry cleanup, `list()` in validators, replay
non-determinism) can be resolved in parallel with protocol design.

# E7: TLA+ Formal Specification and Analysis of Temporal Consensus

**Experiment**: Round 3, E7
**Question**: Does the committee-based temporal consensus protocol satisfy safety and liveness formally? Are there edge cases the informal analysis missed?
**Date**: 2026-03-16
**Status**: Complete
**Depends on**: E2 (committee simulation results: K=7, T=4, majority threshold recommended for f=0.20)

---

## 1. Specification Overview

### What is Modeled

The TLA+ specification (`TemporalConsensus.tla`) captures the core temporal consensus protocol as a phased state machine over sequential slots:

1. **Propose** -- A proposer nondeterministically selects a message `m` from a finite set `Messages` and assigns it to the current slot.
2. **Attest** -- All validators produce attestations. Honest validators attest to exactly the proposed message. Byzantine validators may attest to any subset of messages (including conflicting ones), or withhold entirely.
3. **CommitteeVote** -- A committee of K validators is nondeterministically selected from the full validator set. Honest committee members vote for the proposed message. Byzantine committee members vote arbitrarily.
4. **Confirm** -- Messages receiving >= T committee votes are confirmed for the slot. The set of confirmed messages is recorded.
5. **AdvanceSlot** -- The protocol moves to the next slot.

Additionally:
- **Finality**: A slot becomes finalized when F consecutive subsequent slots are all confirmed.
- **Honest view**: Each honest node maintains a local view mapping slots to confirmed messages.

### What is Abstracted Away

| Aspect | How Modeled | What's Lost |
|--------|-------------|-------------|
| Network | Synchronous phases within each slot | Partial synchrony, message delays, reordering |
| Committee selection | Nondeterministic (any K-subset is possible) | Stake-weighted sampling, VRF-based selection |
| Proposer identity | Abstract (any message can be proposed) | Proposer rotation, leader election |
| Stake | Not modeled (each validator has equal weight) | Stake concentration effects (see E2) |
| Time | Slot sequence only | Real-time bounds, timeouts, view changes |
| Network partitions | Not modeled | Partitioned validators cannot communicate |
| Slashing | Not modeled | Economic deterrence for misbehavior |
| Dynamic membership | Fixed validator set | Validator join/leave, stake changes |

The key design decision is modeling committee selection as **fully nondeterministic**: TLC explores every possible committee of size K from N validators, including worst-case committees. This is strictly more adversarial than stake-weighted sampling and gives us an upper bound on vulnerability.

---

## 2. Property Definitions

### Safety Properties (Invariants)

**S1: No Conflicting Confirmations (SafetyNoConflict)**

```tla
SafetyNoConflict ==
    \A s \in 1..MaxSlot :
        Cardinality(confirmations[s]) <= 1
```

For every slot, at most one distinct message is confirmed. This prevents equivocation at the protocol level: an observer cannot see two valid confirmation certificates for the same slot containing different messages.

**S2: Finality Monotonicity (SafetyFinalityMonotonic)**

```tla
SafetyFinalityMonotonic ==
    \A s \in 1..MaxSlot :
        finalized[s] => IsConfirmed(s)
```

A finalized slot is necessarily confirmed. Combined with the fact that `finalized` only transitions from FALSE to TRUE (never back), this ensures finality is irreversible.

**S3: No Honest Equivocation (SafetyNoHonestEquivocation)**

```tla
SafetyNoHonestEquivocation ==
    \A s \in 1..MaxSlot :
        \A v \in Honest :
            Cardinality({m \in Messages : <<v, m>> \in attestations[s]}) <= 1
```

No honest validator attests to two different messages for the same slot. This is enforced by construction in our model (honest validators only attest to the proposed message), but stating it explicitly allows TLC to verify the implementation matches the intent.

**S4: Agreement (SafetyAgreement)**

```tla
SafetyAgreement ==
    \A s \in 1..MaxSlot :
        finalized[s] =>
            \A v1, v2 \in Honest :
                honestView[v1][s] = honestView[v2][s]
```

All honest nodes agree on the contents of every finalized slot. This follows from S1 (at most one message confirmed) and the fact that all honest nodes observe the same confirmation.

### Liveness Properties (Temporal)

**L1: Progress (LivenessProgress)**

```tla
LivenessProgress ==
    \A s \in 1..MaxSlot :
        <>(currentSlot > s)
```

The system eventually advances past every slot. Under weak fairness of all actions, this holds unconditionally because AdvanceSlot is always eventually enabled after Confirm completes.

**L2: Confirmation Under Honest Majority (LivenessConfirmation)**

```tla
LivenessConfirmation ==
    [](\A s \in 1..MaxSlot :
        (phase = "Confirm" /\ currentSlot = s /\
         NumHonestInCommittee(committee[s]) >= T)
        => (confirmations[s] /= {}))
```

If the committee for a slot has >= T honest members, the slot is confirmed. This is because T honest members all vote for the same message, guaranteeing it crosses the threshold.

### Derived Conditions

**Safety Guarantee Condition:**

```tla
SafetyGuaranteed == MaxByzOnCommittee < T
```

Safety holds whenever the maximum number of Byzantine validators that can appear on any committee is strictly less than T. Since committee selection is nondeterministic, this simplifies to: `min(f, K) < T`.

**Liveness Guarantee Condition:**

```tla
LivenessGuaranteed == MinHonestOnCommittee >= T
```

Liveness holds when even the worst-case committee (maximum Byzantine members) retains >= T honest members. This requires: `K - min(f, K) >= T`, equivalently `K - f >= T` when `f <= K`.

---

## 3. Analysis Results

### Method

Since TLC cannot be executed in this environment, we perform rigorous hand-tracing of the specification for each configuration. The analysis proceeds by:

1. Computing T = ceil((K+1)/2) for the given K.
2. Enumerating the worst-case committee compositions (maximum Byzantine members).
3. Tracing the Propose -> Attest -> CommitteeVote -> Confirm sequence under adversarial behavior.
4. Determining whether safety (S1-S4) and liveness (L1-L2) hold.

### Configuration Results

#### Config 1: N=3, K=3, f=0 (No adversary)

| Parameter | Value |
|-----------|-------|
| T (threshold) | 2 |
| Max Byzantine on committee | 0 |
| Min honest on committee | 3 |

**Trace (Slot 1):**
- Propose: proposer picks m1
- Attest: all 3 honest validators attest to m1. attestations = {(v1,m1), (v2,m1), (v3,m1)}
- CommitteeVote: committee = {v1,v2,v3} (only option). All vote for m1.
- Confirm: VotesFor(m1) = 3 >= T=2. confirmations[1] = {m1}.

**Safety: HOLDS.** No Byzantine validators exist. All committee members agree on the proposed message. Only one message can ever receive any votes. Cardinality(confirmations[s]) = 1 for every processed slot.

**Liveness: HOLDS.** All 3 committee members are honest, 3 >= T=2. Every slot is confirmed. Under weak fairness, slots advance.

**Agreement: HOLDS.** All honest nodes see the same single confirmed message.

---

#### Config 2: N=3, K=3, f=1 (One Byzantine)

| Parameter | Value |
|-----------|-------|
| T (threshold) | 2 |
| Max Byzantine on committee | 1 |
| Min honest on committee | 2 |

**Trace (Slot 1, adversarial scenario):**
- Propose: proposer picks m1
- Attest: honest v1, v2 attest to m1. Byzantine v3 attests to m2 (conflicting).
  attestations = {(v1,m1), (v2,m1), (v3,m2)}
- CommitteeVote: committee = {v1,v2,v3}. v1, v2 vote for m1. v3 votes for m2.
- Confirm: VotesFor(m1) = 2 >= T=2. VotesFor(m2) = 1 < T=2.
  confirmations[1] = {m1}. Only m1 is confirmed.

**Can Byzantine cause a conflicting confirmation?** The adversary needs T=2 votes for m2. They control only 1 committee member. Even if v3 votes for m2, VotesFor(m2) = 1 < 2. The adversary cannot reach the threshold alone.

**Safety: HOLDS.** f=1 < T=2. The single Byzantine committee member cannot unilaterally confirm an alternative message. At most one message (the one honest members agree on) reaches the threshold.

**Liveness: HOLDS.** Min honest on committee = 2 >= T=2. The 2 honest members always provide enough votes for the proposed message.

**Agreement: HOLDS.** Exactly one message is confirmed per slot.

---

#### Config 3: N=3, K=3, f=2 (Two Byzantine -- SAFETY VIOLATION)

| Parameter | Value |
|-----------|-------|
| T (threshold) | 2 |
| Max Byzantine on committee | 2 |
| Min honest on committee | 1 |

**Trace (Slot 1, attack scenario):**
- Propose: proposer picks m1
- Attest: honest v1 attests to m1. Byzantine v2, v3 attest to both m1 and m2.
- CommitteeVote: committee = {v1,v2,v3}. v1 votes for m1. v2, v3 both vote for m2.
- Confirm: VotesFor(m1) = 1 < T=2. VotesFor(m2) = 2 >= T=2.
  confirmations[1] = {m2}. **The wrong message is confirmed!**

**Worse: double confirmation attack:**
- v2 votes for m1 AND m2. v3 votes for m1 AND m2.
- VotesFor(m1) = 1 (honest) + 2 (byzantine) = 3 >= T=2.
- VotesFor(m2) = 0 (honest) + 2 (byzantine) = 2 >= T=2.
- confirmations[1] = {m1, m2}. **Two conflicting messages confirmed!**

**COUNTEREXAMPLE FOUND:**

```
State 0: Init
  currentSlot = 1, phase = "Propose"

State 1: Propose
  proposed[1] = m1, phase = "Attest"

State 2: Attest
  attestations[1] = {(v1,m1), (v2,m1), (v2,m2), (v3,m1), (v3,m2)}
  phase = "CommitteeVote"

State 3: CommitteeVote
  committee[1] = {v1, v2, v3}
  committeeVotes[1] = {(v1,m1), (v2,m1), (v2,m2), (v3,m1), (v3,m2)}
  phase = "Confirm"

State 4: Confirm
  confirmations[1] = {m1, m2}   <<< SAFETY VIOLATION: |confirmations| = 2 > 1
```

**Safety: FAILS.** f=2 >= T=2. Two Byzantine committee members can each vote for a conflicting message, reaching the threshold for both the legitimate and conflicting messages simultaneously.

**Liveness: CONDITIONAL.** The honest member (1) < T=2, so honest members alone cannot confirm. But Byzantine members can cooperate to confirm (the wrong thing), so "some" confirmation happens. True liveness (confirming the *correct* message) fails.

**Agreement: FAILS.** With two messages confirmed, honest nodes cannot deterministically agree.

---

#### Config 4: N=5, K=3, f=1

| Parameter | Value |
|-----------|-------|
| T (threshold) | 2 |
| Max Byzantine on committee | 1 (since f=1) |
| Min honest on committee | 2 |

**Key difference from Config 2:** N=5 > K=3, so the committee is a strict subset of validators. The single Byzantine validator may or may not be selected.

**Case A: Byzantine validator NOT on committee** (e.g., committee = {v1,v2,v3}, Byzantine = {v5})
- All committee members are honest. 3 honest votes for proposed message. Trivially safe and live.

**Case B: Byzantine validator ON committee** (e.g., committee = {v1,v2,v5})
- 2 honest + 1 Byzantine. Identical to Config 2 analysis. Safe and live.

**Safety: HOLDS** in all cases. max(Byzantine on committee) = min(f, K) = min(1, 3) = 1 < T=2.

**Liveness: HOLDS.** min(honest on committee) = K - min(f, K) = 3 - 1 = 2 >= T=2.

---

#### Config 5: N=5, K=5, f=2

| Parameter | Value |
|-----------|-------|
| T (threshold) | 3 |
| Max Byzantine on committee | 2 |
| Min honest on committee | 3 |

**Trace (worst case):** committee = {v1,v2,v3,v4,v5} (the only option since K=N). Byzantine: v4, v5.

- Honest v1,v2,v3 vote for m1: VotesFor(m1) >= 3 = T.
- Byzantine v4,v5 vote for m2: VotesFor(m2) = 2 < T=3.
- Even if Byzantine also vote for m1: VotesFor(m1) = 5, VotesFor(m2) = 2.
- Byzantine CANNOT get m2 to T=3 alone.

**Can Byzantine double-vote to confirm both?**
- VotesFor(m2) requires 3 votes. Byzantine provide at most 2. They need at least 1 honest vote for m2. But honest validators never vote for m2. So VotesFor(m2) <= 2 < 3 = T.

**Safety: HOLDS.** f=2 < T=3.

**Liveness: HOLDS.** Honest = 3 >= T=3. The proposed message always gets confirmed.

---

#### Config 6: N=7, K=5, f=2 (Production-like, from E2 recommendation)

| Parameter | Value |
|-----------|-------|
| T (threshold) | 3 |
| Max Byzantine on committee | 2 |
| Min honest on committee | 3 |

**Committee composition analysis:** With N=7, K=5, f=2, there are C(7,5)=21 possible committees.

- Committees with 0 Byzantine: C(5,5)*C(2,0) = 1
- Committees with 1 Byzantine: C(5,4)*C(2,1) = 10
- Committees with 2 Byzantine: C(5,3)*C(2,2) = 10

In all cases, Byzantine on committee <= 2 < T=3.

**Safety: HOLDS** for every possible committee composition.

**Liveness analysis:** Honest on committee = K - (Byzantine on committee).
- 0 Byzantine: 5 honest >= T=3. Live.
- 1 Byzantine: 4 honest >= T=3. Live.
- 2 Byzantine: 3 honest >= T=3. Live.

**Liveness: HOLDS** for every possible committee composition.

**This is the strongest configuration tested.** Safety margin: adversary would need to control 3 of 5 committee members (60%) to violate safety. With only 2 of 7 total validators being Byzantine (28.6%), the worst case gives 2 of 5 on committee (40%), which is below the 60% threshold.

---

### Summary Table

| Config | N | K | f | T | Safety | Liveness | Notes |
|--------|---|---|---|---|--------|----------|-------|
| MC1 | 3 | 3 | 0 | 2 | PASS | PASS | Baseline, no adversary |
| MC2 | 3 | 3 | 1 | 2 | PASS | PASS | f < T, safe |
| MC3 | 3 | 3 | 2 | 2 | **FAIL** | **FAIL** | f >= T, counterexample found |
| MC4 | 5 | 3 | 1 | 2 | PASS | PASS | Committee sampling does not weaken safety |
| MC5 | 5 | 5 | 2 | 3 | PASS | PASS | Larger threshold helps |
| MC6 | 7 | 5 | 2 | 3 | PASS | PASS | E2-recommended production config |

### Condition Matrix: Safety and Liveness by (K, f)

The following matrix shows the safety/liveness verdict for all parameter combinations requested in the experiment plan. T = ceil((K+1)/2).

```
        f=0         f=1         f=2
K=3   S:PASS       S:PASS       S:FAIL
T=2   L:PASS       L:PASS       L:FAIL
      (0<2)        (1<2)        (2>=2) <<<

K=5   S:PASS       S:PASS       S:PASS
T=3   L:PASS       L:PASS       L:PASS
      (0<3)        (1<3)        (2<3)

(K=5 with f=3 would FAIL: 3>=3)
```

For any N, the safety condition depends only on whether f < T (i.e., the total Byzantine count is below the threshold). This is because our model allows nondeterministic committee selection, so the worst-case committee always concentrates all Byzantine validators.

**Critical observation:** When K < N, it is *possible* that not all Byzantine validators land on the committee. However, TLC explores all possibilities, including the worst case. Safety holds across ALL possible committee selections if and only if f < T.

---

## 4. Key Insights

### 4.1 The Safety Condition is Simpler Than Expected

The formal analysis reveals a clean, sharp boundary:

> **Safety holds if and only if f < T = ceil((K+1)/2)**

This is independent of N (total validators). The committee sampling from a larger pool does not change the safety bound -- it only affects the *probability* of a bad committee, not the *possibility*. Since formal verification must account for all possibilities, the safety guarantee requires the global Byzantine count to be below the threshold.

This contrasts with the E2 simulation, which showed that larger N with fixed f *probabilistically* improves safety. The formal model reveals that probabilistic safety is not the same as guaranteed safety. For guaranteed safety, you must ensure f < T globally.

### 4.2 Liveness and Safety Have Identical Thresholds Under Majority

With majority threshold T = ceil((K+1)/2), we get:

- Safety requires: f < T (Byzantine cannot confirm a conflicting message)
- Liveness requires: K - f >= T (honest members can confirm the correct message)

Since T = ceil((K+1)/2) and honest = K - f on the committee:
- If f < T, then K - f > K - T >= K - ceil((K+1)/2) = floor((K-1)/2)
- For K >= 3 (odd): K - f >= K - T + 1 = K - (K+1)/2 + 1 = (K+1)/2 = T

**Therefore, under majority threshold with worst-case committee sampling, safety and liveness have the same condition: f < T.** This confirms E2's observation that "safety and liveness fail together" for majority threshold. The formal analysis shows this is not a coincidence but a mathematical identity: for odd K with majority threshold, the conditions are equivalent.

### 4.3 Double-Voting is the Primary Attack Vector

The counterexample in Config 3 reveals the exact attack: Byzantine validators double-vote (voting for both m1 and m2). This allows two conflicting messages to simultaneously exceed the threshold. The spec models this by allowing Byzantine committee members to vote for any subset of messages.

In a real implementation, this means:
- The protocol MUST NOT simply count "number of votes for m" independently.
- If a committee member is detected voting for two messages in the same slot, both votes should be invalidated (equivocation slashing).
- Without equivocation detection, the safety bound is f < T.
- WITH equivocation detection and slashing, the effective Byzantine voting power is reduced, but the formal safety bound remains f < T because detection is reactive, not preventive.

### 4.4 Finality Depth F is Orthogonal to Safety

The finality mechanism (requiring F consecutive confirmed slots) does not strengthen or weaken the per-slot safety guarantee. Its purpose is to make reversion costly:
- A confirmed slot can be "reverted" if the protocol supports chain reorganization.
- A finalized slot (with F subsequent confirmations) requires the adversary to revert F+1 consecutive slots, which requires controlling the committee for all of them.
- The probability of this decreases exponentially with F (if committee selection is random per slot).

However, the formal model does not capture chain reorganization (it models a linear sequence of slots with no forks). In a model with forks, finality depth would provide meaningful additional safety.

### 4.5 The Nondeterministic Committee Model is Overly Conservative

By modeling committee selection as fully nondeterministic, we require f < T globally. In practice, committee selection uses stake-weighted VRF sampling, so the probability of concentrating all Byzantine validators on one committee decreases as N grows relative to K. E2 quantifies this probability. The formal model gives the absolute bound; the simulation gives the expected-case bound.

---

## 5. Protocol Vulnerabilities

### 5.1 Committee Grinding (Not Modeled, but Critical)

If the committee selection seed is influenced by the proposer, a Byzantine proposer can try many seeds to find one that places more Byzantine validators on the committee. Our model does not capture this because committee selection is nondeterministic.

**Mitigation:** Use a VRF-based committee selection where the seed is the hash of a future block that the proposer cannot predict (commit-reveal) or use a distributed randomness beacon (e.g., RANDAO with penalty for non-revelation).

### 5.2 Proposer Equivocation

The current spec allows the proposer to propose only one message per slot (single Propose action). In reality, a Byzantine proposer could send different messages to different validators.

**Attack:** Byzantine proposer sends m1 to honest validators A and m2 to honest validators B. If committee members in group A vote for m1 and those in group B vote for m2, votes split. With enough Byzantine committee members adding votes to one side, the "wrong" message could be confirmed.

**In our model:** This is partially captured by Byzantine attestations (they can attest to any message), but the proposer is modeled as choosing a single message. A more adversarial model would allow the proposer to send different messages to different validators.

**Mitigation:** Validators should only attest to a message that is accompanied by a valid proposer signature. If the proposer signs two messages for the same slot, this constitutes slashable equivocation.

### 5.3 Attestation Withholding

Byzantine validators can withhold attestations, which reduces the evidence available to the committee. In our model, committee members vote based on the proposed message (not attestation counts), so withholding has no direct effect. However, in a protocol where the committee verifies attestation counts before voting, withholding could prevent confirmation.

**Impact:** Minimal in the current model. Could affect liveness if the protocol requires a minimum attestation count before the committee votes.

### 5.4 Long-Range Finality Attacks

If an adversary can corrupt validators *after* they served on a committee (key theft, bribery), they can retroactively forge committee votes for past slots. This allows rewriting history up to the finality depth.

**Not modeled:** The spec treats Byzantine membership as static. A dynamic corruption model would reveal this vulnerability.

**Mitigation:** Implement key rotation after committee service. Use forward-secure signatures so that stolen future keys cannot forge past signatures.

### 5.5 Liveness Attack via Committee Denial

Even when safety holds (f < T), if Byzantine validators are on the committee, they can delay voting, forcing timeouts. In a synchronous model (like ours), this is abstracted away. In partial synchrony, Byzantine validators can exploit timing to degrade throughput.

**Impact:** Liveness degradation proportional to the fraction of Byzantine committee members. Not a safety violation, but a denial-of-service concern.

---

## 6. Recommendations

### 6.1 Maintain Majority Threshold

The formal analysis confirms E2's recommendation: **majority threshold T = ceil((K+1)/2) is the correct choice.** The safety-liveness equivalence (Section 4.2) means the protocol never enters a state where it is safe but stuck. This property is unique to majority threshold and does not hold for supermajority.

### 6.2 Set f < T as the Protocol's Security Assumption

The protocol documentation should explicitly state:

> **Security assumption:** The number of Byzantine validators is strictly less than ceil((K+1)/2).

For K=7 (E2 recommendation), this means f <= 3. For K=5, f <= 2.

### 6.3 Implement Equivocation Detection

The double-voting counterexample (Section 4.3) shows this is the primary attack. The protocol should:

1. Require committee members to sign their votes.
2. Define a vote as valid only if the signer has not signed a different message for the same slot.
3. If equivocation is detected, both votes are invalidated and the validator is slashed.

This does not change the formal safety bound, but it increases the cost of attacking.

### 6.4 Use Randomized Committee Selection with Grinding Resistance

To bridge the gap between the formal model (worst-case, nondeterministic) and the simulation model (probabilistic), the committee selection must be unpredictable and unmanipulable. Recommend:

- RANDAO-style distributed randomness for epoch seeds.
- VRF-based per-validator committee proofs.
- Penalty for seed non-revelation.

### 6.5 Consider Adaptive Committee Size

The formal analysis shows safety depends on f < T, which depends on K. For networks where Byzantine fraction is uncertain:

- Monitor attestation behavior to estimate f.
- Increase K when suspicious behavior is detected.
- The formal bound f < ceil((K+1)/2) provides the minimum K for a given estimated f: **K >= 2f + 1**.

| Estimated f | Minimum K |
|-------------|-----------|
| 1 | 3 |
| 2 | 5 |
| 3 | 7 |
| 4 | 9 |

This matches E2's recommendation table exactly.

### 6.6 Add View-Change Protocol for Proposer Failure

The current spec does not model proposer failure. If the proposer is Byzantine and withholds the proposal entirely, the slot gets no message. The protocol needs:

1. A timeout after which a backup proposer takes over.
2. A view-change mechanism that transfers proposal rights.
3. This must be modeled in a future TLA+ extension.

---

## 7. Limitations

### 7.1 Synchrony Assumption

The specification models each slot as a sequence of synchronous phases. Real networks operate under partial synchrony where messages may be delayed by up to delta. The model does not capture:

- Messages arriving out of order within a phase.
- Validators missing the attestation window due to network delay.
- Committee votes arriving after the confirmation deadline.

**Impact:** Liveness results are optimistic. In partial synchrony, liveness requires additional assumptions (e.g., eventual synchrony, bounded delay).

### 7.2 Static Byzantine Set

Byzantine membership is fixed at model initialization. The model does not capture:

- Adaptive corruption (adversary corrupts validators during execution).
- Rational validators who become Byzantine when profitable.
- Temporary Byzantine behavior (crash-recovery).

### 7.3 No Stake Weighting

All validators have equal weight. The E2 simulation showed that stake concentration significantly affects safety probability. The TLA+ model's nondeterministic committee selection subsumes this concern (by checking all possible committees), but at the cost of being overly pessimistic for large N with small f.

### 7.4 No Network Partitions

The model assumes all honest validators can communicate. Under network partition:

- Honest validators in different partitions may see different proposals.
- Committee members in different partitions may not see each other's votes.
- This could lead to slots timing out even when honest members have majority.

### 7.5 Bounded State Space

Model checking is bounded by MaxSlot. Properties like "finality is never reverted" are only checked up to MaxSlot steps. An unbounded proof would require theorem proving (e.g., TLAPS).

### 7.6 No Chain Reorganization

The model assumes a linear sequence of slots with no forks. A more complete model would allow:

- Competing chains proposed by different proposers.
- Fork-choice rules.
- Chain reversion (which finality depth F is designed to prevent).

### 7.7 Single Message Per Slot

The model assigns one message per slot. In practice, a slot might contain a block of multiple messages/transactions. This simplification does not affect the consensus properties (the committee agrees on "the block" regardless of its contents).

---

## Appendix A: Formal Proof Sketch -- Safety Theorem

**Theorem:** If f < T = ceil((K+1)/2), then SafetyNoConflict holds in all reachable states.

**Proof sketch:**

1. SafetyNoConflict requires: for all slots s, |confirmations[s]| <= 1.

2. confirmations[s] = {m in Messages : VotesFor(committeeVotes[s], m) >= T}.

3. For two messages m1 /= m2 to both be in confirmations[s], we need:
   - VotesFor(votes, m1) >= T, and
   - VotesFor(votes, m2) >= T.

4. A vote (v, m) means validator v voted for message m. An honest validator v votes for exactly one message (the proposed message). So an honest validator contributes to VotesFor for exactly one message.

5. Let H = honest committee members, B = Byzantine committee members.
   - VotesFor(votes, m1) = |{v in H : v voted for m1}| + |{v in B : v voted for m1}|
   - VotesFor(votes, m2) = |{v in H : v voted for m2}| + |{v in B : v voted for m2}|

6. Since honest members all vote for the same message m_proposed:
   - If m1 = m_proposed: |{v in H : v voted for m1}| = |H|, and |{v in H : v voted for m2}| = 0.
   - So VotesFor(votes, m2) = |{v in B : v voted for m2}| <= |B|.

7. For m2 /= m_proposed to be confirmed: |B| >= T.

8. |B| = |ByzantineInCommittee(comm)| <= f (at most f Byzantine validators exist).

9. If f < T, then |B| < T, so VotesFor(votes, m2) < T. Contradiction.

10. Therefore, at most one message (m_proposed) can reach the threshold. QED.

---

## Appendix B: Formal Proof Sketch -- Liveness Theorem

**Theorem:** If K - f >= T (equivalently, for majority threshold with odd K, if f < T), then under weak fairness, every slot is eventually confirmed.

**Proof sketch:**

1. The protocol phases are deterministic in ordering: Propose -> Attest -> CommitteeVote -> Confirm -> Done -> (advance).

2. Under weak fairness (WF), every continuously enabled action eventually executes.

3. After Propose: phase = "Attest", and Attest is enabled. By WF, Attest eventually executes.

4. After Attest: phase = "CommitteeVote", and CommitteeVote is enabled. By WF, it eventually executes (for some nondeterministically chosen committee).

5. After CommitteeVote: phase = "Confirm". The Confirm action computes VotesFor for each message.

6. The proposed message m_proposed receives votes from all honest committee members. |HonestInCommittee(comm)| = K - |ByzantineInCommittee(comm)| >= K - f >= T.

7. Therefore VotesFor(votes, m_proposed) >= T, so m_proposed is in the confirmed set. The slot is confirmed (confirmations[s] /= {}).

8. After Confirm: phase = "Done". AdvanceSlot is enabled (if currentSlot < MaxSlot). By WF, it eventually executes. QED.

**Note:** Step 6 requires that the committee has at most f Byzantine members. Since we select any K-subset, the worst case is min(f, K) Byzantine. The condition K - f >= T ensures even this worst case has enough honest members.

---

## Appendix C: Reproduction Instructions

### Running TLC Model Checker

```bash
# Prerequisites: Java 11+, tla2tools.jar from https://github.com/tlaplus/tlaplus/releases

# Configuration 1: No adversary (should pass all properties)
java -jar tla2tools.jar -config MC1.cfg MCTemporalConsensus

# Configuration 3: Two Byzantine (should find safety counterexample)
java -jar tla2tools.jar -config MC3.cfg MCTemporalConsensus

# See MCTemporalConsensus.tla for all configuration details.
```

### Using TLA+ Toolbox IDE

1. Open `TemporalConsensus.tla` as the root module.
2. Create a new model and set constants per the desired configuration.
3. Add `Safety` as an invariant.
4. Add `LivenessProgress` as a temporal property.
5. Set `StateConstraint` to bound the state space.
6. Use `MessageSymmetry` for efficiency.

### Expected TLC Output

For MC3 (the counterexample configuration), TLC should produce output similar to:

```
Error: Invariant SafetyNoConflict is violated.
Error: The following behavior constitutes a counterexample:

State 1: <Initial predicate>
  currentSlot = 1
  phase = "Propose"
  ...

State 2: <Propose>
  proposed[1] = m1
  phase = "Attest"

State 3: <Attest>
  attestations[1] = {<<v1, m1>>, <<v2, m1>>, <<v2, m2>>, <<v3, m1>>, <<v3, m2>>}
  phase = "CommitteeVote"

State 4: <CommitteeVote>
  committee[1] = {v1, v2, v3}
  committeeVotes[1] = {<<v1, m1>>, <<v2, m1>>, <<v2, m2>>, <<v3, m1>>, <<v3, m2>>}
  phase = "Confirm"

State 5: <Confirm>
  confirmations[1] = {m1, m2}   <<< INVARIANT VIOLATION
```

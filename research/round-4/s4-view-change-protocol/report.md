# S4: View-Change Protocol for Temporal Consensus

**Round 4, Stream 4 — Consensus Robustness**
**Date:** 2026-03-16
**Depends on:** E7 (TLA+ formal model), E2 (committee parameters), S1 (protocol architecture)

---

## Overview

The E7 formal specification of temporal consensus (TemporalConsensus.tla) models a correct proposer that always produces a valid proposal. Section 6.6 of the E7 report explicitly identifies proposer failure as unmodeled and recommends a view-change mechanism. Section 7.5 of the S1 protocol architecture describes a preliminary timeout-and-backup sketch but defers the full design to this work stream.

This document designs a complete view-change protocol for firecat's temporal consensus. The protocol must handle three proposer failure modes -- crash, Byzantine equivocation, and slowness -- while preserving the safety invariant established in E7: no two conflicting messages are confirmed for the same slot, even across view changes.

---

## 1. Proposer Failure Modes

### 1.1 Crash Failure (No Proposal)

The slot proposer goes offline or crashes before producing a slot manifest. The committee waits indefinitely (in the current model) because the Propose phase has no timeout.

**Impact:**
- The slot receives no proposal.
- Confirmed messages that were waiting for slot assignment are delayed.
- If the proposer remains crashed, all subsequent slots in the epoch stall (since proposer rotation within the current E7 model is undefined).

**Frequency estimate:** With K=7 committee members rotating proposer duty, and assuming 99% uptime per validator (S1 Section 6.2), the probability of a proposer crash in any given slot is approximately 1%. Over a 300-slot epoch, roughly 3 slots would experience proposer crashes.

### 1.2 Byzantine Proposer (Equivocation)

A Byzantine proposer sends conflicting slot manifests to different committee members. Validator A receives a manifest containing message set {M1, M2}, while validator B receives a manifest containing {M1, M3}. This is the proposer analogue of the double-voting attack identified in E7 Section 4.3.

**Impact:**
- Committee members attest to different proposals.
- Honest votes split across conflicting proposals.
- If enough honest votes land on different proposals, neither reaches the T=4 threshold.
- In the worst case, Byzantine committee members supplement one proposal to reach threshold, confirming a proposal that not all honest members saw.

**Severity:** This is the most dangerous failure mode. It can cause safety violations if the view-change protocol is not carefully designed.

### 1.3 Slow Proposer (Timeout)

The proposer produces a valid proposal, but it arrives after the slot deadline. Some committee members receive it in time; others do not.

**Impact:**
- Committee members disagree on whether a valid proposal exists for the slot.
- Some members start the view-change process while others proceed with the original proposal.
- This creates a split-brain scenario where two proposals (original and backup) may compete.

**Severity:** Medium. Unlike Byzantine equivocation, a slow proposer does not actively try to cause harm, but the ambiguity it creates can be exploited by Byzantine committee members.

---

## 2. View-Change Protocol Design

### 2.1 Core Concepts

**View:** A view is an attempt to produce a valid proposal for a given slot. The initial proposer operates in view 0. If view 0 fails (timeout, equivocation detected), the protocol enters view 1 with a different proposer, and so on.

**View number:** Each slot has an associated view counter `v >= 0`. The view number is included in all consensus messages (attestations, committee votes, confirmations) to prevent cross-view confusion.

**View-change trigger:** A committee member initiates a view-change when it observes one of:
1. **Timeout:** No valid proposal received within the view's time budget.
2. **Equivocation proof:** Two conflicting proposals signed by the same proposer for the same slot and view.
3. **Insufficient progress:** The proposal was received but could not gather T attestations within the attestation deadline.

### 2.2 Proposer Selection

**Primary proposer (view 0):** Determined by VRF output ordering. The committee member with the lowest VRF output for the current epoch is the proposer for the first slot. Proposer duty rotates sequentially through VRF-sorted committee members across slots within the epoch.

**Backup proposer (view v):** The proposer for view `v` of slot `s` is:

```
proposer(s, v) = committee_members_sorted_by_VRF[(s + v) mod K]
```

where `committee_members_sorted_by_VRF` is the K-member committee sorted by ascending VRF output. This deterministic ordering ensures all honest committee members agree on who the proposer is for any (slot, view) pair without additional communication.

**Properties:**
- **Deterministic:** Every committee member can independently compute the proposer for any (slot, view) pair.
- **Unpredictable to outsiders:** The VRF ordering is not known until the epoch begins and committee members reveal their VRF proofs.
- **Rotates through all members:** After K view changes, every committee member has had one chance to propose. If all K members fail, the slot is left empty.

### 2.3 Timeout Mechanism

The timeout structure uses exponential backoff to balance responsiveness against network delay:

| View | Timeout Duration | Cumulative from Slot Start |
|------|-----------------|---------------------------|
| 0 | T_base = 2.0s | 2.0s |
| 1 | T_base * 1.5 = 3.0s | 5.0s |
| 2 | T_base * 1.5^2 = 4.5s | 9.5s |
| 3 | T_base * 1.5^3 = 6.75s | 16.25s |
| 4 | T_base * 1.5^4 = 10.125s | 26.375s |
| 5 | T_base * 1.5^5 = 15.19s | 41.56s |
| 6 (final) | T_base * 1.5^6 = 22.78s | 64.34s |

**T_base = 2.0 seconds.** This is the slot duration from S1 Section 7.2. The base timeout allows one full slot's worth of time for proposal propagation plus attestation collection.

**Exponential backoff factor: 1.5x per view.** Each successive view allows 50% more time than the previous one. This accounts for the possibility that network conditions are degraded (which may have caused the previous proposer's failure).

**Maximum views per slot: K = 7.** After 7 failed views (one per committee member), the slot is declared empty. Total worst-case time for an empty slot: ~64 seconds. This is acceptable because it requires all 7 committee members to fail, which has probability < 10^-14 under the assumption that each member independently has 1% crash probability.

**Timeout start:** Each committee member's timeout clock starts when it either:
1. Receives the view-change certificate for the previous view (views 1+), or
2. Enters the slot's time window (view 0).

### 2.4 Calibration Rationale

The timeout values are calibrated against the network latency budget from S1:

| Component | Expected Latency | Source |
|-----------|-----------------|--------|
| Proposal propagation (proposer to committee) | 10-200 ms | S1 Phase 4 |
| Attestation collection (validators to committee) | 100-500 ms | S1 Phase 6 |
| Committee vote collection (committee internal) | 50-200 ms | S1 Phase 7 |
| Total optimistic | 160-900 ms | |
| Safety margin (2x) | 320-1800 ms | |

The 2.0s base timeout provides approximately 2x headroom over the worst-case optimistic latency (900ms). This means a proposal can tolerate up to 1.1 seconds of unexpected delay before triggering a view change.

**Network assumptions:** The protocol assumes partial synchrony -- messages are eventually delivered within an unknown but finite bound delta. The exponential backoff ensures that if delta is larger than expected, later views will have enough time to succeed. Specifically, if the actual network delay is delta, the protocol succeeds as long as some view v has timeout > 2*delta (round-trip), which is guaranteed for delta up to ~11 seconds (view 4).

---

## 3. View-Change Message Protocol

### 3.1 Message Types

The view-change protocol introduces three new message types beyond the existing 5-phase consensus:

**VC1: ViewChangeRequest**
```
{
  "type": "view_change_request",
  "slot": s,
  "from_view": v,
  "to_view": v + 1,
  "sender": committee_member_pubkey,
  "reason": "timeout" | "equivocation" | "insufficient_attestations",
  "evidence": <optional equivocation proof>,
  "highest_confirmed_slot": s_confirmed,
  "signature": <sender's signature over the above fields>
}
```

A committee member sends this when it wants to move from view `v` to view `v+1`. The `highest_confirmed_slot` field carries forward the sender's latest confirmed slot, which is critical for the safety argument (Section 4).

**VC2: ViewChangeCertificate**
```
{
  "type": "view_change_certificate",
  "slot": s,
  "new_view": v + 1,
  "new_proposer": proposer(s, v+1),
  "requests": [<T or more ViewChangeRequest messages>],
  "signature": <new proposer's signature>
}
```

The new proposer (for view v+1) collects T or more ViewChangeRequest messages and bundles them into a certificate. This certificate proves that a quorum of committee members agreed to abandon the current view. The new proposer broadcasts this certificate along with its new proposal.

**VC3: NewViewProposal**
```
{
  "type": "new_view_proposal",
  "slot": s,
  "view": v + 1,
  "certificate": <ViewChangeCertificate>,
  "proposal": <slot manifest (same format as view-0 proposal)>,
  "signature": <new proposer's signature>
}
```

The new proposer's proposal for the new view. It includes the ViewChangeCertificate as proof of legitimacy. Committee members will only attest to a view v+1 proposal if it contains a valid certificate.

### 3.2 Protocol Flow

```
View 0 (normal):
  Proposer(s,0) ---[Proposal]---> Committee
  Committee     ---[Attestations]--> Committee
  Committee     ---[Votes]-------> Confirmation
  IF confirmed: DONE (slot assigned)
  IF timeout:   proceed to view change

View change (v -> v+1):
  Step 1: Each committee member that timed out broadcasts ViewChangeRequest
  Step 2: proposer(s, v+1) collects T ViewChangeRequests
  Step 3: proposer(s, v+1) forms ViewChangeCertificate
  Step 4: proposer(s, v+1) broadcasts NewViewProposal (certificate + proposal)
  Step 5: Committee members verify certificate, then proceed with standard
          Attest -> CommitteeVote -> Confirm for the new proposal

View v+1 (backup):
  Same as view 0, but:
  - All messages include view number v+1
  - Proposal includes ViewChangeCertificate
  - Attestations are only valid for the current view
  IF confirmed: DONE
  IF timeout:   proceed to view v+2 (same process)
```

### 3.3 Message Complexity

Per view change:
- ViewChangeRequest messages: K (one per committee member, at most)
- ViewChangeCertificate: 1 (from new proposer)
- NewViewProposal: 1 (from new proposer)
- Total additional messages per view change: K + 2

For normal operation (no view change): 0 additional messages.

For a single view change: K + 2 = 9 additional messages (K=7).

This is lightweight compared to PBFT's O(K^2) view-change message complexity.

---

## 4. Safety During View Change

### 4.1 The Core Safety Problem

The critical invariant from E7 is **SafetyNoConflict**: at most one message is confirmed per slot. View changes introduce a new risk: a message could be confirmed in view v, and then a different message confirmed in view v+1 if the view-change protocol is not careful.

**Attack scenario without protection:**
1. In view 0, proposer sends proposal P1.
2. P1 receives T=4 committee votes and is confirmed.
3. Committee members A, B, C did not see the confirmation (network delay).
4. A, B, C, plus Byzantine member D send ViewChangeRequests (4 = T).
5. View 1 proposer creates a new proposal P2.
6. P2 is confirmed in view 1.
7. Two conflicting confirmations exist for the same slot.

### 4.2 Safety Mechanism: Lock-and-Carry

The protocol uses a mechanism inspired by Tendermint's "prevote locking" to prevent the above attack:

**Rule 1 (Lock rule):** If a committee member has voted for a proposal P in view v and that proposal received T votes (i.e., the member knows P is confirmed), the member is "locked" on P. A locked member must NOT send a ViewChangeRequest that would abandon P.

**Rule 2 (Carry rule):** Each ViewChangeRequest carries the sender's `highest_confirmed_slot` and, if the sender voted for a proposal in the current slot's view, the proposal it voted for and the votes it has seen. The new proposer must examine these carried proposals.

**Rule 3 (Repropose rule):** When forming a NewViewProposal, the new proposer must check the ViewChangeRequests for any proposal that received votes (even if < T). If any proposal received votes from at least one honest member, the new proposer SHOULD repropose that same proposal. If there is no such proposal (or it cannot be determined), the new proposer may propose freely.

More precisely, the new proposer MUST repropose the proposal from the highest view in which any ViewChangeRequest sender reports having voted. This ensures that if a proposal was "close to confirming" in a previous view, it is not lost.

**Rule 4 (View-scoped attestations):** Attestations and committee votes are tagged with the view number. A vote for proposal P in view v does not count toward confirmation of any proposal in view v' != v. This prevents mixing votes from different views.

### 4.3 Safety Proof Sketch

**Theorem:** If f < T = ceil((K+1)/2), then SafetyNoConflict holds across all views.

**Proof sketch:**

1. Suppose for contradiction that two distinct proposals P1 and P2 are both confirmed for slot s, with P1 confirmed in view v1 and P2 in view v2, where v1 < v2.

2. P1 confirmed in view v1 means T committee members voted for P1 in view v1. Call this set S1. Since f < T, at least one member of S1 is honest. Call it h1.

3. P2 confirmed in view v2 means T committee members voted for P2 in view v2. Call this set S2.

4. For the protocol to reach view v2, a ViewChangeCertificate must exist for each intermediate view transition. Each certificate requires T ViewChangeRequests.

5. Consider the transition from view v1 to view v1+1. The certificate requires T ViewChangeRequests. By Rule 1, h1 (who saw P1 confirmed in view v1) would NOT send a ViewChangeRequest. So the T requests must come from the remaining K - 1 members (excluding h1). But we need T out of K-1, and since T = ceil((K+1)/2), this requires ceil((K+1)/2) out of K-1 = (K-1)/2 + ... which is tight.

   Wait -- this needs more care. h1 saw T votes for P1, but h1 may not have seen the confirmation if the confirmation record was not yet written when the timeout fired. The lock rule applies when the member *has voted and has seen T votes*. If h1 voted but the confirmation was asynchronous, h1 may not be locked.

6. **Refined argument using quorum intersection:** S1 (T members who voted for P1 in v1) and the set Q (T members who sent ViewChangeRequests for view v1 -> v1+1) must overlap, because |S1| + |Q| = T + T = 2T > K (since T > K/2 for majority threshold). Therefore at least one member h is in both S1 and Q.

7. Member h voted for P1 in view v1 AND sent a ViewChangeRequest. By Rule 2, h's ViewChangeRequest carries the fact that h voted for P1. By Rule 3, the proposer for view v1+1 must repropose P1.

8. By induction on view numbers from v1+1 to v2, every proposer must repropose P1. Therefore P2 = P1, contradicting our assumption. QED.

This argument relies on the quorum intersection property: any two sets of T members out of K must overlap when T > K/2. This is exactly the majority threshold condition from E7.

### 4.4 The Quorum Intersection Argument

The safety of the view-change protocol reduces to the same condition as E7's base safety:

> **View-change safety holds if and only if T > K/2 (majority threshold).**

This is because:
- Any confirmed proposal has T votes (set S).
- Any view-change certificate has T requests (set Q).
- |S intersect Q| >= |S| + |Q| - K = 2T - K > 0 when T > K/2.

The overlapping member carries forward the locked proposal, forcing reproposal. This is the same quorum intersection argument used in PBFT, Tendermint, and HotStuff.

---

## 5. Liveness During View Change

### 5.1 Liveness Guarantee

**Claim:** If fewer than T committee members are Byzantine (f < T) and the network is eventually synchronous (there exists a Global Stabilization Time GST after which all messages between honest members are delivered within delta), then the protocol eventually confirms a proposal for every slot.

**Argument:**

1. After GST, all messages between honest members arrive within delta.
2. There are at least K - f >= T honest committee members.
3. At most f < T members are Byzantine. Even if all f Byzantine members are proposers in views 0 through f-1, view f will have an honest proposer.
4. The honest proposer in view f will produce a valid proposal and broadcast it to all committee members.
5. Since we are after GST, all honest members receive the proposal within delta.
6. All K - f >= T honest members attest and vote for the proposal.
7. The proposal receives >= T votes and is confirmed.

**Worst case for liveness:** All f Byzantine members are scheduled as proposers before any honest member, and each Byzantine proposer causes a timeout. The protocol requires f view changes before an honest proposer gets a turn. With the exponential backoff timeout schedule, the total delay is:

```
Total delay = T_base * sum(1.5^i for i in 0..f-1)
            = T_base * (1.5^f - 1) / (1.5 - 1)
            = 2.0 * (1.5^f - 1) / 0.5
            = 4.0 * (1.5^f - 1)
```

For f=3 (max Byzantine with K=7, T=4): delay = 4.0 * (1.5^3 - 1) = 4.0 * 2.375 = 9.5 seconds.

This is tolerable: a slot that would normally take 2 seconds takes 11.5 seconds (9.5s of view changes + 2s for the successful view). The protocol self-heals.

### 5.2 Multiple Consecutive Bad Proposers

If bad proposers span consecutive slots (not just consecutive views within one slot), liveness degrades but does not fail:

- Each slot independently runs the view-change protocol.
- The proposer rotation `(s + v) mod K` ensures that different slots start with different proposers.
- Even if a Byzantine member is the primary proposer for slot s, a different member is primary for slot s+1.
- With K=7 and f=3, at most 3 out of 7 proposer positions per epoch are Byzantine.

Over a 300-slot epoch, each committee member proposes approximately 300/7 ~ 43 slots. If 3 members are Byzantine, roughly 129 slots may experience a view-0 timeout. Each of these slots still completes via view change (total latency overhead: ~129 * 9.5s = ~20 minutes, spread across the 10-minute epoch). In practice this means the epoch would stretch to approximately 30 minutes.

### 5.3 Exponential Backoff vs. Fixed Timeout

Two timeout strategies were considered:

**Fixed timeout (T_base for every view):**
- Pro: Faster recovery -- each view change takes the same time.
- Con: If network conditions are degraded (the reason for the proposer's failure), fixed timeouts cause cascading failures. Each honest proposer also fails because the timeout is too short for the degraded network.

**Exponential backoff (T_base * 1.5^v):**
- Pro: Self-adapting -- later views tolerate worse network conditions.
- Con: Slower worst-case recovery.
- Pro (critical): Guarantees eventual liveness under partial synchrony. If the actual network delay is delta, the protocol succeeds once the timeout exceeds 2*delta. Exponential backoff guarantees this happens within O(log(delta/T_base)) views.

**Decision: Exponential backoff with factor 1.5.** This is the standard choice in the literature (HotStuff uses a similar approach). The 1.5 factor is less aggressive than doubling (common in TCP), which keeps worst-case latency manageable.

---

## 6. Byzantine Proposer Handling

### 6.1 Equivocation Detection

A Byzantine proposer may send different proposals to different committee members. Detection works as follows:

1. Committee members gossip received proposals to each other during the attestation phase.
2. If any committee member receives two proposals signed by the same proposer for the same (slot, view), it creates an **equivocation proof**: the pair of conflicting signed proposals.
3. The equivocation proof is broadcast as evidence in a ViewChangeRequest (reason: "equivocation").
4. Any single valid equivocation proof is sufficient to trigger an immediate view change, even before the timeout expires.

**Fast-path equivocation detection:** If equivocation is detected before T attestations are collected, the view change happens quickly (no need to wait for the full timeout). This limits the damage from Byzantine proposers.

### 6.2 Slashing

Equivocation by a proposer is a slashable offense (S1 Section 6.2 specifies 50% stake slashing for equivocation). The slashing mechanism:

1. The equivocation proof (two conflicting signed proposals for the same slot and view) is written to `immutable://evidence/equivocation/{proposer_pubkey}/{slot}/{view}`.
2. Any node can submit this proof.
3. The proof is self-verifying: it contains two messages with valid signatures from the same key, same slot, same view, but different content.
4. Upon verification, the proposer's stake is slashed by 50%.
5. The proposer is removed from committee eligibility for the remainder of the era.

### 6.3 Invalid Proposal Detection

A Byzantine proposer might produce a syntactically valid but semantically invalid proposal (e.g., including messages that were not properly attested, referencing nonexistent state). Validators detect this during the attestation phase:

1. Each validator independently verifies every message in the proposed slot manifest.
2. If any message fails verification, the validator withholds its attestation and broadcasts a rejection.
3. If T validators reject, the proposal is rejected and a view change is triggered.

This mechanism is already implicit in the E7 model (honest validators only attest to valid proposals) but must be made explicit in the implementation.

---

## 7. Integration with the 5-Phase Consensus

### 7.1 Modified Phase Structure

The existing 5-phase consensus (Propose, Attest, CommitteeVote, Confirm, Done) is modified as follows:

```
  Phase 0: View Selection
    - Determine proposer for current (slot, view)
    - If view > 0: verify ViewChangeCertificate before proceeding

  Phase 1: Propose (unchanged, but view-tagged)
    - Proposer broadcasts slot manifest
    - Manifest includes view number and (if view > 0) ViewChangeCertificate
    - Timeout: T_base * 1.5^view

  Phase 2: Attest (unchanged, but view-tagged)
    - Validators verify and attest
    - Attestations include view number
    - Equivocation detection happens here

  Phase 3: CommitteeVote (unchanged, but view-tagged)
    - Committee members vote for the attested proposal
    - Votes include view number
    - Only votes matching the current view are counted

  Phase 4: Confirm (unchanged)
    - Messages with >= T same-view votes are confirmed
    - Confirmation record includes view number

  Phase 5: Done / ViewChange
    - If confirmed: advance to next slot (phase = Done)
    - If timeout or equivocation: increment view, broadcast
      ViewChangeRequest, return to Phase 0

  Phase 6: AdvanceSlot (unchanged)
    - Move to next slot, reset view to 0
```

### 7.2 State Changes

The protocol state is extended with:

```
view[s]          -- current view number for slot s (initially 0)
viewChangeReqs[s][v]  -- set of ViewChangeRequests for slot s transitioning
                         from view v
locked[s][member] -- the proposal (if any) that member is locked on for slot s
```

### 7.3 Backward Compatibility

The view-change extension is backward-compatible with the existing consensus:

- If no view changes occur (happy path), the protocol behaves identically to E7's model. View 0 completes successfully, and the view-change machinery is never invoked.
- The only change to the happy path is the inclusion of `view: 0` in consensus messages, which is a trivial addition.
- Existing safety proofs from E7 apply to view 0 without modification.

---

## 8. Interaction with Committee Rotation at Epoch Boundaries

### 8.1 The Epoch Boundary Problem

Committee rotation occurs at epoch boundaries (every 300 slots, per S1 Section 7.3). If a view change is in progress when the epoch ends, two complications arise:

1. **Committee membership changes:** The view-change protocol relies on a fixed committee. If the committee changes mid-view-change, the quorum intersection argument breaks.
2. **Proposer ordering changes:** The backup proposer ordering is based on the current committee's VRF outputs. A new epoch means new VRF outputs and a new ordering.

### 8.2 Resolution: Epoch Extension

**Rule:** A view change in progress at an epoch boundary is completed under the old committee before the new committee takes over.

Specifically:
- The epoch boundary is "soft" -- it is triggered by slot count, but if the last slot of the epoch is undergoing a view change, the epoch is extended until that slot resolves (either confirms or is declared empty after K view exhaustion).
- The new committee's first slot begins only after the old committee has finalized its last slot.
- Maximum epoch extension: ~64 seconds (worst case: all K views time out for the last slot).

**Alternative considered: Hard cutoff.** Under a hard cutoff, the old committee's last slot would be abandoned if it has not confirmed by the epoch boundary. This is simpler but wastes confirmed messages and creates an incentive for Byzantine proposers to delay the last slot deliberately.

**Decision: Soft epoch boundary with extension.** The worst-case 64-second extension is acceptable given a 10-minute base epoch duration (it represents a 10% extension in the absolute worst case).

### 8.3 Cross-Epoch View Change Prevention

The new committee MUST NOT attempt to view-change a slot owned by the old committee. This is enforced by including the epoch number in all consensus messages. A ViewChangeRequest for epoch E is only valid if it comes from a member of epoch E's committee.

---

## 9. Comparison with Existing View-Change Protocols

### 9.1 PBFT View Change

**Mechanism:** PBFT's view change uses a 3-phase approach (view-change, new-view, pre-prepare). Each replica sends a VIEW-CHANGE message containing its prepared certificates to the new primary. The new primary collects 2f+1 VIEW-CHANGE messages and computes a new-view message with the "correct" set of requests.

**Message complexity:** O(K^2) -- each of K replicas sends a VIEW-CHANGE containing O(K) prepared certificates.

**Comparison with firecat:**
- PBFT's O(K^2) complexity is acceptable for small K (K=7 in firecat), so the complexity advantage of our O(K) protocol is modest in absolute terms.
- PBFT carries full prepared certificates in VIEW-CHANGE messages. Firecat carries only the highest confirmed slot and locked proposal, which is more compact.
- PBFT's safety argument is based on the same quorum intersection property we use.
- PBFT requires 3f+1 replicas for safety. Firecat requires 2f+1 (majority threshold). This is possible because firecat's proposer produces a single proposal per view (not a sequence of requests as in PBFT).

### 9.2 Tendermint Round Change

**Mechanism:** Tendermint uses a round-based approach where each round has a proposer, prevote phase, and precommit phase. If a round fails, the round number increments and a new proposer is selected. Validators lock on a proposal when they see 2/3+ prevotes for it.

**Timeout:** Exponential backoff (similar to our approach).

**Comparison with firecat:**
- Tendermint's locking mechanism (lock on 2/3+ prevotes) is analogous to our Lock rule.
- Tendermint uses 2/3 supermajority (3f+1 total). Firecat uses majority (2f+1). This is a fundamental design choice from E2/E7: majority provides identical safety-liveness thresholds, while supermajority creates a liveness gap.
- Tendermint's round change is more lightweight than PBFT's view change because it does not carry certificates explicitly -- the locking rule provides safety implicitly. Firecat adopts this approach.
- Tendermint validators communicate prevotes and precommits via gossip. Firecat committee members communicate via the b3nd data layer (writing to `immutable://` URIs), which is architecturally simpler but may have higher latency.

### 9.3 HotStuff Leader Rotation

**Mechanism:** HotStuff uses a pacemaker that synchronizes replicas on view numbers. Leader rotation is deterministic (round-robin or VRF-based). The pacemaker ensures all honest replicas eventually enter the same view, enabling the leader to collect a quorum certificate (QC) and produce a proposal.

**Key innovation:** HotStuff's view change is "free" -- the protocol always proceeds through prepare, pre-commit, commit, and decide phases, regardless of whether a view change occurred. The leader simply extends the chain of QCs.

**Message complexity:** O(K) per view change (linear).

**Comparison with firecat:**
- HotStuff's linear view change is achieved through its chained QC structure. Firecat could adopt this structure but it would require a more fundamental redesign of the slot-based consensus.
- HotStuff rotates leaders every view (not just on failure). This is more aggressive than firecat's approach, where the proposer changes only on timeout. HotStuff's approach avoids the timeout entirely for normal operation but adds complexity.
- HotStuff requires 3f+1 replicas. Firecat's majority threshold (2f+1) is tighter.
- HotStuff's pacemaker is the key component for liveness. Firecat's exponential backoff timeout serves a similar purpose but is simpler.

### 9.4 Summary Comparison

| Property | PBFT | Tendermint | HotStuff | Firecat |
|----------|------|-----------|----------|---------|
| Threshold | 3f+1 | 3f+1 | 3f+1 | 2f+1 (majority) |
| View-change messages | O(K^2) | O(K) | O(K) | O(K) |
| Timeout strategy | Fixed | Exp. backoff | Pacemaker | Exp. backoff |
| Locking mechanism | Prepared certs | Prevote lock | QC chain | Lock-and-carry |
| Leader rotation | On failure | On failure | Every view | On failure |
| Safety argument | Quorum intersect | Quorum intersect | QC chain | Quorum intersect |

---

## 10. Concrete Recommendation for Firecat

### 10.1 Recommended Protocol

Adopt the **Lock-and-Carry view-change protocol** described in Sections 2-6 above, with the following concrete parameters:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| T_base | 2.0 seconds | Matches slot duration (S1 Section 7.2) |
| Backoff factor | 1.5 | Standard for partial synchrony; keeps worst case under 65s |
| Max views per slot | K = 7 | One attempt per committee member |
| Lock threshold | T = 4 votes | Same as confirmation threshold |
| ViewChangeRequest quorum | T = 4 requests | Quorum intersection with confirmation |
| Equivocation fast-path | Immediate view change on proof | Minimizes Byzantine proposer damage |
| Epoch boundary | Soft extension | Prevents cross-committee confusion |

### 10.2 Implementation Priority

The view-change protocol should be implemented in phases:

**Phase 1 (v1.0): Timeout and backup proposer.**
- Implement timeout with fixed T_base = 2.0s (no backoff initially).
- Backup proposer selection via VRF ordering.
- Empty slot on timeout (no re-proposal, confirmed messages carry to next slot).
- This is the "v1.0 approximation" described in S1 Section 7.5.
- Safety: preserved (empty slots do not violate SafetyNoConflict).
- Liveness: degraded (empty slots waste throughput, but the system progresses).

**Phase 2 (v1.1): Full view-change protocol.**
- ViewChangeRequest, ViewChangeCertificate, NewViewProposal messages.
- Lock-and-carry mechanism.
- Exponential backoff.
- Equivocation detection and slashing.
- This closes the E7 gap completely.

**Phase 3 (v1.2): Optimizations.**
- Pipelining: start the next slot's view 0 while the current slot's view change is in progress (for non-conflicting proposals).
- Aggregate ViewChangeRequest signatures (BLS or FROST) to reduce certificate size.
- Adaptive T_base based on observed network latency.

### 10.3 Why Not HotStuff's Approach?

HotStuff's chained QC structure is elegant but requires rethinking firecat's slot-based consensus architecture. Firecat's temporal consensus is organized around slots with a fixed proposer per slot, which maps naturally to the Tendermint-style round change. Adopting HotStuff would require:

1. Replacing the 5-phase per-slot model with a continuous QC chain.
2. Changing the slot assignment model (slots would no longer have fixed proposers).
3. Re-doing the E7 formal verification.

The marginal benefit (slightly faster view changes, no explicit timeout for normal operation) does not justify the architectural disruption. The Lock-and-Carry protocol provides the same safety and liveness guarantees with minimal changes to the existing design.

### 10.4 Why Majority Threshold Still Works

The E7 report established that safety and liveness have identical conditions under majority threshold (f < T). The view-change protocol preserves this property:

- Safety requires quorum intersection: 2T > K, which holds when T > K/2 (majority).
- Liveness requires an honest proposer within K views: guaranteed when f < K, which is weaker than f < T.
- The combined condition remains f < T = ceil((K+1)/2).

No change to the E2/E7-recommended parameters (K=7, T=4) is needed. The view-change protocol is compatible with dynamic K scaling (D2) because the quorum intersection argument holds for any K with majority threshold.

---

## 11. Open Questions

### 11.1 Proposal Content During View Change

When a backup proposer takes over, should it:
(a) Propose the same set of confirmed messages that the failed proposer should have included?
(b) Propose a fresh set based on the current pending queue?

Option (a) requires the backup proposer to know what the original proposer intended, which is impossible if the original proposer crashed before broadcasting. Option (b) is simpler and always possible, but may reorder messages relative to what was expected.

**Recommendation:** Option (b) for crash failures, option (a) for equivocation (where the original proposal is known but conflicting). The backup proposer should include any messages that were part of a previous-view proposal that it received, plus new confirmed messages.

### 11.2 Interaction with FROST Threshold Signatures

The S1 architecture recommends FROST threshold signatures for committee confirmations (S1 Section 5.2). FROST requires interactive rounds between T signers. If a view change occurs mid-FROST, the signing round must restart. This means:

- FROST rounds must complete within the view's timeout, or they are abandoned.
- The new view's confirmation uses a fresh FROST round with the new proposal.
- FROST setup (key generation) is per-epoch, not per-view, so there is no setup overhead for view changes.

### 11.3 Network Partition Recovery

If a network partition separates the committee into two groups, neither group may have T members to complete a view change. After the partition heals:

- Both groups may be at different view numbers.
- The group at the higher view number will have valid ViewChangeCertificates.
- Upon reconnection, members synchronize to the highest certified view and proceed.
- Safety is maintained because no proposal can be confirmed with < T votes.

This scenario should be modeled in a future TLA+ extension that captures partial synchrony.

---

## 12. Formal Specification

The companion file `ViewChange.tla` provides a TLA+ formal sketch that extends `TemporalConsensus.tla` with the view-change mechanism. The key additions:

1. A `view` variable tracking the current view number per slot.
2. ViewChangeRequest and ViewChangeCertificate as protocol actions.
3. The Lock-and-Carry rules encoded as guard conditions on actions.
4. An extended safety invariant: SafetyNoConflict must hold across all views.

The specification is a design sketch, not a runnable model. It captures the essential safety argument (quorum intersection across views) and can be refined into a model-checkable specification in a follow-up.

---

## Appendix A: Timeout Sensitivity Analysis

How sensitive is liveness to the choice of T_base?

| T_base | View 0 | Max recovery (f=3) | Risk |
|--------|--------|-------------------|------|
| 0.5s | 0.5s | 2.4s | False timeouts under normal latency (900ms P99) |
| 1.0s | 1.0s | 4.75s | Marginal; may trigger unnecessary view changes at P99 |
| 2.0s | 2.0s | 9.5s | Recommended; 2x headroom over P99 latency |
| 3.0s | 3.0s | 14.25s | Conservative; wastes time on crash recovery |
| 5.0s | 5.0s | 23.75s | Too slow; unnecessary delay on normal operation |

**Recommendation: T_base = 2.0s.** This provides adequate margin for normal network conditions while keeping crash recovery under 12 seconds.

## Appendix B: Comparison of Locking Strategies

Three locking strategies were considered:

**Strategy 1: No locking (unsafe).**
Members can vote freely in every view. This allows the attack in Section 4.1 -- two proposals confirmed in different views. Rejected.

**Strategy 2: Hard lock (Tendermint-style).**
Once a member votes for a proposal P in view v, it is permanently locked on P for this slot. It can only vote for P in subsequent views. This is safe but can cause liveness issues: if the locked proposal's proposer is Byzantine and deliberately withholds the proposal from the new view's proposer, the slot gets stuck.

**Strategy 3: Lock-and-Carry (adopted).**
Members lock on a proposal when they see T votes for it (strong lock) or when they vote for it (weak lock). The ViewChangeRequest carries the lock information. The new proposer must repropose locked proposals. This combines safety (quorum intersection forces reproposal of confirmed proposals) with liveness (the new proposer can always construct a valid reproposal from the carried information).

**Decision: Strategy 3 (Lock-and-Carry).** It provides both safety and liveness under partial synchrony with majority threshold.

## Appendix C: Message Size Estimates

| Message | Estimated Size | Notes |
|---------|---------------|-------|
| ViewChangeRequest | ~256 bytes | Slot, view, sender, reason, signature |
| ViewChangeRequest (with equivocation proof) | ~1024 bytes | Includes two conflicting signed proposals |
| ViewChangeCertificate | ~2048 bytes | T=4 ViewChangeRequests + new proposer signature |
| NewViewProposal | ~4096 bytes | Certificate + slot manifest |
| Slot manifest (typical, 10 messages) | ~2048 bytes | Message hashes + metadata |

Total bandwidth overhead for a single view change: approximately 6-8 KB. For K=7 maximum views per slot, worst case: ~48 KB. This is negligible relative to network bandwidth.

## Appendix D: Simulation Parameters for Future Validation

The view-change protocol should be validated through simulation with the following parameters:

| Parameter | Values to Test |
|-----------|---------------|
| K | {3, 5, 7, 9} |
| f | {0, 1, 2, 3} (for each K) |
| T_base | {1.0, 1.5, 2.0, 3.0} seconds |
| Backoff factor | {1.2, 1.5, 2.0} |
| Network delay (delta) | {100ms, 500ms, 1000ms, 2000ms} |
| Proposer crash probability | {0.01, 0.05, 0.10} |
| Byzantine proposer strategy | {crash, equivocate, delay} |

**Metrics to collect:**
- Confirmation latency per slot (P50, P95, P99)
- View-change frequency
- Empty slot rate
- Throughput (confirmed messages per second)
- Safety violations (should be zero for f < T)

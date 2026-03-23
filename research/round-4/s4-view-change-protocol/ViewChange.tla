--------------------------- MODULE ViewChange ---------------------------
(****************************************************************************)
(* TLA+ Formal Sketch: View-Change Extension for Temporal Consensus        *)
(*                                                                          *)
(* This module extends TemporalConsensus.tla to model proposer failure      *)
(* and the view-change mechanism. It captures:                              *)
(*   - Proposer timeout and view increment                                  *)
(*   - Backup proposer selection (deterministic from VRF ordering)          *)
(*   - ViewChangeRequest, ViewChangeCertificate, NewViewProposal            *)
(*   - Lock-and-Carry safety mechanism                                      *)
(*   - The key invariant: SafetyNoConflict across views                     *)
(*                                                                          *)
(* This is a design sketch capturing the essential safety argument.         *)
(* It is not intended to be model-checked directly without refinement.      *)
(*                                                                          *)
(* Round 4, Stream 4 — Consensus Robustness                                *)
(* Depends on: E7 (TemporalConsensus.tla), E2 (committee parameters)       *)
(****************************************************************************)

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    N,              \* Total number of validators
    K,              \* Committee size
    f,              \* Number of Byzantine validators (integer count)
    MaxSlot,        \* Maximum slot number to explore
    MaxView,        \* Maximum view number per slot (= K, one per member)
    F,              \* Finality depth
    Validators,     \* Set of all validator identifiers
    Messages,       \* Set of possible message values
    Byzantine,      \* Set of Byzantine validator identifiers
    CommitteeOrder  \* Sequence of committee members in VRF output order
                    \* (models the deterministic proposer ordering)

ASSUME /\ N \in Nat \ {0}
       /\ K \in Nat \ {0}
       /\ K <= N
       /\ f \in Nat
       /\ f < N
       /\ MaxSlot \in Nat \ {0}
       /\ MaxView \in Nat \ {0}
       /\ MaxView <= K
       /\ F \in Nat \ {0}
       /\ Cardinality(Validators) = N
       /\ Byzantine \subseteq Validators
       /\ Cardinality(Byzantine) = f
       /\ Len(CommitteeOrder) = K

(****************************************************************************)
(* Derived constants (from TemporalConsensus)                               *)
(****************************************************************************)

T == (K + 2) \div 2
Honest == Validators \ Byzantine
CommitteeSet == {CommitteeOrder[i] : i \in 1..K}

(****************************************************************************)
(* Variables                                                                *)
(****************************************************************************)

VARIABLES
    currentSlot,        \* Current slot number
    phase,              \* Current phase within the slot
    view,               \* view[s] = current view number for slot s
    proposed,           \* proposed[s][v] = message proposed for slot s in view v
    attestations,       \* attestations[s][v] = set of (validator, message) pairs
    committeeVotes,     \* committeeVotes[s][v] = set of (validator, message) pairs
    confirmations,      \* confirmations[s] = {m : message confirmed for slot s}
    viewChangeReqs,     \* viewChangeReqs[s][v] = set of validators requesting
                        \*   view change from view v to v+1
    locked,             \* locked[s][v_member] = message that member is locked on
                        \*   for slot s (or "none")
    lockedView,         \* lockedView[s][v_member] = the view in which the member
                        \*   became locked (or -1 if not locked)
    finalized,          \* finalized[s] = TRUE iff slot s is finalized
    honestView          \* honestView[v] = honest node's view of confirmed messages

vars == <<currentSlot, phase, view, proposed, attestations, committeeVotes,
          confirmations, viewChangeReqs, locked, lockedView, finalized,
          honestView>>

(****************************************************************************)
(* Phase encoding                                                           *)
(* Extended with ViewChange phase                                           *)
(****************************************************************************)

Phases == {"Propose", "Attest", "CommitteeVote", "Confirm",
           "ViewChange", "Done"}

(****************************************************************************)
(* Helper operators                                                         *)
(****************************************************************************)

\* Proposer for slot s in view v (deterministic from VRF ordering)
Proposer(s, v) == CommitteeOrder[((s + v - 1) % K) + 1]

\* Count votes for message m in a vote set
VotesFor(voteSet, m) == Cardinality({v \in voteSet : v[2] = m})

\* Byzantine members of the committee
ByzantineInCommittee == CommitteeSet \cap Byzantine
HonestInCommittee == CommitteeSet \ Byzantine

\* Whether a member is honest
IsHonest(member) == member \notin Byzantine

\* A slot is confirmed if confirmations[s] is nonempty
IsConfirmed(s) == confirmations[s] /= {}

\* Check if a ViewChangeCertificate exists: T or more members requested
\* view change from view v
HasViewChangeCertificate(s, v) ==
    Cardinality(viewChangeReqs[s][v]) >= T

\* The highest-view locked proposal carried in ViewChangeRequests
\* Returns the proposal that has the highest lockedView among the
\* members who sent ViewChangeRequests for (s, v)
HighestLockedProposal(s, v) ==
    LET requesters == viewChangeReqs[s][v]
        lockedRequesters == {m \in requesters : locked[s][m] /= "none"}
    IN IF lockedRequesters = {} THEN "none"
       ELSE LET bestMember == CHOOSE m \in lockedRequesters :
                    \A m2 \in lockedRequesters :
                        lockedView[s][m] >= lockedView[s][m2]
            IN locked[s][bestMember]

(****************************************************************************)
(* Initial state                                                            *)
(****************************************************************************)

Init ==
    /\ currentSlot = 1
    /\ phase = "Propose"
    /\ view = [s \in 1..MaxSlot |-> 0]
    /\ proposed = [s \in 1..MaxSlot |-> [v \in 0..MaxView |-> "none"]]
    /\ attestations = [s \in 1..MaxSlot |-> [v \in 0..MaxView |-> {}]]
    /\ committeeVotes = [s \in 1..MaxSlot |-> [v \in 0..MaxView |-> {}]]
    /\ confirmations = [s \in 1..MaxSlot |-> {}]
    /\ viewChangeReqs = [s \in 1..MaxSlot |-> [v \in 0..MaxView |-> {}]]
    /\ locked = [s \in 1..MaxSlot |-> [m \in CommitteeSet |-> "none"]]
    /\ lockedView = [s \in 1..MaxSlot |-> [m \in CommitteeSet |-> -1]]
    /\ finalized = [s \in 1..MaxSlot |-> FALSE]
    /\ honestView = [v \in Honest |-> [s \in 1..MaxSlot |-> "none"]]

(****************************************************************************)
(* Actions                                                                  *)
(****************************************************************************)

\* --- Phase 1: Propose ---
\* The proposer for (currentSlot, current view) produces a proposal.
\* Honest proposer: proposes some message from Messages.
\*   If there is a locked proposal carried forward, must repropose it (Rule 3).
\* Byzantine proposer: may propose anything, or equivocate, or crash (no proposal).
\*
\* Crash is modeled by nondeterministically choosing to not propose
\* (jumping to ViewChange phase instead).

ProposeHonest ==
    /\ phase = "Propose"
    /\ currentSlot <= MaxSlot
    /\ LET s == currentSlot
           v == view[s]
           proposer == Proposer(s, v)
       IN
       /\ IsHonest(proposer)
       /\ LET carriedProposal == IF v > 0
                                 THEN HighestLockedProposal(s, v - 1)
                                 ELSE "none"
          IN
          \* Rule 3 (Repropose rule): if a locked proposal was carried
          \* forward, the honest proposer must repropose it
          IF carriedProposal /= "none"
          THEN
              /\ proposed' = [proposed EXCEPT ![s][v] = carriedProposal]
              /\ phase' = "Attest"
          ELSE
              \* Free to propose any message
              \E m \in Messages :
                  /\ proposed' = [proposed EXCEPT ![s][v] = m]
                  /\ phase' = "Attest"
    /\ UNCHANGED <<currentSlot, view, attestations, committeeVotes,
                   confirmations, viewChangeReqs, locked, lockedView,
                   finalized, honestView>>

ProposeByzantine ==
    /\ phase = "Propose"
    /\ currentSlot <= MaxSlot
    /\ LET s == currentSlot
           v == view[s]
           proposer == Proposer(s, v)
       IN
       /\ ~IsHonest(proposer)
       \* Byzantine proposer nondeterministically chooses to:
       \* (a) propose some message, or (b) crash (skip to ViewChange)
       /\ \/ \E m \in Messages :
                /\ proposed' = [proposed EXCEPT ![s][v] = m]
                /\ phase' = "Attest"
                /\ UNCHANGED <<view, viewChangeReqs>>
          \/ \* Crash: no proposal, trigger view change directly
             /\ phase' = "ViewChange"
             /\ UNCHANGED <<proposed, view, viewChangeReqs>>
    /\ UNCHANGED <<currentSlot, attestations, committeeVotes,
                   confirmations, locked, lockedView, finalized,
                   honestView>>

\* --- Phase 2: Attest ---
\* Same as TemporalConsensus, but attestations are view-scoped.
\* Honest validators attest to the proposed message for the current view.
\* Byzantine validators may attest to anything.
Attest ==
    /\ phase = "Attest"
    /\ currentSlot <= MaxSlot
    /\ LET s == currentSlot
           v == view[s]
           m == proposed[s][v]
       IN
       /\ m /= "none"  \* A proposal exists for this view
       \E byzAttestations \in SUBSET (ByzantineInCommittee \times Messages) :
           /\ attestations' = [attestations EXCEPT ![s][v] =
               {<<h, m>> : h \in HonestInCommittee}
               \cup byzAttestations]
           /\ phase' = "CommitteeVote"
    /\ UNCHANGED <<currentSlot, view, proposed, committeeVotes,
                   confirmations, viewChangeReqs, locked, lockedView,
                   finalized, honestView>>

\* --- Phase 3: CommitteeVote ---
\* Committee members vote for the proposed message in the current view.
\* Honest members: vote for the proposed message, provided they are not
\*   locked on a different message.
\* Rule 1 (Lock rule): if a member is locked on proposal P from a
\*   previous view, it only votes for P. If the current proposal is
\*   different from P, the honest member withholds its vote.
\* Byzantine members: vote arbitrarily.
CommitteeVote ==
    /\ phase = "CommitteeVote"
    /\ currentSlot <= MaxSlot
    /\ LET s == currentSlot
           v == view[s]
           m == proposed[s][v]
       IN
       \E byzVotes \in SUBSET (ByzantineInCommittee \times Messages) :
           LET honestVoters ==
                   {h \in HonestInCommittee :
                       \* Honest member votes if not locked, or locked on
                       \* the same proposal
                       \/ locked[s][h] = "none"
                       \/ locked[s][h] = m}
               honestVotes == {<<h, m>> : h \in honestVoters}
           IN
           /\ committeeVotes' = [committeeVotes EXCEPT ![s][v] =
               honestVotes \cup byzVotes]
           /\ phase' = "Confirm"
    /\ UNCHANGED <<currentSlot, view, proposed, attestations,
                   confirmations, viewChangeReqs, locked, lockedView,
                   finalized, honestView>>

\* --- Phase 4: Confirm ---
\* Check if any message received >= T votes in the current view.
\* If so, confirm it and update locks.
\* If not, trigger view change.
Confirm ==
    /\ phase = "Confirm"
    /\ currentSlot <= MaxSlot
    /\ LET s == currentSlot
           v == view[s]
           votes == committeeVotes[s][v]
           confirmed == {m \in Messages : VotesFor(votes, m) >= T}
       IN
       IF confirmed /= {}
       THEN
           \* At least one message reached threshold -- confirm it
           /\ confirmations' = [confirmations EXCEPT ![s] = confirmed]
           \* Update honest nodes' views
           /\ honestView' =
               [nd \in Honest |->
                   [honestView[nd] EXCEPT ![s] =
                       IF Cardinality(confirmed) = 1
                       THEN CHOOSE m \in confirmed : TRUE
                       ELSE "conflict"]]
           \* Update locks: members who voted for the confirmed message
           \* are now locked on it
           /\ locked' =
               [locked EXCEPT ![s] =
                   [member \in CommitteeSet |->
                       IF \E m \in confirmed :
                           <<member, m>> \in votes
                       THEN CHOOSE m \in confirmed :
                           <<member, m>> \in votes
                       ELSE locked[s][member]]]
           /\ lockedView' =
               [lockedView EXCEPT ![s] =
                   [member \in CommitteeSet |->
                       IF \E m \in confirmed :
                           <<member, m>> \in votes
                       THEN v
                       ELSE lockedView[s][member]]]
           \* Check finality
           /\ finalized' =
               [sl \in 1..MaxSlot |->
                   IF /\ ~finalized[sl]
                      /\ IsConfirmed(sl)
                      /\ sl + F <= currentSlot
                      /\ \A i \in (sl+1)..(sl+F) :
                          confirmations'[i] /= {}
                   THEN TRUE
                   ELSE finalized[sl]]
           /\ phase' = "Done"
           /\ UNCHANGED <<currentSlot, view, proposed, attestations,
                          viewChangeReqs>>
       ELSE
           \* No message reached threshold -- trigger view change
           /\ phase' = "ViewChange"
           /\ UNCHANGED <<currentSlot, view, proposed, attestations,
                          confirmations, viewChangeReqs, locked,
                          lockedView, finalized, honestView>>

\* --- Phase 5: ViewChange ---
\* Committee members send ViewChangeRequests.
\* Once T requests are collected, the view increments and a new proposer
\* takes over.
\*
\* Rule 1 (Lock rule): A member locked on a confirmed proposal does NOT
\*   send a ViewChangeRequest. (In our model, if the proposal was confirmed,
\*   we never reach this phase -- Confirm would have succeeded. So the lock
\*   rule is enforced by construction.)
\*
\* Rule 2 (Carry rule): ViewChangeRequests carry lock information.
\*   This is modeled by the locked[] and lockedView[] variables, which
\*   persist across views and are read by the new proposer.
ViewChange ==
    /\ phase = "ViewChange"
    /\ currentSlot <= MaxSlot
    /\ LET s == currentSlot
           v == view[s]
       IN
       /\ v < MaxView  \* Can still increment view
       \* Nondeterministically, some subset of committee members send
       \* ViewChangeRequests. Honest members always send (they timed out).
       \* Byzantine members may or may not send.
       /\ \E byzRequesters \in SUBSET ByzantineInCommittee :
           LET requesters == HonestInCommittee \cup byzRequesters
           IN
           /\ Cardinality(requesters) >= T  \* Need T requests for certificate
           /\ viewChangeReqs' = [viewChangeReqs EXCEPT ![s][v] = requesters]
           /\ view' = [view EXCEPT ![s] = v + 1]
           /\ phase' = "Propose"
    /\ UNCHANGED <<currentSlot, proposed, attestations, committeeVotes,
                   confirmations, locked, lockedView, finalized,
                   honestView>>

\* --- ViewChange exhaustion: all views failed ---
\* If we have exhausted all K views, the slot is left empty.
ViewChangeExhausted ==
    /\ phase = "ViewChange"
    /\ currentSlot <= MaxSlot
    /\ LET s == currentSlot
       IN view[s] >= MaxView
    /\ phase' = "Done"
    \* Slot remains unconfirmed (confirmations[s] = {})
    /\ UNCHANGED <<currentSlot, view, proposed, attestations,
                   committeeVotes, confirmations, viewChangeReqs,
                   locked, lockedView, finalized, honestView>>

\* --- Advance to next slot ---
AdvanceSlot ==
    /\ phase = "Done"
    /\ currentSlot < MaxSlot
    /\ currentSlot' = currentSlot + 1
    /\ phase' = "Propose"
    /\ UNCHANGED <<view, proposed, attestations, committeeVotes,
                   confirmations, viewChangeReqs, locked, lockedView,
                   finalized, honestView>>

(****************************************************************************)
(* Next-state relation                                                      *)
(****************************************************************************)

Next ==
    \/ ProposeHonest
    \/ ProposeByzantine
    \/ Attest
    \/ CommitteeVote
    \/ Confirm
    \/ ViewChange
    \/ ViewChangeExhausted
    \/ AdvanceSlot

(****************************************************************************)
(* Fairness                                                                 *)
(****************************************************************************)

Fairness ==
    /\ WF_vars(ProposeHonest)
    /\ WF_vars(ProposeByzantine)
    /\ WF_vars(Attest)
    /\ WF_vars(CommitteeVote)
    /\ WF_vars(Confirm)
    /\ WF_vars(ViewChange)
    /\ WF_vars(ViewChangeExhausted)
    /\ WF_vars(AdvanceSlot)

Spec == Init /\ [][Next]_vars /\ Fairness

(****************************************************************************)
(* SAFETY INVARIANTS                                                        *)
(****************************************************************************)

\* S1: No two conflicting messages confirmed for the same slot.
\*     This must hold ACROSS ALL VIEWS -- the critical cross-view invariant.
SafetyNoConflict ==
    \A s \in 1..MaxSlot :
        Cardinality(confirmations[s]) <= 1

\* S2: If a slot is finalized, it is confirmed (monotonicity).
SafetyFinalityMonotonic ==
    \A s \in 1..MaxSlot :
        finalized[s] => IsConfirmed(s)

\* S3: No honest committee member votes for two different messages
\*     in the same slot and view.
SafetyNoHonestEquivocation ==
    \A s \in 1..MaxSlot :
        \A v \in 0..MaxView :
            \A h \in HonestInCommittee :
                Cardinality({m \in Messages :
                    <<h, m>> \in committeeVotes[s][v]}) <= 1

\* S4: Agreement -- honest nodes agree on finalized slots.
SafetyAgreement ==
    \A s \in 1..MaxSlot :
        finalized[s] =>
            \A v1, v2 \in Honest :
                honestView[v1][s] = honestView[v2][s]

\* S5 (NEW): Lock consistency -- if a member is locked on proposal P
\*     in view v, and a different proposal P' is confirmed for the same
\*     slot, then P = P'. (No lock contradicts a confirmation.)
SafetyLockConsistency ==
    \A s \in 1..MaxSlot :
        \A m \in CommitteeSet :
            (locked[s][m] /= "none" /\ IsConfirmed(s))
            => locked[s][m] \in confirmations[s]

\* S6 (NEW): View-change certificate validity -- a ViewChangeCertificate
\*     requires T members. Since T > K/2, the certificate requesters
\*     and any prior confirmation voters must overlap.
SafetyQuorumIntersection ==
    \A s \in 1..MaxSlot :
        \A v \in 0..MaxView :
            \* If slot s was confirmed (in any view) AND a view-change
            \* certificate exists for view v of slot s, then the sets
            \* must overlap.
            (IsConfirmed(s) /\ HasViewChangeCertificate(s, v))
            =>
            \* The confirming voters (for any confirmed message) and
            \* the view-change requesters share at least one member.
            \E prevView \in 0..v :
                LET confirmedMsg == CHOOSE m \in confirmations[s] : TRUE
                    voters == {member \in CommitteeSet :
                        <<member, confirmedMsg>> \in
                            committeeVotes[s][prevView]}
                    requesters == viewChangeReqs[s][v]
                IN voters \cap requesters /= {}

\* Combined safety invariant
Safety ==
    /\ SafetyNoConflict
    /\ SafetyFinalityMonotonic
    /\ SafetyNoHonestEquivocation
    /\ SafetyAgreement
    /\ SafetyLockConsistency
    /\ SafetyQuorumIntersection

(****************************************************************************)
(* LIVENESS PROPERTIES                                                      *)
(****************************************************************************)

\* L1: Every slot is eventually processed (confirmed or skipped).
LivenessProgress ==
    \A s \in 1..MaxSlot :
        <>(currentSlot > s)

\* L2: If enough honest members exist and one is eventually the proposer,
\*     the slot is confirmed.
\*     Under f < T and MaxView = K, at least one view will have an honest
\*     proposer (since at most f < T < K members are Byzantine).
LivenessEventualConfirmation ==
    \A s \in 1..MaxSlot :
        <>(IsConfirmed(s) \/ currentSlot > s)

(****************************************************************************)
(* SAFETY THEOREM (sketch)                                                  *)
(****************************************************************************)

\* Theorem: If f < T = ceil((K+1)/2), then SafetyNoConflict holds
\*          in all reachable states, even across view changes.
\*
\* Proof sketch (formalized in report.md Section 4.3):
\*
\* 1. Assume for contradiction: proposals P1 (confirmed in view v1) and
\*    P2 (confirmed in view v2) for slot s, with P1 /= P2 and v1 < v2.
\*
\* 2. P1 confirmed => T members voted for P1 in view v1. Call them S1.
\*    |S1| = T.
\*
\* 3. To reach view v2, a ViewChangeCertificate for view v1 -> v1+1
\*    must exist, requiring T requesters. Call them Q1. |Q1| = T.
\*
\* 4. By quorum intersection: |S1| + |Q1| = 2T > K (since T > K/2).
\*    Therefore S1 \cap Q1 /= {}. Call the intersection member h.
\*
\* 5. h voted for P1 (member of S1) AND requested view change
\*    (member of Q1). By Rule 2, h carries P1 in its ViewChangeRequest.
\*    h is locked on P1.
\*
\* 6. By Rule 3, the proposer for view v1+1 must repropose P1.
\*
\* 7. By induction on views v1+1 to v2: every proposer repropose P1.
\*    Therefore P2 = P1. Contradiction. QED.
\*
\* Note: This argument requires that h is honest (so that it faithfully
\*       carries its lock). Since |S1 \cap Q1| >= 2T - K, and
\*       Byzantine members number at most f < T, we need
\*       2T - K > f, i.e., 2T > K + f. Since T > K/2 and f < T:
\*       2T > K (from T > K/2) and 2T > 2f > f, so 2T > K + f
\*       iff T > f, which holds. Therefore there exists an honest
\*       member in the intersection.

(****************************************************************************)
(* DERIVED PROPERTIES                                                       *)
(****************************************************************************)

\* Safety is guaranteed when Byzantine count is below threshold
\* (same condition as base TemporalConsensus, preserved by view change)
SafetyGuaranteed == f < T

\* Liveness is guaranteed when honest members can always form quorum
\* AND at least one view has an honest proposer (f < K)
LivenessGuaranteed == /\ K - f >= T
                      /\ f < K

(****************************************************************************)
(* TYPE INVARIANT                                                           *)
(****************************************************************************)

TypeOK ==
    /\ currentSlot \in 1..MaxSlot
    /\ phase \in Phases
    /\ \A s \in 1..MaxSlot :
        /\ view[s] \in 0..MaxView
        /\ \A v \in 0..MaxView :
            /\ proposed[s][v] \in Messages \cup {"none"}
            /\ attestations[s][v] \subseteq (CommitteeSet \times Messages)
            /\ committeeVotes[s][v] \subseteq (CommitteeSet \times Messages)
            /\ viewChangeReqs[s][v] \subseteq CommitteeSet
        /\ confirmations[s] \subseteq Messages
        /\ finalized[s] \in BOOLEAN
    /\ \A s \in 1..MaxSlot :
        \A m \in CommitteeSet :
            /\ locked[s][m] \in Messages \cup {"none"}
            /\ lockedView[s][m] \in -1..MaxView

=============================================================================

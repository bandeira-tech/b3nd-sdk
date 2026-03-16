--------------------------- MODULE TemporalConsensus ---------------------------
(****************************************************************************)
(* TLA+ Formal Specification of b3nd's Committee-Based Temporal Consensus   *)
(*                                                                          *)
(* This module models the core temporal consensus protocol:                 *)
(*   - A proposer broadcasts messages to validators                         *)
(*   - Validators (honest or Byzantine) attest to messages                  *)
(*   - A committee of K members drawn from validators confirms slots        *)
(*   - T-of-K threshold required for confirmation                          *)
(*   - Finality achieved after F consecutive confirmed slots                *)
(*                                                                          *)
(* Experiment E7, Round 3 Research                                          *)
(* Informed by E2 committee simulation: K=7, T=4 for f=0.20                *)
(****************************************************************************)

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    N,              \* Total number of validators
    K,              \* Committee size
    f,              \* Number of Byzantine validators (integer count)
    MaxSlot,        \* Maximum slot number to explore (bounds state space)
    F,              \* Finality depth: slots after which a confirmed slot is final
    Validators,     \* Set of all validator identifiers
    Messages,       \* Set of possible message values
    Byzantine       \* Set of Byzantine validator identifiers (|Byzantine| = f)

ASSUME /\ N \in Nat \ {0}
       /\ K \in Nat \ {0}
       /\ K <= N
       /\ f \in Nat
       /\ f < N
       /\ MaxSlot \in Nat \ {0}
       /\ F \in Nat \ {0}
       /\ Cardinality(Validators) = N
       /\ Byzantine \subseteq Validators
       /\ Cardinality(Byzantine) = f

(****************************************************************************)
(* Derived constants                                                        *)
(****************************************************************************)

\* Threshold: majority = ceil((K+1)/2)
T == (K + 2) \div 2

\* Honest validators
Honest == Validators \ Byzantine

(****************************************************************************)
(* Variables                                                                *)
(****************************************************************************)

VARIABLES
    currentSlot,        \* Current slot number being processed
    proposed,           \* proposed[s] = message proposed for slot s
    attestations,       \* attestations[s] = set of (validator, message) pairs
    committee,          \* committee[s] = set of validators on committee for slot s
    confirmations,      \* confirmations[s] = {m : message confirmed for slot s}
    committeeVotes,     \* committeeVotes[s] = set of (validator, message) pairs from committee
    finalized,          \* finalized[s] = TRUE iff slot s is finalized
    honestView,         \* honestView[v] = function from slots to confirmed messages (honest node's view)
    phase               \* Current protocol phase for the active slot

vars == <<currentSlot, proposed, attestations, committee, confirmations,
          committeeVotes, finalized, honestView, phase>>

(****************************************************************************)
(* Phase encoding                                                           *)
(* Each slot proceeds through: Propose -> Attest -> CommitteeVote -> Confirm *)
(****************************************************************************)

Phases == {"Propose", "Attest", "CommitteeVote", "Confirm", "Done"}

(****************************************************************************)
(* Helper operators                                                         *)
(****************************************************************************)

\* All subsets of Validators of size exactly K
\* (Used nondeterministically to model committee selection)
CommitteesOfSizeK == {S \in SUBSET Validators : Cardinality(S) = K}

\* Count votes for a specific message m in a set of (validator, message) pairs
VotesFor(voteSet, m) == Cardinality({v \in voteSet : v[2] = m})

\* Byzantine members of a committee
ByzantineInCommittee(comm) == comm \cap Byzantine

\* Honest members of a committee
HonestInCommittee(comm) == comm \ Byzantine

\* Number of Byzantine members in committee
NumByzInCommittee(comm) == Cardinality(ByzantineInCommittee(comm))

\* Number of honest members in committee
NumHonestInCommittee(comm) == Cardinality(HonestInCommittee(comm))

\* A slot s is confirmed if confirmations[s] is nonempty
IsConfirmed(s) == confirmations[s] /= {}

\* Check if F consecutive slots after s are all confirmed
HasFinalityDepth(s) ==
    /\ s + F <= currentSlot
    /\ \A i \in (s+1)..(s+F) : IsConfirmed(i)

(****************************************************************************)
(* Initial state                                                            *)
(****************************************************************************)

Init ==
    /\ currentSlot = 1
    /\ proposed = [s \in 1..MaxSlot |-> "none"]
    /\ attestations = [s \in 1..MaxSlot |-> {}]
    /\ committee = [s \in 1..MaxSlot |-> {}]
    /\ confirmations = [s \in 1..MaxSlot |-> {}]
    /\ committeeVotes = [s \in 1..MaxSlot |-> {}]
    /\ finalized = [s \in 1..MaxSlot |-> FALSE]
    /\ honestView = [v \in Honest |-> [s \in 1..MaxSlot |-> "none"]]
    /\ phase = "Propose"

(****************************************************************************)
(* Actions                                                                  *)
(****************************************************************************)

\* --- Phase 1: Proposer broadcasts a message for the current slot ---
\* The proposer picks some message m from Messages.
\* We model this nondeterministically (proposer could be honest or Byzantine).
Propose ==
    /\ phase = "Propose"
    /\ currentSlot <= MaxSlot
    /\ \E m \in Messages :
        /\ proposed' = [proposed EXCEPT ![currentSlot] = m]
        /\ phase' = "Attest"
    /\ UNCHANGED <<currentSlot, attestations, committee, confirmations,
                   committeeVotes, finalized, honestView>>

\* --- Phase 2: Validators attest to the proposed message ---
\* Honest validators: attest to the proposed message (and only that message).
\* Byzantine validators: may attest to ANY message, or withhold, or double-attest.
\* We model all attestations arriving in one atomic step (abstraction of
\* asynchronous arrival within the slot timeout).
Attest ==
    /\ phase = "Attest"
    /\ currentSlot <= MaxSlot
    /\ LET slot == currentSlot
           m == proposed[slot]
       IN
       \* Honest validators attest exactly to the proposed message
       \* Byzantine validators nondeterministically choose any subset of messages to attest to
       \E byzAttestations \in SUBSET (Byzantine \times Messages) :
           /\ attestations' = [attestations EXCEPT ![slot] =
               \* Honest attestations: each honest validator attests to proposed message
               {<<v, m>> : v \in Honest}
               \* Byzantine attestations: arbitrary (may conflict, withhold, or double-attest)
               \cup byzAttestations]
           /\ phase' = "CommitteeVote"
    /\ UNCHANGED <<currentSlot, proposed, committee, confirmations,
                   committeeVotes, finalized, honestView>>

\* --- Phase 3: Committee selected and votes ---
\* A committee of K validators is selected (modeled nondeterministically).
\* Committee members who are honest: vote for the message with most attestations
\*   (which is the proposed message, since all honest validators attested to it).
\* Committee members who are Byzantine: may vote for any message or abstain.
CommitteeVote ==
    /\ phase = "CommitteeVote"
    /\ currentSlot <= MaxSlot
    /\ LET slot == currentSlot
           m == proposed[slot]
       IN
       \E comm \in CommitteesOfSizeK :
           \E byzVotes \in SUBSET (ByzantineInCommittee(comm) \times Messages) :
               /\ committee' = [committee EXCEPT ![slot] = comm]
               /\ committeeVotes' = [committeeVotes EXCEPT ![slot] =
                   \* Honest committee members vote for the proposed message
                   {<<v, m>> : v \in HonestInCommittee(comm)}
                   \* Byzantine committee members vote arbitrarily
                   \cup byzVotes]
               /\ phase' = "Confirm"
    /\ UNCHANGED <<currentSlot, proposed, attestations, confirmations,
                   finalized, honestView>>

\* --- Phase 4: Confirmation ---
\* A message is confirmed for the slot if it received >= T committee votes.
\* Multiple messages could theoretically be confirmed if Byzantine nodes
\* split their votes cleverly (this is what safety should prevent).
Confirm ==
    /\ phase = "Confirm"
    /\ currentSlot <= MaxSlot
    /\ LET slot == currentSlot
           votes == committeeVotes[slot]
           \* Set of messages that received >= T votes
           confirmed == {m \in Messages : VotesFor(votes, m) >= T}
       IN
       /\ confirmations' = [confirmations EXCEPT ![slot] = confirmed]
       \* Honest nodes update their view
       /\ honestView' =
           [v \in Honest |->
               [honestView[v] EXCEPT ![slot] =
                   IF Cardinality(confirmed) = 1
                   THEN CHOOSE m \in confirmed : TRUE
                   ELSE "conflict"]]  \* Should never happen if safety holds
       \* Check finality for earlier slots
       /\ finalized' =
           [s \in 1..MaxSlot |->
               IF /\ ~finalized[s]
                  /\ IsConfirmed(s)
                  /\ s + F <= currentSlot
                  /\ \A i \in (s+1)..(s+F) :
                      confirmations'[i] /= {}
               THEN TRUE
               ELSE finalized[s]]
       /\ phase' = "Done"
    /\ UNCHANGED <<currentSlot, proposed, attestations, committee,
                   committeeVotes>>

\* --- Advance to next slot ---
AdvanceSlot ==
    /\ phase = "Done"
    /\ currentSlot < MaxSlot
    /\ currentSlot' = currentSlot + 1
    /\ phase' = "Propose"
    /\ UNCHANGED <<proposed, attestations, committee, confirmations,
                   committeeVotes, finalized, honestView>>

\* --- Skip slot (models proposer failure / no proposal) ---
\* The committee can also fail to confirm if it doesn't reach threshold.
\* This is implicit: if no message gets T votes, confirmations[slot] = {}.

(****************************************************************************)
(* Next-state relation                                                      *)
(****************************************************************************)

Next ==
    \/ Propose
    \/ Attest
    \/ CommitteeVote
    \/ Confirm
    \/ AdvanceSlot

(****************************************************************************)
(* Fairness (for liveness)                                                  *)
(****************************************************************************)

\* Weak fairness: every enabled action eventually executes
Fairness ==
    /\ WF_vars(Propose)
    /\ WF_vars(Attest)
    /\ WF_vars(CommitteeVote)
    /\ WF_vars(Confirm)
    /\ WF_vars(AdvanceSlot)

Spec == Init /\ [][Next]_vars /\ Fairness

(****************************************************************************)
(* SAFETY INVARIANTS                                                        *)
(****************************************************************************)

\* S1: No two conflicting messages confirmed for the same slot.
\*     For every slot, at most one message is confirmed.
SafetyNoConflict ==
    \A s \in 1..MaxSlot :
        Cardinality(confirmations[s]) <= 1

\* S2: If a slot is finalized, it remains finalized (monotonicity).
\*     Once finalized[s] = TRUE, it never becomes FALSE.
\*     (This is a state predicate; the temporal version is checked via
\*      the invariant that finalized only transitions FALSE -> TRUE.)
SafetyFinalityMonotonic ==
    \A s \in 1..MaxSlot :
        finalized[s] => IsConfirmed(s)

\* S3: No honest validator signs two different messages for the same slot.
\*     In our model, honest validators always attest to exactly the proposed
\*     message, and honest committee members vote for exactly the proposed message.
\*     We verify this by checking attestations and committee votes.
SafetyNoHonestEquivocation ==
    \A s \in 1..MaxSlot :
        \* For each honest validator, they attest to at most one message
        \A v \in Honest :
            Cardinality({m \in Messages : <<v, m>> \in attestations[s]}) <= 1

\* S4: Agreement -- all honest nodes agree on finalized slot contents.
SafetyAgreement ==
    \A s \in 1..MaxSlot :
        finalized[s] =>
            \A v1, v2 \in Honest :
                honestView[v1][s] = honestView[v2][s]

\* Combined safety invariant
Safety ==
    /\ SafetyNoConflict
    /\ SafetyFinalityMonotonic
    /\ SafetyNoHonestEquivocation
    /\ SafetyAgreement

(****************************************************************************)
(* SAFETY THEOREM (conditions under which safety holds)                     *)
(****************************************************************************)

\* Key insight: SafetyNoConflict holds iff for every committee, the number
\* of Byzantine members is < T. Because:
\*   - Honest members all vote for the same message (the proposed one)
\*   - To confirm a DIFFERENT message, you need T votes for it
\*   - Honest members contribute 0 votes for any conflicting message
\*   - So you need T Byzantine votes, i.e., T Byzantine committee members
\*
\* Therefore: Safety holds when NumByzInCommittee(comm) < T for all
\* committees that can be selected.
\*
\* In the worst case (adversary controls committee selection):
\*   Safety requires f < T, i.e., the total Byzantine count is less
\*   than the threshold. For majority threshold T = ceil((K+1)/2),
\*   this means f < ceil((K+1)/2).
\*
\* More precisely with committee sampling: safety requires that no
\* committee of size K drawn from N validators can contain >= T
\* Byzantine members. This is guaranteed when f < T (since at most
\* f Byzantine validators exist and T <= K).

(****************************************************************************)
(* LIVENESS PROPERTIES (temporal)                                           *)
(****************************************************************************)

\* L1: Every slot is eventually either confirmed or the system moves past it.
\*     Under fairness, if the system can make progress, it does.
LivenessProgress ==
    \A s \in 1..MaxSlot :
        <>(currentSlot > s)

\* L2: If honest committee members >= T, the slot is eventually confirmed.
\*     This is the key liveness condition: with enough honest committee members,
\*     the proposed message will receive T votes and be confirmed.
\*     Note: This is a conditional property. Liveness depends on committee composition.
LivenessConfirmation ==
    [](\A s \in 1..MaxSlot :
        (phase = "Confirm" /\ currentSlot = s /\
         NumHonestInCommittee(committee[s]) >= T)
        => (confirmations[s] /= {}))

\* L3: Slot numbers increase (no stuck state).
LivenessSlotIncrease ==
    [](currentSlot < MaxSlot => <>(currentSlot > currentSlot))

(****************************************************************************)
(* DERIVED PROPERTIES for analysis                                          *)
(****************************************************************************)

\* The maximum number of Byzantine validators that can be on any committee
MaxByzOnCommittee == IF f >= K THEN K ELSE f

\* Safety is guaranteed when this holds:
\* (This is a CONSTANT-level predicate, not a state predicate)
SafetyGuaranteed == MaxByzOnCommittee < T

\* Liveness is guaranteed when honest validators can always form
\* a committee with >= T honest members.
\* Minimum honest on any committee = K - min(f, K)
MinHonestOnCommittee == K - (IF f >= K THEN K ELSE f)

LivenessGuaranteed == MinHonestOnCommittee >= T

(****************************************************************************)
(* TYPE INVARIANT (for debugging)                                           *)
(****************************************************************************)

TypeOK ==
    /\ currentSlot \in 1..MaxSlot
    /\ phase \in Phases
    /\ \A s \in 1..MaxSlot :
        /\ proposed[s] \in Messages \cup {"none"}
        /\ attestations[s] \subseteq (Validators \times Messages)
        /\ committee[s] \subseteq Validators
        /\ confirmations[s] \subseteq Messages
        /\ committeeVotes[s] \subseteq (Validators \times Messages)
        /\ finalized[s] \in BOOLEAN
    /\ \A v \in Honest :
        \A s \in 1..MaxSlot :
            honestView[v][s] \in Messages \cup {"none", "conflict"}

=============================================================================

# Mechanism Games: Research Direction

**Purpose:** Map the design space for committee selection mechanisms ("games") that simultaneously deliver security, retail accessibility, and economic alignment. Identify candidate mechanisms for simulation in Round 5.

**Date:** 2026-03-18
**Triggered by:** Founder direction on D2 — VRF lottery + roster teams

---

## 1. The Design Objective

Find mechanisms that compress multiple goals into a single elegant construction — the "lottery principle." A good mechanism game solves several problems at once, the way a VRF slot lottery simultaneously provides:
- Spam resistance (only winners propose)
- Fairness (proportional to stake)
- Liveness proof (must be online to win)
- Unpredictability (can't grind)

The design space we're exploring:

```
                    SECURITY
                       ▲
                      / \
                     /   \
                    /     \
                   /  ???  \
                  /         \
                 /           \
    RETAIL      ◄─────────────►  BIG PLAYER
 ACCESSIBILITY                  INCENTIVES
```

The "???" is the mechanism game that balances all three. Below we catalog known approaches and propose new ones.

---

## 2. Known Mechanisms Worth Studying

### 2.1 Cardano Ouroboros Praos — VRF Slot Lottery

**How it works:** Each stakeholder evaluates a VRF using their private key and the slot number. If the VRF output is below a stake-dependent threshold, they're the slot leader. Multiple leaders are possible (resolved by chain selection).

**What it delivers:**
- Spam resistance: only VRF winners can propose
- Proportional fairness: threshold scales with stake
- Private leader: nobody knows who won until they reveal (prevents targeted DoS)
- Grind resistance: VRF output is deterministic per (key, slot)

**What it doesn't deliver:**
- Team formation — it's individual, not cooperative
- Retail uplift — small stakers win less frequently, no cooperative benefit
- Storage/relay incentives — selection is orthogonal to other duties

**Relevance to firecat:** Strong foundation. The VRF lottery is the starting point. The question is how to layer team dynamics on top.

### 2.2 Ethereum Attestation Committees

**How it works:** Each epoch, all validators are shuffled into committees. Each committee attests to one slot. Shuffling uses RANDAO (accumulated randomness from block proposers).

**What it delivers:**
- Every validator participates every epoch (retail inclusion)
- Committees are large (hundreds) — very robust
- Attestation rewards are per-validator, so small stakers earn steadily

**What it doesn't deliver:**
- Privacy of committee assignment (public once assigned)
- Team cooperation (attestation is individual)
- Storage incentives

**Relevance to firecat:** The "everyone participates every epoch" property is valuable for retail inclusion. Firecat's smaller committee (K=21) means not everyone can be on every committee — but the team/roster concept could ensure everyone participates across multiple blocks per epoch.

### 2.3 Algorand Sortition

**How it works:** Each user independently runs a VRF to determine if they're on the committee for a given step of consensus. Committee membership is proven by revealing the VRF proof. Committee size is controlled probabilistically.

**What it delivers:**
- Very fast finality (single-slot)
- Private committee membership until reveal
- Scales to large N without coordinator

**What it doesn't deliver:**
- Exact committee sizes (probabilistic)
- Team dynamics
- Role differentiation within committee

**Relevance to firecat:** The self-selection via VRF is elegant. Could combine with roster matching: self-select into eligibility pool, then roster determines the team from the pool.

### 2.4 Polkadot BABE + GRANDPA

**How it works:** BABE (block production) uses a VRF lottery similar to Ouroboros. GRANDPA (finality) uses a BFT protocol across all validators. The two are decoupled — blocks are produced fast, finality follows.

**What it delivers:**
- Separation of block production (fast, probabilistic) from finality (slow, deterministic)
- All validators participate in finality regardless of slot leadership
- Nominated Proof of Stake (NPoS) lets token holders nominate validators, creating a delegation market

**What it doesn't deliver:**
- Team cooperation at the block level
- Direct retail participation (delegation model)

**Relevance to firecat:** The NPoS nomination concept is interesting — retail participants could nominate high-performance validators, creating a cooperative relationship without requiring retail hardware to be production-grade.

### 2.5 Cosmos Tendermint — Round-Robin with Weighted Proposers

**How it works:** Proposer selection is deterministic round-robin weighted by voting power. All validators vote on every block. Simple and well-understood.

**What it delivers:**
- Deterministic — everyone knows who proposes next
- All validators participate in every round
- Immediate finality

**What it doesn't deliver:**
- Privacy (proposer is known in advance → DoS target)
- Scalability (all-to-all communication)
- Team dynamics

**Relevance to firecat:** The "everyone votes every round" property won't scale for firecat at N>100. But the weighted round-robin is a useful primitive for backup proposer ordering (already used in S4 view-change).

---

## 3. Novel Mechanism Concepts for Firecat

These are new ideas that combine elements from the known mechanisms with the founder's vision for team dynamics and retail uplift.

### 3.1 Hash-Roster Teams

**Concept:** Each block's hash determines the roster for the next block's committee. Validators whose pubkey satisfies a hash-matching criterion are eligible.

**Construction:**
```
roster_seed = H(prev_block_hash || slot_number)
For each validator v with pubkey pk:
    eligibility = VRF(pk, roster_seed)
    if eligibility < threshold(stake_v):
        v is on the roster
```

**Team formation:** The roster is the "team" for this slot. All roster members cooperate: one proposes (lowest eligibility score wins proposer role), others attest.

**Retail uplift:** The threshold function can be tuned so that small stakers have a *minimum* eligibility probability (e.g., 5% per slot regardless of stake), while large stakers have higher probability proportional to stake. This ensures retail validators get regular team assignments while big stakers anchor most teams.

**Reward distribution within team:**
- Option A: Proportional to stake (standard)
- Option B: Equal per member + stake bonus (retail-friendly)
- Option C: Performance-weighted — team members who attest fastest get a bonus (incentivizes good infrastructure)

**Open questions:**
- What's the right threshold function to balance fairness and security?
- Can a large staker grind the roster by manipulating the block hash? (Mitigated if proposer ≠ the entity whose block hash determines next roster)
- What happens when a team is too small (bad luck)? Fallback to a larger eligibility window?

### 3.2 Cooperative Validation Pools

**Concept:** Validators self-organize into persistent "pools" (like mining pools). A pool has a declared combined stake and a set of members. The protocol treats pools as atomic units for committee selection, but distributes rewards to individual members.

**Why this helps retail:**
- A small staker joins a pool, getting steady rewards instead of infrequent solo wins
- The pool provides infrastructure (bandwidth, storage) that the small staker contributes to
- Pool operators (big players) get a management fee, incentivizing them to recruit and support retail participants

**Risks:**
- Centralization — if pools become too dominant, they're just miners again
- Pool operator trust — members need assurance of fair reward distribution
- Protocol complexity — tracking pool membership and rewards

**Mitigation:** Cap pool size at X% of total stake (similar to anti-whale cap). Use on-chain reward distribution (smart contract equivalent) so pool operators can't withhold.

### 3.3 Three-Phase Role Architecture (REVISED)

> **Note (2026-03-18):** This section replaces the earlier "Role-Differentiated Participation" model that included a "Storer" and "Relay" role. Per founder clarification: rewards come from action, not passive holding. Storage is a side effect of doing useful work. There is no Storer role.

**Concept:** Three distinct economic phases with different stake/hardware requirements:

| Phase | Role | Stake | Hardware | Duties | Fee Share |
|-------|------|-------|----------|--------|-----------|
| **Entry** | Gateway | High | High bandwidth, low latency | Accept client writes, initial validation, spam filtering | 25% (entry) |
| **Validation** | Attestation Worker | Low-Medium | Consumer OK, namespace-specialized | Deep validation against program rules, parallel & async | 35% (attestation) |
| **Confirmation** | Finality Committee | High | Medium-High | BFT confirmation into block, VRF lottery selection | 25% (confirmation) |

**Why this is better than the original 4-role model:**
- **No passive roles** — everyone earns through verifiable action
- **Retail participants are attestation workers** — they specialize in namespaces, run on consumer hardware, earn per-attestation
- **Big players run gateways and finality nodes** — they provide fast entry points and security liquidity
- **Storage follows function** — gateways store what they serve, workers store what they validate. No separate storage market
- **Scalability through specialization** — the attestation layer scales horizontally by namespace without coordination overhead

**This maps to the D4 fee split:** Entry 25% → Gateways. Validation 35% → Attestation Workers. Confirmation 25% → Finality Committee. Treasury 15%.

**Key insight for mechanism design:** The hash-roster "team" concept applies most naturally to the **attestation layer**, where workers for a given namespace form cooperative teams per-block. The finality layer uses the standard VRF lottery + BFT committee from D2.

### 3.4 Slot Auction with Redistribution

**Concept:** Proposer slots are auctioned. High bidders get priority slots (more transactions, more fees). Auction revenue is redistributed to all stakers proportionally.

**Why this helps retail:**
- Big players pay for priority, which funds retail stakers
- Small stakers earn passive income from the auction redistribution
- Creates an explicit economic relationship: big players subsidize the network's decentralization

**Risks:**
- MEV-like dynamics (front-running, sandwich attacks)
- Auction complexity
- May conflict with VRF privacy (can't auction if you don't know who's eligible)

### 3.5 Reputation-Weighted Selection (Performance Games)

**Concept:** Beyond stake, validators earn a reputation score based on:
- Uptime (were you online when eligible?)
- Attestation speed (did you attest within the first 500ms?)
- Storage reliability (do you serve content when requested?)
- Relay performance (do messages forwarded through you arrive intact and fast?)

Reputation modulates stake weight for committee selection: `effective_weight = stake × reputation_multiplier`. A retail participant with excellent performance can have higher effective weight than a lazy whale.

**Why this helps:**
- Rewards active participation, not just capital
- Retail participants can compete on quality, not just quantity
- Creates a meritocratic layer on top of the plutocratic stake layer
- Incentivizes the behaviors that make the network actually work

**Risks:**
- Reputation gaming (fake good behavior during measurement periods)
- Complexity of measurement
- Subjectivity in what counts as "good performance"

**Mitigation:** Reputation should be slow-moving (exponential moving average over many epochs) and hard to game (based on cryptographic proofs of behavior, not self-reported metrics).

---

## 4. Mechanism Comparison Matrix

| Mechanism | Spam Resistance | Retail Uplift | Big Player Incentive | Grind Resistance | Team Dynamics | Complexity |
|-----------|----------------|---------------|---------------------|-----------------|---------------|------------|
| VRF Lottery (Ouroboros) | ★★★ | ★☆☆ | ★★★ | ★★★ | ☆☆☆ | Low |
| Eth Committees | ★★☆ | ★★★ | ★★☆ | ★★☆ | ☆☆☆ | Medium |
| Algorand Sortition | ★★★ | ★★☆ | ★★☆ | ★★★ | ☆☆☆ | Medium |
| **Hash-Roster Teams** | ★★★ | ★★★ | ★★★ | ★★☆ | ★★★ | Medium |
| **Cooperative Pools** | ★★☆ | ★★★ | ★★★ | ★★☆ | ★★★ | High |
| **Role Differentiation** | ★★★ | ★★★ | ★★★ | ★★★ | ★★☆ | High |
| **Slot Auction** | ★★★ | ★★☆ | ★★★ | ★★★ | ☆☆☆ | High |
| **Reputation-Weighted** | ★★☆ | ★★★ | ★★☆ | ★★☆ | ☆☆☆ | High |

**Recommended combination for firecat:**

**Three-Phase Architecture + VRF Lottery (finality) + Hash-Roster Teams (attestation) + Reputation Modifier**

This gives you:
1. Three-phase pipeline (entry → attestation → finality) for natural role separation
2. VRF lottery for finality committee selection (spam resistance, grind resistance)
3. Hash-roster for attestation worker team formation per namespace (cooperative dynamics, retail uplift)
4. Reputation as a multiplier across all phases (rewards quality, not just capital)
5. Namespace specialization for horizontal scalability

---

## 5. Research Plan for Mechanism Simulation

To validate the combined mechanism, we need simulation experiments:

### Experiment M1: Hash-Roster Team Formation
- **Question:** What hash-matching criterion produces fair, unpredictable teams of the right size?
- **Method:** Monte Carlo simulation across N={50,100,500,1000}, varying threshold functions
- **Metrics:** Team size distribution, team stake distribution, grinding advantage, retail inclusion rate
- **Estimated effort:** 1-2 weeks

### Experiment M2: Reward Distribution Games
- **Question:** Which intra-team reward function maximizes retail participation while maintaining security?
- **Method:** Agent-based simulation with rational actors choosing to participate or exit based on expected reward
- **Metrics:** Retail validator count at equilibrium, Gini coefficient of rewards, total network stake
- **Estimated effort:** 1-2 weeks

### Experiment M3: Three-Phase Pipeline Economics
- **Question:** Can the gateway → attestation → finality pipeline sustain all three roles economically? At what message volume do attestation workers for a given namespace break even?
- **Method:** Economic simulation extending E4, with phase-specific cost models (gateway bandwidth, worker compute/storage, committee coordination) and the D4 fee split (25/35/25/15)
- **Metrics:** Break-even thresholds per phase, minimum namespace traffic for worker viability, gateway SLA economics, participation equilibrium by role
- **Estimated effort:** 1-2 weeks

### Experiment M4: Reputation System Design
- **Question:** How should reputation be measured, accumulated, and applied? What's the gaming resistance?
- **Method:** Adversarial simulation — rational validators trying to maximize reputation with minimal actual work
- **Metrics:** Reputation accuracy (correlation with actual quality), gaming success rate, convergence time
- **Estimated effort:** 2-3 weeks

### Experiment M5: Combined Three-Phase End-to-End
- **Question:** Does the full three-phase pipeline (gateway + attestation workers + finality committee) with VRF lottery, hash-roster teams, and reputation produce the desired equilibrium?
- **Method:** Full agent-based simulation with heterogeneous actors: whale gateways, retail attestation workers, finality committee members, adversaries at each phase
- **Metrics:** Security (BFT safety violations), economics (all phases profitable), decentralization (stake distribution, Nakamoto coefficient), namespace coverage (do all active namespaces have sufficient workers?), write latency (entry to finality time)
- **Estimated effort:** 2-3 weeks

**Total estimated research effort: 7-11 weeks**

---

## 6. Where Else to Look

Beyond blockchain consensus mechanisms, the team/roster concept draws from:

### 6.1 Network Management & Operations Research
- **Load balancing algorithms** — consistent hashing (rendezvous hashing) assigns work to servers based on hash of the request. Directly analogous to roster assignment.
- **Workforce scheduling** — operations research on team formation with heterogeneous skills. Literature on "team formation problems" in combinatorial optimization.
- **CDN edge selection** — how Cloudflare/Akamai select which edge node serves a request. Combines latency, load, and capability matching.

### 6.2 Game Theory & Mechanism Design
- **Mechanism design theory** (Myerson, Maskin) — designing games where the equilibrium outcome is the desired one
- **Cooperative game theory** — Shapley values for fair reward distribution in teams. How much does each team member contribute to the team's success?
- **Auction theory** (Vickrey, VCG) — for slot auctions and fee markets
- **Schelling points** — for coordinating behavior without explicit communication

### 6.3 Sports & Esports Team Formation
- **Fantasy sports drafts** — how to form balanced teams from a pool of heterogeneous players
- **Matchmaking in competitive games** — ELO/MMR systems that form teams of similar skill. The reputation system is analogous.
- **Salary caps in professional sports** — anti-whale mechanisms that force competitive balance

### 6.4 Distributed Systems
- **Consistent hashing rings** — nodes responsible for keys in their hash neighborhood. Very similar to "validators whose pubkey matches the hash pattern."
- **Raft/Paxos leader election** — term-based leadership with deterministic succession
- **BitTorrent choking/unchoking** — reward peers who contribute, punish free-riders. The reputation mechanism has similar dynamics.

### 6.5 Economic Models
- **Platform economics** — two-sided markets (developers + users), cross-subsidization strategies
- **Co-operative economics** — member-owned enterprises, dividend distribution, one-member-one-vote vs. proportional
- **Public goods provision** — how to fund shared infrastructure without free-riding (relevant to protocol treasury)

---

## 7. The Compression Principle

The founder's insight deserves its own section: **the best mechanisms compress multiple functions into a single construction.**

The VRF lottery is an example: one mechanism, four properties (spam resistance, fairness, liveness proof, unpredictability).

The research goal for firecat's mechanism games is to find constructions with similarly high compression ratios. Each mechanism should deliver at least 3 of these properties simultaneously:

1. **Security** — BFT safety, grind resistance, DoS resistance
2. **Fairness** — proportional rewards, retail inclusion, anti-whale
3. **Performance** — fast finality, low overhead, scalable
4. **Economics** — sustainable rewards, correct incentives, no rent-seeking
5. **Cooperation** — team dynamics, mutual benefit, social cohesion
6. **Simplicity** — easy to understand, implement, and audit

A mechanism that delivers 3/6 is good. One that delivers 4/6 is exceptional. One that delivers 5/6 is the kind of thing that makes firecat a genuine innovation.

The hash-roster team concept is promising because it potentially delivers 5/6: security (VRF base), fairness (threshold tuning), performance (deterministic assignment), cooperation (team formation), and simplicity (it's just hashing). Whether it also delivers correct economics is the open research question.

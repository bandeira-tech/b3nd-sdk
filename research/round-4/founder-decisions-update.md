# Founder Decisions Update — Round 4

**Date:** 2026-03-18
**Context:** Founder clarifications on D1 and D2 during Round 4 synthesis review.

---

## Decision D1: Network Trust Model — DECIDED

**Answer: B — Open from v1 with stake-based Sybil resistance**

**Founder clarifications that refine D1:**

1. **The data layer is the crown jewel.** The network is real infrastructure (transport, gossip, validators), but its purpose is to produce and protect a persistent data layer. Everything of value lives in the data layer. Everything communicates through it. The data layer accumulates value over time — more data, more attestations, more history = more financial and social security for content.

2. **Firecat is a content backbone for internet applications.** The analogy is AWS/GCP but community-owned. Developers build on it, advertisers and users fund it, the community operates and owns the infrastructure. The economic model mirrors public cloud but decentralizes ownership and control.

3. **Network topology:**
   - **Mainnet** — primary network, global, source of truth for attestation and economic settlement
   - **Relay networks** — independent, regional, optimize for local speed and availability, connect back to mainnet. These emerge naturally as the network scales — not a separate protocol, just an optimization pattern
   - **Custom networks** — can be created, connect to mainnet as bridges. Emergent capacity from the design

4. **Persistence is first-class.** Data isn't ephemeral messages passing through — it's durable content that the network stores, replicates, and protects. This is what distinguishes firecat from a messaging protocol. The content backbone metaphor is key.

5. **The single primitive drives everything.** All problems are solved at the data layer using the signed, content-addressed data object. The primitive carries its own validation rules via the declared program. Programs define what "valid" means for each type of content. The protocol provides the primitive + attestation mechanism; programs provide the semantics.

**Confidence: High**

**What this unlocks beyond the original scope:**
- Persistence and redundancy storage as a core economic role (not just validation)
- Relay network design as an emergent property, not a designed subsystem
- Content backbone framing for developer relations and go-to-market

---

## Decision D2: Committee Parameters — UPDATED

**Original answer:** D — Dynamic, starting at K=7

**Updated answer:** D — Dynamic, with VRF lottery + roster team formation

**Round 4 evidence update (S2):**
- K=21/T=11 needed for f=0.33 BFT safety (up from estimated K≥15)
- Anti-whale cap (5%) paradoxically increases minimum K by 4-6
- For N≥500 at f=0.33, even K=21 is insufficient → supplementary mechanisms needed

**Founder clarifications that expand D2:**

1. **Spam resistance through slot lottery.** Not everyone can propose at any time. A VRF-based lottery (inspired by Cardano's Ouroboros) determines who is eligible to propose in each slot. You have to be online, listening, and ready. You can't spam proposals — you either won the lottery or you didn't. This is lightweight proof-of-work without energy waste.

2. **Roster "teams" formed per block.** The last block hash (or similar deterministic-but-unpredictable value) determines which validators form the committee for the current block. The matching is based on a hash-vs-pubkey criterion: validators whose pubkey matches the hash pattern are eligible. This creates dynamic "teams" of available players.

3. **Small players benefit from big players.** When a retail validator lands on a team with high-stake validators, they share in the block rewards. The team dynamic means small stakers aren't competing against big stakers — they're cooperating with them. Big stakers provide security liquidity; small stakers provide decentralization and redundancy.

4. **Big players support high-performance applications.** Large stakers can support more demanding applications, provide better SLAs, and contribute more network security. Their higher stake justifies higher rewards, but the team mechanism ensures retail participants benefit from their presence.

5. **Retail accessibility is a design goal.** The participation model should make running a node on consumer hardware viable and rewarded. Validators take on validation, redundancy storage, and relay duties — and are compensated proportionally. The mechanism should incentivize more participants, not fewer.

**Updated parameter table:**

| Parameter | Value | Source |
|-----------|-------|--------|
| Starting K | 7 (testnet), 21 (mainnet) | S2 |
| Threshold T | ceil((K+1)/2) majority | E7, S2 |
| Selection | VRF lottery per slot | D2, Ouroboros-inspired |
| Team formation | Hash-based roster matching | Founder direction |
| Stake cap | 5% max per validator | E2, S2 |
| Scaling | Dynamic with f estimation | E7 |
| Finality checkpoints | Required for N>200 | S2 |

**Confidence: Medium** — Direction is clear, but the specific roster/team mechanism needs research and simulation (see "Mechanism Games" research direction below).

**Open research questions:**
1. What hash-vs-pubkey matching criterion produces fair, unpredictable, grind-resistant team formation?
2. How should block rewards be split within a team? Proportional to stake? Equal per member? Hybrid?
3. How does team size interact with K and T for safety guarantees?
4. What prevents a large staker from manipulating the hash to select favorable teams?
5. How does roster matching interact with the view-change protocol (S4)?

---

## Addendum: Three-Phase Message Lifecycle (2026-03-18)

**Context:** During discussion of D2 mechanism games, the founder clarified a fundamental architectural insight that supersedes the S1 role model and the "Storer" role proposed in the mechanism games research. This addendum captures that understanding and integrates it into D1, D2, and D4.

### The Insight: Rewards Come from Action, Not Passive Holding

The protocol does not pay for storage. Storage is a **side effect of doing useful work** — you store what you need to validate, you store what you need to serve. There is no "Storer" role. The incentive to store is that storing enables you to validate, and validating is where rewards come from.

This leads to a three-phase message lifecycle with distinct economic roles:

### Phase 1: Entry (Gateway)

**What:** Staked nodes that accept content writes from clients — the front door of the network.

**Properties:**
- **Stake-heavy** — significant stake required, because gateways are the first line of defense against spam, malformed data, and malicious injection
- **Fast** — must serve content writes with low latency, because this is the content backbone for internet applications. The user experience of "writing to firecat" must feel like writing to a cloud API
- **Big-player role** — naturally suited to operators with high-performance infrastructure and significant stake. They provide the SLA that applications depend on
- **Economic function:** Gateways earn entry fees for accepting and initially validating messages

### Phase 2: Attestation (Workers)

**What:** A looser, more scalable layer of validators that verify messages against their declared program rules. This is where the bulk of validation happens.

**Properties:**
- **Parallelizable** — multiple attestation workers process different messages simultaneously. No all-to-all coordination required at this phase
- **Asynchronous** — attestation happens after entry but before finality. This decoupling is what enables fast write acceptance at the gateway while maintaining deep validation
- **Specializable** — workers can focus on specific namespaces (e.g., "I validate all messages for the social media protocol"). This lets them:
  - Optimize storage for that namespace's data patterns
  - Cache relevant state for fast validation
  - Know the program rules intimately
  - Get messages into blocks faster by being already-prepared for that message type
- **Retail-accessible** — consumer hardware is viable because workers don't need to handle all traffic, just their chosen namespace(s). Lower stake requirements than gateways or finality nodes
- **Self-organizing** — workers gravitate to namespaces where there's demand (and therefore fees). Popular services attract more attestation workers, which increases throughput and validation redundancy for those services — a virtuous cycle
- **Economic function:** Workers earn attestation fees for each message they validate

### Phase 3: Finality (Committee)

**What:** The staked BFT committee that confirms attested messages into the block — the seal of the network.

**Properties:**
- **Stake-heavy** — BFT safety guarantees depend on honest stake majority in the committee. This is where the K=21/T=11 parameters from S2 apply
- **The endpoint of the pipeline** — a message is only finalized when the committee confirms it. Before that, it's "accepted" (gateway) and "attested" (workers) but not "final"
- **VRF lottery + roster** — committee selection per slot uses the mechanisms described in D2
- **Economic function:** Committee members earn confirmation fees for sealing blocks

### The Pipeline

```
Client write
    │
    ▼
┌─────────────────────┐
│  GATEWAY (Entry)    │  Staked, fast, big-player
│  Accept + initial   │  Earn: entry fees
│  validation         │
└─────────┬───────────┘
          │ message accepted
          ▼
┌─────────────────────┐
│  ATTESTATION        │  Specialized, parallel, retail-accessible
│  WORKERS            │  Earn: attestation fees
│  Deep validation    │
│  against program    │  Workers pick namespaces they care about
│  rules              │  and optimize for those
└─────────┬───────────┘
          │ message attested (N attestations)
          ▼
┌─────────────────────┐
│  FINALITY           │  Staked, BFT committee (K=21/T=11)
│  COMMITTEE          │  Earn: confirmation fees
│  Confirm into block │
└─────────┬───────────┘
          │ message finalized
          ▼
      Block (immutable)
```

### Why This Architecture Works

1. **Fast entry for content serving.** Gateways accept writes immediately — the client doesn't wait for full consensus. This is essential for the content backbone use case. Applications get cloud-like write latency.

2. **Deep validation without blocking writes.** Attestation workers can take the time they need to validate complex program rules without slowing down the entry point. A social media post with image verification takes longer to attest than a simple key-value write, but both enter the system at the same speed.

3. **Scalability through specialization.** The attestation layer scales horizontally by namespace. As a new service launches on firecat, new attestation workers spin up for that namespace. No coordination with workers handling other namespaces. This is how the network scales to serve as a global content backbone.

4. **Retail participation through namespace affinity.** A retail participant picks a namespace they care about — maybe they're a user of that app, or a developer building on it — and runs an attestation worker. They earn proportional to the traffic in that namespace. Consumer hardware is sufficient because they're not handling the entire network's traffic.

5. **Security at the boundaries.** Stake protects the entry and finality points — the two places where bad actors can cause the most damage (injecting garbage, or confirming invalid state). The attestation layer in the middle is where the looseness lives, and that's appropriate because attestation errors are caught by the finality committee.

### Implications for D4 Fee Split

The fee split maps naturally to the three phases:

| Role | Current D4 Label | Phase | Fee Share |
|------|-----------------|-------|-----------|
| Gateway | Storage (25%) | Entry | 25% |
| Attestation workers | Validation (35%) | Attestation | 35% |
| Finality committee | Confirmation (25%) | Finality | 25% |
| Protocol treasury | Treasury (15%) | — | 15% |

The D4 split doesn't need to change — but the *meaning* of each share is now precise. "Storage" fees go to gateways (who store as a side effect of serving writes). "Validation" fees go to attestation workers (the largest share, because this is where the most useful work happens). "Confirmation" fees go to the finality committee.

### Implications for D2 Mechanism Games

The three-phase model reframes the mechanism design space:

- **Gateway selection** needs its own mechanism — which staked nodes are authorized entry points? This is where big-player economics and SLA competition live.
- **Attestation worker incentives** are the retail accessibility game — how do workers choose namespaces? How are attestation fees distributed when multiple workers attest the same message? Is there a minimum attestation count per message?
- **Finality committee** is the existing D2 VRF lottery + roster mechanism. The S2/S4/E7 research applies here directly.

The hash-roster "team" concept from the mechanism games research may apply most naturally to the **attestation layer**, not the finality layer. Teams of attestation workers for a namespace could be formed per-block using the hash-roster mechanism, creating cooperative dynamics where retail workers benefit from being on a team with more experienced workers for that namespace.

### Implications for S1 Architecture

The S1 6-layer architecture should be revised to reflect this three-phase model. The current layers (transport, gossip, data, consensus, attestation, application) conflate network layers with economic roles. The revised model separates:
- **Infrastructure layers** (transport, gossip, sync) — how data moves
- **Economic phases** (entry, attestation, finality) — how data is validated and who gets paid
- **Application layer** (programs, schemas) — what "valid" means for each type of content

### What This Retires

- **The "Storer" role from mechanism games §3.3** — there is no passive storage role. Storage follows function.
- **The "Relay" role as a rewarded position** — relaying is infrastructure, not an economic role. Gateways and workers relay as part of their function.
- **S1's flat validator model** — validators are not a single role. The three phases create natural specialization.

### Open Questions

1. **Attestation threshold:** How many attestations does a message need before it's eligible for finality? Fixed (e.g., 3)? Proportional to fee tier? Proportional to message complexity?
2. **Attestation conflict resolution:** What happens when attestation workers disagree? If 2 of 3 workers say "valid" and 1 says "invalid," does the message proceed to finality?
3. **Gateway authorization:** Is running a gateway permissionless (anyone with sufficient stake) or does it require additional criteria (uptime history, bandwidth SLA)?
4. **Namespace economics:** Can a namespace set its own attestation fee premium? Can a popular service attract workers by offering higher fees?
5. **Cross-namespace attestation:** Can a message reference data from multiple namespaces? If so, who attests it — workers from all referenced namespaces?

---

## Confidence Summary

| # | Decision | Answer | Confidence | Status |
|---|----------|--------|------------|--------|
| D1 | Trust model | Open + stake-based, content backbone | **High** | Decided |
| D2 | Committee | Dynamic, VRF lottery + roster teams | **Medium** | Direction set, mechanism needs research |
| D3 | Privacy | Path obfuscation + constant-rate padding | High | Decided |
| D4 | Fee split | 25/35/25/15 @ $0.002/msg | High | Decided |
| D5 | Cold-start | Partners + tapering grants | Medium | Decided |
| D6 | KDF | Argon2id 46MiB/t1/p1 | High | Decided |
| D7 | PQ timeline | Phase 0+1 in v1.0, FROST required | High | Decided |

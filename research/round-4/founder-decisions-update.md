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

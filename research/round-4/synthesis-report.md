# Round 4: Cross-Front Synthesis Report

**Purpose:** Consolidate 6 synthesis experiments into a unified assessment of protocol readiness, emergent insights, and the path forward.

**Date:** 2026-03-16

---

## Executive Summary

Round 4 integrated findings from all 6 research fronts across Rounds 1-3 into a coherent protocol architecture. The 6 experiments produced:

1. **A complete protocol specification** (S1) — 6-layer architecture with message lifecycle, state machine, node roles, and epoch/slot timing
2. **BFT committee parameters** (S2) — K=21/T=11 needed for f=0.33; anti-whale caps increase minimum K by 4-6
3. **A traffic shaping protocol** (S3) — Constant-rate emission at C=0.5 msg/sec defeats volume correlation
4. **A view-change mechanism** (S4) — Lock-and-carry protocol with TLA+ formal sketch, closes E7's proposer failure gap
5. **A complete wire format** (S5) — base64url encoding, 24-byte headers, size budgets for classical and hybrid PQ
6. **A unified threat model** (S6) — 53 threats, 6 cross-front attack chains, security scorecard of 5/10

**Bottom line:** The protocol design is sound but not yet launch-ready. Five engineering blockers must be resolved before v1.

---

## Key Findings

### 1. The 7 Decisions Compose Cleanly — With 6 Identified Tensions

S1 confirmed that all 7 decisions from the Decision Brief integrate into a coherent architecture. The 6 integration conflicts found are all resolvable:

| Conflict | Resolution |
|----------|------------|
| Constant-rate padding vs. fee-per-message | Padding is fee-exempt, local-only; real messages pay fees |
| PQ signatures (+3KB) vs. K=7 committee (K×3KB per confirmation) | FROST threshold signatures reduce K signatures to 1 aggregate (3.4KB total vs 23KB) |
| Dynamic K scaling vs. VRF selection | Threshold recalibration at epoch boundaries |
| Padding vs. Merkle sync | Separate Merkle trees for durable vs. ephemeral messages |
| Fees vs. tiered consensus | Tier 0 (user-owned data) and Tier 1 (attested) are fee-free |
| Path obfuscation vs. validator verification | Deterministic obfuscation enables conflict detection on obfuscated paths |

### 2. BFT Security Requires Larger Committees Than Expected

S2's simulation revealed that the anti-whale stake cap (5% max per validator) paradoxically increases the minimum committee size by 4-6:

| Byzantine fraction | Min K (uncapped, E2) | Min K (5% cap, S2) | Gap |
|-------------------|---------------------|--------------------|----|
| f ≤ 0.20 | 7 | 7 | 0 |
| f = 0.25 | 9 | 11 | +2 |
| f = 0.30 | ~13 | 15 | +2 |
| f = 0.33 | ~15 | 17-21 | +2-6 |

**Why:** The cap spreads Byzantine stake across more individual validators, who collectively infiltrate committees more frequently even though each has bounded power.

**Critical finding:** For N ≥ 500 at f=0.33, even K=21 is insufficient. The protocol needs supplementary mechanisms (finality checkpoints, multi-round confirmation) for large networks.

**Recommendation update:** K=21 with T=11 for mainnet, combined with finality checkpoints for N > 200.

### 3. Traffic Shaping Closes the Privacy Gap

S3 designed the constant-rate emission protocol that E3 showed is necessary:

- **Rate:** C=0.5 msg/sec per node (recommended for v1)
- **Bandwidth:** 63 MB/day, ~$0.17/month cloud cost
- **Privacy gain:** Eliminates volume correlation entirely (adversary sees identical traffic from all nodes)
- **Padding format:** Indistinguishable from real messages (same size classes, valid signatures, HMAC paths)
- **Burst handling:** FIFO queue with backpressure at 10×C

Four-phase rollout: disabled in alpha → opt-in in beta → default-on at release → mandatory in v1.1+.

### 4. View-Change Fills the Last Consensus Gap

S4 designed a Tendermint-inspired lock-and-carry view-change protocol:

- **Timeout:** 2.0s base, 1.5× exponential backoff, max K=7 views per slot
- **Backup proposers:** Deterministic ordering via `committee[(s+v) mod K]`
- **Safety:** Quorum intersection argument — any two sets of T members from K must overlap when T > K/2, forcing reproposal of locked values across views
- **Worst case:** f=3 consecutive bad proposers delays slot by ~9.5s
- **TLA+ formalization:** ViewChange.tla extends TemporalConsensus.tla with view numbers and lock state

### 5. Wire Format Resolves Encoding and Quantifies PQ Overhead

S5 resolved the base64 vs. hex question and quantified the cost of hybrid PQ:

**Encoding decision:** base64url (RFC 4648 §5), no padding — 33% savings over hex, JSON/URI compatible.

| Message type | Classical | Hybrid PQ | Overhead |
|-------------|-----------|-----------|----------|
| User message | 1,283 B | 9,766 B | +661% |
| Attestation | ~200 B | ~3,500 B | +1,650% |
| Confirmation (FROST) | 382 B | 4,795 B | +1,155% |
| Confirmation (no FROST) | 1,283 B | 50,402 B | +3,828% |
| Per-slot total (10 msgs) | 45.5 KB | 726 KB | +1,496% |

**FROST is essential for hybrid PQ.** Without threshold signature aggregation, hybrid confirmations are 50KB each — untenable.

### 6. Security Scorecard: 5/10 — Five Launch Blockers

S6 identified 53 threats across 6 categories and 6 cross-front attack chains. Current security readiness: **5/10**.

**Five v1 launch blockers:**

| # | Blocker | Effort | Front |
|---|---------|--------|-------|
| 1 | Replay protection (sequence numbers/nonces for mutable URIs) | 1-2 weeks | Crypto |
| 2 | Equivocation slashing (detect and penalize double-voting) | 2-3 weeks | Consensus |
| 3 | View-change protocol (S4 design → implementation) | 2-3 weeks | Consensus |
| 4 | VRF-based committee selection (prevent grinding) | 1-2 weeks | Consensus |
| 5 | HKDF in ECDH pipeline (replace raw shared secret) | 1 week | Crypto |

**Estimated total:** 8-10 weeks of engineering.

**Most dangerous unmitigated threat:** Economic→Consensus attack chain — stake acquisition to committee control. Mitigated by anti-whale caps (5%) + equivocation slashing, but the combined interaction has not been formally verified.

---

## Cross-Experiment Insights

### Things that reinforced each other:
- **S2 + S4:** Larger committees (K=21) make view-change more robust — more backup proposers available
- **S3 + S5:** Constant-rate padding requires indistinguishable message format, which S5's fixed-size header enables
- **S1 + S6:** The 6-layer architecture from S1 maps directly to the 6 threat categories in S6

### Things that surprised us:
- **Anti-whale caps hurt committee security.** Designed to prevent stake concentration, they paradoxically spread Byzantine influence and increase minimum K. This is the most counter-intuitive finding of Round 4.
- **FROST is not optional for hybrid PQ.** Without threshold aggregation, hybrid confirmations are 50KB — this was not apparent until S5 computed the full wire sizes.
- **Security score is only 5/10.** The protocol design is solid, but implementation gaps (replay protection, HKDF, slashing) mean it's not launch-ready yet.

### Things that remain open:
1. **Economic-consensus interaction verification** — formal analysis of combined stake attacks + committee selection
2. **Client-to-node traffic shaping** — S3 covers node-to-node only; client leakage remains
3. **FROST integration with hybrid PQ** — need to verify that threshold signatures compose with ML-DSA-65
4. **Partial synchrony TLA+ model** — S4 assumes bounded delay; need full async safety proof
5. **Forward secrecy ratcheting** — no Double Ratchet equivalent for stored messages

---

## Updated Parameter Table

Consolidating all parameters from Rounds 3-4:

| Parameter | Value | Source |
|-----------|-------|--------|
| Committee size K | 7 (early), 21 (mainnet) | S2 |
| Threshold T | ceil((K+1)/2) majority | E7, S2 |
| Slot duration | 2 seconds | S1 |
| Epoch length | 300 slots (10 minutes) | S1 |
| Committee rotation | Per-epoch, VRF-based | D2, S4 |
| Anti-whale stake cap | 5% max per validator | E2, S2 |
| Fee split | 25/35/25/15 (storage/validation/confirmation/treasury) | D4 |
| Fee floor | $0.002/msg | E4 |
| KDF | Argon2id m=46MiB t=1 p=1 | D6 |
| Encoding | base64url, no padding | S5 |
| Header size | 24 bytes | S5 |
| Traffic shaping rate | C=0.5 msg/sec | S3 |
| Batching delay | D=1s | E3, D3 |
| View-change timeout | 2.0s base, 1.5× backoff | S4 |
| PQ key exchange | X25519 + ML-KEM-768 (v1.0) | D7, E1 |
| PQ signatures | Ed25519 + ML-DSA-65 (v1.1) | D7, E8 |
| Compression | None per-message, zstd for Merkle batch sync | S5 |

---

## What This Means for Round 5

Round 5 is "Tools and presentation materials." Based on Round 4 findings, the priorities are:

1. **Protocol specification document** — formalize S1 into a publishable whitepaper-grade spec
2. **Security audit preparation** — package S6's threat model for external auditors
3. **Parameter configurator tool** — interactive tool for operators to understand K/T/f tradeoffs
4. **Wire format reference implementation** — encoder/decoder based on S5's specification
5. **Consensus visualizer** — animate the message lifecycle, view-change, and committee rotation from S1/S4

But the five launch blockers from S6 should likely be addressed *before* Round 5 presentation materials — they're engineering work, not research.

---

## Decision Card Update

| # | Decision | Round 3 Answer | Round 4 Update | Confidence |
|---|----------|---------------|----------------|------------|
| D1 | Trust model | Open + stake-based | No change | High |
| D2 | Committee | K=7 majority | **K=21/T=11 for mainnet BFT** | High (was Medium) |
| D3 | Privacy | Path obfuscation + padding | **C=0.5 msg/sec constant-rate** | High (was Medium) |
| D4 | Fee split | 25/35/25/15 @ $0.002 | No change | High |
| D5 | Cold-start | Partners + tapering | No change | Medium |
| D6 | KDF | Argon2id 46MiB | No change | High |
| D7 | PQ timeline | Phase 0+1 in v1.0 | **FROST required for hybrid** | High |

**Round 4 raised confidence on D2 and D3** by providing concrete parameters. It added a new dependency on D7: FROST threshold signatures are essential, not optional, for hybrid PQ committee confirmations.

---

## Addendum: Architectural Revision — Three-Phase Message Lifecycle (2026-03-18)

Following founder review of Round 4 outputs, the protocol architecture has been revised to a three-phase message lifecycle that supersedes S1's flat validator model:

### The Three Phases

```
Client → [Gateway] → [Attestation Workers] → [Finality Committee] → Block
          staked       specialized, parallel     staked, BFT
          fast entry   async validation          final confirmation
```

1. **Entry (Gateway)** — Staked nodes accept content writes. Fast, low-latency, big-player role. Stake protects against spam and injection. Earns entry fees (25%).

2. **Attestation (Workers)** — Specialized validators verify messages against program rules. Parallel, async, namespace-specialized. Retail-accessible on consumer hardware. Workers choose namespaces they care about and optimize for them. Earns attestation fees (35%).

3. **Finality (Committee)** — BFT committee (K=21/T=11) confirms attested messages into blocks. Staked, VRF lottery selection. Earns confirmation fees (25%).

### Key Principles

- **Rewards come from action, not passive holding.** There is no "Storer" role. Storage is a side effect of validation — you store what you need to validate and serve.
- **Fast entry, deep validation.** Gateways accept writes immediately (cloud-like latency). Attestation workers validate deeply but asynchronously. This decoupling is essential for the content backbone use case.
- **Scalability through namespace specialization.** The attestation layer scales horizontally. New namespaces attract new workers. No cross-namespace coordination needed.
- **Retail participation via attestation.** Retail participants pick a namespace, run a worker on consumer hardware, earn per-attestation. Big players run gateways and finality nodes.

### Impact on Prior Research

| Artifact | Impact |
|----------|--------|
| S1 (architecture) | **Revised.** 6-layer model split into infrastructure layers + 3 economic phases |
| S2 (committee) | Applies to **finality phase only**. K=21/T=11 for the finality committee |
| S3 (traffic shaping) | Applies primarily at **gateway phase** (entry point traffic patterns) |
| S4 (view-change) | Applies to **finality phase** — backup proposers in the finality committee |
| S5 (wire format) | Unchanged — applies across all phases |
| S6 (threat model) | **Needs revision.** Threats should be categorized by phase, not just by front |
| Mechanism games | **Reframed.** Hash-roster teams apply to attestation layer; VRF lottery to finality |

### What This Adds to the Open Items

6. **Attestation threshold design** — how many attestations before finality eligibility?
7. **Gateway authorization mechanism** — stake threshold? SLA requirements?
8. **Namespace economics** — can namespaces set fee premiums to attract workers?
9. **Three-phase pipeline simulation** — end-to-end latency, throughput, economic viability (see M3, M5 in mechanism games)
10. **Privacy-visibility game composition** — do the 6 games compose safely? Information leakage under multi-game participation? (see M6, M7 in mechanism games)
11. **Ad economics simulation** — revenue curves per game, advertiser WTP, equilibrium game adoption (see M7)

### Updated Decision Card

| # | Decision | Round 3 Answer | Round 4 Update | Confidence |
|---|----------|---------------|----------------|------------|
| D1 | Trust model | Open + stake-based | **Content backbone, data layer is crown jewel** | High |
| D2 | Committee | K=7 majority | **Three-phase pipeline: gateway → attestation → finality. VRF + roster teams.** | Medium |
| D3 | Privacy | Path obfuscation + padding | **Private by default + 6 visibility games for ad-funded economics** | High |
| D4 | Fee split | 25/35/25/15 @ $0.002 | **Now mapped: entry/attestation/confirmation/treasury** | High |
| D5 | Cold-start | Partners + tapering | No change | Medium |
| D6 | KDF | Argon2id 46MiB | No change | High |
| D7 | PQ timeline | Phase 0+1 in v1.0 | **FROST required for hybrid** | High |

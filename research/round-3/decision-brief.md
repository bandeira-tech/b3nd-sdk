# Round 3 Decision Brief

**Purpose:** Consolidate all 8 experiment results into concrete recommendations for the 7 founder decisions identified in Round 2.

**Date:** 2026-03-16

---

## Executive Summary

All 8 experiments produced actionable results. The key takeaways:

1. **Post-quantum crypto is viable now** — performance is fine, wire size is the constraint (E1, E8)
2. **K=7 majority committee works** — formally verified safe for f < 4 Byzantine (E2, E7)
3. **Batching alone doesn't stop timing attacks** — need constant-rate padding (E3)
4. **Adoption rate matters 16x more than fee split** — focus on growth (E4)
5. **Argon2id is the right default KDF** — works on all modern devices (E5)
6. **Merkle sync is 185x more efficient at scale** — fanout-16 recommended (E6)
7. **Only 2 functions need changes for hybrid PQ** — clean migration path (E8)

---

## Decision D1: Trust Model

**Question:** Open (stake-based Sybil resistance) vs. permissioned?

**Evidence:**
- E2: Stake-weighted committee achieves zero safety violations at K=7, f≤0.20 for N≤200
- E7: Formal proof confirms safety iff f < T = ceil((K+1)/2)
- E4: Self-sustaining economics require 50K+ msgs/day — needs open participation

**Recommendation: Open with stake-based Sybil resistance**

The committee mechanism is provably safe under known adversarial bounds. Anti-whale stake caps (max 5% per validator) are essential to prevent stake concentration attacks revealed by E2.

---

## Decision D2: Committee Parameters

**Question:** What committee size K, threshold T, and rotation strategy?

**Evidence:**
- E2 simulation (280 configurations, 10K epochs each):
  - K=7 majority (T=4): zero safety/liveness failures at f=0.20 for N≤200
  - K=9 needed for f=0.25; K≥15 estimated for f=0.33
  - **Supermajority kills liveness** — 35-88% failure rates; do not use
- E7 formal verification:
  - Safety holds iff f < T (sharp boundary, independent of N)
  - Safety and liveness conditions are mathematically identical for majority threshold
  - Double-voting is the primary attack vector → equivocation slashing required
  - Committee grinding vulnerability → VRF-based selection with RANDAO needed

**Recommendation:**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Threshold | Majority: T = ceil((K+1)/2) | Safety = liveness (E7 §4.2) |
| Starting K | 7 (T=4) | Zero failures at f≤0.20 (E2) |
| Scaling | K = 2f_est + 1 | Formal bound from E7 |
| Rotation | Per-epoch, VRF-based | Grinding resistance (E7 §5.1) |
| Stake cap | 5% max per validator | Anti-concentration (E2 §8.4) |

**Dynamic scaling formula:** Start at K=7. Monitor attestation behavior to estimate f. If suspicious activity detected, increase K per the table:

| Estimated f | K |
|-------------|---|
| ≤ 0.10 | 3 |
| ≤ 0.15 | 5 |
| ≤ 0.20 | 7 |
| ≤ 0.25 | 9 |
| ≤ 0.33 | ≥15 (needs follow-up sim) |

---

## Decision D3: Privacy Posture

**Question:** Signal-level (full obfuscation) vs. minimal vs. configurable?

**Evidence:**
- E3 simulation (108 configurations, 100 trials each):
  - **Batching delay alone is nearly useless** — adversary precision stays ~20% from D=0 through D=10s
  - **Dummy traffic provides moderate improvement** — R=2.0 (3x writes) reduces precision to ~15%
  - **<5% precision target is NOT achievable** with batching + dummy traffic alone
  - Adversary exploits **volume correlation**, not timing precision
  - Best operating point: D=1s, R=2.0 → 15% precision, P99 latency 990ms

**Recommendation: Pragmatic privacy with path obfuscation + constant-rate padding**

Signal-level timing privacy is not achievable with simple batching. The protocol should:

1. **Path obfuscation** (HMAC-based, already planned) — eliminates URI metadata leakage (proven in R2 Front 6, Theorem 2)
2. **Constant-rate write padding** — each node emits writes at a fixed rate regardless of actual activity. More effective than dummy traffic injection because it eliminates volume correlation entirely
3. **Batching at D=1s** — cheap insurance, negligible UX impact
4. **Do NOT promise Signal-level timing privacy** — be honest about the threat model. Path obfuscation + encryption is the real defense; timing is secondary

This is a stronger posture than "minimal" but honest about limitations. Full timing privacy requires mix networks or PIR, which are out of scope for v1.

---

## Decision D4: Fee Splits

**Question:** How to distribute message fees among storage, validators, confirmers, protocol?

**Evidence:**
- E4 simulation (9,600 runs across 192 configurations):
  - **Adoption rate is 16x more important than fee split** — switching slow→medium adoption changes operator count by 221 (64% swing); fee split variation produces only 13-operator swing (4%)
  - **25/35/25/15 produces best validator incentives** while accumulating $247K treasury over 36 months
  - All four tested splits produce nearly identical operator counts
  - **Fee floor of $0.002/msg is the minimum viable floor** — $0.001 produces 54 fewer operators

**Recommendation: 25/35/25/15 at $0.002/msg floor**

| Role | Share | Rationale |
|------|-------|-----------|
| Storage | 25% | Adequate for hosting costs |
| Validation | 35% | Incentivizes the security-critical role |
| Confirmation | 25% | Committee work compensation |
| Protocol treasury | 15% | Funds development, grants, emergency reserves |

The fee split barely matters compared to adoption. Ship the recommended split, focus engineering effort on growth, and revisit splits only if validator participation drops below target.

---

## Decision D5: Cold-Start Strategy

**Question:** How to bootstrap the network before self-sustaining economics?

**Evidence:**
- E4 key finding: **Subsidy creates a cliff problem**
  - $50K/month inflates operators to 125 by M12
  - When subsidy expires, mass exit drops to 37 — *worse* than the no-subsidy trajectory (47 at M18)
  - Taper is essential; flat subsidies with hard cutoffs are destructive
- Self-sustaining threshold: ~50K msgs/day at $0.002/msg for 50 operators
- Minimum bootstrap: ~10K msgs/day for 10 operators

**Recommendation: Partners + tapering grants, $10-20K/month max**

1. **Months 1-6:** Recruit 5-10 launch partners who run nodes in exchange for early access. Supplement with $10K/month distributed among non-partner operators
2. **Months 7-12:** Taper subsidy by 20%/month as organic demand grows
3. **Month 13+:** No subsidy. If demand hasn't reached 50K msgs/day, the product needs work — subsidizing operators won't fix a demand problem
4. **Never exceed $20K/month** — larger subsidies create dependency and cliff risk

---

## Decision D6: Key Derivation Function

**Question:** Argon2id default? PBKDF2 fallback? What parameters?

**Evidence:**
- E5 research (published benchmarks across device classes):
  - **Argon2id 46MiB/t1/p1**: ~80-90ms desktop, ~200-230ms mobile — well within UX budget
  - **64MiB works on iOS Safari** but is the practical ceiling
  - **Low-end Android (2GB RAM)**: safe at 19MiB, risky at 46MiB
  - **WASM bundle**: <7KB gzipped (negligible)
  - **Threading (p>1) is useless in browser WASM** — all libraries run single-threaded
  - **PBKDF2 fallback needed only for iOS Lockdown Mode** (disables WASM)
  - No browser has native WebCrypto Argon2; Node.js 24.7+ does

**Recommendation:**

| Context | KDF | Parameters |
|---------|-----|-----------|
| Default | Argon2id | m=46MiB, t=1, p=1 |
| Constrained device | Argon2id | m=19MiB, t=2, p=1 |
| iOS Lockdown Mode | PBKDF2-SHA256 | 600,000 iterations |
| Server (Node.js 24.7+) | Argon2id native | m=64MiB, t=3, p=4 |

Auto-detect at runtime: try Argon2id WASM first, fall back to PBKDF2 if WASM unavailable. Store the KDF identifier with the derived key so decryption uses the correct algorithm.

---

## Decision D7: Post-Quantum Timeline

**Question:** Hybrid PQ from v1? Deferred? Phased?

**Evidence:**
- E1 benchmarks:
  - ML-KEM-768: ~0.036ms desktop WASM, ~0.07ms mobile — negligible
  - ML-DSA-65: ~0.36ms sign, ~0.10ms verify desktop — well under thresholds
  - Bundle: 38KB gzipped combined (mlkem + mldsa)
  - **Wire size is the constraint**: +3,310 bytes/signature, +1,953 bytes/pubkey
- E8 API audit:
  - **Only 2 functions need modification** in existing codebase
  - Signature binding prevents downgrade attacks
  - Existing ACLs work unchanged (hybrid key matches via Ed25519 component)
  - Dual auth entries enable smooth coexistence during transition

**Recommendation: Phased rollout, starting with v1.0 forward-compat prep**

| Phase | Version | What Ships | Effort |
|-------|---------|-----------|--------|
| 0: Forward-compat | v1.0 | Length-based dispatch in `verify()`, helper functions | 1 day |
| 1: Hybrid key exchange | v1.0 | X25519+ML-KEM-768 (protects against harvest-now-decrypt-later) | 3-5 days |
| 2: Opt-in hybrid sigs | v1.1 | Ed25519+ML-DSA-65, capability advertisement, dual auth entries | 2-3 days |
| 3: Hybrid preferred | v1.2 | Default to hybrid, deprecation warnings for classical | Policy only |
| 4: Hybrid mandatory | v2.0 | Reject classical-only signatures | Policy only |

**Phase 0 is free and should ship with v1.0.** It's a length check in one function and two helper functions. It means v1.0 nodes can already accept hybrid signatures from future versions.

**Phase 1 (hybrid key exchange) should also ship with v1.0** — it protects stored data against future quantum computers at minimal cost (17KB gzipped, <1ms overhead).

**Do NOT embed PQ public keys in URIs.** Classical 32-byte Ed25519 keys fit in URIs; 1,985-byte hybrid keys do not. Use key discovery via `/.well-known/capabilities`.

---

## Cross-Experiment Insights

### Things that reinforced each other:
- E2 (simulation) + E7 (formal): Both converge on K=7 majority. The formal proof explains *why* the simulation numbers work — safety iff f < T
- E1 (PQ perf) + E8 (PQ API): Performance is viable AND integration is clean. No blockers for hybrid PQ
- E4 (fees) + E5 (Argon2): Both show the defaults are sensible and don't need overthinking

### Things that surprised us:
- **E3: Batching doesn't work for timing privacy.** The adversary uses volume, not timing. This means the privacy architecture needs rethinking — path obfuscation is the real defense, not delay
- **E2: Supermajority is harmful.** Intuition says "higher threshold = safer." The data shows it kills liveness so badly that it's worse than majority in practice
- **E4: Fee splits barely matter.** All the agonizing over 40/30/20/10 vs 25/35/25/15 produces a 4% difference. Adoption rate is 16x more important
- **E2: Larger N needs larger K.** Counter-intuitive — more validators means finer-grained stake, which means the adversary more precisely hits their target fraction

### Open items for future rounds:
1. **K≥15 simulation** — needed for BFT-level (f=0.33) security
2. **Constant-rate padding design** — E3 showed batching fails; need a proper traffic shaping protocol
3. **View-change protocol** — E7 identified proposer failure as unmodeled; needs a timeout/backup mechanism
4. **TLA+ extension for partial synchrony** — current model assumes synchronous phases
5. **Base64 vs hex for hybrid signatures** — E8 notes 33% wire savings from base64; need protocol-wide encoding decision

---

## Quick-Reference Decision Card

| # | Decision | Answer | Confidence | Key Evidence |
|---|----------|--------|------------|-------------|
| D1 | Trust model | Open + stake-based Sybil | High | E2, E7 |
| D2 | Committee | K=7 majority, dynamic scaling | High | E2, E7 |
| D3 | Privacy | Path obfuscation + constant-rate padding | Medium | E3 |
| D4 | Fee split | 25/35/25/15 @ $0.002/msg | High | E4 |
| D5 | Cold-start | Partners + $10-20K/month tapering | Medium | E4 |
| D6 | KDF | Argon2id 46MiB/t1/p1, PBKDF2 fallback | High | E5 |
| D7 | Post-quantum | Phase 0+1 in v1.0, hybrid sigs in v1.1 | High | E1, E8 |

**"Medium" confidence = the direction is right, but parameters may need tuning based on real-world data.**

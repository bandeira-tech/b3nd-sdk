# Founder Decision Questionnaire

**Purpose:** These 7 decisions require your input because they encode values, identity, and strategy — not just engineering tradeoffs. Each decision unblocks specific engineering work.

**Your stated posture:** "Best and most long-lasting mechanisms" — so recommended defaults lean toward robust/future-proof options.

**Format:** Each item gives you context, the tradeoff, a recommended default, and the downstream impact. You can answer with the default, an alternative, or "need more data" (in which case Round 3 experiments will target that gap).

---

## Decision 1: Network Trust Model

**What:** Is firecat a permissioned network (known validator set) or an open protocol (anyone can join)?

**Why it matters:** This is the single most consequential decision. It determines:
- Whether you need Sybil resistance (open) or just access control (permissioned)
- The confirmer committee design (elected vs. stake-weighted vs. appointed)
- The economic model (fees vs. subscription vs. free)
- The regulatory posture (permissioned = easier compliance)

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| **A. Permissioned v1, open v2** | Ship faster, simpler security model, easier compliance. Defer hard problems. | "DePIN" claim is weak. Lock-in risk. Migration to open is hard. |
| **B. Open from v1 with stake-based Sybil resistance** | True DePIN from day one. Strongest long-term position. Community trust. | Requires token design, staking mechanism, slashing. 3-6 months more work. |
| **C. Hybrid: open read, permissioned write** | Read access is free and open (good for adoption). Write access requires staking or approval. | Two-tier system creates complexity. May confuse developers. |
| **D. Identity-based (verified entities only)** | No token needed. Strong Sybil resistance via KYC/attestation. | Centralized trust. Excludes pseudonymous participants. Against crypto ethos. |

**Recommended default:** **B — Open from v1 with stake-based Sybil resistance.** You said "best and most long-lasting." Permissioned-to-open migrations almost never succeed cleanly (see: Diem/Libra). Starting open forces you to solve the hard problems upfront, which makes the network genuinely robust. The research already has the mechanism designs for stake-weighted committee selection.

**Unlocks:** Confirmer committee design, Sybil resistance mechanism, staking economics, validator selection algorithm.

---

## Decision 2: Confirmer Committee Parameters

**What:** How many confirmers, what threshold, and how are they selected?

**Depends on:** Decision 1 (trust model)

**Options (assuming open network):**

| Option | Safety | Liveness | Complexity |
|--------|--------|----------|------------|
| **A. 3 confirmers, 2-of-3 threshold** | 33% Byzantine tolerance | Tolerates 1 offline | Simple. Good for < 50 validators. |
| **B. 5 confirmers, 3-of-5 threshold** | 40% Byzantine tolerance | Tolerates 2 offline | Moderate. Good for 50-200 validators. |
| **C. 7 confirmers, 5-of-7 threshold** | 28% Byzantine tolerance | Tolerates 2 offline | Higher. Good for > 200 validators. |
| **D. Dynamic: scales with network size** | Adapts | Adapts | Most complex. Requires parameter governance. |

**Selection mechanism (all options):** Stake-weighted random sampling. Committee rotates every E epochs. Randomness seed = hash of previous epoch's last slot (deterministic, unpredictable).

**Recommended default:** **D — Dynamic, starting at 3-of-5.** Scale committee size with validator count: `K = min(7, max(3, floor(sqrt(N/10))))` where N = active validators. This is the "most long-lasting" choice — it doesn't need to be redesigned as the network grows. Start small (3 when few validators), grow naturally.

**Unlocks:** Committee rotation implementation, BLS signature aggregation (optional optimization), slashing conditions.

---

## Decision 3: Privacy Posture

**What:** How private should b3nd be? Specifically: should the URI structure hide who is communicating with whom?

**Context:** The research proves that plaintext URIs (`b3nd://<pubkey>/messaging/<recipient>/...`) leak the full social graph to any node operator. Even with encrypted payloads, metadata is exposed. The existing `deriveObfuscatedPath()` fixes the path suffix but NOT the owner pubkey prefix.

**Options:**

| Option | Privacy Level | DX Impact | Performance |
|--------|---------------|-----------|-------------|
| **A. Full obfuscation (Signal-level)** | Social graph hidden. Activity patterns hidden via batching/delays. | Harder to debug. Opaque URIs. Requires obfuscation everywhere. | 10-50ms added latency from batching. |
| **B. Path obfuscation, visible owners** | Third parties can't see who Alice talks to, but can see Alice is active. | Moderate DX impact. Owner pubkey visible for routing. | Minimal overhead. |
| **C. Encrypted payloads only (email-level)** | Content hidden, metadata visible. Like email: you know who talks to whom but not what they say. | Best DX. Clear URIs. Easy debugging. | No overhead. |
| **D. Configurable per-application** | Developer chooses privacy level. SDK provides all options. | Most flexible. Requires good defaults and documentation. | Varies. |

**Recommended default:** **A — Full obfuscation (Signal-level), with D as the implementation strategy.** Build the SDK to support all levels, but make Signal-level the default. Developers can opt into lower privacy for debugging or specific use cases. This is the "most long-lasting" choice — you can always relax privacy, but you can't tighten it without breaking changes. The math proves obfuscation works (negligible information leakage under PRF assumption).

**Requires Round 3 experiment:** Optimal batching interval to reduce timing leakage below target ε. The research has the formal model but not the concrete parameters for real-world usage patterns.

**Unlocks:** URI obfuscation scope, timing obfuscation design, `list()` behavior under obfuscated URIs, routing protocol changes.

---

## Decision 4: Fee Distribution Model

**What:** How are fees split between network participants?

**Context:** The research proposes 40% storage / 30% validation / 20% confirmation / 10% protocol treasury. But these ratios encode values.

**Options:**

| Option | Philosophy | Risk |
|--------|-----------|------|
| **A. 40/30/20/10 (storage-heavy)** | Prioritizes node operators. Incentivizes storage capacity. | Validators may be under-compensated for security work. |
| **B. 25/35/25/15 (validation-heavy)** | Prioritizes security. Validators are the backbone. | Storage operators may find it insufficiently profitable. |
| **C. 30/30/30/10 (equal)** | Simple, fair. No favoritism. | May not reflect actual cost structure. Storage is cheapest. |
| **D. Dynamic: proportional to cost** | Adjusts based on measured costs per role. Protocol governs splits. | Complex. Requires cost oracles. Governance overhead. |

**Recommended default:** **B — 25/35/25/15 (validation-heavy).** Security is the hardest thing to incentivize and the most important to get right. Storage is commodity (cheap and getting cheaper). Validation requires uptime, correct implementation, and honest behavior — it should be the best-paying role. The 15% protocol treasury funds development and grants, which is critical for long-term sustainability.

**Sub-question:** Should there be a minimum fee floor set by the protocol, or should operators compete freely on price?

**Recommended:** Protocol-set minimum floor. Free-market fees lead to a race to zero (proven by the economics research). The floor should be `2x marginal cost` to ensure operators remain profitable even as competition increases.

**Unlocks:** Fee mechanism implementation, node operator economics, treasury management.

---

## Decision 5: Cold-Start Bootstrap Strategy

**What:** How do you get the first 10, 50, 200 node operators when there's no traffic to pay them?

**Options:**

| Option | Cost | Decentralization | Speed |
|--------|------|-------------------|-------|
| **A. Foundation-run nodes only (year 1)** | Low (you eat the infra cost) | Zero initially. Centralized. | Fast to launch. |
| **B. Subsidized rewards (token incentives)** | High (inflationary). Requires token design. | High from day one. | Slow (token launch overhead). |
| **C. Partnership program (10-20 curated operators)** | Moderate (negotiated deals, possible revenue sharing) | Low-moderate. Semi-permissioned. | Moderate. |
| **D. Developer grants + free tier** | Moderate (grant budget) | Moderate. Attracts builders, not speculators. | Moderate. |

**Recommended default:** **C + D combined.** Start with 10-20 curated operator partners who run nodes in exchange for early fee revenue + protocol tokens (vested). Simultaneously offer developer grants for building applications on b3nd. This avoids the "empty network" problem without requiring a full token launch on day one. Transition to open validator set (Decision 1) once you have 50+ operators and proven demand.

**Unlocks:** Go-to-market strategy, operator onboarding, initial network topology.

---

## Decision 6: Password/Key Derivation Policy

**What:** Should the SDK enforce minimum password strength? Should Argon2 be supported from v1?

**Context:** The math shows that user-chosen passwords (~30 bits entropy) with PBKDF2-600K are brute-forceable in ~6 months by a single GPU. Argon2id (memory-hard) increases this to impractical levels.

**Options:**

| Option | Security | DX | Bundle Size |
|--------|----------|-----|-------------|
| **A. PBKDF2-600K only, no enforcement** | Adequate for strong passwords. Weak passwords remain vulnerable. | Best DX. No friction. | No change. |
| **B. PBKDF2-600K + Argon2id option** | Argon2 available for high-security contexts. | Good DX. Developer chooses. | +200KB (Argon2 WASM). |
| **C. Argon2id default, PBKDF2 fallback** | Strongest by default. PBKDF2 only where WASM unavailable. | Slightly more complex. | +200KB. |
| **D. C + entropy enforcement** | Strongest. Rejects weak passwords at SDK level. | Friction on password entry. Some developers will complain. | +200KB + entropy estimator. |

**Recommended default:** **C — Argon2id default, PBKDF2 fallback.** This is the "most long-lasting" choice. PBKDF2 is weakening every GPU generation. Argon2id is the OWASP-recommended KDF for new systems as of 2024. Making it the default means most users get the strongest protection without thinking about it. PBKDF2 fallback handles constrained environments (old browsers, edge functions without WASM).

**Sub-question:** Should the SDK reject passwords below ~40 bits estimated entropy?

**Recommended:** Yes, but as a WARNING, not a hard block. Log a warning and let the developer override. This respects SDK-user autonomy while nudging toward security.

**Unlocks:** Argon2 WASM integration, password policy implementation, key metadata schema.

---

## Decision 7: Post-Quantum Timeline

**What:** Should v1 include post-quantum cryptographic support?

**Context:** You said you want quantum support from v1. The research confirms this is achievable via hybrid schemes: use both classical (Ed25519/X25519) and post-quantum (ML-KEM/ML-DSA) algorithms. If the PQ algorithm breaks, classical still protects. If classical breaks (quantum), PQ protects.

**Options:**

| Option | Quantum Safety | Complexity | Performance |
|--------|---------------|------------|-------------|
| **A. Classical only (defer to v2)** | None. Harvest-now-decrypt-later risk. | Simplest. | Best. |
| **B. Hybrid from v1: X25519 + ML-KEM-768 for key exchange, Ed25519 + ML-DSA-65 for signatures** | Full protection. Both classical and PQ must break to compromise. | Moderate. Larger keys and signatures. | Key exchange: +1ms. Signatures: +0.5ms. Key sizes: +1KB. Signature sizes: +2KB. |
| **C. PQ-only from v1** | Full PQ protection, but if PQ algorithms have undiscovered weaknesses, no classical fallback. | Moderate. | Similar to B but slightly smaller (no classical overhead). |
| **D. Crypto-agile framework: pluggable algorithm suites** | Future-proof. Can swap algorithms without protocol changes. | Most complex upfront. | Depends on chosen suite. |

**Recommended default:** **B + D — Hybrid from v1, within a crypto-agile framework.** This follows the exact shape of b3nd's current architecture (the `[uri, data]` tuple is already algorithm-agnostic). The hybrid scheme follows NIST's recommendation (SP 800-227, draft 2024). The crypto-agile framework means you never face this decision again — when NIST finalizes new algorithms, you add a new suite without protocol changes.

**Concrete shape:**

```
Current:  sign(Ed25519) + encrypt(X25519 → AES-GCM)
Hybrid:   sign(Ed25519 + ML-DSA-65) + encrypt(X25519+ML-KEM-768 → HKDF → AES-GCM)

Key format:  { classical: Ed25519Pubkey, pq: MLDSAPubkey }
Sig format:  { classical: Ed25519Sig, pq: MLDSASig }
Both must verify for the message to be accepted.
```

**Requires Round 3 experiment:** Benchmark ML-KEM and ML-DSA in WASM (Deno) to validate the performance claims. Test key sizes against URI length limits. Verify NIST reference implementations are available and audited.

**Unlocks:** Key format design, signature verification logic, key exchange protocol, wire format changes.

---

## Quick-Answer Summary

For convenience, here are the 7 decisions as a checklist. Circle your choice or write your own:

```
1. Trust model:        [ ] Permissioned v1  [ ] Open from v1 (rec)  [ ] Hybrid  [ ] Identity-based
2. Committee params:   [ ] Fixed 3-of-5     [ ] Fixed 5-of-7        [ ] Dynamic (rec)
3. Privacy posture:    [ ] Signal-level (rec) [ ] Path-only          [ ] Email-level  [ ] Configurable
4. Fee splits:         [ ] 40/30/20/10       [ ] 25/35/25/15 (rec)  [ ] Equal  [ ] Dynamic
5. Cold-start:         [ ] Foundation nodes   [ ] Token incentives    [ ] Partners+grants (rec)
6. Key derivation:     [ ] PBKDF2 only        [ ] Argon2 option       [ ] Argon2 default (rec)
7. Post-quantum:       [ ] Defer to v2        [ ] Hybrid from v1 (rec) [ ] PQ-only  [ ] Crypto-agile
```

---

## What Your Answers Unlock

```
Decision 1 (trust model) ──────┐
Decision 2 (committee)  ───────┤──→ Consensus implementation
Decision 5 (cold-start) ───────┘    (the biggest engineering block)

Decision 3 (privacy)    ──────────→ URI design, obfuscation scope,
                                    routing protocol

Decision 4 (fees)       ──────────→ Economic mechanism, node operator
                                    incentives, treasury

Decision 6 (KDF)        ──────────→ Argon2 integration, password policy

Decision 7 (PQ)         ──────────→ Key format, signature format,
                                    wire protocol, bundle size
```

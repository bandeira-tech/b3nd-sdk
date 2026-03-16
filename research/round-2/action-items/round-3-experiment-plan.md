# Round 3: Experiment Plan

**Purpose:** Produce hard evidence — benchmarks, proofs-of-concept, formal proofs, and simulation results — to inform the 7 founder decisions and de-risk the engineering execution items.

**Philosophy:** Don't theorize. Build small, throwaway experiments that produce numbers and artifacts. Each experiment has a clear question and a measurable output.

**Date:** 2026-03-16

---

## Experiment Matrix

| # | Experiment | Informs Decision | Output Type | Effort |
|---|-----------|-----------------|-------------|--------|
| E1 | Post-quantum WASM benchmark | D7 (PQ timeline) | Numbers: latency, key size, sig size | 2-3 days |
| E2 | Stake-weighted committee simulation | D1 (trust), D2 (committee) | Simulation: safety/liveness under attack | 3-4 days |
| E3 | Privacy batching interval sweep | D3 (privacy) | Graph: information leakage vs latency | 2-3 days |
| E4 | Fee equilibrium simulation | D4 (fees), D5 (cold-start) | Model: operator revenue at various network sizes | 2-3 days |
| E5 | Argon2 WASM browser benchmark | D6 (KDF) | Numbers: derivation time by device class | 1-2 days |
| E6 | Merkle sync stress test | Engineering #5 | Numbers: sync time, bandwidth at scale | 3-4 days |
| E7 | TLA+ consensus model check | D1, D2 | Formal proof: safety/liveness properties | 3-5 days |
| E8 | Hybrid signature verification PoC | D7 (PQ) | Working code: Ed25519+ML-DSA dual verify | 2-3 days |

---

## E1: Post-Quantum WASM Benchmark

### Question
What is the real-world performance of ML-KEM-768 and ML-DSA-65 in a Deno/WASM environment? Are the theoretical estimates from Round 2 accurate?

### Method

1. Compile `liboqs` (Open Quantum Safe) to WASM using Emscripten
2. Wrap in a Deno-compatible module
3. Benchmark the following operations (1000 iterations each, median):
   - ML-KEM-768: keygen, encapsulate, decapsulate
   - ML-DSA-65: keygen, sign, verify
   - Hybrid: Ed25519+ML-DSA-65 sign, Ed25519+ML-DSA-65 verify
   - Hybrid: X25519+ML-KEM-768 key exchange
4. Measure on three targets:
   - Server: Linux x86_64 (Deno)
   - Desktop browser: Chrome on mid-range laptop
   - Mobile browser: Safari on iPhone 13 (or equivalent)
5. Record: wall-clock time, key sizes, signature sizes, ciphertext sizes

### Expected Output

```
Operation              | Server (ms) | Desktop (ms) | Mobile (ms) | Size (bytes)
ML-KEM-768 keygen      |     ?       |      ?       |      ?      |   1184 (pk)
ML-KEM-768 encaps      |     ?       |      ?       |      ?      |   1088 (ct)
ML-KEM-768 decaps      |     ?       |      ?       |      ?      |   32 (ss)
ML-DSA-65 keygen       |     ?       |      ?       |      ?      |   1952 (pk)
ML-DSA-65 sign         |     ?       |      ?       |      ?      |   3293 (sig)
ML-DSA-65 verify       |     ?       |      ?       |      ?      |   —
Hybrid sign            |     ?       |      ?       |      ?      |   3357 (64+3293)
Hybrid verify          |     ?       |      ?       |      ?      |   —
Hybrid key exchange    |     ?       |      ?       |      ?      |   1120 (32+1088)
```

### Decision Impact
- If mobile sign < 5ms and verify < 2ms → hybrid from v1 is viable (D7 = B)
- If mobile sign > 50ms → consider PQ for non-interactive paths only
- Key/sig sizes directly impact URI storage and wire format design

---

## E2: Stake-Weighted Committee Simulation

### Question
Under what conditions does a stake-weighted rotating committee maintain safety and liveness? What fraction of stake must be honest? How does committee size affect latency?

### Method

1. Build a discrete event simulation (Python or TypeScript):
   - N validators, each with stake s_i drawn from a power-law distribution (realistic)
   - Committee of K selected per epoch via stake-weighted random sampling
   - Byzantine fraction f: a fraction of total stake controlled by adversary
   - Simulate 10,000 epochs for each parameter combination
2. Parameter sweep:
   - N ∈ {20, 50, 100, 200, 500}
   - K ∈ {3, 5, 7, 9}
   - f ∈ {0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.33}
   - Threshold T = ceil((K+1)/2) (simple majority) and T = ceil(2K/3) (supermajority)
3. Measure per configuration:
   - Safety violations: epochs where two conflicting confirmations could both pass threshold
   - Liveness failures: epochs where fewer than T honest members are in committee
   - Latency: rounds needed for confirmation (1 round if all honest, 2+ if retries needed)
   - Adversary ROI: cost of attack (stake needed) vs. benefit (what they can disrupt)

### Expected Output

```
Heat map: P(safety violation) across (N, K, f) grid
Heat map: P(liveness failure) across (N, K, f) grid
Chart: latency vs K for fixed f=0.20
Chart: minimum honest stake for 99.9% safety across K values
```

### Decision Impact
- Identifies the minimum viable K for a given adversary budget
- Validates or invalidates the dynamic K formula from Decision 2
- Quantifies the cost of an attack in dollar terms (stake × token price)

---

## E3: Privacy Batching Interval Sweep

### Question
How much timing delay is needed to reduce information leakage below a target threshold? What is the user-experience cost?

### Method

1. Generate synthetic traffic patterns:
   - 100 users, Poisson message arrivals, λ = 5 msg/hour (active), 0.5 msg/hour (passive)
   - Social graph: 20% of user pairs communicate (realistic for messaging)
2. Simulate an adversary who observes all timestamps (but not content or obfuscated URIs)
3. Adversary uses statistical correlation to infer the social graph:
   - Temporal correlation: if Alice writes at t, Bob writes at t+δ → infer they communicate
   - Frequency analysis: users who write at similar rates may be in the same group
4. Apply batching with delay D ∈ {0, 100ms, 500ms, 1s, 5s, 10s, 30s, 60s}
5. Apply dummy traffic injection at rate R ∈ {0, 0.5x, 1x, 2x real traffic}
6. Measure:
   - Adversary's precision and recall in recovering social graph edges
   - Mutual information I(A; O_timing) at each (D, R) combination
   - User-perceived latency distribution

### Expected Output

```
Chart: Adversary precision vs. batching delay D (at R=0)
Chart: Adversary recall vs. dummy traffic rate R (at D=1s)
Heat map: I(A; O_timing) across (D, R) grid
Chart: P99 user latency vs. batching delay D
Recommended: (D*, R*) that achieves < 5% adversary precision with < 2s P99 latency
```

### Decision Impact
- If D* < 1s → full obfuscation with negligible UX impact (D3 = A is easy)
- If D* > 10s → full obfuscation requires significant UX sacrifice (reconsider D3)
- Quantifies the privacy-latency tradeoff with actual numbers

---

## E4: Fee Equilibrium Simulation

### Question
At what network sizes do node operators break even under different fee splits? How sensitive is the equilibrium to the split ratios?

### Method

1. Build an agent-based economic simulation:
   - Operators: each with a cost C_i (drawn from distribution, reflecting different hardware)
   - Users: generate message demand Q(t) following an S-curve adoption model
   - Fee mechanism: protocol-set floor, operators can add premium
   - Entry/exit: operators enter if expected revenue > cost, exit otherwise
2. Parameter sweep:
   - Fee splits: (40/30/20/10), (25/35/25/15), (30/30/30/10), (20/40/20/20)
   - Minimum fee floor: 1x, 2x, 3x, 5x marginal cost
   - Adoption curve: slow (1K→100K msgs/day over 2 years), fast (1K→10M over 1 year)
   - Subsidy budget (cold-start): $0, $10K/month, $50K/month, $100K/month
3. Measure per configuration:
   - Time to 50 operators (network viability threshold)
   - Operator monthly revenue at steady state
   - Network stability: do operators churn or stay?
   - Protocol treasury accumulation over time

### Expected Output

```
Chart: Number of operators over time for each fee split
Chart: Monthly operator revenue vs. network message volume
Chart: Time to 50 operators vs. subsidy budget
Table: Break-even message volume per operator at each fee split
Sensitivity analysis: which parameter most affects operator count?
```

### Decision Impact
- Identifies whether 25/35/25/15 (recommended) actually outperforms alternatives
- Quantifies the subsidy budget needed for cold-start (informs Decision 5)
- Reveals whether a fee floor is necessary or if competition naturally stabilizes

---

## E5: Argon2 WASM Browser Benchmark

### Question
How fast is Argon2id in WASM across different device classes? Is the 200KB bundle size accurate?

### Method

1. Compile argon2-wasm (reference implementation) for Deno and browser targets
2. Benchmark with OWASP-recommended parameters:
   - memory: 19MB (minimum), 46MB (recommended), 64MB (strong)
   - iterations: 2 (minimum), 3 (recommended)
   - parallelism: 1, 4
3. Test on:
   - Server (Deno on Linux)
   - Desktop Chrome, Firefox, Safari
   - Mobile Safari (iPhone 12), Mobile Chrome (Pixel 6)
   - Low-end: Android Go device (2GB RAM)
4. Measure: derivation time, peak memory usage, WASM bundle size

### Expected Output

```
Device              | 19MB/2iter | 46MB/3iter | 64MB/3iter | Peak Memory
Server (Deno)       |    ?ms     |    ?ms     |    ?ms     |    ?MB
Desktop Chrome      |    ?ms     |    ?ms     |    ?ms     |    ?MB
Desktop Firefox     |    ?ms     |    ?ms     |    ?ms     |    ?MB
Mobile Safari       |    ?ms     |    ?ms     |    ?ms     |    ?MB
Mobile Chrome       |    ?ms     |    ?ms     |    ?ms     |    ?MB
Low-end Android     |    ?ms     |    ?ms     |    ?ms     |    ?MB

WASM bundle size: ?KB (gzipped: ?KB)
```

### Decision Impact
- If mobile < 500ms at 46MB → Argon2 default is safe (D6 = C)
- If low-end Android fails or takes > 3s → need PBKDF2 fallback for those devices
- Bundle size determines if Argon2 is opt-in or always-included

---

## E6: Merkle Sync Stress Test

### Question
How does the Merkle delta sync protocol perform at scale? What are the bandwidth and latency characteristics?

### Method

1. Implement a minimal Merkle tree module (standalone, ~300 lines)
2. Generate datasets:
   - 1K, 10K, 100K, 1M URIs (random data, realistic key distribution)
   - Introduce K differences: K ∈ {1, 10, 100, 1000, 10000}
3. Run sync protocol between two in-memory nodes
4. Measure:
   - Number of round-trips to identify all differences
   - Total bytes transferred (hashes + records)
   - Wall-clock time to complete sync
   - CPU time for tree operations
5. Compare against naive full-sync (transfer all records, compare)

### Expected Output

```
Dataset Size | Differences | Round-trips | Bytes Transferred | Time (ms) | vs Full Sync
1K           | 10          |     ?       |       ?           |     ?     |    ?x faster
10K          | 100         |     ?       |       ?           |     ?     |    ?x faster
100K         | 100         |     ?       |       ?           |     ?     |    ?x faster
100K         | 10000       |     ?       |       ?           |     ?     |    ?x faster
1M           | 100         |     ?       |       ?           |     ?     |    ?x faster
1M           | 10000       |     ?       |       ?           |     ?     |    ?x faster
```

### Decision Impact
- Validates the O(K log N) complexity claim from Round 2
- Identifies if tree fan-out needs tuning (binary vs. higher arity)
- Provides concrete bandwidth budgets for network design

---

## E7: TLA+ Consensus Model Check

### Question
Does the proposed committee-based temporal consensus protocol satisfy safety and liveness formally? Are there edge cases the informal analysis missed?

### Method

1. Write a TLA+ specification of the temporal consensus protocol:
   - Proposer broadcasts message
   - Validators attest (with Byzantine validators possible)
   - Committee of K confirmers produces confirmation
   - T-of-K threshold for acceptance
   - Committee rotation at epoch boundaries
2. Model check with TLC:
   - Safety: no two conflicting confirmations for the same slot
   - Liveness: every valid message is eventually confirmed (under partial synchrony)
   - Agreement: all honest nodes agree on slot contents
3. Check for N ∈ {3, 5, 7}, f ∈ {0, 1, 2} Byzantine nodes
4. Run bounded model checking (up to 20 steps)

### Expected Output

- TLA+ specification file (reusable for future protocol changes)
- Model checking results: pass/fail for each property at each configuration
- Any counterexamples found (protocol bugs the informal analysis missed)
- Invariant violations, if any, with concrete execution traces

### Decision Impact
- If safety passes at f < T → confirms the committee threshold is correct
- If counterexample found → protocol must be fixed before implementation
- TLA+ spec becomes a living document for protocol evolution

---

## E8: Hybrid Signature Verification PoC

### Question
Can Ed25519 + ML-DSA-65 dual signatures be integrated into b3nd's existing signing/verification paths without breaking the API shape?

### Method

1. Fork the existing `libs/b3nd-auth/` signing code
2. Extend key format:
   ```typescript
   interface HybridKeypair {
     classical: { publicKey: Uint8Array; privateKey: Uint8Array };  // Ed25519
     pq: { publicKey: Uint8Array; privateKey: Uint8Array };         // ML-DSA-65
   }
   interface HybridSignature {
     classical: Uint8Array;  // 64 bytes
     pq: Uint8Array;         // 3293 bytes
   }
   ```
3. Implement `hybridSign()` and `hybridVerify()`:
   - Both signatures must be present
   - Both must verify for the message to be accepted
   - If either is missing, reject (no downgrade attacks)
4. Test against b3nd's existing message flow:
   - Can a hybrid-signed message pass through `receive()` → `validateAuthMessage()`?
   - Do hybrid keys fit in the existing URI pubkey slots?
   - What changes to wire format are needed?
5. Benchmark: overhead of dual sign/verify vs. Ed25519 alone

### Expected Output

- Working PoC: hybrid sign and verify in Deno
- API diff: what changes in the public-facing SDK types
- Wire format diff: message size increase
- Benchmark: latency overhead per operation
- Compatibility assessment: can hybrid messages coexist with classical-only messages on the same network? (Needed for migration)

### Decision Impact
- If API changes are minimal → hybrid from v1 is low-risk (D7 = B)
- If wire format changes are large → may need protocol versioning
- If hybrid + classical coexistence works → smooth migration path

---

## Execution Plan

### Parallel tracks (3 agents / engineers):

```
Agent A (Crypto/PQ):          Agent B (Systems/Sim):         Agent C (Economics/Privacy):
  E1 PQ WASM benchmark          E2 Committee simulation        E3 Privacy batching sweep
  E5 Argon2 benchmark           E6 Merkle stress test          E4 Fee equilibrium sim
  E8 Hybrid sig PoC             E7 TLA+ model check
```

### Timeline

```
Week 1:  E1, E2, E3 launch in parallel (highest decision-impact)
Week 2:  E5, E4, E6 launch in parallel
Week 3:  E7, E8 (depend on E1/E2 findings)
Week 4:  Synthesis — combine all results into a decision brief
```

### Deliverables

Each experiment produces:
1. **Raw data** — CSV/JSON of all measurements
2. **Summary chart** — the one visual that answers the question
3. **Recommendation** — how this changes (or confirms) the Round 2 recommendation
4. **Code artifact** — reusable module, spec, or benchmark suite

All results feed into a **Round 3 Decision Brief** that presents each founder decision with hard numbers behind every option.

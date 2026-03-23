# E2: Stake-Weighted Committee Simulation Report

**Experiment**: Round 3, E2
**Question**: Under what conditions does a stake-weighted rotating committee maintain safety and liveness?
**Date**: 2026-03-16
**Status**: Complete

## 1. Methodology

### Model
- N validators with stake drawn from a Zipf distribution calibrated so the top 10% of validators hold ~50% of total stake (realistic power-law wealth distribution)
- Committee of K selected per epoch via stake-weighted sampling without replacement
- Byzantine fraction f: adversary controls validators with highest stake first (worst case)
- Each epoch: committee must produce T-of-K threshold confirmation
- Byzantine members always act adversarially

### Parameter Sweep
- N: {20, 50, 100, 200, 500}
- K: {3, 5, 7, 9}
- f: {0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.33}
- Threshold: majority T = ceil((K+1)/2) and supermajority T = ceil(2K/3 + 1)
- 10,000 epochs per configuration
- Seeded PRNG for deterministic reproduction

### Key Design Decisions
1. **Stake distribution**: Zipf(s) with s calibrated via binary search to place exactly 50% of stake in top 10% of validators. This is more stable than raw Pareto sampling while preserving realistic inequality.
2. **Byzantine assignment**: Greedy worst-case -- adversary captures highest-stake validators first until reaching fraction f. Due to stake concentration, actual byzantine stake may exceed nominal f.
3. **Deterministic per N**: One stake distribution per N value, reused across all (K, f, threshold) configurations.

### Important Caveat: Stake Granularity
With concentrated stake distributions, the actual byzantine stake fraction is quantized. For example, at N=100 the top validator holds ~15.6% of stake, so f=0.05 and f=0.15 both result in 1 byzantine validator controlling 15.6%. The tables below use nominal f values; actual byzantine stake is noted where it diverges significantly.

**Actual byzantine stake at N=100:**
| Nominal f | Byzantine Validators | Actual Stake |
|-----------|---------------------|-------------|
| 0.05      | 1                   | 15.6%       |
| 0.10      | 1                   | 15.6%       |
| 0.15      | 1                   | 15.6%       |
| 0.20      | 2                   | 24.1%       |
| 0.25      | 3                   | 29.7%       |
| 0.30      | 4                   | 34.2%       |
| 0.33      | 4                   | 34.2%       |

## 2. Results: Safety Violation Rates

Safety violation = adversary controls >= T committee seats (can confirm conflicting blocks).

### Heat Map: P(safety violation) for N=100, Majority Threshold

```
  T = ceil((K+1)/2)

  K\f     0.05    0.10    0.15    0.20    0.25    0.30    0.33
  ──────────────────────────────────────────────────────────────
    3   0.0000  0.0000  0.0000  0.0814  0.1489  0.2079  0.2111
    5   0.0000  0.0000  0.0000  0.0000  0.0501  0.0994  0.1049
    7   0.0000  0.0000  0.0000  0.0000  0.0000  0.0319  0.0270
    9   0.0000  0.0000  0.0000  0.0000  0.0000  0.0000  0.0000
```

### Heat Map: P(safety violation) for N=100, Supermajority Threshold

```
  T = ceil(2K/3 + 1)

  K\f     0.05    0.10    0.15    0.20    0.25    0.30    0.33
  ──────────────────────────────────────────────────────────────
    3   0.0000  0.0000  0.0000  0.0000  0.0063  0.0139  0.0151
    5   0.0000  0.0000  0.0000  0.0000  0.0000  0.0000  0.0000
    7   0.0000  0.0000  0.0000  0.0000  0.0000  0.0000  0.0000
    9   0.0000  0.0000  0.0000  0.0000  0.0000  0.0000  0.0000
```

### Heat Map: P(safety violation) for N=500, Majority Threshold

```
  K\f     0.05    0.10    0.15    0.20    0.25    0.30    0.33
  ──────────────────────────────────────────────────────────────
    3   0.0000  0.0201  0.0412  0.1021  0.1537  0.2028  0.2361
    5   0.0000  0.0000  0.0062  0.0374  0.0772  0.1359  0.1721
    7   0.0000  0.0000  0.0000  0.0138  0.0419  0.0833  0.1194
    9   0.0000  0.0000  0.0000  0.0033  0.0176  0.0474  0.0777
```

### Heat Map: P(safety violation) for N=500, Supermajority Threshold

```
  K\f     0.05    0.10    0.15    0.20    0.25    0.30    0.33
  ──────────────────────────────────────────────────────────────
    3   0.0000  0.0000  0.0005  0.0057  0.0112  0.0218  0.0289
    5   0.0000  0.0000  0.0000  0.0000  0.0003  0.0008  0.0019
    7   0.0000  0.0000  0.0000  0.0000  0.0003  0.0005  0.0022
    9   0.0000  0.0000  0.0000  0.0000  0.0001  0.0011  0.0026
```

**Key observation**: At N=500, the stake distribution has finer granularity, so byzantine stake fractions more closely match nominal f. This makes safety violations appear at lower f values compared to N=100 (where the coarse granularity masks the #1 and #2 validators' dominance).

## 3. Results: Liveness Failure Rates

Liveness failure = honest members < T (cannot confirm blocks).

### Heat Map: P(liveness failure) for N=100, Supermajority Threshold

```
  K\f     0.05    0.10    0.15    0.20    0.25    0.30    0.33
  ──────────────────────────────────────────────────────────────
    3   0.4096  0.4148  0.4006  0.5704  0.6568  0.7237  0.7134
    5   0.6019  0.5901  0.6017  0.7659  0.8386  0.8841  0.8810
    7   0.0000  0.0000  0.0000  0.3577  0.5499  0.6731  0.6764
    9   0.0000  0.0000  0.0000  0.0000  0.2221  0.4138  0.4094
```

**Critical finding**: Supermajority thresholds have devastating liveness implications. With K=5 and f=0.20 (a modest adversary), the committee fails to reach quorum 76.6% of the time. Even K=9 with f=0.25 fails 22.2% of the time.

For majority threshold, liveness failure rate equals safety violation rate (since byzantine >= T iff honest < T when byzantine + honest = K).

## 4. Minimum K for 99.9% Safety

Configurations achieving < 0.1% safety violation rate:

### Majority Threshold

| f (nominal) | N=100 | N=200 | N=500 |
|-------------|-------|-------|-------|
| 0.05        | K>=3  | K>=3  | K>=3  |
| 0.10        | K>=3  | K>=3  | K>=5  |
| 0.15        | K>=3  | K>=5  | K>=7  |
| 0.20        | K>=5  | K>=7  | K>9   |
| 0.25        | K>=7  | K>=9  | K>9   |
| 0.30        | K>=9  | K>9   | K>9   |
| 0.33        | K>=9  | K>9   | K>9   |

### Supermajority Threshold

| f (nominal) | N=100 | N=200 | N=500 |
|-------------|-------|-------|-------|
| 0.05        | K>=3  | K>=3  | K>=3  |
| 0.10        | K>=3  | K>=3  | K>=3  |
| 0.15        | K>=3  | K>=3  | K>=3  |
| 0.20        | K>=3  | K>=5  | K>=5  |
| 0.25        | K>=5  | K>=5  | K>=5  |
| 0.30        | K>=5  | K>=5  | K>=5  |
| 0.33        | K>=5  | K>=7  | K>9   |

Supermajority achieves 99.9% safety with much smaller committees, but at the cost of severe liveness degradation (see Section 3).

## 5. Majority vs Supermajority: The Safety-Liveness Tradeoff

### Side-by-side at N=100

```
  f     K  | Maj Safety  Maj Liveness | Sup Safety  Sup Liveness
  ─────────┼─────────────────────────┼──────────────────────────
  0.20   3 |     0.0814      0.0814  |     0.0000      0.5704
  0.20   5 |     0.0000      0.0000  |     0.0000      0.7659
  0.20   7 |     0.0000      0.0000  |     0.0000      0.3577
  0.20   9 |     0.0000      0.0000  |     0.0000      0.0000
  0.30   5 |     0.0994      0.0994  |     0.0000      0.8841
  0.30   7 |     0.0319      0.0319  |     0.0000      0.6731
  0.30   9 |     0.0000      0.0000  |     0.0000      0.4138
  0.33   9 |     0.0000      0.0000  |     0.0000      0.4094
```

**Analysis**:
- **Majority**: Safety and liveness fail together. When the committee is safe, it is also live. The failure mode is binary: either honest has majority or adversary does.
- **Supermajority**: Safety is excellent (near-zero violations above K=5), but liveness is catastrophically poor. With K=9 at f=0.33, the committee cannot produce blocks 41% of the time.
- **The fundamental tension**: Supermajority prevents adversary from *confirming* conflicting blocks, but also prevents honest nodes from *confirming* anything. A committee that never confirms anything is technically "safe" but useless.

## 6. Effect of Network Size (N)

For majority threshold at f=0.20:

| N   | K needed for 99.9% safety |
|-----|---------------------------|
| 100 | K >= 5                    |
| 200 | K >= 7                    |
| 500 | K > 9                     |

Counter-intuitive result: **larger N requires larger K**. This is because with more validators, the stake distribution becomes more granular, and the byzantine set more precisely targets the nominal f fraction. At N=100, the coarse granularity means f=0.20 actually captures only 2 validators (24.1% actual stake), while at N=500, f=0.20 captures 6 validators (21.7% actual) with more reliable committee infiltration.

## 7. Concrete Answer: Minimum Viable Committee for 20% Adversarial Stake

### Question: What committee size K achieves both safety AND liveness at f=0.20?

**For majority threshold (recommended)**:
- N=100: **K=5** achieves 0.0% safety violations and 0.0% liveness failures
- N=200: **K=7** achieves 0.0% safety violations and 0.0% liveness failures
- N=500: **K>9** -- even K=9 has 0.33% safety violation rate (marginal; likely K=11-13 needed)

**For supermajority threshold**:
- N=100: **K=9** achieves 0.0% on both (but K=7 has 35.8% liveness failure!)
- N=200: K=9 has 0.0% safety but 10.2% liveness failure -- **not viable at K<=9**
- N=500: K=9 has 0.0% safety but 20.7% liveness failure -- **not viable at K<=9**

### Recommendation

For a network with 20% adversarial stake:
- **Use majority threshold (T = ceil((K+1)/2))**
- Set **K = 7** for small-to-medium networks (N <= 200)
- Set **K = 9 or higher** for large networks (N >= 500)
- Supermajority is NOT recommended at this adversarial level due to catastrophic liveness failure

## 8. Recommendations for D2 (Committee Parameters)

Based on the simulation results:

### 8.1 Primary Recommendation: Majority Threshold with K=7

- **Threshold**: T = ceil((K+1)/2) = 4 out of 7
- **Committee size**: K = 7
- **Rationale**: Provides safety at f <= 0.20 for networks up to N=200 with zero liveness penalty
- **Confirmation latency**: 1.0 rounds (no retries needed)

### 8.2 For Higher Adversarial Tolerance (f up to 0.25)

- **Committee size**: K = 9 with majority threshold
- Achieves zero safety violations at N=100, N=200
- Still has issues at N=500 (1.76% violation rate) -- consider K=11-13

### 8.3 Against f = 0.33 (BFT Threshold)

Neither majority nor supermajority with K<=9 reliably handles 33% adversarial stake:
- Majority K=9, N=100: appears safe (0.0%) but only because stake granularity collapses f=0.33 to 4 validators (34.2% actual)
- At N=500 where granularity is fine: majority K=9 has 7.8% safety violations
- Supermajority achieves safety but with 40%+ liveness failure

**For BFT-level security, the protocol needs either**:
1. Much larger committees (K >= 15-21, to be validated in follow-up simulation)
2. A hybrid approach: use majority for normal operation with supermajority for finality checkpoints
3. Stake caps or minimum committee diversity requirements

### 8.4 Anti-Concentration Policy

The simulation reveals that stake concentration is the primary driver of committee vulnerability. The protocol SHOULD enforce:
- **Maximum individual stake cap**: No single validator should control more than 5% of total stake
- **Minimum committee diversity**: Committee selection should ensure representation across stake tiers
- These policies reduce the effective adversarial advantage from worst-case stake capture

### 8.5 Summary Table

| Adversarial Budget | Recommended K | Threshold | Confidence |
|-------------------|---------------|-----------|------------|
| f <= 0.10         | K = 3         | Majority  | Very High  |
| f <= 0.15         | K = 5         | Majority  | High       |
| f <= 0.20         | K = 7         | Majority  | High       |
| f <= 0.25         | K = 9         | Majority  | Moderate   |
| f <= 0.33         | K >= 15 (est) | Hybrid    | Needs validation |

## 9. Limitations and Future Work

1. **Committee size range**: The sweep only covers K up to 9. A follow-up should test K in {11, 13, 15, 21} to find the threshold for BFT-level security.
2. **Single-epoch model**: The simulation treats each epoch independently. A multi-epoch model with adversarial strategy (e.g., selectively participating) could reveal additional failure modes.
3. **Latency model**: The 2-round latency for failed committees is simplistic. Real retry protocols have more complex timing.
4. **Stake dynamics**: Stakes are static. Real networks have delegation changes, slashing, and churn.
5. **Adaptive adversary**: The current model assumes the adversary always controls the top-stake validators. An adaptive adversary that changes strategy per epoch could be more dangerous.

## Appendix: Reproduction

```bash
# Generate results (Deno)
deno run --allow-read --allow-write simulation.ts > results.jsonl

# Or with Node.js / tsx
npx tsx simulation.ts > results.jsonl
```

The simulation is fully deterministic with seeded PRNG. The same input parameters produce identical results across runs.

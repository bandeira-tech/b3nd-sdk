# S2: Large Committee Simulation Report

**Experiment**: Round 4, S2
**Question**: What committee size K achieves BFT-level safety (f=0.33) with majority threshold and anti-whale stake caps?
**Date**: 2026-03-16
**Status**: Complete
**Depends on**: E2 (Round 3, committee simulation), E7 (Round 3, TLA+ formal analysis), Decision Brief D2

---

## 1. Background and Motivation

Round 3 Experiment E2 simulated committee sizes K=3,5,7,9 and found K=7 majority is safe for f<=0.20. The Decision Brief (D2) identified a critical open item: K>=15 simulation is needed for BFT-level (f=0.33) security. E7's formal analysis established the safety condition f < T = ceil((K+1)/2) and proposed a dynamic scaling formula K = 2f_est + 1.

This experiment extends the simulation to K up to 21 and validates whether BFT-level security is achievable with practical committee sizes.

### Key Changes from E2

1. **Extended K range**: {3, 5, 7, 9, 11, 13, 15, 17, 21}
2. **Extended N range**: added N=1000
3. **Anti-whale stake cap at 5%**: excess stake redistributed proportionally (as recommended by E2 Section 8.4 and D2)
4. **Majority threshold only**: supermajority was decisively ruled out by E2 due to catastrophic liveness failure
5. **New metrics**: committee overlap (Jaccard similarity), P(adversary >= T seats)

---

## 2. Methodology

### Model

- N validators with Zipf-distributed stake calibrated so the top 10% hold ~50% of total stake
- **Anti-whale cap**: individual stake capped at 5%; excess redistributed iteratively to uncapped validators
- Committee of K selected per epoch via stake-weighted sampling without replacement
- Byzantine fraction f: adversary controls highest-stake validators first (worst case)
- Majority threshold T = ceil((K+1)/2)
- 10,000 epochs per configuration, seeded PRNG for deterministic reproduction

### Parameter Sweep

- N: {20, 50, 100, 200, 500, 1000}
- K: {3, 5, 7, 9, 11, 13, 15, 17, 21}
- f: {0.10, 0.15, 0.20, 0.25, 0.30, 0.33}
- Total configurations: 318 (some K > N combinations excluded)

### Effect of Anti-Whale Cap

The 5% stake cap significantly changes the distribution compared to E2's uncapped simulation:

| N | Max Stake (uncapped E2) | Max Stake (5% cap) | Byzantine at f=0.33 |
|---|------------------------|-------------------|-------------------|
| 20 | ~24.0% | 5.00% | 7 validators |
| 50 | ~10.2% | 5.00% | 7 validators |
| 100 | ~15.6% | 5.00% | 8 validators |
| 200 | ~8.1% | 5.00% | 11 validators |
| 500 | ~3.5% | 5.00% | 19 validators |
| 1000 | ~1.8% | 5.00% | 32 validators |

With the cap, stake concentration is reduced, but at larger N the adversary controls more individual validators (even though each is limited to 5%). This means the adversary's committee infiltration probability is more uniform but scales with N.

---

## 3. Results: Safety Violation Rates

Safety violation = adversary controls >= T committee seats.

### Heat Map: P(safety violation) for N=100

```
  K\f     0.10    0.15    0.20    0.25    0.30    0.33
  ──────────────────────────────────────────────────────
    3   0.0155  0.0468  0.0863  0.1819  0.2108  0.2483
    5   0.0000  0.0079  0.0288  0.1008  0.1424  0.1886
    7   0.0000  0.0000  0.0057  0.0504  0.0844  0.1225
    9   0.0000  0.0000  0.0000  0.0190  0.0465  0.0729
   11   0.0000  0.0000  0.0000  0.0043  0.0158  0.0411
   13   0.0000  0.0000  0.0000  0.0000  0.0043  0.0145
   15   0.0000  0.0000  0.0000  0.0000  0.0000  0.0044
   17   0.0000  0.0000  0.0000  0.0000  0.0000  0.0000
   21   0.0000  0.0000  0.0000  0.0000  0.0000  0.0000
```

### Heat Map: P(safety violation) for N=500

```
  K\f     0.10    0.15    0.20    0.25    0.30    0.33
  ──────────────────────────────────────────────────────
    3   0.0303  0.0473  0.0979  0.1421  0.2030  0.2543
    5   0.0043  0.0108  0.0442  0.0813  0.1416  0.1971
    7   0.0000  0.0017  0.0185  0.0424  0.0953  0.1349
    9   0.0000  0.0000  0.0054  0.0217  0.0597  0.0977
   11   0.0000  0.0000  0.0007  0.0081  0.0329  0.0679
   13   0.0000  0.0000  0.0002  0.0026  0.0187  0.0472
   15   0.0000  0.0000  0.0000  0.0009  0.0111  0.0275
   17   0.0000  0.0000  0.0000  0.0001  0.0055  0.0173
   21   0.0000  0.0000  0.0000  0.0000  0.0002  0.0054
```

### Heat Map: P(safety violation) for N=1000

```
  K\f     0.10    0.15    0.20    0.25    0.30    0.33
  ──────────────────────────────────────────────────────
    3   0.0213  0.0588  0.0957  0.1418  0.2140  0.2491
    5   0.0025  0.0176  0.0450  0.0908  0.1517  0.1930
    7   0.0000  0.0040  0.0189  0.0489  0.1008  0.1363
    9   0.0000  0.0011  0.0066  0.0260  0.0681  0.1069
   11   0.0000  0.0001  0.0022  0.0151  0.0438  0.0809
   13   0.0000  0.0000  0.0013  0.0059  0.0291  0.0568
   15   0.0000  0.0000  0.0001  0.0021  0.0166  0.0399
   17   0.0000  0.0000  0.0000  0.0007  0.0104  0.0241
   21   0.0000  0.0000  0.0000  0.0001  0.0030  0.0114
```

**Key observation**: The E2 finding that larger N requires larger K is confirmed and amplified. With anti-whale caps, the adversary at N=1000 controls 32 validators at f=0.33, making committee infiltration highly probable even for large K. At N=1000, even K=21 shows 1.14% safety violation rate at f=0.33.

---

## 4. Minimum K for 99.9% Safety

Configurations achieving < 0.1% safety violation rate:

| N\\f | 0.10 | 0.15 | 0.20 | 0.25 | 0.30 | 0.33 |
|------|------|------|------|------|------|------|
| 20 | K>=5 | K>=7 | K>=9 | K>=11 | K>=13 | K>=15 |
| 50 | K>=5 | K>=7 | K>=9 | K>=11 | K>=13 | K>=15 |
| 100 | K>=5 | K>=7 | K>=9 | K>=13 | K>=15 | K>=17 |
| 200 | K>=5 | K>=9 | K>=11 | K>=15 | K>=17 | K>=21 |
| 500 | K>=7 | K>=9 | K>=11 | K>=15 | K>=21 | K>21 |
| 1000 | K>=7 | K>=11 | K>=15 | K>=17 | K>21 | K>21 |

### Comparison with E2 (uncapped stakes)

| f | E2 (N=100, uncapped) | S2 (N=100, 5% cap) |
|---|---------------------|-------------------|
| 0.10 | K>=3 | K>=5 |
| 0.15 | K>=3 | K>=7 |
| 0.20 | K>=5 | K>=9 |
| 0.25 | K>=7 | K>=13 |
| 0.30 | K>=9 | K>=15 |
| 0.33 | K>=9 | K>=17 |

**Critical finding**: The 5% anti-whale cap *increases* the minimum required K compared to E2's uncapped simulation. This is because capping redistributes stake more evenly, which means the adversary controls *more validators* for the same stake fraction. With uncapped stakes at N=100, f=0.33 captured only 4 validators (coarse granularity); with the cap it captures 8 validators, making it far easier to infiltrate a committee.

This is an important tradeoff: anti-whale caps reduce the damage from a single compromised validator but increase the adversary's representation in random committees. The cap is still recommended because it prevents catastrophic single-validator compromise, but it does require larger committees.

---

## 5. Probability of Adversary Reaching Threshold (f=0.33)

P(byzantine on committee >= T), the critical danger zone:

```
  K\N      20      50     100     200     500    1000
  ──────────────────────────────────────────────────────
    3   0.2710  0.2601  0.2483  0.2527  0.2543  0.2491
    5   0.1996  0.1862  0.1886  0.1918  0.1971  0.1930
    7   0.1512  0.1264  0.1225  0.1258  0.1349  0.1363
    9   0.1024  0.0781  0.0729  0.0866  0.0977  0.1069
   11   0.0567  0.0335  0.0411  0.0508  0.0679  0.0809
   13   0.0244  0.0107  0.0145  0.0285  0.0472  0.0568
   15   0.0000  0.0000  0.0044  0.0150  0.0275  0.0399
   17   0.0000  0.0000  0.0000  0.0045  0.0173  0.0241
   21     -     0.0000  0.0000  0.0001  0.0054  0.0114
```

At f=0.33 with BFT-level adversary:
- **K=15**: achieves <1% danger probability only for N<=50
- **K=17**: achieves <1% danger probability for N<=100
- **K=21**: achieves <1% danger probability for N<=200, but still 0.54% at N=500 and 1.14% at N=1000

For large networks (N>=500), even K=21 does not fully contain a 33% adversary.

---

## 6. Committee Overlap Analysis

Average Jaccard similarity between consecutive epoch committees:

```
  K\N      20      50     100     200     500    1000
  ──────────────────────────────────────────────────────
    3   0.0949  0.0562  0.0400  0.0277  0.0179  0.0126
    5   0.1547  0.0880  0.0611  0.0423  0.0270  0.0189
    7   0.2223  0.1192  0.0826  0.0567  0.0353  0.0245
    9   0.2981  0.1530  0.1037  0.0696  0.0429  0.0298
   11   0.3869  0.1854  0.1229  0.0826  0.0505  0.0352
   13   0.4867  0.2198  0.1427  0.0944  0.0575  0.0399
   15   0.6031  0.2537  0.1618  0.1059  0.0643  0.0442
   17   0.7410  0.2875  0.1797  0.1171  0.0704  0.0487
   21     -     0.3561  0.2150  0.1377  0.0816  0.0558
```

**Analysis**:
- Overlap scales as approximately K/N (the expected proportion of overlap for random sampling without replacement). For K=15, N=100: expected overlap ~ 15/100 = 0.15, observed = 0.162. Close to theoretical.
- **Small networks are problematic**: at N=20, K=17 gives 74% overlap -- the committee is nearly identical every epoch, defeating the purpose of rotation.
- **Large networks have negligible overlap**: at N=1000, K=21 gives 5.6% overlap. Each epoch's committee is almost entirely fresh.
- **Recommendation**: committee size should not exceed N/3 to maintain meaningful rotation. For K=15, this means N >= 45; for K=21, N >= 63.

---

## 7. Validation of Dynamic Scaling Formula: K = 2f_est + 1

E7 established the formal safety condition: f < T = ceil((K+1)/2), yielding the formula K >= 2f + 1 where f is the *number* of Byzantine validators (not stake fraction).

### Empirical Validation

When K >= 2 * (number of byzantine validators) + 1, safety violation rate:

| f (nominal) | All configs with K >= formula | Fraction safe (<0.1%) |
|-------------|------------------------------|----------------------|
| 0.10 | 45 / 45 | **100%** |
| 0.15 | 36 / 36 | **100%** |
| 0.20 | 26 / 26 | **100%** |
| 0.25 | 17 / 17 | **100%** |
| 0.30 | 11 / 11 | **100%** |
| 0.33 | 7 / 7 | **100%** |

**The formula K = 2f_count + 1 holds perfectly in all 142 tested configurations.** Every configuration where K meets or exceeds the formula achieves < 0.1% safety violation rate.

This is expected from E7's formal proof: if the total number of Byzantine validators is f_count, and K >= 2*f_count + 1, then T = ceil((K+1)/2) >= f_count + 1 > f_count, satisfying the safety condition exactly.

### Practical Implication

The formula works for the *count* of Byzantine validators, not the stake fraction. With a 5% stake cap:

| f (stake) | N=100 | N=500 | N=1000 | Formula K |
|-----------|-------|-------|--------|-----------|
| 0.10 | 2 byz -> K>=5 | 3 byz -> K>=7 | 3 byz -> K>=7 |
| 0.20 | 4 byz -> K>=9 | 7 byz -> K>=15 | 10 byz -> K>=21 |
| 0.33 | 8 byz -> K>=17 | 19 byz -> K>=39 | 32 byz -> K>=65 |

**The formula reveals a fundamental scalability problem**: as N grows, the 5% cap means f=0.33 translates to more Byzantine validators, requiring proportionally larger committees. For N=1000 at f=0.33, the formula demands K=65 -- clearly impractical.

---

## 8. Updated Parameter Recommendation Table

### For Networks with Anti-Whale Cap (5%)

| Adversarial Budget | N <= 100 | N <= 200 | N <= 500 | N <= 1000 | Confidence |
|-------------------|----------|----------|----------|-----------|------------|
| f <= 0.10 | K = 5 | K = 5 | K = 7 | K = 7 | Very High |
| f <= 0.15 | K = 7 | K = 9 | K = 9 | K = 11 | High |
| f <= 0.20 | K = 9 | K = 11 | K = 11 | K = 15 | High |
| f <= 0.25 | K = 13 | K = 15 | K = 15 | K = 17 | Moderate |
| f <= 0.30 | K = 15 | K = 17 | K = 21 | K > 21 | Low |
| f <= 0.33 | K = 17 | K = 21 | K > 21 | K > 21 | Low |

### Comparison with E2 Recommendation (D2)

| f | D2 Recommendation | S2 Recommendation (N<=200) | Change |
|---|-------------------|---------------------------|--------|
| <= 0.10 | K = 3 | K = 5 | +2 (anti-whale cap effect) |
| <= 0.15 | K = 5 | K = 9 | +4 |
| <= 0.20 | K = 7 | K = 11 | +4 |
| <= 0.25 | K = 9 | K = 15 | +6 |
| <= 0.33 | K >= 15 (est) | K = 21 | +6 |

D2's estimate of K>=15 for f=0.33 was optimistic. With the recommended 5% anti-whale cap, K=15 only works for N<=50. For N=200, K=21 is needed. For N>=500, K=21 is insufficient.

---

## 9. BFT-Level Security Recommendation (f=0.33)

### The Core Problem

Achieving BFT-level security (tolerating 33% adversarial stake) with small committees and anti-whale caps is fundamentally constrained:

1. **The cap creates more adversarial validators**: 33% stake with 5% cap means at least ceil(0.33/0.05) = 7 adversarial validators, even at the smallest N. At N=1000, it means 32.
2. **The formula K = 2f_count + 1 demands large committees**: K=65 at N=1000 is impractical for per-epoch committee rotation.
3. **Even K=21 fails at N>=500**: 0.54% safety violation rate is unacceptable for a production system.

### Recommended Approach: Tiered Security

Rather than one-size-fits-all BFT tolerance, implement tiered committee sizing:

| Network Size | Target f | Recommended K | Safety Rate |
|-------------|----------|---------------|-------------|
| N <= 50 | 0.33 | K = 15 | < 0.01% |
| N <= 100 | 0.33 | K = 17 | < 0.01% |
| N <= 200 | 0.33 | K = 21 | < 0.01% |
| N <= 500 | 0.25 | K = 15 | < 0.1% |
| N <= 1000 | 0.20 | K = 15 | < 0.01% |

For large networks (N >= 500) requiring f=0.33 tolerance, the protocol needs one of:

1. **Raise the stake cap** to 10% or higher (reduces adversarial validator count but increases single-validator risk)
2. **Multi-round confirmation**: require multiple independent committees to confirm, making adversarial control of all committees exponentially unlikely
3. **Hybrid approach**: use K=15 majority for normal operation, with a larger finality committee (K=31+) for checkpoint finality every F epochs
4. **Accept a higher safety bound**: 1-2% safety violation rate may be tolerable if combined with economic penalties (slashing) that make attacks costly

### Recommended Default Configuration

For the initial deployment:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| K (starting) | 11 | Safe for f<=0.20 at N<=500 with margin |
| K (elevated) | 17 | Safe for f<=0.33 at N<=100 |
| K (maximum) | 21 | Safe for f<=0.33 at N<=200 |
| Stake cap | 5% | Anti-concentration, as recommended by D2 |
| Scaling trigger | Attestation anomaly detection | Per E7 Section 6.5 |

---

## 10. Key Findings Summary

1. **BFT-level security (f=0.33) requires K=17 for N<=100 and K=21 for N<=200** with 5% anti-whale cap. This is significantly larger than D2's estimate of K>=15.

2. **Anti-whale caps increase minimum K by 4-6** compared to uncapped simulations. The cap is still essential for preventing single-validator catastrophic compromise, but its committee-level cost must be accounted for.

3. **The E7 formula K = 2f_count + 1 holds perfectly** across all 142 tested configurations. It is the exact safety boundary. However, translating stake fraction f to validator count f_count is N-dependent and cap-dependent, limiting the formula's utility as a simple heuristic.

4. **Large networks (N>=500) cannot achieve f=0.33 safety with K<=21.** This is a fundamental result: as N grows, the adversary's representation grows proportionally, requiring impractically large committees. Alternative mechanisms (multi-round confirmation, hybrid finality) are needed.

5. **Committee overlap is negligible for N>=100 with K<=21.** Overlap is approximately K/N and does not pose a rotation problem for production configurations.

6. **The safety-liveness equivalence** (E7 Section 4.2) is confirmed: for majority threshold, safety violations and liveness failures occur at the same rate across all configurations, as expected.

---

## 11. Limitations

1. **Static adversary**: Byzantine validators are fixed. Adaptive corruption during execution is not modeled.
2. **Single-epoch independence**: Each epoch is independent. Multi-epoch attacks (e.g., adversary waiting for a favorable committee) are not captured.
3. **No committee grinding**: The simulation assumes honest randomness. VRF grinding resistance is assumed but not tested.
4. **Cap redistribution model**: The proportional redistribution after capping is one choice; alternative redistribution policies could yield different results.
5. **K > 21 not explored**: For large N at f=0.33, the exact threshold was not found. Based on the formula, K=39 (N=500) and K=65 (N=1000) are predicted, but unverified by simulation.

---

## Appendix: Reproduction

```bash
# Run simulation (Deno)
deno run --allow-read --allow-write simulate.ts > results.jsonl

# Or with Node.js / tsx
npx tsx simulate.ts > results.jsonl

# Diagnostic output goes to stderr; results (JSONL) go to stdout
```

The simulation is fully deterministic with seeded PRNG (base seed 42). The same parameters produce identical results across runs. Total configurations: 318. Runtime: approximately 30 seconds on a modern machine.

# Experiment E3: Privacy Batching Interval Sweep

## Round 3 Research -- b3nd Protocol

**Date**: 2026-03-16
**Status**: Complete (108 configurations, 100 trials each)

---

## 1. Executive Summary

This experiment quantifies the privacy-latency tradeoff for timing obfuscation in b3nd.
We simulate 100 users with a sparse social graph (~250 edges), generating realistic
conversation traffic over 1 hour, and measure how well a global passive adversary can
infer the social graph from message timing alone.

**Key finding**: The temporal correlation attack achieves at most ~20% precision (60s
correlation window) with no defenses. Dummy traffic at 2x rate reduces this to ~15%.
Batching delay alone has negligible impact on adversary precision -- it quantizes
timestamps but preserves relative ordering within batches. The combination of R=2.0
dummy traffic plus any batching level pushes precision to ~14.5-15%, which is 3x the
random baseline of 5.05% but represents a weak signal that is not operationally useful
for graph reconstruction.

**Bottom line**: At D=2s with R=2.0, adversary precision is 15.0% with P99 latency of
1,981ms. This is the optimal operating point balancing privacy and UX. The adversary
cannot reliably reconstruct the social graph at any configuration.

---

## 2. Methodology

### Traffic Model
- 100 users, ~250 undirected edges (avg degree ~5)
- Active conversations: Poisson, lambda=5 msg/hour per edge
- Background noise: 0.5 msg/hour per user
- Response model: 70% probability, U(1s, 60s) delay

### Adversary
- Global passive: observes all write timestamps for all users
- Temporal correlation attack: for each user pair, counts co-occurring writes within window
- Normalized score = count / sqrt(writes_i * writes_j)
- Predicts top-K=250 pairs (matching true edge count -- best-case for adversary)
- Windows tested: 5s, 30s, 60s

### Defenses
- Batching delay D: messages released at ceil(t/D)*D boundaries
- Dummy traffic R: each user injects R * real_rate additional random writes

### Baseline
- Random predictor precision: 250 / C(100,2) = 250/4950 = **5.05%**

---

## 3. Adversary F1 Score Heat Map (window=60s, strongest adversary)

```
Adversary F1 Score (%) -- 60s correlation window

         R=0.0    R=0.5    R=1.0    R=2.0
       +--------+--------+--------+--------+
D=0    | 20.5   | 17.1   | 15.5   | 15.3   |
D=0.1  | 20.7   | 16.9   | 15.8   | 15.2   |
D=0.5  | 20.6   | 16.8   | 15.9   | 15.3   |
D=1    | 20.6   | 17.0   | 15.7   | 15.0   |
D=2    | 20.2   | 17.1   | 16.1   | 15.0   |
D=5    | 20.6   | 16.8   | 15.9   | 15.3   |
D=10   | 19.9   | 16.6   | 15.7   | 15.0   |
D=30   | 19.0   | 16.6   | 15.7   | 15.1   |
D=60   | 17.8   | 15.9   | 15.3   | 14.9   |
       +--------+--------+--------+--------+

Legend: Values closer to 5.05% = better privacy (random baseline)
        Values > 15% = adversary has meaningful signal
```

### F1 Score Heat Map (window=30s)

```
         R=0.0    R=0.5    R=1.0    R=2.0
       +--------+--------+--------+--------+
D=0    | 17.9   | 15.7   | 15.1   | 14.9   |
D=0.1  | 17.9   | 15.6   | 15.4   | 15.1   |
D=0.5  | 17.8   | 16.1   | 15.1   | 14.8   |
D=1    | 18.0   | 15.7   | 15.3   | 15.1   |
D=2    | 17.8   | 16.0   | 15.2   | 15.2   |
D=5    | 18.2   | 16.0   | 15.5   | 14.9   |
D=10   | 18.4   | 16.1   | 15.4   | 14.9   |
D=30   | 19.4   | 16.5   | 15.8   | 15.1   |
D=60   | 17.6   | 15.8   | 15.3   | 15.0   |
       +--------+--------+--------+--------+
```

### F1 Score Heat Map (window=5s)

```
         R=0.0    R=0.5    R=1.0    R=2.0
       +--------+--------+--------+--------+
D=0    |  9.1   | 9.9    | 10.9   | 12.2   |
D=0.1  |  9.3   | 9.8    | 10.9   | 12.4   |
D=0.5  |  9.3   | 9.8    | 11.3   | 12.3   |
D=1    |  9.7   | 10.0   | 11.3   | 12.3   |
D=2    |  9.3   | 10.0   | 11.1   | 12.4   |
D=5    | 10.8   | 11.1   | 12.2   | 13.4   |
D=10   |  9.4   | 10.3   | 10.9   | 12.2   |
D=30   | 14.3   | 14.2   | 14.2   | 14.3   |
D=60   | 17.8   | 15.9   | 15.0   | 14.6   |
       +--------+--------+--------+--------+

Note: At D>=30s with 5s window, batching collapses all messages into
discrete time slots, creating artificial co-occurrence that INCREASES
adversary signal. This is a critical insight.
```

---

## 4. Precision and Recall vs D (at R=0, window=60s)

```
D (sec) | Precision | Recall  | F1     | P50 (ms) | P99 (ms)
--------|-----------|---------|--------|----------|----------
  0     | 0.2047    | 0.2047  | 0.2047 |       0  |       0
  0.1   | 0.2070    | 0.2070  | 0.2070 |      50  |      99
  0.5   | 0.2059    | 0.2059  | 0.2059 |     250  |     495
  1     | 0.2056    | 0.2056  | 0.2056 |     500  |     990
  2     | 0.2021    | 0.2021  | 0.2021 |   1,006  |   1,980
  5     | 0.2062    | 0.2062  | 0.2062 |   2,498  |   4,950
 10     | 0.1990    | 0.1990  | 0.1990 |   5,014  |   9,902
 30     | 0.1904    | 0.1904  | 0.1904 |  14,963  |  29,698
 60     | 0.1783    | 0.1783  | 0.1783 |  29,850  |  59,377
```

**Observation**: Precision is nearly flat from D=0 to D=10 (~20%), only dropping
to ~18% at D=60s. Batching alone is an extremely inefficient defense.

Note: Precision equals recall because the adversary predicts exactly K=250 edges
(matching the true edge count). This is the adversary's optimal strategy.

---

## 5. Precision vs D (at R=0, all windows)

```
Precision (%)
22|
20| * * * * * * * . .      <- window=60s
18| . . . . . . . * *
16|
14|
12|
10|                        <- window=5s (see below)
 8| * * * * *
 6|           * *
 4|                        5.05% random baseline
 2|
 0+--+--+--+--+--+--+--+--+--> D
   0 .1 .5  1  2  5 10 30 60

window=5s:  9.1  9.3  9.3  9.7  9.3 10.8  9.4 14.3 17.8
window=30s: 17.9 17.9 17.8 18.0 17.8 18.2 18.4 19.4 17.6
window=60s: 20.5 20.7 20.6 20.6 20.2 20.6 19.9 19.0 17.8
```

---

## 6. Latency Distribution

```
D (sec) | P50 Latency | P99 Latency | Notes
--------|-------------|-------------|-------------------------------
  0     |       0 ms  |       0 ms  | No defense
  0.1   |      50 ms  |      99 ms  | Imperceptible
  0.5   |     250 ms  |     495 ms  | Acceptable for messaging
  1     |     500 ms  |     990 ms  | Noticeable but tolerable
  2     |   1,000 ms  |   1,980 ms  | Limit of acceptable UX
  5     |   2,500 ms  |   4,950 ms  | Degraded UX
 10     |   5,000 ms  |   9,900 ms  | Poor UX
 30     |  15,000 ms  |  29,700 ms  | Unusable for interactive chat
 60     |  30,000 ms  |  59,400 ms  | Unusable
```

Latency follows the expected uniform distribution: P50 ~ D/2, P99 ~ D.
This is because message arrival within a batch interval is uniform.

---

## 7. Optimal Operating Point (D*, R*)

### Target: <5% adversary precision with <2s P99 latency

**This target is not achievable.** The random baseline for predicting 250 edges
among 4950 possible pairs is 5.05%. Pushing adversary precision below 5% would
require the adversary to perform _worse_ than random, which is not possible with
a reasonable attack strategy.

### Revised target: minimize adversary advantage with <2s P99 latency

The adversary advantage = precision - random_baseline (5.05%).

```
Config              | Precision | Advantage | P99 (ms) | Feasible?
--------------------|-----------|-----------|----------|----------
D=0,   R=0          | 20.5%     | +15.4%    |       0  | yes
D=0,   R=2          | 15.3%     | +10.3%    |       0  | yes
D=2,   R=0          | 20.2%     | +15.2%    |  1,980   | yes
D=2,   R=2          | 15.0%     | +10.0%    |  1,981   | yes (*)
D=1,   R=2          | 15.0%     | +10.0%    |    990   | yes (**)
D=0.5, R=2          | 15.3%     | +10.3%    |    495   | yes
```

**Optimal point**: **D=1s, R=2.0** achieves 15.0% precision (10% above random)
with P99 latency of only 990ms. Adding more batching beyond 1s provides no
additional privacy benefit but increases latency.

If latency budget is generous: **D=2s, R=2.0** achieves the same 15.0% precision
with P99 = 1,981ms.

---

## 8. Recommendation for D3 (Privacy Posture)

### Is Signal-level privacy achievable with acceptable UX?

**No, not through timing obfuscation alone.** Signal achieves metadata privacy through
sealed sender (hiding sender identity from server) and forward secrecy, not through
timing obfuscation. Our simulation confirms that:

1. **Batching delay is nearly useless as a standalone defense.** Precision drops only
   from 20.5% to 17.8% even at D=60s (a 3 percentage point improvement for 60 seconds
   of added latency). This is because batching quantizes timestamps but the adversary
   simply uses a wider correlation window.

2. **Dummy traffic provides moderate improvement.** R=2.0 (tripling total writes)
   reduces precision from ~20% to ~15% regardless of D. But this comes at 3x the
   storage and bandwidth cost.

3. **The residual signal is structural, not temporal.** Even with maximum defenses
   (D=60, R=2), precision remains at 14.9% -- nearly 3x random chance. This is because
   users with more edges generate more traffic, and the adversary can exploit activity
   volume correlations that survive both batching and dummy injection.

### Recommended configuration for b3nd:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Batch delay D | **1 second** | Minimal UX impact (P99 < 1s), provides timestamp quantization |
| Dummy rate R | **1.0** | Doubles write volume, reduces adversary precision by ~25% relative |
| Additional | **Constant-rate padding** | See below |

### Additional defenses needed (beyond this simulation):

1. **Constant-rate traffic padding**: Instead of proportional dummy traffic (R multiplier),
   pad all users to the same constant write rate. This eliminates volume-based correlation.
   Estimated to push adversary precision to near-random.

2. **PIR (Private Information Retrieval)**: Prevents the server from learning which URIs
   are read, complementing write-side timing obfuscation.

3. **Mixnet-style reordering**: Within each batch, randomly permute message ordering.
   Combined with constant-rate padding, this provides statistical unlinkability.

---

## 9. Key Insight: Most Cost-Effective Defense

**Dummy traffic is more cost-effective than batching, but neither is sufficient alone.**

The data shows a clear hierarchy:

```
Defense             | Precision drop | Cost
--------------------|---------------|---------------------------
Batching D=2s       | 20.5 -> 20.2  | 2s added latency
Dummy R=2.0         | 20.5 -> 15.3  | 3x storage/bandwidth
Both D=2, R=2       | 20.5 -> 15.0  | 2s latency + 3x storage
Constant-rate pad*  | 20.5 -> ~5%   | ~10x storage (estimated)
```

*Constant-rate padding not simulated but projected from the observation that residual
signal comes from volume correlation.

**The most cost-effective single defense is dummy traffic at R=1.0** (doubling writes),
which reduces precision from 20.5% to 15.5% -- a 25% relative reduction. Adding batching
on top provides negligible additional benefit until D exceeds the adversary's correlation
window (60s), at which point latency is already unacceptable.

**The real answer is architectural**: timing obfuscation through batching and dummy traffic
is fighting the wrong battle. The adversary's power comes from observing _volume_ patterns,
not precise timing. The protocol should instead:

1. Use constant-rate write padding (all users write at the same rate)
2. Use short batching (D=1s) for timestamp quantization only
3. Invest the complexity budget in PIR and sealed sender rather than timing defense

---

## 10. Raw Data Summary

Total configurations evaluated: 108
Trials per configuration: 100
Social graph: 250 edges among 100 users (fixed across trials)
Simulation duration: 1 hour per trial
PRNG seed: 42 (master), 12345 (graph)

### Best adversary performance (no defense):
- window=60s: precision=20.47%, recall=20.47%, F1=20.47%
- window=30s: precision=17.88%, recall=17.88%, F1=17.88%
- window=5s:  precision=9.11%,  recall=9.11%,  F1=9.11%

### Worst adversary performance (max defense D=60, R=2):
- window=60s: precision=14.87%, recall=14.87%, F1=14.87%
- window=30s: precision=14.98%, recall=14.98%, F1=14.98%
- window=5s:  precision=14.57%, recall=14.57%, F1=14.57%

### Critical threshold finding:
At no tested configuration does adversary precision drop below 5%.
The minimum achievable precision with temporal correlation attacks is bounded
below by the random baseline of 5.05%, and the structural volume signal
keeps it well above that at ~15%.

---

## Appendix: Reproduction

```bash
# Deno
deno run --allow-write simulation.ts > results.jsonl

# Node.js (via tsx)
npx tsx simulation.ts > results.jsonl
```

Output: JSON lines to stdout, progress to stderr, results.json written to same directory.

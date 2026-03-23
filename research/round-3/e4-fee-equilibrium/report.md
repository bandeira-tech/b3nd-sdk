# E4: Fee Equilibrium Simulation — Results

**Experiment**: Agent-based simulation of operator economics under b3nd fee splits
**Date**: 2026-03-16
**Configurations**: 192 parameter combinations x 50 runs = 9,600 simulations
**Time horizon**: 36 months, monthly steps

## Model Summary

- **Operators**: Monthly cost drawn from lognormal (median $50, range $20-$200)
- **Entry**: Expected revenue > 1.2x cost
- **Exit**: Revenue < 0.8x cost for 3 consecutive months
- **Demand**: S-curve adoption (logistic function)
- **Roles**: Storage (50%), Validator (35%), Confirmer (15%) of new entrants

---

## 1. Break-Even Table

Messages/day needed for a **single operator per role** to earn $50/month (median cost):

| Fee Floor | Split        | Storage | Validator | Confirmer |
|-----------|--------------|--------:|----------:|----------:|
| $0.001    | 40/30/20/10  |   4,167 |     5,556 |     8,334 |
| $0.001    | 25/35/25/15  |   6,667 |     4,762 |     6,667 |
| $0.001    | 30/30/30/10  |   5,556 |     5,556 |     5,556 |
| $0.001    | 20/40/20/20  |   8,334 |     4,167 |     8,334 |
| $0.002    | 40/30/20/10  |   2,084 |     2,778 |     4,167 |
| $0.002    | 25/35/25/15  |   3,334 |     2,381 |     3,334 |
| $0.002    | 30/30/30/10  |   2,778 |     2,778 |     2,778 |
| $0.002    | 20/40/20/20  |   4,167 |     2,084 |     4,167 |
| $0.005    | 25/35/25/15  |   1,334 |       953 |     1,334 |
| $0.010    | 25/35/25/15  |     667 |       477 |       667 |

**Key insight**: At the $0.002 fee floor with balanced split (30/30/30/10), break-even is ~2,778 msgs/day per operator role — achievable within the first month of any adoption curve.

Revenue per operator at different network sizes ($0.002 fee, 25/35/25/15 split):

| Msgs/day    | Total Rev/mo | Per-op (10 ops) | Per-op (50 ops) | Per-op (100 ops) |
|-------------|-------------|-----------------|-----------------|------------------|
| 1,000       | $60         | $5              | $1              | $1               |
| 10,000      | $600        | $51             | $10             | $5               |
| 50,000      | $3,000      | $255            | $51             | $26              |
| 100,000     | $6,000      | $510            | $102            | $51              |
| 500,000     | $30,000     | $2,550          | $510            | $255             |
| 1,000,000   | $60,000     | $5,100          | $1,020          | $510             |

The break-even point for 50 operators at $0.002/msg is ~50,000 msgs/day ($51/op vs $50 median cost).

---

## 2. Operator Growth Over Time

Medium adoption (1K to 1M msgs/day over 18 months), $0.002 fee floor, no subsidy:

```
Month | 40/30/20/10  25/35/25/15  30/30/30/10  20/40/20/20
------+----------------------------------------------------
 M1   |      14           14           14           13
 M3   |      30           28           29           27
 M6   |      58           56           57           53
 M9   |      88           85           86           83
 M12  |     118          116          117          112
 M18  |     178          175          176          172
 M24  |     238          234          236          229
 M30  |     297          290          292          283
 M36  |     354          344          347          332
```

```
  Operators (medium adoption, $0.002, no subsidy)

  40/30/20/10:
  M 6 | ████████                                           58
  M12 | ████████████████                                  118
  M18 | ████████████████████████                          178
  M24 | ████████████████████████████████                  238
  M30 | ████████████████████████████████████████          297
  M36 | ██████████████████████████████████████████████████ 354

  25/35/25/15:
  M 6 | ████████                                           56
  M12 | ████████████████                                  116
  M18 | ████████████████████████                          175
  M24 | █████████████████████████████████                 234
  M30 | █████████████████████████████████████████         290
  M36 | ████████████████████████████████████████████████  344

  20/40/20/20:
  M 6 | ███████                                            53
  M12 | ████████████████                                  112
  M18 | ████████████████████████                          172
  M24 | ████████████████████████████████                  229
  M30 | ████████████████████████████████████████          283
  M36 | ██████████████████████████████████████████████    332
```

Slow adoption ($0.001 fee, 25/35/25/15 split):

```
  M 3 | █         2
  M 6 | ██        7
  M12 | ██████   24
  M18 | ████████████ 47
  M24 | ████████████████ 62
  M30 | ██████████████████ 71
  M36 | ███████████████████ 77
```

All splits show near-linear growth in the medium scenario because demand growth outpaces operator entry (capped at ~10 candidates/month). Splits primarily affect the **composition** rather than total count.

---

## 3. Subsidy Impact

### Time to reach 50 operators (medium adoption, $0.002 fee):

| Split        | No subsidy | $10K/mo | $50K/mo | $100K/mo |
|--------------|-----------|---------|---------|----------|
| 40/30/20/10  | M6        | M5      | M5      | M5       |
| 25/35/25/15  | M6        | M5      | M5      | M5       |
| 30/30/30/10  | M6        | M5      | M5      | M5       |
| 20/40/20/20  | M6        | M5      | M5      | M5       |

At medium adoption, subsidy provides only **1 month acceleration** — demand grows fast enough that organic economics kick in quickly.

### Where subsidy matters: Slow adoption + low fees

Operators at M6 (medium, $0.002):

| Split        | $0K   | $10K  | $50K  | $100K |
|--------------|-------|-------|-------|-------|
| 40/30/20/10  | 58    | 65    | 65    | 65    |
| 25/35/25/15  | 56    | 65    | 65    | 65    |

### The subsidy cliff problem

With slow adoption and $0.001 fee floor (25/35/25/15 split):

| Subsidy | Ops at M12 | Ops at M18 (post-subsidy) | Ops at M36 |
|---------|-----------|--------------------------|-----------|
| $0K     | 24        | 47                       | 77        |
| $10K    | 117       | —                        | 72        |
| $50K    | 125       | 37                       | 71        |
| $100K   | 125       | 36                       | 71        |

**Critical finding**: Subsidy creates a cliff. At $50K/month subsidy, operators surge to 125 by M12, but when subsidy expires at M13, demand cannot support them. Operators mass-exit back to ~37, **below** the no-subsidy trajectory (which would have been 47 at M18). The subsidy actually *hurts* long-term stability by attracting operators who cannot survive on organic fees.

The no-subsidy path ($0K) reaches 77 operators at M36, slightly *more* than the subsidized paths (71-73), because operator entry tracks organic demand more naturally.

---

## 4. Fee Split Stability

Coefficient of variation of operator count (months 18-36, medium adoption, $0.002):

| Split        | Median Ops (M36) | Std Dev (M18-36) | CoV   |
|--------------|-----------------|-----------------|-------|
| 40/30/20/10  | 354             | 53.6            | 0.201 |
| 25/35/25/15  | 344             | 51.2            | 0.197 |
| 30/30/30/10  | 347             | 52.2            | 0.198 |
| 20/40/20/20  | 332             | 49.0            | 0.192 |

**Most stable**: 20/40/20/20 (CoV = 0.192) — but at the cost of lowest operator count.
**Best tradeoff**: 25/35/25/15 (CoV = 0.197) with higher operator count than 20/40/20/20.

The differences are small (CoV range: 0.192-0.201). Fee split has minimal impact on stability — it is the **least sensitive** parameter. The variation is dominated by the PRNG-driven cost distribution and candidate arrival, not the split itself.

Treasury accumulation at M36 (medium, $0.002, no subsidy):

| Split        | Treasury |
|--------------|----------|
| 40/30/20/10  | $164,832 |
| 25/35/25/15  | $247,248 |
| 30/30/30/10  | $164,832 |
| 20/40/20/20  | $329,664 |

The 20/40/20/20 split accumulates 2x the treasury of 40/30/20/10, creating a larger protocol war chest but reducing per-operator incentives.

---

## 5. Sensitivity Analysis

Starting from baseline (25/35/25/15, $0.002, medium adoption, $0 subsidy) = **344 operators at M36**:

| Parameter Changed       | Value    | Operators at M36 | Delta  |
|------------------------|----------|-----------------|--------|
| **Adoption curve**     | slow     | 123             | **-221** |
| **Adoption curve**     | fast     | 365             | +21    |
| **Fee floor**          | $0.001   | 290             | **-54**  |
| **Fee floor**          | $0.005   | 364             | +20    |
| **Fee floor**          | $0.010   | 365             | +21    |
| **Fee split**          | 40/30/20/10 | 354          | +10    |
| **Fee split**          | 20/40/20/20 | 331          | -13    |
| **Subsidy**            | $10K     | 349             | +5     |
| **Subsidy**            | $100K    | 348             | +4     |

### Ranking by impact (largest to smallest):

1. **Adoption rate** — by far the dominant factor (delta: -221 to +21)
2. **Fee floor** — significant at the low end ($0.001 loses 54 operators)
3. **Fee split** — minor effect (range: -13 to +10)
4. **Subsidy** — negligible at medium+ adoption (delta: +4 to +5)

**The single parameter that most affects operator viability is the adoption rate.** Fee floor is a distant second. Fee split and subsidy are noise-level influences in the medium-to-fast growth regime.

In the slow-growth regime, fee floor becomes the dominant lever:
- Slow + $0.001: 77 operators at M36
- Slow + $0.002: 123 operators at M36
- Slow + $0.005: 212 operators at M36

Doubling the fee from $0.001 to $0.002 adds 60% more operators under slow adoption.

---

## 6. Recommendations

### D4 — Fee Splits

**Recommended: 25/35/25/15** (validation-heavy)

Rationale:
- Nearly identical operator growth to the storage-heavy split (344 vs 354 at M36 — 3% difference)
- Slightly better stability (CoV 0.197 vs 0.201)
- Higher validator share incentivizes the security-critical role
- 15% protocol treasury accumulates $247K over 36 months at medium adoption — sufficient for grants and development without starving operators
- Balanced enough that no single role becomes the bottleneck for network liveness

If treasury reserves are a priority (e.g., for protocol development funding), consider **30/30/30/10** as an alternative — it achieves near-identical operator economics while keeping 10% protocol share modest.

**Avoid 20/40/20/20**: The 20% protocol take creates the largest treasury ($330K) but produces the fewest operators (332 vs 354 for storage-heavy). The 20% storage/confirmer shares create the highest break-even thresholds for those roles.

### D5 — Cold-Start Strategy

**Recommended: Fee floor of $0.002 + targeted subsidy with taper**

Key findings that inform the cold-start design:

1. **Subsidy is only needed for slow adoption scenarios.** At medium+ growth, organic economics sustain operators from M5-M6 onward.

2. **Flat subsidy creates a cliff.** The M12 cutoff causes mass operator exit. A taper schedule (e.g., 100% months 1-6, 50% months 7-12, 25% months 13-18) would smooth the transition.

3. **$10K/month subsidy is sufficient.** Going from $10K to $100K produces zero additional benefit — operator entry is constrained by the candidate pool, not by economics, once the minimum revenue threshold is met.

4. **Fee floor matters more than subsidy.** Moving from $0.001 to $0.002 adds more operators than any subsidy amount. Set the floor at $0.002 from day one rather than relying on subsidy to compensate for a too-low floor.

Proposed cold-start plan:
- Set fee floor at **$0.002/message** (not lower)
- Budget **$10K-$20K/month** subsidy for months 1-12, with linear taper from M6
- Target **10,000 msgs/day** within first 3 months (achievable minimum for 10+ operators)
- Monitor operator count monthly; increase fee floor to $0.005 if operators < 20 at M6

---

## 7. Key Number

### Minimum viable network size for self-sustaining economics:

**~50,000 messages/day** at $0.002/msg fee floor

At this volume:
- Total monthly fee revenue: $3,000
- Per-operator revenue (50 ops): ~$51/month
- Exceeds median operator cost ($50/month)
- No subsidy required
- All fee splits produce viable economics

For a minimal network (10 operators):
- **~10,000 messages/day** at $0.002/msg ($600/month total, ~$51/op)

For the absolute floor (5 bootstrap operators):
- **~5,000 messages/day** at $0.002/msg ($300/month, ~$51/op)

At $0.001/msg, all thresholds double. At $0.005/msg, they drop by 60%.

---

## Simulation Artifacts

- `simulation.ts` — Agent-based model (Deno/Bun compatible)
- `results.jsonl` — 345,600 data points (192 configs x 50 runs x 36 months)
- `analyze.ts`, `analyze2.ts` — Analysis scripts
- `analysis_output.txt`, `analysis_output2.txt` — Raw analysis output

## Limitations

1. **Candidate pool cap**: Fixed at 10 candidates/month. In practice, operator entry rate would depend on awareness, tooling availability, and word-of-mouth — likely non-linear.
2. **Homogeneous demand**: All messages pay the same fee. Real demand would include varying message sizes and priority tiers.
3. **No geographic effects**: Operator costs vary significantly by region. A multi-region model would show faster entry in low-cost regions.
4. **No reputation/slashing**: The model does not account for operator quality or penalty mechanisms that would affect effective returns.
5. **Revenue sharing is uniform within role**: In practice, storage operators serving more data would earn more. This simplification overstates the break-even threshold for high-volume operators and understates it for low-volume ones.

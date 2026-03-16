#!/usr/bin/env python3
"""
S2: Large Committee Simulation for BFT-Level Security
======================================================

Extends Round 3 E2 committee simulation to larger committee sizes (K up to 21)
to find the minimum K needed for f=0.33 Byzantine tolerance.

Model:
  - N validators with stake drawn from Zipf distribution (top 10% hold ~50% stake)
  - 5% anti-whale stake cap applied after generation
  - Committee of K selected per epoch via stake-weighted sampling without replacement
  - Byzantine fraction f: adversary controls highest-stake validators first (worst case)
  - Majority threshold T = ceil((K+1)/2)
  - 10,000 epochs per configuration

Tracks:
  - Safety violations: Byzantine members >= T on committee
  - Liveness failures: Honest members < T on committee
  - Committee overlap between consecutive epochs

Uses both Monte Carlo simulation and analytical (hypergeometric) computation.

Usage:
    python simulation.py              # Run full simulation
    python simulation.py --analytical # Analytical mode only (no randomness)
    python simulation.py --quick      # Quick run (1000 epochs, subset of configs)
"""

import math
import sys
import json
import time
from collections import defaultdict
from typing import NamedTuple, Dict, List, Tuple

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

COMMITTEE_SIZES = [9, 11, 13, 15, 17, 21]
NETWORK_SIZES = [50, 100, 200, 500, 1000]
BYZANTINE_FRACTIONS = [0.20, 0.25, 0.30, 0.33, 0.40]
EPOCHS = 10_000
ANTI_WHALE_CAP = 0.05  # 5% max individual stake
SEED = 42

# For comparison with E2
E2_OVERLAP_K = [7, 9]
E2_OVERLAP_N = [50, 100, 200]


class Config(NamedTuple):
    N: int
    K: int
    f: float


class Result(NamedTuple):
    config: Config
    safety_violations: int
    liveness_failures: int
    epochs: int
    safety_rate: float
    liveness_rate: float
    safety_ci_lower: float
    safety_ci_upper: float
    liveness_ci_lower: float
    liveness_ci_upper: float
    mean_overlap: float
    overlap_std: float
    analytical_safety: float
    analytical_liveness: float
    byzantine_validators: int
    actual_byzantine_stake: float


# ---------------------------------------------------------------------------
# Stake Distribution
# ---------------------------------------------------------------------------

def generate_zipf_stakes(N: int, rng=None) -> List[float]:
    """
    Generate Zipf-distributed stakes for N validators, calibrated so
    top 10% hold ~50% of total stake. Apply 5% anti-whale cap.
    """
    # Zipf with s ~ 1.0 gives reasonable power-law distribution
    # Binary search for s that puts 50% in top 10%
    best_s = 1.0
    best_err = float('inf')

    for s_candidate_x10 in range(5, 25):  # s from 0.5 to 2.5
        s = s_candidate_x10 / 10.0
        raw = [1.0 / (i ** s) for i in range(1, N + 1)]
        total = sum(raw)
        stakes = [r / total for r in raw]
        top_10_count = max(1, N // 10)
        top_10_stake = sum(sorted(stakes, reverse=True)[:top_10_count])
        err = abs(top_10_stake - 0.50)
        if err < best_err:
            best_err = err
            best_s = s

    raw = [1.0 / (i ** best_s) for i in range(1, N + 1)]
    total = sum(raw)
    stakes = [r / total for r in raw]

    # Apply anti-whale cap: cap each validator at ANTI_WHALE_CAP, redistribute excess
    capped = apply_stake_cap(stakes)
    return capped


def apply_stake_cap(stakes: List[float]) -> List[float]:
    """Apply anti-whale cap iteratively until no validator exceeds the cap."""
    cap = ANTI_WHALE_CAP
    result = list(stakes)
    for _ in range(100):  # iterate until convergence
        excess = 0.0
        uncapped_count = 0
        for i, s in enumerate(result):
            if s > cap:
                excess += s - cap
                result[i] = cap
            else:
                uncapped_count += 1
        if excess < 1e-12:
            break
        # Redistribute excess proportionally among uncapped validators
        if uncapped_count == 0:
            break
        uncapped_total = sum(s for s in result if s < cap)
        if uncapped_total < 1e-12:
            break
        for i in range(len(result)):
            if result[i] < cap:
                result[i] += excess * (result[i] / uncapped_total)

    # Normalize
    total = sum(result)
    return [s / total for s in result]


def assign_byzantine(stakes: List[float], f: float) -> Tuple[int, float]:
    """
    Assign Byzantine identity to highest-stake validators first until
    cumulative stake >= f. Returns (count_byzantine, actual_byzantine_stake).
    """
    indexed = sorted(enumerate(stakes), key=lambda x: -x[1])
    cum_stake = 0.0
    count = 0
    for idx, stake in indexed:
        if cum_stake >= f:
            break
        cum_stake += stake
        count += 1
    return count, cum_stake


# ---------------------------------------------------------------------------
# Analytical: Hypergeometric Distribution
# ---------------------------------------------------------------------------

def log_comb(n: int, k: int) -> float:
    """Log of binomial coefficient C(n, k) using lgamma."""
    if k < 0 or k > n:
        return float('-inf')
    return math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)


def hypergeometric_pmf(k: int, N: int, K_total: int, n: int) -> float:
    """
    P(X = k) where X ~ Hypergeometric(N, K_total, n).
    N = population size
    K_total = number of success states in population (Byzantine validators)
    n = number of draws (committee size)
    k = number of observed successes (Byzantine on committee)
    """
    if k < max(0, n - (N - K_total)) or k > min(n, K_total):
        return 0.0
    log_p = (log_comb(K_total, k) +
             log_comb(N - K_total, n - k) -
             log_comb(N, n))
    return math.exp(log_p)


def analytical_safety_violation(N: int, K: int, byz_count: int) -> float:
    """
    P(safety violation) = P(Byzantine on committee >= T)
    where T = ceil((K+1)/2), using hypergeometric distribution.

    Note: This assumes uniform random committee selection. With stake-weighted
    selection AND anti-whale cap, the probability may differ. The hypergeometric
    gives the baseline for comparison.
    """
    T = math.ceil((K + 1) / 2)
    prob = 0.0
    for b in range(T, min(K, byz_count) + 1):
        prob += hypergeometric_pmf(b, N, byz_count, K)
    return prob


def analytical_liveness_failure(N: int, K: int, byz_count: int) -> float:
    """
    P(liveness failure) = P(honest on committee < T)
    = P(Byzantine on committee > K - T)
    For majority threshold, this equals the safety violation rate.
    """
    T = math.ceil((K + 1) / 2)
    # Honest < T iff Byzantine > K - T
    # Since Byzantine + Honest = K, honest < T means byz >= K - T + 1
    threshold_byz = K - T + 1
    prob = 0.0
    for b in range(threshold_byz, min(K, byz_count) + 1):
        prob += hypergeometric_pmf(b, N, byz_count, K)
    return prob


def analytical_expected_overlap(N: int, K: int) -> float:
    """
    Expected overlap between two independently selected committees of size K
    from N validators (uniform selection without replacement).

    E[overlap] = K * (K-1)/(N-1) + K/N ... more precisely:
    E[|A ∩ B|] = K^2 / N for large N, but exactly:
    E[|A ∩ B|] = sum over v of P(v in A) * P(v in B)

    For uniform selection: P(v in committee) = K/N for each v.
    For independent committees: E[overlap] = N * (K/N)^2 = K^2/N

    For stake-weighted selection: P(v in committee) depends on stake.
    E[overlap] = sum_v P(v in A) * P(v in B) where P(v) ~ stake_v * K.
    """
    # Uniform case (lower bound with anti-whale cap making stakes more uniform)
    return K * K / N


def analytical_overlap_stakeweighted(stakes: List[float], K: int) -> float:
    """
    Expected overlap for stake-weighted selection.
    P(v selected) ≈ min(1, K * stake_v) for small K relative to N.
    E[overlap] = sum_v P(v in A) * P(v in B)

    More precisely, for sampling without replacement with weights,
    the inclusion probability is approximately K * w_i / sum(w) for
    each item i. With the anti-whale cap, this is bounded.
    """
    N = len(stakes)
    total_stake = sum(stakes)
    overlap = 0.0
    for s in stakes:
        p = min(1.0, K * s / total_stake)
        overlap += p * p
    return overlap


# ---------------------------------------------------------------------------
# Monte Carlo Simulation (PRNG-based)
# ---------------------------------------------------------------------------

class LCG:
    """Simple linear congruential generator for deterministic simulation."""

    def __init__(self, seed: int):
        self.state = seed & 0xFFFFFFFFFFFFFFFF

    def next(self) -> int:
        # Parameters from Numerical Recipes
        self.state = (self.state * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return self.state

    def random(self) -> float:
        return (self.next() >> 11) / (1 << 53)

    def weighted_sample_without_replacement(self, weights: List[float], k: int) -> List[int]:
        """
        Select k items without replacement, weighted by `weights`.
        Uses Efraimidis-Spirakis algorithm: assign key = u^(1/w) for each item,
        take the k largest keys.
        """
        n = len(weights)
        if k >= n:
            return list(range(n))

        # Generate keys
        keys = []
        for i in range(n):
            u = self.random()
            while u == 0.0:
                u = self.random()
            # key = u^(1/w); take log for numerical stability: log(key) = log(u)/w
            if weights[i] > 1e-15:
                key = math.log(u) / weights[i]
            else:
                key = float('-inf')
            keys.append((key, i))

        # Select k items with largest keys
        keys.sort(reverse=True)
        return [idx for _, idx in keys[:k]]


def wilson_confidence_interval(successes: int, trials: int, z: float = 1.96) -> Tuple[float, float]:
    """
    Wilson score interval for binomial proportion. More accurate than
    normal approximation for small p or small n.
    """
    if trials == 0:
        return (0.0, 1.0)
    p_hat = successes / trials
    denominator = 1 + z * z / trials
    centre = (p_hat + z * z / (2 * trials)) / denominator
    spread = z * math.sqrt((p_hat * (1 - p_hat) + z * z / (4 * trials)) / trials) / denominator
    lower = max(0.0, centre - spread)
    upper = min(1.0, centre + spread)
    return (lower, upper)


def run_simulation(config: Config, stakes: List[float], byzantine_set: set,
                   epochs: int, rng: LCG) -> Result:
    """
    Run Monte Carlo simulation for a single configuration.
    """
    N, K, f = config
    T = math.ceil((K + 1) / 2)

    safety_violations = 0
    liveness_failures = 0
    overlaps = []
    prev_committee = None

    for epoch in range(epochs):
        # Select committee via stake-weighted sampling
        committee = rng.weighted_sample_without_replacement(stakes, K)
        committee_set = set(committee)

        # Count Byzantine members on committee
        byz_on_committee = len(committee_set & byzantine_set)
        honest_on_committee = K - byz_on_committee

        # Safety violation: Byzantine >= T
        if byz_on_committee >= T:
            safety_violations += 1

        # Liveness failure: Honest < T
        if honest_on_committee < T:
            liveness_failures += 1

        # Committee overlap with previous epoch
        if prev_committee is not None:
            overlap = len(committee_set & prev_committee)
            overlaps.append(overlap)
        prev_committee = committee_set

    # Compute statistics
    safety_rate = safety_violations / epochs
    liveness_rate = liveness_failures / epochs

    safety_ci = wilson_confidence_interval(safety_violations, epochs)
    liveness_ci = wilson_confidence_interval(liveness_failures, epochs)

    mean_overlap = sum(overlaps) / len(overlaps) if overlaps else 0.0
    overlap_std = (
        math.sqrt(sum((x - mean_overlap) ** 2 for x in overlaps) / len(overlaps))
        if overlaps else 0.0
    )

    # Analytical comparison
    byz_count = len(byzantine_set)
    a_safety = analytical_safety_violation(N, K, byz_count)
    a_liveness = analytical_liveness_failure(N, K, byz_count)

    return Result(
        config=config,
        safety_violations=safety_violations,
        liveness_failures=liveness_failures,
        epochs=epochs,
        safety_rate=safety_rate,
        liveness_rate=liveness_rate,
        safety_ci_lower=safety_ci[0],
        safety_ci_upper=safety_ci[1],
        liveness_ci_lower=liveness_ci[0],
        liveness_ci_upper=liveness_ci[1],
        mean_overlap=mean_overlap,
        overlap_std=overlap_std,
        analytical_safety=a_safety,
        analytical_liveness=a_liveness,
        byzantine_validators=byz_count,
        actual_byzantine_stake=sum(stakes[i] for i in byzantine_set),
    )


# ---------------------------------------------------------------------------
# Full Analytical Sweep (no randomness required)
# ---------------------------------------------------------------------------

def run_analytical_sweep() -> List[Result]:
    """
    Compute analytical (hypergeometric) probabilities for all configurations.
    This is exact for uniform sampling and approximate for stake-weighted.
    """
    results = []

    for N in NETWORK_SIZES:
        stakes = generate_zipf_stakes(N)

        for f in BYZANTINE_FRACTIONS:
            byz_count, actual_byz_stake = assign_byzantine(stakes, f)
            byzantine_set = set(
                idx for idx, _ in sorted(enumerate(stakes), key=lambda x: -x[1])[:byz_count]
            )

            for K in COMMITTEE_SIZES:
                if K > N:
                    continue

                config = Config(N=N, K=K, f=f)
                a_safety = analytical_safety_violation(N, K, byz_count)
                a_liveness = analytical_liveness_failure(N, K, byz_count)
                e_overlap = analytical_expected_overlap(N, K)
                sw_overlap = analytical_overlap_stakeweighted(stakes, K)

                results.append(Result(
                    config=config,
                    safety_violations=0,
                    liveness_failures=0,
                    epochs=0,
                    safety_rate=a_safety,
                    liveness_rate=a_liveness,
                    safety_ci_lower=a_safety,
                    safety_ci_upper=a_safety,
                    liveness_ci_lower=a_liveness,
                    liveness_ci_upper=a_liveness,
                    mean_overlap=sw_overlap,
                    overlap_std=0.0,
                    analytical_safety=a_safety,
                    analytical_liveness=a_liveness,
                    byzantine_validators=byz_count,
                    actual_byzantine_stake=actual_byz_stake,
                ))

    return results


# ---------------------------------------------------------------------------
# Full Monte Carlo Sweep
# ---------------------------------------------------------------------------

def run_monte_carlo_sweep(epochs: int = EPOCHS) -> List[Result]:
    """Run Monte Carlo simulation for all configurations."""
    results = []
    rng = LCG(SEED)
    total_configs = 0

    for N in NETWORK_SIZES:
        stakes = generate_zipf_stakes(N)

        for f in BYZANTINE_FRACTIONS:
            byz_count, actual_byz_stake = assign_byzantine(stakes, f)
            byzantine_set = set(
                idx for idx, _ in sorted(enumerate(stakes), key=lambda x: -x[1])[:byz_count]
            )

            for K in COMMITTEE_SIZES:
                if K > N:
                    continue

                config = Config(N=N, K=K, f=f)
                total_configs += 1

                result = run_simulation(config, stakes, byzantine_set, epochs, rng)
                results.append(result)

                print(f"  [{total_configs:3d}] N={N:4d} K={K:2d} f={f:.2f} | "
                      f"safety={result.safety_rate:.6f} "
                      f"[{result.safety_ci_lower:.6f}, {result.safety_ci_upper:.6f}] | "
                      f"liveness={result.liveness_rate:.6f} | "
                      f"overlap={result.mean_overlap:.2f} | "
                      f"byz_validators={result.byzantine_validators} "
                      f"byz_stake={result.actual_byzantine_stake:.3f} | "
                      f"analytical_safety={result.analytical_safety:.6f}",
                      file=sys.stderr)

    return results


# ---------------------------------------------------------------------------
# Output Formatting
# ---------------------------------------------------------------------------

def format_results_table(results: List[Result]) -> str:
    """Format results as readable tables grouped by N."""
    lines = []

    for N in NETWORK_SIZES:
        lines.append(f"\n{'='*80}")
        lines.append(f"N = {N}")
        lines.append(f"{'='*80}")

        # Safety table
        lines.append(f"\nSafety Violation Rate (majority threshold T = ceil((K+1)/2)):")
        header = f"  K\\f   " + "  ".join(f"  {f:.2f}  " for f in BYZANTINE_FRACTIONS)
        lines.append(header)
        lines.append("  " + "-" * (len(header) - 2))

        for K in COMMITTEE_SIZES:
            if K > N:
                continue
            T = math.ceil((K + 1) / 2)
            row = f"  {K:2d} (T={T:2d})"
            for f in BYZANTINE_FRACTIONS:
                r = next((r for r in results
                          if r.config.N == N and r.config.K == K
                          and abs(r.config.f - f) < 0.001), None)
                if r:
                    row += f"  {r.safety_rate:.6f}"
                else:
                    row += "       -  "
            lines.append(row)

        # Liveness table
        lines.append(f"\nLiveness Failure Rate:")
        lines.append(header)
        lines.append("  " + "-" * (len(header) - 2))

        for K in COMMITTEE_SIZES:
            if K > N:
                continue
            T = math.ceil((K + 1) / 2)
            row = f"  {K:2d} (T={T:2d})"
            for f in BYZANTINE_FRACTIONS:
                r = next((r for r in results
                          if r.config.N == N and r.config.K == K
                          and abs(r.config.f - f) < 0.001), None)
                if r:
                    row += f"  {r.liveness_rate:.6f}"
                else:
                    row += "       -  "
            lines.append(row)

        # Overlap table
        lines.append(f"\nMean Committee Overlap (consecutive epochs):")
        lines.append(f"  K\\f   " + "  ".join(f"  {f:.2f}  " for f in BYZANTINE_FRACTIONS))
        lines.append("  " + "-" * (len(header) - 2))

        for K in COMMITTEE_SIZES:
            if K > N:
                continue
            row = f"  {K:2d}      "
            for f in BYZANTINE_FRACTIONS:
                r = next((r for r in results
                          if r.config.N == N and r.config.K == K
                          and abs(r.config.f - f) < 0.001), None)
                if r:
                    row += f"  {r.mean_overlap:8.2f}"
                else:
                    row += "       -  "
            lines.append(row)

    return "\n".join(lines)


def results_to_jsonl(results: List[Result]) -> str:
    """Export results as JSON Lines for further processing."""
    lines = []
    for r in results:
        d = {
            "N": r.config.N,
            "K": r.config.K,
            "f": r.config.f,
            "T": math.ceil((r.config.K + 1) / 2),
            "safety_rate": r.safety_rate,
            "liveness_rate": r.liveness_rate,
            "safety_ci_95": [r.safety_ci_lower, r.safety_ci_upper],
            "liveness_ci_95": [r.liveness_ci_lower, r.liveness_ci_upper],
            "mean_overlap": r.mean_overlap,
            "overlap_std": r.overlap_std,
            "analytical_safety": r.analytical_safety,
            "analytical_liveness": r.analytical_liveness,
            "byzantine_validators": r.byzantine_validators,
            "actual_byzantine_stake": r.actual_byzantine_stake,
            "epochs": r.epochs,
        }
        lines.append(json.dumps(d))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# BFT Boundary Analysis
# ---------------------------------------------------------------------------

def find_minimum_k_for_target(target_safety: float = 0.001) -> Dict:
    """
    For each (N, f), find the minimum K from COMMITTEE_SIZES that achieves
    safety violation rate < target_safety, using analytical computation.
    """
    table = {}
    for N in NETWORK_SIZES:
        stakes = generate_zipf_stakes(N)
        for f in BYZANTINE_FRACTIONS:
            byz_count, _ = assign_byzantine(stakes, f)
            min_k = None
            for K in sorted(COMMITTEE_SIZES):
                if K > N:
                    continue
                p = analytical_safety_violation(N, K, byz_count)
                if p < target_safety:
                    min_k = K
                    break
            table[(N, f)] = min_k if min_k else f">{max(COMMITTEE_SIZES)}"
    return table


def validate_dynamic_scaling():
    """
    Validate the formula K = 2*f_est + 1 from E7.
    For each f (as a count of Byzantine validators), check if K = 2f+1
    actually provides safety.
    """
    results = []
    for N in NETWORK_SIZES:
        stakes = generate_zipf_stakes(N)
        for f_frac in BYZANTINE_FRACTIONS:
            byz_count, actual_stake = assign_byzantine(stakes, f_frac)
            k_formula = 2 * byz_count + 1

            if k_formula <= N:
                p_safety = analytical_safety_violation(N, k_formula, byz_count)
                T = math.ceil((k_formula + 1) / 2)
                results.append({
                    "N": N,
                    "f_frac": f_frac,
                    "byz_count": byz_count,
                    "K_formula": k_formula,
                    "T": T,
                    "safety_violation_prob": p_safety,
                    "safe": p_safety < 0.001,
                    "condition_f_lt_T": byz_count < T,
                })
    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    mode = "analytical"
    if "--monte-carlo" in sys.argv:
        mode = "monte-carlo"
    elif "--quick" in sys.argv:
        mode = "quick"

    print("=" * 70, file=sys.stderr)
    print("S2: Large Committee Simulation", file=sys.stderr)
    print(f"Mode: {mode}", file=sys.stderr)
    print(f"Committee sizes: {COMMITTEE_SIZES}", file=sys.stderr)
    print(f"Network sizes: {NETWORK_SIZES}", file=sys.stderr)
    print(f"Byzantine fractions: {BYZANTINE_FRACTIONS}", file=sys.stderr)
    print(f"Anti-whale cap: {ANTI_WHALE_CAP*100:.0f}%", file=sys.stderr)
    print("=" * 70, file=sys.stderr)

    # Show stake distributions
    print("\nStake distribution summary (with 5% anti-whale cap):", file=sys.stderr)
    for N in NETWORK_SIZES:
        stakes = generate_zipf_stakes(N)
        top10_count = max(1, N // 10)
        top10_stake = sum(sorted(stakes, reverse=True)[:top10_count])
        max_stake = max(stakes)
        print(f"  N={N:4d}: max_stake={max_stake:.4f} "
              f"top_10%_stake={top10_stake:.3f} "
              f"min_stake={min(stakes):.6f}", file=sys.stderr)

        # Show Byzantine assignment details
        for f in BYZANTINE_FRACTIONS:
            byz_count, actual_stake = assign_byzantine(stakes, f)
            print(f"    f={f:.2f}: {byz_count:3d} byzantine validators, "
                  f"actual_stake={actual_stake:.4f}", file=sys.stderr)

    if mode == "monte-carlo":
        print(f"\nRunning Monte Carlo simulation ({EPOCHS} epochs per config)...",
              file=sys.stderr)
        results = run_monte_carlo_sweep(EPOCHS)
    elif mode == "quick":
        print(f"\nRunning quick Monte Carlo simulation (1000 epochs)...",
              file=sys.stderr)
        results = run_monte_carlo_sweep(1000)
    else:
        print(f"\nRunning analytical sweep (hypergeometric distribution)...",
              file=sys.stderr)
        results = run_analytical_sweep()

    # Print formatted tables to stderr
    print(format_results_table(results), file=sys.stderr)

    # BFT boundary analysis
    print("\n" + "=" * 70, file=sys.stderr)
    print("BFT Boundary: Minimum K for <0.1% safety violation rate", file=sys.stderr)
    print("=" * 70, file=sys.stderr)
    min_k_table = find_minimum_k_for_target(0.001)
    header = f"  N\\f   " + "  ".join(f"  {f:.2f}" for f in BYZANTINE_FRACTIONS)
    print(header, file=sys.stderr)
    print("  " + "-" * (len(header) - 2), file=sys.stderr)
    for N in NETWORK_SIZES:
        row = f"  {N:4d}  "
        for f in BYZANTINE_FRACTIONS:
            val = min_k_table.get((N, f), "?")
            if isinstance(val, int):
                row += f"  K={val:2d}"
            else:
                row += f"  {val:>4s}"
        print(row, file=sys.stderr)

    # Dynamic scaling validation
    print("\n" + "=" * 70, file=sys.stderr)
    print("Dynamic Scaling Validation: K = 2*byz_count + 1", file=sys.stderr)
    print("=" * 70, file=sys.stderr)
    ds_results = validate_dynamic_scaling()
    for r in ds_results:
        status = "SAFE" if r["safe"] else "UNSAFE"
        cond = "YES" if r["condition_f_lt_T"] else "NO"
        print(f"  N={r['N']:4d} f={r['f_frac']:.2f} byz={r['byz_count']:3d} "
              f"K={r['K_formula']:3d} T={r['T']:2d} "
              f"P(violation)={r['safety_violation_prob']:.8f} "
              f"f<T={cond:3s} [{status}]", file=sys.stderr)

    # Output JSONL to stdout
    print(results_to_jsonl(results))


if __name__ == "__main__":
    main()

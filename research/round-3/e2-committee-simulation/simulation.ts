/**
 * E2: Stake-Weighted Committee Simulation
 * ========================================
 * Discrete event simulation for b3nd protocol consensus mechanism.
 *
 * Answers: Under what conditions does a stake-weighted rotating committee
 * maintain safety and liveness?
 *
 * Uses seeded PRNG and hypergeometric-style sampling for deterministic results.
 * Deno-compatible TypeScript.
 */

// ─── Seeded PRNG (xoshiro128**) ────────────────────────────────────────────

class SeededRNG {
  private s: Uint32Array;

  constructor(seed: number) {
    // SplitMix32 to initialize state from a single seed
    this.s = new Uint32Array(4);
    let z = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9e3779b9) >>> 0;
      let t = z ^ (z >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t ^ (t >>> 15);
      this.s[i] = t >>> 0;
    }
  }

  /** Clone the RNG state */
  clone(): SeededRNG {
    const c = new SeededRNG(0);
    c.s.set(this.s);
    return c;
  }

  /** Returns a float in [0, 1) */
  random(): number {
    const s = this.s;
    const result = Math.imul(s[1] * 5, 1 << 7 | 1) >>> 0;
    const t = (s[1] << 9) >>> 0;

    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11 | s[3] >>> 21) >>> 0;

    return (result >>> 0) / 0x100000000;
  }

  /** Returns an integer in [0, max) */
  randInt(max: number): number {
    return Math.floor(this.random() * max);
  }
}

// ─── Stake distribution ────────────────────────────────────────────────────

/**
 * Generate a power-law stake distribution where the top 10% hold ~50% of stake.
 *
 * Uses a Zipf-like distribution: stake_i = 1/rank^s, where s is calibrated so
 * the top 10% hold approximately 50% of total stake. For large N, s ~ 0.85
 * achieves this. Stakes are sorted by rank (index 0 = highest stake).
 *
 * This approach is deterministic (no RNG needed for the base distribution),
 * with small jitter added for realism.
 */
function generateStakes(n: number, rng: SeededRNG): number[] {
  // Zipf exponent calibrated for top-10% ~ 50% of stake
  // Binary search for the right exponent
  const targetTop10 = 0.50;
  const top10count = Math.max(1, Math.ceil(n * 0.1));

  let sLow = 0.1, sHigh = 3.0;
  let sBest = 0.85;
  for (let iter = 0; iter < 50; iter++) {
    const sMid = (sLow + sHigh) / 2;
    let total = 0, top10sum = 0;
    for (let i = 1; i <= n; i++) {
      const v = 1 / Math.pow(i, sMid);
      total += v;
      if (i <= top10count) top10sum += v;
    }
    const ratio = top10sum / total;
    if (ratio > targetTop10) {
      sHigh = sMid;
    } else {
      sLow = sMid;
    }
    sBest = sMid;
  }

  // Generate Zipf stakes with small jitter
  const rawStakes: number[] = [];
  for (let i = 1; i <= n; i++) {
    const base = 1 / Math.pow(i, sBest);
    // Add 5% jitter
    const jitter = 1 + (rng.random() - 0.5) * 0.1;
    rawStakes.push(base * jitter);
  }

  // Normalize to sum to 1
  const total = rawStakes.reduce((a, b) => a + b, 0);
  return rawStakes.map((s) => s / total);
}

// ─── Stake-weighted sampling without replacement ───────────────────────────

/**
 * Select K validators from N using stake-weighted sampling without replacement.
 * This is the exact hypergeometric-style approach: at each step pick one
 * validator with probability proportional to their remaining stake.
 */
function selectCommittee(
  stakes: number[],
  k: number,
  rng: SeededRNG,
): number[] {
  const n = stakes.length;
  if (k > n) throw new Error("K > N");

  const available = stakes.slice(); // Copy stakes
  const indices: number[] = Array.from({ length: n }, (_, i) => i);
  const committee: number[] = [];

  let totalAvailable = available.reduce((a, b) => a + b, 0);

  for (let picked = 0; picked < k; picked++) {
    let r = rng.random() * totalAvailable;
    let chosen = -1;

    for (let j = 0; j < available.length; j++) {
      r -= available[j];
      if (r <= 0) {
        chosen = j;
        break;
      }
    }
    // Edge case: floating point drift
    if (chosen === -1) chosen = available.length - 1;

    committee.push(indices[chosen]);
    totalAvailable -= available[chosen];

    // Remove chosen from available pool
    available.splice(chosen, 1);
    indices.splice(chosen, 1);
  }

  return committee;
}

// ─── Byzantine assignment ──────────────────────────────────────────────────

/**
 * Assign adversarial status: adversary controls the validators with
 * highest stake first (worst case). Returns a Set of byzantine validator indices.
 *
 * The adversary controls exactly fraction f of total stake. We greedily assign
 * the top-stake validators until we reach or exceed f. The last validator
 * assigned may push us slightly over f, which is worst-case for the adversary.
 */
function assignByzantine(stakes: number[], f: number): Set<number> {
  // Sort indices by stake descending
  const indexed = stakes.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => b.s - a.s);

  const byzantine = new Set<number>();
  let accumulatedStake = 0;

  for (const { s, i } of indexed) {
    if (accumulatedStake >= f - 1e-12) break; // Use epsilon for floating point
    byzantine.add(i);
    accumulatedStake += s;
  }

  return byzantine;
}

// ─── Simulation core ───────────────────────────────────────────────────────

interface SimResult {
  N: number;
  K: number;
  f: number;
  threshold: string;
  T: number;
  safetyViolationRate: number;
  livenessFailureRate: number;
  avgLatency: number;
  epochs: number;
  byzantineValidators: number;
  byzantineStakeFraction: number;
}

function computeThreshold(K: number, type: "majority" | "supermajority"): number {
  if (type === "majority") {
    return Math.ceil((K + 1) / 2);
  } else {
    return Math.ceil((2 * K) / 3 + 1);
  }
}

function runSimulation(
  stakes: number[],
  byzantine: Set<number>,
  byzantineStake: number,
  K: number,
  thresholdType: "majority" | "supermajority",
  epochs: number,
  rng: SeededRNG,
): SimResult {
  const N = stakes.length;
  const T = computeThreshold(K, thresholdType);

  let safetyViolations = 0;
  let livenessFailures = 0;
  let totalLatency = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const committee = selectCommittee(stakes, K, rng);

    // Count byzantine members in committee
    let byzantineInCommittee = 0;
    for (const idx of committee) {
      if (byzantine.has(idx)) {
        byzantineInCommittee++;
      }
    }
    const honestInCommittee = K - byzantineInCommittee;

    // Safety violation: adversary controls >= T seats
    if (byzantineInCommittee >= T) {
      safetyViolations++;
    }

    // Liveness failure: honest members < T (can't confirm)
    if (honestInCommittee < T) {
      livenessFailures++;
      // Latency: need to retry (failed round + retry)
      totalLatency += 2;
    } else {
      totalLatency += 1; // Confirmed in 1 round
    }
  }

  return {
    N,
    K,
    f: byzantineStake, // actual byzantine stake fraction
    threshold: thresholdType,
    T,
    safetyViolationRate: safetyViolations / epochs,
    livenessFailureRate: livenessFailures / epochs,
    avgLatency: totalLatency / epochs,
    epochs,
    byzantineValidators: byzantine.size,
    byzantineStakeFraction: byzantineStake,
  };
}

// ─── Parameter sweep ───────────────────────────────────────────────────────

function main() {
  const Ns = [20, 50, 100, 200, 500];
  const Ks = [3, 5, 7, 9];
  const fs = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.33];
  const thresholds: Array<"majority" | "supermajority"> = [
    "majority",
    "supermajority",
  ];
  const EPOCHS = 10_000;
  const BASE_SEED = 42;

  // For each N, generate ONE stake distribution (deterministic)
  // Then reuse it across all (K, f, threshold) configs
  for (const N of Ns) {
    const stakeRng = new SeededRNG(BASE_SEED + N * 31);
    const stakes = generateStakes(N, stakeRng);

    // Verify distribution: what fraction does top 10% hold?
    const sorted = stakes.slice().sort((a, b) => b - a);
    const top10pct = Math.ceil(N * 0.1);
    const top10stake = sorted.slice(0, top10pct).reduce((a, b) => a + b, 0);

    // Log stake distribution info as a comment to stderr
    const stakeInfo = {
      N,
      top10pctValidators: top10pct,
      top10pctStake: Math.round(top10stake * 10000) / 10000,
      maxStake: Math.round(sorted[0] * 10000) / 10000,
      minStake: Math.round(sorted[sorted.length - 1] * 10000) / 10000,
    };
    console.error(`Stake distribution: ${JSON.stringify(stakeInfo)}`);

    // Pre-compute byzantine sets for each f value
    const byzantineSets = new Map<number, { set: Set<number>; actualStake: number }>();
    for (const f of fs) {
      const byz = assignByzantine(stakes, f);
      let actualStake = 0;
      for (const idx of byz) {
        actualStake += stakes[idx];
      }
      byzantineSets.set(f, { set: byz, actualStake: Math.round(actualStake * 10000) / 10000 });
      console.error(`  N=${N}, f=${f}: ${byz.size} byzantine validators, actual stake=${(actualStake * 100).toFixed(2)}%`);
    }

    // Now run all configs for this N
    let configIndex = 0;
    for (const K of Ks) {
      for (const f of fs) {
        const { set: byzantine, actualStake: byzStake } = byzantineSets.get(f)!;

        for (const thresholdType of thresholds) {
          // Each (N, K, f, threshold) config gets its own RNG for epoch sampling
          const epochRng = new SeededRNG(BASE_SEED + N * 1000003 + configIndex * 7919);
          configIndex++;

          const result = runSimulation(
            stakes,
            byzantine,
            byzStake,
            K,
            thresholdType,
            EPOCHS,
            epochRng,
          );

          // Output with the nominal f value (not the actual one)
          const output = {
            N: result.N,
            K: result.K,
            f: f, // nominal f
            threshold: result.threshold,
            T: result.T,
            safetyViolationRate: result.safetyViolationRate,
            livenessFailureRate: result.livenessFailureRate,
            avgLatency: result.avgLatency,
            epochs: result.epochs,
            byzantineValidators: result.byzantineValidators,
            actualByzantineStake: result.byzantineStakeFraction,
          };
          console.log(JSON.stringify(output));
        }
      }
    }
  }
}

main();

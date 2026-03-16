/**
 * S2: Large Committee Simulation (Round 4)
 * =========================================
 * Extends E2 (Round 3) to larger committee sizes for BFT-level security.
 *
 * Changes from E2:
 *   - K range extended to {3, 5, 7, 9, 11, 13, 15, 17, 21}
 *   - N range extended to include 1000
 *   - Anti-whale stake cap at 5% per validator
 *   - Majority threshold only (supermajority ruled out by E2)
 *   - Committee overlap tracking between consecutive epochs
 *   - Probability of adversary reaching >= T seats (danger zone)
 *   - Validation of dynamic scaling formula K = 2f_est + 1 (from E7)
 *
 * Deno-compatible TypeScript. Run with:
 *   deno run --allow-read --allow-write simulate.ts > results.jsonl
 */

// ─── Seeded PRNG (xoshiro128**) ────────────────────────────────────────────

class SeededRNG {
  private s: Uint32Array;

  constructor(seed: number) {
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

  randInt(max: number): number {
    return Math.floor(this.random() * max);
  }
}

// ─── Stake distribution with anti-whale cap ────────────────────────────────

/**
 * Generate a Zipf stake distribution calibrated so the top 10% hold ~50%
 * of total stake, then apply a 5% anti-whale cap. After capping, excess
 * stake is redistributed proportionally to uncapped validators.
 */
function generateStakes(n: number, rng: SeededRNG, stakeCap: number): number[] {
  const targetTop10 = 0.50;
  const top10count = Math.max(1, Math.ceil(n * 0.1));

  // Binary search for Zipf exponent
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
    if (top10sum / total > targetTop10) {
      sHigh = sMid;
    } else {
      sLow = sMid;
    }
    sBest = sMid;
  }

  // Generate raw Zipf stakes with 5% jitter
  const rawStakes: number[] = [];
  for (let i = 1; i <= n; i++) {
    const base = 1 / Math.pow(i, sBest);
    const jitter = 1 + (rng.random() - 0.5) * 0.1;
    rawStakes.push(base * jitter);
  }

  // Normalize to sum to 1
  let total = rawStakes.reduce((a, b) => a + b, 0);
  let stakes = rawStakes.map((s) => s / total);

  // Apply anti-whale cap: iteratively cap and redistribute
  for (let round = 0; round < 20; round++) {
    let excess = 0;
    let uncappedTotal = 0;
    let anyCapped = false;

    for (let i = 0; i < n; i++) {
      if (stakes[i] > stakeCap) {
        excess += stakes[i] - stakeCap;
        stakes[i] = stakeCap;
        anyCapped = true;
      } else {
        uncappedTotal += stakes[i];
      }
    }

    if (!anyCapped || excess < 1e-15) break;

    // Redistribute excess proportionally to uncapped validators
    for (let i = 0; i < n; i++) {
      if (stakes[i] < stakeCap) {
        stakes[i] += excess * (stakes[i] / uncappedTotal);
      }
    }

    // Re-normalize for floating point safety
    total = stakes.reduce((a, b) => a + b, 0);
    stakes = stakes.map((s) => s / total);
  }

  return stakes;
}

// ─── Stake-weighted sampling without replacement ───────────────────────────

function selectCommittee(
  stakes: number[],
  k: number,
  rng: SeededRNG,
): number[] {
  const n = stakes.length;
  if (k > n) throw new Error("K > N");

  const available = stakes.slice();
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
    if (chosen === -1) chosen = available.length - 1;

    committee.push(indices[chosen]);
    totalAvailable -= available[chosen];
    available.splice(chosen, 1);
    indices.splice(chosen, 1);
  }

  return committee;
}

// ─── Byzantine assignment ──────────────────────────────────────────────────

/**
 * Worst-case adversary: controls the highest-stake validators first
 * until reaching fraction f of total stake.
 */
function assignByzantine(stakes: number[], f: number): Set<number> {
  const indexed = stakes.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => b.s - a.s);

  const byzantine = new Set<number>();
  let accumulatedStake = 0;

  for (const { s, i } of indexed) {
    if (accumulatedStake >= f - 1e-12) break;
    byzantine.add(i);
    accumulatedStake += s;
  }

  return byzantine;
}

// ─── Simulation core ───────────────────────────────────────────────────────

interface SimResult {
  N: number;
  K: number;
  f: number;          // nominal f
  T: number;
  safetyViolationRate: number;
  livenessFailureRate: number;
  avgLatency: number;
  epochs: number;
  byzantineValidators: number;
  actualByzantineStake: number;
  avgOverlap: number;          // mean Jaccard similarity between consecutive committees
  maxOverlap: number;          // max Jaccard observed
  pAdversaryGteT: number;     // P(byzantine on committee >= T)
  formulaK: number;            // K predicted by K = 2*ceil(f*N_byz_count) + 1 (E7 formula)
  formulaHolds: boolean;       // does this K satisfy the E7 formula?
}

function computeThreshold(K: number): number {
  return Math.ceil((K + 1) / 2);
}

function jaccardSimilarity(a: number[], b: number[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const v of setA) {
    if (setB.has(v)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function runSimulation(
  stakes: number[],
  byzantine: Set<number>,
  nominalF: number,
  actualByzStake: number,
  K: number,
  epochs: number,
  rng: SeededRNG,
): SimResult {
  const N = stakes.length;
  const T = computeThreshold(K);

  let safetyViolations = 0;
  let livenessFailures = 0;
  let totalLatency = 0;
  let adversaryGteT = 0;

  let totalOverlap = 0;
  let maxOverlap = 0;
  let prevCommittee: number[] | null = null;

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
      adversaryGteT++;
    }

    // Liveness failure: honest members < T
    if (honestInCommittee < T) {
      livenessFailures++;
      totalLatency += 2;
    } else {
      totalLatency += 1;
    }

    // Overlap with previous committee
    if (prevCommittee !== null) {
      const overlap = jaccardSimilarity(committee, prevCommittee);
      totalOverlap += overlap;
      if (overlap > maxOverlap) maxOverlap = overlap;
    }

    prevCommittee = committee;
  }

  // E7 dynamic scaling formula: K = 2 * f_count + 1
  // where f_count is the number of byzantine validators
  const formulaK = 2 * byzantine.size + 1;

  return {
    N,
    K,
    f: nominalF,
    T,
    safetyViolationRate: safetyViolations / epochs,
    livenessFailureRate: livenessFailures / epochs,
    avgLatency: totalLatency / epochs,
    epochs,
    byzantineValidators: byzantine.size,
    actualByzantineStake: actualByzStake,
    avgOverlap: epochs > 1 ? totalOverlap / (epochs - 1) : 0,
    maxOverlap,
    pAdversaryGteT: adversaryGteT / epochs,
    formulaK,
    formulaHolds: K >= formulaK,
  };
}

// ─── Parameter sweep ───────────────────────────────────────────────────────

function main() {
  const Ns = [20, 50, 100, 200, 500, 1000];
  const Ks = [3, 5, 7, 9, 11, 13, 15, 17, 21];
  const fs = [0.10, 0.15, 0.20, 0.25, 0.30, 0.33];
  const EPOCHS = 10_000;
  const BASE_SEED = 42;
  const STAKE_CAP = 0.05;

  const allResults: SimResult[] = [];

  for (const N of Ns) {
    const stakeRng = new SeededRNG(BASE_SEED + N * 31);
    const stakes = generateStakes(N, stakeRng, STAKE_CAP);

    // Log stake distribution info
    const sorted = stakes.slice().sort((a, b) => b - a);
    const top10pct = Math.ceil(N * 0.1);
    const top10stake = sorted.slice(0, top10pct).reduce((a, b) => a + b, 0);
    console.error(`N=${N}: top10%=${(top10stake * 100).toFixed(1)}%, max=${(sorted[0] * 100).toFixed(2)}%, min=${(sorted[N - 1] * 100).toFixed(4)}%`);

    // Pre-compute byzantine sets for each f value
    const byzantineSets = new Map<number, { set: Set<number>; actualStake: number }>();
    for (const f of fs) {
      const byz = assignByzantine(stakes, f);
      let actualStake = 0;
      for (const idx of byz) actualStake += stakes[idx];
      byzantineSets.set(f, { set: byz, actualStake: Math.round(actualStake * 10000) / 10000 });
      console.error(`  f=${f}: ${byz.size} byzantine validators, actual_stake=${(actualStake * 100).toFixed(2)}%`);
    }

    let configIndex = 0;
    for (const K of Ks) {
      if (K > N) continue; // skip impossible configs

      for (const f of fs) {
        const { set: byzantine, actualStake: byzStake } = byzantineSets.get(f)!;

        const epochRng = new SeededRNG(BASE_SEED + N * 1000003 + configIndex * 7919);
        configIndex++;

        const result = runSimulation(
          stakes,
          byzantine,
          f,
          byzStake,
          K,
          EPOCHS,
          epochRng,
        );

        allResults.push(result);
        console.log(JSON.stringify(result));
      }
    }
  }

  // Summary: minimum K for each (N, f) achieving < 0.1% safety violation
  console.error("\n=== Minimum K for 99.9% Safety (majority threshold) ===");
  console.error("N\\f\t" + fs.map((f) => f.toFixed(2)).join("\t"));
  for (const N of Ns) {
    const row = [N.toString()];
    for (const f of fs) {
      const matching = allResults.filter((r) => r.N === N && r.f === f);
      matching.sort((a, b) => a.K - b.K);
      const minK = matching.find((r) => r.safetyViolationRate < 0.001);
      row.push(minK ? `K>=${minK.K}` : "K>21");
    }
    console.error(row.join("\t"));
  }

  // Summary: E7 formula validation
  console.error("\n=== E7 Formula Validation: K = 2*f_count + 1 ===");
  for (const f of fs) {
    const forF = allResults.filter((r) => r.f === f && r.formulaHolds);
    const safe = forF.filter((r) => r.safetyViolationRate < 0.001);
    const total = forF.length;
    console.error(`f=${f.toFixed(2)}: ${safe.length}/${total} configs with K>=formula are safe (<0.1%)`);
  }

  // Summary: average overlap by K and N
  console.error("\n=== Average Committee Overlap (Jaccard) by K, N ===");
  console.error("K\\N\t" + Ns.join("\t"));
  for (const K of Ks) {
    const row = [K.toString()];
    for (const N of Ns) {
      if (K > N) { row.push("-"); continue; }
      // Average across all f values for this K,N
      const matching = allResults.filter((r) => r.N === N && r.K === K);
      if (matching.length === 0) { row.push("-"); continue; }
      const avgOvl = matching.reduce((a, r) => a + r.avgOverlap, 0) / matching.length;
      row.push(avgOvl.toFixed(4));
    }
    console.error(row.join("\t"));
  }
}

main();

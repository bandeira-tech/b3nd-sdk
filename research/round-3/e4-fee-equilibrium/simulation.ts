/**
 * E4 Fee Equilibrium Simulation — Round 3, b3nd Protocol
 *
 * Agent-based model: operators enter/exit based on revenue vs cost;
 * demand follows S-curve adoption; fee splits determine revenue allocation.
 *
 * Deno-compatible TypeScript (also runs under Bun / ts-node).
 */

// ---------------------------------------------------------------------------
// Seeded PRNG (xoshiro128**)
// ---------------------------------------------------------------------------
class PRNG {
  private s: Uint32Array;

  constructor(seed: number) {
    this.s = new Uint32Array(4);
    // splitmix32 to initialise state
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

  private rotl(x: number, k: number): number {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
  }

  next(): number {
    const s = this.s;
    const result = Math.imul(this.rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = this.rotl(s[3], 11);
    return result / 0x100000000; // [0, 1)
  }

  /** Box-Muller transform — standard normal */
  normal(): number {
    const u1 = this.next() || 1e-10;
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Lognormal with given median and approximate range */
  lognormal(median: number, sigma: number): number {
    const mu = Math.log(median);
    return Math.exp(mu + sigma * this.normal());
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Operator {
  id: number;
  role: "storage" | "validator" | "confirmer";
  monthlyCost: number;
  belowThresholdMonths: number; // consecutive months revenue < 0.8*cost
  enteredMonth: number;
}

interface FeeSplit {
  label: string;
  storage: number; // fraction
  validator: number;
  confirmer: number;
  protocol: number;
}

interface AdoptionCurve {
  label: string;
  qMax: number; // msgs/day at saturation
  k: number; // steepness
  tMid: number; // inflection month
}

interface SimConfig {
  split: FeeSplit;
  feeFloor: number;
  adoption: AdoptionCurve;
  subsidy: number; // monthly subsidy budget ($)
  months: number;
  seed: number;
}

interface MonthSnapshot {
  split: string;
  feeFloor: number;
  adoption: string;
  subsidy: number;
  month: number;
  operators: number;
  storageOps: number;
  validators: number;
  confirmers: number;
  avgRevenue: number;
  treasury: number;
  demandMsgsDay: number;
  run: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FEE_SPLITS: FeeSplit[] = [
  { label: "40/30/20/10", storage: 0.40, validator: 0.30, confirmer: 0.20, protocol: 0.10 },
  { label: "25/35/25/15", storage: 0.25, validator: 0.35, confirmer: 0.25, protocol: 0.15 },
  { label: "30/30/30/10", storage: 0.30, validator: 0.30, confirmer: 0.30, protocol: 0.10 },
  { label: "20/40/20/20", storage: 0.20, validator: 0.40, confirmer: 0.20, protocol: 0.20 },
];

const FEE_FLOORS = [0.001, 0.002, 0.005, 0.01];

const ADOPTION_CURVES: AdoptionCurve[] = [
  { label: "slow",   qMax: 100_000,    k: 0.35, tMid: 12 },
  { label: "medium", qMax: 1_000_000,  k: 0.50, tMid: 9  },
  { label: "fast",   qMax: 10_000_000, k: 0.70, tMid: 6  },
];

const SUBSIDIES = [0, 10_000, 50_000, 100_000];

const MONTHS = 36;
const RUNS_PER_CONFIG = 50;

// Operator cost parameters (lognormal: median $50, sigma chosen so ~95% in $20-$200)
const COST_MEDIAN = 50;
const COST_SIGMA = 0.55; // exp(log(50) ± 2*0.55) ≈ $15...$167

// Role distribution for new entrants
const ROLE_WEIGHTS = { storage: 0.5, validator: 0.35, confirmer: 0.15 };

// Entry/exit thresholds
const ENTRY_MARGIN = 1.2;
const EXIT_RATIO = 0.8;
const EXIT_CONSECUTIVE = 3;

// Initial operator pool & monthly candidate pool
const INITIAL_OPERATORS = 5; // bootstrap
const CANDIDATE_POOL_PER_MONTH = 10; // potential new entrants evaluated each month

// Subsidy duration
const SUBSIDY_MONTHS = 12;

// ---------------------------------------------------------------------------
// Demand model — S-curve
// ---------------------------------------------------------------------------
function demandMsgsPerDay(t: number, curve: AdoptionCurve): number {
  // Start at ~1K msgs/day, grow via logistic to qMax
  const base = 1000;
  const logistic = curve.qMax / (1 + Math.exp(-curve.k * (t - curve.tMid)));
  return Math.max(base, logistic);
}

// ---------------------------------------------------------------------------
// Single simulation run
// ---------------------------------------------------------------------------
function simulateRun(cfg: SimConfig): MonthSnapshot[] {
  const rng = new PRNG(cfg.seed);
  const results: MonthSnapshot[] = [];

  let operators: Operator[] = [];
  let nextId = 0;
  let treasury = 0;

  // Helper to pick role
  function pickRole(): "storage" | "validator" | "confirmer" {
    const r = rng.next();
    if (r < ROLE_WEIGHTS.storage) return "storage";
    if (r < ROLE_WEIGHTS.storage + ROLE_WEIGHTS.validator) return "validator";
    return "confirmer";
  }

  // Helper to generate operator cost
  function genCost(): number {
    const c = rng.lognormal(COST_MEDIAN, COST_SIGMA);
    return Math.max(20, Math.min(200, c)); // clamp
  }

  // Bootstrap initial operators
  for (let i = 0; i < INITIAL_OPERATORS; i++) {
    operators.push({
      id: nextId++,
      role: i < 2 ? "storage" : i < 4 ? "validator" : "confirmer",
      monthlyCost: genCost(),
      belowThresholdMonths: 0,
      enteredMonth: 0,
    });
  }

  for (let month = 1; month <= cfg.months; month++) {
    // --- Demand ---
    const msgsDay = demandMsgsPerDay(month, cfg.adoption);
    const monthlyMsgs = msgsDay * 30;
    const totalFeeRevenue = monthlyMsgs * cfg.feeFloor;

    // --- Revenue distribution ---
    const storageOps = operators.filter(o => o.role === "storage");
    const validators = operators.filter(o => o.role === "validator");
    const confirmers = operators.filter(o => o.role === "confirmer");

    const storagePool = totalFeeRevenue * cfg.split.storage;
    const validatorPool = totalFeeRevenue * cfg.split.validator;
    const confirmerPool = totalFeeRevenue * cfg.split.confirmer;
    const protocolPool = totalFeeRevenue * cfg.split.protocol;

    treasury += protocolPool;

    const revenuePerStorage = storageOps.length > 0 ? storagePool / storageOps.length : 0;
    const revenuePerValidator = validators.length > 0 ? validatorPool / validators.length : 0;
    const revenuePerConfirmer = confirmers.length > 0 ? confirmerPool / confirmers.length : 0;

    // --- Subsidy ---
    let subsidyPerOp = 0;
    if (month <= SUBSIDY_MONTHS && cfg.subsidy > 0 && operators.length > 0) {
      subsidyPerOp = cfg.subsidy / operators.length;
    }

    // --- Revenue map ---
    const revenueMap: Map<string, number> = new Map();
    revenueMap.set("storage", revenuePerStorage + subsidyPerOp);
    revenueMap.set("validator", revenuePerValidator + subsidyPerOp);
    revenueMap.set("confirmer", revenuePerConfirmer + subsidyPerOp);

    // --- Exit decisions ---
    const surviving: Operator[] = [];
    for (const op of operators) {
      const rev = revenueMap.get(op.role)!;
      if (rev < EXIT_RATIO * op.monthlyCost) {
        op.belowThresholdMonths++;
      } else {
        op.belowThresholdMonths = 0;
      }
      if (op.belowThresholdMonths >= EXIT_CONSECUTIVE) {
        // operator exits
        continue;
      }
      surviving.push(op);
    }
    operators = surviving;

    // --- Entry decisions ---
    // Recalculate counts after exits
    const sCountPost = operators.filter(o => o.role === "storage").length;
    const vCountPost = operators.filter(o => o.role === "validator").length;
    const cCountPost = operators.filter(o => o.role === "confirmer").length;

    for (let c = 0; c < CANDIDATE_POOL_PER_MONTH; c++) {
      const role = pickRole();
      const cost = genCost();

      // Expected revenue if they join (adding themselves to the count)
      let expectedRev: number;
      if (role === "storage") {
        expectedRev = storagePool / (sCountPost + 1) + subsidyPerOp;
      } else if (role === "validator") {
        expectedRev = validatorPool / (vCountPost + 1) + subsidyPerOp;
      } else {
        expectedRev = confirmerPool / (cCountPost + 1) + subsidyPerOp;
      }

      if (expectedRev > ENTRY_MARGIN * cost) {
        operators.push({
          id: nextId++,
          role,
          monthlyCost: cost,
          belowThresholdMonths: 0,
          enteredMonth: month,
        });
      }
    }

    // --- Snapshot ---
    const allRevenues: number[] = operators.map(o => revenueMap.get(o.role)!);
    const avgRev = allRevenues.length > 0
      ? allRevenues.reduce((a, b) => a + b, 0) / allRevenues.length
      : 0;

    results.push({
      split: cfg.split.label,
      feeFloor: cfg.feeFloor,
      adoption: cfg.adoption.label,
      subsidy: cfg.subsidy,
      month,
      operators: operators.length,
      storageOps: operators.filter(o => o.role === "storage").length,
      validators: operators.filter(o => o.role === "validator").length,
      confirmers: operators.filter(o => o.role === "confirmer").length,
      avgRevenue: Math.round(avgRev * 100) / 100,
      treasury: Math.round(treasury * 100) / 100,
      demandMsgsDay: Math.round(msgsDay),
      run: cfg.seed, // run id
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main — full sweep
// ---------------------------------------------------------------------------
function main() {
  const allResults: MonthSnapshot[] = [];

  let configCount = 0;
  const totalConfigs = FEE_SPLITS.length * FEE_FLOORS.length * ADOPTION_CURVES.length * SUBSIDIES.length;

  for (const split of FEE_SPLITS) {
    for (const feeFloor of FEE_FLOORS) {
      for (const adoption of ADOPTION_CURVES) {
        for (const subsidy of SUBSIDIES) {
          configCount++;
          if (configCount % 20 === 0) {
            // Progress to stderr
            const pct = Math.round(100 * configCount / totalConfigs);
            process.stderr.write(`\rProgress: ${configCount}/${totalConfigs} configs (${pct}%)`);
          }
          for (let run = 1; run <= RUNS_PER_CONFIG; run++) {
            const seed = configCount * 1000 + run;
            const snapshots = simulateRun({
              split,
              feeFloor,
              adoption,
              subsidy,
              months: MONTHS,
              seed,
            });
            allResults.push(...snapshots);
          }
        }
      }
    }
  }
  process.stderr.write(`\rDone: ${totalConfigs} configs × ${RUNS_PER_CONFIG} runs = ${totalConfigs * RUNS_PER_CONFIG} simulations\n`);

  // Output JSONL
  const lines: string[] = [];
  for (const r of allResults) {
    lines.push(JSON.stringify(r));
  }
  process.stdout.write(lines.join("\n") + "\n");
}

main();

/**
 * Analyze simulation results and produce report data.
 */
import { readFileSync } from "fs";

interface Row {
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

const data: Row[] = readFileSync("results.jsonl", "utf-8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function groupBy<T>(arr: T[], keyFn: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function p25(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.25)];
}

function p75(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.75)];
}

// ===========================================================================
// 1. Break-even table: msgs/day needed for operator to cover median cost ($50)
//    at each fee floor, for each role & split
// ===========================================================================
console.log("=== 1. BREAK-EVEN TABLE ===");
console.log("Msgs/day needed for a single operator to earn $50/month (median cost)");
console.log("");

const splits = ["40/30/20/10", "25/35/25/15", "30/30/30/10", "20/40/20/20"];
const floors = [0.001, 0.002, 0.005, 0.01];
const roles = [
  { name: "storage", splitKey: (s: string) => parseFloat(s.split("/")[0]) / 100 },
  { name: "validator", splitKey: (s: string) => parseFloat(s.split("/")[1]) / 100 },
  { name: "confirmer", splitKey: (s: string) => parseFloat(s.split("/")[2]) / 100 },
];

// For a single operator earning $50/month:
// revenue = (msgs/day * 30 * feeFloor * roleSplit) / numOpsInRole
// Assume 1 op per role for break-even floor:
// msgs/day = 50 / (30 * feeFloor * roleSplit)
console.log("Fee Floor | Split        | Storage | Validator | Confirmer");
console.log("----------|--------------|---------|-----------|----------");
for (const f of floors) {
  for (const s of splits) {
    const parts = s.split("/").map(Number);
    const sRev = (50) / (30 * f * parts[0] / 100);
    const vRev = (50) / (30 * f * parts[1] / 100);
    const cRev = (50) / (30 * f * parts[2] / 100);
    console.log(
      `$${f.toFixed(3).padStart(5)}  | ${s.padEnd(12)} | ${Math.ceil(sRev).toLocaleString().padStart(7)} | ${Math.ceil(vRev).toLocaleString().padStart(9)} | ${Math.ceil(cRev).toLocaleString().padStart(9)}`
    );
  }
}

// ===========================================================================
// 2. Operator growth chart — medium adoption, $0.002 fee, no subsidy
// ===========================================================================
console.log("\n=== 2. OPERATOR GROWTH (medium adoption, $0.002 fee, no subsidy) ===");

// Average operator count per month across 50 runs
for (const splitLabel of splits) {
  const subset = data.filter(
    (r) => r.split === splitLabel && r.feeFloor === 0.002 && r.adoption === "medium" && r.subsidy === 0
  );
  const byMonth = groupBy(subset, (r) => String(r.month));
  const monthlyAvg: number[] = [];
  for (let m = 1; m <= 36; m++) {
    const rows = byMonth.get(String(m)) || [];
    monthlyAvg.push(rows.length > 0 ? mean(rows.map((r) => r.operators)) : 0);
  }
  console.log(`\n  Split: ${splitLabel}`);
  const maxOps = Math.max(...monthlyAvg, 1);
  const chartWidth = 50;
  for (let m = 1; m <= 36; m++) {
    const v = monthlyAvg[m - 1];
    const bar = "█".repeat(Math.round((v / maxOps) * chartWidth));
    console.log(`  M${String(m).padStart(2)} | ${bar} ${Math.round(v)}`);
  }
}

// ===========================================================================
// 3. Subsidy impact — time to reach 50 operators (medium adoption, $0.002)
// ===========================================================================
console.log("\n=== 3. SUBSIDY IMPACT: Months to reach 50 operators ===");
console.log("(medium adoption, $0.002 fee floor)\n");

console.log("Split        | $0     | $10K   | $50K   | $100K");
console.log("-------------|--------|--------|--------|-------");
for (const splitLabel of splits) {
  const parts: string[] = [];
  for (const sub of [0, 10000, 50000, 100000]) {
    const subset = data.filter(
      (r) => r.split === splitLabel && r.feeFloor === 0.002 && r.adoption === "medium" && r.subsidy === sub
    );
    const byRun = groupBy(subset, (r) => String(r.run));
    const timesToFifty: number[] = [];
    for (const [, rows] of byRun) {
      const sorted = rows.sort((a, b) => a.month - b.month);
      const hit = sorted.find((r) => r.operators >= 50);
      timesToFifty.push(hit ? hit.month : 99);
    }
    const med = median(timesToFifty);
    parts.push(med >= 99 ? "never".padStart(6) : `M${med}`.padStart(6));
  }
  console.log(`${splitLabel.padEnd(12)} | ${parts.join(" | ")}`);
}

// ===========================================================================
// 4. Fee split comparison — stability (std dev of operator count, months 18-36)
// ===========================================================================
console.log("\n=== 4. FEE SPLIT STABILITY (medium adoption, $0.002, no subsidy) ===");
console.log("Lower coefficient of variation = more stable\n");

console.log("Split        | Median Ops (M36) | Std Dev (M18-36) | CoV");
console.log("-------------|------------------|------------------|------");
for (const splitLabel of splits) {
  const subset = data.filter(
    (r) => r.split === splitLabel && r.feeFloor === 0.002 && r.adoption === "medium" && r.subsidy === 0
  );
  // Median final operators
  const m36 = subset.filter((r) => r.month === 36);
  const medOps36 = median(m36.map((r) => r.operators));

  // Std dev of operator count across months 18-36 (pooled across runs)
  const latePhase = subset.filter((r) => r.month >= 18 && r.month <= 36);
  const opCounts = latePhase.map((r) => r.operators);
  const m = mean(opCounts);
  const stddev = Math.sqrt(mean(opCounts.map((x) => (x - m) ** 2)));
  const cov = m > 0 ? stddev / m : 0;

  console.log(
    `${splitLabel.padEnd(12)} | ${String(Math.round(medOps36)).padStart(16)} | ${stddev.toFixed(1).padStart(16)} | ${cov.toFixed(3)}`
  );
}

// ===========================================================================
// 5. Sensitivity analysis — which parameter matters most?
// ===========================================================================
console.log("\n=== 5. SENSITIVITY ANALYSIS ===");
console.log("Impact on final operator count (month 36) — median across runs\n");

// Baseline: 25/35/25/15, $0.002, medium, $0 subsidy
const baseline = data.filter(
  (r) => r.split === "25/35/25/15" && r.feeFloor === 0.002 && r.adoption === "medium" && r.subsidy === 0 && r.month === 36
);
const baselineOps = median(baseline.map((r) => r.operators));
console.log(`Baseline (25/35/25/15, $0.002, medium, $0 subsidy): ${baselineOps} operators at M36\n`);

// Vary fee floor
console.log("Fee floor variation:");
for (const f of floors) {
  const sub = data.filter(
    (r) => r.split === "25/35/25/15" && r.feeFloor === f && r.adoption === "medium" && r.subsidy === 0 && r.month === 36
  );
  const ops = median(sub.map((r) => r.operators));
  console.log(`  $${f.toFixed(3)}: ${ops} operators (${ops > baselineOps ? "+" : ""}${ops - baselineOps})`);
}

// Vary adoption
console.log("\nAdoption curve variation:");
for (const a of ["slow", "medium", "fast"]) {
  const sub = data.filter(
    (r) => r.split === "25/35/25/15" && r.feeFloor === 0.002 && r.adoption === a && r.subsidy === 0 && r.month === 36
  );
  const ops = median(sub.map((r) => r.operators));
  console.log(`  ${a}: ${ops} operators (${ops > baselineOps ? "+" : ""}${ops - baselineOps})`);
}

// Vary split
console.log("\nFee split variation:");
for (const s of splits) {
  const sub = data.filter(
    (r) => r.split === s && r.feeFloor === 0.002 && r.adoption === "medium" && r.subsidy === 0 && r.month === 36
  );
  const ops = median(sub.map((r) => r.operators));
  console.log(`  ${s}: ${ops} operators (${ops > baselineOps ? "+" : ""}${ops - baselineOps})`);
}

// Vary subsidy
console.log("\nSubsidy variation:");
for (const sub of [0, 10000, 50000, 100000]) {
  const rows = data.filter(
    (r) => r.split === "25/35/25/15" && r.feeFloor === 0.002 && r.adoption === "medium" && r.subsidy === sub && r.month === 36
  );
  const ops = median(rows.map((r) => r.operators));
  console.log(`  $${(sub / 1000).toFixed(0)}K: ${ops} operators (${ops > baselineOps ? "+" : ""}${ops - baselineOps})`);
}

// ===========================================================================
// 6. Minimum viable network size
// ===========================================================================
console.log("\n=== 6. MINIMUM VIABLE NETWORK (self-sustaining, no subsidy) ===");
console.log("Msgs/day at which operator count stabilizes ≥ 10 for each config\n");

// For each split × fee floor at medium adoption, no subsidy:
// find first month where median operators across runs ≥ 10, report demand
console.log("Split        | Fee    | Month | Msgs/day");
console.log("-------------|--------|-------|----------");
for (const splitLabel of splits) {
  for (const f of floors) {
    const subset = data.filter(
      (r) => r.split === splitLabel && r.feeFloor === f && r.adoption === "medium" && r.subsidy === 0
    );
    const byMonth = groupBy(subset, (r) => String(r.month));
    let found = false;
    for (let m = 1; m <= 36; m++) {
      const rows = byMonth.get(String(m));
      if (!rows) continue;
      const medOps = median(rows.map((r) => r.operators));
      if (medOps >= 10) {
        const medDemand = median(rows.map((r) => r.demandMsgsDay));
        console.log(
          `${splitLabel.padEnd(12)} | $${f.toFixed(3)} | M${String(m).padStart(2)}   | ${Math.round(medDemand).toLocaleString()}`
        );
        found = true;
        break;
      }
    }
    if (!found) {
      console.log(`${splitLabel.padEnd(12)} | $${f.toFixed(3)} | never | —`);
    }
  }
}

// ===========================================================================
// 7. Extended stats for report
// ===========================================================================
console.log("\n=== 7. OPERATOR COUNTS AT KEY MONTHS (medium, $0.002, no subsidy) ===");
for (const splitLabel of splits) {
  const subset = data.filter(
    (r) => r.split === splitLabel && r.feeFloor === 0.002 && r.adoption === "medium" && r.subsidy === 0
  );
  const months = [6, 12, 18, 24, 36];
  const vals = months.map((m) => {
    const rows = subset.filter((r) => r.month === m);
    return `M${m}=${Math.round(median(rows.map((r) => r.operators)))}`;
  });
  console.log(`  ${splitLabel}: ${vals.join(", ")}`);
}

// Revenue at M12 for each split
console.log("\n=== 8. AVG REVENUE AT M12 (medium, $0.002, no subsidy) ===");
for (const splitLabel of splits) {
  const rows = data.filter(
    (r) => r.split === splitLabel && r.feeFloor === 0.002 && r.adoption === "medium" && r.subsidy === 0 && r.month === 12
  );
  console.log(`  ${splitLabel}: $${median(rows.map((r) => r.avgRevenue)).toFixed(2)} (median), ops=${median(rows.map((r) => r.operators))}`);
}

// Treasury at M36
console.log("\n=== 9. TREASURY AT M36 (medium, $0.002, no subsidy) ===");
for (const splitLabel of splits) {
  const rows = data.filter(
    (r) => r.split === splitLabel && r.feeFloor === 0.002 && r.adoption === "medium" && r.subsidy === 0 && r.month === 36
  );
  console.log(`  ${splitLabel}: $${Math.round(median(rows.map((r) => r.treasury))).toLocaleString()}`);
}

// Fast adoption comparison
console.log("\n=== 10. FAST ADOPTION PEAK OPERATORS ($0.002, no subsidy) ===");
for (const splitLabel of splits) {
  const subset = data.filter(
    (r) => r.split === splitLabel && r.feeFloor === 0.002 && r.adoption === "fast" && r.subsidy === 0
  );
  const byMonth = groupBy(subset, (r) => String(r.month));
  let peak = 0;
  let peakMonth = 0;
  for (let m = 1; m <= 36; m++) {
    const rows = byMonth.get(String(m));
    if (!rows) continue;
    const med = median(rows.map((r) => r.operators));
    if (med > peak) {
      peak = med;
      peakMonth = m;
    }
  }
  console.log(`  ${splitLabel}: peak=${peak} at M${peakMonth}`);
}

// Subsidy effectiveness — operator count at M6 with subsidy vs without
console.log("\n=== 11. SUBSIDY EARLY BOOST: Operators at M6 (medium, $0.002) ===");
for (const splitLabel of splits) {
  const parts: string[] = [];
  for (const sub of [0, 10000, 50000, 100000]) {
    const rows = data.filter(
      (r) => r.split === splitLabel && r.feeFloor === 0.002 && r.adoption === "medium" && r.subsidy === sub && r.month === 6
    );
    parts.push(`$${sub / 1000}K=${Math.round(median(rows.map((r) => r.operators)))}`);
  }
  console.log(`  ${splitLabel}: ${parts.join(", ")}`);
}

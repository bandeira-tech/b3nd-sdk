/**
 * Additional analysis: slow adoption, low fee floors, death spirals
 */
import { readFileSync } from "fs";

interface Row {
  split: string;
  feeFloor: number;
  adoption: string;
  subsidy: number;
  month: number;
  operators: number;
  avgRevenue: number;
  treasury: number;
  demandMsgsDay: number;
  run: number;
}

const data: Row[] = readFileSync("results.jsonl", "utf-8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Slow adoption, $0.001 fee — the hardest scenario
console.log("=== SLOW ADOPTION, $0.001 fee, no subsidy ===");
for (const splitLabel of ["40/30/20/10", "25/35/25/15", "30/30/30/10", "20/40/20/20"]) {
  const subset = data.filter(
    (r) => r.split === splitLabel && r.feeFloor === 0.001 && r.adoption === "slow" && r.subsidy === 0
  );
  const months = [3, 6, 12, 18, 24, 36];
  const vals = months.map((m) => {
    const rows = subset.filter((r) => r.month === m);
    return `M${m}=${Math.round(median(rows.map((r) => r.operators)))}`;
  });
  console.log(`  ${splitLabel}: ${vals.join(", ")}`);
}

// Slow adoption with subsidy
console.log("\n=== SLOW ADOPTION, $0.001 fee, WITH $50K subsidy ===");
for (const splitLabel of ["40/30/20/10", "25/35/25/15", "30/30/30/10", "20/40/20/20"]) {
  const subset = data.filter(
    (r) => r.split === splitLabel && r.feeFloor === 0.001 && r.adoption === "slow" && r.subsidy === 50000
  );
  const months = [3, 6, 12, 18, 24, 36];
  const vals = months.map((m) => {
    const rows = subset.filter((r) => r.month === m);
    return `M${m}=${Math.round(median(rows.map((r) => r.operators)))}`;
  });
  console.log(`  ${splitLabel}: ${vals.join(", ")}`);
}

// Death spiral: how many runs end with < 5 operators?
console.log("\n=== DEATH SPIRAL RISK: % of runs ending with < 5 operators at M36 ===");
console.log("(no subsidy)\n");
console.log("Split        | Adoption | Fee    | % < 5 ops | Median M36");
console.log("-------------|----------|--------|-----------|----------");
for (const adoption of ["slow", "medium", "fast"]) {
  for (const f of [0.001, 0.002, 0.005]) {
    for (const splitLabel of ["25/35/25/15"]) {
      const rows = data.filter(
        (r) => r.split === splitLabel && r.feeFloor === f && r.adoption === adoption && r.subsidy === 0 && r.month === 36
      );
      const deathCount = rows.filter((r) => r.operators < 5).length;
      const pct = ((deathCount / rows.length) * 100).toFixed(1);
      const medOps = median(rows.map((r) => r.operators));
      console.log(`${splitLabel.padEnd(12)} | ${adoption.padEnd(8)} | $${f.toFixed(3)} | ${pct.padStart(8)}% | ${medOps}`);
    }
  }
}

// Operator growth for slow adoption at $0.001 — ASCII chart
console.log("\n=== SLOW ADOPTION OPERATOR GROWTH ($0.001, 25/35/25/15, no subsidy) ===");
const subset = data.filter(
  (r) => r.split === "25/35/25/15" && r.feeFloor === 0.001 && r.adoption === "slow" && r.subsidy === 0
);
const maxOps = 200;
for (let m = 1; m <= 36; m++) {
  const rows = subset.filter((r) => r.month === m);
  const med = Math.round(median(rows.map((r) => r.operators)));
  const bar = "█".repeat(Math.max(0, Math.round((med / maxOps) * 50)));
  console.log(`  M${String(m).padStart(2)} | ${bar} ${med}`);
}

// Revenue per operator at various network sizes
console.log("\n=== REVENUE PER OPERATOR AT DIFFERENT DEMAND LEVELS ===");
console.log("(25/35/25/15 split, $0.002 fee)\n");
console.log("Msgs/day  | Total Rev/mo | Per-op (10 ops) | Per-op (50 ops) | Per-op (100 ops)");
console.log("----------|-------------|-----------------|-----------------|----------------");
for (const msgsDay of [1000, 5000, 10000, 50000, 100000, 500000, 1000000]) {
  const totalRev = msgsDay * 30 * 0.002;
  // Operator revenue is (1 - protocol%) share / num_ops
  const opShare = totalRev * 0.85; // 15% to protocol
  console.log(
    `${msgsDay.toLocaleString().padStart(9)} | $${totalRev.toLocaleString().padStart(10)} | $${(opShare / 10).toFixed(0).padStart(14)} | $${(opShare / 50).toFixed(0).padStart(14)} | $${(opShare / 100).toFixed(0).padStart(14)}`
  );
}

// What subsidy level keeps operators alive in slow/$0.001 scenario?
console.log("\n=== SUBSIDY NEEDED FOR SLOW/$0.001 VIABILITY ===");
console.log("Operators at M12 and M36 by subsidy level\n");
for (const sub of [0, 10000, 50000, 100000]) {
  const m12 = data.filter(
    (r) => r.split === "25/35/25/15" && r.feeFloor === 0.001 && r.adoption === "slow" && r.subsidy === sub && r.month === 12
  );
  const m36 = data.filter(
    (r) => r.split === "25/35/25/15" && r.feeFloor === 0.001 && r.adoption === "slow" && r.subsidy === sub && r.month === 36
  );
  console.log(`  $${(sub / 1000).toFixed(0)}K subsidy: M12=${Math.round(median(m12.map((r) => r.operators)))}, M36=${Math.round(median(m36.map((r) => r.operators)))}`);
}

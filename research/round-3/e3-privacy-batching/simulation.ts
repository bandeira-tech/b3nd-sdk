/**
 * Experiment E3: Privacy Batching Interval Sweep Simulation
 * Round 3 Research - b3nd Protocol
 *
 * Quantifies the privacy-latency tradeoff for timing obfuscation.
 * Question: How much batching delay is needed to prevent an adversary
 * from inferring the social graph from message timing patterns?
 *
 * Deno-compatible TypeScript. Run with: deno run simulation.ts
 */

// === Seeded PRNG (xoshiro128**) ===
class PRNG {
  private s: Uint32Array;

  constructor(seed: number) {
    this.s = new Uint32Array(4);
    // SplitMix32 to initialize state
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
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = this.rotl(s[3], 11);
    return result;
  }

  // Uniform [0, 1)
  random(): number {
    return this.next() / 4294967296;
  }

  // Uniform [a, b)
  uniform(a: number, b: number): number {
    return a + this.random() * (b - a);
  }

  // Exponential distribution with rate lambda
  exponential(lambda: number): number {
    return -Math.log(1 - this.random()) / lambda;
  }

  // Poisson process: generate arrival times in [0, duration]
  poisson_arrivals(lambda: number, duration: number): number[] {
    const arrivals: number[] = [];
    let t = 0;
    while (true) {
      t += this.exponential(lambda);
      if (t > duration) break;
      arrivals.push(t);
    }
    return arrivals;
  }

  // Integer in [0, n)
  randint(n: number): number {
    return Math.floor(this.random() * n);
  }

  // Shuffle array in place
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randint(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// === Types ===
interface Edge {
  u: number;
  v: number;
}

interface WriteEvent {
  user: number;
  time: number;       // seconds from start
  isReal: boolean;     // real vs dummy
  isDummy: boolean;
}

interface ObservedWrite {
  user: number;
  time: number;        // observed time (after batching)
}

interface TrialResult {
  precision: number;
  recall: number;
  f1: number;
  latencies_ms: number[];  // latency for each real message in ms
}

interface ConfigResult {
  D: number;
  R: number;
  window: number;
  precision: number;
  recall: number;
  f1: number;
  p50_latency_ms: number;
  p99_latency_ms: number;
  trials: number;
}

// === Social Graph Generation ===
function generateSocialGraph(numUsers: number, avgDegree: number, rng: PRNG): Edge[] {
  const edges: Edge[] = [];
  const edgeSet = new Set<string>();

  // Each user picks ~avgDegree/2 outgoing edges (undirected, so each edge counted once)
  // We target avgDegree * numUsers / 2 total edges
  const targetEdges = Math.round(avgDegree * numUsers / 2);

  // Build edges by random pairing
  let attempts = 0;
  while (edges.length < targetEdges && attempts < targetEdges * 10) {
    const u = rng.randint(numUsers);
    const v = rng.randint(numUsers);
    if (u === v) { attempts++; continue; }
    const key = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (edgeSet.has(key)) { attempts++; continue; }
    edgeSet.add(key);
    edges.push({ u: Math.min(u, v), v: Math.max(u, v) });
    attempts++;
  }

  return edges;
}

// === Traffic Generation ===
function generateTraffic(
  numUsers: number,
  edges: Edge[],
  dummyRate: number,
  duration: number, // seconds
  rng: PRNG
): WriteEvent[] {
  const events: WriteEvent[] = [];
  const lambdaActive = 5 / 3600;   // 5 msg/hour per active conversation, in msg/sec
  const lambdaBg = 0.5 / 3600;     // 0.5 msg/hour background noise, in msg/sec
  const responseProb = 0.7;

  // Build adjacency: for each user, which edges they participate in
  const userEdges: Map<number, number[]> = new Map();
  for (let i = 0; i < numUsers; i++) userEdges.set(i, []);
  for (let ei = 0; ei < edges.length; ei++) {
    userEdges.get(edges[ei].u)!.push(ei);
    userEdges.get(edges[ei].v)!.push(ei);
  }

  // For each edge, generate conversation traffic
  for (const edge of edges) {
    // Each edge produces messages at lambdaActive rate (split between the two users)
    // Alice sends at lambdaActive/2, Bob sends at lambdaActive/2, plus responses
    const aliceInitTimes = rng.poisson_arrivals(lambdaActive / 2, duration);
    const bobInitTimes = rng.poisson_arrivals(lambdaActive / 2, duration);

    for (const t of aliceInitTimes) {
      events.push({ user: edge.u, time: t, isReal: true, isDummy: false });
      // Bob may respond
      if (rng.random() < responseProb) {
        const delay = rng.uniform(1, 60); // 1-60s response
        const responseTime = t + delay;
        if (responseTime <= duration) {
          events.push({ user: edge.v, time: responseTime, isReal: true, isDummy: false });
        }
      }
    }

    for (const t of bobInitTimes) {
      events.push({ user: edge.v, time: t, isReal: true, isDummy: false });
      // Alice may respond
      if (rng.random() < responseProb) {
        const delay = rng.uniform(1, 60);
        const responseTime = t + delay;
        if (responseTime <= duration) {
          events.push({ user: edge.u, time: responseTime, isReal: true, isDummy: false });
        }
      }
    }
  }

  // Background noise for each user
  for (let u = 0; u < numUsers; u++) {
    const bgTimes = rng.poisson_arrivals(lambdaBg, duration);
    for (const t of bgTimes) {
      events.push({ user: u, time: t, isReal: true, isDummy: false });
    }
  }

  // Dummy traffic: each user generates dummy writes at R * their real rate
  if (dummyRate > 0) {
    // Count real messages per user
    const realCounts = new Array(numUsers).fill(0);
    for (const e of events) {
      if (e.isReal) realCounts[e.user]++;
    }

    for (let u = 0; u < numUsers; u++) {
      const dummyCount = Math.round(realCounts[u] * dummyRate);
      for (let i = 0; i < dummyCount; i++) {
        events.push({
          user: u,
          time: rng.uniform(0, duration),
          isReal: false,
          isDummy: true,
        });
      }
    }
  }

  // Sort by time
  events.sort((a, b) => a.time - b.time);
  return events;
}

// === Batching Defense ===
function applyBatching(events: WriteEvent[], batchDelay: number): { observed: ObservedWrite[]; latencies_ms: number[] } {
  const observed: ObservedWrite[] = [];
  const latencies_ms: number[] = [];

  if (batchDelay <= 0) {
    // No batching - messages are observed at their actual time
    for (const e of events) {
      observed.push({ user: e.user, time: e.time });
      if (e.isReal) latencies_ms.push(0);
    }
  } else {
    // Messages are held and released at the next batch boundary
    for (const e of events) {
      const batchTime = Math.ceil(e.time / batchDelay) * batchDelay;
      observed.push({ user: e.user, time: batchTime });
      if (e.isReal) {
        latencies_ms.push((batchTime - e.time) * 1000);
      }
    }
  }

  return { observed, latencies_ms };
}

// === Adversary: Temporal Correlation Attack ===
function temporalCorrelationAttack(
  observed: ObservedWrite[],
  numUsers: number,
  windowSec: number,
  edges: Edge[],
): { precision: number; recall: number; f1: number } {
  // Build per-user write time arrays
  const userWrites: number[][] = Array.from({ length: numUsers }, () => []);
  for (const o of observed) {
    userWrites[o.user].push(o.time);
  }

  // For each pair, compute temporal correlation score
  // Score = number of close write pairs / geometric mean of write counts
  const edgeSet = new Set<string>();
  for (const e of edges) {
    edgeSet.add(`${e.u}-${e.v}`);
  }

  const scores: { u: number; v: number; score: number }[] = [];

  for (let i = 0; i < numUsers; i++) {
    if (userWrites[i].length === 0) continue;
    for (let j = i + 1; j < numUsers; j++) {
      if (userWrites[j].length === 0) continue;

      // Count temporal correlations: write_i at t, write_j at t+delta where |delta| < window
      let count = 0;
      const wi = userWrites[i];
      const wj = userWrites[j];

      // Use two-pointer approach for efficiency
      let jPtr = 0;
      for (let iIdx = 0; iIdx < wi.length; iIdx++) {
        // Move jPtr to first entry within window
        while (jPtr < wj.length && wj[jPtr] < wi[iIdx] - windowSec) jPtr++;
        // Count all entries within window
        let k = jPtr;
        while (k < wj.length && wj[k] <= wi[iIdx] + windowSec) {
          count++;
          k++;
        }
      }

      // Normalize by geometric mean of activity
      const norm = Math.sqrt(wi.length * wj.length);
      const score = norm > 0 ? count / norm : 0;
      scores.push({ u: i, v: j, score });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Predict top-K edges where K = number of real edges
  // This gives the adversary the best possible F1 at the right threshold
  const K = edges.length;
  const predicted = new Set<string>();
  for (let i = 0; i < Math.min(K, scores.length); i++) {
    predicted.add(`${scores[i].u}-${scores[i].v}`);
  }

  // Also try frequency analysis boost: pairs with high burstiness correlation
  // (Already captured by temporal correlation with larger windows)

  // Compute precision, recall, F1
  let tp = 0;
  for (const key of predicted) {
    if (edgeSet.has(key)) tp++;
  }

  const precision = predicted.size > 0 ? tp / predicted.size : 0;
  const recall = edges.length > 0 ? tp / edges.length : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { precision, recall, f1 };
}

// === Run One Trial ===
function runTrial(
  numUsers: number,
  edges: Edge[],
  batchDelay: number,
  dummyRate: number,
  windowSec: number,
  duration: number,
  rng: PRNG,
): TrialResult {
  const events = generateTraffic(numUsers, edges, dummyRate, duration, rng);
  const { observed, latencies_ms } = applyBatching(events, batchDelay);

  // Sort observed writes by time for the adversary
  observed.sort((a, b) => a.time - b.time);

  const { precision, recall, f1 } = temporalCorrelationAttack(
    observed, numUsers, windowSec, edges,
  );

  return { precision, recall, f1, latencies_ms };
}

// === Percentile Calculation ===
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// === Main ===
function main() {
  const NUM_USERS = 100;
  const AVG_DEGREE = 5;
  const DURATION = 3600; // 1 hour in seconds
  const NUM_TRIALS = 100;

  const D_VALUES = [0, 0.1, 0.5, 1, 2, 5, 10, 30, 60];
  const R_VALUES = [0, 0.5, 1.0, 2.0];
  const WINDOW_VALUES = [5, 30, 60];

  const results: ConfigResult[] = [];

  const masterRng = new PRNG(42);

  // Generate a fixed social graph (same across all trials for consistency)
  const graphRng = new PRNG(12345);
  const edges = generateSocialGraph(NUM_USERS, AVG_DEGREE, graphRng);

  const totalConfigs = D_VALUES.length * R_VALUES.length * WINDOW_VALUES.length;
  let configIdx = 0;

  for (const D of D_VALUES) {
    for (const R of R_VALUES) {
      for (const window of WINDOW_VALUES) {
        configIdx++;
        const trialResults: TrialResult[] = [];

        for (let trial = 0; trial < NUM_TRIALS; trial++) {
          // Derive per-trial seed from master RNG
          const trialSeed = masterRng.next();
          const trialRng = new PRNG(trialSeed);

          const result = runTrial(
            NUM_USERS, edges, D, R, window, DURATION, trialRng,
          );
          trialResults.push(result);
        }

        // Aggregate across trials
        const avgPrecision = trialResults.reduce((s, r) => s + r.precision, 0) / NUM_TRIALS;
        const avgRecall = trialResults.reduce((s, r) => s + r.recall, 0) / NUM_TRIALS;
        const avgF1 = trialResults.reduce((s, r) => s + r.f1, 0) / NUM_TRIALS;

        // Aggregate latencies across all trials
        const allLatencies = trialResults.flatMap(r => r.latencies_ms);
        const p50 = percentile(allLatencies, 50);
        const p99 = percentile(allLatencies, 99);

        const configResult: ConfigResult = {
          D,
          R,
          window,
          precision: Math.round(avgPrecision * 10000) / 10000,
          recall: Math.round(avgRecall * 10000) / 10000,
          f1: Math.round(avgF1 * 10000) / 10000,
          p50_latency_ms: Math.round(p50),
          p99_latency_ms: Math.round(p99),
          trials: NUM_TRIALS,
        };

        results.push(configResult);
        console.log(JSON.stringify(configResult));

        // Progress to stderr
        if (configIdx % 10 === 0 || configIdx === totalConfigs) {
          console.error(`[progress] ${configIdx}/${totalConfigs} configurations complete`);
        }
      }
    }
  }

  // Write results to a JSON file for report generation
  // Compatible with both Deno (--allow-write) and Node/tsx
  const resultsJson = JSON.stringify(results, null, 2);
  try {
    const scriptDir = new URL(".", import.meta.url).pathname;
    // Dynamic import for cross-runtime compat
    import("node:fs").then(fs => {
      fs.writeFileSync(scriptDir + "results.json", resultsJson);
      console.error(`[done] Results written to results.json`);
    }).catch(() => {
      console.error("[warn] Could not write results.json");
    });
  } catch {
    console.error("[warn] Could not write results.json, results available on stdout");
  }

  console.error(`\n[done] ${results.length} configurations evaluated.`);
}

main();

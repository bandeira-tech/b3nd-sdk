/**
 * E6 – Merkle Delta Sync Stress Test
 * Round 3 Research – b3nd Protocol
 *
 * Measures Merkle delta sync vs naive full sync across dataset sizes and
 * difference counts.  Deno-compatible TypeScript (also runs under tsx/node).
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(data: string | Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function concatBuffers(a: Buffer, b: Buffer): Buffer {
  return Buffer.concat([a, b]);
}

function randomHex(bytes: number): string {
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (Math.random() * 256) | 0;
  return buf.toString("hex");
}

// ---------------------------------------------------------------------------
// Record type
// ---------------------------------------------------------------------------

interface Record {
  uri: string;       // sorted key
  timestamp: number;
  dataHash: string;  // hex, 32 bytes
  data: string;      // ~200 bytes payload
}

const RECORD_OVERHEAD = 200; // approx bytes per record when serialised

function recordBytes(r: Record): number {
  return r.uri.length + 8 + 64 + r.data.length;
}

function recordLeafHash(r: Record): Buffer {
  return sha256(`${r.uri}|${r.timestamp}|${r.dataHash}`);
}

// ---------------------------------------------------------------------------
// N-ary Merkle Tree
// ---------------------------------------------------------------------------

interface MerkleNode {
  hash: Buffer;
  level: number;
  startIdx: number;  // inclusive index into sorted record array
  endIdx: number;    // exclusive
  children: MerkleNode[] | null; // null for leaves
}

function buildMerkleTree(
  records: Record[],
  fanout: number,
): { root: MerkleNode; buildTimeMs: number } {
  const t0 = performance.now();

  if (records.length === 0) {
    const empty: MerkleNode = {
      hash: sha256("empty"),
      level: 0,
      startIdx: 0,
      endIdx: 0,
      children: null,
    };
    return { root: empty, buildTimeMs: performance.now() - t0 };
  }

  // Compute leaf hashes
  const leafHashes: Buffer[] = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    leafHashes[i] = recordLeafHash(records[i]);
  }

  // Build bottom-up
  function buildNode(start: number, end: number, level: number): MerkleNode {
    const count = end - start;
    if (count <= 1) {
      // Leaf node
      return {
        hash: leafHashes[start],
        level: 0,
        startIdx: start,
        endIdx: end,
        children: null,
      };
    }

    // Split into `fanout` children
    const children: MerkleNode[] = [];
    const chunkSize = Math.ceil(count / fanout);
    for (let i = start; i < end; i += chunkSize) {
      const childEnd = Math.min(i + chunkSize, end);
      children.push(buildNode(i, childEnd, level - 1));
    }

    // Internal hash = hash of concatenated child hashes
    const combined = Buffer.concat(children.map((c) => c.hash));
    const hash = sha256(combined);

    return { hash, level, startIdx: start, endIdx: end, children };
  }

  // Compute tree height
  const height = Math.ceil(Math.log(records.length) / Math.log(fanout));
  const root = buildNode(0, records.length, height);

  return { root, buildTimeMs: performance.now() - t0 };
}

// ---------------------------------------------------------------------------
// Merkle Delta Sync Protocol (simulated locally)
// ---------------------------------------------------------------------------

interface SyncStats {
  roundTrips: number;
  hashBytesSent: number;    // hashes exchanged
  recordBytesSent: number;  // actual record data transferred
  diffIndices: number[];    // indices in B that differ from A
}

/**
 * Simulate Merkle sync:  Node A has treeA over recordsA,
 * Node B has treeB over recordsB.  We find which leaf positions differ.
 *
 * Each "round trip" = one level of the tree traversal.  At each level we
 * send child hashes for mismatching subtrees.
 */
function merkleDeltaSync(
  treeA: MerkleNode,
  treeB: MerkleNode,
  recordsA: Record[],
  recordsB: Record[],
): SyncStats {
  const stats: SyncStats = {
    roundTrips: 0,
    hashBytesSent: 0,
    recordBytesSent: 0,
    diffIndices: [],
  };

  // BFS-style: compare nodes level by level to count round-trips accurately
  let currentPairs: Array<[MerkleNode, MerkleNode]> = [[treeA, treeB]];

  // Initial root hash exchange = 1 round trip
  stats.roundTrips = 1;
  stats.hashBytesSent += 32 * 2; // both sides send root hash

  if (treeA.hash.equals(treeB.hash)) {
    return stats; // identical
  }

  while (currentPairs.length > 0) {
    const nextPairs: Array<[MerkleNode, MerkleNode]> = [];

    for (const [nA, nB] of currentPairs) {
      if (nA.hash.equals(nB.hash)) continue;

      // Leaf level — record differs
      if (!nA.children || !nB.children) {
        // Transfer differing records
        for (let i = nA.startIdx; i < nA.endIdx; i++) {
          // Check individual records if ranges overlap
          if (i < recordsA.length && i < recordsB.length) {
            const hA = recordLeafHash(recordsA[i]);
            const hB = recordLeafHash(recordsB[i]);
            if (!hA.equals(hB)) {
              stats.diffIndices.push(i);
              stats.recordBytesSent += recordBytes(recordsB[i]);
            }
          } else if (i < recordsB.length) {
            stats.diffIndices.push(i);
            stats.recordBytesSent += recordBytes(recordsB[i]);
          } else {
            stats.diffIndices.push(i); // deletion
            stats.recordBytesSent += 64; // just the URI
          }
        }
        continue;
      }

      // Internal node: exchange child hashes
      const childrenA = nA.children!;
      const childrenB = nB.children!;
      const maxChildren = Math.max(childrenA.length, childrenB.length);

      stats.hashBytesSent += maxChildren * 32 * 2; // both sides send child hashes

      for (let c = 0; c < maxChildren; c++) {
        if (c >= childrenA.length || c >= childrenB.length) {
          // Structural mismatch – treat entire subtree as diff
          const node = c < childrenB.length ? childrenB[c] : childrenA[c];
          for (let i = node.startIdx; i < node.endIdx && i < recordsB.length; i++) {
            stats.diffIndices.push(i);
            stats.recordBytesSent += recordBytes(recordsB[i]);
          }
          continue;
        }

        if (!childrenA[c].hash.equals(childrenB[c].hash)) {
          nextPairs.push([childrenA[c], childrenB[c]]);
        }
      }
    }

    if (nextPairs.length > 0) {
      stats.roundTrips++;
      currentPairs = nextPairs;
    } else {
      break;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Naive Full Sync
// ---------------------------------------------------------------------------

function naiveSyncBytes(records: Record[]): number {
  let total = 0;
  for (const r of records) total += recordBytes(r);
  return total;
}

// ---------------------------------------------------------------------------
// Dataset Generation
// ---------------------------------------------------------------------------

function generateDataset(n: number, seed: number): Record[] {
  // Simple seeded PRNG (xorshift32)
  let s = seed | 1;
  function rand(): number {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  }

  const records: Record[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const hexPart = rand().toString(16).slice(2, 10).padEnd(8, "0");
    const pathPart = rand().toString(16).slice(2, 8).padEnd(6, "0");
    const uri = `b3nd://${hexPart}/${pathPart}`;
    const ts = 1700000000000 + Math.floor(rand() * 100000000);
    // ~200 bytes of data
    let data = "";
    for (let j = 0; j < 5; j++) data += rand().toString(36).slice(2);
    data = data.slice(0, 200).padEnd(200, "x");
    const dh = sha256Hex(data);
    records[i] = { uri, timestamp: ts, dataHash: dh, data };
  }

  // Sort by URI for Merkle tree ordering
  records.sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
  return records;
}

/**
 * Clone dataset and introduce K differences (updates only – simpler and
 * keeps array length identical so tree structure matches perfectly).
 */
function cloneWithDifferences(records: Record[], k: number, seed: number): Record[] {
  let s = seed | 1;
  function rand(): number {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  }

  const cloned: Record[] = records.map((r) => ({ ...r }));
  const indices = new Set<number>();
  while (indices.size < k) {
    indices.add(Math.floor(rand() * cloned.length));
  }
  for (const idx of indices) {
    // Mutate the record at idx
    let data = "";
    for (let j = 0; j < 5; j++) data += rand().toString(36).slice(2);
    data = data.slice(0, 200).padEnd(200, "x");
    cloned[idx] = {
      ...cloned[idx],
      timestamp: cloned[idx].timestamp + 1000,
      dataHash: sha256Hex(data),
      data,
    };
  }
  return cloned;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface BenchResult {
  N: number;
  K: number;
  fanout: number;
  roundTrips: number;
  bytesTransferred: number;
  naiveBytes: number;
  speedup: number;
  syncTimeMs: number;
  buildTimeMs: number;
  run: number;
  diffsFound: number;
}

function runSingleBenchmark(
  n: number,
  k: number,
  fanout: number,
  runIdx: number,
): BenchResult {
  const seed1 = n * 1000 + k * 7 + runIdx * 31;
  const seed2 = seed1 + 9999;

  const recordsA = generateDataset(n, seed1);
  const recordsB = cloneWithDifferences(recordsA, k, seed2);

  const { root: treeA, buildTimeMs: buildA } = buildMerkleTree(recordsA, fanout);
  const { root: treeB, buildTimeMs: buildB } = buildMerkleTree(recordsB, fanout);
  const buildTimeMs = buildA + buildB;

  const t0 = performance.now();
  const syncStats = merkleDeltaSync(treeA, treeB, recordsA, recordsB);
  const syncTimeMs = performance.now() - t0;

  const bytesTransferred = syncStats.hashBytesSent + syncStats.recordBytesSent;
  const naive = naiveSyncBytes(recordsA);
  const speedup = naive / Math.max(bytesTransferred, 1);

  return {
    N: n,
    K: k,
    fanout,
    roundTrips: syncStats.roundTrips,
    bytesTransferred,
    naiveBytes: naive,
    speedup: Math.round(speedup * 10) / 10,
    syncTimeMs: Math.round(syncTimeMs * 100) / 100,
    buildTimeMs: Math.round(buildTimeMs * 100) / 100,
    run: runIdx + 1,
    diffsFound: syncStats.diffIndices.length,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const RUNS_PER_CONFIG = 5;

const N_VALUES = [1_000, 10_000, 100_000, 500_000, 1_000_000];
const K_VALUES = [1, 10, 100, 1_000, 10_000];
const FANOUTS_FULL = [2, 16, 256];
const FANOUT_COMPARISON_N = 100_000;

// Time-budget guard: skip configs that would exceed ~5 min total
const MAX_SINGLE_RUN_MS = 60_000;

async function main() {
  const allResults: BenchResult[] = [];
  let skipped: string[] = [];

  console.error("=== E6 Merkle Delta Sync Stress Test ===\n");

  // Phase 1: Binary tree sweep over (N, K)
  console.error("Phase 1: Binary tree (N x K) sweep");
  for (const n of N_VALUES) {
    for (const k of K_VALUES) {
      if (k > n / 10) continue; // at most 10% different

      // Warm-up / time-guard: run once and extrapolate
      const t0 = performance.now();
      const warmup = runSingleBenchmark(n, k, 2, 99);
      const elapsed = performance.now() - t0;

      if (elapsed > MAX_SINGLE_RUN_MS) {
        console.error(`  SKIP N=${n} K=${k} fanout=2 (single run took ${Math.round(elapsed)}ms)`);
        skipped.push(`N=${n},K=${k},f=2`);
        // Still record the warmup as a single run
        warmup.run = 1;
        console.log(JSON.stringify(warmup));
        allResults.push(warmup);
        continue;
      }

      console.error(`  N=${n.toLocaleString()} K=${k.toLocaleString()} fanout=2 (~${Math.round(elapsed)}ms/run)`);

      for (let r = 0; r < RUNS_PER_CONFIG; r++) {
        const result = runSingleBenchmark(n, k, 2, r);
        console.log(JSON.stringify(result));
        allResults.push(result);
      }
    }
  }

  // Phase 2: Fan-out comparison at N=100K
  console.error("\nPhase 2: Fan-out comparison at N=100K");
  for (const fanout of FANOUTS_FULL) {
    for (const k of K_VALUES) {
      if (k > FANOUT_COMPARISON_N / 10) continue;

      console.error(`  N=${FANOUT_COMPARISON_N.toLocaleString()} K=${k} fanout=${fanout}`);
      for (let r = 0; r < RUNS_PER_CONFIG; r++) {
        const result = runSingleBenchmark(FANOUT_COMPARISON_N, k, fanout, r);
        // Only emit non-binary fanout results (binary already done in phase 1)
        if (fanout !== 2) {
          console.log(JSON.stringify(result));
          allResults.push(result);
        }
      }
    }
  }

  // Summary to stderr
  console.error(`\nDone. ${allResults.length} results emitted. Skipped: ${skipped.length}`);
  if (skipped.length > 0) console.error(`  Skipped configs: ${skipped.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

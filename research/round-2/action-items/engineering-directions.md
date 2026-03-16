# Engineering Directions: Execution-Ready Items

**Source:** Round 2 Research Reports (Fronts 1–6)
**Status:** Ready for engineering execution — no founder design decisions required
**Date:** 2026-03-16

---

## How to Use This Document

Each item below is a self-contained work package. They are ordered by priority (data-corruption and security fixes first, then scalability, then DX). Each includes:

- **What** the problem is (with file paths and line numbers)
- **Why** it matters (concrete failure scenario)
- **How** to fix it (with code sketches and specs from the research)
- **Acceptance criteria** (how to verify it's done)
- **Estimated effort**

Items are independent unless noted. They can be worked in parallel.

---

## 1. Non-Atomic MessageData Envelope Storage

**Priority:** P0 — data corruption risk
**Front:** 3 (Software & Systems)
**Effort:** 1–2 days
**File:** `libs/b3nd-client-postgres/mod.ts:130-151`

### Problem

When a `MessageData` envelope contains multiple outputs, each output is stored via a separate `receive()` call — each an independent SQL `INSERT ... ON CONFLICT DO UPDATE`. If the process crashes after storing output 2 of 5, the envelope is partially written. The persistence layer has no transaction abstraction.

### Failure Scenario

1. Client sends a MessageData with 5 outputs (e.g., a batch transfer)
2. Outputs 1-3 are written successfully
3. Process crashes (OOM, network drop, restart)
4. Database now has 3 of 5 outputs — inconsistent state
5. No recovery mechanism exists; the partial write is invisible

### Solution

**Step 1:** Add `transaction()` to the `SqlExecutor` interface:

```typescript
export interface SqlExecutor {
  query: (sql: string, args?: unknown[]) => Promise<SqlExecutorResult>;
  transaction: <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
  cleanup?: () => Promise<void>;
}
```

**Step 2:** Implement for the Postgres driver:

```typescript
async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
  const client = await this.pool.connect();
  try {
    await client.query("BEGIN");
    const txExecutor: SqlExecutor = {
      query: (sql, args) => client.query(sql, args),
      transaction: () => { throw new Error("Nested transactions not supported"); },
    };
    const result = await fn(txExecutor);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

**Step 3:** Wrap the MessageData loop in `receive()` (mod.ts:137-151) inside `this.executor.transaction(...)`.

**Step 4:** For non-Postgres backends (in-memory, file), implement `transaction()` as a simple mutex lock.

### Acceptance Criteria

- [ ] `SqlExecutor` interface includes `transaction()`
- [ ] Postgres executor implements BEGIN/COMMIT/ROLLBACK
- [ ] MessageData with N outputs either stores all N or none
- [ ] Test: kill process mid-envelope → verify zero outputs stored
- [ ] Test: successful envelope → verify all outputs present
- [ ] Existing single-write `receive()` path unchanged

---

## 2. PBKDF2 Iteration Upgrade (100K → 600K)

**Priority:** P0 — below OWASP minimum
**Front:** 1 (Cryptography)
**Effort:** 0.5 days
**File:** `libs/b3nd-encrypt/mod.ts:600-628`

### Problem

`deriveKeyFromSeed()` defaults to 100,000 PBKDF2-SHA256 iterations. OWASP 2023 minimum is 600,000. At 100K iterations, a single RTX 4090 brute-forces a common password (~30 bits entropy) in ~15 minutes.

### Solution

**Step 1:** Change default parameter:

```typescript
export async function deriveKeyFromSeed(
  seed: string, salt: string, iterations: number = 600000  // was 100000
): Promise<string> {
```

**Step 2:** Ensure backward compatibility. Existing derived keys store their iteration count. On read, use the stored count. On new derivations, use 600K.

**Step 3:** Add a `kdf_version` field to any serialized key metadata:

```typescript
interface KeyMetadata {
  kdf: "pbkdf2";
  iterations: number;  // stored explicitly, not assumed
  salt: string;
}
```

**Step 4:** Update `SecretEncryptionKey.fromSecret()` (mod.ts:146) to pass the new default.

### Acceptance Criteria

- [ ] Default iterations = 600,000
- [ ] Existing keys derived at 100K still decrypt correctly
- [ ] New keys derived at 600K
- [ ] Key metadata includes explicit iteration count
- [ ] Benchmark: derivation completes in < 500ms on mid-range hardware

---

## 3. Add HKDF to ECDH-to-AES Pipeline

**Priority:** P1 — cryptographic best practice violation
**Front:** 1 (Cryptography)
**Effort:** 1–2 days
**File:** `libs/b3nd-encrypt/mod.ts` (ECDH key exchange section)

### Problem

The ECDH shared secret is used directly as the AES-GCM key. While the X25519 output is uniformly random, NIST SP 800-56C and RFC 5869 require a key derivation step (HKDF) between the raw shared secret and the symmetric key. This provides:

- Domain separation (different keys for different purposes from same ECDH)
- Defense-in-depth if the ECDH output has subtle biases
- Standard compliance for audits and certifications

### Solution

**Step 1:** Add HKDF-SHA256 function:

```typescript
import { hmac } from "./deps.ts";  // or Web Crypto API

export async function hkdfSha256(
  ikm: Uint8Array,      // Input key material (ECDH shared secret)
  salt: Uint8Array,      // Optional salt (use sender+receiver pubkeys)
  info: Uint8Array,      // Context string: "b3nd-aes-gcm-key"
  length: number = 32    // Output length (AES-256 = 32 bytes)
): Promise<Uint8Array> {
  // Extract
  const prk = hmac("sha256", salt.length ? salt : new Uint8Array(32), ikm);
  // Expand
  const N = Math.ceil(length / 32);
  let t = new Uint8Array(0);
  const okm = new Uint8Array(length);
  for (let i = 1; i <= N; i++) {
    const input = concat(t, info, new Uint8Array([i]));
    t = hmac("sha256", prk, input);
    okm.set(t.subarray(0, Math.min(32, length - (i - 1) * 32)), (i - 1) * 32);
  }
  return okm;
}
```

**Step 2:** Insert HKDF between ECDH and AES-GCM key usage:

```typescript
const rawSharedSecret = x25519(myPrivateKey, theirPublicKey);
const salt = concat(sortedPubkeys(myPub, theirPub));  // Deterministic
const aesKey = await hkdfSha256(
  rawSharedSecret,
  salt,
  new TextEncoder().encode("b3nd-aes-gcm-key-v1")
);
```

**Step 3:** Version the info string (`v1`) so future changes don't break backward compatibility.

### Acceptance Criteria

- [ ] HKDF-SHA256 implemented per RFC 5869
- [ ] All ECDH-to-AES paths go through HKDF
- [ ] Info string includes version identifier
- [ ] Salt derived from sorted public keys (deterministic)
- [ ] Existing encrypted data migration path documented
- [ ] Test vectors from RFC 5869 pass

### Migration Note

This changes derived keys. Existing data encrypted with raw ECDH keys must either:
- Be re-encrypted (preferred, if feasible)
- Use a version flag: `{ encryption: "ecdh-raw" | "ecdh-hkdf-v1" }` and support both on read

---

## 4. Replay Protection on Mutable URIs

**Priority:** P1 — state reversion attack
**Front:** 1 (Cryptography)
**Effort:** 2–3 days
**Files:** `libs/b3nd-auth/mod.ts:71` (`validateAuthMessage`), `libs/b3nd-client-postgres/mod.ts`

### Problem

A valid signed write `W1` to `b3nd://alice/profile` remains valid forever. An attacker can capture it and replay it after Alice updates with `W2`, reverting her profile. The signature check has no temporal dimension.

### Failure Scenario

1. Alice signs and writes profile update W1 (age: 25)
2. Alice signs and writes profile update W2 (age: 26)
3. Attacker replays W1 — signature is valid, node accepts it
4. Alice's profile reverts to age 25

### Solution

**Monotonic sequence numbers per URI:**

**Step 1:** Add `seq` field to signed message envelope:

```typescript
interface SignedMessage<D> {
  uri: string;
  data: D;
  seq: number;       // NEW: monotonically increasing per URI
  timestamp: number;  // Wall clock (informational, not authoritative)
  signature: string;
  pubkey: string;
}
```

**Step 2:** Include `seq` in the signed payload (it MUST be covered by the signature).

**Step 3:** In `validateAuthMessage()`, add sequence check:

```typescript
function validateAuthMessage(msg: SignedMessage, storedSeq: number): boolean {
  // Existing: verify signature against pubkey
  if (!verifySignature(msg)) return false;
  // NEW: reject if seq is not strictly greater than stored
  if (msg.seq <= storedSeq) return false;
  return true;
}
```

**Step 4:** Store current `seq` per URI in persistence layer. On write, update `seq`. On read, return current `seq` so the client knows the next valid value.

**Step 5:** For initial writes (no stored seq), accept any seq > 0.

### Acceptance Criteria

- [ ] Signed messages include `seq` in signed payload
- [ ] Persistence layer stores and enforces `seq` per URI
- [ ] Replay of old message (lower seq) is rejected
- [ ] Test: write seq=1, write seq=2, replay seq=1 → rejected
- [ ] Test: write seq=1, write seq=1 (duplicate) → rejected
- [ ] Test: write seq=1, write seq=3 (gap) → accepted (gaps are OK)

---

## 5. Merkle Tree Delta Replication Protocol

**Priority:** P1 — blocks multi-node operation
**Front:** 2 (Network)
**Effort:** 2–3 weeks
**Files:** New module `libs/b3nd-sync/`, integration with `libs/b3nd-client-postgres/`

### Problem

No replication protocol exists. `parallelBroadcast` writes to multiple backends simultaneously but has no mechanism for post-divergence synchronization. If a node goes offline and returns, it cannot determine what changed. Full-sync is O(N) and prohibitively expensive.

### Solution: Merkle Tree Anti-Entropy

**Step 1:** Create `libs/b3nd-sync/merkle.ts` — binary Merkle tree over sorted URI keyspace:

```
Leaf:   H(uri || seq || data_hash)
Node:   H(left_child || right_child)
Root:   Single hash representing entire dataset state
```

**Step 2:** Create `libs/b3nd-sync/protocol.ts` — pull-based sync protocol:

```typescript
interface SyncRequest {
  type: "sync_request";
  nodeId: string;
  treeLevel: number;       // 0 = root, deeper = more specific
  rangeStart: string;       // URI range (inclusive)
  rangeEnd: string;         // URI range (exclusive)
  hash: string;             // Hash of this subtree
}

interface SyncResponse {
  type: "sync_response";
  match: boolean;           // true = subtrees identical, skip
  children?: Array<{        // If not matching, recurse into these
    hash: string;
    rangeStart: string;
    rangeEnd: string;
    recordCount: number;
  }>;
  records?: Array<{         // At leaf level, the actual data
    uri: string;
    seq: number;
    data: unknown;
  }>;
}
```

**Step 3:** Integrate with persistence layer. On each `receive()`, update leaf hash and propagate up the tree. Amortized O(log N) per write.

**Step 4:** Create HTTP endpoints:

```
POST /sync/request  → accepts SyncRequest, returns SyncResponse
POST /sync/push     → accepts records to write (after sync identifies gaps)
GET  /sync/status   → returns { rootHash, recordCount, lastSyncTime }
```

**Step 5:** Sync scheduler — periodic pull from known peers (configurable interval, default 30s).

### Complexity

- Tree construction: O(N log N)
- Sync with K differences out of N total: O(K log N) comparisons + O(K) transfers
- 1M records, 100 differences: ~1,700 hash comparisons vs 1M full scan

### Acceptance Criteria

- [ ] Merkle tree module with insert/update/delete/root-hash/range-query
- [ ] Sync protocol over HTTP with request/response cycle
- [ ] Two nodes with identical data: sync completes in 1 round (root hash match)
- [ ] Two nodes with K differences: sync transfers exactly K records
- [ ] Incremental tree update on each write (no full rebuild)
- [ ] Conflict resolution: highest `seq` wins (LWW per URI)
- [ ] Test: partition two nodes, write to each independently, reconnect → convergence
- [ ] Benchmark: sync 100 differences in 1M records < 1 second

---

## 6. Server-Sent Events (SSE) Push/Subscribe

**Priority:** P2 — enables real-time applications
**Front:** 2 (Network)
**Effort:** 3–5 days
**Files:** New endpoints in server module, new `libs/b3nd-subscribe/`

### Problem

Clients must poll `list()` or `read()` to detect changes. This makes real-time applications (chat, IoT dashboards, collaborative editing) unviable. Polling at 1s intervals with 1000 clients = 1000 req/s of waste.

### Solution: SSE Over HTTP

**Step 1:** Add SSE endpoint:

```
GET /subscribe?uri=b3nd://alice/messaging/*&since=<seq>
Accept: text/event-stream
```

**Step 2:** Event format:

```typescript
interface SubscriptionEvent {
  type: "write" | "delete" | "heartbeat";
  uri: string;
  seq: number;
  timestamp: number;
  data?: unknown;       // Included for writes, omitted for deletes
}

// SSE wire format:
// event: write
// data: {"uri":"b3nd://alice/messaging/bob/1","seq":42,"data":{...}}
//
// event: heartbeat
// data: {"timestamp":1710590400}
```

**Step 3:** Server-side fan-out. On each `receive()`, check active subscriptions matching the URI pattern. Push event to matching SSE connections.

**Step 4:** Wildcard matching on URI patterns:
- `b3nd://alice/messaging/*` — all messages under messaging
- `b3nd://alice/**` — everything under alice
- Exact match: `b3nd://alice/profile`

**Step 5:** Heartbeat every 30s to keep connection alive and detect dead clients.

**Step 6:** `since` parameter for catch-up: on connect, replay events with seq > `since`.

### Acceptance Criteria

- [ ] SSE endpoint returns `text/event-stream` content type
- [ ] Write to a URI triggers event on matching subscriptions
- [ ] Wildcard URI patterns work (*, **)
- [ ] `since` parameter replays missed events
- [ ] Heartbeat keeps connection alive
- [ ] Client disconnect is detected and subscription cleaned up
- [ ] Test: 100 concurrent subscriptions, 10 writes/sec → all clients receive all events
- [ ] Benchmark: event delivery latency < 50ms from write to client receipt

---

## 7. Push Sort/Limit to SQL in `list()`

**Priority:** P2 — scalability bottleneck
**Front:** 3 (Software & Systems)
**Effort:** 1–2 days
**File:** `libs/b3nd-client-postgres/mod.ts:278-341`

### Problem

`list()` loads ALL matching rows into JavaScript, then applies sort and limit in memory. For a URI prefix with 100K matches but a client requesting 10 results, this transfers 100K rows from Postgres, deserializes them all, then discards 99,990.

### Solution

**Step 1:** Accept sort/limit parameters in the `list()` interface:

```typescript
interface ListOptions {
  prefix: string;
  limit?: number;          // SQL LIMIT
  offset?: number;         // SQL OFFSET (for pagination)
  orderBy?: "uri" | "timestamp";
  order?: "asc" | "desc";
}
```

**Step 2:** Push to SQL:

```typescript
async list(options: ListOptions): Promise<ListResult> {
  const { prefix, limit, offset, orderBy = "uri", order = "asc" } = options;
  const table = `${this.tablePrefix}_data`;

  let sql = `SELECT uri, data, timestamp FROM ${table} WHERE uri LIKE $1`;
  const args: unknown[] = [prefix + "%"];

  // Validate orderBy to prevent SQL injection (whitelist only)
  const validOrderBy = { uri: "uri", timestamp: "timestamp" };
  const col = validOrderBy[orderBy] ?? "uri";
  sql += ` ORDER BY ${col} ${order === "desc" ? "DESC" : "ASC"}`;

  if (limit !== undefined) {
    sql += ` LIMIT $${args.length + 1}`;
    args.push(limit);
  }
  if (offset !== undefined) {
    sql += ` OFFSET $${args.length + 1}`;
    args.push(offset);
  }

  const result = await this.executor.query(sql, args);
  return { entries: result.rows };  // Already sorted and limited by DB
}
```

**Step 3:** Add index if not present:

```sql
CREATE INDEX IF NOT EXISTS idx_data_uri_prefix ON {table}_data (uri text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_data_timestamp ON {table}_data (timestamp);
```

### Acceptance Criteria

- [ ] `list()` accepts `limit`, `offset`, `orderBy`, `order` parameters
- [ ] SQL query includes ORDER BY, LIMIT, OFFSET
- [ ] No in-memory sort/filter after SQL returns
- [ ] Backward compatible: omitting parameters gives same behavior as before
- [ ] Test: 100K rows, limit=10 → only 10 rows transferred from DB
- [ ] Benchmark: list(limit=10) on 100K rows < 10ms (vs current ~500ms+)

---

## 8. Structured Error Types

**Priority:** P2 — developer experience
**Front:** 3 (Software & Systems)
**Effort:** 1–2 days
**Files:** New `libs/b3nd-errors/mod.ts`, updates to all `receive()` / `read()` / `list()` return types

### Problem

Errors are returned as strings (`error: "Failed to store output: ..."`). Callers cannot programmatically distinguish between authentication failures, validation errors, not-found, conflict, or internal errors without string parsing.

### Solution

**Step 1:** Define error type hierarchy:

```typescript
// libs/b3nd-errors/mod.ts
export enum ErrorCode {
  // Auth errors (4xx equivalent)
  UNAUTHORIZED = "UNAUTHORIZED",           // No valid signature
  FORBIDDEN = "FORBIDDEN",                 // Valid sig, wrong permissions
  // Validation errors
  INVALID_URI = "INVALID_URI",             // Malformed URI
  INVALID_SCHEMA = "INVALID_SCHEMA",       // Data doesn't match schema
  INVALID_SEQUENCE = "INVALID_SEQUENCE",   // Replay / out-of-order seq
  // State errors
  NOT_FOUND = "NOT_FOUND",                 // URI doesn't exist
  CONFLICT = "CONFLICT",                   // Concurrent write conflict
  // Internal errors
  STORAGE_ERROR = "STORAGE_ERROR",         // DB/persistence failure
  INTERNAL_ERROR = "INTERNAL_ERROR",       // Catch-all
}

export interface B3ndError {
  code: ErrorCode;
  message: string;          // Human-readable
  uri?: string;             // Which URI was involved
  details?: unknown;        // Additional context (schema violations, etc.)
}

export interface ReceiveResult {
  accepted: boolean;
  error?: B3ndError;        // Was: error?: string
}
```

**Step 2:** Update all `receive()`, `read()`, `list()`, `delete()` to return `B3ndError` instead of strings.

**Step 3:** Export error constructors for convenience:

```typescript
export const Errors = {
  unauthorized: (uri: string, msg?: string): B3ndError =>
    ({ code: ErrorCode.UNAUTHORIZED, message: msg ?? "Unauthorized", uri }),
  invalidSchema: (uri: string, violations: unknown): B3ndError =>
    ({ code: ErrorCode.INVALID_SCHEMA, message: "Schema validation failed", uri, details: violations }),
  // ... etc
};
```

### Acceptance Criteria

- [ ] `ErrorCode` enum with all error categories
- [ ] `B3ndError` interface with code, message, uri, details
- [ ] All persistence backends return `B3ndError` instead of strings
- [ ] Callers can switch on `error.code` without string parsing
- [ ] Existing error messages preserved in `error.message`
- [ ] No breaking changes to `ReceiveResult.accepted` boolean check

---

## 9. JSON Canonicalization in Signing Path

**Priority:** P3 — correctness risk
**Front:** 1 (Cryptography)
**Effort:** 1 day
**Files:** `libs/b3nd-auth/mod.ts`, `libs/b3nd-encrypt/mod.ts` (signing functions)

### Problem

When signing JSON data, the signature covers `JSON.stringify(data)`. But JSON key ordering is not guaranteed by spec. If data is serialized, deserialized, and re-serialized on a different runtime or after object manipulation, key order may change, producing a different string for the same logical data. The signature then fails to verify.

### Solution

**Step 1:** Add RFC 8785 (JSON Canonicalization Scheme / JCS) implementation or import a library:

```typescript
// Deterministic JSON serialization per RFC 8785
export function canonicalJson(data: unknown): string {
  if (data === null || typeof data !== "object") {
    return JSON.stringify(data);
  }
  if (Array.isArray(data)) {
    return "[" + data.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(data).sort();
  const pairs = keys.map(k => `${JSON.stringify(k)}:${canonicalJson((data as Record<string, unknown>)[k])}`);
  return "{" + pairs.join(",") + "}";
}
```

**Step 2:** Replace `JSON.stringify(data)` with `canonicalJson(data)` in all signature creation and verification paths.

**Step 3:** Verify that the canonicalization is applied on BOTH sign and verify sides.

### Acceptance Criteria

- [ ] `canonicalJson()` produces deterministic output per RFC 8785
- [ ] All signature paths use `canonicalJson()` instead of `JSON.stringify()`
- [ ] Test: sign data `{b:1, a:2}`, verify against `{a:2, b:1}` → passes
- [ ] Test: nested objects with different key orders → same canonical form
- [ ] Backward compatibility: re-sign existing data if canonical form differs (migration)

---

## Dependency Graph

```
Independent (can start immediately, in parallel):
  [1] Atomic writes
  [2] PBKDF2 upgrade
  [7] SQL push-down in list()
  [8] Structured errors
  [9] JSON canonicalization

Depends on [4] replay protection:
  [5] Merkle replication (uses seq numbers for conflict resolution)

Depends on [8] structured errors:
  [6] SSE/subscribe (uses error types in event stream)

Suggested execution order:
  Week 1:  [1] [2] [9] in parallel (quick wins, security fixes)
  Week 2:  [3] [7] [8] in parallel
  Week 3:  [4] replay protection
  Week 4-5: [5] Merkle replication
  Week 5-6: [6] SSE/subscribe
```

---

## Notes for Engineers

- All file paths reference the `libs/` directory in the b3nd-sdk monorepo
- The codebase is TypeScript/Deno — use Deno-compatible imports
- The primary persistence backend is Postgres via `libs/b3nd-client-postgres/`
- There is also an in-memory backend — all interface changes must be reflected there too
- The research reports in `research/round-2/` contain full context, threat models, and alternative approaches for each item
- When in doubt about design intent, check the existing code patterns — b3nd is intentionally minimal

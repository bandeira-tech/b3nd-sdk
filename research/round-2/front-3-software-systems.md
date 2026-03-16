# Front 3: Software Engineering & Systems — Round 2 Deep-Dive

**Round 2 — b3nd Framework & Firecat Network**
**Date:** 2026-03-16

---

## Executive Summary

Round 1 identified 10 weaknesses in b3nd's SDK architecture. This deep-dive provides root cause analysis, concrete code solutions, and migration paths for each. The three highest-priority fixes are: (1) storage-layer atomicity for MessageData envelopes, (2) pushing sort/limit to SQL in list(), and (3) adding structured error types. Together these resolve the most critical correctness, scalability, and developer experience issues.

---

## 1. Non-Atomic MessageData Envelope Storage (Critical)

### Current State

In `libs/b3nd-client-postgres/mod.ts:130-151`, MessageData envelopes store outputs one at a time via recursive `receive()` calls:

```typescript
// mod.ts:137-151
if (isMessageData(data)) {
  for (const [outputUri, outputValue] of data.payload.outputs) {
    const outputResult = await this.receive([outputUri, outputValue]);
    if (!outputResult.accepted) {
      return {
        accepted: false,
        error: outputResult.error || `Failed to store output: ${outputUri}`,
      };
    }
  }
}
```

Each `receive()` call executes an independent SQL `INSERT ... ON CONFLICT DO UPDATE`. If the process crashes after storing output 2 of 5, the envelope is partially written.

### Root Cause Analysis

The persistence layer has no transaction abstraction. `SqlExecutor.query()` executes individual statements. There's no `beginTransaction()`/`commit()`/`rollback()` in the interface.

### Proposed Solution

**Add transaction support to SqlExecutor:**

```typescript
export interface SqlExecutor {
  query: (sql: string, args?: unknown[]) => Promise<SqlExecutorResult>;
  // NEW: Transaction support
  transaction: <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
  cleanup?: () => Promise<void>;
}
```

**Wrap MessageData storage in a transaction:**

```typescript
async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
  const [uri, data] = msg;
  // ... validation ...

  if (isMessageData(data)) {
    // Atomic: all outputs or nothing
    return await this.executor.transaction(async (tx) => {
      const table = `${this.tablePrefix}_data`;

      // Store envelope
      await tx.query(
        `INSERT INTO ${table} (uri, data, timestamp) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (uri) DO UPDATE SET data = EXCLUDED.data, timestamp = EXCLUDED.timestamp`,
        [uri, JSON.stringify(encodedData), record.ts]
      );

      // Store all outputs
      for (const [outputUri, outputValue] of data.payload.outputs) {
        const outputRecord = { ts: Date.now(), data: encodeBinaryForJson(outputValue) };
        await tx.query(
          `INSERT INTO ${table} (uri, data, timestamp) VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (uri) DO UPDATE SET data = EXCLUDED.data, timestamp = EXCLUDED.timestamp`,
          [outputUri, JSON.stringify(outputRecord.data), outputRecord.ts]
        );
      }

      return { accepted: true };
    });
  }

  // Non-MessageData: single write (already atomic)
  // ... existing code ...
}
```

**Executor implementation (for pg driver):**

```typescript
// In pg-executor.ts
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

### Impact Assessment
- **Without fix:** Partial writes corrupt state; users see inconsistent data
- **With fix:** Atomic all-or-nothing; database guarantees consistency
- Postgres transactions add ~1ms overhead (negligible)

### Implementation Plan
1. Add `transaction` to `SqlExecutor` interface
2. Implement in `pg-executor.ts` and `mongo-executor.ts`
3. Wrap MessageData storage in transaction
4. Add no-op transaction for MemoryClient (already atomic in JS single-threaded)
5. **~200 lines, 3-5 days**

### Open Questions
- Should `receive()` also validate fee conservation (inputs ≥ outputs) within the transaction?
- What about cross-node atomicity? (Out of scope — requires distributed transactions or saga pattern)

### Cross-Front Dependencies
- **Front 4 (Economics):** Fee conservation validation belongs in this transaction
- **Front 5 (Consensus):** Consensus messages should be stored atomically with user data

---

## 2. List Operation Scalability (Critical)

### Current State

`list()` in `libs/b3nd-client-postgres/mod.ts:278-341` loads ALL matching rows into JavaScript memory, then sorts and paginates in JS:

```typescript
// mod.ts:284-287 — loads everything
const rowsRes = await this.executor.query(
  `SELECT uri, timestamp FROM ${table} WHERE uri LIKE $1 || '%'`,
  [prefix]
);

// mod.ts:309-322 — sort in JS
if (options?.sortBy === "name") {
  items.sort((a, b) => a.uri.localeCompare(b.uri));
}

// mod.ts:324-327 — paginate in JS
const paginated = items.slice(offset, offset + limit);
```

For a namespace with 1M URIs, this loads 1M rows into Node/Deno memory, sorts them, then returns 50.

### Root Cause Analysis

The SQL query lacks `ORDER BY` and `LIMIT` clauses. This was likely a simplicity choice during initial development, but it creates O(N) memory usage where O(1) is possible.

### Proposed Solution

**Push sort/limit to SQL:**

```typescript
async list(uri: string, options?: ListOptions): Promise<ListResult> {
  const table = `${this.tablePrefix}_data`;
  const prefix = uri.endsWith("/") ? uri : `${uri}/`;
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 50;
  const offset = (page - 1) * limit;

  // Build SQL with ORDER BY and LIMIT
  let orderClause = "ORDER BY uri ASC"; // default
  if (options?.sortBy === "timestamp") {
    orderClause = `ORDER BY timestamp ${options?.sortOrder === "desc" ? "DESC" : "ASC"}`;
  } else if (options?.sortBy === "name") {
    orderClause = `ORDER BY uri ${options?.sortOrder === "desc" ? "DESC" : "ASC"}`;
  }

  // Pattern filtering via SQL LIKE (if simple) or server-side regex
  let whereClause = `WHERE uri LIKE $1 || '%'`;
  const params: unknown[] = [prefix];

  if (options?.pattern) {
    // PostgreSQL native regex
    whereClause += ` AND uri ~ $2`;
    params.push(options.pattern);
  }

  // Count total for pagination
  const countRes = await this.executor.query(
    `SELECT COUNT(*) as total FROM ${table} ${whereClause}`,
    params
  );
  const total = Number((countRes.rows[0] as any).total);

  // Fetch only the requested page
  const dataRes = await this.executor.query(
    `SELECT uri FROM ${table} ${whereClause} ${orderClause} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const data: ListItem[] = (dataRes.rows || []).map((row: any) => ({ uri: row.uri }));

  return {
    success: true,
    data,
    pagination: { page, limit, total },
  };
}
```

**Index requirement:** Ensure a composite index exists:

```sql
CREATE INDEX idx_b3nd_data_uri_prefix ON ${table} USING btree (uri text_pattern_ops);
CREATE INDEX idx_b3nd_data_timestamp ON ${table} (timestamp);
```

### Impact Assessment
- **Before:** O(N) memory, O(N log N) CPU for sort, where N = total matching rows
- **After:** O(limit) memory, O(log N) for indexed query
- 1M URIs: ~500MB memory → ~10KB memory; 2s query → 5ms query

### Implementation Plan
1. Rewrite `list()` with SQL ORDER BY/LIMIT/OFFSET
2. Add migration script for indexes
3. Update tests
4. **~100 lines changed, 2-3 days**

### Open Questions
- Should we also support cursor-based pagination? (Yes, for real-time use cases — OFFSET is inefficient for deep pages)
- How does this interact with the Mongo client's equivalent? (Mongo has native sort/limit)

### Cross-Front Dependencies
- **Front 6 (Math):** Complexity analysis of pagination strategies

---

## 3. Structured Error Types (High)

### Current State

All error responses are string-only:

```typescript
// From types.ts
interface ReceiveResult { accepted: boolean; error?: string; }
interface ReadResult<T> { success: boolean; error?: string; }
interface DeleteResult { success: boolean; error?: string; }
```

The codebase already has `ClientError` with a `code` field (`libs/b3nd-core/types.ts:379-388`), but it's not used in the persistence layer — all errors are returned as plain strings.

### Root Cause Analysis

Error handling evolved organically. The `ClientError` class was added later but the persistence clients predate it and return `error instanceof Error ? error.message : String(error)` patterns throughout.

### Proposed Solution

**Error code enum:**

```typescript
export enum ErrorCode {
  // Validation errors (4xx equivalent)
  VALIDATION_FAILED = "VALIDATION_FAILED",
  SCHEMA_NOT_FOUND = "SCHEMA_NOT_FOUND",
  URI_INVALID = "URI_INVALID",
  AUTH_FAILED = "AUTH_FAILED",
  REPLAY_DETECTED = "REPLAY_DETECTED",

  // Not found (404)
  NOT_FOUND = "NOT_FOUND",

  // Conflict (409)
  CONFLICT = "CONFLICT",
  CONCURRENT_WRITE = "CONCURRENT_WRITE",

  // Server errors (5xx equivalent)
  STORAGE_ERROR = "STORAGE_ERROR",
  CONNECTION_ERROR = "CONNECTION_ERROR",
  TIMEOUT = "TIMEOUT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

// Updated result types
interface ReceiveResult {
  accepted: boolean;
  error?: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}
```

**Migration path:** Add error code alongside existing string error. Keep `error` as a union type during transition:

```typescript
interface ReceiveResult {
  accepted: boolean;
  error?: string | { code: ErrorCode; message: string; details?: unknown };
}
```

### Impact Assessment
- Enables programmatic error handling (retry on TIMEOUT, fail on VALIDATION_FAILED)
- Client libraries can provide better UX (localized messages, specific recovery actions)
- HTTP clients can map error codes to status codes

### Implementation Plan
1. Define `ErrorCode` enum in `libs/b3nd-core/types.ts`
2. Update Postgres/Mongo/Memory clients to use structured errors
3. Update HTTP/WS server to map error codes to HTTP status codes
4. Keep backward compatibility with string errors during transition
5. **~300 lines across 8 files, 1 week**

### Cross-Front Dependencies
- **Front 2 (Network):** HTTP status code mapping
- **Front 4 (Economics):** Error codes for fee-related failures

---

## 4. TOCTOU Vulnerability in Validation Pipeline (High)

### Current State

The `receive()` flow in the Postgres client:

```
1. Extract program key
2. Validate (calls validator function, which may read() other URIs)
3. Store (INSERT/UPSERT)
```

Between steps 2 and 3, another concurrent request could modify the state that the validator read. This is a classic Time-of-Check-to-Time-of-Use (TOCTOU) vulnerability.

**Example attack:**
1. Validator checks: `read("balance://alice") → { amount: 100 }`
2. Concurrent request: writes `balance://alice → { amount: 0 }`
3. Original write stores a transfer assuming alice has 100 — she now has 0

### Proposed Solution

**Use `SELECT ... FOR UPDATE` in the validation read path within a transaction:**

```typescript
// When validator reads during a transaction, acquire row lock
const validatorRead = async <T>(uri: string): Promise<ReadResult<T>> => {
  const res = await tx.query(
    `SELECT data, timestamp as ts FROM ${table} WHERE uri = $1 FOR UPDATE`,
    [uri]
  );
  // Row is now locked until transaction completes
  // ... return result
};

// Pass locked read to validator
const validation = await validator({
  uri, value: data, read: validatorRead
});
```

This combines with the transaction solution from Section 1: the entire validate-then-store sequence runs in a single SQL transaction with row-level locking.

### Tradeoffs
- `FOR UPDATE` can cause lock contention on hot URIs
- Deadlocks possible if two transactions lock the same URIs in different order
- Only works for Postgres (need equivalent for Mongo, no solution for Memory)
- Increases transaction duration (validation + store, not just store)

### Open Questions
- Should we use optimistic concurrency control instead? (Compare-and-swap with version numbers)
- How to handle deadlocks? (Automatic retry with backoff, limit to 3 attempts)
- Is TOCTOU actually exploitable in practice? (Yes, for any financial or access-control validation)

### Cross-Front Dependencies
- **Front 1 (Crypto):** TOCTOU in auth validation could allow privilege escalation
- **Front 5 (Consensus):** Consensus should serialize conflicting writes

---

## 5. No Subscription/Push Mechanism (High)

### Current State

Covered in detail in Front 2, Section 2 (SSE push/subscribe). From a systems perspective, the key change needed is:

1. **Write event emitter:** The `receive()` path must emit events when data is written
2. **Connection management:** SSE connections must be tracked and cleaned up
3. **Backpressure:** Slow consumers must not block the write path

### Proposed Solution

```typescript
// Write event emitter (in-process EventEmitter)
class WriteEventEmitter {
  private listeners = new Map<string, Set<(record: PersistenceRecord) => void>>();

  on(prefix: string, callback: (record: PersistenceRecord) => void): () => void {
    if (!this.listeners.has(prefix)) this.listeners.set(prefix, new Set());
    this.listeners.get(prefix)!.add(callback);
    return () => this.listeners.get(prefix)?.delete(callback);
  }

  emit(uri: string, record: PersistenceRecord): void {
    for (const [prefix, callbacks] of this.listeners) {
      if (uri.startsWith(prefix)) {
        for (const cb of callbacks) {
          // Non-blocking: don't await
          try { cb(record); } catch { /* log, don't crash */ }
        }
      }
    }
  }
}
```

Integrate into `receive()`: after successful storage, call `this.emitter.emit(uri, record)`.

### Implementation Plan
- ~200 lines, 3-5 days (systems portion; SSE endpoint is Front 2)

### Cross-Front Dependencies
- **Front 2 (Network):** SSE endpoint consumes these events

---

## 6. No Consistency Model for Multi-Node (High)

### Current State

No consistency guarantees are documented or enforced. `parallelBroadcast` writes to multiple backends but:
- No conflict detection
- No read-your-writes guarantee across nodes
- No causal ordering
- Last-Writer-Wins by timestamp (wall clock, which can skew)

### Proposed Solution

**Document and implement "session consistency" as the default:**

```
Guarantees:
1. Read-your-writes: Within a session, reads reflect all prior writes from that session
2. Monotonic reads: Once you read version V, you never see version < V
3. Eventual consistency: All replicas converge (via Merkle sync from Front 2)

Non-guarantees:
1. No linearizability across sessions
2. No causal ordering across users (requires vector clocks)
3. No real-time recency
```

**Implementation: session token with vector clock:**

```typescript
interface SessionContext {
  sessionId: string;
  lastWriteTs: Map<string, number>;  // URI → last write timestamp from this session
}

// On write: record URI → timestamp in session context
// On read: if session context has a higher timestamp for this URI than
//          the storage backend, wait or read from the node that accepted the write
```

### Implementation Complexity
- Session context tracking: ~200 lines
- Read-your-writes enforcement: ~150 lines
- Documentation: ~1 page
- **Total: ~350 lines, 1 week**

### Cross-Front Dependencies
- **Front 2 (Network):** Replication timing affects consistency
- **Front 5 (Consensus):** Consensus provides stronger guarantees for critical data

---

## 7. Cross-Platform Reliability (Medium)

### Current State

The SDK targets Deno (primary), Node.js (via npm compatibility), and browsers (via bundling). Key platform differences:

- **Crypto:** Deno and browsers use `crypto.subtle`; Node.js has `webcrypto.subtle` (slightly different API)
- **Storage:** Postgres/Mongo are server-only; localStorage/IndexedDB are browser-only
- **Network:** Fetch API is available everywhere; WebSocket varies
- **Binary:** `Uint8Array` handling differs in JSON serialization across platforms

### Proposed Solution

**Platform abstraction layer:**

```typescript
// libs/b3nd-core/platform.ts
export const platform = {
  crypto: globalThis.crypto?.subtle,
  fetch: globalThis.fetch,
  WebSocket: globalThis.WebSocket,
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
};

// Validation at import time
if (!platform.crypto) {
  throw new Error("b3nd requires Web Crypto API (crypto.subtle). " +
    "In Node.js < 19, use: globalThis.crypto = require('crypto').webcrypto");
}
```

**Cross-platform test matrix:**

```
          | Deno  | Node 20+ | Chrome | Firefox | Safari |
Memory    |  ✓    |    ✓     |   ✓    |    ✓    |   ✓    |
HTTP      |  ✓    |    ✓     |   ✓    |    ✓    |   ✓    |
WS        |  ✓    |    ✓     |   ✓    |    ✓    |   ✓    |
Postgres  |  ✓    |    ✓     |   -    |    -    |   -    |
IndexedDB |  -    |    -     |   ✓    |    ✓    |   ✓    |
LocalStore|  -    |    -     |   ✓    |    ✓    |   ✓    |
Crypto    |  ✓    |    ✓     |   ✓    |    ✓    |   ✓*   |
```

*Safari: Ed25519 support added in Safari 17.

### Implementation Plan
- Platform detection module: ~50 lines
- CI matrix for Node.js testing: ~1 day setup
- Browser test harness (Playwright): ~2 days
- **Total: 1 week**

### Cross-Front Dependencies
- **Front 1 (Crypto):** Post-quantum WASM must work across platforms

---

## 8. Schema Validation Completeness (Medium)

### Current State

Schema validators are pure functions (`ValidationFn`) that return `{ valid: boolean; error?: string }`. This is elegant but:

- No type safety between schema key and expected data shape
- No documentation generation from schemas
- No way to introspect what a schema expects
- Regex patterns (`uriPattern` validator) are string-based, not composable

### Proposed Solution

**Type-safe schema builder:**

```typescript
// New: composable schema builder
const userProfile = schema.define("mutable://users")
  .expects<{ name: string; email: string }>()
  .validate(({ value }) => {
    if (typeof value.name !== "string") return { valid: false, error: "name required" };
    if (typeof value.email !== "string") return { valid: false, error: "email required" };
    return { valid: true };
  })
  .withAuth(requireSignature)
  .build();

// Generates both runtime validator AND TypeScript type
type UserProfile = SchemaType<typeof userProfile>;
// { name: string; email: string }
```

This is an enhancement, not a replacement — existing `ValidationFn` schemas continue to work.

### Implementation Complexity
- Schema builder: ~300 lines
- Type inference utilities: ~100 lines
- **Total: ~400 lines, 1 week**

### Cross-Front Dependencies
- **Front 1 (Crypto):** Auth validation as composable schema step

---

## 9. Developer Experience and Onboarding (Medium)

### Current State

Key friction points from Round 1:
- No CLI tool for scaffolding
- Error messages are strings without actionable guidance
- No interactive examples (only static docs)
- Multiple client types with non-obvious selection criteria

### Proposed Solution

**Priority 1: Improve error messages** (covered in Section 3)

**Priority 2: Client selection guide in code:**

```typescript
// libs/b3nd-core/mod.ts — re-export with guidance
/**
 * Choose your client:
 *
 * Development:     MemoryClient     — zero setup, in-process
 * Browser:         IndexedDBClient  — persistent, offline-capable
 * Server (simple): HttpClient       — connects to remote node
 * Server (prod):   PostgresClient   — direct database, full control
 * Real-time:       WebSocketClient  — bidirectional, subscriptions
 */
```

**Priority 3: `b3nd init` CLI scaffolding** — generates a minimal project with chosen client type, schema, and example handler.

### Implementation Complexity
- Error improvements: covered in Section 3
- Documentation: ~2 days
- CLI scaffolding: ~500 lines, 1 week
- **Total: 1.5 weeks**

---

## 10. Storage Backend Abstraction Quality (Low)

### Current State

All clients implement `NodeProtocolInterface` directly. There's no intermediate "storage backend" layer. This means each client re-implements validation, pagination, binary encoding, etc.

The `createValidatedClient()` in `libs/b3nd-compose/` partially addresses this by separating validation from storage, but the storage clients still contain duplicated logic.

### Proposed Solution

**Extract a `StorageBackend` interface:**

```typescript
interface StorageBackend {
  put(uri: string, record: PersistenceRecord): Promise<void>;
  get(uri: string): Promise<PersistenceRecord | null>;
  getMulti(uris: string[]): Promise<Map<string, PersistenceRecord>>;
  list(prefix: string, sort: SortSpec, limit: number, offset: number): Promise<ListPage>;
  delete(uri: string): Promise<boolean>;
  transaction?<T>(fn: (tx: StorageBackend) => Promise<T>): Promise<T>;
}
```

Then `NodeProtocolInterface` implementations become thin wrappers:

```typescript
class GenericClient implements NodeProtocolInterface {
  constructor(
    private backend: StorageBackend,
    private schema: Schema
  ) {}

  async receive<D>(msg: Message<D>): Promise<ReceiveResult> {
    const [uri, data] = msg;
    const validation = await this.validate(uri, data);
    if (!validation.valid) return { accepted: false, error: validation.error };
    await this.backend.put(uri, { ts: Date.now(), data });
    return { accepted: true };
  }
}
```

### Impact Assessment
- Eliminates duplicated validation/encoding logic across 6 client implementations
- Makes adding new backends trivial (~50 lines for the backend, shared client logic)
- Enables testing storage backends independently from protocol logic

### Implementation Complexity
- StorageBackend interface: ~50 lines
- GenericClient: ~200 lines
- Refactor existing clients: ~300 lines per client
- **Total: ~2000 lines (mostly moving existing code), 2-3 weeks**

### Open Questions
- Is the abstraction premature? (6 clients suggests it's warranted)
- Should `StorageBackend` include streaming? (Not yet)

### Cross-Front Dependencies
- **Front 2 (Network):** New replication backend would use this interface

---

## Summary of Priorities

| # | Item | Severity | Effort | Recommendation |
|---|------|----------|--------|----------------|
| 1 | MessageData atomicity | Critical | 3-5 days | Do immediately |
| 2 | List SQL optimization | Critical | 2-3 days | Do immediately |
| 4 | TOCTOU fix | High | 3-5 days | Do with atomicity fix |
| 3 | Structured errors | High | 1 week | Next sprint |
| 5 | Push/subscribe events | High | 3-5 days | Next sprint |
| 6 | Consistency model | High | 1 week | Document first, implement second |
| 7 | Cross-platform | Medium | 1 week | CI matrix first |
| 8 | Schema builder | Medium | 1 week | After structured errors |
| 9 | Developer experience | Medium | 1.5 weeks | Ongoing |
| 10 | Storage abstraction | Low | 2-3 weeks | Next quarter |

---

## References

- PostgreSQL documentation: Explicit Locking (SELECT FOR UPDATE)
- PostgreSQL documentation: Index Types (btree, text_pattern_ops)
- Kleppmann, "Designing Data-Intensive Applications" — Ch. 7: Transactions (2017)
- Berenson et al., "A Critique of ANSI SQL Isolation Levels" (SIGMOD 1995)
- Hellerstein, Stonebraker, Hamilton, "Architecture of a Database System" (2007)
- Amazon DynamoDB: Session Consistency Model documentation
- Deno documentation: Web Crypto API compatibility

---

*This report is based on direct source code analysis of b3nd SDK. All code references point to actual implementations reviewed during this research round.*

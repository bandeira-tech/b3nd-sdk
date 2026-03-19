# B3nd Backend Datasources — Assessment & Roadmap

> Last updated: 2026-03-19

---

## Current State: 9 Clients

| Client | Type | MessageData Txn | Pattern Filter | Error Handling | Binary | Tests |
|--------|------|----------------|----------------|---------------|--------|-------|
| **MemoryClient** | Server | Recursive | Regex | Correct | In-memory | 31 pass |
| **PostgresClient** | Server | SQL Transaction | Regex | Structured (B3ndError) | base64/JSONB | Shared suite + Docker |
| **MongoClient** | Server | Transaction | Regex | Structured (B3ndError) | base64/BSON | Shared suite + Docker |
| **SqliteClient** | Server | SQL Transaction | Regex | Structured (B3ndError) | base64/TEXT | 26 pass |
| **RedisClient** | Server | MULTI/EXEC | Regex | Structured (B3ndError) | base64/JSON | 41 pass (shared + specific) |
| **HttpClient** | Transport | N/A (server-side) | N/A (server-side) | Fixed | base64 marker | Shared suite + mock |
| **WebSocketClient** | Transport | N/A (server-side) | N/A (server-side) | Fixed | base64 marker | Shared suite + mock |
| **IndexedDBClient** | Browser | Recursive | Regex | Correct | Native | 25 pass |
| **LocalStorageClient** | Browser | None | Regex | Correct | base64 marker | Browser-only |

## Changes (2026-03-19, session 6 — automated audit)

### Fixed: IndexedDBClient `list()` prefix boundary bug

- `record.uri.startsWith(uri)` matched adjacent prefixes (e.g., `list("store://users")` matched `"store://users-admin/..."`)
- Now checks `record.uri === uri || record.uri.startsWith(uri + "/")` — consistent with all other clients
- File: `libs/b3nd-client-indexeddb/mod.ts`

### Fixed: MemoryClient `list()` timestamp sort for deep URIs

- Timestamp sort used `current.children.get(a.uri.split("/").pop()!)` which only worked for immediate children
- For deeper paths, the last segment lookup returned `undefined`, causing all deep items to sort as timestamp `0`
- Now traverses the trie from the current node down to the leaf to get the actual timestamp
- File: `libs/b3nd-client-memory/mod.ts`

## Changes (2026-03-19, session 5 — automated audit)

### Fixed: Type errors in b3nd-hash and b3nd-encrypt test files

- `encrypt.test.ts`: Removed `undefined` error class argument from `assertRejects` (not a valid overload)
- `hash.test.ts`: Fixed `Uint8Array` to `BufferSource` cast for `crypto.subtle.digest`
- Both files now pass strict type checking

### Fixed: RedisClient `list()` sub-path filtering

- `list("mutable://accounts/alice")` previously returned all `mutable://accounts/*` URIs because the sorted set index only keys by program prefix (`protocol://hostname`)
- Now filters members by sub-path prefix (`uri + "/"`) before pagination, matching the behavior of PostgresClient, SqliteClient, and MemoryClient
- Also fixes `sortBy: "name"` pagination — previously sorted only within a score-ordered page; now sorts the full filtered set before slicing
- File: `libs/b3nd-client-redis/mod.ts`

## Changes (2026-03-19, session 4 — automated audit)

### Fixed: RedisClient `list()` pagination total over-count with pattern filter

- When `options.pattern` was set, `total` in pagination was still reporting the unfiltered sorted set count
- Now fetches all members and counts matches for an accurate `total` when a pattern is active
- File: `libs/b3nd-client-redis/mod.ts`

### Fixed: MongoClient validator read scope in transactions

- Validators during `receiveWithExecutor` were calling `this.read.bind(this)` — always reading from the main executor
- Now creates a transaction-scoped `readFn` via new `readWithExecutor()` private method (matching PostgresClient pattern)
- Validators within a transaction now see in-flight state, not just committed state
- `read()` public method now delegates to `readWithExecutor(uri, this.executor)` — no behavior change for external callers
- File: `libs/b3nd-client-mongo/mod.ts`

### Fixed: Config type location inconsistency

- `SqliteClientConfig` and `RedisClientConfig` were defined locally in their `mod.ts` files
- Now canonically defined in `libs/b3nd-core/types.ts` alongside all other client configs
- Client modules re-export for backwards compatibility: `export type { SqliteClientConfig } from "../b3nd-core/types.ts"`
- Files: `libs/b3nd-core/types.ts`, `libs/b3nd-client-sqlite/mod.ts`, `libs/b3nd-client-redis/mod.ts`

### Audit findings (not yet fixed)

- **LocalStorageClient permissive-by-default**: When no schema key matches a URI, the write is silently allowed. All server-side clients reject with `INVALID_SCHEMA`. Low priority since LS is used for small browser caches.
- **IndexedDBClient missing MessageData atomicity**: Outputs are stored sequentially without a transaction wrapping. IndexedDB supports transactions, so this could be tightened.
- **LocalStorageClient binary serialization**: Re-implements `__b3nd_binary__` marker serialization locally instead of using `b3nd-core/binary.ts`.
- **WebSocketClient connection polling**: Uses 100ms `setInterval` polling instead of event-based resolution for connection readiness.
- **Test gaps**: LocalStorageClient and IndexedDBClient have no `validationError` or `connectionError` test factories.

## Changes (2026-03-19, session 3)

### New: RedisClient

- Full `NodeProtocolInterface` implementation using the `RedisExecutor` pattern
- Storage layout: `HSET b3nd:{uri}` for data, `ZADD b3nd:idx:{programKey}` for sorted-set indexes
- `MULTI/EXEC` atomicity for `MessageData` envelopes (all outputs stored together)
- Optional TTL support via `defaultTtl` config (0 = no expiry)
- `readMulti` uses pipelined `HMGET` for batch reads
- `list()` uses `ZRANGEBYSCORE`/`ZREVRANGEBYSCORE` with server-side pagination
- Structured `B3ndError` on all error paths
- Full shared test suite + 15 Redis-specific tests: **41/41 pass**
- Files: `libs/b3nd-client-redis/mod.ts`, `redis-client.test.ts`

### Fixed: SQLite not wired into backend factory

- Added `sqlite:` protocol handler to `backend-factory.ts`
- Added `SqliteExecutorFactory` type to `libs/b3nd-rig/types.ts`
- `sqlite://:memory:` and `sqlite:///path/to/db.sqlite` both work
- SQLite client now auto-initializes schema on factory creation

### Fixed: Redis wired into backend factory

- Added `redis:` and `rediss:` (TLS) protocol handlers to `backend-factory.ts`
- Added `RedisExecutorFactory` type to `libs/b3nd-rig/types.ts`
- `RigConfig.executors.redis` follows same pattern as postgres/mongo/sqlite

## Changes (2026-03-19, session 2)

### New: SqliteClient

- Full `NodeProtocolInterface` implementation using the `SqliteExecutor` pattern (mirrors PostgresClient's `SqlExecutor`)
- Zero-config in-memory mode (`:memory:`) or file-backed (any path)
- Works with `@db/sqlite` (Deno native FFI), `better-sqlite3` (Node), or any driver implementing `SqliteExecutor`
- WAL mode for concurrent reads in the test executor
- Stores timestamps as TEXT to avoid 32-bit truncation in some SQLite FFI bindings
- Structured `B3ndError` on all error paths from day one
- Full shared test suite: **26/26 pass**
- Files: `libs/b3nd-client-sqlite/mod.ts`, `schema.ts`, `sqlite-client.test.ts`

### Fixed: MongoClient structured error handling

- All error paths now return `errorDetail: B3ndError` (aligned with PostgresClient)
- `receive`: INVALID_URI, INVALID_SCHEMA, STORAGE_ERROR
- `read`: NOT_FOUND, STORAGE_ERROR
- `delete`: NOT_FOUND, STORAGE_ERROR
- Callers can now `switch (result.errorDetail?.code)` consistently across Postgres, Mongo, and SQLite

### Fixed: MongoClient server-side pagination

- Extended `MongoExecutor.findMany()` to accept `{ sort, skip, limit }` options
- Added optional `countDocuments()` to `MongoExecutor` for efficient count queries
- `list()` now pushes sort/skip/limit to MongoDB instead of fetching all docs into memory
- Falls back gracefully: if `countDocuments` is not provided, uses `findMany().length`

### Fixed: Browser client schema matching

- `LocalStorageClient` and `IndexedDBClient` now use URL-based program key extraction (`new URL(uri)` → `protocol://hostname`) instead of `uri.startsWith(programKey)`
- This prevents false matches where `"mutable://account"` would erroneously match `"mutable://accounts/..."`
- Consistent with MemoryClient, PostgresClient, MongoClient, and SqliteClient
- Falls back to prefix matching for non-URL URIs

## Previous Fixes (2026-03-19, session 1)

1. **MongoClient: MessageData atomicity** — Added `transaction` method to `MongoExecutor`
2. **IndexedDBClient: Missing MessageData fanout** — Now recursively stores outputs
3. **Pattern filter consistency** — Browser clients use `new RegExp(pattern).test(uri)`
4. **HttpClient/WebSocketClient: list() error handling** — Returns `success: false` on errors
5. **IndexedDBClient: cleanup() timeout** — Replaced hardcoded `setTimeout` with proper `db.close()`

## Remaining Quality Issues

- **LocalStorageClient**: No MessageData output handling (low priority — used for small browser-side caches)
- **LocalStorageClient**: Permissive-by-default when no schema key matches (silently allows writes)
- **IndexedDBClient**: Missing MessageData atomicity — outputs stored sequentially, no IDB transaction wrapping
- **LocalStorageClient**: Binary serialization re-implemented locally instead of using `b3nd-core/binary.ts`
- **WebSocketClient auth**: Bearer tokens in URL query params; consider first-message auth handshake
- **WebSocketClient**: Connection readiness polling (100ms interval) instead of event-based resolution
- **Test gaps**: LocalStorageClient and IndexedDBClient missing `validationError`/`connectionError` test factories
- **Backend factory hardcodes**: `tablePrefix="b3nd"`, `poolSize=5`, `connectionTimeout=30000` not configurable via `RigConfig`

## Backend Factory Protocol Support

| Protocol | Client | Executor Required | Status |
|----------|--------|------------------|--------|
| `http://` / `https://` | HttpClient | No | Stable |
| `ws://` / `wss://` | WebSocketClient | No | Stable |
| `memory://` | MemoryClient | No | Stable |
| `postgresql://` / `postgres://` | PostgresClient | `executors.postgres` | Stable |
| `mongodb://` / `mongodb+srv://` | MongoClient | `executors.mongo` | Stable |
| `sqlite://` | SqliteClient | `executors.sqlite` | New |
| `redis://` / `rediss://` | RedisClient | `executors.redis` | New |

## New Backend Candidates

### Tier 1 — High Impact

| Backend | Why | Effort | Notes |
|---------|-----|--------|-------|
| **Turso / libSQL** | Edge-native SQLite. Growing serverless community. | Low | Same `SqliteExecutor` interface, different connection layer (HTTP or libsql protocol). |

### Tier 2 — Strategic

| Backend | Why | Effort | Notes |
|---------|-----|--------|-------|
| **DynamoDB** | AWS serverless standard. Huge enterprise footprint. | High | Partition key = program key, sort key = path. GSI for timestamps. |
| **Cloudflare D1** | Edge SQL (SQLite-based). | Medium | Async `SqliteExecutor` variant with Cloudflare bindings. |
| **Cloudflare KV** | Globally replicated key-value. | Low | Simple API. Good for read-heavy workloads. |
| **S3 / R2** | Object storage for large binary payloads. | Medium | Good for `hash://` data. |

### Tier 3 — Niche / Benchmarking

| Backend | Why | Notes |
|---------|-----|-------|
| **CockroachDB** | Distributed SQL, PostgreSQL wire-compatible. | Zero new code — test PostgresClient against CockroachDB. |
| **SurrealDB** | Multi-model (document + graph + SQL). | Novel marketing angle. |
| **Valkey / Redis-compatible** | Drop-in for Redis client. Covers Dragonfly, KeyDB. | Zero new code — test RedisClient against Valkey/Dragonfly. |

## Recommended Next Steps

1. **Turso/libSQL verification** — Test SqliteClient's executor pattern with Turso's HTTP driver. Likely near-free.
2. **CockroachDB verification** — Test PostgresClient with CockroachDB connection string. Likely a free backend.
3. **Valkey/Dragonfly verification** — Test RedisClient with alternative Redis-compatible servers. Free backend.
4. **Benchmark infrastructure** — With SQLite + Postgres + Mongo + Redis, publish comparison dashboards.
5. **Make factory hardcodes configurable** — `tablePrefix`, `poolSize`, `connectionTimeout` should flow through `RigConfig`.

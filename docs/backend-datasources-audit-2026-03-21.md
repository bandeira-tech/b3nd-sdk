# Backend Datasources Audit — 2026-03-21

## Executive Summary

B3nd currently supports **7 client implementations** against the `NodeProtocolInterface` contract. The server-side persistence backends (Memory, PostgreSQL, MongoDB) are mature and well-tested. The transport clients (HTTP, WebSocket) are solid proxies. The browser clients (LocalStorage, IndexedDB) are functional but have correctness gaps. The architecture is clean and extensible — adding new backends is straightforward thanks to the executor pattern and shared test suite.

## Architecture Overview

**Interface**: `NodeProtocolInterface` = `NodeProtocolWriteInterface` + `NodeProtocolReadInterface`
- `receive(msg)`, `read(uri)`, `readMulti(uris)`, `list(uri, opts)`, `delete(uri)`, `health()`, `getSchema()`, `cleanup()`

**Backend Factory**: `createClientFromUrl()` in `libs/b3nd-rig/backend-factory.ts`
- Maps URL protocols to client instances
- Executor injection pattern for Postgres/Mongo (SDK is driver-agnostic)

**Composition**: `Rig.init()` supports multi-backend with `parallelBroadcast` (writes) + `firstMatchSequence` (reads)

## Client Assessment

### MemoryClient — Grade: A
- Clean tree-based storage, schema validation, MessageData envelope fan-out, pagination, sorting, pattern filtering
- Synchronous where possible (no unnecessary async)
- **Bug**: `list()` timestamp sort broken for deep paths (lines 366-372) — sort key lookup only works for immediate children

### PostgresClient — Grade: A-
- Executor pattern keeps SDK driver-agnostic
- Transactional MessageData writes (atomicity)
- `readMulti` uses `ANY($1)` single-query batch with fallback
- SQL injection prevention (whitelisted sort columns, validated table prefix)
- Binary encoding/decoding, schema initialization with views/indexes/triggers
- In-transaction read consistency for validators

### MongoClient — Grade: B+
- Executor pattern, `$in` batch reads with fallback, binary encoding, proper upsert
- **Issue**: No transactional MessageData writes — outputs #1-2 committed even if #3 fails
- **Issue**: `list()` fetches ALL matching docs then paginates in-memory — inefficient for large datasets

### HttpClient — Grade: B+
- Clean transport proxy, timeout handling, binary response detection
- **Issue**: `list()` returns `success: true` with empty data on errors instead of propagating errors
- **Issue**: `/api/v1/read-multi` endpoint missing from server (`libs/b3nd-servers/http.ts`) — always falls back to N individual reads

### WebSocketClient — Grade: B+
- Reconnection with exponential backoff, request/response correlation via UUID, auth support
- **Issue**: `list()` returns `success: true` on error (same as HttpClient)

### LocalStorageClient — Grade: B-
- Binary serialization, key-prefix isolation, custom serializer support
- **Issue**: Schema matching uses `startsWith` prefix instead of `protocol://hostname` extraction
- **Issue**: No MessageData envelope fan-out (breaks envelope contract)
- **Issue**: Open-by-default schema (no matching schema = write allowed), unlike other clients

### IndexedDBClient — Grade: B-
- Proper IndexedDB usage with indexes, single-transaction batch reads
- **Issue**: Schema matching uses `startsWith` prefix (same as LocalStorage)
- **Issue**: No MessageData envelope fan-out (same as LocalStorage)
- **Issue**: `list()` pattern matching uses `String.includes()` instead of regex
- **Issue**: `getDatabaseStats()` iterates all records via cursor — should use `IDBObjectStore.count()`
- **Issue**: `cleanup()` has 50ms `setTimeout` for fake-indexeddb — test concern leaking into production

## Cross-Cutting Issues

| Issue | Affected Clients | Severity |
|-------|-----------------|----------|
| No MessageData envelope fan-out | LocalStorage, IndexedDB | **High** |
| Inconsistent program key extraction | LocalStorage, IndexedDB | **Medium** |
| No transactional envelope writes | MongoDB | **Medium** |
| `list()` swallows errors as `success: true` | HTTP, WebSocket | **Low** |
| `/api/v1/read-multi` missing from HTTP server | HTTP (server-side) | **Medium** |
| MemoryClient timestamp sort broken for deep paths | Memory | **Low** |
| No `Errors.*` structured error details | Mongo, LocalStorage, IndexedDB, HTTP, WS | **Low** |

## Test Infrastructure

**Strong foundation**: `libs/b3nd-testing/shared-suite.ts` provides ~40+ reusable test cases. All 7 clients plug into this.

| Client | Shared Suite | Node Suite | Binary | Validation Error | Connection Error |
|--------|-------------|-----------|--------|-----------------|-----------------|
| Memory | Yes | Yes | Skipped | Yes | No |
| Postgres | Yes | No | Yes | Yes | No |
| Mongo | Yes | No | Yes | Yes | No |
| HTTP | Yes | No | Yes | Yes | Yes |
| WebSocket | Yes | No | Yes | Yes | Yes |
| LocalStorage | Yes | No | Default | No | No |
| IndexedDB | Yes | No | Default | No | No |

**Gaps**: No concurrency tests, no performance benchmarks, no cross-client consistency tests.

## New Datasource Candidates

### Tier 1 — High Impact
1. **Redis/Valkey** (`redis://`) — In-memory KV store, caching layer, pub/sub
2. **SQLite** (`sqlite://`) — Embedded, zero-config, perfect for edge/IoT/single-node
3. **DynamoDB** (`dynamodb://`) — AWS serverless KV, unlocks AWS ecosystem

### Tier 2 — Good Value
4. **S3/MinIO** (`s3://`) — Object storage for blob/binary workloads
5. **Turso/libSQL** (`libsql://`) — SQLite-compatible with replication, edge computing
6. **CockroachDB** — PostgreSQL wire protocol, verify existing PostgresClient works

### Tier 3 — Niche but Strategic
7. **FoundationDB** — Extreme reliability guarantees
8. **Cassandra/ScyllaDB** — Wide-column for massive write throughput
9. **NATS KV** — Lightweight message/KV system

## Recommendations

### Immediate (fix existing quality)
1. Add MessageData envelope fan-out to LocalStorage and IndexedDB clients
2. Fix program key extraction in LocalStorage/IndexedDB to use `URL.parse` -> `protocol://hostname`
3. Add MongoDB transaction support for envelope writes
4. Add `/api/v1/read-multi` endpoint to HTTP server

### Short-term (expand coverage)
5. Add SQLite client (lowest effort, reuse Postgres SQL patterns)
6. Add Redis/Valkey client (high marketing value)
7. Verify CockroachDB/YugabyteDB compatibility with existing PostgresClient

### Medium-term (benchmarking & marketing)
8. Build benchmark harness across all backends
9. Add DynamoDB client for AWS adoption

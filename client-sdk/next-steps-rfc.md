# RFC: Evolution to @b3nd/sdk - Universal B3nd SDK

**Status:** Approved
**Date:** 2025-10-01
**Package Name:** `@b3nd/sdk`

## Executive Summary

The client-sdk will evolve into `@b3nd/sdk`, a universal SDK providing a **recursive, uniform interface** for interacting with B3nd persistence across all platforms and storage backends. The SDK will work seamlessly in Deno, Node.js (npm), and browser environments with a single, consistent API. This uniform interface enables browser nodes, backend meshes, relay patterns, and decentralized replicas.

## Current State

### Existing Structure

```
client-sdk/
├── src/
│   ├── types.ts              # Core B3ndClient interface
│   ├── local-client.ts       # In-process Persistence wrapper
│   ├── http-client.ts        # Remote HTTP API client
│   ├── websocket-client.ts   # Remote WebSocket client
│   ├── instance-config.ts    # Shared instance management types
│   └── browser-instance-manager.ts  # Browser instance manager
├── browser.js               # Browser-compatible bundle
└── mod.ts                   # Deno entry point
```

### Current Limitations

1. **Storage Inflexibility:** LocalClient only supports in-memory storage
2. **Code Duplication:** browser.js duplicates HttpClient implementation
3. **No Recursion:** Cannot chain httpapi instances
4. **Platform Fragmentation:** Separate implementations for Deno/npm/browser

## Vision: Universal Recursive Interface

### Core Principle

**Every B3nd node exposes the same `B3ndClient` interface regardless of:**
- Storage backend (memory, Deno KV, PostgreSQL, MongoDB, IndexedDB, LocalStorage)
- Access method (direct, HTTP, WebSocket)
- Runtime environment (Deno, Node.js, browser)
- Topology (standalone, proxied, cascaded, mesh, replicated)

### Recursive Architecture

```
┌─────────────────────────────────────────────────────┐
│              APPLICATION LAYER                      │
│  (Scripts, WebApps, httpapi, wsserver)              │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│          @b3nd/sdk (Universal Interface)             │
│                                                      │
│  B3nd.connect(config) → B3ndClient                   │
│                                                      │
│  Supported Configurations:                           │
│  - Local: { type: "local", backend: "memory|kv|pg" }│
│  - Remote: { type: "http|ws", url: "..." }          │
│  - Browser: { type: "local", backend: "indexeddb" } │
│  (Future: mesh, relay, replicated)                   │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│              BACKEND ADAPTERS                        │
│                                                      │
│  MemoryBackend   DenoKVBackend   PostgresBackend    │
│  MongoBackend    HTTPBackend     WebSocketBackend   │
└─────────────────────────────────────────────────────┘
```

## Architecture

### 1. Universal Client Interface (Unchanged)

```typescript
// This interface remains stable across all implementations
interface B3ndClient {
  write<T>(uri: string, value: T): Promise<WriteResult<T>>;
  read<T>(uri: string): Promise<ReadResult<T>>;
  list(uri: string, options?: ListOptions): Promise<ListResult>;
  delete(uri: string): Promise<DeleteResult>;
  health(): Promise<HealthStatus>;
  getSchema(): Promise<string[]>;
  cleanup(): Promise<void>;
}
```

### 2. Backend Abstraction Layer (New)

```typescript
// @b3nd/sdk/src/backends/backend.ts
interface PersistenceBackend {
  write<T>(
    uri: string,
    value: T,
    validator?: ValidationFn
  ): Promise<PersistenceRecord<T>>;

  read<T>(uri: string): Promise<PersistenceRecord<T> | null>;

  list(uri: string, options?: ListOptions): Promise<ListItem[]>;

  delete(uri: string): Promise<boolean>;

  initialize(schema: Record<string, ValidationFn>): Promise<void>;

  close(): Promise<void>;
}

// Implementations (batteries included):
// - MemoryBackend: Current in-memory Persistence logic
// - DenoKVBackend: Uses Deno.openKv()
// - PostgresBackend: Uses postgres client
// - MongoBackend: Uses MongoDB driver
// - IndexedDBBackend: Browser persistent storage (future)
// - LocalStorageBackend: Browser simple storage (future)
```

### 3. Enhanced Local Node

```typescript
// @b3nd/sdk/src/local-node.ts
class LocalNode implements B3ndClient {
  constructor(
    private backend: PersistenceBackend,
    private schema: Record<string, ValidationFn>
  ) {}

  async write<T>(uri: string, value: T): Promise<WriteResult<T>> {
    const schemaKey = this.extractSchemaKey(uri);
    const validator = this.schema[schemaKey];

    if (validator && !await validator({ uri, value })) {
      return { success: false, error: "Validation failed" };
    }

    const record = await this.backend.write(uri, value, validator);
    return { success: true, record };
  }

  // ... other B3ndClient methods
}
```

### 4. Platform Distribution

```
@b3nd/sdk/
├── package.json (npm configuration)
├── deno.json (Deno configuration)
├── mod.ts (Deno entry point)
├── src/ (shared TypeScript source)
└── dist/ (built for npm/browser)
    ├── index.js (CommonJS/ESM for Node.js)
    └── browser.js (bundled for browsers)
```

**Build Configuration:**
- **Deno:** Direct TypeScript imports from mod.ts
- **npm:** Transpiled to CommonJS/ESM in dist/
- **Browser:** Bundled with esbuild, tree-shaken

## Implementation Phases

### Phase 1: Backend Abstraction (Foundation)

**Objective:** Decouple storage implementation from client interface

**Tasks:**
1. Define `PersistenceBackend` interface
2. Extract `MemoryBackend` from current Persistence class
3. Refactor `LocalNode` (formerly LocalClient) to use backend abstraction
4. Maintain 100% backward compatibility with existing Persistence class

**Deliverables:**
- `src/backends/backend.ts` - Backend interface
- `src/backends/memory.ts` - MemoryBackend implementation
- `src/local-node.ts` - Refactored LocalNode using backends
- Tests validating backward compatibility

**Success Criteria:** All existing code continues working without changes

### Phase 2: Database Backends (Expansion)

**Objective:** Enable httpapi/wsserver to use real databases

**Tasks:**
1. Implement `DenoKVBackend` using Deno.openKv()
2. Implement `PostgresBackend` using deno-postgres
3. Implement `MongoBackend` using mongodb driver
4. Create backend configuration system in instance config
5. Add connection pooling and error handling

**Example Configuration:**
```json
{
  "default": "postgres-prod",
  "instances": {
    "postgres-prod": {
      "type": "local",
      "backend": "postgres",
      "connection": {
        "host": "localhost",
        "port": 5432,
        "database": "b3nd",
        "user": "b3nd",
        "password": "..."
      },
      "schema": "./schemas/default.ts"
    }
  }
}
```

**Deliverables:**
- `src/backends/deno-kv.ts` - Deno KV backend
- `src/backends/postgres.ts` - PostgreSQL backend
- `src/backends/mongo.ts` - MongoDB backend
- Backend selection logic in LocalNode
- Integration tests for each backend

**Success Criteria:** httpapi can run with any backend interchangeably

### Phase 3: Platform Unification (Consolidation)

**Objective:** Single codebase with platform-specific builds

**Tasks:**
1. Set up build system (esbuild for browser, tsc for npm)
2. Create platform detection and conditional imports
3. Remove browser.js duplication - generate from source
4. Configure npm package with proper exports
5. Publish to npm registry and JSR (Deno)
6. Create comprehensive test matrix (Deno/Node/Browser × All backends)

**Platform Exports (package.json):**
```json
{
  "name": "@b3nd/sdk",
  "exports": {
    ".": {
      "deno": "./mod.ts",
      "node": {
        "import": "./dist/index.mjs",
        "require": "./dist/index.cjs"
      },
      "browser": "./dist/browser.js",
      "default": "./dist/index.mjs"
    },
    "./backends/*": {
      "deno": "./src/backends/*.ts",
      "node": "./dist/backends/*.js"
    }
  }
}
```

**Deliverables:**
- Unified build pipeline
- npm package published as `@b3nd/sdk`
- JSR package published
- Platform-specific documentation
- CI/CD testing all platforms

**Success Criteria:**
- Zero code duplication
- Works seamlessly in Deno, Node.js, and browsers
- Published and installable from npm/JSR

### Phase 4: Recursive Nodes (Simple)

**Objective:** Enable httpapi instances to proxy to other httpapi instances

This phase enables the fundamental recursive capability: an httpapi can connect to another httpapi using the same `B3ndClient` interface. Infrastructure concerns (load balancing, failover, circuit breakers) belong in infrastructure tooling, not application code.

#### What Phase 4 Enables

**Simple Proxy/Chain Pattern:**

An httpapi instance can proxy requests to another httpapi instance:

```json
// Edge httpapi configuration
{
  "default": "upstream",
  "instances": {
    "upstream": {
      "type": "http",
      "url": "https://api.example.com",
      "instanceId": "prod"
    }
  }
}
```

**Request flow:**
```
Client → Edge httpapi (localhost:8000) → Remote httpapi (api.example.com) → Database
```

**Use Cases:**
1. **Development/Testing:** Local httpapi connects to staging/production
2. **Edge Proxying:** Simple geographic distribution
3. **Network Boundaries:** Bridge different network zones
4. **Protocol Translation:** HTTP client connects to WebSocket server

#### Recursive Property

Because every node exposes `B3ndClient`, chains work naturally:

```typescript
// httpapi-1 connects to httpapi-2
const client1 = B3nd.connect({
  type: "http",
  url: "https://httpapi-2.example.com"
});

// httpapi-2 connects to httpapi-3
const client2 = B3nd.connect({
  type: "http",
  url: "https://httpapi-3.example.com"
});

// httpapi-3 connects to local Postgres
const client3 = B3nd.connect({
  type: "local",
  backend: "postgres",
  connection: "..."
});

// Chain: httpapi-1 → httpapi-2 → httpapi-3 → Postgres
await client1.write("users://alice/profile", data);
```

No special code needed - it just works because the interface is uniform.

#### What Phase 4 Does NOT Include

**Infrastructure concerns handled elsewhere:**
- ❌ Load balancing (use nginx, HAProxy, or cloud load balancers)
- ❌ Failover/HA (use Kubernetes, database replication, DNS failover)
- ❌ Circuit breakers (use service mesh or proxy layer)
- ❌ Health checks (use infrastructure monitoring)
- ❌ Multi-layer caching strategies (use separate caching layer)

These are infrastructure problems with mature solutions. The SDK provides the building blocks; infrastructure orchestrates them.

#### Implementation

**Tasks:**
1. Ensure HttpClient and WebSocketClient work correctly as "upstream" instances
2. Test recursive chains (httpapi → httpapi → httpapi → database)
3. Document the recursive capability
4. Provide examples of simple proxy patterns

**Deliverables:**
- Documentation: "Chaining httpapi Instances"
- Example configurations for common proxy patterns
- Integration tests for multi-hop chains
- Performance benchmarks for chain depth

**Success Criteria:**
- httpapi can connect to another httpapi with zero special code
- Chains of 3+ instances work correctly
- Same error handling and semantics throughout the chain
- Documentation clearly shows when to use proxying vs infrastructure tools

## Future Topologies Enabled by This Architecture

The uniform `B3ndClient` interface and backend abstraction create the foundation for advanced distributed patterns. While these patterns require additional coordination protocols and are not implemented in the initial phases, the architecture explicitly supports them:

### 1. Browser as Full Node

**Capability:** Browser applications can run complete B3nd nodes, not just clients.

**Implementation Pattern:**
```typescript
// Browser with IndexedDB backend
const browserNode = B3nd.connect({
  type: "local",
  backend: "indexeddb",
  schema: "./schemas/app.ts"
});

// Full B3ndClient interface available
await browserNode.write("users://alice/profile", data);
await browserNode.list("users://");
```

**Use Cases:**
- **Consumer Applications:** Offline-first web apps with local persistence
- **Business Applications:** Field workers with eventual sync to backend
- **Progressive Web Apps:** Full functionality without server connectivity
- **Edge Computing:** Browser instances participating in distributed system

**What's Needed (Future):**
- IndexedDB backend implementation (`src/backends/indexeddb.ts`)
- LocalStorage backend for simple use cases
- Sync protocol between browser and server nodes
- Conflict resolution strategies

### 2. Backend Mesh Networks

**Capability:** Multiple httpapi instances discover and communicate with each other dynamically.

**Implementation Pattern:**
```typescript
// httpapi instance with mesh discovery
const meshNode = B3nd.connect({
  type: "local",
  backend: "postgres",
  mesh: {
    discovery: "multicast", // or "gossip", "registry"
    peers: ["https://node1.example.com", "https://node2.example.com"]
  }
});

// Node automatically discovers and routes to peers
```

**Use Cases:**
- **Distributed Systems:** Multiple backend instances coordinating
- **Multi-Region Deployments:** Geographic distribution with local routing
- **Load Distribution:** Dynamic routing based on node health
- **Service Discovery:** Automatic peer discovery without central registry

**What's Needed (Future):**
- Discovery protocol (multicast, gossip, or registry-based)
- Peer registry and health monitoring
- Routing logic (nearest, least-loaded, hash-based)
- Connection pooling and lifecycle management

### 3. Relay and Broadcast Patterns

**Capability:** Single instance forwards requests to multiple targets (one-to-many).

**Implementation Pattern:**
```typescript
// Relay configuration
const relayNode = B3nd.connect({
  type: "relay",
  targets: [
    { type: "http", url: "https://region-us.example.com" },
    { type: "http", url: "https://region-eu.example.com" },
    { type: "http", url: "https://region-asia.example.com" }
  ],
  strategy: "broadcast" // or "first-success", "fastest"
});

// Single write broadcasts to all targets
await relayNode.write("cache://key", value); // → all regions
```

**Use Cases:**
- **Cache Invalidation:** Broadcast cache clears to all nodes
- **Event Distribution:** Propagate events across regions
- **Multi-Region Writes:** Write to multiple geographic locations
- **Redundant Storage:** Ensure data reaches multiple backends

**What's Needed (Future):**
- Relay configuration type and validation
- Broadcast strategies (all, first-success, quorum, fastest)
- Partial failure handling
- Response aggregation logic

### 4. Decentralized Replicas

**Capability:** Multiple instances maintain synchronized state without central coordinator.

**Implementation Pattern:**
```typescript
// Replicated instance
const replicaNode = B3nd.connect({
  type: "local",
  backend: "postgres",
  replication: {
    mode: "multi-master", // or "leader-follower"
    peers: ["https://replica1.example.com", "https://replica2.example.com"],
    conflictResolution: "last-write-wins" // or "vector-clock", "custom"
  }
});

// Writes automatically replicate to peers
await replicaNode.write("users://alice/profile", data);
// → local write + async replication to peers
```

**Use Cases:**
- **High Availability:** Continue operating when peers fail
- **Geo-Replication:** Low-latency reads from local replicas
- **Disaster Recovery:** Automatic failover to healthy replicas
- **Collaborative Applications:** Multi-user editing with eventual consistency

**What's Needed (Future):**
- Replication protocol (push-based, pull-based, or hybrid)
- Conflict detection (vector clocks, version vectors)
- Conflict resolution strategies (LWW, CRDT, custom merge functions)
- Reconciliation on network partition recovery
- Hooks for custom replication logic

### Architecture Support

These patterns are enabled because:

1. **Uniform Interface:** Every node speaks `B3ndClient`, making them composable
2. **Backend Abstraction:** Storage and coordination are separate concerns
3. **Recursive Composition:** Nodes can connect to nodes without special cases
4. **Hook Points:** Architecture allows injection of:
   - Pre-write hooks (validation, replication triggers)
   - Post-write hooks (broadcast, sync, notifications)
   - Read hooks (cache, routing, failover)
   - Connection lifecycle hooks (discovery, health checks)

### Implementation Strategy

These patterns will be implemented as **optional coordination layers** that wrap or enhance the core `B3ndClient`:

```typescript
// Example future API
import { B3nd, withReplication, withMesh, withRelay } from "@b3nd/sdk";

// Core node
const node = B3nd.connect({ type: "local", backend: "postgres" });

// Enhance with replication
const replicatedNode = withReplication(node, {
  peers: [...],
  strategy: "multi-master"
});

// Enhance with mesh discovery
const meshNode = withMesh(replicatedNode, {
  discovery: "gossip"
});
```

This keeps the core SDK simple while enabling advanced patterns through composition.

### Summary

The @b3nd/sdk architecture intentionally supports these future capabilities:

- ✅ **Foundation:** Uniform interface, backend abstraction, recursive composition
- ✅ **Browser Nodes:** LocalStorage/IndexedDB backends enable full browser nodes
- ✅ **Mesh Networks:** Interface allows peer discovery and dynamic routing
- ✅ **Relay/Broadcast:** One-to-many forwarding through multi-target configs
- ✅ **Replicas:** Hook points for replication protocols and conflict resolution

These patterns require additional coordination protocols but the architectural foundation is in place. They can be added incrementally without breaking the core interface.

## Configuration Schema

Instance types are simple and focused:

```typescript
type InstanceConfig =
  | LocalInstanceConfig
  | HTTPInstanceConfig
  | WebSocketInstanceConfig;

interface LocalInstanceConfig {
  type: "local";
  backend: "memory" | "deno-kv" | "postgres" | "mongo";
  connection?: BackendConnection;
  schema: string; // Path to TypeScript validation functions
}

interface HTTPInstanceConfig {
  type: "http";
  url: string;
  instanceId?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

interface WebSocketInstanceConfig {
  type: "websocket";
  url: string;
  timeout?: number;
}
```

## Schema Validation

Schema validation will remain code-centric using TypeScript functions. Helper functions will be provided for common patterns:

```typescript
// @b3nd/sdk/helpers/validation.ts
export const validators = {
  allowAll: async () => true,
  denyAll: async () => false,

  requireFields: (fields: string[]) => async (write: PersistenceWrite) => {
    return fields.every(f => f in write.value);
  },

  matchType: (type: string) => async (write: PersistenceWrite) => {
    return typeof write.value === type;
  },
};

// Usage in schema file:
import { validators } from "@b3nd/sdk/helpers";

export default {
  "users://example": validators.requireFields(["name", "email"]),
  "posts://example": validators.allowAll,
  "admin://example": validators.denyAll,
};
```

## Benefits

### For Developers
- **Single API:** Learn B3ndClient once, use everywhere
- **Type Safety:** Full TypeScript support across platforms
- **Flexibility:** Swap backends through configuration
- **Testability:** Mock backends or use memory for tests

### For Applications
- **httpapi/wsserver:** Use any storage backend (memory, KV, Postgres, Mongo)
- **Scripts:** Direct access to persistence with same interface as remote
- **WebApps:** Same client interface for browser and server
- **Browser Apps:** Full nodes with local persistence (IndexedDB/LocalStorage)
- **Consumer & Business Apps:** Offline-first with eventual sync
- **Topologies:** Build sophisticated distributed patterns (mesh, relay, replicas)

### For Ecosystem
- **npm Compatible:** Standard npm package `@b3nd/sdk`
- **Deno Compatible:** Published to JSR as `@b3nd/sdk`
- **Web Compatible:** Bundled for browsers without polyfills
- **No Lock-in:** Switch backends without code changes

## Migration Strategy

### Non-Breaking Evolution

1. **Add, Don't Replace:** New backend abstraction coexists with Persistence
2. **Opt-In:** Existing code continues using Persistence directly
3. **Gradual Migration:** Move to backends when needed (database support, etc.)
4. **Deprecation Path:** Mark Persistence deprecated after Phase 2, remove in Phase 4

### Compatibility Guarantees

- `B3ndClient` interface will not change
- Existing LocalClient continues working
- Configuration format is additive only
- Old browser.js supported until Phase 3 complete

## Success Metrics

1. ✅ Single `B3ndClient` interface works across all platforms (Deno, Node, Browser)
2. ✅ Zero code duplication between browser/server implementations
3. ✅ httpapi can use Postgres, Deno KV, or memory interchangeably
4. ✅ Published and usable from npm, JSR, and direct import
5. ✅ Explorer, httpapi, scripts all use same SDK
6. ✅ Recursive chaining works (httpapi → httpapi → database)
7. ✅ Browser nodes work with IndexedDB/LocalStorage backends
8. ✅ Architecture supports future mesh, relay, and replication patterns

## Next Actions

### Phase 1 (Immediate)
1. [x] RFC approval
2. [ ] Create `src/backends/backend.ts` interface
3. [ ] Extract MemoryBackend from Persistence
4. [ ] Refactor LocalNode to use backends
5. [ ] Write compatibility tests

### Phase 2 (Next)
1. [ ] Implement DenoKVBackend
2. [ ] Implement PostgresBackend
3. [ ] Implement MongoBackend
4. [ ] Backend configuration system
5. [ ] Integration testing

### Phase 3 (Future)
1. [ ] Set up build pipeline
2. [ ] Publish to npm as `@b3nd/sdk`
3. [ ] Publish to JSR
4. [ ] Platform-specific testing
5. [ ] Documentation update

### Phase 4 (Advanced)
1. [ ] Test recursive chains (httpapi → httpapi → database)
2. [ ] Document proxy/chaining patterns
3. [ ] Provide configuration examples
4. [ ] Performance benchmarks for chain depth
5. [ ] Validate error propagation through chains

---

**This RFC defines the strategic evolution of client-sdk into @b3nd/sdk - a universal, recursive interface for B3nd persistence that works seamlessly across all platforms and storage backends. Infrastructure concerns (HA, load balancing, circuit breakers) remain in the infrastructure layer where they belong.**

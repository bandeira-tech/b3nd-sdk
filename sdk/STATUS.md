# b3nd/sdk STATUS

The goal of this document is to coordinate work that is linear and executed distributed.

```
This document should be live updated and contain the guidance for further work.
It should always be updated at the end of a step so it can be committed along
with the code changes that defined the CURRENT STATUS, and then provide NEXT STEP
to achieve the MAIN OBJECTIVE.
```

## INTERVENTION (ongoing)

⚠️ Questions & Concerns:

  1. Overlap with RFC's InstanceConfig?
    - RFC defines instance types (local/http/websocket) with backend selection
    - README defines client schema for routing protocols to backends
    - How do these relate? Is client schema the "instances.json" concept?
    RESPONSE: we are overriding previous design from RFC with a new flatter design where everything is backend, so for example, a webapp uses the client to communicate to an http api backend, then the http api app uses the client to communicate with a postgres backend, or in more complex, it uses a websocket backend to communicate with a websocket server app that then uses a client to communicate with postgres backend, see there?

  2. Validation Location:
    - Backend schema has validation functions
    - What if client routes users:// to backend A (strict validation) vs backend B (permissive)?
    - Does validation happen at backend or client level?
    RESPONSE: the validation to accept the write happens on the backend side and is managed via a validation function that enables developers to do their own setup in their own way without a further layer of translations and mapping

  3. Protocol Granularity:
    - Routing by protocol://toplevel seems coarse
    - What about users://alice/* → backend A, users://bob/* → backend B?
    - Or is this handled by backend-level routing?
    RESPONSE: sure, the client can enable any kind of routing and can also allow for wildcard, and then map that to a target instance->schema, enabling inclusive that for example some routing like to support httpapi translations  from ':instance/:protocol/:domain/:path*' to enable universal mapping for multiple instances and so on, the client then must track available backend instances separately from routes, so routes can refer the backend instances being managed

  4. Schema Discovery:
    - How does client know what protocols a backend supports?
    - Does it query backend schema or rely on configuration?
    - What happens on mismatch (client routes to backend that doesn't support protocol)?
    RESPONSE: The client may choose to hardcode/configure the routes and backends it supports manually based on their application needs, for more dynamic applications like the explorer, the backends must support a schema getter where they share the program keys in their schemas

  5. Naming Clarity:
    - "Backend schema" vs "Client schema" is clear but...
    - RFC uses "schema" for validation functions only
    - Could this cause confusion? Alternative: "Backend capabilities" + "Routing configuration"?
    RESPONSE: Let's update the nomenclature to be backend and client schema, and enable clients to have a default backend where urls that are not mapped simply go to the default backend, this should be done easily and cleanly. The client schema should allow communication/management of backends, default backend and routes

  6. Implementation Questions:
    - Is client a wrapper around multiple backend instances?
    - Does it implement B3ndClient interface and delegate based on routing?
    - How does error handling work across backends?
    RESPONSE: Yes, that is correct, and the error handling should be sensible to the guidance that most errors users should handle, so for example a postgres backend should bubble its internal errors, but an http api running it should provide some semantics to it, so that the frontend client can provide a good experience to the end user while still supporting errors and stack traces to circulate


  FINAL CONSIDERATION:
  The schemas should both avoid creating complexity of mapping of flags and configurations and instead require a function that allows developers to do their setups imperatively, for the backend schema it's 'programkey': writevalidationfn(), and for the clients it's backends=>backend[], routes => {'string match' => (uri) => { return mybackend, uri }}, default => backend

  Suggested Clarifications Needed:

  1. Provide concrete example showing backend schema + client schema working together
  2. Clarify relationship to RFC's instance configuration
  3. Define behavior on routing mismatches
  > use the url on the default backend
  4. Explain how validation flows through client → backend
  > the client has to know what they are doing at all times
  5. Show how this enables the "mesh of nodes" concept from README line 20
  > This is still missing the gossip/broadcast aspects, but it's a stepping stone

  Overall: The concept is powerful but needs tighter integration with the RFC's architecture. The "client as router" pattern is not
  explicitly covered in the RFC, which focuses on single backend instances.

  Question for you: Is the client schema essentially a higher-level abstraction that wraps multiple B3ndClient instances (each configured per RFC) and routes based on protocol? Correct, that's for maximal universality and simplicity


## NEXT STEP (max 300 words)

**Final Simplification: No Router, Just Clients**

The architecture has been simplified to its essence: **applications manage their own client instances directly**. No client-side routing, no router abstraction - just the universal `NodeProtocolInterface` that all clients implement.

**Current Architecture (Implemented):**
- `NodeProtocolInterface` - Universal interface all clients implement
- `MemoryClient` - In-memory storage with schema validation
- `HttpClient` - HTTP API client (no validation, server-side)
- `WebSocketClient` - Planned for future implementation
- **No router, no client-side routing** - applications manage client instances directly

**Key Design Decision:** Applications that need multiple backends (web frontend with prod/staging HTTP, realtime WS + background HTTP, HTTP APIs connecting to databases) maintain their own `Map<string, NodeProtocolInterface>` of connected clients. This eliminates all routing complexity.

**Next: Platform-Specific Clients**

With the core interface solid and tested, implement platform-specific clients:

1. **WebSocketClient in `src/websocket-client.ts`**
   - Implements NodeProtocolInterface over WebSocket
   - Request/response pattern with message IDs
   - Reconnection handling and connection pooling

2. **Browser-Specific Clients**
   - `LocalStorageClient` - Persistent browser storage
   - `IndexedDBClient` - Large data storage in browsers
   - Platform detection and automatic client selection

3. **Database Clients (Future)**
   - `DenoKVClient` - Deno KV backend
   - `PostgresClient` - PostgreSQL backend
   - `MongoClient` - MongoDB backend

4. **Enhanced Types and Utilities**
   - Client connection helpers
   - Error handling utilities
   - Configuration validation

**Why This Matters:** The simple "just clients" approach enables the mesh networking vision while keeping the API minimal and flexible. Applications decide how to manage their client connections based on their specific needs.

## CURRENT STATUS (max 300 words)

**All 35/35 Tests Passing - Final "Just Clients" Architecture ✅**

**Completed (Final Simplified Design):**
- ✅ `src/types.ts` - NodeProtocolInterface and all core types
- ✅ `src/memory-client.ts` - In-memory client with schema validation
- ✅ `src/http-client.ts` - HTTP client (no validation, server-side)
- ✅ `tests/shared-suite.ts` - Uniform test suite ensuring client consistency
- ✅ `tests/memory-client.test.ts` - 18/18 passing (11 shared + 7 specific)
- ✅ `tests/http-client.test.ts` - 17/17 passing (11 shared + 6 specific)
- ✅ `tests/mock-http-server.ts` - Mock HTTP server supporting all operations
- ✅ `src/mod.ts` - Main entry point exporting all clients
- ✅ `Makefile` - Test automation

**Final Architecture Decision: No Router**
Applications manage their own client instances directly using `Map<string, NodeProtocolInterface>`. This eliminates routing complexity while enabling mesh networking through direct client composition.

**Key Implementation Decisions:**
1. **No Backend Abstraction** - Each client implements storage directly
2. **No Client-Side Routing** - Applications manage client instances
3. **Schema Validation** - MemoryClient validates, HttpClient delegates to server
4. **URI Parsing** - Protocol://domain/path structure for all operations
5. **Error Handling** - Transparent, never hide errors from consumers
6. **Resource Management** - Proper cleanup of HTTP responses to prevent leaks

**Architecture Finalized:**
- **Everything is a client** - Memory, HTTP, WebSocket all implement NodeProtocolInterface
- **No routing layer** - Applications manage client connections directly
- **Recursive composition** - Applications compose clients as needed
- **Shared test suite** - Ensures all clients behave identically

**Test Coverage:**
- **MemoryClient**: Schema validation, sorting, detailed health info
- **HttpClient**: Connection handling, configuration options, instance support
- **Shared**: All core operations (write/read/list/delete/health/schema/cleanup)

**Design Evolution Complete:**
The original RFC planned complex backend abstraction, then simplified to "clients are routers", now finalized as **"just clients"**. Applications that need multiple backends maintain their own client maps:
```typescript
const clients = new Map([
  ['prod', new HttpClient({url: 'https://api.prod.com'})],
  ['staging', new HttpClient({url: 'https://api.staging.com'})],
  ['local', new MemoryClient({schema: {...}})]
]);
```

**Next:** Implement remaining client types (WebSocket, browser storage) and platform-specific builds.

## MAIN OBJECTIVE (max 300 words)

**Build @b3nd/sdk - Universal Client Interface for B3nd Persistence**

Create a production-ready SDK where **everything is a client** - providing a uniform interface for B3nd persistence across all platforms (Deno, Node.js, browsers) and storage mechanisms through direct client composition.

**Core Principles (Final "Just Clients" Architecture):**
1. **Everything is a Client** - Memory, HTTP, WebSocket, databases all implement `NodeProtocolInterface`
2. **No Abstraction Layers** - Each client handles its own storage/communication directly
3. **No Client-Side Routing** - Applications manage client instances directly
4. **Recursive Composition** - Applications compose clients as needed
5. **Platform Portability** - Same codebase, platform-specific builds
6. **Quality First** - Every component tested, errors never hidden

**Phase 1 Goals (Current Focus):**
- ✅ Define `NodeProtocolInterface` - Universal client interface
- ✅ Implement `MemoryClient` - In-memory storage with schema validation
- ✅ Implement `HttpClient` - HTTP API client with proper error handling
- 🔄 **Next: WebSocketClient** - Real-time communication client
- 🔄 **Next: Browser Clients** - LocalStorage and IndexedDB clients
- 🔄 **Next: Platform Builds** - npm, JSR, browser builds

**Success Criteria:**
- All clients implement NodeProtocolInterface identically
- Applications can compose clients without routing layers
- Test suite ensures uniform behavior across all implementations
- Documentation explains direct client composition patterns
- Code quality meets production standards (typed, tested, documented)

**Architecture Finalized:**
The RFC planned complex backend abstraction, then simplified to "clients are routers", now finalized as **"just clients"**. Applications manage their own client instances:

```typescript
// Applications manage their own client maps
const clients = new Map<string, NodeProtocolInterface>([
  ['prod', new HttpClient({url: 'https://api.prod.com'})],
  ['staging', new HttpClient({url: 'https://api.staging.com'})],
  ['local', new MemoryClient({schema: {...}})],
  ['realtime', new WebSocketClient({url: 'wss://ws.example.com'})]
]);

// Use clients directly
const result = await clients.get('prod').write('users://alice/profile', data);
```

**Next Steps:**
- WebSocketClient implementation
- Browser storage clients (LocalStorage, IndexedDB)
- Platform-specific builds and publishing
- Database backend clients (DenoKV, Postgres, MongoDB)

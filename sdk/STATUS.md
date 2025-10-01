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

**Define Core Interface and Type System**

Create `src/types.ts` with the foundational `B3ndClient` interface and related types. This is the contract that all implementations must satisfy, regardless of platform or backend.

Key elements to define:
- `B3ndClient` interface (write, read, list, delete, health, getSchema, cleanup)
- Result types (WriteResult, ReadResult, ListResult, DeleteResult)
- Configuration types (for later backend abstraction)
- Core domain types (PersistenceRecord, ListItem, ValidationFn)

The types must be:
- **Platform-agnostic:** No Deno-specific or Node-specific APIs
- **Simple:** Avoid complex generics or type gymnastics
- **Well-documented:** Clear JSDoc comments explaining purpose and usage
- **Testable:** Design for easy mocking and testing

Reference existing `client-sdk/src/types.ts` but redesign for clarity and extensibility. The interface should remain stable across all future backend implementations (memory, Deno KV, Postgres, IndexedDB, etc.).

**Deliverable:** `sdk/src/types.ts` with complete type definitions and documentation.

## CURRENT STATUS (max 300 words)

**Initial Setup Phase - Empty SDK Package**

The `sdk/` directory has been created with only a README.md file. The existing `client-sdk/` contains working implementations (http-client, websocket-client, local-client, types, instance-config, browser-instance-manager) that will inform but not be directly copied into the new SDK.

Key existing resources:
- `/client-sdk/next-steps-rfc.md` - Approved RFC defining the evolution to @b3nd/sdk
- `/client-sdk/src/types.ts` - Current B3ndClient interface (7 methods)
- `/client-sdk/src/local-client.ts` - In-memory implementation wrapping Persistence
- `/client-sdk/src/http-client.ts` - Remote HTTP client
- `/client-sdk/src/websocket-client.ts` - Remote WebSocket client
- `/sdk/README.md` - Development principles (always test, never hide errors)

The RFC outlines a 4-phase implementation:
- **Phase 1:** Backend abstraction (PersistenceBackend interface, MemoryBackend, LocalNode)
- **Phase 2:** Database backends (DenoKV, Postgres, Mongo)
- **Phase 3:** Platform unification (npm, JSR, browser builds)
- **Phase 4:** Recursive nodes (httpapi → httpapi → database)

We are starting Phase 1 with a clean slate, reinventing rather than patching, to ensure cohesive, high-quality architecture.

## MAIN OBJECTIVE (max 300 words)

**Build @b3nd/sdk - Universal B3nd Persistence Interface**

Create a production-ready SDK providing a recursive, uniform interface for B3nd persistence across all platforms (Deno, Node.js, browsers) and storage backends (memory, Deno KV, Postgres, MongoDB, IndexedDB).

**Core Principles:**
1. **Uniform Interface:** Single `B3ndClient` interface works everywhere
2. **Backend Abstraction:** Storage implementation decoupled from client API
3. **Recursive Composition:** Nodes connect to nodes (httpapi → httpapi → database)
4. **Platform Portability:** Same codebase, platform-specific builds
5. **Quality First:** Every component tested, errors never hidden
6. **Future-Ready:** Architecture supports mesh, relay, and replication patterns

**Phase 1 Goals (Current Focus):**
- Define core types and interfaces (`B3ndClient`, `PersistenceBackend`)
- Extract MemoryBackend from existing Persistence class
- Implement LocalNode using backend abstraction
- Maintain 100% backward compatibility with existing code
- Comprehensive test coverage for all components

**Success Criteria:**
- All existing client-sdk consumers continue working unchanged
- Backend implementations are swappable through configuration
- Test suite covers all interfaces and implementations
- Documentation explains architecture and usage patterns
- Code quality meets production standards (typed, tested, documented)

**Non-Goals for Phase 1:**
- Database backends (Phase 2)
- npm/JSR publishing (Phase 3)
- Recursive chaining (Phase 4)
- Mesh/relay/replication protocols (future)

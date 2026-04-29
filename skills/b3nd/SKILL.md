---
name: b3nd
description: |
  B3nd — a framework for building DePIN protocols. Read this file first for the conceptual overview (framework vs protocol vs app, three roles, core ideas), then read the referenced file when the question matches a topic below.

  FRAMEWORK.md — DePIN framework & SDK: message primitives, schema dispatch, envelope structure, ProtocolInterfaceNode, auth/encryption, content-addressing, client composition, ProgramValidator, createOutputValidator, protocol versioning, packaging a protocol SDK. Read when designing a new DePIN protocol.

  OPERATORS.md — Node operations: two-phase binary, backend configuration (memory/Postgres/MongoDB/HTTP), managed mode, peer replication, multi-node networks, key generation, environment variables, MCP node tools. Read when deploying or managing infrastructure.

  FAQ.md — Design rationale, trade-offs, architectural decisions, troubleshooting. Read when asking "why does B3nd do X?"

  PROTOCOL_COOKBOOK.md — Protocol recipes: packaging a protocol SDK, running nodes with schema modules, multi-backend composition. Read for protocol deployment patterns.

  DESIGN_EXCHANGE.md — Exchange patterns & trust models: serverless, non-custodial, pubkey access control, managed operator, three-party consensus, party interaction diagrams, crypto guarantees. Read for trust model design.

  DESIGN_INFRASTRUCTURE.md — Infrastructure design: node requirements, deployment topologies (single node, remote listener, cluster, peer replication), inbox/outbox URIs, scaling, vault listener reference architecture. Read for deployment architecture.

  DESIGN_TRANSPORT.md — Transport design: HTTP polling, WebSocket, SSE, WebRTC, WebTransport, comparison matrix, subscribe() primitive, ProtocolInterfaceNode convergence. Read for transport layer decisions.

  DESIGN_PRIMITIVE.md — Message primitive & rig architecture: 3-tuple outputs, programs as classifiers returning codes, rig receive loop, code handlers, protocol packages, state/storage model, wrapping controls decomposition. Read for core architecture details.

  All files are in skills/b3nd/. Read the relevant file to answer the user's question.
---

# B3nd

B3nd is a framework for building DePIN protocols. It provides URI-addressed
resources, schema-driven validation, and cryptographic primitives. You define
the rules — what data is allowed, who can write where, how messages are
validated — and B3nd handles dispatch, storage composition, transport, and
encryption.

Protocols are built on B3nd. Apps are built on protocols.

## What B3nd Provides

**URI-addressed resources.** Every piece of data has an address (a URI). The URI
scheme determines which program validates writes to that address. URIs express
behavior (mutable, immutable, encrypted) — not meaning.

**Schema-driven validation.** A protocol defines a schema: a map of URI prefixes
to programs. Programs are functions that classify messages — they decide what's
allowed and what's rejected. The framework dispatches each message to the right
program based on its URI.

**Cryptographic primitives.** Ed25519 signing for identity and non-repudiation.
X25519 encryption for confidentiality. HMAC for deterministic key derivation.
SHA-256 hashing for content addressing. All client-side — the framework never
needs to be trusted with cleartext data.

**Storage composition.** Mix and match backends (Postgres, MongoDB, SQLite, S3,
memory, IPFS) with combinators. Writes broadcast to all backends. Reads try each
in order. The protocol doesn't care where data lives.

**Transport abstraction.** HTTP, WebSocket, and in-process clients all implement
the same `ProtocolInterfaceNode`. Swap transports without changing protocol or
app code.

## Ecosystem (Where the Code Lives)

B3nd is split across repos, each with its own JSR package. This SDK
(`@bandeira-tech/b3nd-sdk`) is an **umbrella** that re-exports the foundation
packages so apps and protocols can use one import. When you read code samples
in the rest of these docs, treat the umbrella import as the canonical path —
but know that the underlying code lives elsewhere.

| Repo                                                                        | Package                              | Role                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| [bandeira-tech/b3nd](https://github.com/bandeira-tech/b3nd) (this)          | `@bandeira-tech/b3nd-sdk` (JSR)      | Umbrella SDK for Deno/servers; ergonomics + apps + cli + node.        |
| [bandeira-tech/b3nd](https://github.com/bandeira-tech/b3nd) (this)          | `@bandeira-tech/b3nd-web` (NPM)      | Browser umbrella with `LocalStorageStore`, `IndexedDBStore`.          |
| [bandeira-tech/b3nd-core](https://github.com/bandeira-tech/b3nd-core)       | `@bandeira-tech/b3nd-core`           | Framework foundation: types, encoding, Rig, Identity, network.        |
| [bandeira-tech/b3nd-canon](https://github.com/bandeira-tech/b3nd-canon)     | `@bandeira-tech/b3nd-canon`          | Protocol toolkit: message envelopes, content addressing, auth, crypto. |
| [bandeira-tech/b3nd-servers](https://github.com/bandeira-tech/b3nd-servers) | `@bandeira-tech/b3nd-server-http`    | Hono-backed HTTP `ServerResolver` for serving a Rig.                  |
| [bandeira-tech/b3nd-servers](https://github.com/bandeira-tech/b3nd-servers) | `@bandeira-tech/b3nd-grpc`           | Connect-protocol gRPC client + server + wire schema.                  |

**Convergence point.** This SDK repo is where the high-level documentation
lives — the per-package repos are minimal and link back here for the broader
picture.

## The Three Roles

B3nd serves three audiences, each at a different layer of the stack:

**Protocol designers** use B3nd to define the rules of their network. They write
programs (validation functions), define URI conventions, and choose trust
models. The framework gives them primitives — they assemble the parts into a
protocol. This is B3nd's primary audience.

**App developers** build on top of a protocol. They use B3nd's SDK + a
protocol's schema to build applications. They think about their domain (recipes,
invoices, profiles) and use `receive()`, `read()`, `list()` to interact with the
network. They don't need to understand the framework internals.

**Infrastructure operators** run B3nd nodes loaded with a protocol's schema.
They choose backends, manage replication, handle uptime. They're the postmasters
— they deliver the mail but don't read it.

## Core Concepts

**Messages are tuples.** Every state change is a `[uri, values, data]` tuple.
URIs address where data goes. Values carry conserved quantities. Data is the
payload. This is the universal primitive.

**Programs classify messages.** A program is a function that receives a message
and returns a result. Programs are protocol-defined — the framework dispatches
to them based on URI prefix. Programs are pure classifiers with no side effects.

**Schemas map URIs to programs.** A schema is a `Record<string, Program>` — a
lookup table from URI prefixes to validation functions. The framework matches
each incoming message's URI against the schema to find the right program.

**Envelopes group related writes.** An envelope bundles inputs (URIs consumed)
and outputs (new data) into a single atomic-intent unit. Content-addressed
envelopes provide audit trails and replay protection.

**Encryption is client-side.** Nodes are untrusted by design. Privacy is
achieved by encrypting before sending. The same node serves public and private
data without configuration changes.

**Storage is an operator concern.** The framework validates and dispatches.
Whether an accepted message is stored, cached, or forwarded is a node operator
decision. App developers write against `receive()`/`read()` without coupling to
any backend.

## Going Deeper

Where to go next based on what you're building:

- **Creating your own DePIN network?** See [FRAMEWORK.md](./FRAMEWORK.md) for
  the B3nd SDK, protocol examples, node setup, and how to package your protocol
  as an SDK. See [PROTOCOL_COOKBOOK.md](./PROTOCOL_COOKBOOK.md) for deployment
  and packaging recipes.

- **Running B3nd infrastructure?** See [OPERATORS.md](./OPERATORS.md) for node
  deployment, managed mode, backends, monitoring, replication, and multi-node
  networks.

- **Understanding the core architecture?** See
  [DESIGN_PRIMITIVE.md](./DESIGN_PRIMITIVE.md) for the message primitive,
  program model, and rig composition.

- **Curious why B3nd works this way?** See [FAQ.md](./FAQ.md) for design
  rationale, trade-offs, and architectural decisions.

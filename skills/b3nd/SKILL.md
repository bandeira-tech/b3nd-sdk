---
name: b3nd
description: |
  B3nd — a framework for building DePIN protocols. Read this file first for the conceptual overview (framework vs protocol vs app, three roles, core ideas), then read the referenced file when the question matches a topic below.

  FRAMEWORK.md — DePIN framework & SDK: message primitives, schema dispatch, envelope structure, NodeProtocolInterface, auth/encryption, content-addressing, client composition, ProgramValidator, createOutputValidator, protocol versioning, packaging a protocol SDK. Read when designing a new DePIN protocol.

  OPERATORS.md — Node operations: two-phase binary, backend configuration (memory/Postgres/MongoDB/HTTP), managed mode, peer replication, multi-node networks, key generation, environment variables, MCP node tools. Read when deploying or managing infrastructure.

  FAQ.md — Design rationale, trade-offs, architectural decisions, troubleshooting. Read when asking "why does B3nd do X?"

  PROTOCOL_COOKBOOK.md — Protocol recipes: the programs+handlers+broadcast composition point (with a worked fan-out example), packaging a protocol SDK, running nodes with schema modules, multi-backend composition. Read for protocol deployment patterns and for the classifier/handler/broadcast idiom.

  DESIGN_EXCHANGE.md — Exchange patterns & trust models: serverless, non-custodial, pubkey access control, managed operator, three-party consensus, party interaction diagrams, crypto guarantees. Read for trust model design.

  DESIGN_INFRASTRUCTURE.md — Infrastructure design: node requirements, deployment topologies (single node, remote listener, cluster, peer replication), inbox/outbox URIs, scaling, vault listener reference architecture. Read for deployment architecture.

  DESIGN_TRANSPORT.md — Transport design: HTTP polling, WebSocket, SSE, WebRTC, WebTransport, comparison matrix, subscribe() primitive, NodeProtocolInterface convergence. Read for transport layer decisions.

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

**URI-addressed resources.** Every piece of data has an address (a URI). The
URI scheme determines which program validates writes to that address. URIs
express behavior (mutable, immutable, encrypted) — not meaning.

**Schema-driven validation.** A protocol defines a schema: a map of URI
prefixes to programs. Programs are functions that classify messages — they
decide what's allowed and what's rejected. The framework dispatches each
message to the right program based on its URI.

**Cryptographic primitives.** Ed25519 signing for identity and non-repudiation.
X25519 encryption for confidentiality. HMAC for deterministic key derivation.
SHA-256 hashing for content addressing. All client-side — the framework never
needs to be trusted with cleartext data.

**Storage composition.** Mix and match backends (Postgres, MongoDB, SQLite, S3,
memory, IPFS) with combinators. Writes broadcast to all backends. Reads try
each in order. The protocol doesn't care where data lives.

**Transport abstraction.** HTTP, WebSocket, and in-process clients all
implement the same `NodeProtocolInterface`. Swap transports without changing
protocol or app code.

## The Three Roles

B3nd serves three audiences, each at a different layer of the stack:

**Protocol designers** use B3nd to define the rules of their network. They
write programs (validation functions), define URI conventions, and choose
trust models. The framework gives them primitives — they assemble the parts
into a protocol. This is B3nd's primary audience.

**App developers** build on top of a protocol. They use B3nd's SDK + a
protocol's schema to build applications. They think about their domain
(recipes, invoices, profiles) and use `receive()`, `read()`, `list()` to
interact with the network. They don't need to understand the framework
internals.

**Infrastructure operators** run B3nd nodes loaded with a protocol's schema.
They choose backends, manage replication, handle uptime. They're the
postmasters — they deliver the mail but don't read it.

## Core Concepts

**Messages are tuples.** Every state change is a `[uri, values, data]` tuple
— always three positions, never two. The middle slot (`values`) carries
conserved quantities (UTXO-style `{ fire: 100 }`, `{ gas: 50 }`, etc.) and
is `{}` for pure data writes. URIs address where data goes; data is the
payload. This is the universal primitive. See
[DESIGN_PRIMITIVE.md](./DESIGN_PRIMITIVE.md#values-and-conservation) for
what the values slot is for.

**Programs classify messages.** A program is a function that receives a message
and returns a classification `{ code, error? }`. Programs are protocol-defined
— the framework dispatches to them by longest-prefix URI match. Programs are
pure classifiers with no side effects.

**Programs map URIs to classifiers.** The `programs:` table on a Rig is a
`Record<string, Program>` — a lookup from URI prefixes to classifier
functions. The framework matches each incoming message's URI against the
table to find the right program.

## What Changed From the Schema Era

If you are reading older documentation, blog posts, or apps that reference
b3nd's `Schema` / `Validator` API (`{ valid, error }` return, `schema:`
key on the Rig, `msgSchema()` helper), three things have changed in the
current SDK and it is worth knowing all three before you wire a protocol:

1. **Classification replaces validation.** Programs return
   `{ code, error? }`. The framework has no built-in notion of "valid" —
   rejections are just programs that set `error`. Codes map to
   `handlers:`, so a protocol can distinguish "valid", "valid but not
   confirmed", "needs attestation", etc. and an operator can override
   handlers without forking the classifiers.
2. **Unknown URI prefixes pass through by default.** The old Schema
   rejected URIs with no matching program. Today the Rig dispatches
   unmatched URIs straight to connections without classification. If you
   need the old closed-by-default posture, install an explicit rejecter
   program — see the "Reject unknown prefixes" recipe in
   [RIG_PATTERNS.md](./RIG_PATTERNS.md#reject-unknown-prefixes).
3. **Programs fire on receive, not on send.** `rig.send()` /
   `session.send()` dispatches the envelope directly to connections
   after the `beforeSend` hook; it never runs the program registry.
   If you need program-level enforcement on authenticated writes, route
   them through `rig.receive()` with a signed payload in `data`, use
   `beforeSend` hooks, or rely on transport-side authorization. See
   [FRAMEWORK.md](./FRAMEWORK.md#programs-validate-receives-not-sends)
   for the full rationale and a worked example.

**Envelopes group related writes.** An envelope bundles inputs (URIs consumed)
and outputs (new data) into a single atomic-intent unit. Content-addressed
envelopes provide audit trails and replay protection.

**Encryption is client-side.** Nodes are untrusted by design. Privacy is
achieved by encrypting before sending. The same node serves public and private
data without configuration changes.

**Storage is an operator concern.** The framework validates and dispatches.
Whether an accepted message is stored, cached, or forwarded is a node operator
decision. App developers write against `receive()`/`read()` without coupling
to any backend.

## Going Deeper

Where to go next based on what you're building:

- **Creating your own DePIN network?** See [FRAMEWORK.md](./FRAMEWORK.md) for
  the B3nd SDK, protocol examples, node setup, and how to package your
  protocol as an SDK. See [PROTOCOL_COOKBOOK.md](./PROTOCOL_COOKBOOK.md) for
  deployment and packaging recipes.

- **Running B3nd infrastructure?** See [OPERATORS.md](./OPERATORS.md) for
  node deployment, managed mode, backends, monitoring, replication,
  and multi-node networks.

- **Understanding the core architecture?** See
  [DESIGN_PRIMITIVE.md](./DESIGN_PRIMITIVE.md) for the message primitive,
  program model, and rig composition.

- **Curious why B3nd works this way?** See [FAQ.md](./FAQ.md) for design
  rationale, trade-offs, and architectural decisions.

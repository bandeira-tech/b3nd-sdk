# B3nd — Product Landscape

> Working document for product management and delivery coordination.
> Last updated: 2026-03-11

---

## The Product

**B3nd** is a protocol and SDK for URI-based data where users own their data, privacy is encryption, and any app can read the same addresses. It provides the toolkit: clients, composition primitives, validation, encryption, servers. Protocols are built on top of B3nd; apps are built on top of protocols.

---

## What Exists (Built, Working)

### SDK (published, usable today)
- **JSR**: `@bandeira-tech/b3nd-sdk` — Deno/server
- **NPM**: `@bandeira-tech/b3nd-web` — Browser/React
- **Core operations**: `receive()`, `read()`, `list()`, `delete()`, `send()` (batch envelopes)
- **7 client implementations**: Memory, HTTP, WebSocket, PostgreSQL, MongoDB, LocalStorage, IndexedDB
- **Composition layer**: `createValidatedClient`, `parallelBroadcast`, `firstMatchSequence`, `when`, `emit`, `parallel`, `pipeline`, `seq`, `any`, `all`
- **Encryption**: Ed25519 signing, X25519 encryption, AES-GCM, PBKDF2 key derivation, `createAuthenticatedMessageWithHex`, `createSignedEncryptedMessage`
- **Hash**: SHA-256 content addressing, `hash://sha256/{fingerprint}` URIs
- **Schema validation**: `msgSchema()`, program-based dispatch
- **Build**: Deno monorepo, tsup for NPM, JSR publishing, CI on GitHub Actions
- **Version**: ~0.8.x

### Apps (built, deployable)
- **b3nd-node** — The core server. HTTP + optional WS. Multi-backend (memory, postgres, mongo). Docker-ready. Auto-creates tables.
- **b3nd-cli** — CLI tool (`bnd`), bundled JS
- **b3nd-web-rig** — Vite + React + Tailwind reference app. Used for testing, demos, book reader.
- **wallet-node** — Custodial wallet server (Google OAuth, JWT, proxy writes). Full auth service.
- **vault-listener** — Non-custodial auth (HMAC derivation from OAuth tokens). Lighter alternative.
- **apps-node** — Apps registry node
- **sdk-inspector** — SDK inspection/debugging tool
- **website** — b3nd.dev marketing site

### Infrastructure
- **Testnet**: local development (memory backend)
- **Docker Compose**: dev and test profiles with Postgres + Mongo
- **Makefile**: full dev workflow (`make dev`, `make test`, `make pkg`, `make publish`)
- **Claude Code plugin**: MCP tools for `b3nd_read`, `b3nd_receive`, `b3nd_list`, `b3nd_delete`, `b3nd_health`

### Tests
- Unit tests across most libs
- E2E tests in `tests/`
- Shared test suites for client implementations

---

## What's Designed (Proposals, Not Yet Built)

### 1. Tokenization & Gas Semantics (`docs/proposals/tokenization-gas-semantics.md`)
**Status**: Draft — Three proposals explored, Proposal C (dual-layer) recommended

- **UTXO model** for gas tokens (Bitcoin-inspired, maps to B3nd's inputs/outputs)
- **Three proposals**: A (Gas-as-UTXO), B (Stake-and-Rate-Limit), C (Dual-Layer hybrid — recommended)
- **Dual-Layer**: Per-message gas for writes + stake-based access for operators + relay rewards
- **Confirmation & Checkpoints**: Confirmation is just more messages. Checkpoint hash chains. No separate mempool.
- **Stratified validation**: Validators specialize in URI path subsets
- **Adaptive fee pricing**: Gas costs denominated in stable units, FCAT-per-unit adjusts to maintain stable real-world costs
- **Free-tier bootstrap**: Faucet (PoW), sponsor model, invite vouching
- **Sponsor assembly**: Users write partial messages (no gas), sponsors attach gas payment, validators confirm

**Implementation roadmap proposed**:
- Phase 0: Schema-only gas validators (test tokens)
- Phase 1: Single-node gas + checkpoints
- Phase 2: Multi-node gas (replication, relay proofs, staking)
- Phase 3: Token launch

**Open questions**: Encryption surcharge, UTXO set growth management, who sets fee rates, relay reward gaming prevention, consensus model for gas partition

### 2. Token Movement / Bridge (`docs/proposals/bridge-token-movement.md`)
**Status**: Draft — Layered architecture designed

Five-layer model:
- **Layer 1**: External chain tokens (FCAT + xFCAT on Solana, AMM peg)
- **Layer 2**: Bridge pattern (transaction references as URIs, not bridge contracts)
- **Layer 3**: B3nd native economy (preminted B3ND, protocol locks)
- **Layer 4**: Network Fund (fee collection, validator rewards, bridge market participant)
- **Layer 5**: Withdrawal market (bilateral trades, multi-token settlement)

Key design choices: No native withdrawal (exit is a trade), no burns (all supplies fixed), multi-token withdrawal resilience, AMM fees as manipulation defense, protocol locks as monetary policy, bridge always accepts deposits.

**Open questions**: TGE supply ratios, initial distribution, bridge AMM parameters, network fund rules, deposit program design, consensus for gas partition

### 3. Confirmation Protocol
**Status**: Designed, validators partially implemented

Multi-node consensus via messages:
- Pending → Attestation → Confirmation lifecycle
- N-of-M threshold agreement
- Write-once URIs prevent equivocation
- Everything expressed as `[uri, data]` — no foreign consensus engine
- Migration path via `CONFIRMATION_THRESHOLD` (1 = single-node like today)

### 4. Temporal Consensus
**Status**: Designed, validators written

Extends confirmation with temporal structure:
- Era/Block/Slot coordinates
- Unbounded attestation market → selective confirmation market → block production
- Market dynamics between validators, confirmers, block producers

**Open questions**: Node identity & registration, timing & liveness, reward distribution, reorg & finality

### 5. Auth Protocol
**Status**: Designed, partially built

- Password auth: deterministic key derivation (PBKDF2), fully client-side
- OAuth/PKCE: SPA-native, non-custodial vault as default
- Custodial wallet server: exists for apps needing traditional accounts
- **Deferred**: Multi-provider linking, key rotation/migration

### 6. Backend Services Design
**Status**: Designed, `respondTo()` and `connect()` proposed but not yet built

- Handler as portable unit of backend logic
- Two deployment modes: embedded in node, or connected remotely
- `respondTo()`: wraps handler as compose Processor (proposed)
- `connect()`: bridges handler to remote node (proposed)
- Current `b3nd-listener` to be rebuilt on compose primitives (proposed)

---

## What's Written (Content)

### The Book: "What's in a Message" (`docs/book/`)
**Status**: 16 chapters written, full plan in `plan.md`

A teaching book that explains B3nd through conversation → letters → digital. Three-part structure:
- Part I (Ch 1-5): The Conversation — speech, air, human foundation
- Part II (Ch 6-9): The Message — paper, carriers, what changes
- Part III (Ch 10-16): The Network — digital, b3nd, cookbook

---

## Identified Gaps (From App Exploration PRD)

The App Exploration PRD stress-tested three apps against the protocol and found:

### What works well
- Small, coherent API surface
- Cryptographic identity is first-class
- Content-addressed envelopes
- Client-side encryption with strong primitives
- No vendor lock-in
- Uniform client interface

### What needs work (priority order from PRD)
1. **No server-side querying or aggregation** (every app needs this) — Indexer proposal addresses this
2. **No real-time / subscription support** — WebSocket subscribe deferred
3. **No concurrency control** (no CAS, no versioning) — `receiveIf` proposed but not built
4. **"Private" visibility is misleadingly named** — documented but not yet fixed in code/docs
5. **No key lifecycle management** (backup, sync, rotation, recovery) — KeyBundle concept proposed
6. **No offline-first sync framework** — not yet designed
7. **No integration with external services** (webhooks, triggers, email) — not yet designed
8. **Persistence not guaranteed** — storage tiers proposed in economic model

---

## Active Fronts

Here's every front that needs attention, grouped by domain:

### A. Protocol & Core Engineering
- Confirmation protocol implementation (validators exist, node behavior not wired)
- Temporal consensus implementation
- `respondTo()` and `connect()` compose primitives
- Rebuild `b3nd-listener` on compose layer
- Concurrency control (`receiveIf` / conditional writes)
- Real-time subscriptions (WebSocket push)
- Indexer system implementation
- Fix "private" visibility (either change derivation or add prominent warning)
- KeyBundle abstraction for key lifecycle

### B. Economic Layer
- Gas/token schema validators (Phase 0)
- UTXO tracking and consumption
- Checkpoint hash chains
- Sponsor assembly flow
- Fee calculation and adaptive rates
- Staking with sqrt-weighted rewards
- Relay proof and reward system
- Resolve open questions (consensus for gas partition, fee rate governance, etc.)

### C. Token & Bridge
- FCAT / xFCAT design finalization
- Bridge AMM specification
- Deposit program (Solana)
- Network Fund rules
- Withdrawal market design
- TGE planning (supply ratios, distribution)

### D. Product & Apps
- Indexer (unblocks all serious app development)
- Developer documentation improvements (privacy warning, size limits, atomicity guarantees)
- Reference app(s) demonstrating B3nd capabilities
- App marketplace / registry (apps-node exists but unclear status)

### E. Infrastructure & DevOps
- Multi-node deployment and peer replication testing
- Managed node improvements
- Monitoring / observability
- Production deployment hardening

### F. Content & Marketing
- Book completion/polish
- b3nd.dev website content
- Protocol website content
- Developer onboarding materials

### G. Business & Strategy
- Economic model finalization (ad model details, revenue projections)
- Token launch planning
- Community building / validator recruitment
- Legal / compliance considerations for token

---

## How to Use This Document

This is a living map. When we work together:

1. **Pick a front** — tell me which area you want to focus on
2. **Zoom in** — I'll pull up the relevant docs, code, and proposals
3. **Work** — we design, write code, write docs, resolve open questions
4. **Update** — we mark progress here

I have the full context of every document, proposal, design spec, and codebase structure in this project. Ask me about any of it and I can go deep immediately.

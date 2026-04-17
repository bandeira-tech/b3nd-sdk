# B3nd — Task Breakdown

> Preliminary task list across all fronts. Derived from codebase TODOs, proposal open questions, PRD recommendations, design doc decision logs, and architectural gaps.
> Last updated: 2026-03-11

---

## A. Protocol & Core Engineering

### A1. Compose Primitives (Backend Services)
- [ ] Implement `respondTo(handler, opts)` — wrap a handler as a compose `Processor` (decrypt → call → encrypt → route)
- [ ] Implement `connect(remote, opts)` — bridge a handler to a remote node (polling transport, cursor tracking, dedup)
- [ ] Rebuild `b3nd-listener` on top of `respondTo()` + `connect()` instead of parallel custom system
- [ ] Define `subscribe(remote, opts)` interface for future WebSocket transport (deferred, but interface should be reserved)

### A2. Confirmation Protocol (Multi-Node Consensus)
- [ ] Wire `pendingValidator` into node receive pipeline (write pending marker after local validation passes)
- [ ] Wire `attestationValidator` — node monitors `immutable://pending/` and writes attestations
- [ ] Wire `rejectionValidator` — node writes rejection with reason string on validation failure
- [ ] Wire `confirmationValidator` — node counts attestations and finalizes when threshold met
- [ ] Implement node discovery loop (poll `immutable://pending/` for new entries)
- [ ] Implement validation replay (`replayValidation()` — read envelope, re-run all validators)
- [ ] Implement finalization race handling (write-once semantics, graceful "already confirmed" handling)
- [ ] Implement `waitForConfirmation()` client helper (poll confirmation URI with timeout)
- [ ] Make `CONFIRMATION_THRESHOLD` configurable (1 = single-node like today, N = multi-node)
- [ ] Define static validator set mechanism (schema constant listing node pubkeys)
- [ ] Design dynamic validator registry (`mutable://accounts/{operatorKey}/validators/{nodeKey}`)

### A3. Temporal Consensus (Era/Block/Slot)
- [ ] Implement `consensusSlotValidator` — era/block/slot timing validation (currently `// TODO`)
- [ ] Design node identity and registration resources (currently any pubkey can be validator/confirmer/producer)
- [ ] Design timing and liveness rules (era/block/slot enforcement, offline handling, attestation timeouts)
- [ ] Design reward distribution mechanism (how validators/confirmers/producers claim rewards via UTXOs)
- [ ] Design reorg and finality rules (can blocks be reorganized? when is a slot final? finality gadget?)
- [ ] Design spam prevention on consensus process (rate limiting who can submit pending/attestation/confirmation)

### A4. Concurrency Control
- [ ] Design `receiveIf(uri, data, { expectedVersion })` — conditional writes with optimistic locking
- [ ] Add version tracking to records (or use content hash as version)
- [ ] Update all client implementations to support conditional writes
- [ ] Document concurrency model and recommended patterns

### A5. Real-Time Subscriptions
- [ ] Design WebSocket subscription protocol (server-push for URI prefix changes)
- [ ] Implement server-side: node tracks subscriptions, pushes matching messages
- [ ] Implement `WebSocketClient` subscribe mode (beyond current request/response)
- [ ] Add React hooks for subscriptions (`useSubscription(prefix)`)

### A6. Indexer System
- [ ] Implement `IndexerDefinition` interface and runtime
- [ ] Implement `IndexerBackend` — at least one backend (SQLite or Postgres)
- [ ] Implement `createIndexerProcessor` — compose `Processor` that pipes messages to indexer
- [ ] Implement message feed / event stream (pull-based cursor, `GET /api/v1/feed?since={cursor}`)
- [ ] Implement backfill mechanism (paginate through source node, replay through indexer)
- [ ] Implement cursor store (using B3nd node itself as storage)
- [ ] Implement `IndexQuery` interface (filter, search, select, sort, pagination, aggregate)
- [ ] Implement `AggregationStage` pipeline (MongoDB-style $match, $group, $sort, $limit, $project)
- [ ] Implement view key derivation (`deriveViewKey()`) for encrypted data indexing
- [ ] Implement view key rotation (`rotateViewKey()`)
- [ ] Implement `HttpIndexerClient` (extends `NodeProtocolInterface` with query/search/aggregate)
- [ ] Implement React hooks: `useIndexedQuery`, `useIndexedSearch`, `useAggregation`, `useIndexerHealth`
- [ ] Implement HTTP endpoints: `/api/v1/indexer/query`, `/search`, `/aggregate`, `/health`, `/feed`, `/views`
- [ ] Implement `mountIndexerRoutes()` for server integration
- [ ] Implement `verifyIndexerResult()` — spot-check indexer output against source
- [ ] Implement schema evolution handling (`initializeIndexer()` with version mismatch, teardown, setup, backfill)
- [ ] Implement smart routing via `inferViewFromUri()` in `FunctionalClient` decorator

### A7. Encryption & Key Lifecycle
- [ ] Fix "private" visibility: either change derivation to use X25519 by default, or add prominent warning that `SALT:uri:ownerPubkey` is obscurity not encryption
- [ ] Design `KeyBundle` abstraction (Ed25519 signing + X25519 encryption + password-based backup)
- [ ] Design multi-device key sync mechanism (password-wrapped keys, QR transfer, or seed phrases)
- [ ] Document key loss implications prominently ("key loss = permanent data loss")
- [ ] Implement standard `client.receiveEncrypted()` helper (compose encrypt + sign + receive)
- [ ] Design key rotation mechanism (changing credentials = new identity, how to migrate data)

### A8. SDK Documentation Gaps (from PRD)
- [ ] Document maximum record sizes per node/backend type
- [ ] Document `send()` atomicity guarantees (or lack thereof — are failed outputs after success rolled back?)
- [ ] Document recommended pattern for building discovery indexes (including security tradeoffs of `mutable://open`)
- [ ] Design integrity-protected public namespace (`mutable://verified` where writes require content-author signatures)

### A9. Wallet Node Enhancements (from README checklist)
- [ ] Email-based password reset
- [ ] User profile management (display name, avatar)
- [ ] API key authentication (server-to-server)
- [ ] Rate limiting
- [ ] Audit logging
- [ ] Key rotation support
- [ ] Multi-factor authentication
- [ ] WebAuthn/passkey support

---

## B. Economic Layer (Gas & Tokenization)

### B1. Phase 0 — Schema-Only Gas (Test Tokens)
- [ ] Implement `gas://utxo` program validators (creation, consumption, ownership verification)
- [ ] Implement UTXO existence and unspent checks
- [ ] Implement fee output validation (amount conservation: input amounts ≥ output amounts)
- [ ] Implement `gas://rates` program (static fee rates per program key)
- [ ] Implement `gas://faucet` program (one-time claim with PoW verification)
- [ ] Define `confirmation://checkpoints` schema and convention
- [ ] Create test token minting mechanism (self-minted UTXOs for development)
- [ ] Compose gas validators with existing protocol schema (additive, wrapping existing validators with fee checks)

### B2. Phase 1 — Single-Node Gas + Checkpoints
- [ ] Implement UTXO tracking (unspent set maintenance, consumption detection)
- [ ] Implement fee calculation engine (base_fee per program + size_fee per KB)
- [ ] Implement checkpoint hash chain (single validator producing `confirmation://checkpoints/{validatorKey}/{sequence}`)
- [ ] Implement sponsor assembly flow (partial messages without gas → sponsor attaches UTXO → validator confirms)
- [ ] Implement adaptive fee rates (congestion-based adjustment at epoch boundaries)
- [ ] Implement free-tier faucet with PoW (Nostr NIP-13 style)

### B3. Phase 2 — Multi-Node Gas
- [ ] Replicate gas UTXOs and checkpoints across peers
- [ ] Implement cross-node UTXO consumption detection (checkpoint comparison)
- [ ] Implement relay proof recording (`gas://relay-proofs/{hash}`)
- [ ] Implement relay acknowledgment (`gas://relay-acks`)
- [ ] Implement operator staking (`gas://staking/{pubkey}` with sqrt-weighted rewards)
- [ ] Implement stratified validation (validators declare URI path ranges in staking message)
- [ ] Implement withdraw programs (proof of validated messages → delayed claim from fund)
- [ ] Design and implement double-spend resolution (earlier timestamp wins? stake-weighted? checkpoint chain comparison)

### B4. Economic Design Decisions (Open Questions)
- [ ] Decide: encryption surcharge yes/no (recommendation in doc: bundle into base fee)
- [ ] Design UTXO consolidation mechanism (merge many small UTXOs into one)
- [ ] Decide: who sets fee rates initially (recommendation: protocol-fixed, move to algorithmic)
- [ ] Design relay reward anti-gaming (make relay rewards bonus on validation, not standalone)
- [ ] Decide: consensus model for gas partition (single validator vs multi-validator quorum vs path-range)
- [ ] Design token distribution plan (who gets initial supply: operators, contributors, public sale, airdrop?)

### B5. Ad Revenue Model (from Economic Model)
- [ ] Design ad campaign matching algorithm (how listener nodes match campaigns to user sessions)
- [ ] Design settlement epoch mechanism (how epochs trigger, how distribution is calculated and verified)
- [ ] Design reputation system formula (score calculation, decay, flagging)
- [ ] Design attestation ecosystem (who runs verification services, how users collect attestations, cost structure)
- [ ] Define token withdrawal mechanics parameters (cliff, minimum threshold, gradual disbursement — currently "e.g." values)
- [ ] Design gas price adaptation formula (floor price, responsiveness, oscillation prevention)

---

## C. Token & Bridge

### C1. External Chain Design
- [ ] Finalize FCAT / xFCAT supply ratios (1:1:2 vs 1:1:1 vs other)
- [ ] Design bridge AMM parameters (pool type, fee rate, fee destination, protocol-owned vs external LPs)
- [ ] Design Solana deposit program (simple lockbox vs complex vault, what happens to locked FCAT)
- [ ] Decide xFCAT initial distribution (liquidity pools vs foundation vs community vs market makers)

### C2. B3nd Native Economy
- [ ] Finalize B3ND preminted supply and distribution across pools (bridge escrow, reward, foundation, community)
- [ ] Design protocol lock conditions for earned UTXOs (ad revenue locks, relay locks, reputation-gated locks)
- [ ] Design Network Fund rules (% of gas fees to fund, dynamic rate based on fund fullness, maximum balance)
- [ ] Design fund lifecycle transitions (genesis → growth → mature)
- [ ] Design withdraw program conditions (time delay, work proof requirements)

### C3. Bridge Pattern Implementation
- [ ] Implement `solana://tx/{signature}` URI program and validator
- [ ] Implement deposit verification flow (read Solana RPC, confirm transaction, issue B3ND UTXO)
- [ ] Implement double-deposit prevention (URI uniqueness on transaction signature)
- [ ] Design withdrawal market messaging protocol (how users find providers, negotiate, settle)
- [ ] Design multi-token settlement patterns (xFCAT, FCAT, USDC, SOL paths)

### C4. TGE Planning
- [ ] Model supply dynamics across three pools (FCAT on Solana, xFCAT on Solana, B3ND on B3nd)
- [ ] Model equilibrium dynamics (bridge AMM peg, protocol locks vs circulating, fund refill, withdrawal pricing)
- [ ] Perform adversarial analysis validation (test deposit drain, xFCAT corner, recycling grinder, scorched earth scenarios with real numbers)
- [ ] Design mintability rules if adopted (verifiable conditions tied to network activity)

---

## D. Product & Apps

### D1. Developer Experience
- [ ] Write privacy warning for "private" visibility in SDK docs
- [ ] Document record size limits
- [ ] Document `send()` atomicity behavior
- [ ] Write "KeyBundle" recipe (backup, multi-device sync, recovery)
- [ ] Write standard encrypted write pattern documentation
- [ ] Write discovery index patterns guide (with `mutable://open` security tradeoffs)
- [ ] Create developer quickstart for building a B3nd app (end-to-end, from key creation to deployed app)

### D2. Reference Apps
- [ ] Build at least one complete reference app demonstrating B3nd capabilities (once indexer exists)
- [ ] The PRD's three app designs (recipe book, encrypted journal, invoicing) are ready as reference implementations

### D3. Platform Features (from PRD Priority 4)
- [ ] Design webhook/trigger support for external service integration
- [ ] Design "durable" storage tier or SLA mechanism for compliance-sensitive use cases
- [ ] Design multi-user access control beyond shared keypairs (role-based access to a namespace)
- [ ] Design offline-first sync framework (local client ↔ remote client reconciliation)

---

## E. Infrastructure & DevOps

### E1. Multi-Node Operations
- [ ] Test and harden peer replication across multiple b3nd-nodes
- [ ] Test confirmation protocol across 3+ nodes
- [ ] Implement managed-node improvements (node builder, config watcher, heartbeat — libs exist but integration unclear)
- [ ] Set up multi-node staging environment

### E2. Production Readiness
- [ ] Add monitoring/observability (health endpoints exist, need metrics, logging, alerting)
- [ ] Harden Docker images for production
- [ ] Document production deployment guide
- [ ] Implement rate limiting at HTTP layer (DoS prevention, separate from protocol-level gas)

---

## F. Content & Marketing

### F1. Book
- [ ] Review all 16 chapters for completeness and consistency with current protocol state
- [ ] Ensure three-layer scaffold is used consistently in every chapter from Part II onward
- [ ] Review cookbook chapter (Ch 16) against actual current SDK API
- [ ] Publish/distribute (web reader in rig? PDF? separate site?)

### F2. Websites
- [ ] Review b3nd.dev content against current SDK state
- [ ] Review protocol website content against current protocol state
- [ ] Write developer-facing documentation pages
- [ ] Create getting-started guides

### F3. Community Materials
- [ ] Write validator/operator recruitment materials (what it takes to run a node, what you earn)
- [ ] Write app builder pitch (why build on B3nd vs alternatives)

---

## G. Business & Strategy

### G1. Economic Model Finalization
- [ ] Validate advertiser willingness assumptions (CPM targeting feasibility, engagement measurement)
- [ ] Model foundation subsidy runway (how long can foundation sustain network at various user counts)
- [ ] Define decision points (at what user count / revenue level do we transition from subsidy to self-sustaining?)
- [ ] Model operator break-even (document says operators lose money below 10K users at $0.25 CPM)
- [ ] Design cold-start strategy details (which apps first, how to incentivize builders, how to reach beyond early adopters)

### G2. Token Launch
- [ ] Legal/compliance review for token issuance
- [ ] Token distribution plan
- [ ] Market maker / liquidity strategy
- [ ] Exchange listing strategy

### G3. Competitive Positioning
- [ ] Document comparison with Nostr, Holochain, Filecoin, Ethereum (partially done in gas semantics doc)
- [ ] Prepare for incumbent competitive response (identified as risk in economic model)

---

## Emerging Groupings

Looking at the tasks above, several natural clusters emerge that cut across the front labels:

### Group 1: "Make Apps Possible" — The Developer Platform
**What it is**: Everything a third-party developer needs to build a real app on B3nd today.

Tasks: A6 (Indexer), A4 (Concurrency), A5 (Real-time), A7 (Key lifecycle), A8 (SDK docs), D1 (Dev experience), D2 (Reference apps)

**Why it's a group**: The PRD proved that the SDK works for basic CRUD but every non-trivial app hits the same walls — no queries, no concurrency, no subscriptions, misleading privacy. The indexer is the keystone. Without it, app development is stuck. Concurrency, subscriptions, and key management are close behind.

**The unlock**: A working indexer + concurrency control + clear docs = developers can build real apps. Everything else (economic layer, token, bridge) is infrastructure they don't need to think about yet.

### Group 2: "Make Nodes Talk" — Multi-Node Protocol
**What it is**: Everything needed for B3nd to be a real network, not just individual nodes.

Tasks: A1 (Compose primitives — `respondTo`, `connect`), A2 (Confirmation protocol), A3 (Temporal consensus), E1 (Multi-node ops)

**Why it's a group**: Today, a single node works well. The confirmation protocol, temporal consensus, and compose primitives are all about making multiple nodes coordinate. They share the same infrastructure needs (peer replication, message discovery, validation replay) and they depend on each other sequentially — confirmation protocol must work before temporal consensus, which must work before gas validation across nodes.

**The unlock**: Multi-node confirmation working = the network exists as more than one machine. This is prerequisite for any real decentralization, staking, or token economics.

### Group 3: "Make It Pay" — Economic & Token Layer
**What it is**: Everything related to gas, tokens, staking, rewards, bridge, and token launch.

Tasks: B1-B5 (all economic layer), C1-C4 (all token & bridge), G1-G2 (business strategy & token launch)

**Why it's a group**: This is a deeply interconnected system — gas fees fund operators, staking secures validation, the bridge connects to external markets, the token launch bootstraps the whole thing. These tasks are mostly design decisions and economic modeling that should be resolved as a coherent whole before implementation begins. Implementation follows the phased roadmap (Phase 0 → 1 → 2 → 3).

**The unlock**: Phase 0 (schema-only gas with test tokens) can start independently. Everything beyond Phase 0 depends on Group 2 (multi-node) being functional. Token launch depends on everything.

### Group 4: "Tell the Story" — Content & Positioning
**What it is**: The book, websites, developer docs, competitive positioning, community materials.

Tasks: F1-F3 (content & marketing), G3 (competitive positioning), D1 (developer experience docs)

**Why it's a group**: These all serve the same purpose — explaining what B3nd is, why it matters, and how to use it. The book is the deep philosophical foundation. The websites are the entry point. The developer docs are the practical bridge. They should share voice, terminology, and framing.

**The unlock**: These can progress in parallel with everything else. The book is largely written. Docs need updating as the SDK evolves.

### Group 5: "Platform Features" — Future Capabilities
**What it is**: Features identified as needed but not yet designed — webhooks, durable storage, multi-user roles, offline sync.

Tasks: D3 (platform features), A9 (wallet enhancements)

**Why it's a group**: These are all "would be nice" features that the PRD identified but that aren't blocking any immediate work. They become important when real apps start hitting their absence, which happens after Group 1 unlocks app development.

**The unlock**: These are demand-driven. Build them when apps need them, not before.

---

## Dependency Chain (Simplified)

```
Group 1 (Apps Possible)  ←──── enables app development
    ↑
    │ indexer needs node protocol
    │
Group 2 (Nodes Talk)     ←──── enables decentralization
    ↑
    │ gas needs multi-node
    │
Group 3 (Make It Pay)    ←──── enables economic sustainability
    ↑
    │ token needs economics
    │
Token Launch

Group 4 (Story)           ←──── parallel with everything
Group 5 (Platform)        ←──── demand-driven, after Group 1
```

The core tension: Group 1 delivers immediate developer value but Group 2 delivers protocol credibility. Group 3 delivers economic viability but depends on both. The book (Group 4) can support any of them.

# B3nd Tokenization & Gas Semantics — Engineering Proposals

**Status:** Draft — Conceptual exploration for first-round discussion
**Date:** 2026-02-24
**Context:** Decentralized message passing on B3nd/Firecat

---

## 1. Problem Statement

B3nd currently has no economic layer. Nodes accept all valid messages for free. This works for development and private deployments but creates three problems at network scale:

1. **Spam** — No cost to write means no cost to abuse.
2. **Sustainability** — Node operators bear storage, bandwidth, and compute costs with no compensation.
3. **Relay incentives** — Peer replication (`parallelBroadcast` to push peers) has no reward mechanism; operators running `bestEffortClient` push peers are pure altruists.

The goal is to design gas/token semantics that fit *within* B3nd's existing architecture — not bolted on top, but expressed as **schema validators, URI namespaces, and MessageData outputs** using the primitives that already exist.

---

## 2. Design Constraints (from the architecture)

These are non-negotiable properties of B3nd that any tokenization proposal must respect:

| Constraint | Implication |
|---|---|
| **Message = `[uri, data]`** | Gas must be expressible as messages, not a separate transport layer |
| **Schema validators run before storage, with read access** | Balance checks and fee validation happen at the validator layer |
| **MessageData outputs are atomic** | Fee deduction and state change happen in the same transaction — no partial acceptance |
| **Program keys (`scheme://hostname`) route validation** | Token programs are just more entries in the schema table |
| **Peer replication is best-effort** | Fee accounting must tolerate temporarily inconsistent state across peers |
| **No global consensus** | There is no blockchain. Nodes validate locally against their schema. Cross-node consistency comes from replication, not consensus |
| **Content-addressed envelopes (`hash://sha256`)** are tamper-proof | Fee receipts stored as hashes are immutable audit trails |

---

## 3. Proposed URI Namespace for Token State

All token state lives in the same URI-addressed space as everything else:

```
gas://balances/{pubkey}                    → { balance: number, nonce: number }
gas://staking/{pubkey}                     → { amount: number, lockedUntil: number }
gas://pool/fees                            → { accumulated: number }
gas://pool/rewards                         → { distributed: number, epoch: number }
gas://rates                                → { write: number, read: number, store_per_kb: number, relay: number }
gas://receipts/{hash}                      → Receipt of fee payment (immutable)
```

These are just URIs. They're stored, read, listed, and replicated like any other B3nd data. The `gas://` scheme gets its own validators in the schema table.

---

## 4. Three Proposals

### Proposal A: "Gas-as-Output" (Minimal, Ethereum-inspired)

**Core idea:** Every write message must include a fee output in its `MessageData.payload.outputs`. The fee is validated atomically with the message content.

**How it works:**

```typescript
// User sends a message with a fee output
await send({
  auth: [{ pubkey: userKey, signature: "..." }],
  payload: {
    inputs: [],
    outputs: [
      // The actual content
      ["mutable://accounts/{userKey}/profile", { name: "Alice" }],
      // The fee — deducted atomically
      ["gas://debit/{userKey}/{nonce}", { amount: 150, nonce: 42 }],
    ],
  },
}, client);
```

**Schema validators:**

```typescript
const gasSchema: Schema = {
  // Fee debit: verify signature, check balance, deduct
  "gas://debit": async ({ uri, value, read }) => {
    const pubkey = extractPubkey(uri);
    const { amount, nonce } = value as { amount: number; nonce: number };

    const balance = await read(`gas://balances/${pubkey}`);
    if (!balance.success) return { valid: false, error: "No balance" };

    const current = balance.record.data as { balance: number; nonce: number };
    if (current.nonce !== nonce) return { valid: false, error: "Bad nonce" };
    if (current.balance < amount) return { valid: false, error: "Insufficient gas" };

    return { valid: true };
  },

  // Balance state: only writable by the gas system itself
  "gas://balances": async ({ uri, value }) => {
    // Only accept from internal debit/credit operations
    return { valid: true }; // guarded by composition
  },
};
```

**Fee calculation:**

```
fee = BASE_WRITE_FEE
    + (content_size_kb * STORAGE_RATE)
    + (output_count * OUTPUT_RATE)
    + (encryption ? ENCRYPTION_SURCHARGE : 0)  // debatable — see discussion
```

**Pros:**
- Fits perfectly into existing MessageData model — no new primitives
- Atomic fee deduction — can't write without paying
- Nonce prevents replay
- Fee receipts are content-addressed (tamper-proof)

**Cons:**
- Every message gets larger (fee output overhead)
- Fee calculation must be known client-side before sending
- Reads are unmetered (read spam is possible)
- No relay compensation — only the storing node benefits

---

### Proposal B: "Stake-and-Rate-Limit" (Holochain/SSB-inspired)

**Core idea:** Instead of per-message fees, accounts stake tokens to get a rate-limited message allowance. No tokens are spent on individual messages. Stake is only slashed for provable misbehavior.

**How it works:**

```
1. User stakes tokens:
   gas://staking/{pubkey} → { amount: 1000, lockedUntil: timestamp }

2. Stake determines rate limit:
   1000 tokens → 100 messages/hour, 10 MB/hour storage
   5000 tokens → 500 messages/hour, 50 MB/hour storage

3. Node tracks usage in local state (not replicated):
   Rate counter per pubkey, resets on window expiry

4. Messages within allowance are accepted without any fee output.
   Messages exceeding allowance are rejected: "Rate limit exceeded"
```

**Schema validators:**

```typescript
"mutable://accounts": async ({ uri, value, read }) => {
  const pubkey = extractPubkey(uri);

  // Auth check (existing)
  const authValid = await authValidation(createPubkeyBasedAccess())({ uri, value });
  if (!authValid) return { valid: false, error: "Auth failed" };

  // Rate limit check
  const stake = await read(`gas://staking/${pubkey}`);
  if (!stake.success) return { valid: false, error: "No stake — stake tokens first" };

  const allowance = computeAllowance(stake.record.data);
  const usage = getLocalUsageCounter(pubkey); // node-local, not replicated
  if (usage >= allowance.messagesPerHour) {
    return { valid: false, error: "Rate limit exceeded" };
  }

  return { valid: true };
},
```

**Slashing conditions:**
- Node downtime (for staked operators) — detected via missed heartbeats
- Serving incorrect data (detectable via hash verification)
- Censoring messages (harder to prove, requires dispute mechanism)

**Pros:**
- No per-message overhead — messages stay clean
- Predictable costs for users (stake once, use freely within limits)
- Natural Sybil resistance (staking is expensive)
- Rate limits are the primary spam defense
- Staked tokens are a velocity sink (locked capital)

**Cons:**
- Requires capital lockup — barrier to entry for new users
- Rate limits are node-local (different nodes may have different counters)
- No direct fee revenue for node operators (compensation comes from staking rewards/inflation)
- Free-tier problem: how do new users send their first message?
- Doesn't solve relay compensation

---

### Proposal C: "Dual-Layer" (Hybrid — recommended for further exploration)

**Core idea:** Combine per-message gas (Proposal A) for writes with stake-based access (Proposal B) for rate limits. Add a relay reward layer for cross-node message delivery.

**Three layers:**

#### Layer 1: Write Gas (per-message)

Every write includes a gas output (Proposal A), but the fee is small and predictable:

```
write_fee = base_fee(program_key) + size_fee(content_kb)
```

Base fees differ by program:
| Program | Base Fee | Rationale |
|---|---|---|
| `mutable://open` | 1 unit | Lowest — ephemeral public data |
| `mutable://accounts` | 2 units | Auth verification cost |
| `immutable://open` | 3 units | Permanent storage burden |
| `immutable://accounts` | 4 units | Permanent + auth |
| `hash://sha256` | 2 units | Content-addressed, deduplicated |
| `link://open` | 1 unit | Small pointer update |
| `link://accounts` | 2 units | Pointer + auth |

Size fee: `0.1 units per KB` (encourages small messages, large content goes to `hash://`)

#### Layer 2: Stake for Node Operators

Node operators stake tokens to join the network:

```
gas://staking/{nodeKey} → { amount: 10000, role: "operator", lockedUntil: ... }
```

Staked operators:
- Receive a share of accumulated write fees (proportional to stake)
- Get work allocation proportional to stake (more stake = more traffic routed to them)
- Are slashable for misbehavior (downtime, incorrect data, censorship)
- Must maintain heartbeats (`mutable://accounts/{nodeKey}/status`)

#### Layer 3: Relay Rewards

When a node relays a message to a peer (push replication), it earns a relay credit:

```
Message flow:
  1. User sends to Node A (pays write gas)
  2. Node A stores locally + pushes to Node B (peer)
  3. Node A records relay proof:
     gas://relay-proofs/{hash} → { from: nodeA, to: nodeB, msgHash, timestamp }
  4. At epoch end, relay proofs are tallied
  5. Relay rewards distributed from gas://pool/rewards
```

**Relay proof validation:** Node B can confirm it received the message by signing an acknowledgment. This creates a verifiable proof-of-relay without global consensus — just bilateral attestation between peers.

```typescript
// Node B acknowledges receipt
"gas://relay-acks": async ({ uri, value }) => {
  const { relayProofHash, receiverSignature } = value;
  // Verify receiver's signature over the relay proof hash
  const valid = await verify(receiverPubkey, receiverSignature, relayProofHash);
  return { valid };
},
```

#### Free-Tier Bootstrap

New users get a small initial balance through one of:

1. **Faucet program:** `gas://faucet/{pubkey}` — one-time claim, rate-limited by proof-of-work (Nostr NIP-13 style)
2. **Sponsor model:** An application or recipient pre-funds gas for their users (meta-transaction pattern)
3. **Invite vouching:** Existing staked accounts can vouch for new users, granting initial gas from a subsidy pool

```typescript
"gas://faucet": async ({ uri, value, read }) => {
  const pubkey = extractPubkey(uri);
  // Check this pubkey hasn't claimed before
  const existing = await read(`gas://faucet/${pubkey}`);
  if (existing.success) return { valid: false, error: "Already claimed" };
  // Require proof of work
  const { pow } = value as { pow: string };
  if (!verifyPow(pow, pubkey, MIN_DIFFICULTY)) {
    return { valid: false, error: "Insufficient proof of work" };
  }
  return { valid: true };
},
```

---

## 5. Token Economics

### Single Token: `B3ND` (or `GAS`)

A single token with multiple roles, using staking as velocity sink:

| Role | Mechanism |
|---|---|
| **Write fees** | Burned on each write (deflationary pressure from usage) |
| **Operator staking** | Locked for right to operate a node and earn fee share |
| **Relay rewards** | Minted/distributed from reward pool per epoch |
| **Governance** | Staked tokens vote on fee rates, reward distribution, slashing parameters |

### Fee Flow

```
User pays write fee (e.g., 3 units)
    ├── 60% burned (deflationary, benefits all holders)
    ├── 30% → gas://pool/fees (distributed to staked operators)
    └── 10% → gas://pool/rewards (distributed to relay nodes)
```

### Supply Dynamics

- **Initial supply:** Fixed at genesis
- **Inflation:** Small annual inflation (2-5%) to fund relay rewards and bootstrap subsidies
- **Burn:** All write fee burns reduce circulating supply
- **Equilibrium:** If usage grows, burns exceed inflation → deflationary. If usage stagnates, inflation dominates → mild inflationary (incentivizes operators to keep running)

### Adaptive Fee Pricing

Fees adjust based on network load, using metrics already collected by managed nodes:

```typescript
// Rate adjustment (runs at epoch boundaries)
"gas://rates": async ({ uri, value, read }) => {
  const metrics = await read(`gas://network/metrics`);
  const { avgWriteLatencyP99, errorRate, capacityUtilization } = metrics.record.data;

  // If network is congested (high latency, high utilization), increase base fees
  // If network is underutilized, decrease fees toward floor
  const adjustment = capacityUtilization > 0.8 ? 1.1 :
                     capacityUtilization < 0.3 ? 0.9 : 1.0;

  return { valid: true }; // rate update accepted
},
```

---

## 6. Storage Duration Tiers

Different programs naturally map to different storage economics:

| Tier | Programs | Duration | Pricing Model |
|---|---|---|---|
| **Ephemeral** | `mutable://open`, `mutable://inbox` | TTL-based (24h-30d) | Low per-write fee, auto-GC after TTL |
| **Durable** | `mutable://accounts`, `link://` | Indefinite but updatable | Per-write fee + small storage rent per epoch |
| **Permanent** | `immutable://`, `hash://sha256` | Forever | Higher per-write fee, no ongoing cost (endowment model) |

**Storage rent** for durable data prevents abandoned mutable URIs from consuming space forever:

```
gas://rent/{uri_hash} → { paidUntilEpoch: number, depositor: pubkey }
```

If rent expires, the data becomes eligible for garbage collection. The depositor can renew at any time. This is similar to Solana's rent-exempt model but with explicit epochs.

---

## 7. Read Economics

Reads are the hardest to price because they don't go through `receive()` — they're HTTP GETs.

### Option 1: Reads Are Free
- Simplest. Storage fees cover the cost. Nodes serve reads as a public good.
- Risk: Read amplification attacks (massive list queries, bandwidth exhaustion).
- Mitigation: Per-IP rate limiting at the HTTP layer (not protocol-level).

### Option 2: Read Tokens (API key model)
- Users present a signed read token with their request. The node decrements a local counter.
- No on-chain state change per read — just local accounting.
- Periodically settled: node submits batch read proofs to claim read fees from a pool.

### Option 3: Bandwidth Accounting (mutual credit)
- Each node tracks bandwidth exchanged with peers.
- Nodes that serve more reads than they consume accumulate credit.
- Credits are redeemable for tokens or used as reputation for priority access.
- Inspired by Holochain's mutual credit and BitTorrent's tit-for-tat.

**Recommendation:** Start with Option 1 (reads are free) with HTTP-layer rate limiting. Move to Option 2 if read abuse becomes a real problem. Option 3 is elegant but complex to implement correctly.

---

## 8. Implementation Roadmap

### Phase 0: Foundation (no token, schema-only)
- Add `gas://` program validators to the schema
- Implement balance, nonce, and rate-limit tracking
- Use "test tokens" (self-minted, no real value) for development
- **Deliverable:** A schema module that enforces gas semantics on any B3nd node

### Phase 1: Single-Node Gas
- Write fee enforcement on a single node
- Balance management (deposit, debit, check)
- Fee calculation and adaptive rates
- Free-tier faucet with PoW
- **Deliverable:** A B3nd node that charges for writes using internal test tokens

### Phase 2: Multi-Node Gas
- Replicate `gas://balances` across peers
- Handle eventual consistency (nonce conflicts, double-spend detection)
- Relay proof recording and acknowledgment
- Operator staking and slashing
- **Deliverable:** A network of nodes with consistent gas accounting

### Phase 3: Token Launch
- Fix supply and distribution
- Burn mechanism activation
- Reward distribution epochs
- Governance voting on fee parameters
- **Deliverable:** Live token with real economic incentives

---

## 9. Open Questions

1. **Encryption surcharge — yes or no?** Charging extra for encryption discourages privacy. But encrypted messages cost more to store (larger payloads) and can't be deduplicated. Recommendation: bundle encryption cost into base fee; don't itemize.

2. **Cross-node balance consistency.** Without global consensus, how do we prevent double-spending across nodes? Options: (a) nonce-per-node (each node tracks its own nonce for each account), (b) optimistic acceptance with retroactive slashing, (c) designated "home node" per account.

3. **Who sets fee rates?** Options: (a) protocol-fixed, (b) per-node (competitive market), (c) governance vote, (d) algorithmic (based on metrics). Recommendation: start with protocol-fixed rates, move to algorithmic.

4. **Relay proof gaming.** Two colluding nodes could fabricate relay proofs to farm rewards. Mitigation: relay rewards require the relayed message to actually exist at the destination (verifiable by any third party reading it).

5. **Storage rent UX.** Requiring users to pay ongoing rent for `mutable://accounts` data is hostile UX. Alternative: applications pay rent on behalf of users (sponsor model).

6. **Token distribution.** Who gets the initial supply? Options: operators who run nodes during bootstrap, early protocol contributors, public sale, airdrop to existing B3nd users.

---

## 10. Comparison with Existing Systems

| Aspect | B3nd Proposal C | Ethereum | Nostr | Filecoin | Holochain |
|---|---|---|---|---|---|
| **Write cost** | Small gas per message | High gas per tx | Free or relay-set | Storage deal | Free (mutual credit) |
| **Read cost** | Free (Phase 1) | Free (no state change) | Free | Per-byte retrieval | Free |
| **Spam defense** | Gas + PoW faucet + rate limits | Gas cost | Relay discretion | Storage cost | Rate limits |
| **Node incentives** | Stake + fee share + relay rewards | Staking yield + tips | Donations / paid relays | Storage mining | Mutual credit |
| **Consensus** | None (local validation) | Global (PoS) | None | Global (PoSt) | None (agent-centric) |
| **Storage model** | Tiered (ephemeral/durable/permanent) | Permanent (expensive) | Relay-dependent | Time-bounded deals | Agent-local |
| **Complexity** | Medium | High | Very Low | Very High | Medium |

---

## Appendix: How Gas Validators Compose with Existing Firecat Schema

The gas schema is *additive* — it extends the existing Firecat schema without modifying it:

```typescript
import firecatSchema from "./firecat-schema.ts";
import gasSchema from "./gas-schema.ts";

// Merge schemas — gas validators wrap existing ones
const networkSchema: Schema = {
  ...firecatSchema,
  ...gasSchema,

  // Override Firecat programs to add fee checking
  "mutable://accounts": async (ctx) => {
    // 1. Check gas fee output exists in the message
    const feeCheck = await validateGasFee(ctx);
    if (!feeCheck.valid) return feeCheck;

    // 2. Run original Firecat auth validation
    return firecatSchema["mutable://accounts"](ctx);
  },
};
```

This is the key architectural insight: **gas is just another schema concern**. It composes with authentication, content-addressing, and all other validators through the same `Schema` dispatch mechanism that already exists.

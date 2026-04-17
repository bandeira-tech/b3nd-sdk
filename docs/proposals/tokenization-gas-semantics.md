# B3nd Tokenization & Gas Semantics — Engineering Proposals

**Status:** Draft — Conceptual exploration for first-round discussion **Date:**
2026-02-24 **Context:** Decentralized message passing on B3nd

---

## 1. Problem Statement

B3nd currently has no economic layer. Nodes accept all valid messages for free.
This works for development and private deployments but creates three problems at
network scale:

1. **Spam** — No cost to write means no cost to abuse.
2. **Sustainability** — Node operators bear storage, bandwidth, and compute
   costs with no compensation.
3. **Relay incentives** — Peer replication (`parallelBroadcast` to push peers)
   has no reward mechanism; operators running `bestEffortClient` push peers are
   pure altruists.

The goal is to design gas/token semantics that fit _within_ B3nd's existing
architecture — not bolted on top, but expressed as **schema validators, URI
namespaces, and MessageData outputs** using the primitives that already exist.

---

## 2. Design Constraints (from the architecture)

These are non-negotiable properties of B3nd that any tokenization proposal must
respect:

| Constraint                                                         | Implication                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Message = `[uri, values, data]`**                                        | Gas must be expressible as messages, not a separate transport layer                                                                                                                                                                                                                                                                                                                    |
| **Schema validators run before storage, with read access**         | Balance checks and fee validation happen at the validator layer                                                                                                                                                                                                                                                                                                                        |
| **MessageData outputs are atomic**                                 | Fee deduction and state change happen in the same transaction — no partial acceptance                                                                                                                                                                                                                                                                                                  |
| **Program keys (`scheme://hostname`) route validation**            | Token programs are just more entries in the schema table                                                                                                                                                                                                                                                                                                                               |
| **Peer replication is best-effort**                                | Fee accounting must tolerate temporarily inconsistent state across peers                                                                                                                                                                                                                                                                                                               |
| **Consensus is designable via the protocol**                       | There is no built-in global consensus. But consensus mechanisms (checkpoint chains, validator agreements) can be designed using B3nd's own message primitives. This is a feature, not a limitation — different protocols can choose different consensus models                                                                                                                         |
| **Content-addressed envelopes (`hash://sha256`)** are tamper-proof | Fee receipts stored as hashes are immutable audit trails                                                                                                                                                                                                                                                                                                                               |
| **No network can guarantee censorship resistance**                 | Any node can choose to censor any message. Any infrastructure provider can restrict any node. The only guarantee of participation is running your own node. Everything else requires trust in the community or a contracted third party. This is true of every network — Bitcoin, Ethereum, Nostr, and B3nd alike. The protocol should be honest about this and design with it in mind |

---

## 3. Proposed URI Namespace for Token State (UTXO Model)

All token state lives in the same URI-addressed space as everything else.
Instead of mutable account balances, each token exists as a discrete, immutable
**unspent transaction output** (UTXO) — a pattern borrowed from Bitcoin that
maps naturally to B3nd's input/output message architecture.

### 3.1 Why UTXO, Not Account Balances

The account model (`gas://balances/{pubkey} → { balance: 500 }`) has a
fundamental problem: it's a mutable value that multiple parties might try to
update concurrently. In a network with eventual consistency, this creates
double-spend opportunities — a user reads their balance on Node A, spends it,
and before replication catches up, reads the same balance on Node B and spends
it again.

The UTXO model eliminates this. Each token unit is a discrete URI that can only
be consumed once. "Spending" means referencing an existing UTXO as an input and
creating new UTXOs as outputs. The validator checks: does this UTXO exist, and
has it already been consumed? This is a binary check, not a balance comparison —
much harder to race.

### 3.2 URI Namespace

```
gas://utxo/{hash}                          → { amount: number, owner: pubkey }
gas://staking/{pubkey}                     → { amount: number, lockedUntil: number, paths: string[] }
gas://rates                                → { write: number, store_per_kb: number, relay: number }
gas://receipts/{hash}                      → Confirmation receipt (immutable)
```

A user's "balance" is just the set of unspent `gas://utxo/*` URIs they own —
computed by reading, not stored as a single value.

### 3.3 How Spending Works

Spending gas uses MessageData's existing `inputs` and `outputs` fields:

```typescript
{
  auth: [{ pubkey: userKey, sig: "..." }],
  payload: {
    inputs: [
      "gas://utxo/{existingHash}",        // consuming a 100-unit UTXO
    ],
    outputs: [
      // Change back to user (new UTXO)
      ["gas://utxo/{changeHash}", { amount: 97, owner: userKey }],
      // Fee to protocol distribution
      ["gas://utxo/{feeHash}", { amount: 3, owner: "protocol://distribution" }],
      // The actual content this gas is paying for
      ["mutable://accounts/{userKey}/profile", { name: "Alice" }],
    ],
  },
}
```

The validator atomically verifies:

1. Input UTXO exists and is owned by a signer in `auth`
2. Input UTXO has not been consumed (not referenced as input in any confirmed
   message)
3. Output amounts ≤ input amounts (no token creation)
4. New UTXOs are created for change and fees

If any check fails, the entire message is rejected — no partial state changes.

### 3.4 Double-Spend Prevention

A UTXO is consumed when it appears as an input in a confirmed message
(referenced by a checkpoint). Two messages trying to consume the same UTXO are a
provable conflict — only the one confirmed first (in checkpoint order) is valid.
The second is rejected by any validator who has seen the first checkpoint.

Cross-node races: if two validators confirm the same UTXO consumption before
replicating, the conflict is detectable once checkpoints propagate. Resolution
follows the protocol's consensus rules for the `gas://utxo/*` partition (e.g.,
earlier timestamp wins, or the validator with more stake wins). The losing
transaction is rolled back — its outputs are invalid, and any messages that
depended on those outputs are also invalidated.

This is not perfect. But it is:

- **Detectable**: conflicts are provable by comparing checkpoint chains
- **Attributable**: the conflicting validators are identifiable
- **Recoverable**: only the conflicting transaction needs rollback, not the
  whole chain
- **Honest**: we acknowledge this window exists rather than pretending it
  doesn't

---

## 4. Three Proposals

### Proposal A: "Gas-as-UTXO" (Bitcoin-inspired, fits B3nd's input/output model)

**Core idea:** Every write message consumes gas UTXOs as inputs and creates new
UTXOs as outputs (change + fee). The fee is validated atomically with the
message content.

**How it works:**

```typescript
// User sends a message, consuming a gas UTXO to pay the fee
await send({
  auth: [{ pubkey: userKey, signature: "..." }],
  payload: {
    inputs: [
      "gas://utxo/{existingUtxoHash}", // consuming a 100-unit UTXO
    ],
    outputs: [
      // The actual content
      ["mutable://accounts/{userKey}/profile", { name: "Alice" }],
      // Change back to user
      ["gas://utxo/{changeHash}", { amount: 97, owner: userKey }],
      // Fee to protocol distribution
      ["gas://utxo/{feeHash}", { amount: 3, owner: "protocol://distribution" }],
    ],
  },
}, client);
```

**Schema validators:**

```typescript
const gasSchema: Schema = {
  // UTXO consumption: verify ownership, check unspent, validate amounts
  "gas://utxo": async ({ uri, value, read, inputs }) => {
    const utxoData = value as { amount: number; owner: string };

    // If this URI appears as an OUTPUT → creating a new UTXO (always valid if amounts balance)
    // If this URI appears as an INPUT → consuming an existing UTXO:
    if (inputs?.includes(uri)) {
      // 1. Verify the UTXO exists
      const existing = await read(uri);
      if (!existing.success) {
        return { valid: false, error: "UTXO does not exist" };
      }

      // 2. Verify the signer owns it
      const owner = (existing.record.data as { owner: string }).owner;
      // (ownership verified against auth signatures in the message)

      // 3. Verify it hasn't been consumed in any confirmed checkpoint
      // (this check is the core double-spend prevention)
    }

    return { valid: true };
  },
};
```

**Fee calculation:**

```
fee = BASE_WRITE_FEE
    + (content_size_kb * STORAGE_RATE)
    + (output_count * OUTPUT_RATE)
```

**Pros:**

- Maps directly to MessageData's existing inputs/outputs — no new primitives
- Atomic: UTXO consumption + content storage happen together or not at all
- Double-spend prevention: a UTXO can only be consumed once (binary check)
- No mutable balance state to race against
- Fee UTXOs are content-addressed (tamper-proof audit trail)

**Cons:**

- UTXO set grows over time (many small change UTXOs)
- Client must track their unspent UTXOs to construct transactions
- Fee calculation must be known client-side before sending
- Reads are unmetered (read spam is possible)
- No relay compensation — only the storing node benefits

---

### Proposal B: "Stake-and-Rate-Limit" (Holochain/SSB-inspired)

**Core idea:** Instead of per-message fees, accounts stake tokens to get a
rate-limited message allowance. No tokens are spent on individual messages.
Stake is only slashed for provable misbehavior.

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
- No direct fee revenue for node operators (compensation comes from staking
  rewards/inflation)
- Free-tier problem: how do new users send their first message?
- Doesn't solve relay compensation

---

### Proposal C: "Dual-Layer" (Hybrid — recommended for further exploration)

**Core idea:** Combine per-message gas (Proposal A) for writes with stake-based
access (Proposal B) for rate limits. Add a relay reward layer for cross-node
message delivery.

**Three layers:**

#### Layer 1: Write Gas (per-message)

Every write includes a gas output (Proposal A), but the fee is small and
predictable:

```
write_fee = base_fee(program_key) + size_fee(content_kb)
```

Base fees differ by program:

| Program                | Base Fee | Rationale                       |
| ---------------------- | -------- | ------------------------------- |
| `mutable://open`       | 1 unit   | Lowest — ephemeral public data  |
| `mutable://accounts`   | 2 units  | Auth verification cost          |
| `immutable://open`     | 3 units  | Permanent storage burden        |
| `immutable://accounts` | 4 units  | Permanent + auth                |
| `hash://sha256`        | 2 units  | Content-addressed, deduplicated |
| `link://open`          | 1 unit   | Small pointer update            |
| `link://accounts`      | 2 units  | Pointer + auth                  |

Size fee: `0.1 units per KB` (encourages small messages, large content goes to
`hash://`)

#### Layer 2: Stake for Node Operators

Node operators stake tokens to join the network:

```
gas://staking/{nodeKey} → { amount: 10000, role: "operator", lockedUntil: ... }
```

Staked operators:

- Receive a share of accumulated write fees (proportional to stake)
- Get work allocation proportional to stake (more stake = more traffic routed to
  them)
- Are slashable for misbehavior (downtime, incorrect data, censorship)
- Must maintain heartbeats (`mutable://accounts/{nodeKey}/status`)

#### Layer 3: Relay Rewards

When a node relays a message to a peer (push replication), it earns a relay
credit:

```
Message flow:
  1. User sends to Node A (pays write gas)
  2. Node A stores locally + pushes to Node B (peer)
  3. Node A records relay proof:
     gas://relay-proofs/{hash} → { from: nodeA, to: nodeB, msgHash, timestamp }
  4. At epoch end, relay proofs are tallied
  5. Relay rewards distributed from gas://pool/rewards
```

**Relay proof validation:** Node B can confirm it received the message by
signing an acknowledgment. This creates a verifiable proof-of-relay without
global consensus — just bilateral attestation between peers.

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

1. **Faucet program:** `gas://faucet/{pubkey}` — one-time claim, rate-limited by
   proof-of-work (Nostr NIP-13 style)
2. **Sponsor model:** An application or recipient pre-funds gas for their users
   (meta-transaction pattern)
3. **Invite vouching:** Existing staked accounts can vouch for new users,
   granting initial gas from a subsidy pool

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

### Design Principles

The token must optimize for **flow and usage**, not for price appreciation. The
goal is a growing, inclusive network — not an asset that enriches early
operators at the expense of later participants. Specifically:

1. **Anti-whale capture**: Diminishing returns on stake size. A node operator
   with 100x more stake should NOT earn 100x more. The network must be more
   attractive for a growing base of casual supporters than for an established
   elite.
2. **Optimize for circulation**: Tokens should move through the economy, not sit
   in wallets. The network's value comes from message flow, not token scarcity.
3. **Minimal burning**: Burning creates deflationary pressure that benefits
   holders over users. It drives up the cost of adoption over time. If burning
   exists at all, it should be small and purpose-driven (e.g., spam deterrence),
   not a core value-capture mechanism.
4. **Stable costs**: Users and sponsors should experience predictable gas costs
   regardless of token market dynamics.

### Single Token: `FCAT`

| Role                   | Mechanism                                                                     |
| ---------------------- | ----------------------------------------------------------------------------- |
| **Gas (write fees)**   | Spent as UTXO inputs on writes; flows to operators and the network            |
| **Operator staking**   | Locked for right to validate + earn fee share; subject to diminishing returns |
| **Medium of exchange** | In-network payments (ad spend, user rewards, app purchases)                   |
| **Governance**         | Staked tokens vote on fee rates, reward distribution, slashing parameters     |

### Fee Flow (UTXO-based)

When a user (or sponsor) pays gas, the fee UTXO is created with
`owner: "protocol://distribution"`. At epoch boundaries, protocol distribution
UTXOs are split among participants:

```
User pays write fee (e.g., 3 units via UTXO)
    ├── 70% → validator/operator pool (the nodes doing the work)
    ├── 20% → relay pool (nodes replicating to peers)
    └── 10% → foundation/community pool (development, grants, subsidies)
```

No tokens are burned. All fees circulate back into the economy. The network's
economic health is measured by throughput (messages/second, active users) not by
token price.

### Anti-Whale Distribution

Operator rewards use a **square-root weighting** to favor breadth over depth:

```
reward_share(operator) = sqrt(stake) / sum(sqrt(all_stakes))

Example with three operators:
  Operator A: stakes 100   → weight sqrt(100)  = 10
  Operator B: stakes 10000 → weight sqrt(10000) = 100
  Operator C: stakes 25    → weight sqrt(25)    = 5

  Total weight = 115
  A gets: 10/115 = 8.7% of rewards (staked 0.99% of total)
  B gets: 100/115 = 87.0% of rewards (staked 98.8% of total)
  C gets: 5/115 = 4.3% of rewards (staked 0.25% of total)

  B has 100x A's stake but gets only 10x A's reward.
  C with a tiny stake still earns meaningful income.
```

This means:

- Small operators (home servers, phones) get proportionally higher returns per
  unit staked
- Large operators face diminishing marginal returns — whaling is unprofitable
- The most efficient strategy is to support MANY small operators, not one large
  one
- Network resilience improves because more independent operators are
  incentivized

### Supply Dynamics

- **Initial supply:** Fixed at genesis
- **No burning** (or minimal: a small protocol-level spam deterrent, <1% of
  fees, adjustable by governance)
- **Low inflation** (1-3%) to fund relay rewards and early-stage subsidies —
  decreasing over time as fee revenue grows
- **Equilibrium:** The token's value is backed by the network's utility (message
  throughput, storage, ad revenue), not by artificial scarcity. If usage grows,
  demand for gas grows, supporting token value through organic utility demand.

### Adaptive Fee Pricing

Gas costs are denominated in **units** (not in FCAT). The protocol adjusts the
FCAT-per-unit rate to maintain stable real-world costs:

```
If FCAT doubles in market price → gas costs half as many FCAT per unit
If FCAT halves → gas costs double in FCAT terms

Users/sponsors always experience: "a message costs ~€0.0001 to send"
regardless of what FCAT is doing on the market.
```

Rate adjustments happen at epoch boundaries based on network metrics:

```typescript
"gas://rates": async ({ uri, value, read }) => {
  const metrics = await read(`gas://network/metrics`);
  const { capacityUtilization } = metrics.record.data;

  // Congested → fees rise (discourages spam, incentivizes capacity)
  // Underutilized → fees fall toward floor (encourages usage)
  const adjustment = capacityUtilization > 0.8 ? 1.1 :
                     capacityUtilization < 0.3 ? 0.9 : 1.0;

  return { valid: true };
},
```

---

## 6. Storage Duration and Durability Honesty

### 6.1 What Can Actually Be Promised

No network — centralized or decentralized — can guarantee that data persists
forever. A cloud provider can go bankrupt. A blockchain can fork. Nodes can go
offline. Infrastructure providers can be pressured to delete data. This is true
of AWS, Filecoin, Bitcoin, and B3nd alike.

The honest framing of storage durability:

| Guarantee level | What it means                                                                | Who provides it                   |
| --------------- | ---------------------------------------------------------------------------- | --------------------------------- |
| **Self-hosted** | You run a node, you have the data                                            | The user themselves               |
| **Contracted**  | A paid operator commits to storing your data (SLA)                           | A node operator or the foundation |
| **Community**   | Data persists because the network is healthy and nodes replicate voluntarily | The network community             |
| **None**        | Data may or may not persist. No one is obligated to store it.                | Default for unsponsored data      |

The foundation's primary role is to ensure the network remains **sustainable
enough to run** — at minimum by operating its own nodes as a last-resort
persistence layer. But the foundation is one operator among many. If the
foundation disappears, the data persists on other nodes. If all nodes disappear,
the data is gone — and no protocol design can prevent that.

### 6.2 Storage Tiers (by write-time economics)

Different programs naturally map to different storage economics at the time of
writing:

| Tier          | Programs                            | Duration intent              | Write-time pricing                                                              |
| ------------- | ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| **Ephemeral** | `mutable://open`, `mutable://inbox` | TTL-based (24h-30d)          | Lowest gas per write                                                            |
| **Durable**   | `mutable://accounts`, `link://`     | Indefinite but updatable     | Moderate gas per write                                                          |
| **Permanent** | `immutable://`, `hash://sha256`     | Content-addressed, immutable | Higher gas per write (endowment model — one-time cost covers long-term storage) |

### 6.3 Why Not Storage Rent

Storage rent — charging ongoing fees for keeping data alive — sounds fair in
theory but has problems in practice:

- If a user stops paying rent (leaves the platform, loses keys, sponsoring app
  dies), their data gets garbage collected. This contradicts any claim of user
  sovereignty.
- Rent creates a recurring cost that someone must perpetually manage. This is
  the exact dependency on ongoing payment that decentralization is supposed to
  eliminate.
- If nodes go offline, it doesn't matter that rent has been "paid" — the rent
  money is in the network but the data isn't.
- Rent payment enforcement requires the gas partition validators to track
  time-based state, adding complexity for questionable benefit.

**Alternative approach:** Higher one-time write fees for durable/permanent
storage tiers (endowment model). The write fee accounts for expected storage
duration. Ephemeral data is cheap because it's expected to be short-lived.
Permanent data costs more because it's a long-term commitment. But once written
and confirmed, data persists as long as the node storing it remains online — no
ongoing payments needed.

Garbage collection for abandoned data happens naturally: nodes can choose to
prune URIs that have no reads, no references, and no economic activity for
extended periods. This is a node operator decision, not a protocol enforcement —
similar to how Nostr relays choose their own retention policies.

---

## 7. Read Economics

Reads are the hardest to price because they don't go through `receive()` —
they're HTTP GETs.

### Option 1: Reads Are Free

- Simplest. Storage fees cover the cost. Nodes serve reads as a public good.
- Risk: Read amplification attacks (massive list queries, bandwidth exhaustion).
- Mitigation: Per-IP rate limiting at the HTTP layer (not protocol-level).

### Option 2: Read Tokens (API key model)

- Users present a signed read token with their request. The node decrements a
  local counter.
- No on-chain state change per read — just local accounting.
- Periodically settled: node submits batch read proofs to claim read fees from a
  pool.

### Option 3: Bandwidth Accounting (mutual credit)

- Each node tracks bandwidth exchanged with peers.
- Nodes that serve more reads than they consume accumulate credit.
- Credits are redeemable for tokens or used as reputation for priority access.
- Inspired by Holochain's mutual credit and BitTorrent's tit-for-tat.

**Recommendation:** Start with Option 1 (reads are free) with HTTP-layer rate
limiting. Move to Option 2 if read abuse becomes a real problem. Option 3 is
elegant but complex to implement correctly.

---

## 8. Confirmation, Checkpoints, and the Emergent Mempool

### 8.1 The Key Insight: Confirmation Is Just More Messages

There is no special "mempool" construct, no confirmation API, no new
infrastructure. What emerges naturally from the existing primitives is this:

A protocol defines — through convention — which URIs represent **confirmed
state**. A checkpoint program writes messages like
`confirmation://checkpoints/{validatorKey}/{sequence}` that reference other
message hashes. The communal expectation across the network is that **messages
referenced by confirmation URIs are the canonical state** — everything else is
pending, in-flight, unconfirmed.

This is not a new system. It's the natural consequence of a shared data layer
where participants agree on what "confirmed" means by pointing at URIs.

```
Any message on the network:
  mutable://accounts/{userKey}/posts/draft-1  →  { text: "Hello world" }

Is this confirmed? Check the confirmation chain:
  confirmation://checkpoints/{validatorKey}/10042
    → {
        previousCheckpoint: "hash://sha256/{prevHash}",
        messages: ["hash://sha256/{msgHash1}", "hash://sha256/{msgHash2}", ...],
        timestamp: ...
      }

If the message's hash appears in a checkpoint → confirmed.
If not → it exists on the network, but the protocol convention treats it as pending.
```

The "mempool" is just the set of messages that exist but aren't yet referenced
by any confirmation checkpoint. There's no special storage, no separate
endpoint, no TTL mechanism. Messages are messages. Some have been confirmed.
Some haven't. The protocol defines what that means.

### 8.2 Why This Matters for Gas

The node has to accept the HTTP request and parse the message before it can do
anything with it. That inbound cost is unavoidable. This means gas can't prevent
receiving messages — it can only determine what gets **confirmed**.

A message without gas payment can still arrive and be stored — it's a valid B3nd
message at the transport level. But it won't appear in any confirmation
checkpoint until gas is accounted for. The protocol programs that write
confirmation checkpoints require gas outputs. No gas → no confirmation → the
message exists but isn't treated as canonical by any participant following the
protocol.

This is exactly how things should work: the HTTP layer accepts everything
(because it has to), and the protocol layer — through its own messages —
determines what's real.

**Note on HTTP-layer DoS:** Flooding a node with garbage HTTP requests is an
infrastructure-level attack, not a protocol-level concern. Every service
connected to the internet has this attack surface — web servers, API endpoints,
Bitcoin nodes, Ethereum RPCs. Mitigation happens at the infrastructure layer
(rate limiting, CDNs, IP filtering, load balancing) not at the protocol layer.
B3nd nodes are no more or less vulnerable to this than any other HTTP service.
The gas system addresses **protocol-level spam** (valid messages that waste
confirmed storage), not transport-level abuse.

### 8.3 Partial Messages and Sponsor Assembly

Because confirmation is a protocol-level convention (not a system-level gate),
multi-party message assembly happens naturally:

```
Step 1: User writes a partial message (normal receive())
  mutable://accounts/{userKey}/pending/draft-1
    → {
        content: { text: "Hello world" },
        auth: [{ pubkey: userKey, sig: userSig }],
        // No gas payment — user can't or doesn't want to pay
      }

  This is a real message, stored on the network. But no confirmation
  checkpoint will reference it because it has no gas output.

Step 2: Sponsor discovers the pending message (normal read())
  A listener node, custodial service, or ad provider reads pending messages.
  They evaluate:
    - User's reputation (read attestation://services/{verifier}/users/{userKey})
    - Campaign match (read ad://campaigns/{advertiserKey}/{campaignId})
    - Whether to sponsor this user's message

Step 3: Sponsor creates the confirmation message (normal receive())
  The sponsor writes a new message that bundles the gas payment (UTXO)
  with a reference to the user's content:

  confirmation://sponsored/{sponsorKey}/{nonce}
    → {
        auth: [{ pubkey: sponsorKey, sig: sponsorSig }],
        payload: {
          inputs: [
            "gas://utxo/{sponsorUtxoHash}",  // sponsor consumes their UTXO
          ],
          outputs: [
            // Reference the user's content (already stored)
            ["link://accounts/{userKey}/posts/latest", "hash://sha256/{contentHash}"],
            // Gas fee to protocol
            ["gas://utxo/{feeHash}", { amount: 3, owner: "protocol://distribution" }],
            // Change back to sponsor
            ["gas://utxo/{changeHash}", { amount: 97, owner: sponsorKey }],
          ]
        }
      }

Step 4: Validator includes both in the next checkpoint (normal receive())
  confirmation://checkpoints/{validatorKey}/10043
    → {
        previousCheckpoint: "hash://sha256/{prevCheckpointHash}",
        messages: [..., "hash://sha256/{sponsoredMsgHash}"],
        timestamp: ...
      }
```

Every step is `receive()` and `read()`. Every artifact is a URI. The sponsor
flow, the pending state, the confirmation — all are just messages that reference
other messages. The protocol schema defines what's valid at each step.

### 8.4 Checkpoints as Hash Chains

Each confirmation checkpoint references the previous one, creating a
tamper-proof sequence:

```
confirmation://checkpoints/{validatorKey}/1
  → { previous: null, messages: [...], timestamp: T1 }

confirmation://checkpoints/{validatorKey}/2
  → { previous: "hash://sha256/{cp1Hash}", messages: [...], timestamp: T2 }

confirmation://checkpoints/{validatorKey}/3
  → { previous: "hash://sha256/{cp2Hash}", messages: [...], timestamp: T3 }
```

Properties:

- **Sequence proof**: checkpoint N references checkpoint N-1's hash → ordering
  is provable
- **Tamper detection**: altering a past checkpoint breaks all subsequent hashes
- **Validator accountability**: each checkpoint is signed by the validator's key
  → attributable
- **Consensus is designable**: each validator maintains their own chain.
  Multiple validators can have different chains. The protocol defines
  reconciliation rules — this IS a consensus mechanism, designed using B3nd's
  own primitives rather than built into the infrastructure layer. Different
  protocols on B3nd can choose different consensus models (e.g.,
  single-validator authority, multi-validator quorum, stake-weighted priority)
  depending on their trust requirements

This forces validators to keep data. To produce checkpoint N, you need
checkpoint N-1's hash, which means you need the actual data. A validator that
loses their state can't continue their checkpoint chain — which is an
observable, slashable failure.

### 8.5 Stratified Validation

Not every validator needs to confirm every URI. Validators can specialize in
path subsets:

```
Validator A stakes for: mutable://accounts/a* through mutable://accounts/m*
Validator B stakes for: mutable://accounts/n* through mutable://accounts/z*
Validator C stakes for: immutable://open/*
Validator D stakes for: gas://* (the gas ledger itself)
```

Each validator produces checkpoints only for their partition. Their staking
declaration is a message:

```
gas://staking/{nodeKey}
  → {
      amount: 10000,
      validationPaths: ["mutable://accounts/a*-m*", "hash://sha256/*"],
      checkpointFrequency: 100,
      lockedUntil: ...
    }
```

Cross-partition references work naturally — validators `read()` from peers for
data outside their partition, exactly as B3nd validators already do with
cross-program access.

The staking + path commitment + checkpoint chain together mean: **a validator
proves they're doing work by producing an unbroken hash chain for their declared
URI paths**. Gaps, invalid hashes, or missing checkpoints are observable and
slashable.

### 8.6 Trust Boundaries

The phased nature creates clear trust stratification — not through special APIs
but through the protocol's own conventions about which URIs matter:

| What happens                               | Trust level | Who participates                             | Cost                         |
| ------------------------------------------ | ----------- | -------------------------------------------- | ---------------------------- |
| Writing a message to the network           | Minimal     | Any client, any node                         | HTTP overhead (unavoidable)  |
| Reading pending messages, evaluating users | Low         | Sponsors, listener nodes, custodial services | Normal reads                 |
| Assembling sponsored messages with gas     | Medium      | Sponsors, ad providers                       | Sponsor's gas payment        |
| Writing confirmation checkpoints           | High        | Staked validators                            | Validator's operational cost |
| Replicating confirmed state                | Medium      | Peer nodes                                   | Relay rewards                |

**Client-side (minimal trust):** Creating and signing messages, submitting them,
reading confirmations. The client doesn't need to trust anyone — they can verify
the checkpoint hash chain themselves.

**Node-mediated (higher trust):** Producing checkpoints, maintaining hash
chains, validating gas outputs. This is where the economic incentives (staking,
slashing, gas revenue) create accountability.

The entire spectrum runs on the same primitives: `receive()` to write messages,
`read()` to read them, schemas to validate them. The economic layer, the
confirmation layer, the reputation layer — they're all just protocol programs
writing messages at agreed-upon URIs.

---

## 9. Implementation Roadmap

### Phase 0: Foundation (no token, schema-only)

- Add `gas://utxo` program validators to the schema
- Implement UTXO creation, consumption, and validation
- Use "test tokens" (self-minted UTXOs, no real value) for development
- Define `confirmation://` checkpoint schema and convention
- **Deliverable:** A schema module that enforces UTXO gas semantics on any B3nd
  node

### Phase 1: Single-Node Gas + Checkpoints

- Write fee enforcement via UTXO consumption on a single node
- UTXO tracking (unspent set, consumption detection)
- Fee calculation and adaptive rates
- Confirmation checkpoint chain (single validator)
- Free-tier faucet with PoW
- Sponsor flow: partial messages + UTXO attachment
- **Deliverable:** A B3nd node with UTXO-based gas, checkpoint hash chains, and
  sponsor assembly — using test tokens

### Phase 2: Multi-Node Gas

- Replicate gas UTXOs and checkpoints across peers
- Cross-node UTXO consumption detection (checkpoint comparison)
- Relay proof recording and acknowledgment
- Operator staking with sqrt-weighted rewards
- Stratified validation (validators declare URI path ranges)
- **Deliverable:** A network of nodes with UTXO-based gas accounting and
  designable consensus

### Phase 3: Token Launch

- Fix supply and distribution
- Reward distribution epochs (sqrt-weighted, anti-whale)
- Token withdrawal mechanics (cliff, threshold, gradual disbursement)
- Governance voting on fee parameters
- **Deliverable:** Live token with flow-optimized economic incentives

---

## 10. Open Questions

1. **Encryption surcharge — yes or no?** Charging extra for encryption
   discourages privacy. But encrypted messages cost more to store (larger
   payloads) and can't be deduplicated. Recommendation: bundle encryption cost
   into base fee; don't itemize.

2. **UTXO set growth.** As tokens circulate, the number of small change UTXOs
   grows. This is a known Bitcoin problem. Mitigations: (a) UTXO consolidation
   messages (merge many small UTXOs into one, paying a small fee), (b)
   protocol-level minimum UTXO size, (c) periodic UTXO set snapshots that
   compress the state. This is a performance concern, not a correctness concern.

3. **Who sets fee rates?** Options: (a) protocol-fixed, (b) per-node
   (competitive market), (c) governance vote, (d) algorithmic (based on
   metrics). Recommendation: start with protocol-fixed rates, move to
   algorithmic.

4. **Relay reward design.** Colluding nodes can create messages and relay them
   between themselves to farm rewards. Pure relay proofs are gameable. But relay
   gaming has natural limits: it requires real gas to create messages (UTXO
   consumption), real work to maintain checkpoint chains, and real storage over
   time. The deterrence comes from the cost structure — farming rewards should
   never be more profitable than the gas spent to create the messages being
   relayed. Beyond that, nodes are incentivized to relay real messages
   regardless, because a healthy network with real traffic is what makes their
   validation work valuable. The sweet spot is making relay rewards a bonus on
   top of validation revenue, not a standalone income source.

5. **Storage durability guarantees.** See Section 6. No network — centralized or
   decentralized — can guarantee data persists forever. The honest framing: data
   persists as long as (a) at least one node stores it, and (b) the network
   remains sustainable enough to operate. The foundation's role is to be the
   last-resort persistence layer, not the only one.

6. **Token distribution.** Who gets the initial supply? Options: operators who
   run nodes during bootstrap, early protocol contributors, public sale, airdrop
   to existing B3nd users.

7. **Consensus model for the gas partition.** The `gas://utxo/*` URI space is
   the most critical partition — it determines who has tokens. The protocol's
   consensus rules for this partition need to be explicit and robust. Options:
   (a) single designated validator for gas (simple but centralized), (b)
   multi-validator quorum (more resilient but slower), (c) any validator can
   confirm gas UTXOs within their path range. This is the most important open
   design decision.

---

## 11. Comparison with Existing Systems

| Aspect                    | B3nd (UTXO gas)                                     | Ethereum                                    | Nostr                   | Filecoin                | Holochain            |
| ------------------------- | --------------------------------------------------- | ------------------------------------------- | ----------------------- | ----------------------- | -------------------- |
| **Write cost**            | Small gas per message (UTXO)                        | High gas per tx                             | Free or relay-set       | Storage deal            | Free (mutual credit) |
| **Read cost**             | Free                                                | Free (no state change)                      | Free                    | Per-byte retrieval      | Free                 |
| **Token model**           | UTXO (like Bitcoin)                                 | Account-based                               | None (zaps optional)    | Account-based           | None (mutual credit) |
| **Spam defense**          | Gas + PoW faucet + rate limits                      | Gas cost                                    | Relay discretion        | Storage cost            | Rate limits          |
| **Node incentives**       | Stake (sqrt-weighted) + fee share + relay bonus     | Staking yield + tips                        | Donations / paid relays | Storage mining          | Mutual credit        |
| **Consensus**             | Protocol-designable (checkpoint chains)             | Global (PoS)                                | None                    | Global (PoSt)           | None (agent-centric) |
| **Storage model**         | Tiered (ephemeral/durable/permanent)                | Permanent (expensive)                       | Relay-dependent         | Time-bounded deals      | Agent-local          |
| **Censorship resistance** | Honest: none guaranteed. Run a node for sovereignty | Economic: prohibitively expensive to censor | Relay discretion        | Economic: storage deals | Agent sovereignty    |
| **Complexity**            | Medium                                              | High                                        | Very Low                | Very High               | Medium               |

---

## Appendix: How Gas Validators Compose with an Existing Schema

The gas schema is _additive_ — it extends an existing protocol schema without
modifying it:

```typescript
import baseSchema from "./protocol-schema.ts";
import gasSchema from "./gas-schema.ts";

// Merge schemas — gas validators wrap existing ones
const networkSchema: Schema = {
  ...baseSchema,
  ...gasSchema,

  // Override base programs to add fee checking
  "mutable://accounts": async (ctx) => {
    // 1. Check gas fee output exists in the message
    const feeCheck = await validateGasFee(ctx);
    if (!feeCheck.valid) return feeCheck;

    // 2. Run original auth validation
    return baseSchema["mutable://accounts"](ctx);
  },
};
```

This is the key architectural insight: **gas is just another schema concern**.
It composes with authentication, content-addressing, and all other validators
through the same `Schema` dispatch mechanism that already exists.

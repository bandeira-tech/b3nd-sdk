# Token Movement — Layers, Options, and Engagement Patterns

**Status:** Draft — Design exploration based on adversarial analysis **Date:**
2026-02-25 **Companion:** See `tokenization-gas-semantics.md` for UTXO gas
model

---

## 1. Framing

Token movement between external chains (Solana, Ethereum) and B3nd is not a
bridge in the traditional sense. There is no single contract, no privileged
operator, no lock-and-mint mechanism.

Instead, it is a **pattern** — a set of layered behaviors where different
participants, each with their own incentives, interact through B3nd's existing
message primitives. Transaction references on external chains become URIs on
B3nd. Interested parties verify those references and respond with new messages.
Markets emerge from these interactions.

This document describes the layers involved, the options at each layer, and the
patterns of engagement between them.

---

## 2. The Layers

```
Layer 5: Withdrawal Market
         Bilateral trades, multi-token settlement, withdrawal providers

Layer 4: Network Fund (Root)
         Fee collection, validator rewards, bridge market participation

Layer 3: B3nd Native Economy
         Preminted supply, protocol locks, gas fees, validation

Layer 2: The Bridge Pattern
         Transaction references as URIs, verification, deposit market

Layer 1: External Chain Tokens
         FCAT, xFCAT, AMM peg, Solana/Ethereum markets
```

Each layer has its own design space. The layers interact but don't depend on
specific choices at other layers — different options compose freely.

---

## 3. Layer 1: External Chain Tokens

### 3.1 Two Tokens, One Peg

At TGE, two tokens are minted on Solana (and optionally Ethereum):

| Token     | Role                                                                   | Supply           | Behavior                                                  |
| --------- | ---------------------------------------------------------------------- | ---------------- | --------------------------------------------------------- |
| **FCAT**  | Primary market token. What people buy, hold, trade. The deposit token. | Preminted, fixed | Circulates on DEXes. Deposited into bridge.               |
| **xFCAT** | Shadow token. An IOU for FCAT. The withdrawal-side market token.       | Preminted, fixed | Circulates on DEXes. Exchangeable for FCAT at bridge AMM. |

Both tokens are Solana-native SPL tokens. Neither is minted by B3nd events. Both
are fully preminted at genesis.

### 3.2 The Bridge AMM

A Solana program (or DEX liquidity position) maintains the FCAT/xFCAT peg:

```
Bridge AMM pool:
  deposit(FCAT)    → lock FCAT in pool
  exchange(xFCAT)  → pool receives xFCAT, releases FCAT
  exchange(FCAT)   → pool receives FCAT, releases xFCAT
```

The pool is bidirectional. No tokens are burned. xFCAT received by the pool
stays in the pool, available for future swaps. The pool gets deeper over time as
more swaps flow through it.

**Key properties:**

- **AMM curve** (concentrated liquidity, constant-product, or similar) — not a
  flat 1:1 swap. This means large swaps pay slippage, which defends against
  manipulation.
- **Fees on every swap** — small percentage captured by the pool/protocol. This
  prevents free abuse and accumulates value over time.
- **The pool never empties** — AMM curves approach zero but never reach it.
  There is always some liquidity on both sides.
- **Arbitrage maintains the peg** — if xFCAT trades below FCAT on a DEX,
  arbitrageurs buy cheap xFCAT, exchange at the bridge AMM for FCAT, pocket the
  difference. This tightens the peg automatically.

### 3.3 Why xFCAT Exists

The problem xFCAT solves: when FCAT is deposited into B3nd, it leaves the Solana
market. If deposits are one-way, Solana liquidity depletes over time. xFCAT is
the **shadow supply** — a liquid asset on Solana that maintains market depth
even as FCAT flows into B3nd.

Total Solana-side liquidity = FCAT circulating + xFCAT circulating. Depositing
FCAT shifts weight from FCAT to xFCAT (via bridge AMM exchanges), but doesn't
drain total liquidity.

### 3.4 Supply Conservation

At any moment across the system:

```
FCAT circulating on Solana + FCAT in bridge AMM pool = FCAT total (constant)
xFCAT circulating on Solana + xFCAT in bridge AMM pool = xFCAT total (constant)
Neither token is ever created or destroyed after TGE.
```

---

## 4. Layer 2: The Bridge Pattern

### 4.1 Transaction References, Not Bridge Contracts

There is no `bridge://` URI. There is no privileged bridge operator. A deposit
is simply a B3nd message that references an external chain transaction:

```
solana://tx/{signature}
ethereum://tx/{hash}
```

This is a URI like any other on B3nd. It references something that happened on
another chain. Anyone on B3nd who cares can verify it.

### 4.2 The Deposit Flow

```
Step 1: User sends FCAT to a known deposit address on Solana
        (this address is a simple, open-source, verifiable program)

Step 2: User (or their app) creates a B3nd message:
        solana://tx/{txSignature}
          → { chain: "solana", amount: 1000, depositor: userPubkey, ... }

Step 3: Any interested party on B3nd can verify this:
        - Read the Solana chain (RPC call)
        - Confirm the transaction exists, is finalized, sent correct amount
        - Respond with a new message completing the deposit

Step 4: A verifier responds:
        gas://utxo/{hash}
          → { amount: 1000, owner: userPubkey, source: "solana://tx/{txSig}" }
```

Every step is `receive()` and `read()`. Every artifact is a URI. The "bridge" is
just messages referencing transactions, and interested parties completing them.

### 4.3 Who Participates in the Deposit Market

Multiple sellers compete to fulfill deposits:

| Participant                             | B3ND source                          | Incentive                                                    | Scale              |
| --------------------------------------- | ------------------------------------ | ------------------------------------------------------------ | ------------------ |
| **Network Fund (Root)**                 | Collected fees, preminted allocation | Automated protocol-level service. Sets a baseline rate.      | Up to fund balance |
| **Foundation**                          | TGE allocation                       | Subsidize early deposits. Favorable rates for bootstrapping. | Policy-driven      |
| **Third parties** (e.g., Bandeira-Tech) | Earned through operation, purchased  | Bridge-as-a-service business. Compete on speed and rate.     | Market-driven      |
| **OTC sellers**                         | Any B3ND holder                      | Individuals willing to sell B3ND for verified deposits.      | Ad hoc             |

The deposit market is just a market. The `solana://tx/...` message is a request.
Responses are offers. Competition drives rates toward fair value.

### 4.4 Why This Is Better Than a Single Bridge Contract

- **No privileged access**: Nobody holds keys to unlock tokens. No governance
  vote can drain a pool.
- **No single point of failure**: If one verifier goes offline, others continue.
- **Supports serverless frontends**: A browser-only app publishes a transaction
  reference. It doesn't need to run a bridge — the network handles verification.
- **Reproducible pattern**: `solana://tx/...`, `ethereum://tx/...`,
  `bitcoin://tx/...` — same pattern for any chain. Not protocol-specific.

### 4.5 Double-Deposit Prevention

The transaction signature is the natural deduplication key. `solana://tx/{sig}`
is unique — a second message referencing the same signature is a provable
duplicate. Validators reject it.

```
First message:  solana://tx/abc123 → accepted, UTXO created
Second message: solana://tx/abc123 → rejected, URI already exists
```

No special double-spend logic needed. URI uniqueness handles it.

---

## 5. Layer 3: B3nd Native Economy

### 5.1 Preminted Supply

B3nd has its own preminted token supply (B3ND). The total supply could be set to
the sum of FCAT + xFCAT supplies, establishing a natural conservation across the
three pools.

B3ND exists from genesis. Depositing FCAT doesn't "mint" new B3ND — it releases
existing tokens from distribution pools (bridge escrow, reward pools, etc.).

### 5.2 Where B3ND Starts

At genesis, B3ND is distributed across pools:

```
Bridge escrow pool:    Tokens released to depositors (1:1 for verified deposits)
Reward pool:           Ad revenue, gas subsidies, operator incentives
Foundation allocation: Operational budget, grants, early subsidies
Community pool:        Governance-directed spending
```

These pools are just sets of UTXOs with protocol-defined spending conditions.

### 5.3 Protocol Locks as Economic Mechanism

The primary economic lever inside B3nd is **not** token burning or inflation. It
is **protocol-defined lock conditions** on UTXOs.

Every B3ND UTXO can carry spending conditions:

```
gas://utxo/{hash}
  → { amount: 100, owner: pubkey,
      condition: "earned_from:ad_impression",
      lock: "spendable_after:30_days_active_participation" }
```

The UTXO exists. It's real. The owner can see it. But it can't be spent until
the condition is met. This is native to the UTXO model — every output has a
spending script.

**Examples of protocol locks:**

| Lock type              | Condition                                                      | Purpose                                           |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| **Ad revenue reward**  | Spendable after 30 days of active participation since earning  | Proves sustained engagement, not drive-by farming |
| **Relay reward**       | Spendable only if relay uptime ≥ 90% during lock period        | Incentivizes reliable operation                   |
| **Operator stake**     | Locked for commitment period; slash conditions on early exit   | Ensures validator accountability                  |
| **Reputation-gated**   | Longer locks for zero-reputation pubkeys, shorter for high-rep | Graduated trust                                   |
| **Validator withdraw** | Spendable only with proof of validated messages N blocks ago   | Ties rewards to actual work                       |

### 5.4 How Locks Control Supply

At any moment on B3nd:

```
Total B3ND = Locked UTXOs + Circulating UTXOs
```

Locked UTXOs are real but can't move. They represent value committed to the
network. Circulating UTXOs can be spent, traded, or used to negotiate exits.

**More activity → more earned UTXOs → more locks → less circulating → less exit
pressure** **Less activity → locks expire → more circulating → more potential
exit → but less earned value**

Self-balancing. The supply pressure reflects actual usage, not artificial
scarcity. No burns. No inflation schedules. Just: _what did you do, and how long
ago?_

---

## 6. Layer 4: The Network Fund (Root)

### 6.1 What It Is

The Network Fund is a protocol-level entity — a set of UTXOs controlled by
protocol rules, not by any person or committee. It is a sovereign economic
resource of the network itself.

It has three roles:

**Collector:**

- All gas fees from message passing
- Per-byte fees for hashed blob storage
- Any other protocol-defined fees

**Distributor:**

- Validator rewards through withdraw programs
- Relay compensation
- Bonus/incentive programs for continued participation

**Bridge market participant:**

- Offers B3ND for verified deposits (one of many sellers)
- Up to a ceiling based on current fund balance
- Sets a de facto floor price for bridge entry

### 6.2 The Withdraw Program

Validators don't receive fees directly. Instead:

```
All fees → Network Fund → Withdraw programs

A withdraw program:
  Input:  proof that you validated messages in checkpoint N, M blocks ago
  Output: B3ND from the fund, proportional to work proved

The time delay (M blocks ago) ensures:
  - Validators must sustain participation to claim
  - Can't validate once and cash out
  - Work is verifiable against the checkpoint chain
```

This consolidates all network revenue into one place, with transparent,
rule-based distribution.

### 6.3 Fund Lifecycle

**Early stage (genesis → year 1):**

- Fund starts with preminted allocation
- Deposits draw from fund at favorable rates (bootstrapping)
- Foundation supplements with its own allocation
- Fund is the primary bridge market participant

**Growth stage (year 1-3):**

- Fee collection ramps up (more activity → more fees)
- Fund replenishes from collected fees
- Third-party bridge operators emerge
- Fund is one of several bridge market participants

**Mature stage (year 3+):**

- Fund operates entirely on fee revenue
- Bridge market has many independent participants
- Fund is a supporting player, not the primary one
- The "escrow" concept is irrelevant — the market is self-sustaining

### 6.4 What If the Fund Depletes?

If cumulative deposits exceed the fund's preminted + collected balance, the fund
stops fulfilling deposits. But:

- The bridge AMM on Solana still works (FCAT/xFCAT swaps continue)
- Other bridge market participants (foundation, third parties, OTC) continue
  operating
- Users can still acquire B3ND from the circulating market on B3nd
- The fund continues collecting fees and refilling

The fund is a **bootstrap mechanism** that transitions to a **fee-recycling
mechanism**. Full depletion means the bootstrap phase is over, not that the
system is broken.

### 6.5 Options for Fund Sustainability

| Option                | Mechanism                                                              | Tradeoff                                                               |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Gas fee partition** | 10% of all gas fees flow to fund                                       | Reduces validator direct income; fund refills proportional to activity |
| **Deposit fee**       | Depositors receive 0.98:1 instead of 1:1                               | Small friction on entry; dampens recycling                             |
| **Dynamic rate**      | Release rate adjusts based on fund fullness                            | Less attractive rate when fund is low; self-regulating                 |
| **Pure depletion**    | Fund drains and stays empty; market takes over                         | Simplest; depends on mature market for onboarding                      |
| **Mintability**       | Protocol can mint under verifiable conditions tied to network activity | Most flexible; requires careful design to avoid inflation              |

These options compose. The simplest viable combination: gas fee partition + pure
depletion as fallback. The fund stays warm from fees during normal operation and
gracefully degrades to market-only onboarding if deposits outpace refills.

---

## 7. Layer 5: The Withdrawal Market

### 7.1 The Core Constraint

**There is no native withdrawal from B3nd.** The deposit direction is trustless
(verify external chain transactions). The reverse direction would require B3nd
to cause token minting on Solana, which requires trusting B3nd validators — an
attack vector.

Exiting B3nd is a **trade, not a bridge operation**.

### 7.2 How Withdrawal Works

```
1. User on B3nd has 1200 B3ND, wants to exit
2. User finds a withdrawal provider on B3nd
3. They negotiate: B3ND on B3nd for some token on Solana
4. User sends B3ND to provider on B3nd
5. Provider sends agreed token to user on Solana
6. Done — bilateral trade, no bridge involved
```

### 7.3 Multi-Token Settlement

The withdrawal market is **not tied to xFCAT**. The Solana-side settlement can
be any token:

| Settlement token  | How user gets to FCAT           | Provider needs           |
| ----------------- | ------------------------------- | ------------------------ |
| **xFCAT**         | Exchange at bridge AMM for FCAT | xFCAT holdings on Solana |
| **FCAT**          | Already there                   | FCAT holdings on Solana  |
| **USDC**          | Swap on DEX                     | USDC holdings on Solana  |
| **SOL**           | Swap on DEX                     | SOL holdings on Solana   |
| **Any SPL token** | Swap on DEX                     | Holdings of that token   |

This is critical for resilience. If someone corners xFCAT, withdrawal providers
switch to USDC settlement. If FCAT is illiquid, settle in SOL. The exit
mechanism has no single point of failure because it's not tied to any single
token.

### 7.4 Withdrawal Provider Incentives

A withdrawal provider is someone who:

- **Has** liquid tokens on Solana (xFCAT, USDC, SOL, etc.)
- **Wants** B3ND on B3nd (they're an operator, advertiser, speculator, or
  builder)
- **Earns** from the spread between B3ND acquisition cost and Solana token cost

This is a natural market. Operators who need B3ND for staking buy it from
exiting users. Advertisers who need B3ND for campaigns buy it from exiting
users. The withdrawal market is just the buy side of the B3ND economy.

---

## 8. Engagement Patterns

### 8.1 Pattern: New User Deposit

```
Alice wants to join B3nd.

Solana:
  1. Alice buys 1000 FCAT on a Solana DEX
  2. Alice sends 1000 FCAT to the deposit program address
  3. Transaction finalized on Solana

B3nd:
  4. Alice's app publishes: solana://tx/{sig} → { amount: 1000, depositor: aliceKey }
  5. Network Fund (or another verifier) sees the message, checks Solana RPC
  6. Verifier responds: gas://utxo/{hash} → { amount: 1000, owner: aliceKey }
  7. Alice has 1000 B3ND. She can use apps, pay gas, earn rewards.

Elapsed: seconds to minutes (Solana finality + B3nd message propagation)
```

### 8.2 Pattern: Earning With Protocol Locks

```
Alice uses a B3nd app for 3 months.

Month 1:
  - Views ads, earns 50 B3ND from ad revenue → locked 30 days
  - Relays messages, earns 20 B3ND → locked until uptime confirmed
  - Total: 1070 B3ND (1000 circulating + 70 locked)

Month 2:
  - Month 1 ad rewards unlock (30 days active) → +50 circulating
  - Earns 60 more B3ND (locked)
  - Total: 1120 B3ND (1050 circulating + 70 locked)

Month 3:
  - More unlocks, more earnings
  - Total: 1250 B3ND (1150 circulating + 100 locked)

The locked portion reflects active value committed to the network.
The circulating portion is freely spendable.
```

### 8.3 Pattern: Partial Exit

```
Alice wants to cash out 500 B3ND, keep participating with the rest.

B3nd:
  1. Alice finds a withdrawal provider (an advertiser who needs B3ND for campaigns)
  2. They agree: 500 B3ND for 490 xFCAT (provider takes small spread)
  3. Alice sends 500 B3ND to provider on B3nd
  4. Provider sends 490 xFCAT to Alice on Solana

Solana:
  5. Alice takes 490 xFCAT to bridge AMM
  6. AMM exchanges: 490 xFCAT → ~487 FCAT (0.3% pool fee + slippage)
  7. Alice sells 487 FCAT on DEX for USDC

Alice: exited with ~487 FCAT worth of value, still has 750 B3ND on B3nd
Provider: acquired 500 B3ND for their campaigns
Bridge AMM: captured ~3 FCAT in fees, pool rebalanced
```

### 8.4 Pattern: xFCAT as Alternative Deposit Path

```
Bob has xFCAT (bought on DEX or received from a withdrawal).
Bob wants B3ND but doesn't want to go through FCAT.

Solana:
  1. Bob exchanges xFCAT for FCAT at bridge AMM (pays pool fee)
  2. Bob deposits FCAT into deposit program

B3nd:
  3. Normal deposit flow — verifier sees tx, issues B3ND

Or:
  1. Bob finds someone on B3nd willing to sell B3ND for xFCAT directly
  2. Bilateral trade — Bob sends xFCAT on Solana, seller sends B3ND on B3nd
  3. No bridge AMM involved — direct OTC

Multiple paths, same outcome. The market finds the cheapest route.
```

### 8.5 Pattern: Bridge AMM Arbitrage

```
xFCAT is trading at 0.97 FCAT on a Solana DEX (slight discount).

Arbitrageur:
  1. Buys 10,000 xFCAT on DEX for 9,700 FCAT equivalent
  2. Exchanges 10,000 xFCAT at bridge AMM → receives ~9,970 FCAT (0.3% fee)
  3. Profit: 270 FCAT

Effect:
  - xFCAT price on DEX rises toward 1.0 (buy pressure)
  - Bridge AMM captured fees
  - Peg tightened

This arbitrage is market-positive. It maintains the peg and funds the protocol.
```

### 8.6 Pattern: Network Fund Lifecycle

```
Genesis:
  Fund has 500M B3ND (preminted allocation)
  Fund is the primary deposit market participant

Year 1:
  Deposits pull 100M B3ND from fund → 400M remaining
  Gas fees collect 20M B3ND → fund refills to 420M
  Third-party verifiers emerge, handling 30% of deposits

Year 2:
  Deposits pull 150M from fund → 270M
  Gas fees collect 80M → fund at 350M
  Third parties handle 50% of deposits
  Foundation handles 20% from its own allocation

Year 3:
  Fund operates mostly on fee revenue
  Preminted allocation nearly distributed
  Third parties handle 70% of deposits
  Fund provides baseline rate for the remaining 20%
  Foundation handles edge cases

Mature:
  Fund is a self-sustaining fee recycler
  Deposits are handled by a competitive market of verifiers
  Fund participates with whatever it collects from fees
  No dependence on preminted allocation
```

---

## 9. Adversarial Analysis

### 9.1 Deposit Drain Attack

**Attacker**: Whale with 200M FCAT. Deposits everything to drain B3ND escrow.

**What happens**: Whale locks 200M of their own capital. Gets 200M B3ND but
can't productively use it without sustained participation (protocol locks on
rewards). Can't dominate validation (sqrt-weighted staking). Can't dump quickly
(withdrawal market has limited depth, AMM fees on large swaps).

Meanwhile: bridge AMM gets more liquid (200M FCAT added to pool). Other users
benefit from deeper liquidity.

**Result**: Self-defeating. Whale hurt themselves, helped the bridge.

### 9.2 xFCAT Corner + Short

**Attacker**: Corner 60% of xFCAT supply, short FCAT, spread FUD.

**Problems for the attacker**:

1. Deep peg means cornering xFCAT pushes xFCAT price up → FCAT follows (peg) →
   short loses money
2. Withdrawal market is multi-token — providers switch to USDC/SOL settlement,
   xFCAT corner becomes irrelevant
3. Bridge always accepts deposits — can't freeze entry

**Result**: Attacker fights their own positions. B3nd internal economy is
unaffected. Withdrawal market routes around the corner.

### 9.3 Recycling Grinder

**Attacker**: Cycles FCAT through bridge repeatedly (deposit, exchange xFCAT for
FCAT, re-deposit).

**What happens**: Each cycle pays AMM fee (0.3%+) on the xFCAT→FCAT exchange.
After 10 cycles, attacker has paid ~3% in cumulative fees. The bridge AMM
captured all of it.

If the attacker is doing this to drain escrow: they're paying for the privilege.
If they're arbitraging a price difference: they're tightening the peg
(market-positive).

**Result**: Unprofitable grinding or market-positive arbitrage. AMM fees are the
defense.

### 9.4 Scorched Earth (Well-Funded Competitor)

**Attacker**: Crash FCAT price, buy all xFCAT, flood B3nd with spam, stake and
go offline.

**What they can damage**: Market perception. Growth. New user acquisition. The
Solana-side economy.

**What they cannot damage**: B3nd internal economy. Apps keep working. Gas UTXOs
process. Protocol locks protect earned value. The bridge always accepts
deposits.

**The honest assessment**: A well-funded attacker can hurt the Solana-side
economy and slow growth. They cannot break the B3nd protocol. The defense is
making the internal economy valuable enough that the external bridge becomes
secondary. Early stage (first 6-12 months) is the vulnerable window.

---

## 10. Supply Dynamics

### 10.1 Three-Pool Conservation

```
Pool 1: FCAT on Solana
  Total: F (fixed at TGE)
  = FCAT circulating + FCAT in bridge AMM pool + FCAT in deposit program

Pool 2: xFCAT on Solana
  Total: X (fixed at TGE)
  = xFCAT circulating + xFCAT in bridge AMM pool

Pool 3: B3ND on B3nd
  Total: B (fixed at genesis, possibly = F + X)
  = B3ND in fund pools + B3ND circulating + B3ND locked in protocol conditions

Grand total: F + X + B = constant forever
No tokens are created or destroyed after genesis.
```

### 10.2 What Moves Between Pools

| Action                 | FCAT effect                           | xFCAT effect                | B3ND effect                    |
| ---------------------- | ------------------------------------- | --------------------------- | ------------------------------ |
| Deposit FCAT           | FCAT circulating ↓, deposit program ↑ | —                           | Fund pool ↓, circulating ↑     |
| Bridge AMM: xFCAT→FCAT | FCAT pool ↓, circulating ↑            | xFCAT circulating ↓, pool ↑ | —                              |
| Bridge AMM: FCAT→xFCAT | FCAT circulating ↓, pool ↑            | xFCAT pool ↓, circulating ↑ | —                              |
| Earn rewards on B3nd   | —                                     | —                           | Reward pool ↓, locked ↑        |
| Protocol lock expires  | —                                     | —                           | Locked ↓, circulating ↑        |
| Gas fee payment        | —                                     | —                           | Circulating ↓, fund ↑          |
| Validator withdraw     | —                                     | —                           | Fund ↓, circulating ↑          |
| Withdrawal trade       | —                                     | —                           | Moves between users (net zero) |

### 10.3 Equilibrium Dynamics

The system naturally finds equilibrium through several feedback loops:

**Bridge AMM peg:**

- xFCAT below FCAT → arbitrageurs buy xFCAT, exchange at AMM → peg tightens
- xFCAT above FCAT → arbitrageurs sell xFCAT → peg tightens
- AMM fees fund the protocol on every correction

**Protocol locks vs. circulating supply:**

- High activity → more locked UTXOs → less circulating → less exit pressure
- Low activity → locks expire → more circulating → but less earned value to exit
  with
- Self-balancing without intervention

**Network Fund refill:**

- High activity → more gas fees → fund refills faster → more deposit capacity
- Low activity → less gas → fund refills slower → but fewer deposits to serve
- Supply matches demand through fee revenue

**Withdrawal market pricing:**

- High exit demand → B3ND cheaper (more sellers than buyers) → depositors get
  more for less
- Low exit demand → B3ND maintains value → healthy ecosystem signal
- Market rate reflects network health in real time

---

## 11. Open Design Questions

### 11.1 TGE Supply Ratios

What should the ratio of FCAT : xFCAT : B3ND be? Options:

- **1:1:2** — B3ND total equals sum of both Solana tokens. Clean conservation.
- **1:1:1** — Equal supplies. B3ND is scarcer relative to Solana tokens.
- **1:0.5:1.5** — Less xFCAT (smaller shadow supply). More B3ND for internal
  rewards.

The ratio determines how much withdrawal capacity exists (xFCAT supply), how
deep the bridge AMM can be (initial liquidity), and how much B3ND is available
for internal distribution.

### 11.2 xFCAT Initial Distribution

Who receives xFCAT at TGE? This determines who controls the withdrawal-side
market early on:

- **Liquidity pools**: Deep AMM liquidity from day one. Market-driven.
- **Foundation**: Foundation controls withdrawal capacity. Can subsidize exits.
- **Community**: Broadly distributed. Many small withdrawal providers.
- **Market makers**: Professional participants ensure tight peg.

### 11.3 Bridge AMM Parameters

- Pool type: concentrated liquidity vs. constant-product vs. hybrid
- Fee rate: 0.1% (tight peg, low revenue) to 1% (more revenue, wider spread)
- Fee destination: back into pool (deeper liquidity) vs. protocol treasury vs.
  foundation
- Whether the protocol should own the liquidity position or leave it to external
  LPs

### 11.4 Network Fund Rules

- What percentage of gas fees flow to the fund?
- Should the fund have mintability (protocol-defined issuance tied to network
  activity)?
- How are withdraw program conditions designed (time delay, work proof
  requirements)?
- Should the fund have a maximum balance (excess distributed to community)?

### 11.5 Deposit Program Design

- Should the Solana deposit program be a simple lockbox or a more complex vault?
- Should deposited FCAT be placed into a liquidity position (earning yield while
  locked)?
- What happens to FCAT in the deposit program if the protocol migrates or
  upgrades?

### 11.6 Consensus for the Gas Partition

The `gas://utxo/*` URI space is the most critical partition — it determines who
has tokens. The validation and consensus model for this partition remains the
largest open design question, addressed separately from token movement.

---

## 12. Design Principles (Summary)

1. **The bridge is a pattern, not a contract.** Transaction references as URIs,
   verified by interested parties. Reproducible for any external chain.

2. **No native withdrawal.** Trustless only in the deposit direction. Exit is a
   bilateral trade on an open market. This is honest and secure.

3. **No burns.** All token supplies are fixed at genesis. Economic dynamics come
   from protocol locks, fee recycling, and market forces — not artificial
   scarcity.

4. **Multi-token resilience.** The withdrawal market settles in any token. No
   single point of failure. Cornering one token is irrelevant.

5. **AMM fees as defense.** Every bridge swap costs something. Small for normal
   users, large for manipulation attempts. Fees fund the protocol.

6. **Protocol locks as monetary policy.** Not burn rates, not emission
   schedules. Just: what did you do, and how long ago? Supply pressure reflects
   actual usage.

7. **The Network Fund is a machine, not a committee.** Collects fees,
   distributes through rules, participates in markets. Protocol-defined, not
   governance-defined.

8. **The bridge always accepts deposits.** Unconditional. The entry mechanism
   cannot be frozen, drained, or impeded. Growth is never blocked by bridge
   mechanics.

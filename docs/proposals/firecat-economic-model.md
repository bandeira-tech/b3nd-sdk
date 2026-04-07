# Firecat Economic Model — The Canonical B3nd DePIN Template

**Status:** Draft — Vision + economic design for first-round discussion
**Date:** 2026-02-24 **Companion:** See `tokenization-gas-semantics.md` for
technical gas implementation details

---

## 1. The Problem We're Solving

Creating apps today has near-zero marginal cost. The result is market
saturation: a trail of dead apps, dead startups, and dead data — while the same
dominant platforms grow larger. The current web economy has three structural
failures:

1. **Infrastructure concentration.** A handful of cloud providers and platform
   companies control where data lives, what it costs to store, and who can
   access it. Small builders pay rent to incumbents and compete on their terms.

2. **Adversarial advertising.** Marketing budgets — large enough to power the
   entire internet of user-generated content — flow almost entirely to platform
   owners. Advertisers pay to _interrupt_ users. Users get a degraded
   experience. The platforms pocket the spread. This is effectively an invisible
   tax on communication in society.

3. **Data hostage dynamics.** When an app dies, users lose their data. When a
   platform changes terms, developers lose their audience. There is no
   portability, no durability guarantee, and no user sovereignty. The people who
   create value (users, builders) have the least control over it.

These are not technology problems. The technology to build decentralized,
user-owned, community-sustained infrastructure exists. What's missing is an
**economic design** that makes it work — that makes it sustainable for node
operators, free (or near-free) for users, profitable for builders, and efficient
for advertisers.

That's what this document describes.

---

## 2. The Firecat Model

### 2.1 The Thesis

The money already exists in the system. Global digital advertising spend exceeds
$600B/year. That money currently flows through a chain that extracts value at
every step:

```
Advertiser budget
  → Platform takes 30-70% (Google, Meta, etc.)
    → Publisher gets remainder
      → User gets nothing (except interruption)
        → Data locked in platform silos
```

Firecat inverts this:

```
Advertiser budget
  → Network takes a small protocol fee (burned/distributed)
    → User gets majority share (for attention + data contribution)
      → Node operators get infrastructure compensation
        → App builders get sustainable revenue
          → Data persists in user-owned, community-hosted storage
```

The key insight: **if even a fraction of existing ad spend flows through a
user-aligned network, it's more than enough to sustain the entire
infrastructure, pay node operators, subsidize free user access, and fund app
development.**

### 2.2 The Participants

| Role                | Who                                                       | Incentive                                                          | Cost                                                                                    |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Founding entity** | Nonprofit foundation                                      | Bootstrap the network, subsidize early usage                       | Server costs (~€50/month today for 8 servers + object storage; scales as network grows) |
| **Node operators**  | Anyone with hardware (data centers, home servers, phones) | Earn tokens from gas fees, relay rewards, ad revenue share         | Hardware + bandwidth + electricity                                                      |
| **App builders**    | Developers building on Firecat                            | Sustainable apps with no platform rent; users bring their own data | Development time                                                                        |
| **Users**           | People using Firecat apps                                 | Free experience + earn from attention/data; own their data forever | Nothing (subsidized)                                                                    |
| **Advertisers**     | Businesses reaching audiences                             | More engaged, willing audience; direct relationship; better ROI    | Ad spend (but more of it reaches the target)                                            |

### 2.3 Why This Works Economically

The founding entity's initial investment is remarkably modest. Today, 8
servers + 1 object storage bucket costs ~€50/month total. With heavy caching and
optimization, this already supports meaningful traffic. As the network grows and
peak-time quality matters, costs will scale — but the starting point is less
than a single SaaS subscription. This is fundamentally different from a typical
startup because:

- The data doesn't die when the company dies (it's on the network)
- Users aren't locked to one provider (data portability via B3nd URIs)
- Other node operators can join and share the load
- As the network grows, infrastructure costs are distributed

The founding entity doesn't need to be profitable. It's a nonprofit that must
only cover its costs — starting at €50/month and growing with demand.
Sustainability comes from the network effects:

1. Foundation subsidizes early users → users join → apps have audiences
2. Audiences attract advertisers → ad revenue flows into the network
3. Ad revenue compensates node operators → more operators join → more capacity
4. More capacity → lower costs → more apps → more users → cycle repeats

---

## 3. Token Design

### 3.1 The Firecat Token (working name: `FCAT`)

A single token with four functions, optimized for **flow and usage** rather than
price appreciation:

| Function               | Mechanism                                                                     | Velocity                      |
| ---------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| **Gas**                | Spent as UTXO inputs on writes; flows to operators (not burned)               | High (per-message)            |
| **Staking**            | Locked by node operators for right to validate + earn (sqrt-weighted returns) | Low (locked months/years)     |
| **Medium of exchange** | Used for in-network payments (ad spend, user rewards, app purchases)          | Medium                        |
| **Governance**         | Staked tokens vote on protocol parameters                                     | Low (locked for voting power) |

### 3.2 Why a Single Token

Dual-token models (governance + utility) add complexity that hurts adoption. A
single token works if velocity is managed through staking and withdrawal
mechanics:

- Node operators must stake to earn → large portion locked
- Founding entity holds majority stake initially → subsidy source, not
  speculative asset
- Ad revenue denominated in FCAT → creates organic demand
- User earnings have withdrawal cliff and minimum threshold (see 3.5) → tokens
  stay in the network longer
- **No burning or minimal burning** — tokens flow through the economy instead of
  being destroyed. The network's value comes from throughput and utility, not
  artificial scarcity. Burning drives up adoption costs over time and creates
  instability at both high and low usage levels.

The founding entity's majority stake serves a specific purpose: it's the source
of **free gas** (as UTXO sponsorship) for subsidized users. As the network
matures, this stake disperses across node operators through subsidy payments,
and organic demand (ad market, user rewards) replaces the subsidy.

### 3.2.1 Anti-Whale Design

The token economics are deliberately designed to resist capture by large
holders:

- **Sqrt-weighted operator rewards**: An operator with 100x more stake earns
  only ~10x more. This makes the network more attractive for many small
  operators than for a few large ones.
- **No burning**: Burning benefits holders proportionally to their holdings —
  the biggest holders benefit most. Without burning, there's no passive value
  extraction from holding.
- **Withdrawal mechanics**: User earnings are subject to cliff + gradual
  disbursement, preventing dump-and-run behavior.
- **Stable gas pricing**: Gas costs are denominated in units with a fiat-stable
  rate, so token price appreciation doesn't make the network cheaper for
  existing holders at the expense of new users.

### 3.3 The Subsidy Model

```
Founding entity holds: 60% of initial supply (example)
  ├── 40% allocated as "free gas pool" for user subsidies
  │     Users don't pay for writes — foundation's stake covers it
  │     Decreases over time as ad revenue takes over
  │
  ├── 15% allocated to node operator grants
  │     Bootstrap incentives for early operators
  │
  └── 5% operational reserve
        Foundation running costs, development, legal
```

For the average user, the experience is identical to a normal web app. They
don't know about tokens, gas, or blockchain. Their session is subsidized by the
foundation's stake. Behind the scenes, gas sponsorship works through normal B3nd
message channels:

1. User opens a Firecat app in their browser
2. App writes to `mutable://accounts/{userKey}/...`
3. The message includes gas UTXO inputs from the foundation's or app developer's
   token supply, with fee outputs to the protocol
4. The schema validator atomically verifies: sponsor's UTXO exists and is
   unspent → consumes it → creates change + fee UTXOs → stores user's data
5. User never sees any of this — the app constructs the sponsorship output
   automatically

This is the **meta-transaction pattern**: a third party pays gas on behalf of
the user. No special API fields, no custom headers — just another output in the
`MessageData.payload.outputs` array, validated atomically alongside the user's
actual data.

### 3.4 Transition to Self-Sustaining

The foundation's subsidy is a bridge, not a permanent state. Being honest: this
transition is not a smooth ramp — it's a race. The foundation's UTXO pool is a
countdown. Either organic revenue (ads, direct payment) materializes before it
runs out, or the foundation needs additional funding.

Conservative expectations:

```
Year 0-1: Foundation subsidizes 100% of user gas
          Foundation burns through its UTXO pool at the rate of network usage
          If network stays small (~1K users), burn rate is low — pool lasts years

Year 1-3: Ad market experiments begin; revenue is uncertain and small
          Foundation may need to supplement from operational budget (€3-6K/year)
          This is still cheaper than one contractor

Year 3+:  If ad market has traction, it covers growing share of gas
          If it doesn't, the foundation continues subsidizing at modest cost
          The key metric: is per-user cost dropping fast enough?
```

The foundation's token pool decreases over time through spending on gas
subsidies and operator grants. The tokens flow from foundation → node operators
(as gas payment) → back into the economy. Operators who receive subsidy tokens
may sell them — this IS sell pressure, and the model must account for it rather
than pretending it doesn't exist.

### 3.5 Token Withdrawal Mechanics

To prevent dump-and-run behavior (users farming ad rewards and immediately
selling), earned tokens are subject to:

- **Cliff**: Earned tokens become withdrawable after a minimum holding period
  (e.g., 30 days from earning)
- **Minimum threshold**: Withdrawals require a minimum accumulated balance
  (e.g., 100 FCAT) — prevents micro-farming
- **Gradual disbursement**: Large withdrawals release over time (e.g., 20% per
  week) rather than all at once

These mechanics serve multiple purposes:

1. Keep tokens circulating within the network longer
2. Make farming less attractive (time cost + minimum threshold)
3. Reduce sell pressure from user earnings
4. Incentivize users to spend tokens within the network (on apps, services,
   tipping) rather than withdrawing

The cliff and threshold are protocol-level rules enforced by the UTXO validators
— earned-reward UTXOs have a `withdrawableAfter` timestamp and can only be
transferred to external addresses after the cliff.

---

## 4. The Ad/Outreach Market

This is the economic engine that makes the network self-sustaining.

### 4.1 How It Works

Everything flows through normal B3nd message channels — no special API headers,
no custom fields, no platform-level hooks. The ad market is just another set of
messages on the network.

**User quality and reputation:**

User quality matters to advertisers. Sessions and pubkeys accumulate reputation
based on:

- **Behavioral history**: their on-network activity (message patterns,
  engagement, content creation) visible through their public URIs
- **Third-party attestations**: external services (quiz platforms, survey
  providers, identity verifiers) can sign cryptographic proofs on the user's
  behalf and publish them as messages on the network

```
attestation://services/{verifierKey}/users/{userKey}
  → { type: "age-bracket", value: "25-34", sig: "...", timestamp: ... }

attestation://services/{surveyPlatform}/completions/{userKey}/{surveyId}
  → { categories: ["tech-enthusiast", "early-adopter"], sig: "..." }
```

These attestations are just signed messages — verifiers run their own services,
and users choose which attestations to collect. No central authority decides
what makes a "good" user.

**Campaign creation and bidding:**

Advertisers use reputation data to bid for ad space. This happens through both
custodial services (ad agencies that manage campaigns) and directly through
listener nodes exchanging messages:

```
Advertiser → creates campaign (normal message):
  ad://campaigns/{advertiserKey}/{campaignId}
    → { budget: 10000, targetAudience: { attestations: [...], minReputation: ... },
        content: {...}, rewardPerView: 0.5 }

Listener nodes → match campaigns to eligible sessions
  (nodes observe user activity patterns + published attestations)
  (bidding/matching happens via message exchange between listener nodes)
```

**User preferences and delivery:**

```
User → opts in to receive ads/surveys (normal message):
  mutable://accounts/{userKey}/preferences/ads
    → { enabled: true, categories: ["tech", "local"], maxPerDay: 5 }

Delivery → ads shown within app experiences
  User views/interacts → attestation recorded (normal message):
    immutable://open/ad-views/{hash}
      → { user: pubkey, campaign: id, timestamp, interaction: "viewed"|"clicked"|"completed" }
```

**Settlement:**

```
At epoch end, campaign budget is distributed:
  → 70% to user (for their attention — subject to withdrawal cliff, see 3.5)
  → 20% to node operator (for serving the ad + storing attestation)
  → 10% to community/foundation pool (development, grants, subsidies)
```

No tokens are burned in settlement. All value circulates back into the network
economy.

### 4.2 Reputation and Quality Defense Against Farming

A known failure mode of pay-for-attention models (Brave/BAT, Sweatcoin, etc.) is
that they attract low-quality audiences who optimize for reward extraction
rather than genuine engagement. This makes the audience less valuable to
advertisers, driving down CPM, making rewards negligible, causing churn.

Firecat's defense is **graduated reputation**:

- **New pubkeys start with zero reputation.** A brand-new account has no
  behavioral history, no attestations, no engagement record. Most advertisers
  won't target zero-reputation users — the risk of bots is too high.
- **Early-stage users see non-paid content.** Foundation or app developer can
  show promotional content, onboarding material, or community announcements. No
  advertiser is paying for this — it's subsidized.
- **Reputation accrues through usage patterns.** Consistent engagement over time
  (reading, posting, interacting across apps), diverse activity patterns, and
  time-on-network build organic reputation. This is observable through the
  user's public URIs.
- **Third-party attestations unlock premium targeting.** Users who complete
  quizzes, surveys, or identity verification through external services receive
  signed attestation messages. These are high-value signals for advertisers:
  "this user is a verified human in the 25-34 age bracket who is interested in
  cooking."
- **Social profile depth increases value.** A pubkey with public posts, follower
  relationships, and app-specific data is demonstrably real and targetable.
  Advertisers pay more to reach users with rich, contextual profiles.
- **Strange behavior is flaggable.** Any network participant can flag suspicious
  patterns (rapid ad views with no other engagement, identical behavior across
  many pubkeys). Flags are messages on the network. Ad providers choose which
  flags to respect.
- **Withdrawal cliff and threshold** (see 3.5) make farming economically
  unattractive. You need to accumulate a minimum balance over a minimum time
  period before you can withdraw. The time cost of farming makes it less
  profitable than genuine usage.

The result: advertising value increases with user quality, and user quality
increases with genuine long-term engagement. Bots and farmers face a cold start
(no reputation → no ad revenue → long cliff before withdrawal) that makes the
attack expensive relative to the payout.

### 4.3 Why Advertisers Would Use This

The current model wastes advertiser money:

- Google/Meta take 30-70% of ad spend as platform fees
- Users actively resist ads (ad blockers, banner blindness)
- Targeting relies on invasive surveillance
- Click fraud and bot traffic waste 20-40% of budgets
- Attribution is opaque

The Firecat model offers advantages — but we should be honest about what's
proven and what's aspirational:

**Proven advantages:**

- **Verifiable delivery**: ad views are content-addressed attestations,
  tamper-proof. This eliminates click fraud.
- **Lower intermediary costs**: no platform taking 70%. More budget reaches the
  audience.

**Likely advantages (need validation):**

- **Willing audience**: users opted in and are rewarded — engagement should be
  higher, but this needs measurement.
- **Honest targeting**: users declare preferences explicitly + third-party
  attestations. This may or may not be as effective as behavioral surveillance —
  self-declared preferences are notoriously unreliable. Attestation-based
  targeting is new territory.

**Aspirational advantages (unproven):**

- **Better ROI than incumbents**: This is the claim but there's no data yet.
  Early adopters will be small, niche advertisers (local businesses,
  crypto-native brands) who value the novelty and the audience quality.
  Mainstream advertiser adoption requires proven performance data that only
  comes from running the system.

### 4.4 Why Users Would Opt In

- They're already seeing ads on every platform. Here, they get paid for it.
- Their attention has value. Currently that value goes to platforms. Now it goes
  to them.
- The ads fund their entire web experience (storage, compute, bandwidth) — for
  free.
- They control what categories of ads they see. They can opt out anytime.
- Their ad interaction data is theirs, stored at their own
  `mutable://accounts/{key}/...` URIs.
- They don't get rich from this — but their web experience is funded by their
  attention rather than by selling their data to platforms. That's the value
  proposition, not a get-rich scheme.

### 4.5 Revenue Allocation

The user gets the majority of ad revenue. This is the core differentiator.

| Recipient                     | Share | Rationale                                                                                               |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| **User**                      | 70%   | They provide the attention. Without users, ads have no audience. Subject to withdrawal cliff (see 3.5). |
| **Node operator**             | 20%   | They serve the content, store the data, relay the messages.                                             |
| **Community/foundation pool** | 10%   | Development, grants, subsidies, operational costs.                                                      |

No tokens are burned. All revenue circulates.

An app builder's revenue comes from _being the reason users are on the network_.
Builders can optionally take a small cut of ad revenue shown within their app
(negotiated with advertisers), or offer premium features for direct FCAT
payment.

### 4.6 Realistic Earning Expectations

Being honest about what users can expect at different CPM levels:

| Scenario                                                | CPM    | Views/month | User share (70%) | Monthly earning  |
| ------------------------------------------------------- | ------ | ----------- | ---------------- | ---------------- |
| **Conservative** (new network, low-value audience)      | $0.25  | 150         | 70%              | **$0.026/month** |
| **Moderate** (established audience, some attestations)  | $1.00  | 150         | 70%              | **$0.105/month** |
| **Targeted** (attested user, local business context)    | $5.00  | 150         | 70%              | **$0.525/month** |
| **Premium** (survey completions, verified demographics) | $15.00 | 50          | 70%              | **$0.525/month** |

At early-stage CPMs ($0.25-1.00), user earnings are negligible in dollar terms.
The value proposition for users is not "get paid" — it's "your web experience is
free, your data is yours, and if the network grows, your accrued reputation
becomes more valuable over time."

The real economic impact comes from **contextual, high-value targeting**. A user
who has attested to living in a specific neighborhood, who is using a recipe
app, could receive a "order ingredients from Local Grocery" offer at $15+ CPM.
This kind of granular, context-aware, user-consented targeting is where the
model has potential to exceed traditional advertising efficiency — but it
requires a functioning attestation ecosystem and enough users to attract local
advertisers. This needs experimentation and iteration, not assumptions.

---

## 5. Node Operator Economics

### 5.1 Revenue Streams for Operators

A node operator earns from multiple sources:

```
1. Gas fees (share of write fees from messages they store)
2. Relay rewards (for replicating messages to peer nodes)
3. Ad serving fees (20% of ad revenue for campaigns delivered through their node)
4. Staking yield (protocol inflation distributed to staked operators)
5. Multi-protocol revenue (running nodes for OTHER B3nd protocols beyond Firecat)
```

### 5.2 Cost Structure

For a home operator:

```
Hardware:  €0 (existing computer/NAS/phone)
Bandwidth: €0-20/month (existing internet connection)
Storage:   €0 (spare disk space)
Power:     €5-15/month
────────────────────
Total:     €5-35/month
```

For a small professional operator (Hetzner-class, current baseline):

```
8 servers + object storage:  €50/month (current real cost)
Bandwidth:                   included
────────────────────
Total:                       €50/month starting
Capacity:                    supports initial network traffic
Growth:                      scales with demand (see Section 12)
```

### 5.3 Break-Even Analysis (Conservative)

Using conservative CPM estimates ($0.25 for a new, unproven network — not the
$2+ that established platforms command):

```
                        100 users    1,000 users   10,000 users   100,000 users
─────────────────────────────────────────────────────────────────────────────────
Monthly infra cost       €50          €50-80        €250-500       €1,500-3,000
Views/month (150/user)   15K          150K          1.5M           15M
─────────────────────────────────────────────────────────────────────────────────
AT $0.25 CPM (conservative — new network):
  Total ad revenue       $3.75        $37.50        $375           $3,750
  Operator share (20%)   $0.75        $7.50         $75            $750
  Break-even?            No           No            Maybe          Yes
─────────────────────────────────────────────────────────────────────────────────
AT $1.00 CPM (moderate — some reputation, better audience):
  Total ad revenue       $15          $150          $1,500         $15,000
  Operator share (20%)   $3           $30           $300           $3,000
  Break-even?            No           No            Yes            Yes (with margin)
─────────────────────────────────────────────────────────────────────────────────
AT $5.00 CPM (targeted — attested users, contextual):
  Total ad revenue       $75          $750          $7,500         $75,000
  Operator share (20%)   $15          $150          $1,500         $15,000
  Break-even?            No           Yes+          Yes+           Yes (very profitable)
```

**Honest assessment:** At conservative CPMs, ad revenue alone does NOT cover
infrastructure costs until ~10K-100K users. The foundation must plan to
subsidize infrastructure from its operational budget (€600-6,000/year) for the
first 1-3 years regardless. The good news: this is cheap. The risk: if user
growth stalls below 10K, the ad market never becomes self-sustaining and the
foundation must fund operations indefinitely — but at €50-500/month, this is a
viable nonprofit operation, not a venture-scale liability.

Gas fees, relay rewards, and multi-protocol revenue are additional income
streams not included above.

### 5.4 Multi-Protocol Advantage

This is unique to B3nd's architecture. A node operator doesn't serve just one
app or one protocol. They can run:

- Firecat protocol (social apps, content, messaging)
- A marketplace protocol (e-commerce, listings)
- A media protocol (streaming, galleries)
- A governance protocol (DAOs, voting)
- Any future B3nd protocol

Each protocol has its own token and gas economics. The node operator earns
across all of them, with the same infrastructure. This diversifies their revenue
and makes the infrastructure more resilient.

Multi-token complexity is an **operator-facing concern**, not a user-facing one.
Users interact with one protocol at a time and only see the token relevant to
their app. Node operators — who are technical participants running
infrastructure — manage multiple token streams as part of their business
operations. This is comparable to a hosting provider running multiple SaaS
products on the same servers.

```typescript
// Node config with multiple protocols
BACKEND_URL=postgresql://...
SCHEMA_MODULE=./multi-protocol-schema.ts  // Firecat + marketplace + media schemas merged

// The node validates and stores messages for all protocols
// Earns FCAT from Firecat, MRKT from marketplace, etc.
// Operator manages token streams — users don't see this complexity
```

---

## 6. How Gas Fits Into This Model

The technical gas proposals (see companion doc) now have clear economic context:

### 6.1 Gas as Subsidy Instrument (UTXO Model)

The foundation's token pool is a set of gas UTXOs. When the foundation sponsors
a user's message, it consumes a UTXO and creates change — all through normal
message channels:

```
Foundation UTXO pool: [gas://utxo/abc → {amount: 1000, owner: foundationKey}, ...]
User writes a message → costs 3 FCAT gas

The message includes:
  inputs:  [gas://utxo/abc]              ← foundation's UTXO consumed
  outputs:
    [userDataUri, userData]              ← what the user actually wants to write
    [gas://utxo/def, {amount: 3, owner: "protocol://distribution"}]  ← fee
    [gas://utxo/ghi, {amount: 997, owner: foundationKey}]            ← change

Schema validator atomically:
  1. Verifies foundation's UTXO exists and is unspent
  2. Verifies amounts balance (input ≥ outputs)
  3. Stores user's data + creates new UTXOs

Foundation pool now includes gas://utxo/ghi (997) instead of gas://utxo/abc (1000)
```

The user never sees this. The app constructs the sponsorship UTXO inputs
automatically as part of the normal message-building flow.

### 6.2 Gas as Network Health Signal

Gas prices are adaptive (per the technical proposals). When the network is
congested:

- Gas prices rise → discourages spam, incentivizes operators to add capacity
- Higher gas → more revenue per message → more operators join → congestion
  resolves

When the network is underutilized:

- Gas prices fall toward floor → cheaper for users/sponsors → more usage
- This is a natural supply/demand balancer

### 6.3 Gas as Value Flow (No Burning)

All gas fees flow to participants — nothing is burned:

- 70% to validators/operators → direct incentive to serve
- 20% to relay nodes → incentive to replicate
- 10% to community/foundation pool → development and subsidies

The token's value is backed by the utility it provides (message storage, network
access, ad market participation), not by artificial scarcity from burning. This
keeps adoption costs stable over time and avoids the instability of burn-driven
economics (where high usage causes deflation and low usage causes inflation).

### 6.4 Gas for Reads — The Ad Model Solves This

The technical proposals noted that reads are hard to price because they don't go
through `receive()`. The ad model provides an elegant solution:

- Reads are free for users (reads are how users consume content — charging would
  kill UX)
- The cost of serving reads is covered by ad revenue flowing to node operators
- Heavy read traffic on a node = more ad impressions served = more revenue
- This naturally incentivizes operators to optimize for fast reads (better UX =
  more engagement = more ad revenue)

Read spam/abuse is handled by HTTP-layer rate limiting, not economic barriers.

---

## 7. Data Durability and Honest Sovereignty

### 7.1 What We Can Actually Promise

No network — centralized or decentralized — can guarantee data persists forever.
AWS can lose data. Filecoin deals can expire. Bitcoin nodes can go offline. This
is universally true, and we should be honest about it rather than making
promises that sound better than reality.

When a user creates data on a Firecat app, that data lives at URIs they control:

```
mutable://accounts/{userPubkey}/app/myjournal/entries/2026-02-24
hash://sha256/{contentHash}  (immutable copy)
link://accounts/{userPubkey}/app/myjournal/latest → hash://sha256/{hash}
```

This data persists as long as **at least one node in the network stores it and
remains online**. That's the real guarantee. Everything else is a matter of
trust and incentives:

| Trust level               | What it means                                      | Guarantee strength                            |
| ------------------------- | -------------------------------------------------- | --------------------------------------------- |
| **You run a node**        | You have the data on your hardware                 | Strongest — you control it                    |
| **Contracted operator**   | You pay an operator (SLA) to store your data       | Strong — legal/economic obligation            |
| **Foundation nodes**      | The foundation operates last-resort infrastructure | Medium — depends on foundation sustainability |
| **Community replication** | Volunteer nodes replicate popular data             | Weakest — no obligation, best-effort          |

### 7.2 How Data Survives App Death

If a Firecat app company shuts down:

- The data is still on the network at the user's URIs — **if the nodes storing
  it are still running**
- Any other app can read the same data (it's just B3nd URIs)
- The user can switch to a different app that speaks the same protocol
- Their data, their keys, their identity — all portable

This is better than Web2 where app death = data death. But it's not magic: if
the nodes that stored the data also shut down, and no one replicated it, the
data is gone. The defense is replication factor and the foundation's commitment
to operating persistence infrastructure.

### 7.3 Censorship Resistance — Honest Assessment

No network can guarantee censorship resistance. This is true of every system:

- **Bitcoin**: Miners can choose which transactions to include. Mining pools can
  coordinate to censor addresses. State actors can pressure mining operations.
- **Ethereum**: Validators can censor transactions. MEV infrastructure already
  enables selective inclusion.
- **Nostr**: Relays can block any pubkey. Relay operators have full discretion.
- **B3nd/Firecat**: Nodes can refuse any message. Infrastructure providers can
  restrict any node.

**The only real guarantee of participation is running your own node.**
Everything else requires trust — in the community, in a contracted operator, or
in the foundation.

What B3nd does provide:

- **Portability**: Your data is addressed by URIs and signed by your keys. If
  one node censors you, you can send to another. Your identity is not tied to
  any single node.
- **Verifiability**: Content-addressed data (hash://) is tamper-proof. Anyone
  can verify it.
- **Transparency**: Validator checkpoint chains are public. Censorship is
  detectable — a validator that consistently excludes certain pubkeys can be
  identified and flagged.

What B3nd does NOT provide:

- A guarantee that your messages will be stored by any particular node
- A guarantee that your data will persist if all nodes storing it go offline
- A guarantee that no one will ever censor your messages

This is the honest baseline. Protocol-level incentives (staking, slashing,
reputation) can make censorship costly, but they cannot make it impossible.
Designing with this reality in mind — rather than pretending it doesn't exist —
leads to better outcomes.

### 7.4 No Storage Rent

Storage rent — charging ongoing fees for data persistence — was considered and
rejected:

- If a user stops paying rent (leaves the platform, loses keys, sponsoring app
  dies), their data gets garbage collected. This contradicts any claim of user
  sovereignty.
- Rent creates a dependency on ongoing payment — exactly what decentralization
  should eliminate.
- If nodes go offline, rent money is "in the network" but the data isn't. The
  promise is hollow.
- Rent enforcement adds protocol complexity for questionable benefit.

Instead, storage costs are covered by **one-time write fees** (endowment model)
calibrated to expected storage duration. Ephemeral data (mutable://open) is
cheap. Permanent data (hash://sha256) costs more. Once written and confirmed,
data persists as long as the storing nodes remain online — no ongoing payments.

Node operators choose their own retention policies (similar to Nostr relays).
Popular, frequently-accessed data is naturally retained. Unpopular, unreferenced
data may eventually be pruned by individual operators — but content-addressed
copies can be re-uploaded to any node at any time.

---

## 8. The Canonical B3nd DePIN Template

Firecat is the first protocol on B3nd, but the economic model is designed to be
a template. Other B3nd protocols can follow the same pattern:

### 8.1 Template Components

Any B3nd DePIN protocol needs:

1. **A token** — for gas, staking, exchange within the protocol's economy
2. **A schema** — validators that enforce the protocol's rules + gas
   requirements
3. **A subsidy model** — how early users get free access (foundation stake,
   grants, VC funding)
4. **A revenue model** — what makes the protocol self-sustaining (ads,
   subscriptions, marketplace fees, data licensing)
5. **Node operator incentives** — staking requirements, fee shares, slashing
   conditions

### 8.2 Cross-Protocol Node Operation

The B3nd node architecture already supports multiple backends and schema
modules. A single node can serve multiple protocols:

```
Node operator runs:
  ├── Firecat protocol → earns FCAT
  ├── MedChain protocol → earns MCHAIN
  ├── ArtVault protocol → earns ARTV
  └── Same hardware, same bandwidth, different schemas
```

Each protocol's token is independent, but the shared infrastructure makes
operation efficient. Node operators diversify their revenue streams across
protocols.

### 8.3 Inter-Protocol Value Flow

Because all protocols use B3nd URIs and the same storage/replication
infrastructure, cross-protocol interactions are natural:

- A Firecat social post can reference an ArtVault piece (just a URI)
- A MedChain record can use Firecat's identity system (same pubkeys)
- Ad campaigns can span multiple protocols (same user, same attention)

The FCAT token could serve as a bridge currency between protocol-specific
tokens, or each protocol can maintain its own exchange rate. This is a design
decision for the broader B3nd ecosystem, not just Firecat.

---

## 9. Risk Analysis

### 9.1 Chicken-and-Egg: Users Before Advertisers

**Risk:** Advertisers won't join without users. Users won't join without apps.
Apps won't build without users.

**Mitigation:** The foundation subsidizes the entire cold start. €50/month
covers initial infrastructure — less than a single SaaS tool. A small team
builds the first apps. The first users are the community (developers, early
adopters). Advertisers come when the audience reaches meaningful size (10K+
engaged users is enough for niche advertisers).

### 9.2 Token Speculation

**Risk:** The token becomes a speculative asset rather than a utility. Price
volatility makes gas costs unpredictable.

**Mitigation:** Gas prices are denominated in _units_, not in token value. The
protocol adjusts the FCAT cost of a gas unit to maintain stable real-world
costs. If FCAT doubles in price, gas costs half as many FCAT. Users/sponsors
experience stable costs regardless of market price.

### 9.3 Regulatory

**Risk:** Token classified as a security. Ad market faces advertising
regulations.

**Mitigation:** FCAT is a utility token (used for gas, not investment returns).
The foundation is a nonprofit. Ad market must comply with local advertising
regulations (GDPR consent, ad labeling, etc.). User ad preferences are explicit
opt-in, stored in user-controlled URIs.

### 9.4 Competition from Incumbents

**Risk:** Google/Meta lower ad platform fees or launch their own "earn from your
data" programs.

**Honest assessment:** Incumbents CAN do this. They have the audience, the
advertiser relationships, and the engineering capacity. They choose not to
because it would reduce margins, not because they architecturally cannot. If
Firecat becomes a real competitive threat, they will respond.

**What Firecat actually has:**

- **Data portability**: this is structurally difficult for incumbents because
  their business model depends on lock-in. They COULD offer it, but it would
  undermine their entire value proposition. This is an economic constraint, not
  a technical one — and economic constraints can be overridden if the
  competitive pressure is strong enough.
- **Transparency**: on-chain ad delivery attestations, verifiable targeting,
  open protocol. Incumbents could replicate this, but it would expose the
  inefficiencies they currently profit from.
- **Low infrastructure cost**: Firecat doesn't need to match incumbent scale. A
  network serving 10K-100K users well is a viable niche. Incumbents don't
  compete for audiences this small.

**What Firecat does NOT have:**

- Network effects. Incumbents have billions of users. Firecat has none yet.
- Advertiser tooling. Incumbents have mature platforms. Firecat has a protocol.
- Track record. Advertisers need performance data before allocating budget.

The realistic competitive strategy is not to outcompete incumbents head-on, but
to serve audiences and use cases they can't or won't — niche communities,
privacy-conscious users, local businesses wanting direct customer relationships,
and users in markets where incumbent platform fees are prohibitive.

### 9.5 Node Operator Centralization

**Risk:** A few large operators dominate, recreating the data center oligopoly.

**Mitigation:** Staking caps (maximum stake per operator), geographic diversity
requirements, and the low barrier to entry (a phone can be a node) keep the
network distributed. The foundation prioritizes operator diversity in subsidy
allocation.

---

## 10. Implementation Phases

### Phase 0: Foundation (current)

- B3nd SDK and Firecat protocol operational
- Web rig demonstrating app development patterns
- No token, no gas, no ad market

### Phase 1: Gas Infrastructure

- Implement `gas://` schema validators (see companion doc)
- Foundation-sponsored free tier for all writes
- Node operator staking (test tokens)
- _Deliverable: Firecat apps that work with gas semantics, fully subsidized_

### Phase 2: Network Launch

- Token genesis with foundation majority stake
- Real gas enforcement with foundation sponsoring users
- Multi-node network with peer replication
- Operator staking with real tokens
- _Deliverable: Live decentralized network, free for users_

### Phase 3: Ad Market

- `ad://` protocol programs for campaigns, views, settlements
- User ad preference system
- Advertiser self-service tools
- Revenue distribution epochs
- _Deliverable: Self-sustaining revenue from ad market_

### Phase 4: Ecosystem

- Cross-protocol support (multiple B3nd protocols on same nodes)
- Mobile node support (phones as network participants)
- DEX integration for token exchange
- Developer grants and protocol incubation
- _Deliverable: Multi-protocol DePIN ecosystem_

---

## 11. Cost Projection and Growth Modeling

Starting from today's real baseline of €50/month for 8 servers + 1 object
storage bucket, this section models how costs grow as the network scales —
driven primarily by URI count (storage), request rate (compute), and bandwidth
(network).

### 11.1 What Drives Costs

| Cost driver        | What it means                            | What scales it                                 |
| ------------------ | ---------------------------------------- | ---------------------------------------------- |
| **Storage**        | Cumulative URI count × average data size | Total data ever written (minus expired/pruned) |
| **Compute**        | CPU and RAM for serving requests         | Concurrent users × request rate                |
| **Bandwidth**      | Data transferred per month               | Active users × reads/writes per session        |
| **Object storage** | Large blobs (media, documents)           | Content-heavy apps                             |

### 11.2 Assumptions

**Average URI sizes** (including PostgreSQL row overhead, indexes, MVCC):

| URI type               | Raw data  | With DB overhead | Notes                                |
| ---------------------- | --------- | ---------------- | ------------------------------------ |
| Account metadata       | ~500 B    | ~2 KB            | User profiles, preferences, keys     |
| Social post / message  | ~2 KB     | ~6 KB            | Text content, timestamps, signatures |
| Link pointer           | ~200 B    | ~1.5 KB          | Mutable reference to a hash URI      |
| Hash content           | ~5 KB     | ~12 KB           | Immutable content blobs              |
| Gas/attestation record | ~300 B    | ~2 KB            | Debit records, proofs                |
| **Weighted average**   | **~2 KB** | **~5 KB**        | Across all URI types                 |

**User behavior** (per active user per day):

| Activity                                | Writes/day | Reads/day | New URIs/day |
| --------------------------------------- | ---------- | --------- | ------------ |
| Light user (browsing)                   | 5          | 50        | 3            |
| Active user (posting, creating)         | 30         | 200       | 20           |
| Power user (app builder, heavy content) | 100        | 500       | 60           |
| **Blended average**                     | **20**     | **150**   | **10**       |

**Infrastructure pricing** (Hetzner-class, 2026):

| Resource                           | Cost                               |
| ---------------------------------- | ---------------------------------- |
| VPS (4 vCPU, 8GB RAM)              | ~€6-8/month                        |
| Dedicated (8 core, 32GB, 1TB NVMe) | ~€40-60/month                      |
| Object storage                     | ~€3/TB/month                       |
| Bandwidth                          | 10-20 TB/month included per server |

### 11.3 Growth Projection

```
                          Year 0      Year 1       Year 2       Year 3       Year 4
                        (today)     (bootstrap)  (early apps)  (ad market)  (ecosystem)
─────────────────────────────────────────────────────────────────────────────────────────
Active users              ~10        1,000        10,000       100,000      500,000
New URIs/day              100        10,000       100,000      1,000,000    5,000,000
Cumulative URIs           ~10K       ~4M          ~40M         ~400M        ~2B
─────────────────────────────────────────────────────────────────────────────────────────
STORAGE
Raw data (@ 2KB avg)      20 MB      8 GB         80 GB        800 GB       4 TB
With DB overhead (×2.5)   50 MB      20 GB        200 GB       2 TB         10 TB
Object storage (media)    —          10 GB        500 GB       5 TB         50 TB
─────────────────────────────────────────────────────────────────────────────────────────
COMPUTE
Writes/day                200        20K          200K         2M           10M
Reads/day                 1,500      150K         1.5M         15M          75M
Peak req/sec              ~0.1       ~5           ~50          ~500         ~2,500
Servers needed            1          2-3          6-8          20-30        80-100
─────────────────────────────────────────────────────────────────────────────────────────
BANDWIDTH
Write traffic/month       ~180 MB    18 GB        180 GB       1.8 TB       9 TB
Read traffic/month        ~1.4 GB    135 GB       1.35 TB      13.5 TB      67 TB
Total/month               ~1.6 GB    ~150 GB      ~1.5 TB      ~15 TB       ~76 TB
─────────────────────────────────────────────────────────────────────────────────────────
MONTHLY COST
Compute (servers)         €50*       €50-80       €200-400     €1,000-2,000 €4,000-8,000
DB storage (NVMe/SSD)     included   included     €50-100      €200-500     €800-2,000
Object storage            —          €0.03        €1.50        €15          €150
Bandwidth overage         €0         €0           €0           €200-500     €2,000-5,000
─────────────────────────────────────────────────────────────────────────────────────────
TOTAL MONTHLY COST        €50        €50-80       €250-500     €1,500-3,000 €7,000-15,000
─────────────────────────────────────────────────────────────────────────────────────────
Per-user/month            €5.00      €0.05-0.08   €0.025-0.05  €0.015-0.03  €0.014-0.03

* Year 0 is today's actual cost: 8 servers + object storage = €50/month
```

### 11.4 Key Observations

**Storage is the long game.** At 2B cumulative URIs (Year 4), raw storage is ~~4
TB — significant but not extreme. The real cost is in database overhead
(indexes, replication, MVCC) which roughly 2.5× the raw data. Object storage for
media content scales separately and cheaply (~~€3/TB). The concern is not raw
capacity but query performance at scale — which is solved by sharding across
nodes, not buying bigger servers.

**Bandwidth becomes the dominant cost at scale.** At 500K active users doing 150
reads/day, you're moving ~76 TB/month. Hetzner includes 10-20 TB per server, so
with 80-100 servers you have 800 TB-2 PB included. Bandwidth overage only
matters if traffic concentrates on a few nodes — which node operator
distribution solves naturally.

**Per-user cost drops fast.** From €5/user at 10 users to €0.015-0.03/user at
500K users. The infrastructure has strong economies of scale. This is important
for the subsidy model: even at Year 4 scale, the entire network costs
€7,000-15,000/month — far less than a single mid-size SaaS company's AWS bill.

**The transition to distributed operators is natural.** At Year 2-3, when costs
reach €1,000-3,000/month, this is exactly when the ad market launches and
external node operators become economically viable. The foundation doesn't need
to scale to €15K/month on its own — by then, the network should have distributed
operators sharing the load.

### 11.5 Cost Pricing and Gas Unit Calibration

To price gas correctly, map real costs to message operations:

```
Foundation monthly cost:         €500 (Year 2 baseline)
Monthly writes:                  6M (200K/day × 30)
Monthly reads:                   45M (1.5M/day × 30)

Cost per write:                  €500 / 6M ≈ €0.000083 (€0.083 per 1000 writes)
Cost per read:                   effectively free (covered by infrastructure already paid for)

If 1 gas unit = 1 write:
  Gas price = €0.000083 per unit
  Foundation subsidy pool of 10,000 FCAT @ €0.10/FCAT
  = 1,000,000 gas units covered
  = 166 days of Year 2 traffic (6M writes/month ÷ 30 = 200K/day)
```

**How to account for growth:**

| Planning horizon            | Monthly cost  | Funding needed (annual) |
| --------------------------- | ------------- | ----------------------- |
| Year 0-1 (bootstrap)        | €50-80        | €600-960                |
| Year 1-2 (early apps)       | €250-500      | €3,000-6,000            |
| Year 2-3 (ad market launch) | €1,500-3,000  | €18,000-36,000          |
| Year 3-4 (ecosystem)        | €7,000-15,000 | €84,000-180,000         |

The first two years are trivially fundable by a single person or small grant. By
Year 2-3 when costs become meaningful, the ad market should be generating
revenue to cover them. If ad revenue lags, the total exposure is still only
€18-36K/year — the cost of a part-time contractor.

### 11.6 Storage Durability and Pruning

Not all URIs persist forever. Realistic pruning policies reduce long-term
storage:

- **Ephemeral URIs** (gas UTXOs consumed in confirmed checkpoints, session
  tokens): auto-pruned after settlement epoch (hours/days)
- **Mutable URIs**: only latest version stored per node; historical versions are
  content-addressed and can be pruned by replication factor
- **Hash URIs**: immutable, kept as long as referenced by at least one link;
  unreferenced hashes eligible for garbage collection
- **Account data**: persists as long as account is active; inactive accounts (no
  writes for 2+ years) enter cold storage tier

With aggressive pruning, the effective URI count at Year 4 might be 500M active
instead of 2B cumulative — cutting storage costs by 75%.

---

## 12. Summary

The Firecat economic model rests on three beliefs:

1. **The money exists.** Digital advertising generates enough revenue to power
   the entire internet of user apps and infrastructure. The problem is not
   resources — it's distribution. Whether Firecat can capture meaningful ad
   revenue is unproven, but the target market is large enough that even a tiny
   slice is sufficient at Firecat's cost structure.

2. **The infrastructure is achievable.** €50/month today, scaling to
   €7-15K/month at half a million users. The starting cost is trivial. The
   scaling cost is modest. Even if ad revenue never materializes, the foundation
   can sustain the network for years at low cost while the model is refined.

3. **Quality experience is the real advantage.** Not "fairness" in the abstract
   — but a concretely better experience: users own their data and it survives
   app death, developers build without platform rent, advertisers reach willing
   audiences with verifiable delivery, and the entire system runs on
   infrastructure cheap enough for a nonprofit to sustain. The advantage over
   incumbents is not ideology — it's that users, developers, and advertisers all
   get a better deal in measurable, practical terms. Whether this is enough to
   overcome incumbents' network effects is the central bet.

The token (FCAT) enables this by being the universal medium: gas (as UTXOs) for
writes, sqrt-weighted staking for operators, payment for ads, reward for
attention (with withdrawal cliff), and governance for the community. The
founding entity's UTXO pool provides the bridge from zero to self-sustaining.
The ad market — if it works — provides the long-term engine. And B3nd's
architecture ensures that any future protocol can follow the same template, with
honest acknowledgment of what can and cannot be guaranteed.

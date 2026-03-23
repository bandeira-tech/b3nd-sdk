# Founder Decisions Update — Round 4

**Date:** 2026-03-18
**Context:** Founder clarifications on D1 and D2 during Round 4 synthesis review.

---

## Decision D1: Network Trust Model — DECIDED

**Answer: B — Open from v1 with stake-based Sybil resistance**

**Founder clarifications that refine D1:**

1. **The data layer is the crown jewel.** The network is real infrastructure (transport, gossip, validators), but its purpose is to produce and protect a persistent data layer. Everything of value lives in the data layer. Everything communicates through it. The data layer accumulates value over time — more data, more attestations, more history = more financial and social security for content.

2. **Firecat is a content backbone for internet applications.** The analogy is AWS/GCP but community-owned. Developers build on it, advertisers and users fund it, the community operates and owns the infrastructure. The economic model mirrors public cloud but decentralizes ownership and control.

3. **Network topology:**
   - **Mainnet** — primary network, global, source of truth for attestation and economic settlement
   - **Relay networks** — independent, regional, optimize for local speed and availability, connect back to mainnet. These emerge naturally as the network scales — not a separate protocol, just an optimization pattern
   - **Custom networks** — can be created, connect to mainnet as bridges. Emergent capacity from the design

4. **Persistence is first-class.** Data isn't ephemeral messages passing through — it's durable content that the network stores, replicates, and protects. This is what distinguishes firecat from a messaging protocol. The content backbone metaphor is key.

5. **The single primitive drives everything.** All problems are solved at the data layer using the signed, content-addressed data object. The primitive carries its own validation rules via the declared program. Programs define what "valid" means for each type of content. The protocol provides the primitive + attestation mechanism; programs provide the semantics.

**Confidence: High**

**What this unlocks beyond the original scope:**
- Persistence and redundancy storage as a core economic role (not just validation)
- Relay network design as an emergent property, not a designed subsystem
- Content backbone framing for developer relations and go-to-market

---

## Decision D2: Committee Parameters — UPDATED

**Original answer:** D — Dynamic, starting at K=7

**Updated answer:** D — Dynamic, with VRF lottery + roster team formation

**Round 4 evidence update (S2):**
- K=21/T=11 needed for f=0.33 BFT safety (up from estimated K≥15)
- Anti-whale cap (5%) paradoxically increases minimum K by 4-6
- For N≥500 at f=0.33, even K=21 is insufficient → supplementary mechanisms needed

**Founder clarifications that expand D2:**

1. **Spam resistance through slot lottery.** Not everyone can propose at any time. A VRF-based lottery (inspired by Cardano's Ouroboros) determines who is eligible to propose in each slot. You have to be online, listening, and ready. You can't spam proposals — you either won the lottery or you didn't. This is lightweight proof-of-work without energy waste.

2. **Roster "teams" formed per block.** The last block hash (or similar deterministic-but-unpredictable value) determines which validators form the committee for the current block. The matching is based on a hash-vs-pubkey criterion: validators whose pubkey matches the hash pattern are eligible. This creates dynamic "teams" of available players.

3. **Small players benefit from big players.** When a retail validator lands on a team with high-stake validators, they share in the block rewards. The team dynamic means small stakers aren't competing against big stakers — they're cooperating with them. Big stakers provide security liquidity; small stakers provide decentralization and redundancy.

4. **Big players support high-performance applications.** Large stakers can support more demanding applications, provide better SLAs, and contribute more network security. Their higher stake justifies higher rewards, but the team mechanism ensures retail participants benefit from their presence.

5. **Retail accessibility is a design goal.** The participation model should make running a node on consumer hardware viable and rewarded. Validators take on validation, redundancy storage, and relay duties — and are compensated proportionally. The mechanism should incentivize more participants, not fewer.

**Updated parameter table:**

| Parameter | Value | Source |
|-----------|-------|--------|
| Starting K | 7 (testnet), 21 (mainnet) | S2 |
| Threshold T | ceil((K+1)/2) majority | E7, S2 |
| Selection | VRF lottery per slot | D2, Ouroboros-inspired |
| Team formation | Hash-based roster matching | Founder direction |
| Stake cap | 5% max per validator | E2, S2 |
| Scaling | Dynamic with f estimation | E7 |
| Finality checkpoints | Required for N>200 | S2 |

**Confidence: Medium** — Direction is clear, but the specific roster/team mechanism needs research and simulation (see "Mechanism Games" research direction below).

**Open research questions:**
1. What hash-vs-pubkey matching criterion produces fair, unpredictable, grind-resistant team formation?
2. How should block rewards be split within a team? Proportional to stake? Equal per member? Hybrid?
3. How does team size interact with K and T for safety guarantees?
4. What prevents a large staker from manipulating the hash to select favorable teams?
5. How does roster matching interact with the view-change protocol (S4)?

---

## Addendum: Three-Phase Message Lifecycle (2026-03-18)

**Context:** During discussion of D2 mechanism games, the founder clarified a fundamental architectural insight that supersedes the S1 role model and the "Storer" role proposed in the mechanism games research. This addendum captures that understanding and integrates it into D1, D2, and D4.

### The Insight: Rewards Come from Action, Not Passive Holding

The protocol does not pay for storage. Storage is a **side effect of doing useful work** — you store what you need to validate, you store what you need to serve. There is no "Storer" role. The incentive to store is that storing enables you to validate, and validating is where rewards come from.

This leads to a three-phase message lifecycle with distinct economic roles:

### Phase 1: Entry (Gateway)

**What:** Staked nodes that accept content writes from clients — the front door of the network.

**Properties:**
- **Stake-heavy** — significant stake required, because gateways are the first line of defense against spam, malformed data, and malicious injection
- **Fast** — must serve content writes with low latency, because this is the content backbone for internet applications. The user experience of "writing to firecat" must feel like writing to a cloud API
- **Big-player role** — naturally suited to operators with high-performance infrastructure and significant stake. They provide the SLA that applications depend on
- **Economic function:** Gateways earn entry fees for accepting and initially validating messages

### Phase 2: Attestation (Workers)

**What:** A looser, more scalable layer of validators that verify messages against their declared program rules. This is where the bulk of validation happens.

**Properties:**
- **Parallelizable** — multiple attestation workers process different messages simultaneously. No all-to-all coordination required at this phase
- **Asynchronous** — attestation happens after entry but before finality. This decoupling is what enables fast write acceptance at the gateway while maintaining deep validation
- **Specializable** — workers can focus on specific namespaces (e.g., "I validate all messages for the social media protocol"). This lets them:
  - Optimize storage for that namespace's data patterns
  - Cache relevant state for fast validation
  - Know the program rules intimately
  - Get messages into blocks faster by being already-prepared for that message type
- **Retail-accessible** — consumer hardware is viable because workers don't need to handle all traffic, just their chosen namespace(s). Lower stake requirements than gateways or finality nodes
- **Self-organizing** — workers gravitate to namespaces where there's demand (and therefore fees). Popular services attract more attestation workers, which increases throughput and validation redundancy for those services — a virtuous cycle
- **Economic function:** Workers earn attestation fees for each message they validate

### Phase 3: Finality (Committee)

**What:** The staked BFT committee that confirms attested messages into the block — the seal of the network.

**Properties:**
- **Stake-heavy** — BFT safety guarantees depend on honest stake majority in the committee. This is where the K=21/T=11 parameters from S2 apply
- **The endpoint of the pipeline** — a message is only finalized when the committee confirms it. Before that, it's "accepted" (gateway) and "attested" (workers) but not "final"
- **VRF lottery + roster** — committee selection per slot uses the mechanisms described in D2
- **Economic function:** Committee members earn confirmation fees for sealing blocks

### The Pipeline

```
Client write
    │
    ▼
┌─────────────────────┐
│  GATEWAY (Entry)    │  Staked, fast, big-player
│  Accept + initial   │  Earn: entry fees
│  validation         │
└─────────┬───────────┘
          │ message accepted
          ▼
┌─────────────────────┐
│  ATTESTATION        │  Specialized, parallel, retail-accessible
│  WORKERS            │  Earn: attestation fees
│  Deep validation    │
│  against program    │  Workers pick namespaces they care about
│  rules              │  and optimize for those
└─────────┬───────────┘
          │ message attested (N attestations)
          ▼
┌─────────────────────┐
│  FINALITY           │  Staked, BFT committee (K=21/T=11)
│  COMMITTEE          │  Earn: confirmation fees
│  Confirm into block │
└─────────┬───────────┘
          │ message finalized
          ▼
      Block (immutable)
```

### Why This Architecture Works

1. **Fast entry for content serving.** Gateways accept writes immediately — the client doesn't wait for full consensus. This is essential for the content backbone use case. Applications get cloud-like write latency.

2. **Deep validation without blocking writes.** Attestation workers can take the time they need to validate complex program rules without slowing down the entry point. A social media post with image verification takes longer to attest than a simple key-value write, but both enter the system at the same speed.

3. **Scalability through specialization.** The attestation layer scales horizontally by namespace. As a new service launches on firecat, new attestation workers spin up for that namespace. No coordination with workers handling other namespaces. This is how the network scales to serve as a global content backbone.

4. **Retail participation through namespace affinity.** A retail participant picks a namespace they care about — maybe they're a user of that app, or a developer building on it — and runs an attestation worker. They earn proportional to the traffic in that namespace. Consumer hardware is sufficient because they're not handling the entire network's traffic.

5. **Security at the boundaries.** Stake protects the entry and finality points — the two places where bad actors can cause the most damage (injecting garbage, or confirming invalid state). The attestation layer in the middle is where the looseness lives, and that's appropriate because attestation errors are caught by the finality committee.

### Implications for D4 Fee Split

The fee split maps naturally to the three phases:

| Role | Current D4 Label | Phase | Fee Share |
|------|-----------------|-------|-----------|
| Gateway | Storage (25%) | Entry | 25% |
| Attestation workers | Validation (35%) | Attestation | 35% |
| Finality committee | Confirmation (25%) | Finality | 25% |
| Protocol treasury | Treasury (15%) | — | 15% |

The D4 split doesn't need to change — but the *meaning* of each share is now precise. "Storage" fees go to gateways (who store as a side effect of serving writes). "Validation" fees go to attestation workers (the largest share, because this is where the most useful work happens). "Confirmation" fees go to the finality committee.

### Implications for D2 Mechanism Games

The three-phase model reframes the mechanism design space:

- **Gateway selection** needs its own mechanism — which staked nodes are authorized entry points? This is where big-player economics and SLA competition live.
- **Attestation worker incentives** are the retail accessibility game — how do workers choose namespaces? How are attestation fees distributed when multiple workers attest the same message? Is there a minimum attestation count per message?
- **Finality committee** is the existing D2 VRF lottery + roster mechanism. The S2/S4/E7 research applies here directly.

The hash-roster "team" concept from the mechanism games research may apply most naturally to the **attestation layer**, not the finality layer. Teams of attestation workers for a namespace could be formed per-block using the hash-roster mechanism, creating cooperative dynamics where retail workers benefit from being on a team with more experienced workers for that namespace.

### Implications for S1 Architecture

The S1 6-layer architecture should be revised to reflect this three-phase model. The current layers (transport, gossip, data, consensus, attestation, application) conflate network layers with economic roles. The revised model separates:
- **Infrastructure layers** (transport, gossip, sync) — how data moves
- **Economic phases** (entry, attestation, finality) — how data is validated and who gets paid
- **Application layer** (programs, schemas) — what "valid" means for each type of content

### What This Retires

- **The "Storer" role from mechanism games §3.3** — there is no passive storage role. Storage follows function.
- **The "Relay" role as a rewarded position** — relaying is infrastructure, not an economic role. Gateways and workers relay as part of their function.
- **S1's flat validator model** — validators are not a single role. The three phases create natural specialization.

### Open Questions

1. **Attestation threshold:** How many attestations does a message need before it's eligible for finality? Fixed (e.g., 3)? Proportional to fee tier? Proportional to message complexity?
2. **Attestation conflict resolution:** What happens when attestation workers disagree? If 2 of 3 workers say "valid" and 1 says "invalid," does the message proceed to finality?
3. **Gateway authorization:** Is running a gateway permissionless (anyone with sufficient stake) or does it require additional criteria (uptime history, bandwidth SLA)?
4. **Namespace economics:** Can a namespace set its own attestation fee premium? Can a popular service attract workers by offering higher fees?
5. **Cross-namespace attestation:** Can a message reference data from multiple namespaces? If so, who attests it — workers from all referenced namespaces?

---

## Decision D3: Privacy Posture — EXPANDED (2026-03-18)

**Original answer:** Pragmatic privacy — path obfuscation + constant-rate padding, Signal-level default.

**Founder clarification:** Privacy and safety by default, but allow freeform visibility. The social graph has value *to users* — it enables funding via ads that target quality users based on public behavior. The protocol must support both modes seamlessly: private by default, public by choice.

### The Core Tension

| Stakeholder | Wants | Why |
|-------------|-------|-----|
| Users (privacy) | Everything hidden by default | Safety. Control. No surveillance capitalism. |
| Users (economic) | Ability to be visible | Monetization. Discovery. Reputation building. |
| Advertisers | Targetable audiences | ROI on ad spend. Quality over quantity. |
| App developers | Flexible privacy tools | Build for different use cases without protocol fights. |
| Network operators | More public data = more fees | Public graph generates more attestation work = more revenue. |

The insight: these aren't in conflict if **the user controls the boundary.** Privacy is the safe default. Visibility is a conscious economic choice that creates value for all parties.

### The Architecture: Separation of Content and Signal

All user-generated content (UGC) is always signed, encrypted, and obfuscated at the protocol level. Public visibility is achieved through a **reference layer** — app-level data objects that point to private content via hash references, adopting the same mechanics used for hash references in the consensus protocol.

```
PRIVATE LAYER (always, protocol-enforced)     PUBLIC LAYER (opt-in, app-level)
┌──────────────────────────┐                  ┌──────────────────────────┐
│ UGC: signed, encrypted,  │   hash ref       │ App data: profile,       │
│ obfuscated. Lives in     │─────────────────>│ behavior signals,        │
│ user's namespace.        │                  │ preferences, reputation  │
│ Nobody sees this without │                  │ scores. Queryable by     │
│ the user's keys.         │                  │ advertisers/apps.        │
└──────────────────────────┘                  └──────────────────────────┘
```

The hash reference is the bridge — it proves the public signal is derived from real private data without revealing the data itself. This is the same pattern the consensus protocol uses for block references, applied to the privacy-visibility boundary.

### Privacy-Visibility Games

Six canonical game patterns that app developers can compose. Each is an SDK helper built entirely on the single primitive — no protocol changes needed. Each delivers a different privacy-monetization tradeoff.

#### Game 1: Blind Profiles (ZK-Attestable Properties)

**Mechanic:** Users prove properties about their private data without revealing the data. "I am 25-34, interested in technology, based in Europe" — attested by the protocol, without revealing which specific content or interactions prove it.

**How it works:**
- Private content accumulates in the user's namespace (encrypted, obfuscated)
- A "profile program" computes aggregate properties from private data
- The user publishes a **commitment** to these properties (hash of the property set)
- Attestation workers who validate the namespace verify the commitment is correctly derived
- Advertisers target based on committed properties, never seeing the underlying data

**Tradeoff:** High privacy, moderate ad value. Advertisers get demographic/interest targeting but no behavioral granularity. Similar to contextual advertising.

**Compression score:** High — solves privacy + monetization + attestation in one construction. Uses the existing attestation worker pipeline; workers who validate the namespace already have the data to verify commitments.

**SDK helper:** `createBlindProfile(schema, properties, proofLevel)`

#### Game 2: Tiered Visibility (Progressive Disclosure)

**Mechanic:** Content has multiple visibility tiers. Each tier reveals more, pays more. Users upgrade or downgrade at will.

| Tier | Visible to | What's revealed | Revenue multiplier |
|------|-----------|----------------|-------------------|
| 0 | Nobody | Nothing. Fully private. | 0x |
| 1 | Protocol only | Existence + hash. "A message exists." | 1x (base attestation) |
| 2 | Namespace | Content type + metadata. "A photo post about food." | 2-3x |
| 3 | Public graph | Full public content. "Here's my restaurant review." | 5-10x |

**How it works:**
- The data object's program declares its tier
- Each tier uses a different encryption envelope:
  - Tier 0: full encryption, only user's keys
  - Tier 1: hash published, content encrypted
  - Tier 2: metadata in cleartext, content encrypted with namespace-shared key
  - Tier 3: content in cleartext, signed by user
- Users upgrade/downgrade tiers at any time (new data object replaces old, hash-referenced)

**Tradeoff:** Maximum user control. Clear economic incentive to share more (higher revenue), but zero coercion. The protocol processes all tiers identically.

**Compression score:** High — maps directly onto the three-phase pipeline. Gateways accept all tiers. Attestation workers validate per-tier rules. Finality doesn't distinguish.

**SDK helper:** `publish(content, { tier: 2, upgradePolicy: 'user-confirm' })`

#### Game 3: Aggregate Signals (Privacy-Preserving Analytics)

**Mechanic:** Instead of exposing individual user data, the protocol computes and publishes aggregate statistics over groups of users. No individual is identifiable, but the aggregate is valuable for targeting.

**How it works:**
- Users' private data stays private
- A "signal aggregation program" runs over a namespace's data
- Attestation workers compute aggregates: "This namespace has 10K users, 60% interested in tech, median age 28"
- The aggregate is published as a data object in the public graph, hash-referencing the private data set
- Differential privacy noise can be added to prevent de-anonymization

**Tradeoff:** Strongest individual privacy. Advertisers get cohort-level targeting (similar to Google's Topics API / Privacy Sandbox). Revenue flows to the namespace/app, which distributes to users.

**Compression score:** High — uses attestation workers in a new capacity (computing aggregates), which is additional useful work that earns fees.

**SDK helper:** `createSignalAggregator(namespace, schema, privacyBudget)`

#### Game 4: Reputation Markets (Earned Visibility)

**Mechanic:** Users build public reputation scores through verifiable actions. The reputation is public; the actions that built it remain private.

**How it works:**
- User takes actions in private namespaces (posting, engaging, transacting)
- Each action generates a reputation proof (attestation worker signs "this user completed action X")
- Proofs accumulate into a public reputation score
- The score is a data object in the public graph, hash-referencing the proofs
- Apps and advertisers use reputation scores to assess user quality

**Tradeoff:** Users reveal *that* they did things, not *what* they did. "This user has a quality score of 87 based on 1,200 verified actions" is public. The 1,200 actions remain private.

**Why advertisers value this:** Ad fraud is the #1 problem in digital advertising. A protocol-attested reputation score that proves "this is a real, active human" is worth more than behavioral targeting. Quality over granularity.

**Compression score:** Very high — reputation proofs are just attestations flowing through the existing pipeline. Reputation scores are just data objects. No new mechanism needed.

**SDK helper:** `createReputationProgram(actionTypes, scoringFormula, publicFields)`

#### Game 5: Data Unions (Collective Bargaining)

**Mechanic:** Users pool visibility into a collective that negotiates terms with advertisers on behalf of all members. Individual data stays private; the union publishes aggregate access terms.

**How it works:**
- Users join a "data union" (a program/namespace)
- The union's program defines what data members contribute and under what terms
- Advertisers query the union, not individuals
- Attestation workers verify that member data matches claimed properties
- Revenue distributed to members proportional to contribution
- Any member can exit at any time (their data reverts to fully private)

**Tradeoff:** Collective bargaining power + individual privacy. Users get better economic terms than solo. Advertisers get a curated, verified audience.

**This mirrors real-world ad markets:** Publishers aggregate audiences and sell access. The difference is that the aggregation is user-controlled and the publisher is a protocol-level construct, not a company.

**Compression score:** High — a data union is just a namespace with a specific program. No protocol changes needed. Application pattern on the primitive.

**SDK helper:** `createDataUnion(terms, revenueModel, exitPolicy)`

#### Game 6: Consent Receipts (Auditable Privacy)

**Mechanic:** Every visibility decision is itself a data object — a signed, timestamped consent receipt. This creates an auditable trail of what the user agreed to, when, and with whom.

**How it works:**
- App presents cookie/privacy terms (as today)
- User's agreement is captured as a signed data object: "I consent to tier-2 visibility for namespace X, with advertiser Y, until date Z"
- The consent receipt is hash-referenced from the data it applies to
- Attestation workers verify that data access matches active consent receipts
- Revocation: a new consent object supersedes the old one, access revoked at the protocol level

**Tradeoff:** Full GDPR/CCPA compliance built into the data layer. Consent isn't a checkbox — it's a cryptographically signed, protocol-attested data object with revocation. Stronger than any current privacy framework.

**Why advertisers value this:** Provably compliant targeting. No regulatory risk. The consent receipt is the proof. This is currently the most expensive compliance problem in ad-tech.

**Compression score:** Very high — consent receipts are data objects, verification uses existing attestation, revocation uses the existing mutable URI mechanism (with replay protection from S6).

**SDK helper:** `createConsentReceipt(scope, parties, duration, revocationPolicy)`

### The App Developer Menu

Each game is a canonical SDK helper. Developers compose them for their use case:

| Use case | Recommended games | Privacy | Revenue potential |
|----------|------------------|---------|-------------------|
| Private messaging | None (all Tier 0) | Maximum | None from ads |
| Social media | Tiered Visibility + Reputation + Consent | User-controlled | High |
| Content marketplace | Tiered Visibility + Data Unions | Collective | High |
| Analytics platform | Aggregate Signals + Blind Profiles | Group-level | Medium |
| Health/finance apps | Blind Profiles + Consent Receipts | Maximum individual | Low but compliant |
| Ad network | All games composable | Varies per user | Maximum |

### What Ties the Games to the Protocol

The protocol doesn't know about any of these games. Every game is built on:
1. **The single primitive** — signed, content-addressed data object with a program
2. **Hash references** — between private content and public signals (same as consensus block refs)
3. **Programs** — define visibility rules per data object
4. **Attestation workers** — verify compliance with programs and consent
5. **Consent receipts** — first-class data objects, not metadata

**The guarantee:** If content is at Tier 0, no game, no advertiser, no app can see it. Everything above Tier 0 is the user's choice, expressed through programs and consent, verified by attestation workers.

### How This Updates D3

| Aspect | Previous D3 | Updated D3 |
|--------|------------|------------|
| Default | Signal-level privacy | **Still Signal-level** — unchanged |
| Visibility | "Configurable per-application" (vague) | **Six canonical games** with concrete SDK helpers |
| Social graph | "Hide it" | **User-authored, not leaked.** The social graph is explicit data the user publishes, not metadata inferred by the network |
| Ad targeting | Not addressed | **Data layer targeting via public graph.** Network metadata never exposed |
| Consent | Not addressed | **First-class protocol primitive** via consent receipts |
| Revenue model | Not addressed | **Privacy-visibility tradeoff drives the economic model.** Users choose their position on the spectrum |

### Implications for S3 (Traffic Shaping)

S3's constant-rate padding still applies to **all private traffic.** The presence of public data for a user does not weaken the privacy of their private data. The padding ensures an adversary cannot correlate private activity patterns with public activity patterns for the same user.

This is a subtle but important point: a user who has both private medical records and a public social profile must not leak timing correlations between the two. S3 handles this at the network level; the games handle it at the data layer.

### Open Research Questions for D3 Games

1. **Blind profile verification cost:** How much extra work do attestation workers do to verify ZK property commitments? Does this scale with namespace size?
2. **Tier transition attacks:** Can an adversary learn something about Tier 0 content by observing tier upgrades/downgrades? (e.g., "Alice moved something from Tier 0 to Tier 2 at time T")
3. **Aggregate deanonymization:** What differential privacy budget is needed to prevent membership inference in aggregated signals? What's the minimum cohort size?
4. **Data union governance:** How are union terms decided? Majority vote of members? Fixed by the union creator? Can terms change for existing members?
5. **Consent receipt revocation latency:** How quickly does revocation propagate? Can an advertiser cache data before revocation takes effect?
6. **Cross-game composition:** When a user participates in multiple games (Blind Profile + Data Union + Consent), do the privacy guarantees compose safely? Or can the combination leak more than either alone?

---

## Confidence Summary

| # | Decision | Answer | Confidence | Status |
|---|----------|--------|------------|--------|
| D1 | Trust model | Open + stake-based, content backbone | **High** | Decided |
| D2 | Committee | Dynamic, VRF lottery + roster teams | **Medium** | Direction set, mechanism needs research |
| D3 | Privacy | Private by default + 6 visibility games | **High** | Direction decided, games need simulation |
| D4 | Fee split | 25/35/25/15 @ $0.002/msg | High | Decided |
| D5 | Cold-start | Partners + tapering grants | Medium | Decided |
| D6 | KDF | Argon2id 46MiB/t1/p1 | High | Decided |
| D7 | PQ timeline | Phase 0+1 in v1.0, FROST required | High | Decided |

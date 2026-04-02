# Copy Study: B3nd & Firecat

---

## 1. Brand Identity Analysis

### B3nd: Core Identity

B3nd is a **data protocol** --- a small, universal primitive for data ownership.
It is not a product, not a platform, and not a framework. It is infrastructure.
The closest analogies are HTTP, TCP/IP, and DNS: invisible layers that the
entire internet depends on, designed once and designed right.

B3nd's identity rests on a single, non-negotiable principle: **data belongs to
its creator**. Everything else follows from that. The protocol defines four
operations (receive, read, list, delete), uses URIs as its addressing model, and
enforces privacy through client-side encryption rather than access control. It
is schema-agnostic. It does not dictate what you build; it guarantees that
whatever you build, the user's data stays theirs.

The brand should feel like a **foundation** --- literally. Not flashy, not loud,
not trying to sell you something. Present, solid, and quietly indispensable.

**Key identity markers:**

- Open source (MIT license)
- Published on JSR and NPM
- Built by Bandeira Tech
- Protocol families: `mutable://`, `immutable://`, `hash://`, `link://`,
  `msg://`
- Designed for protocol designers, infrastructure builders, and framework
  developers

### Firecat: Core Identity

Firecat is a **living network** built on B3nd. If B3nd is TCP/IP, Firecat is the
internet itself --- the community, the economics, the applications, the nodes,
the participation. It is the canonical template for what a public B3nd network
looks like when it comes alive.

Firecat's identity rests on a different principle: **infrastructure should be
owned by the people who use it**. It combines a DePIN (Decentralized Physical
Infrastructure Network) model with anti-whale tokenomics, flow-optimized
economics, and a free-tier bootstrap system that makes participation accessible
from day one.

The brand should feel like a **movement** --- technically rigorous but
community-driven, economically bold but engineering-clear.

**Key identity markers:**

- Public testnet at fire.cat
- FCAT token with UTXO-based gas semantics
- Three-layer economics: write gas, operator staking, relay rewards
- Sqrt-weighted rewards (anti-whale)
- Free-tier bootstrap: faucets, sponsors, invite vouching
- Audience: app developers, node operators, community participants

### How They Relate

B3nd and Firecat are **distinct but inseparable** --- the way a programming
language is distinct from the ecosystem that grows around it. The relationship
is hierarchical, not lateral:

```
B3nd (protocol layer)
  |
  +--- Firecat (network layer, built on B3nd)
         |
         +--- Applications (built on Firecat)
```

**B3nd does not need Firecat to exist.** Anyone can build their own protocol on
B3nd. Firecat is one implementation --- the canonical one, the reference, the
public network --- but it is not the only possible one.

**Firecat needs B3nd to exist.** Without the protocol layer, Firecat has no
foundation. Every Firecat message, every schema, every URI convention traces
back to B3nd primitives.

This distinction matters enormously for copy. B3nd copy should never mention
tokens, economics, or community governance. Firecat copy should reference B3nd
as its foundation but never conflate the two.

### Target Audience Personas

#### B3nd Personas

**1. The Protocol Designer** (Primary)

- Building their own data system on top of B3nd
- Cares about: correctness, composability, minimalism, specification quality
- Reads: RFCs, academic papers, Hacker News
- Asks: "What are the invariants? What are the guarantees? What doesn't this
  do?"
- Pain point: Every existing solution is either too opinionated or too leaky

**2. The Infrastructure Builder** (Secondary)

- Operating nodes, building SDKs, writing adapters
- Cares about: performance, reliability, operational clarity
- Reads: Systems blogs, monitoring dashboards, deployment docs
- Asks: "How do I run this? What are the failure modes?"
- Pain point: Existing infra couples storage with application logic

**3. The Framework Developer** (Tertiary)

- Building developer tools and frameworks that use B3nd under the hood
- Cares about: developer experience, API surface, adoption
- Reads: Framework docs, changelog posts, migration guides
- Asks: "Can I abstract this cleanly? Will my users understand it?"
- Pain point: No clean primitive exists for user-owned data

#### Firecat Personas

**1. The App Developer** (Primary)

- Building applications on the Firecat network
- Cares about: documentation quality, SDK stability, economic predictability
- Reads: API docs, tutorials, example apps, cost calculators
- Asks: "How much does this cost? How do I authenticate users? What schemas
  exist?"
- Pain point: Building on centralized platforms means losing users' trust and
  their own autonomy

**2. The Node Operator** (Secondary)

- Running Firecat infrastructure for relay rewards
- Cares about: uptime requirements, reward mechanics, hardware specs, staking
  terms
- Reads: Operational guides, reward dashboards, network status pages
- Asks: "What's my ROI? What are the staking requirements? How do I monitor
  this?"
- Pain point: Existing networks concentrate rewards among whales and early
  adopters

**3. The Community Participant** (Tertiary)

- Using Firecat-powered apps, holding FCAT, participating in governance
- Cares about: fairness, accessibility, community health, free-tier availability
- Reads: Community forums, economic explainers, onboarding guides
- Asks: "Can I participate without spending money? Is this actually fair?"
- Pain point: Every "community" network is actually controlled by a small group
  of insiders

---

## 2. Tone & Voice Guide

### B3nd Voice

**In three words:** Precise. Architectural. Quiet.

**The feeling:** Reading B3nd copy should feel like reading a well-written RFC,
a Unix man page, or Apple's developer documentation. Every word earns its place.
There is no filler. The confidence comes from clarity, not volume.

**Guiding principle:** Say less. Mean more.

#### Voice Attributes

| Attribute         | Description                                                                                    | Example                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Precise**       | Every technical claim is exact. No hand-waving, no approximations, no "basically."             | "B3nd defines four operations: receive, read, list, delete." --- not "B3nd lets you do all the usual data stuff."                                                                         |
| **Confident**     | The protocol knows what it is. No hedging, no apologizing, no comparing itself to competitors. | "Data belongs to you." --- not "We believe data should probably belong to users."                                                                                                         |
| **Minimal**       | If a sentence can be shorter, make it shorter. If a section can be cut, cut it.                | "URI-based. Schema-agnostic. Client-encrypted." --- not "Our innovative protocol leverages URI-based addressing with a schema-agnostic approach and cutting-edge client-side encryption." |
| **Architectural** | The language should evoke structure, foundation, building. Not products, not features.         | "A foundation layer for data ownership." --- not "The ultimate data ownership solution."                                                                                                  |

#### What B3nd Copy Sounds Like

> "B3nd is a data protocol. Four operations. URI-based addressing. Client-side
> encryption. You own your data --- not because we let you, but because the
> protocol makes anything else impossible."

> "Five protocol families. One principle. `mutable://`, `immutable://`,
> `hash://`, `link://`, `msg://` --- each with a single, clear purpose."

> "Schema-agnostic by design. B3nd doesn't care what your data looks like. It
> cares who it belongs to."

#### What B3nd Copy Does NOT Sound Like

- "Revolutionizing the data economy with next-gen blockchain-adjacent protocol
  technology!" (hype)
- "We're building the future of Web3 data sovereignty, fam." (crypto-bro)
- "Imagine a world where your data is truly yours..." (unnecessary emotion)
- "Our proprietary protocol stack delivers enterprise-grade solutions..."
  (corporate filler)
- "gm, data ownership is going to be huge." (crypto-Twitter)

#### The Key Tension

B3nd is deeply technical --- it's a protocol specification, not an app. But it
cannot afford to be alienating. The copy must invite curiosity without dumbing
down the subject matter. The solution is **clarity over simplification**. Don't
make the protocol sound simpler than it is; make the explanation clearer than
anyone expects.

**Wrong approach:** "Think of B3nd like a digital filing cabinet for your data!"
**Right approach:** "B3nd is a URI-based data protocol. If you've used HTTP, you
already understand the model."

#### Sentence Structure Preferences

- Favor short declarative sentences.
- Use fragments deliberately for emphasis. Like this.
- Lead with the subject, not with preamble.
- Prefer active voice. The protocol does things; things don't happen to it.
- Use code inline when referencing protocol concepts: `receive`, `read`, `list`,
  `delete`.

#### Words and Phrases to Use

- Protocol, primitive, layer, foundation, specification
- Owns, belongs, guarantees, enforces
- URI, schema, encryption, operation
- Design, architecture, compose, build
- Open, standard, minimal, precise

#### Words and Phrases to Avoid

- Revolutionary, disruptive, next-gen, cutting-edge
- Blockchain (unless technically accurate in context)
- Web3, dApp, DeFi, NFT
- Solution, platform, ecosystem (for B3nd --- these words belong to Firecat)
- Innovative, groundbreaking, game-changing
- Leverage, utilize, synergy

---

### Firecat Voice

**In three words:** Bold. Community-driven. Clear.

**The feeling:** Reading Firecat copy should feel like reading Stripe's
developer docs merged with a cooperative manifesto. Technically precise when it
needs to be, economically literate always, and animated by genuine conviction
that infrastructure can be owned by the people who depend on it.

**Guiding principle:** Conviction backed by math.

#### Voice Attributes

| Attribute                 | Description                                                                                             | Example                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Energetic**             | Firecat is alive --- a network, a community, a movement. The copy should have momentum.                 | "The network is live. Nodes are running. Builders are shipping." --- not "Firecat is currently in a testnet phase."                                                                    |
| **Community-first**       | Every message centers the participant, not the technology.                                              | "Run a node. Earn rewards. Own the infrastructure you depend on." --- not "Our decentralized node architecture enables distributed reward allocation."                                 |
| **Economically literate** | Firecat's tokenomics are sophisticated. The copy should explain them with confidence, not mystify them. | "Sqrt-weighted rewards mean one whale can't outrun a thousand participants." --- not "Our innovative anti-whale tokenomics leverage square-root-based reward distribution mechanisms." |
| **Bold**                  | Firecat is making a claim: the current model is broken, and this is a real alternative. Say it plainly. | "Advertising is adversarial. Data hostage dynamics are the norm. Firecat is the exit." --- not "We humbly suggest there might be a better way to handle data."                         |

#### What Firecat Copy Sounds Like

> "The internet's infrastructure is owned by five companies. Firecat is owned by
> everyone who runs it."

> "FCAT isn't a speculative token. It's gas. Every message costs a fraction of a
> cent. Every node earns for relaying it. The math is simple; the implications
> aren't."

> "No burning. No whales. No landlords. Firecat's economics are designed for
> flow, not accumulation."

> "Start for free. A faucet, a sponsor, or a friend's voucher --- that's all you
> need. The network grows when the barrier to entry is zero."

#### What Firecat Copy Does NOT Sound Like

- "Join the Firecat army! We're going to the moon!" (crypto hype)
- "The corrupt centralized powers will fall before our decentralized
  revolution!" (preachy)
- "Firecat will replace Google, Facebook, and Amazon." (over-promising)
- "Web3 is the future and Firecat is the next big thing." (cliche)
- "WAGMI, frens. Stake and earn passive income forever." (pump language)

#### The Key Tension

Firecat is proposing something genuinely radical --- community-owned
infrastructure with anti-whale economics and no burning. This is a revolutionary
idea. But the copy must describe it with **engineering clarity**, not
revolutionary fervor. Let the economics speak for themselves. The conviction
should come from the precision of the model, not from rhetorical volume.

**Wrong approach:** "Firecat will DESTROY the centralized internet! Join the
revolution!" **Right approach:** "Centralized infrastructure creates adversarial
incentives. Firecat replaces them with math: sqrt-weighted rewards,
flow-optimized tokenomics, and a network that gets stronger as it grows."

#### Sentence Structure Preferences

- Mix short punchy statements with clear technical explanations.
- Use parallel structure for lists of benefits or features.
- Address the reader directly: "you," "your node," "your data."
- Use concrete numbers and mechanics when explaining economics.
- Let conviction emerge from specificity, not adjectives.

#### Words and Phrases to Use

- Network, community, participate, earn, operate, build
- Flow, reward, stake, relay, gas
- Own, yours, public, open, fair
- Bootstrap, faucet, vouch, sponsor
- Infrastructure, node, operator, builder

#### Words and Phrases to Avoid

- Moon, army, fam, wagmi, gm
- Passive income, get rich, 100x
- Disrupt, kill, destroy (when talking about competitors)
- Web3, metaverse, NFT (unless technically precise)
- Trustless (prefer "trust-minimized" or describe the actual mechanism)

---

## 3. Key Messages & Headlines

### B3nd Website

#### Hero Section

**Headlines (3 options):**

1. **"The data protocol."** Clean. Definitive. Uses the definite article
   deliberately --- not "a" data protocol, but "the" data protocol. Asserts
   category ownership.

2. **"Four operations. Your data."** Concrete and immediate. Communicates both
   the minimalism of the protocol and the ownership model in five words.

3. **"Own your data at the protocol level."** Slightly more explanatory. Works
   well if the audience needs more context before engaging.

**Taglines (3 options):**

1. **"A URI-based protocol for data that belongs to you."** Technically precise.
   Communicates the three key facts: URI-based, protocol, user-owned.

2. **"Receive. Read. List. Delete. Nothing else. Nothing less."** Enumerates the
   four operations. The rhythm is deliberate --- it sounds like a specification,
   because it is one.

3. **"The foundation layer for data ownership."** Architectural metaphor.
   Positions B3nd as infrastructure, not product.

---

#### Section: Protocol Overview

**Headline:** "A small protocol with a large guarantee."

**Description:** B3nd defines four operations over URI-addressed data:
`receive`, `read`, `list`, and `delete`. It is schema-agnostic,
encryption-first, and designed to be the smallest possible primitive for data
ownership. Think HTTP, but for data you actually control.

---

#### Section: Code Examples

**Headline:** "See it. Ship it."

**Description:** B3nd is available on JSR and NPM. The API surface is minimal by
design --- if you can write a fetch call, you can write to B3nd. Below are
working examples for each of the four operations.

---

#### Section: Data Ownership

**Headline:** "Ownership is not a feature. It's the protocol."

**Description:** Most platforms promise you own your data, then store it behind
their access controls. B3nd takes a different approach: client-side encryption
means your data is unreadable without your keys. Ownership isn't enforced by
policy. It's enforced by math.

---

#### Section: Privacy

**Headline:** "Privacy through encryption, not permission."

**Description:** B3nd does not use access control lists, role-based permissions,
or server-side gatekeeping. Data is encrypted on the client before it ever
leaves your device. The server stores ciphertext. It cannot read what it cannot
decrypt.

---

#### Section: Node Operation

**Headline:** "Run the protocol."

**Description:** B3nd nodes are the infrastructure layer. They store encrypted
data, respond to URI requests, and enforce protocol guarantees. Running a node
means running the protocol itself --- no application logic, no opinions, just
the four operations.

---

#### Section: Developer Resources

**Headline:** "Build on the foundation."

**Description:** Everything you need to build with B3nd: the protocol
specification, SDK documentation, package references for JSR and NPM, and
working examples. B3nd is open source under the MIT license.

---

### Firecat Website

#### Hero Section

**Headlines (3 options):**

1. **"Infrastructure, owned by everyone."** Direct statement of the core
   proposition. "Everyone" does the heavy lifting --- it immediately
   communicates community ownership without jargon.

2. **"The network you own by running it."** Action-oriented. Ties ownership to
   participation, which is the core economic thesis.

3. **"Data infrastructure without landlords."** Provocative but precise.
   "Landlords" is a metaphor that communicates the problem (rent-seeking
   intermediaries) and the solution (ownership) simultaneously.

**Taglines (3 options):**

1. **"A community-owned data network built on the B3nd protocol."** Clear,
   accurate, and establishes the relationship to B3nd. Works well for audiences
   who already know B3nd.

2. **"Run a node. Earn rewards. Own the network."** Three imperatives.
   Communicates the participation loop in nine words.

3. **"Where your infrastructure works for you, not against you."** Positions
   against adversarial dynamics (advertising, data hostage) without naming them
   directly.

---

#### Section: What is Firecat

**Headline:** "A protocol for the public network."

**Description:** Firecat is the canonical protocol built on B3nd. It defines the
schemas, authentication model, and URI conventions for a public, community-owned
data network. If B3nd is the foundation, Firecat is the building --- open to
everyone, owned by the people inside it.

---

#### Section: The Economic Model

**Headline:** "Economics designed for flow, not accumulation."

**Description:** Firecat's economic model is built on three principles: no
burning, no whales, no barriers. Write gas funds the network per-message.
Operator staking secures it. Relay rewards sustain it. The math is public, the
incentives are aligned, and the model is designed to get fairer as it scales.

---

#### Section: Tokenomics (FCAT)

**Headline:** "FCAT: gas, not speculation."

**Description:** FCAT is the native token of the Firecat network. It powers
write operations through UTXO-based gas semantics --- every message costs a
predictable fraction of a cent. Rewards are sqrt-weighted, meaning one large
holder cannot outrun a thousand small participants. There is no burning. Tokens
flow; they don't disappear.

---

#### Section: For Developers

**Headline:** "Build apps on infrastructure you can trust."

**Description:** Firecat gives you defined schemas, predictable costs, and a
network that cannot hold your users' data hostage. Ship applications that
respect user ownership by default. The testnet is live at fire.cat.

---

#### Section: For Node Operators

**Headline:** "Run the network. Earn from it."

**Description:** Firecat nodes relay messages and earn FCAT rewards. Staking
secures the network; uptime earns from it. The reward model is sqrt-weighted ---
designed so that a thousand small operators collectively outweigh a single
whale. This is DePIN that actually decentralizes.

---

#### Section: For the Community

**Headline:** "Start for free. Stay because it's fair."

**Description:** Firecat's bootstrap model eliminates the barrier to entry.
Faucets, sponsors, and invite vouching mean you can participate without spending
anything. The network grows when anyone can join --- not just those who can
afford to.

---

#### Section: The Problem / Vision

**Headline:** "The internet has a landlord problem."

**Description:** Today's infrastructure is concentrated in the hands of a few
companies. They monetize your attention through adversarial advertising. They
hold your data hostage to keep you on their platform. They extract rent from
every developer who builds on their soil. Firecat is the alternative: a network
where the infrastructure is owned by the people who use it, the economics reward
participation over accumulation, and the data belongs to the person who created
it.

---

## 4. Messaging Hierarchy

### B3nd

#### Primary Message

**"B3nd is a data protocol that guarantees user ownership at the protocol
level."**

This is the single sentence that every piece of B3nd copy should ultimately
support. If someone reads nothing else, they should walk away knowing: B3nd is a
protocol, it's about data, and ownership is structural, not optional.

#### Secondary Messages

1. **Minimalism is the design.** Four operations. URI-based addressing.
   Schema-agnostic. B3nd is deliberately small because the best protocols are
   the ones that constrain the least while guaranteeing the most.

2. **Privacy is mathematical, not managerial.** Client-side encryption means the
   protocol cannot violate your privacy even if it wanted to. There are no
   access controls to misconfigure, no admin roles to abuse, no server-side keys
   to leak.

3. **B3nd is infrastructure, not product.** It is designed to be built on, not
   used directly. Protocol designers, infrastructure builders, and framework
   developers are the audience --- not end users.

4. **Open and composable.** MIT licensed, published on JSR and NPM, designed to
   be embedded in other systems. B3nd is a primitive, not a platform.

#### Proof Points

- **Four operations only:** `receive`, `read`, `list`, `delete` --- nothing
  more, by specification
- **Five protocol families:** `mutable://`, `immutable://`, `hash://`,
  `link://`, `msg://` --- each with distinct semantics
- **Client-side encryption:** Data is ciphertext on the server; the protocol
  never handles plaintext
- **Schema-agnostic:** B3nd enforces no data shape; any schema can be layered on
  top
- **MIT license:** Fully open source, no usage restrictions
- **JSR and NPM packages:** Production-ready, installable today
- **Built by Bandeira Tech:** An identifiable, accountable engineering team

---

### Firecat

#### Primary Message

**"Firecat is a community-owned data network where the economics reward
participation, not accumulation."**

This is the single sentence that every piece of Firecat copy should support. If
someone reads nothing else: community-owned, data network, participation over
accumulation.

#### Secondary Messages

1. **The economic model is the product.** Sqrt-weighted rewards, no burning,
   flow-optimized tokenomics, and free-tier bootstrap are not features --- they
   are the fundamental design of the network. The economics determine who
   benefits, and Firecat's economics are designed so everyone does.

2. **The barrier to entry is zero.** Faucets, sponsors, and invite vouching
   create multiple pathways to free participation. The network grows fastest
   when anyone can join.

3. **Firecat solves real, named problems.** Infrastructure concentration,
   adversarial advertising, and data hostage dynamics are not abstract threats
   --- they are the current default. Firecat is an engineering response to each.

4. **Built on B3nd.** Firecat inherits B3nd's protocol guarantees: user-owned
   data, client-side encryption, URI-based addressing. The network layer is
   strong because the protocol layer is sound.

#### Proof Points

- **Sqrt-weighted rewards:** Mathematical proof that whales cannot dominate ---
  reward grows as the square root of stake, flattening the curve
- **UTXO-based gas:** Per-message write costs with predictable pricing, modeled
  on Bitcoin's UTXO system
- **No token burning:** Tokens circulate; they are never destroyed. The
  economics are flow-based, not deflationary
- **Three-layer model:** Write gas (user pays per message), operator staking
  (nodes secure the network), relay rewards (nodes earn for uptime and
  throughput)
- **Free-tier bootstrap:** Faucets dispense starter FCAT; sponsors can cover
  costs for new users; invite vouching lets existing users bring others in at no
  cost
- **Live testnet:** fire.cat is operational and publicly accessible
- **DePIN model:** Physical infrastructure (nodes) owned and operated by
  community members, not a central company
- **Built on B3nd:** Inherits all protocol-level guarantees of data ownership
  and privacy

---

## 5. Differentiation Matrix

| Dimension                | B3nd                                                                   | Firecat                                                                              |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **What it is**           | A data protocol                                                        | A data network                                                                       |
| **Mission**              | Define the smallest possible primitive for data ownership              | Build a community-owned network where economics reward participation                 |
| **Audience**             | Protocol designers, infrastructure builders, framework developers      | App developers, node operators, community participants                               |
| **Tone**                 | Precise, minimal, architectural, quiet                                 | Energetic, community-first, economically literate, bold                              |
| **Visual metaphor**      | A foundation. Bedrock. A specification document.                       | A living network. A city with no landlords. Fire spreading.                          |
| **Hero statement**       | "The data protocol."                                                   | "Infrastructure, owned by everyone."                                                 |
| **Call to action**       | "Read the spec." / "Install the package." / "Build on the foundation." | "Run a node." / "Start for free." / "Join the network."                              |
| **Relationship to user** | Tool-maker to tool-maker                                               | Community to community member                                                        |
| **Success looks like**   | Other protocols are built on B3nd; developers treat it like HTTP       | Thousands of nodes, millions of users, a self-sustaining economy                     |
| **Economic language**    | None. B3nd has no token, no economics, no incentive layer.             | Central. FCAT, gas, staking, rewards, flow, faucets.                                 |
| **Competitor framing**   | "Every existing data layer is either too opinionated or too leaky."    | "The internet has a landlord problem."                                               |
| **Time horizon**         | Long-term infrastructure. Decades. Like TCP/IP.                        | Living network. Growing now. Measurable quarter over quarter.                        |
| **Emotional register**   | Calm confidence                                                        | Urgent conviction                                                                    |
| **What it avoids**       | Hype, buzzwords, emotion, product language                             | Preachiness, over-promising, speculation language, Web3 cliches                      |
| **Key tension**          | Deeply technical but not alienating                                    | Revolutionary economics described with engineering clarity                           |
| **Open source posture**  | MIT license, public packages, contribute if you want                   | Open protocol, public testnet, community governance, active participation encouraged |
| **Proof model**          | "Here is the specification. Read it."                                  | "Here is the math. Run the numbers."                                                 |

---

## Appendix: Quick Reference Card

### When writing B3nd copy, ask:

1. Is every word necessary?
2. Would this sentence be at home in an RFC?
3. Am I describing the protocol, or am I describing a product?
4. Is the confidence coming from clarity or from adjectives?
5. Would a systems engineer nod while reading this?

### When writing Firecat copy, ask:

1. Am I centering the participant or the technology?
2. Is my economic claim backed by a specific mechanism?
3. Would this sentence survive scrutiny from a skeptic?
4. Am I showing conviction through specificity or through volume?
5. Would a developer trust this? Would a community member feel welcomed by it?

### Cross-check: Are the two voices staying separate?

- If your B3nd copy mentions tokens, economics, or community governance:
  **stop**. That's Firecat.
- If your Firecat copy forgets to mention B3nd as the foundation: **add it**.
  The relationship matters.
- If your B3nd copy sounds excited: **rewrite it**. B3nd is calm.
- If your Firecat copy sounds dry: **rewrite it**. Firecat has energy.
- If you can't tell which entity a sentence belongs to: **it belongs to
  neither**. Rewrite it.

---

_This copy study is a living document. As B3nd and Firecat evolve, the messaging
should evolve with them --- but the core identities should remain stable. B3nd
is the foundation. Firecat is what you build on it. The voices are distinct
because the missions are distinct._

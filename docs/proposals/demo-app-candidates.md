# Demo App Candidates for B3nd

**Status:** Research document
**Date:** 2026-03-03
**Purpose:** Evaluate which demo application to build first, optimized for: NLnet grant applications, 2-minute video demos, and developer community traction.

---

## Selection Criteria

Every expert in the funding strategy agreed: B3nd needs a tangible demo app before anything else. The right demo must satisfy multiple audiences simultaneously:

| Audience | What they need to see |
|---|---|
| **NLnet reviewers** | Data sovereignty, open protocol, EU policy alignment, clear public interest |
| **Developers** | Clean API, "I could build this in a weekend" simplicity, real utility |
| **Potential hires** | A vision worth joining, technical taste, shipping culture |
| **VC/accelerators** | Product-market fit signal, "people actually want this" |
| **General audience** | A 2-minute video where the value is obvious without technical explanation |

### Design Constraints from B3nd's Current State

The PRD (Firecat App Exploration) stress-tested three apps and found clear patterns. The demo must **play to B3nd's strengths** and **avoid its current gaps**:

**Play to these strengths:**
- Small, coherent API (5 methods + `send()` + `encrypt`)
- Cryptographic identity (Ed25519 keypairs as user identity)
- Content-addressed envelopes (tamper-evident audit trails for free)
- Client-side E2EE with strong primitives (X25519 + AES-GCM)
- No vendor lock-in (data is JSON at URIs, export is trivial)
- Uniform client interface (same code works on 7 backends)
- Offline-first architecturally natural (IndexedDB + HTTP sync)

**Avoid these gaps:**
- No server-side querying or aggregation (don't need search across users)
- No real-time subscriptions (async/refresh-based is fine)
- No concurrency control (single-user primary writes)
- No key lifecycle management (keep key UX simple or defer)
- No integration with external services (no email, webhooks, payments)

**Practical constraints:**
- Buildable by a solo founder in 4-8 weeks
- Must produce a compelling 2-minute demo video
- Should be a real app someone would actually use, not a toy

---

## The Candidates

### 1. Signed Document Vault (RECOMMENDED)

**Tagline:** "Your documents. Your signatures. Your proof."

**What it is:** A personal document vault where every file is signed with your cryptographic identity, encrypted so only you can read it, and optionally shareable via password-protected links. Think "notarized Google Drive" where you can prove you authored something, prove it hasn't been tampered with, and prove when it existed.

**Why this is the best choice:**

1. **Plays to every B3nd strength at once:**
   - Upload a document → encrypt → sign → store at `mutable://accounts/{key}/vault/{docId}` (encryption + identity + write path)
   - Content-addressed hash → tamper-evident proof → `hash://sha256/{hash}` (content addressing)
   - Share via password link → `SecretEncryptionKey.fromSecret(password)` (zero-account sharing)
   - Multi-device sync → same data at same URI, accessed via HTTP from any device (uniform client interface)
   - Export everything → `list()` + `readMulti()` → JSON dump (no vendor lock-in)

2. **Avoids every gap:**
   - Single-user primary (no concurrency issues)
   - Browse your own files by folder/tag URI paths (no server-side queries needed)
   - No real-time collaboration required
   - No external service integration needed
   - Simple key model (one keypair per user)

3. **NLnet alignment is almost perfect:**
   - Data sovereignty: "your documents live at URIs you control, encrypted with keys only you hold"
   - GDPR data portability: export is `list()` + `read()` — it's built into the protocol
   - eIDAS 2.0 adjacency: cryptographic signing of documents is the foundation of EU digital identity
   - Open protocol: anyone can build a compatible client, the data format is open

4. **The 2-minute demo writes itself:**
   - 0:00 — Create an identity (one click, no email/password)
   - 0:15 — Upload a document, watch it get encrypted and signed
   - 0:30 — Show the cryptographic proof: hash, signature, timestamp
   - 0:45 — Share it with someone via a password link (they read it without signing up)
   - 1:00 — Revoke access, export all data to a zip
   - 1:15 — Open the same vault from another device (same identity, same data)
   - 1:30 — Show the audit trail: every change is a hash-chained envelope
   - 1:45 — "All of this is 200 lines of code on an open protocol. No cloud vendor. No lock-in."

5. **Emotionally resonant with real people:**
   - Freelancers want proof of deliverables
   - Creatives want proof of original authorship
   - Anyone burned by Google Drive/Dropbox account lockouts wants control
   - Legal professionals want tamper-evident document chains

**Technical implementation sketch:**

```
URI structure:
mutable://accounts/{userKey}/vault/
  profile                          -- user display name, avatar (signed)
  folders/{folderId}/metadata      -- folder name, color (signed)
  docs/{docId}/metadata            -- filename, type, size, tags (signed + encrypted)
  docs/{docId}/content             -- file content (signed + encrypted)
  docs/{docId}/shares/{shareId}    -- password-encrypted copy for sharing
  audit-head                       -- pointer to latest audit entry

hash://sha256/{hash}               -- content-addressed audit entries
link://accounts/{userKey}/vault/audit-head  -- chain head pointer
```

**Build estimate:** 4-6 weeks for a polished web app with the core flow.

**Risk:** Document vaults are a crowded space (Tresorit, Proton Drive, Cryptpad). The differentiation must be "open protocol + cryptographic proof + no vendor" rather than features.

---

### 2. Proof-of-Authorship / Timestamping Service

**Tagline:** "Prove you created it. Prove when. Prove it hasn't changed."

**What it is:** A lightweight tool where you paste text, upload a file, or link to content — and get a tamper-evident, cryptographically signed, content-addressed proof. Like a digital notary. You can share the proof URL and anyone can verify it without an account.

**Why it's strong:**

1. **Showcases B3nd's most unique primitive:** Content-addressed hashing (`hash://sha256/{hash}`) combined with Ed25519 signatures. No other consumer-facing app makes this tangible. Most people have never *seen* a cryptographic proof outside of blockchain explorers.

2. **Tiny scope, huge impact:** The core app is: hash + sign + store + verify. Maybe 100 lines of B3nd code. This means it can be built in 2 weeks and polished for 2 more.

3. **NLnet loves infrastructure with public benefit:** A timestamping service is digital public infrastructure. It's useful for journalists (prove a source existed at a time), researchers (prove priority of ideas), artists (prove original creation), and legal contexts (prove a contract was signed).

4. **The demo is dead simple:**
   - Paste some text → get a signed, timestamped proof at a `hash://` URI
   - Share the URI → anyone verifies the signature and content
   - Modify one character → hash changes → proof breaks → tamper evident
   - "This is what a message looks like. Every message on B3nd works this way."

5. **Bridge to the book:** This demo is literally Chapter 6 ("The Signed Announcement") + Chapter 9 ("The Audit Trail") of "What's in a Message" made tangible. The demo could link directly to the book chapters.

**Technical implementation sketch:**

```
URI structure:
hash://sha256/{hash}                                    -- the proof itself
mutable://accounts/{userKey}/proofs/index/{timestamp}   -- user's proof index
mutable://open/proofs/verify/{hash}                     -- public verification page
```

**Build estimate:** 2-3 weeks for a functional web tool.

**Risk:** Narrow utility. A timestamping tool is impressive to technically savvy people but might not resonate with NLnet reviewers as a "Next Generation Internet" contribution. It's more of a primitive than a product.

**Verdict:** Excellent as a secondary demo or as a feature within the document vault, but too narrow to be the *primary* demo.

---

### 3. Personal Data Locker (Portable Identity + Data Export)

**Tagline:** "One identity. Your data. Any app."

**What it is:** A personal data store where your identity is a keypair (no email signup), your data lives at URIs you own, and any compatible app can read/write your data with your permission. The demo shows: create identity → store data → export to another node → same data, new provider.

**Why it's compelling:**

1. **Directly addresses EU Data Act and GDPR data portability:** The EU Data Act (effective September 2025) requires data portability between services. B3nd makes this trivial by design — your data is JSON at URIs, export is `list()` + `read()`, import is `receive()`. This is the most politically fundable narrative for NLnet.

2. **Demonstrates B3nd's "same interface, any backend" story:** The demo could show: data written to IndexedDB (offline) → synced to HTTP node → exported → imported to a different node. Same URIs, same data, zero migration effort.

3. **Solid protocol comparison is favorable:** The W3C Solid project (funded by NLnet multiple times) promises the same vision but has struggled with complexity and adoption. B3nd's approach is simpler: 5 API methods vs. Solid's full HTTP/LDP stack. If the demo can show "Solid's vision, 1/10th the complexity," that's a powerful story.

4. **The "aha moment" is provider switching:** "Watch me move all my data from Server A to Server B in 3 seconds. No export wizard. No CSV download. No data loss. Because the data was never locked to a server — it's addressed to *me*."

**Technical implementation sketch:**

```
URI structure:
mutable://accounts/{userKey}/
  profile                    -- name, avatar (signed)
  contacts/{contactId}       -- address book entries (signed + encrypted)
  notes/{noteId}             -- personal notes (signed + encrypted)
  bookmarks/{bookmarkId}     -- saved links (signed + encrypted)
  settings                   -- app preferences (signed + encrypted)
```

**Build estimate:** 4-6 weeks for a polished experience with the migration demo.

**Risk:** "Personal data store" is a graveyard of failed projects (Solid, HAT/Dataswyft, MyData). The concept is compelling in theory but has never achieved consumer traction. The risk is being perceived as "yet another PDS that nobody will use."

**Mitigation:** Position it not as "a new PDS platform" but as "a demo of what the B3nd protocol makes possible" — a proof-of-concept that any developer can recreate.

---

### 4. Encrypted Clipboard / Secure Share

**Tagline:** "Share anything. Encrypted. No signup. No trace."

**What it is:** Paste text, drop a file, or type a note → get an encrypted link → recipient enters the password you give them → content decrypts in their browser → optionally auto-deletes after reading. Like Pastebin meets Signal.

**Why it's interesting:**

1. **The simplest possible demo of E2EE on B3nd:** Write → encrypt with password → store at URI → share link → recipient decrypts. Five steps, five API calls, zero accounts.

2. **Immediately useful:** People share passwords, API keys, sensitive documents, and personal notes every day via insecure channels (Slack, email, SMS). This solves a real daily problem.

3. **Shows "zero-knowledge server" concretely:** The node never sees plaintext. You can show the server-side data and it's gibberish. This is a powerful visual for privacy-conscious audiences and NLnet reviewers.

4. **Viral mechanics:** Every share teaches the recipient about B3nd. "This was shared using B3nd — an open protocol for encrypted, user-owned data."

5. **Tiny build scope:** 2-3 weeks. Maybe the simplest possible demo that still has real utility.

**Technical implementation sketch:**

```
URI structure:
mutable://open/share/{shareId}    -- encrypted payload (no auth needed to write)
                                  -- or use hash:// for immutable shares
```

**Build estimate:** 2-3 weeks.

**Risk:** "Encrypted paste" is a commodity. PrivateBin, 0bin, OnionShare, Firefox Send (RIP) — the space is crowded. The B3nd angle (open protocol, no vendor lock-in, self-hostable) is real but not obviously differentiated to a casual observer.

**Verdict:** Excellent secondary demo or "gateway drug" — the tool people discover first before learning about the protocol. Not deep enough to be the primary demo for NLnet.

---

### 5. The Book Reader ("What's in a Message" as a B3nd-Native App)

**Tagline:** "A protocol that teaches itself."

**What it is:** "What's in a Message" as a beautiful reading experience built entirely on B3nd. Each chapter is a URI. Reading progress syncs across devices. Notes and highlights are B3nd messages at user-owned URIs. The protocol explains itself through its own protocol.

**Why it's poetic:**

1. **Self-referential in the best way:** The content teaches B3nd. The app demonstrates B3nd. The reader experiences B3nd while learning B3nd. This is the kind of meta-coherence that makes conference talks unforgettable.

2. **The book is already written.** 16 chapters exist. The content is genuinely good ("What's in a Message" is compared by all five experts to the project's best asset). No content creation needed, only the reading experience.

3. **Simple data model:**
   - Chapters: `mutable://open/book/chapters/{chapterId}` (public, anyone reads)
   - Progress: `mutable://accounts/{userKey}/book/progress` (signed, encrypted)
   - Notes: `mutable://accounts/{userKey}/book/notes/{chapterId}/{noteId}` (signed, encrypted)

4. **Offline-first is natural:** Cache chapters in IndexedDB, read offline, sync progress when online.

**Build estimate:** 3-4 weeks for a polished reading experience.

**Risk:** A book reader is not a general-purpose app. It doesn't demonstrate B3nd's applicability to *other* use cases. NLnet reviewers might see it as "a documentation website with extra steps" rather than a protocol demo. It's also not immediately useful to people who don't already care about B3nd.

**Verdict:** Great companion piece, but not the primary demo. Build it second, alongside or after the main demo.

---

### 6. Peer-to-Peer Credential / Claims Wallet

**Tagline:** "Your credentials. Verified. Portable."

**What it is:** A wallet for verifiable claims — "I am over 18," "I have a degree from X," "I completed course Y" — where claims are signed by issuers, stored by the holder, and verifiable by anyone. Like a self-sovereign identity wallet but built on B3nd URIs instead of DIDs.

**Why it aligns with EU policy:**

1. **eIDAS 2.0 is the biggest EU digital policy initiative right now.** The regulation requires all EU member states to offer digital identity wallets by 2026. NLnet has funded multiple identity-related projects. A B3nd-based credential wallet would be directly relevant.

2. **B3nd's signing primitives map perfectly:** Issuer signs a claim with their Ed25519 key → claim stored at holder's URI → verifier checks the signature against the issuer's public key. The whole SSI flow is native to B3nd.

3. **Content-addressed claims are tamper-evident:** Store the claim at `hash://sha256/{hash}` and it's immutable and verifiable.

**Technical implementation sketch:**

```
URI structure:
mutable://accounts/{holderKey}/credentials/
  {credentialId}/claim        -- the signed claim from the issuer
  {credentialId}/metadata     -- credential type, issuer, expiry (encrypted)
  index                       -- encrypted index of all credentials

mutable://accounts/{issuerKey}/issued/
  {credentialId}              -- public record of issuance (optional)

hash://sha256/{hash}          -- content-addressed claim for verification
```

**Build estimate:** 6-8 weeks (more complex UX with issuer/holder/verifier flows).

**Risk:** SSI/verifiable credentials is a niche that has been "about to break through" for a decade without mass adoption. The UX challenge is enormous — explaining "cryptographic claims" to normal people is hard. Also, real credential ecosystems require institutional issuers (universities, governments), which a demo can't provide.

**Verdict:** Strategically aligned with NLnet but too complex and too niche for a first demo. Consider for a Phase 2 NLnet application where the credential wallet is a specific funded deliverable.

---

## Comparison Matrix

| Criterion | Signed Document Vault | Proof/Timestamp | Data Locker | Encrypted Share | Book Reader | Credential Wallet |
|---|---|---|---|---|---|---|
| **Plays to B3nd strengths** | All of them | Hash + sign | Multi-backend | Encrypt + share | Read + sync | Sign + verify |
| **Avoids B3nd gaps** | Yes | Yes | Yes | Yes | Yes | Mostly |
| **NLnet alignment** | Strong | Medium | Very strong | Medium | Weak | Very strong |
| **2-min demo impact** | High | Medium | High | Medium | Medium | Medium |
| **Emotional resonance** | High (ownership) | Medium (proof) | Medium (abstract) | High (daily use) | Low (niche) | Low (niche) |
| **Build time** | 4-6 weeks | 2-3 weeks | 4-6 weeks | 2-3 weeks | 3-4 weeks | 6-8 weeks |
| **Actually useful** | Yes | Somewhat | Demo only | Very yes | Niche | Demo only |
| **Developer magnet** | Medium | High (cool tech) | High (protocol) | Medium | Low | Medium |
| **Competition** | Tresorit, Proton | Few | Solid, HAT | PrivateBin | None | EU wallets |
| **Risk of "meh"** | Medium | High | High | Medium | High | High |

---

## Revised Recommendation: Cross-App Portability + Document Vault

After additional research into NLnet's funded portfolio, the local-first ecosystem, and EU regulatory trends, the recommendation has been refined. The original vault recommendation was strong, but it overlaps with CryptPad (NLnet's most heavily funded application — 6+ grants). B3nd's most unique and fundable capability is something no NLnet-funded project demonstrates: **the same user-owned data, accessed by different applications, via URI addressing.**

### The Strategy: Two Apps, One Protocol

Build a **document vault** (App A) and a **simple second app** (App B) that reads the same B3nd URIs. The demo shows data portability *between apps* — not just between devices or servers.

**App A: Selo (the vault).** A personal document vault where files are signed, encrypted, and stored at user-owned URIs. This is the "useful standalone app" that someone would actually use.

**App B: A lightweight viewer/dashboard.** A separate web app — different codebase, different UI — that reads the same URIs and displays the same data in a different format. Could be a "document timeline," a "proof verifier," or a "data export tool."

**The killer demo (2 minutes):**
- 0:00 — Create an identity in Selo (one click, no email)
- 0:15 — Upload a document, watch it get encrypted and signed
- 0:30 — Share it with someone via a password link
- 0:45 — Open App B — a completely different application
- 0:55 — The same document appears. Same URI, same data, different app.
- 1:10 — "Alice's data belongs to Alice, not to any app."
- 1:20 — Export everything with one click (list URIs + download)
- 1:35 — Point the vault at a different B3nd node — same data, new provider
- 1:45 — "This is what the EU Data Act mandates. B3nd makes it trivial."

### Why This Wins Over a Standalone Vault

| Factor | Standalone Vault | Vault + Second App |
|---|---|---|
| **Unique to B3nd** | No — CryptPad, Tresorit, Proton do this | **Yes** — no other project demos cross-app portability |
| **NLnet differentiation** | Overlaps with CryptPad (6+ grants) | **Novel** — fills a gap in NLnet's portfolio |
| **EU policy alignment** | GDPR portability | **EU Data Act interoperability** (entered force Sep 2025) |
| **Developer "aha moment"** | "Nice encryption" | **"Wait, two different apps reading the same data?"** |
| **Protocol demo power** | Shows one app on B3nd | **Shows B3nd as a platform** |
| **Build cost** | 4-6 weeks | 5-7 weeks (vault + small second app) |

### The Competitive Positioning

Research into NLnet's funded portfolio reveals the closest comparables:

| Funded Project | What It Does | What B3nd Adds |
|---|---|---|
| **CryptPad** | Encrypted collaboration within one app | Data portable *across apps* via URIs |
| **NextGraph** (2 NLnet grants) | P2P CRDTs + E2EE + local-first | Simpler model (4 verbs), no RDF/SPARQL |
| **Earthstar/Willow** (3 NLnet grants) | Syncable data stores | URI-based addressing with behavior encoded in the address |
| **Solid** (5+ NLnet-funded projects) | RDF-based personal data stores | Dramatically simpler API, Solid's main repo now archived |
| **ActivityPods** | ActivityPub + Solid pods | No RDF dependency, cross-app via URIs not federation |

**The grant narrative:** *"B3nd is to cross-app data portability what ActivityPub is to decentralized social networking — a protocol that makes it possible, with the document vault as the first reference application and the viewer as proof that any app can participate."*

### EU Regulatory Alignment (The Timing Is Perfect)

Three EU regulations create legal mandates for exactly what B3nd does:

1. **EU Data Act** (entered application September 2025): Requires data portability between services in structured, interoperable formats. B3nd URIs + JSON = portability by design.

2. **eIDAS 2.0** (wallets mandatory by December 2026): Cryptographic identity wallets with selective disclosure. B3nd's Ed25519 identity model aligns directly.

3. **GDPR Article 20** (data portability): Right to receive data in structured format and transmit to another controller. B3nd's `list()` + `read()` = export is a protocol primitive.

The NLnet application should explicitly cite these regulations. The demo should show Data Act-compliant portability in action.

### Naming

**Selo** — Portuguese for "seal" (as in a wax seal on a letter). Short, memorable, signals authenticity and ownership. Fits the "What's in a Message" metaphor perfectly. The vault is "Selo" — the viewer can be "Selo Verify" or simply unnamed ("any B3nd-compatible app").

Other candidates:
- **Cofre** — Portuguese for "safe" or "vault." Direct, clear.
- **Carimbo** — Portuguese for "stamp." More specific to the proof angle.

### The NLnet Application (Deadline: April 1, 2026)

For the NGI Zero Commons Fund application, the grant should fund the full stack:

1. **Selo (the vault app)** — reference application demonstrating encrypted, signed, portable documents (4-6 weeks)
2. **Selo Verify (the second app)** — proof that any app can read B3nd URIs, demonstrating cross-app portability (1-2 weeks)
3. **SDK improvements from PRD** — content queries, key management, conditional writes (ongoing)
4. **"What's in a Message" book** — published as open educational content
5. **Security audit** — provided free by NLnet via Radically Open Security

**Budget request:** €30,000-€50,000 for 6-12 month deliverable plan.

This framing — "fund the protocol, its first real application, and a cross-app portability demo that proves the EU Data Act vision" — maps directly onto NLnet's heaviest scoring weight (40%: relevance/impact/strategic potential) and fills a genuine gap in their portfolio.

### What the Research Found About PDS Projects

A critical finding from the landscape research: **general-purpose personal data stores consistently fail.** The pattern:

1. Grand vision ("users own all their data")
2. Build general-purpose PDS
3. Discover nobody migrates voluntarily
4. Narrow to a specific vertical (healthcare, government, community)
5. Find a regulatory driver or institutional buyer
6. Survive at small scale in that niche

This happened to Solid (main repo archived Sep 2025, inrupt.net shut down March 2025), Dataswyft (pivoted to community badges), Digi.me (pivoted to Dutch healthcare PGO), and Mydex (survived on UK public sector contracts).

**B3nd's escape from this pattern:** Don't position the demo as "a general personal data store." Position it as "a protocol that makes cross-app data portability trivial, demonstrated with a document vault." The vault is the app; the portability is the protocol innovation.

---

## Appendix A: Local-First Landscape (2024-2026)

The local-first movement is large and growing, with dedicated conferences (Local-First Conf Berlin, FOSDEM track), 3,000+ developers in community, and "comparable to React in 2013."

### Apps with traction
- **Linear** — local-first issue tracker, 0ms search via IndexedDB, the poster child
- **Excalidraw** — whiteboard, integrated by Google Cloud, Meta, Notion, Replit
- **Obsidian** — local markdown notes, massive plugin ecosystem, paid sync
- **Anytype** — P2P Notion alternative with E2EE, object-based data model
- **Actual Budget** — open-source envelope budgeting, loyal GitHub community
- **CryptPad** — E2EE Google Docs alternative, 6+ NLnet grants

### Infrastructure layer
- **Automerge/Yjs** — CRDT libraries (mature)
- **Jazz** — local-first framework with built-in collaboration, sync, E2EE
- **ElectricSQL** — Postgres-to-SQLite sync (Google, Supabase using it)
- **PowerSync** — backend DB to SQLite sync
- **Loro** — Rust CRDT library (emerging)

### B3nd's position
The local-first space is crowded with **sync engines and CRDTs**. B3nd addresses a different layer: "where does data live and who owns it" via URI-based addressing. This is complementary but distinct. The demo must make this distinction visceral — B3nd is not a sync engine, it's an addressing protocol for user-owned data.

---

## Appendix B: NLnet Funding Patterns (What They Actually Fund)

Research into NLnet's 1,000+ funded projects reveals clear patterns relevant to demo app selection:

### Most-Funded Categories
1. **Networking & Infrastructure** (very high) — WireGuard, IPv6, GNUnet, SCION
2. **Messaging & Communication** (high) — Monal IM, Conversations, Briar, Commune
3. **Identity & Authentication** (high) — Yivi/IRMA, Canaille, django-allauth, eIDAS-portal
4. **Fediverse / Social** (high) — Mastodon, GoToSocial, Lemmy, PeerTube, Pixelfed
5. **Security & Encryption** (high) — CryptPad, rPGP, OMEMO, Autocrypt
6. **Data Sovereignty / Storage** (medium) — Solid ecosystem, ActivityPods, Atomic Tables

### NLnet Has Funded 15+ Projects in the "User-Owned Data" Space
- **Solid-NextCloud** — turns Nextcloud into a Solid pod ("portable personal data vault")
- **Manas** — Solid components in Rust/JS with "data-sovereignty collaboration at the core"
- **Solid-Search** — full-text search for Solid pods
- **ActivityPods** — ActivityPub + Solid pods for decentralized social apps
- **Yivi/IRMA** — privacy-preserving digital identity wallet (moving toward eIDAS 2.0)
- **EteSync/Etebase** — E2E encrypted sync for contacts, calendars, tasks
- **Goblins-Persistence** — encrypted content-addressed storage for decentralized apps
- **CryptPad** — E2EE collaboration suite (multiple NLnet grants, gold standard)
- **Atomic Tables** — self-hostable tabular data with user control
- **Dokieli** — decentralized authoring with full content ownership

### The Language NLnet Responds To
From their actual materials:
- *"services and applications which provide autonomy for end-users"*
- *"fully in control of their personal data on the Internet"*
- *"help deliver, mature and scale new internet commons"*
- *"from libre silicon to middleware, from P2P infrastructure to convenient end user applications"*
- *"break-through contributions to the open internet with lasting impact on society"*

### Scoring Weights
- Technical excellence / Feasibility: **30%**
- Relevance / Impact / Strategic potential: **40%** (heaviest weight)
- Cost effectiveness: **30%**
- Minimum threshold: weighted score above 5.0/7.0

### Implication for B3nd's Demo App
The Signed Document Vault maps directly onto NLnet's most-funded themes: **encryption** (CryptPad precedent), **data sovereignty** (Solid ecosystem precedent), **identity** (Yivi precedent), and **user autonomy** (their core language). The fact that B3nd is a protocol — not just an app — makes it fundable as both infrastructure and application, which NLnet explicitly values ("from P2P infrastructure to convenient end user applications").

The strongest grant narrative: **"B3nd is to user-owned data what ActivityPub is to decentralized social networking — a protocol that makes it possible, with the Signed Document Vault as the first reference application."**

---

## Appendix C: What Protocol-Level Projects Got Right with Their Demos

| Protocol | Killer Demo | Why It Worked |
|---|---|---|
| **IPFS** | Share a file via content hash | Showed "same file, no server" in one interaction |
| **Nostr** | Damus / Primal clients | Social media people already understand, but decentralized |
| **Matrix** | Element messenger | "Like Slack but you own it" — familiar UX, new infrastructure |
| **AT Protocol** | Bluesky social network | Built the app first, revealed the protocol later |
| **Solid** | (no killer demo) | Had the vision but never built the "thing you'd actually use" |
| **ActivityPub** | Mastodon | "Like Twitter but federated" — Twitter exodus drove adoption |

**Pattern:** The protocols that succeeded built a **familiar UX on unfamiliar infrastructure**. The demo shouldn't feel alien — it should feel like a tool people already know, except when you look under the hood, everything is better (owned, encrypted, portable, open).

The document vault follows this pattern: it looks like Google Drive or Dropbox, but when you look under the hood, every file is signed, encrypted, content-addressed, and portable across providers. The second app (the viewer) is the "aha moment" — "wait, a completely different app can read the same data? That's not how software works." Yes it is. That's how B3nd works.

### The Cautionary Tales

| Protocol | What Went Wrong |
|---|---|
| **Solid** | Had the vision but never built a compelling app. Main repo archived Sep 2025. RDF/SPARQL learning curve killed developer adoption. |
| **IPFS** | No consumer-facing killer app. Most users accessed via centralized gateways, undermining the thesis. Infrastructure enthusiasts ≠ users. |
| **Nostr** | Protocol simplicity drove developer adoption, but primarily popular with Bitcoin/crypto users — limited mainstream appeal. Key management UX is poor. |

**The lesson is unanimous:** the protocol that builds one compelling, user-facing application wins. The protocol that stays at the library/SDK level stagnates.

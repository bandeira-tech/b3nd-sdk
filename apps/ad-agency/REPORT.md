# B3nd SDK — Exploration Report

*Context: a software developer coming in cold, a few days before a 1.0
release candidate, asked to understand the framework and prototype three
small distributed workflows on the theme of a small ad agency.*

## Executive summary

B3nd is a small, opinionated framework for building content-addressed,
signature-verified, multi-backend networks. Its hallmark is the **Rig** —
one object that composes storage backends (memory, Postgres, Mongo, S3,
IPFS, IndexedDB, …), URI-pattern routing, a validation pipeline
(programs + handlers), synchronous hooks, async events, and URI-pattern
reactions, all behind a single `NodeProtocolInterface` of `receive` /
`read` / `observe` / `status`. Identity is deliberately *external* to the
Rig: you create a session with `identity.rig(rig)` and the identity signs
or encrypts before anything reaches storage. Everything in the framework
reduces to one primitive: a `[uri, values, data]` tuple dispatched through
the Rig. That is genuinely elegant.

For the 1.0 release candidate the foundations look solid. The core
abstractions (Rig, Connection, Identity, Program, Output, MessageData) are
internally consistent, reasonably documented, covered by tests, and I was
able to build three non-trivial workflows against them without ever
reading an implementation to figure out what a call was supposed to do.
The three prototypes that accompany this report exercise the
content-addressing, multi-target connection routing, encrypted
peer-to-peer messaging, URI-pattern reactions, identity sessions, and
recursive envelopes — all succeeded on the first or second attempt.

### Frank take — what I liked

1. **One primitive, genuinely reused.** Writes, reads, signed envelopes,
   validator attestations, confirmer finalizations — they are all just
   `[uri, values, data]` tuples dispatched through the same Rig. That
   unification makes the mental model small once you have it.
2. **Connections as URI-pattern filters.** `connection(client, { receive,
   read, observe })` is the right shape. Routing by URI pattern means the
   same config can describe a local cache, a primary store, and a
   write-only replica — and the Rig broadcasts writes while reading from
   the first match. That "one file tells you the whole topology"
   property is worth a lot.
3. **Identity is out of the Rig.** The Rig never signs. Compromising it
   cannot forge signatures. This is the right security boundary.
4. **Content addressing is load-bearing, not decorative.** `send()`
   canonicalizes and hashes the envelope, and the returned URI becomes
   the reference for the next envelope in a chain. Multi-party workflows
   (user → reviewer → approver) fall out of this shape naturally.
5. **Reactions are cheap and satisfying.** `reactions: { "mutable://
   campaigns/:id/publish": (uri, data, { id }) => ... }` is exactly how
   side-channels like "ping Google Ads when a campaign goes live" ought
   to be expressed in a prototype.

### Frank take — what I'd fix before calling it 1.0

1. **The skill docs and the code have drifted in two specific places.**
   `skills/b3nd/RIG_PATTERNS.md` and `FRAMEWORK.md` mix two shapes for
   outputs — the 2-tuple `[uri, data]` and the 3-tuple `[uri, values,
   data]`. The actual type (`libs/b3nd-core/types.ts:127`) and every
   test uses 3-tuple. A reader following the patterns doc literally will
   hit type errors on their first write. Similarly, `skills/b3nd/
   RIG_PATTERNS.md:296` still mentions a `schema:` key on `RigConfig`
   that no longer exists — it has been replaced by `programs` +
   `handlers` (see `libs/b3nd-rig/types.ts:22`). The `connection.ts`
   doc-comment example also still references `schema`. For a 1.0
   release these are the kinds of things that make new users stub their
   toe on page one.
2. **`programs` semantics changed from "gate" to "classifier" without
   a loud note.** The old `Schema` returned `{ valid, error }` and
   unknown prefixes were rejected. The new `Program` returns `{ code,
   error }` and **unknown prefixes pass through to the client
   unvalidated**. That is a meaningful security posture shift — it
   trades "schema is law" for "protocols must explicitly install a
   `rejectUnknown` program" — and the shift isn't called out in
   SKILL.md / FRAMEWORK.md, which still read as if the old semantics
   apply. For 1.0 I'd either make rejection the default (with an
   `openByDefault: true` opt-in) or put the new behavior in a single
   highly-visible paragraph.
3. **`rig.receive()` broadcasts sequentially and returns the first-failed
   result.** Reading `createConnectionDispatch` (`rig.ts:798`), each
   message's matching connections are written in parallel inside the
   message, but messages themselves are written sequentially (a `for` loop
   over `msgs`). That is fine semantically, but the current
   "return the first failed write" collapses per-replica errors into one
   opaque result; in a production-grade 1.0 I would want either
   per-connection results or an explicit "best-effort vs. all-or-nothing"
   flag, because today a write accepted by the primary and rejected by a
   mirror is indistinguishable from a total failure.
4. **`rig.read()` on trailing-slash URIs only returns results from the
   first matching connection.** `createConnectionDispatch` breaks after
   the first list read (`rig.ts:834-840`). That is a correct choice for
   the common "cache → primary" pattern, but it means you cannot use the
   Rig as a federating read layer that merges lists across backends
   without writing your own helper. Worth documenting explicitly.
5. **Encrypted reads are still a little awkward.** `readEncrypted()` on
   `AuthenticatedRig` does the right thing for a single URI but
   `readEncryptedMany` just fans out parallel `readEncrypted` calls — if
   any one of them has non-encrypted data the whole batch rejects with
   a confusing error. A variant that returns `(T | null | Error)[]`
   instead of throwing would be much friendlier for apps that store a
   mix of cleartext metadata and encrypted payloads at adjacent paths
   (which is my Prototype 1).
6. **The `programs` + `handlers` + `broadcast` story needs a worked
   example in docs.** Reading the tests to understand that
   `handlers["app:valid"]` is how you implement "accepted but store it
   somewhere different" was a detour. For protocol authors this is *the*
   composition point; it should have its own cookbook page, not just a
   type definition.
7. **Envelope outputs are decomposed locally by `MessageDataClient`,
   not re-routed by the Rig.** If I send an envelope
   `[hash://…, {}, { outputs: [[publish://meta/…, …], …] }]`, the Rig
   dispatches the whole envelope to whichever connection accepts
   `hash://*`. That connection's `MessageDataClient` then decomposes
   the envelope by writing each output to **its own** underlying
   `Store`. The `publish://meta/…` output never comes back to the Rig
   to be routed to the meta connection. For cross-connection fan-out
   based on output URI patterns, you use `rig.receive([msg, msg, msg])`
   directly — one tuple per destination. This is a perfectly reasonable
   design (the envelope is the unit of atomic intent, each responsible
   backend decomposes it locally), but it upended my first draft of
   Prototype 2 and is not called out anywhere I could find in the
   framework docs. I would add it to `skills/b3nd/DESIGN_PRIMITIVE.md`
   in a small "what envelopes do and don't do" section.
8. **Programs only fire on `rig.receive()`, not on `rig.send()`.**
   `rig.send()` — the thing every example uses for authenticated writes
   — goes `beforeSend` hook → `send(msg, dispatch)` → dispatch straight
   to connections. The program pipeline (`_runProgram` in
   `libs/b3nd-rig/rig.ts:313`) is only invoked from `_receiveOne`. I
   discovered this by trying to write my Prototype 3 the way the docs
   suggested (signed `session.send()` with trust-list programs on the
   output URIs) and watching every rejection-case test pass instead of
   fail. The rig test suite at `rig.test.ts:1456` ("programs allow
   signed send via session") asserts acceptance, never rejection —
   which is consistent with "programs don't run on send". This is
   surprising given how much of the skill docs read like "programs are
   law". For a 1.0 I would either (a) also run programs on the output
   URIs during `send()` (validating outputs with the envelope as
   `upstream`), or (b) put a very clear red note in FRAMEWORK.md that
   program enforcement happens on the receive side only and that
   protocols that want authenticated-write enforcement should expose
   `receive()` directly with signed data, or use `beforeSend` hooks.
   Prototype 3 takes the "use receive + signed payload in data" route
   and it works, but I had to understand this the hard way.
7. **`Output` values slot is under-explained.** Every example passes
   `{}`. It took reading `types.ts:127` to confirm that `values` is for
   "conserved quantities" (UTXO-style fire/gas amounts). The name
   "values" is too generic for what it is; calling it `conservedValues`
   or `quantities` and splitting it out from the main write API would
   reduce the "what is this always-empty object" friction for 90 % of
   users.

None of these are showstoppers. They are the kind of polish items that
separate a 0.9.x from a 1.0.0. The framework itself is coherent and
enjoyable to build against.

---

## What I built

Three small workflows for "Pixel & Pine Creative", a fictional five-person
ad agency with a handful of local small-business clients (a bakery, a
dentist, a bike shop). Each prototype runs against an in-memory Rig so
the whole thing is `deno run -A` with no external deps.

### 1. `01-client-intake.ts` — encrypted brief intake

The agency publishes a public **intake URL** for each client
(`mutable://agency/clients/{slug}/intake/meta`) listing the agency's
X25519 encryption public key and the inbox URI. A small client creates a
throwaway identity in their browser, encrypts their brief (budgets,
target demographics, existing vendor relationships — stuff that cannot
sit in plaintext on a staging database), and writes it to a per-client
inbox URI. The agency's Rig decrypts on read.

**What this exercises:** two independent identities on the same Rig,
`sendEncrypted`/`readEncrypted`, URI conventions for multi-tenant scoping
(`mutable://agency/clients/{slug}/…`), a reaction that fires when a new
brief arrives (stand-in for a Slack/email ping), and `Rig.exists()` +
`count()` helpers.

### 2. `02-campaign-publish.ts` — content-addressed campaign with multi-channel fan-out

The agency drafts a campaign with copy, asset refs, and a go-live date.
`send()` content-addresses the envelope (`hash://sha256/…`); a mutable
pointer `mutable://agency/campaigns/{client}/current` is written in the
same envelope as the fast-path. Two mock "publisher" channels (Meta Ads,
Google Ads) are wired as *separate clients* behind URI-pattern
`connection()` filters — the same `receive()` broadcasts to all three
backends (primary store + each channel). Versioning shows up for free:
writing a new `hash://…` and pointing the mutable link at it retains
the audit trail.

**What this exercises:** `send()` content-addressing, Rig-level
multi-client broadcast via connection patterns, reactions firing on
successful writes (the "notify external system" pattern), versioning
via mutable pointers at stable URIs, and `Rig.watchAll()` as a
dashboard driver.

### 3. `03-creative-approvals.ts` — recursive-envelope sign-off chain

Designer → Account Director → Client signs off on a creative, in that
order. Each step is its own envelope whose `inputs` list references the
hash of the previous step's envelope, and each layer carries its own
signed `auth`. A tiny `rejectUnknown`-style program enforces "only
trusted account-director pubkeys may write to
`link://agency/approvals/director/…`", and a second rule enforces that a
client sign-off must list the director sign-off as its input. At the end
a single `read()` traverses the three hash URIs and reconstructs the
full provenance chain: who approved, in what order, with which
signature.

**What this exercises:** recursive envelopes as the consensus primitive,
per-layer identity signing via `session.send()`, programs that inspect
auth against a trust list, cross-program reads (the client-sign-off
validator reads the director link), and using hash URIs as first-class
identifiers for historical artifacts.

---

## How to run

```bash
cd apps/ad-agency
deno task intake
deno task campaign
deno task approvals
# or all three:
deno task all
```

Each file is a standalone end-to-end demo with internal assertions — if
something regresses in `libs/` my prototypes will tell you.

## Recommended next reads for someone following me in

- `libs/b3nd-rig/rig.ts` — read this top to bottom. It's the whole mental model.
- `libs/b3nd-rig/connection.ts` — the routing primitive. 140 lines.
- `libs/b3nd-rig/authenticated-rig.ts` — what `identity.rig(rig)` actually gives you.
- `libs/b3nd-rig/rig.test.ts` — the *real* documentation. Faster than the skill files.
- `skills/b3nd/RIG_PATTERNS.md` — treat as a recipe index, but cross-check output shapes against the tests.

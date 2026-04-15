# PRD: Firecat App Development Exploration

**Date:** 2026-02-21 **Purpose:** Evaluate Firecat as an app platform by
exploring three distinct app ideas, identifying integration points, open
questions, and perceived shortcomings to communicate back to the B3nd team.

---

## Executive Summary

Three apps were designed against the Firecat protocol to stress-test different
aspects of app development:

| App                           | Primary Stress Test                                                      | Verdict                                                              |
| ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **Collaborative Recipe Book** | Discovery, search, cross-user data, public indexes                       | Strong for ownership/privacy; weak for discovery/querying            |
| **E2E Encrypted Journal**     | Encryption architecture, key management, search over encrypted data      | Strong primitives; misleading "private" visibility; no key lifecycle |
| **Small Business Invoicing**  | Business logic, sharing with non-users, scheduled operations, compliance | Strong audit trail; needs server for email/payments/scheduling       |

**Common finding across all three apps:** Firecat excels at data ownership,
cryptographic identity, and the write path (CRUD + batch envelopes). It
consistently struggles with querying, aggregation, real-time updates, and any
operation that traditionally requires server-side logic.

---

## App 1: Collaborative Recipe Book

### What It Tests

- Public discovery and search across users
- Content-addressed media (images)
- Cross-user data aggregation (tags, trending)
- Forking/remixing with attribution
- Password-protected sharing (family collections)

### Data Model (URI Map)

```
mutable://accounts/{userPubkey}/recipes/profile          -- user profile (signed)
mutable://accounts/{userPubkey}/recipes/settings         -- private preferences (encrypted)
mutable://accounts/{userPubkey}/recipes/resources        -- encrypted index of recipe private keys
mutable://accounts/{recipePubkey}/data                   -- recipe content (Resource Identity Pattern)
hash://sha256/{hash}                                     -- recipe images (content-addressed)
link://accounts/{recipePubkey}/recipes/cover-image       -- named pointer to image hash
mutable://open/recipes/index/by-tag/{tag}/{recipePubkey} -- public discovery index
mutable://open/recipes/index/recent/{ts}-{recipePubkey}  -- chronological browse
immutable://inbox/{recipientKey}/recipes/share/{ts}      -- share notifications
```

### Integration Points That Work Well

1. **Resource Identity Pattern** -- each recipe gets its own Ed25519 keypair,
   making recipes portable and transferable. Recipe links never break when users
   change names.
2. **Content-addressed images** via `hash://sha256/{hash}` -- natural
   deduplication, tamper-proof, immutable.
3. **Batch writes via `send()`** -- creating a recipe involves writing recipe
   data + updating resource index + writing discovery index entries, all in one
   envelope.
4. **Protected visibility** -- family recipe collections encrypted with a shared
   password. No account management needed.
5. **Inbox for sharing** -- `immutable://inbox` is a clean primitive for "Alice
   shared a recipe with you."
6. **React hooks** -- `useRecord`, `useList`, `useSignedWrite` map directly to
   recipe CRUD.

### Open Questions for B3nd Team

**Q1: How do you build integrity-protected public indexes?** `mutable://open`
has no access control. The tag index
(`mutable://open/recipes/index/by-tag/italian/{recipePubkey}`) can be vandalized
-- anyone can overwrite or delete entries. Using `immutable://open` prevents
overwrites but also prevents legitimate updates/removals. An app-owned keypair
via `deriveKeyFromSeed` creates a centralization point.

> **Suggestion:** Consider a program like `mutable://verified` where writes must
> include a valid signature from the author of the referenced content, but reads
> are public. This would allow permissionless publishing with integrity
> guarantees.

**Q2: What is the maximum message/record size?** Recipe images need to be stored
as blobs. The SDK supports `Uint8Array` via base64 wrapping, but there is no
documented size limit per record. Is it 1MB? 10MB? 100MB? This affects whether
images need client-side resizing before upload.

**Q3: How do you query by data content, not just URI pattern?** `client.list()`
supports regex on URI paths but not on record data. "Find all recipes containing
tomato" is impossible without downloading every recipe. The `readMulti` cap of
50 URIs per call makes large-scale client-side filtering slow.

> **Suggestion:** Consider a `client.search()` or `client.query()` method that
> accepts field-level predicates, even if limited to exact match or simple
> operators on indexed fields.

**Q4: Is there a subscription/push mechanism for data changes?** The
`WebSocketClient` appears to be request/response only. For collaborative
features (family members editing recipes together), polling via
`refetchInterval` is the only option. Is there a plan for server-push or
subscriptions?

**Q5: What are the atomicity guarantees of `send()`?** The `MemoryStore`
processes outputs sequentially and returns on first failure. Are failed outputs
after a successful one rolled back? Can a batch write leave partial state
(recipe exists but index doesn't)?

### Perceived Shortcomings

| Issue                                     | Impact                                                         | Severity   |
| ----------------------------------------- | -------------------------------------------------------------- | ---------- |
| No server-side content search             | Cannot build recipe search by ingredient/name                  | **High**   |
| No integrity for `mutable://open` indexes | Public discovery indexes can be vandalized                     | **High**   |
| Two-hop image resolution (link -> hash)   | 20 recipe thumbnails = 40 reads minimum                        | **Medium** |
| No real-time/subscription support         | Collaborative editing requires polling                         | **Medium** |
| Resource index management complexity      | User must maintain encrypted key index; corruption = data loss | **Medium** |
| No cursor-based pagination                | Offset pagination skips/duplicates under concurrent writes     | **Low**    |

---

## App 2: End-to-End Encrypted Personal Journal

### What It Tests

- Client-side encryption architecture
- Key management and multi-device sync
- Search over encrypted data
- Selective sharing of encrypted content
- Data durability for irreplaceable personal data

### Data Model (URI Map)

```
mutable://accounts/{userPubkey}/journal/
  entries/{date}/{entry-id}         -- encrypted journal entries
  entries-index/{yyyy-mm}           -- encrypted monthly metadata index
  templates/{template-id}           -- encrypted entry templates
  settings                          -- encrypted app preferences
  streak                            -- encrypted streak data
  wrapped-key                       -- password-wrapped X25519 private key (for multi-device)
  shares/{shareId}                  -- password-protected shared entries
```

### Integration Points That Work Well

1. **X25519 + AES-GCM encryption** -- the `encrypt()` function provides genuine
   E2EE with ephemeral keypairs for forward secrecy. Same construction as
   Signal.
2. **Zero-knowledge server** -- the node validates signatures on ciphertext,
   never needs plaintext. Structurally cannot read user data.
3. **`createSignedEncryptedMessage`** -- encrypt-then-sign in one call. Clean
   API.
4. **`SecretEncryptionKey.fromSecret()`** -- elegant password-based sharing for
   individual entries.
5. **Content-addressed images** -- photos in `hash://sha256/{hash}` are
   tamper-proof evidence.
6. **Batch writes** -- entry + monthly index update + streak update in one
   envelope.

### Critical Finding: "Private" Visibility Is Misleading

**This is the most important finding in this exploration.**

The documented "private" visibility derives the encryption key from
`SALT:uri:ownerPubkey`. All three inputs are public:

- `SALT` is a constant compiled into the app (extractable from any browser
  bundle)
- `uri` is the resource address (visible on the network)
- `ownerPubkey` is in the URI itself

This means the documented "private" derivation is **not cryptographically
private**. Anyone who reads the app source code can derive the same key and
decrypt "private" data.

For genuine E2EE, the app developer must know to use:

- **X25519 asymmetric encryption** (`encrypt(data, recipientPublicKeyHex)`) for
  single-user privacy
- **`SecretEncryptionKey.fromSecret(userPassword)`** for password-derived
  privacy

The current docs do not make this distinction clear. A developer following the
visibility table in FIRECAT.md would ship an app with false privacy guarantees.

> **Recommendation to B3nd team:** Either (a) change the private visibility
> derivation to use X25519 by default, or (b) add a prominent warning in the
> docs that `SALT:uri:ownerPubkey` is obscurity, not encryption, and document
> the correct pattern for genuine E2EE.

### Open Questions for B3nd Team

**Q6: Is there a standard "encrypted write" pattern?** The SDK provides all the
crypto primitives (`encryptSymmetric`, `encrypt`,
`createSignedEncryptedMessage`, `SecretEncryptionKey`), but there is no
documented standard pattern for "encrypt this data and write it." The web rig
shows one approach embedded in a UI component, but it's not abstracted as a
reusable recipe. Should there be a `client.receiveEncrypted()` or a higher-level
wrapper?

**Q7: How does multi-device key sync work?** The protocol provides no key sync,
backup, or recovery mechanism. For a journal where key loss = permanent data
loss, this is critical. What is the recommended approach? Password-wrapped keys?
QR code transfer? Seed phrases?

> **Suggestion:** Consider a `KeyBundle` abstraction that wraps Ed25519 signing
> key + X25519 encryption key + a password-based backup mechanism. This would
> eliminate the most common developer mistake (not backing up keys).

**Q8: What happens to encrypted data when a user loses their key?** Is there any
recovery path? Or is "key loss = permanent data loss" the intended design? If
so, the SDK should include prominent warnings and a recommended backup flow.

**Q9: Can the node validate structure inside encrypted payloads?** Currently,
the node validates signatures but cannot validate the structure of encrypted
data. A buggy client could write malformed ciphertext that passes auth
validation but fails to decrypt. Is there a plan for encrypted-payload schema
validation?

### Perceived Shortcomings

| Issue                                                | Impact                                               | Severity     |
| ---------------------------------------------------- | ---------------------------------------------------- | ------------ |
| "Private" visibility uses public inputs (misleading) | Developer ships false privacy guarantees             | **Critical** |
| No key management / recovery framework               | Key loss = permanent data loss, no recovery          | **Critical** |
| No multi-device key sync                             | Users must manually transfer keys between devices    | **High**     |
| No search over encrypted data                        | Must decrypt all entries client-side to search       | **High**     |
| No real-time sync                                    | Multi-device edits require polling                   | **Medium**   |
| No offline-first sync framework                      | Developer builds conflict resolution from scratch    | **Medium**   |
| No durability guarantees                             | Journal data could be lost by node operator          | **High**     |
| Two key types to manage (Ed25519 + X25519)           | Increased developer complexity, no unified KeyBundle | **Medium**   |

---

## App 3: Small Business Invoicing & Client Management

### What It Tests

- Sharing with non-B3nd users (clients viewing invoices)
- Business logic without server-side code (recurring invoices, notifications)
- Sequential numbering and concurrency
- Computed aggregations (dashboards)
- Audit trails and compliance
- Integration with external services (payments, email)

### Data Model (URI Map)

```
mutable://accounts/{ownerKey}/inv/
  settings                           -- business config (signed)
  clients/{clientId}                 -- client records (signed)
  invoices/{invoiceId}/data          -- invoice header + embedded line items (signed)
  invoices/{invoiceId}/status        -- status tracking with history (signed)
  invoices/{invoiceId}/audit-head    -- pointer to latest audit envelope
  payments/{paymentId}               -- payment records (signed)
  recurring/{recurringId}            -- recurring invoice definitions (signed)
  sequences/invoice-number           -- invoice number counter (signed)
  shared-keys/{invoiceId}            -- encrypted resource keypairs for shared invoices
  aggregates/summary                 -- cached dashboard metrics (signed)

mutable://accounts/{invoiceKey}/inv/shared  -- shareable invoice copy (Resource Identity + password)
immutable://inbox/{accountantKey}/inv/...   -- notifications to accountant
hash://sha256/{hash}                        -- generated PDFs, attachments
```

### Integration Points That Work Well

1. **Audit trail via hash chains** -- content-addressed envelopes with `inputs`
   linking to previous versions create a tamper-evident, cryptographically
   verifiable change history. This is _better_ than what most SaaS invoicing
   apps provide.
2. **Data ownership** -- the business owner's data is signed with their key. No
   vendor can hold data hostage, change pricing, or shut down.
3. **Batch writes for invoice creation** -- invoice data + status record +
   counter update in one `send()` envelope.
4. **Inbox for accountant notifications** --
   `immutable://inbox/{accountantKey}/inv/new-invoice/{ts}` is a clean async
   notification primitive.
5. **"Anyone with this link" sharing** -- password-derived encryption for
   invoice sharing requires no account creation from the client. Better UX than
   SaaS apps that require client signup.
6. **No vendor lock-in** -- data is JSON at URIs. Export with `list()` +
   `readMulti()`. No data migration needed to switch providers.
7. **Client-side PDF generation** -- since the app has all data in the browser,
   jsPDF/html2pdf works naturally. PDFs can be stored at `hash://sha256/{hash}`.
8. **Offline invoice creation** -- `IndexedDBStore` enables field workers to
   create invoices without connectivity.

### Open Questions for B3nd Team

**Q10: No compare-and-swap (CAS) or optimistic locking?** Sequential invoice
numbers require atomic increment. Two tabs reading counter=42 both write 43,
creating duplicate numbers. `mutable://` has no concurrency control. Is there a
plan for conditional writes (`If-Match`, version checks)?

> **Suggestion:** Consider a
> `client.receiveIf(uri, data, { expectedVersion: n })` that rejects the write
> if the record has been modified since version `n`. This would solve the most
> common concurrency problem.

**Q11: How do you handle computed aggregations efficiently?** Dashboard metrics
(total revenue, outstanding balance) require reading _every_ invoice. With 1,000
invoices and `readMulti` capped at 50, that's 20+ network round-trips just to
render a dashboard. Is there a plan for server-side aggregation or materialized
views?

**Q12: Is there a mechanism for scheduled/triggered operations?** Recurring
invoices, payment reminders, and overdue notifications all need something to
happen on a schedule. Without server-side cron, the only option is "generate
when the user opens the app," which means invoices pile up if the user doesn't
log in. Is there a planned extension for scheduled writes or triggers?

**Q13: How do you send notifications to non-B3nd users?** Email delivery is
table-stakes for invoicing. The inbox program only works for B3nd users. Is
there a bridge or webhook mechanism planned for delivering notifications to
external channels (email, SMS, push)?

**Q14: What are the compliance implications of "no guaranteed persistence"?**
Many jurisdictions require 5-7 year invoice retention. If the node operator
purges data, the business loses legally required records. Is there guidance for
compliance-sensitive use cases? Is there a planned "durable" program or SLA
mechanism?

**Q15: How does access revocation work?** Once a client has the password to view
their invoice, you cannot revoke access to data they've already decrypted. You
can delete or re-encrypt the shared resource, but if the data was cached or
replicated, the old password still works. Is this the intended model?

### Perceived Shortcomings

| Issue                                          | Impact                                                 | Severity   |
| ---------------------------------------------- | ------------------------------------------------------ | ---------- |
| No server-side queries or aggregation          | Dashboard requires reading every record                | **High**   |
| No email/notification delivery to non-users    | Cannot email invoices to clients                       | **High**   |
| No payment processor integration (no webhooks) | Cannot integrate Stripe/Square/PayPal                  | **High**   |
| No scheduled operations                        | Recurring invoices require user to open app            | **High**   |
| No optimistic concurrency control              | Invoice numbers can duplicate under concurrent access  | **High**   |
| No multi-user roles (admin/editor/viewer)      | Shared keypair = shared everything, no granular access | **Medium** |
| Persistence risk for financial records         | Legal/compliance exposure for invoice retention        | **High**   |
| No read receipts                               | Cannot reliably track "invoice viewed" status          | **Medium** |
| No content-level search                        | Cannot search "invoices for client Acme" via API       | **Medium** |
| No offline sync framework                      | Developer builds sync/conflict resolution from scratch | **Medium** |

---

## Cross-Cutting Themes

### What Firecat Gets Right

These strengths are consistent across all three app explorations:

1. **Small, coherent API surface.** Five client methods (`receive`, `read`,
   `readMulti`, `list`, `delete`) + `send()` for batches + `encrypt` module. A
   developer can hold the entire API in their head.

2. **Cryptographic identity is first-class.** Ed25519 keypairs as user identity.
   No email, no phone, no OAuth. The user controls their namespace with a key.
   No server can lock them out.

3. **Content-addressed envelopes are powerful.** The `send()` →
   `hash://sha256/{hash}` pattern gives you tamper-evident, auditable batch
   writes for free. This is better than what most traditional backends provide.

4. **Client-side encryption with strong primitives.** X25519 + AES-GCM with
   ephemeral keys. The crypto is real and well-implemented.

5. **No vendor lock-in.** Data is JSON at URIs. Export is trivial. Provider
   switching requires changing one URL.

6. **Uniform client interface.** `MemoryStore`, `HttpClient`,
   `IndexedDBStore`, `LocalStorageStore`, `PostgresStore`, `MongoStore` all
   implement the same interface. Offline-first, testing, and multi-backend are
   architecturally natural.

### What Needs Work

These gaps appeared in every app exploration:

1. **No server-side querying or aggregation.** This is the #1 limitation. Every
   app needs queries that go beyond "list URIs matching a regex." Content-based
   search, aggregation, compound filters -- all require fetching everything to
   the client.

2. **No real-time / subscription support.** Every collaborative or multi-device
   app needs push updates. Polling is the only option today.

3. **No concurrency control.** No CAS, no versioning, no optimistic locking.
   Last-write-wins silently drops changes.

4. **"Private" visibility is misleadingly named.** The deterministic derivation
   from public inputs is obscurity, not encryption. This is a documentation/API
   design issue that could cause real security incidents.

5. **No key lifecycle management.** No key backup, sync, rotation, or recovery.
   Key loss = permanent data loss across all apps.

6. **No offline-first sync framework.** The client interfaces are uniform, but
   there's no sync queue, conflict resolution, or reconciliation mechanism.

7. **No integration with external services.** No webhooks, no scheduled
   triggers, no email delivery. Apps that need to interact with the outside
   world require a separate server.

8. **Persistence is not guaranteed.** For apps where data loss is unacceptable
   (journals, invoices, recipes invested with significant effort), the
   protocol's "delivery not storage" philosophy creates real user trust issues.

---

## Recommendations to B3nd Team

### Priority 1: Documentation & Safety

- [ ] **Document the private visibility limitation** prominently. Add a warning
      that `SALT:uri:ownerPubkey` uses public inputs and is not genuine E2EE.
      Document the correct X25519 pattern for true privacy.
- [ ] **Document maximum record sizes** per node/backend type.
- [ ] **Document `send()` atomicity guarantees** (or lack thereof).
- [ ] **Provide a "KeyBundle" recipe** covering backup, multi-device sync, and
      recovery.

### Priority 2: Query & Discovery

- [ ] **Consider content-level query support** -- even simple field-match
      predicates on indexed fields would unlock most app use cases.
- [ ] **Consider an integrity-protected public namespace**
      (`mutable://verified`) where writes require content-author signatures but
      reads are public.
- [ ] **Document the recommended pattern for building discovery indexes** with
      current primitives, including the security trade-offs of `mutable://open`.

### Priority 3: Developer Experience

- [ ] **Add conditional writes** (`receiveIf` with expected version/timestamp)
      for optimistic concurrency control.
- [ ] **Add subscription/push support** for real-time collaborative apps.
- [ ] **Provide a standard "encrypted write" helper** that composes encrypt +
      sign + receive into one call.
- [ ] **Consider a sync framework** for offline-first apps (local client <->
      remote client reconciliation).

### Priority 4: Platform Capabilities

- [ ] **Consider webhook/trigger support** for integration with external
      services.
- [ ] **Consider a "durable" storage tier** or SLA mechanism for
      compliance-sensitive use cases.
- [ ] **Consider multi-user access control** beyond shared keypairs (role-based
      access to a namespace).

---

## Appendix: Summary of All Open Questions

| #   | Question                                                | Raised By     |
| --- | ------------------------------------------------------- | ------------- |
| Q1  | How do you build integrity-protected public indexes?    | Recipe App    |
| Q2  | What is the maximum record size?                        | Recipe App    |
| Q3  | How do you query by data content, not just URI pattern? | Recipe App    |
| Q4  | Is there a subscription/push mechanism?                 | Recipe App    |
| Q5  | What are the atomicity guarantees of `send()`?          | Recipe App    |
| Q6  | Is there a standard "encrypted write" pattern?          | Journal App   |
| Q7  | How does multi-device key sync work?                    | Journal App   |
| Q8  | What is the recovery path for lost keys?                | Journal App   |
| Q9  | Can the node validate encrypted payload structure?      | Journal App   |
| Q10 | Is there optimistic locking / CAS?                      | Invoicing App |
| Q11 | How do you handle aggregations efficiently?             | Invoicing App |
| Q12 | Is there a mechanism for scheduled operations?          | Invoicing App |
| Q13 | How do you notify non-B3nd users?                       | Invoicing App |
| Q14 | What is the compliance story for persistence?           | Invoicing App |
| Q15 | How does access revocation work?                        | Invoicing App |

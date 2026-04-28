# Exchange Patterns & Trust Models

B3nd is a message exchange medium. Two parties that have never met can exchange
data if they agree on an address. This document explores the patterns that
emerge from that simple idea — especially when the parties have different levels
of trust in each other and in the infrastructure between them.

---

## The Exchange Primitive

Everything in B3nd reduces to a single shape:

```
[uri, values, data]
```

A **URI** is an address. **Values** are conserved quantities. **Data** is a
payload. That's a message.

```
┌─────────────────────────────────────────────────────────────┐
│                        Message                              │
│                                                             │
│   ┌──────────────────────┐  ┌───────────────────────────┐   │
│   │         URI          │  │          Data             │   │
│   │                      │  │                           │   │
│   │  scheme://host/path  │  │  { any: "json value" }    │   │
│   │                      │  │                           │   │
│   │  ── who can write    │  │  ── what is being sent    │   │
│   │  ── what schema      │  │  ── optionally encrypted  │   │
│   │  ── where it lives   │  │  ── optionally signed     │   │
│   └──────────────────────┘  └───────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

The URI encodes the **rules**: which program validates it, who has write access,
and where it belongs in the namespace. The data encodes the **content**: the
actual payload, potentially wrapped in cryptographic layers.

What makes this powerful:

- **URI as address** — Deterministic, human-readable, hierarchical. You can
  reason about ownership and access from the address alone.
- **Data as payload** — Arbitrary JSON. The receiver doesn't interpret it unless
  it wants to.
- **Encryption as privacy** — Data is encrypted client-side before it ever
  leaves the sender. The node that stores it cannot read it.
- **Signing as identity** — An Ed25519 signature proves authorship. No
  passwords, no sessions, no server-side state.

The exchange is always the same operation: `receive([[uri, values, data]])`. The
trust model changes what goes into the URI and what wraps the data.

---

## Trust Models

Trust in B3nd is not binary. Different applications need different levels of
assurance about identity, privacy, and infrastructure reliability. Here are six
models, from zero trust to distributed consensus.

### 1. Serverless — Password Auth

**Trust required:** None. You trust the password you chose.

```
┌──────────┐           ┌──────────┐
│  Client   │──[msg]──>│   Node   │
│           │          │          │
│ encrypts  │          │ validates │
│ with pwd  │          │ schema   │
└──────────┘           └──────────┘
```

The client derives an encryption key from a password and a URI-based salt.
Anyone with the password can read and write. The node validates the URI schema
but never sees the plaintext.

**Use cases:** Shared family albums, protected wikis, demo apps.

**What you get:**

- Confidentiality from the node operator
- Write access for anyone with the password
- Zero account management

**What you give up:**

- No individual identity — everyone with the password looks the same
- No revocation — if the password leaks, you make a new address

### 2. Non-Custodial — Vault / HMAC

**Trust required:** Minimal. You trust one secret (an OAuth token or passphrase)
to derive your keypair deterministically.

```
┌──────────┐    OAuth token     ┌──────────┐
│  Client   │──────────────────>│  Vault   │
│           │                   │ Handler  │
│           │<──HMAC secret─────│          │
│           │                   └──────────┘
│ derives   │
│ keypair   │
│ locally   │
│           │──[signed msg]────>┌──────────┐
│           │                   │   Node   │
└──────────┘                    └──────────┘
```

The vault handler (like `apps/vault-listener/`) verifies an OAuth token and
returns an HMAC-derived secret. The client uses this secret to derive an Ed25519
keypair. The vault never sees or stores the keypair — it only provides the seed.

**Use cases:** Apps where users sign in with Google/GitHub but own their data
cryptographically.

**What you get:**

- Deterministic identity — same OAuth → same keypair, every time
- Non-custodial — the vault cannot impersonate you
- Key recovery — re-authenticate to re-derive

**What you give up:**

- Trust in the vault to not alter the HMAC secret
- Trust in the OAuth provider for initial authentication

### 3. Pubkey Access Control

**Trust required:** Trust the schema, not the operator.

```
┌──────────┐                    ┌──────────┐
│  Client   │──[signed msg]────>│   Node   │
│  (has     │                   │          │
│  keypair) │                   │ verifies │
│           │                   │ sig ∈ URI│
│           │                   │          │
└──────────┘                    └──────────┘
```

The `accounts` programs enforce that the signer's pubkey matches the pubkey in
the URI. The node validates this — it cannot bypass it without breaking the
schema. The client trusts the schema rules, not the specific node operator.

**Use cases:** User-owned profiles, authenticated APIs, any app where write
access is identity-bound.

**What you get:**

- Unforgeable write access — only the key holder can write
- Portable identity — works on any node running the same schema
- Verifiable reads — anyone can confirm who wrote the data

**What you give up:**

- Key management complexity (secure storage, backup)
- No recovery if the private key is lost

### 4. Managed Node Operator

**Trust required:** Trust the infrastructure.

```
┌──────────┐                    ┌──────────────┐
│  Client   │──[msg]───────────>│   Managed    │
│           │                   │    Node      │
│           │                   │              │
│           │                   │  ┌────────┐  │
│           │                   │  │Postgres│  │
│           │                   │  └────────┘  │
│           │                   │  ┌────────┐  │
│           │                   │  │ Mongo  │  │
│           │                   │  └────────┘  │
│           │                   │  ┌────────┐  │
│           │                   │  │Replicas│  │
│           │                   │  └────────┘  │
└──────────┘                    └──────────────┘
```

The operator runs persistent storage, handles backups, and guarantees uptime.
Clients trust the operator for durability and availability. This can be combined
with any of the above — you can have a managed node that still enforces pubkey
access control.

**Use cases:** Production deployments, SaaS platforms, enterprise.

**What you get:**

- Durability guarantees
- Operational monitoring, backups, SLAs
- Multi-backend redundancy

**What you give up:**

- Dependence on the operator for availability
- Operator can see metadata (URIs, timestamps, data sizes)

### 5. Three-Party Consensus

**Trust required:** Distributed. No single party can cheat.

```
┌──────────┐
│  Client   │──[msg]──┬────────>┌──────────┐
│           │         │         │  Node A  │
│           │         │         └──────────┘
│           │         │
│           │         ├────────>┌──────────┐
│           │         │         │  Node B  │
│           │         │         └──────────┘
│           │         │
│           │         └────────>┌──────────┐
│           │                   │  Node C  │
└──────────┘                    └──────────┘
                                     │
                              2-of-3 agree
                              = accepted
```

The client sends the same message to multiple independent nodes. A quorum must
agree on acceptance. This prevents any single operator from censoring, altering,
or losing data.

**Use cases:** High-value records, regulatory compliance, cross-org
collaboration.

**What you get:**

- Byzantine fault tolerance
- No single point of failure or control
- Censorship resistance

**What you give up:**

- Latency (must wait for quorum)
- Cost (multiple operators, multiple storage)
- Complexity (conflict resolution, consistency)

---

## Party Interactions

The trust models above describe the _vertical_ relationship between client and
infrastructure. These patterns describe the _horizontal_ relationships — how
parties communicate through the exchange primitive.

### Client ↔ Client — Encrypted Direct Messaging

Two clients communicate through a shared inbox, encrypted end-to-end.

```
┌─────────┐    ① encrypt to B's pubkey        ┌──────────┐
│ Alice    │───────────────────────────────────>│   Node   │
│ (Client) │   receive([inbox/B/topic/ts,       │          │
│          │           encrypted_msg])           │  stores  │
└─────────┘                                    │  opaque  │
                                               │  blob    │
┌─────────┐    ② list + read inbox/B/topic/    │          │
│  Bob     │<──────────────────────────────────│          │
│ (Client) │   decrypt with B's private key    │          │
│          │                                   └──────────┘
└─────────┘
```

The node sees: a URI, an opaque blob, a timestamp. It never sees the message
content, the sender's identity (unless Alice chooses to sign), or the
relationship between the parties.

### Client ↔ Handler — Auth, Moderation, Indexing

A handler sits between a client and a node, processing messages with server-side
logic.

```
┌─────────┐    ① encrypted request             ┌──────────┐
│ Client   │──────────────────────────────────>│   Node   │
│          │   receive([handler/inbox/ts,       │          │
│          │           encrypted_req])           │          │
│          │                                   │          │
│          │                                   │  ┌─────┐ │
│          │                          list()───│──│inbox │ │
│          │                          read()───│──│     │ │
│          │                                   │  └─────┘ │
│          │                                   │     │    │
│          │                                   │  ┌──▼──┐ │
│          │                                   │  │ Hdl │ │
│          │                                   │  └──┬──┘ │
│          │                                   │     │    │
│          │    ③ read encrypted response       │  ┌──▼──┐ │
│          │<──────────────────────────────────│──│outbx│ │
│          │                                   │  └─────┘ │
└─────────┘                                    └──────────┘
```

The handler uses `respondTo()` to wrap its logic. It receives encrypted
requests, decrypts them, runs its function, encrypts the response back to the
client, and writes it to the client's outbox. The client polls for the response.

### Handler ↔ Handler — Service Composition

Handlers can chain: one handler's output becomes another's input.

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Handler A │────>│   Node   │────>│ Handler B │
│  (auth)   │     │          │     │ (process) │
│           │     │ A writes │     │           │
│           │     │ to B's   │     │ B reads   │
│           │     │ inbox    │     │ its inbox │
└──────────┘     └──────────┘     └──────────┘
```

Handler A validates a request and writes the approved payload to Handler B's
inbox. Handler B picks it up and processes it. This is service composition
through the message bus — no direct connections between services, no shared
memory, no RPC.

### Client ↔ Network — Public Content & Discovery

Public data lives at open URIs. Anyone can read, anyone can write (where the
schema allows).

```
┌─────────┐     ┌──────────┐     ┌─────────┐
│ Writer   │────>│   Node   │<────│ Reader  │
│          │     │          │     │         │
│ receive  │     │ mutable: │     │ read()  │
│ ([open/  │     │ //open/  │     │ list()  │
│  path,   │     │ path     │     │         │
│  data])  │     │          │     │         │
└─────────┘     └──────────┘     └─────────┘
```

This is the simplest interaction. No encryption, no signing, no identity. The
URI's scheme determines the access model (`mutable://open` = anyone can write).
Discovery happens through `list()` — enumerate what exists under a path.

---

## Crypto Guarantees

Each cryptographic primitive in B3nd provides a specific guarantee.
Understanding what each one does (and doesn't do) is essential for choosing the
right trust model.

### Signing → Authorship & Non-Repudiation

```
┌──────────┐                          ┌──────────┐
│  Signer  │    [uri, { data,         │   Node   │
│          │     auth: {              │          │
│ signs    │       publicKey,         │ verifies │
│ with     │       signature          │ sig      │
│ privKey  │     }}]                  │ matches  │
│          │─────────────────────────>│ pubkey   │
└──────────┘                          │ in URI   │
                                      └──────────┘
```

- **Proves:** This data was written by the holder of this private key.
- **Guarantees:** No one can forge a message as you. No one can deny you wrote
  it (non-repudiation).
- **Does not guarantee:** Privacy. Signed data is not encrypted — anyone who can
  read the URI can see the content and verify the signature.

### Encryption → Confidentiality Between Two Parties

```
┌──────────┐                          ┌──────────┐
│  Sender  │    [uri, encrypted_blob] │   Node   │
│          │─────────────────────────>│          │
│ encrypts │                          │  stores  │
│ to       │                          │  opaque  │
│ receiver │                          │  blob    │
│ pubkey   │                          │          │
└──────────┘                          └────┬─────┘
                                           │
                                      ┌────▼─────┐
                                      │ Receiver │
                                      │          │
                                      │ decrypts │
                                      │ with own │
                                      │ privKey  │
                                      └──────────┘
```

- **Proves:** Only the intended recipient can read this message.
- **Guarantees:** Confidentiality in transit and at rest. The node, the network,
  and any eavesdropper see only an opaque blob.
- **Does not guarantee:** Sender identity (unless also signed). The receiver
  knows someone encrypted to their key but not necessarily who.

### HMAC → Deterministic Derivation, Secret-Scoped Identity

```
┌──────────┐    secret + input        ┌──────────┐
│  Client   │─────────────────────────>│  Derive  │
│           │                          │          │
│           │<──deterministic output───│  HMAC    │
│           │                          │          │
└──────────┘                           └──────────┘
```

- **Proves:** Given the same secret and input, you always get the same output.
- **Guarantees:** Deterministic key derivation. The same user authenticating the
  same way always gets the same keypair.
- **Does not guarantee:** That the secret provider is honest. The HMAC output is
  only as trustworthy as the secret source (see Model 2).

### Hashing → Content Addressing & Integrity

```
┌──────────┐    data                  ┌──────────┐
│  Writer   │─────────────────────────>│  SHA256  │
│           │                          │          │
│           │<──hash (URI)─────────────│          │
│           │                          └──────────┘
│           │
│           │    [hash://sha256/{h},   ┌──────────┐
│           │     data]               │   Node   │
│           │─────────────────────────>│          │
│           │                          │ verifies │
│           │                          │ hash(data│
│           │                          │ ) == URI │
└──────────┘                           └──────────┘
```

- **Proves:** The data at this URI is exactly what was originally written. If
  the data changes, the hash changes, and the URI would be different.
- **Guarantees:** Integrity and immutability. Content-addressed data cannot be
  tampered with.
- **Does not guarantee:** Authorship or privacy. Anyone can hash data. The hash
  doesn't tell you who created it.

---

## Compose as Trust Boundary

The compose primitives — `when()`, `respondTo()`, `pipeline()`, `connect()` —
are not just code organization tools. They express trust decisions.

### `when()` — Access Control in Code

```typescript
// Only process if the URI matches the expected pattern
when(
  (msg) => msg[0].startsWith("mutable://accounts/"),
  signatureValidator,
);
```

`when()` is a conditional gate. It says: "this processor only activates for
messages that match this condition." This is a trust decision — you're defining
the boundary of what this processor will handle.

### `respondTo()` — The Encrypted Boundary

```typescript
const processor = respondTo(myHandler, {
  identity, // who am I?
  client, // where do I write responses?
});
```

`respondTo()` draws the strongest trust boundary. It wraps a plain function in
an encrypt/decrypt envelope:

```
encrypted request ──> decrypt ──> handler(req) ──> encrypt ──> signed response
```

Everything inside the handler runs in the clear — it sees plaintext requests and
returns plaintext responses. Everything outside is encrypted and signed. The
handler author never thinks about crypto. The trust boundary is the function
signature.

### `pipeline()` — Sequential Trust Layers

```typescript
pipeline(
  rateLimiter, // trust: not too fast
  schemaValidator, // trust: well-formed
  authChecker, // trust: authorized
  businessLogic, // trust: valid operation
);
```

A pipeline builds trust incrementally. Each step adds a guarantee. If any step
rejects, the message is dropped. The final processor only runs if all prior
checks passed. Order matters — validate cheap things first.

### `connect()` — Transport Trust

```typescript
const connection = connect(client, {
  prefix: "immutable://inbox/my-handler/",
  processor,
  pollIntervalMs: 5000,
});
```

`connect()` expresses trust in the transport layer. It says: "I trust this node
to hold messages for me, and I'll poll to collect them." The alternative (future
`subscribe()`) would say: "I trust this node to push messages to me in real
time." Different transports, same handler — because the trust boundary is in the
processor, not the transport.

### Trust Composition Pattern

Putting it all together:

```
connect(node, {                      ← transport trust
  processor: pipeline(               ← sequential trust
    when(isMyInbox, ...),            ← access control
    respondTo(handler, {             ← crypto boundary
      identity,
      client: node,
    }),
  ),
})
```

Each layer is independently testable. Each layer adds one trust guarantee. The
handler at the center is a pure function — it doesn't know about transport,
encryption, or access control. It just processes requests and returns responses.

---

## Summary

| Trust Model           | Who holds keys? | Crypto in client? | Node sees plaintext? |
| --------------------- | --------------- | ----------------- | -------------------- |
| Serverless (password) | Nobody          | Yes (symmetric)   | No                   |
| Non-custodial (vault) | Client          | Yes (asymmetric)  | No                   |
| Pubkey access control | Client          | Yes (signing)     | Yes (data only)      |
| Managed operator      | Varies          | Varies            | Varies               |
| Three-party consensus | Client          | Yes               | No                   |

The exchange primitive stays the same: `[uri, values, data]`. What changes is
what wraps the data and who can unwrap it. The compose layer lets you express
these decisions as code — testable, composable, portable.

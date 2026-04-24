# B3nd — DePIN Framework & SDK

You are here to create a DePIN network. B3nd provides URI-addressed resource
design, schema-driven validation, and cryptographic primitives. Protocols are
built on top of B3nd. Apps are built on top of protocols.

This document covers B3nd itself — what the framework provides and how protocols
use it.

---

## Three Layers of Abstraction

| Layer | What | Who | Relies on |
|-------|------|-----|-----------|
| **1. Framework** | B3nd — addressed data, schema dispatch, auth primitives, SDK | B3nd developers | Nothing — this is the foundation |
| **2. Protocol** | Program schemas, consensus, fees, URI conventions | Protocol developers | B3nd SDK |
| **3. App** | e.g., social network — UX, auth flows, data display | App developers | B3nd SDK + protocol SDK/endpoints |

The SDK is Layer 1's product. It provides tools to everyone above. Protocol
developers reach into it for primitives. App developers reach into it for
clients and helpers.

---

## Layer 1: B3nd Framework

### The Problem

Machines and people need to exchange and verify data across untrusted networks.
B3nd provides the minimal infrastructure: URI-addressed resources, schema-driven
validation, cryptographic integrity, and unidirectional message flow.

Think of it as a postal system. Letters (data) go into addressed envelopes
(messages). Post offices (nodes) validate and deliver them. The postal system
doesn't read your mail — and it doesn't promise to keep a copy either. Whether
a post office archives letters is the postmaster's decision, not the system's.

### The Message Primitive

All state changes flow through a single operation. A message is a 3-tuple:

```typescript
type Output<D = unknown> = [uri: string, values: Record<string, number>, data: D];
type Message<D = unknown> = Output<D>;
```

- **uri** addresses where the data goes.
- **values** carries conserved quantities (UTXO-style "fire", "gas", …).
  `{}` means "no conserved quantities" — it is **always present**, never optional.
  See [DESIGN_PRIMITIVE.md](./DESIGN_PRIMITIVE.md#values-and-conservation) for
  what the slot is for.
- **data** is the payload.

Every example in this document uses the 3-tuple shape. A write with no
conserved quantities looks like `["mutable://open/x", {}, data]`. Older
examples in the wild that pass `[uri, data]` are out of date — the middle
slot is mandatory.

### The Envelope Shape

Messages that reference other state bundle inputs + outputs into a single
`MessageData` payload:

```typescript
interface MessageData {
  auth?: Array<{ pubkey: string; signature: string }>;
  inputs: string[];     // URIs this message references or consumes
  outputs: Output[];    // [uri, values, data] tuples this message produces
}
```

`MessageData` is itself the `data` slot of a 3-tuple message — the complete
envelope-on-the-wire is:

```
[envelope_uri, {}, { auth?, inputs, outputs }]
```

`auth` is optional — programs decide whether they need it. `inputs`/`outputs`
are flat (no `payload:` nesting). Envelopes can reference other envelopes by
hash URI — that recursive structure is the foundation for protocol design:
content → validation → confirmation are all just envelopes referencing envelopes.

Every layer — user request, validator attestation, confirmer finalization —
uses this same shape. The framework doesn't distinguish between them.

### How It Works

B3nd is small. The entire framework is a validation dispatch loop. Here's
what happens when a message arrives at a node:

```
message arrives: [uri, values, data]
        │
        ▼
  extract program from URI
  (scheme://hostname)
        │
        ▼
  look up validation function
  in schema table
        │
    ┌───┴───┐
    │       │
 not found  found
    │       │
    ▼       ▼
 reject   run validator(output, upstream, read)
            │
        ┌───┴───┐
        │       │
     invalid   valid
        │       │
        ▼       ▼
     reject   accept message
              return accepted
```

That's it. There is no queue, no consensus engine, no message manager
inside the framework. A node receives a message, dispatches to a validator,
and accepts or rejects. Everything else — consensus, fees, multi-step
workflows — is built by protocols on top of this loop using the same message
primitive.

**What the validator sees:**

```typescript
async function myValidator(
  output: [string, Record<string, number>, unknown], // [uri, values, data]
  upstream: [string, Record<string, number>, unknown] | undefined, // parent envelope, or undefined for plain writes
  read: (uri: string) => Promise<ReadResult>,  // read existing state (any URI)
) {
  const [uri, values, data] = output;
  // Your logic here. Read other URIs, check signatures,
  // enforce business rules — whatever the program needs.
  return { valid: true };
  // or: return { valid: false, error: "reason" };
}
```

Validators can read any URI available on the node — not just URIs in their own
program. This means a validator for `mutable://accounts` can read from
`hash://sha256` to verify content integrity, or from `link://accounts` to
check authorization chains. Cross-program reads are how protocols compose
behavior without coupling programs together.

**What this means for protocol developers:**

The entire protocol is a schema table — a mapping from program keys to
validator functions. There is no other extension point. You don't register
middleware, subscribe to events, or override framework methods. You write
validators, and the framework calls them.

This constraint is deliberate. It means every protocol can be fully understood
by reading its schema table. Every program's behavior is defined in one place.
There are no hidden interactions between programs — only explicit reads during
validation.

**What happens with envelopes (MessageData):**

When a `receive()` call contains a `MessageData` envelope, the client
automatically unpacks it. Each output in `outputs` is written to the
client's own underlying Store — these writes do **not** re-enter the Rig
for cross-connection routing. The envelope itself is stored at its
content-addressed hash URI as an audit trail. See
[DESIGN_PRIMITIVE.md](./DESIGN_PRIMITIVE.md#envelopes-and-the-rig) for
what this means for multi-backend fan-out.

This is handled by the client, not the framework. The `msgSchema()` validator
validates the envelope AND each output before the client sends anything.
If any output fails validation, the entire envelope is rejected.

### Programs and Schema Dispatch

A **program** is identified by `scheme://hostname` in a URI. Programs define
validation rules — what data is acceptable, who can write, what constraints
apply.

```
URI: mutable://accounts/alice/profile
      ├── scheme: mutable
      ├── hostname: accounts
      ├── program: mutable://accounts  ← selects validation function
      └── path: /alice/profile         ← organizes data within program
```

Programs provide behavioral guarantees — mutability, authentication,
content-addressing. How a protocol organizes programs is a protocol design
choice. Some protocols use a few broad programs and organize domain concepts
as paths. Others create domain-specific programs. The framework is agnostic.

The **programs** table maps program keys to `Program` classifiers. A `Program`
returns a protocol-defined `code`, not a binary `{ valid, error }`:

```typescript
type Output<T = unknown> = [uri: string, values: Record<string, number>, data: T];

type ProgramResult = {
  code: string;     // protocol-defined classification, e.g. "proto:valid"
  error?: string;   // human-readable reason (for rejections)
};

type Program<T = unknown> = (
  output: Output<T>,
  upstream: Output | undefined,
  read: ReadFn,
) => Promise<ProgramResult>;

// Example: a programs table with two entries
const programs: Record<string, Program> = {
  "mutable://open": async ([, , data]) => ({
    code: data ? "ok" : "rejected",
    error: data ? undefined : "empty data",
  }),
  "test://data": async () => ({ code: "ok" }),
};
```

When a message arrives via `rig.receive()`, the rig finds the program whose
key is the longest prefix of the URI (`mutable://accounts/alice/profile`
matches `mutable://accounts`). It runs the program, then dispatches to the
handler registered for the returned `code`. See the `handlers` table in
[DESIGN_PRIMITIVE.md](./DESIGN_PRIMITIVE.md#protocol-packages) for how codes
are wired to operational behavior.

### What Changed: Schema → Programs

Earlier revisions of b3nd used a `Schema` type with `Validator` functions
returning `{ valid: boolean, error?: string }`, installed on the Rig via a
`schema:` config key. That API has been replaced by `programs:` + `handlers:`,
with two material semantic changes:

1. **Classification replaces validation.** A `Program` returns
   `{ code, error? }`. The framework no longer has a built-in notion of
   "valid" vs "invalid"; rejections are just programs that return a `code`
   with an `error` set. Any non-error code is accepted, and each code can
   be wired to a different handler. This is strictly more expressive than
   the old boolean — a message can be "valid but not yet confirmed", for
   example, and each state can be handled differently.

2. **Unknown prefixes pass through by default.** The old `Schema` rejected
   any URI that didn't match a registered program. `programs:` now
   **dispatches directly to connections** when no program matches — i.e.
   unknown URIs are written without validation. If you want the old
   "rejection by default" posture, register an explicit rejecter:

   ```typescript
   const rejectUnknown: Program = (msg) => Promise.resolve({
     code: "rejected",
     error: `rejected by program: ${msg[0]}`,
   });

   const rig = new Rig({
     connections: [...],
     programs: {
       // Your real programs here...
       "mutable://accounts": accountsProgram,
       // Any prefix you want closed, install an explicit rejecter for it.
       // Programs match by longest prefix, so this only catches URIs that
       // don't match a more specific program above.
       "mutable://": rejectUnknown,
     },
   });
   ```

   This is the pattern used in the rig test suite (`libs/b3nd-rig/rig.test.ts`,
   look for the `rejectUnknown` fixture) and in `libs/b3nd-client-memory/mod.ts`
   (`createTestPrograms`).

   This is a real security-posture change. The framework trades "schema is
   law" for "protocols must explicitly install a rejecter". If you are
   porting a Schema-era protocol, the migration is: register your old
   validators as programs, add a rejecter at any prefix you want closed.

3. **Programs only run on `rig.receive()`, not on `rig.send()`.** See the
   "Programs validate receives, not sends" subsection below — this is the
   single biggest gotcha when porting from the old Schema API, because the
   old `msgSchema()` helper ran on the *client* and therefore caught both
   paths.

### Programs validate receives, not sends

The program pipeline (`_runProgram` in `libs/b3nd-rig/rig.ts`) is invoked
only from `rig.receive()`. `rig.send()` takes a pre-built `MessageData`
envelope, runs the `beforeSend` hook, and dispatches **directly to
connections** — it never classifies the envelope or its outputs.

This surprises people migrating from the old `msgSchema()` helper, which
wrapped the *client* and therefore caught both read and write paths. The
new Rig pipeline only guards receives.

If you need validation on authenticated writes, choose one of:

- **Route writes through `receive()` with a signed payload in `data`.** The
  identity signs a nested payload, the top-level URI's program verifies the
  signature and the outputs before any storage happens. This is the idiom
  the rig tests use for signed-write enforcement.
- **Use a `beforeSend` hook** to throw on unauthorized envelopes. Hooks run
  on `rig.send()` as well as on `session.send()`.
- **Accept that trust is established transport-side** — e.g. by requiring
  HTTPS + authenticated transport before the envelope ever reaches the rig.

A worked example of the "receive + signed data" pattern lives in
`apps/ad-agency/03-creative-approvals.ts` on the exploration branch.

When a message arrives via `receive()`, the framework extracts
`scheme://hostname` from the URI, looks up the program, and calls it. If no
program matches, the message is dispatched to connections without
validation. Programs decide everything: mutability, authentication,
content-addressing, access patterns.

### NodeProtocolInterface

All clients implement:

```typescript
interface NodeProtocolInterface {
  receive<D>(msg: Message<D>): Promise<ReceiveResult>;
  read<T>(uri: string | string[]): Promise<ReadResult<T>[]>;
  status(): Promise<StatusResult>;
}
```

`receive()` is the fundamental write operation — every state change flows
through it. This is the unidirectional flow: messages go in, state comes out.

`read()` accepts a single URI string or an array of URI strings and always
returns `ReadResult[]`. A trailing slash on the URI acts as a list/prefix
query — `client.read("mutable://open/my-app/")` returns all children under
that prefix.

`status()` returns node health information and the available schema (program
keys).

### Basic Operations

```typescript
// Deno
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
// Browser
import { HttpClient } from "@bandeira-tech/b3nd-web";

const client = new HttpClient({ url: "http://localhost:9942" });

// Write — single message
await client.receive([["mutable://open/my-app/config", {}, { theme: "dark" }]]);

// Read (always returns ReadResult[])
const [result] = await client.read("mutable://open/my-app/config");
console.log(result.record?.data); // { theme: "dark" }

// List (trailing slash = prefix query)
const items = await client.read("mutable://open/my-app/");

// Read multiple URIs at once
const results = await client.read([
  "mutable://open/my-app/config",
  "mutable://open/my-app/status",
]);
```

### The send() and message() API

`send()` batches multiple writes into a content-addressed envelope. It computes
a SHA256 hash of the `MessageData` (via RFC 8785 canonical JSON), sends
through the client, and returns the result:

```typescript
import { send } from "@bandeira-tech/b3nd-sdk";
// or: import { send } from "@bandeira-tech/b3nd-web";

const result = await send({
  inputs: [],
  outputs: [
    ["mutable://open/app/config", {}, { theme: "dark" }],
    ["mutable://open/app/status", {}, { active: true }],
  ],
}, client);
// result.uri = "hash://sha256/{hex}" — the envelope's content-addressed URI
// result.accepted = true

// With auth:
const authResult = await send({
  auth: [{ pubkey, signature }],
  inputs: [],
  outputs: [["mutable://accounts/{pubkey}/profile", {}, signedData]],
}, client);
```

- `MessageData` is flat `{ auth?, inputs, outputs }` — there is no `payload`
  nesting.
- Each `MessageDataClient.receive()` detects the `{ inputs, outputs }`
  shape and decomposes it into the underlying Store — inputs get deleted,
  outputs get written to the same Store. Note that **outputs are NOT
  re-routed through the Rig** — if you want cross-connection fan-out
  based on output URI patterns, call `rig.receive([msg, msg, msg])` with
  one tuple per destination. See the "Envelopes and the Rig" note in
  [DESIGN_PRIMITIVE.md](./DESIGN_PRIMITIVE.md#envelopes-and-the-rig).
- The envelope is stored at its hash URI as an audit trail.

The lower-level `message()` function builds the tuple without sending:

```typescript
import { message } from "@bandeira-tech/b3nd-sdk";

const [uri, values, data] = await message({
  inputs: [],
  outputs: [["mutable://open/config", {}, { theme: "dark" }]],
});
// uri    = "hash://sha256/{computed-hash}"
// values = {}
// data   = { inputs: [], outputs: [...] }
```

### Auth Primitives

The SDK provides Ed25519 signing and X25519 encryption. These are tools —
protocols decide how to use them.

```typescript
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
// or from "@bandeira-tech/b3nd-sdk/encrypt"

// Generate keypairs
const signingKeys = await encrypt.generateSigningKeyPair();
const encryptionKeys = await encrypt.generateEncryptionKeyPair();

// Sign data (Ed25519)
const signed = await encrypt.createAuthenticatedMessageWithHex(
  payload, signingKeys.publicKeyHex, signingKeys.privateKeyHex,
);

// Verify signature
const isValid = await encrypt.verify(signed);

// Asymmetric encryption (X25519 + AES-GCM)
const encrypted = await encrypt.encrypt(data, recipientPublicKeyHex);
const decrypted = await encrypt.decrypt(encrypted, recipientPrivateKey);

// Symmetric encryption (password-based, PBKDF2)
const key = await encrypt.deriveKeyFromSeed(password, salt, 100000);
const encrypted = await encrypt.encryptSymmetric(data, key);
const decrypted = await encrypt.decryptSymmetric(encrypted, key);
```

### SDK Toolbox

The SDK provides utilities that protocols may use. These are tools, not
framework requirements.

#### Content-Addressing (hash utilities)

```typescript
import { computeSha256, generateHashUri, hashValidator, verifyHashContent }
  from "@bandeira-tech/b3nd-sdk/hash";
// or from "@bandeira-tech/b3nd-web/hash" in browser

const data = { title: "Hello", content: "World" };
const hash = await computeSha256(data);
const hashUri = generateHashUri(hash); // "hash://sha256/{hash}"

// hashValidator() — ready-made validation function for content-addressed programs
// verifyHashContent() — verify data matches its hash URI
```

#### Client Composition

```typescript
import {
  createValidatedClient, msgSchema, FunctionalClient,
} from "@bandeira-tech/b3nd-sdk";
import { flood, peer } from "@bandeira-tech/b3nd-sdk/network";

// Compose multiple backends via `flood` — broadcast writes, first-match reads.
const backends = [postgresBackend, memoryBackend].map((c, i) =>
  peer(c, { id: `local-${i}` })
);
const composed = flood(backends);
const client = createValidatedClient({
  write: composed,
  read: composed,
  validate: msgSchema(schema),
});

// Validators: seq(), any(), all(), msgSchema(), schemaValidator()
// Strategy factories: flood(peers), pathVector(peers) — see
// `@bandeira-tech/b3nd-sdk/network` for the full network lib.

// Custom behavior without class inheritance
const client = new FunctionalClient({
  receive: async (msg) => backend.receive(msg),
  read: async (uri) => backend.read(uri),
});
```

### URI Design

URI paths work like filesystem directories. Data at a leaf URI is a resource.
Prefix listing (`client.read("prefix/")`) enumerates children (trailing slash
signals a list query).

### Privacy Levels

| Level     | Encryption Key                | Access               |
| --------- | ----------------------------- | -------------------- |
| Public    | None                          | Anyone can read      |
| Protected | Password-derived (PBKDF2)     | Anyone with password |
| Private   | Recipient's X25519 public key | Only recipient       |

### Framework Design Principles

These are architectural commitments B3nd makes:

1. **Unidirectional flow.** Messages go in, state comes out. No callbacks, no
   subscriptions at the protocol level. Nodes receive, validate, accept or reject.

2. **No liveness guarantees.** B3nd is fire-and-forget. The framework makes no
   promises about delivery, timing, or retry. If you mail a letter, the postal
   system doesn't guarantee arrival. Protocols that need delivery guarantees
   build them on top (receipt messages, acknowledgment patterns).

3. **Schema is law.** If the schema accepts a message, it's valid. If it
   rejects, it never happened. There is no partial acceptance, no pending state
   at the framework level.

4. **Programs are protocol-defined.** The framework dispatches to programs but
   makes no rules about what programs should represent. Programs can be broad
   behavioral layers or narrow domain-specific validators — that's a protocol
   design choice.

5. **Encryption is client-side.** B3nd nodes receive what they're given. Privacy
   is achieved by encrypting before sending. The network is untrusted by design.

### B3nd Is Not a Storage Layer

B3nd validates and dispatches messages. It does not guarantee that accepted
messages are stored, replicated, or retained. What a node does with an accepted
message — write it to Postgres, cache it in memory, forward it to another node,
or discard it — is entirely the node operator's decision.

This is deliberate. B3nd sits between frontends and backends as a universal
interface layer:

```
┌─────────────┐                      ┌─────────────────┐
│  Frontends  │    [uri, values, data] →     │     B3nd Node    │
│  (apps, UX) │  ← read(uri)        │  validate only   │
└─────────────┘                      └────────┬────────┘
                                              │
                                     node operator chooses:
                                     ┌────────┼────────┐
                                     │        │        │
                                  Postgres  Memory  Forward
                                  MongoDB   Redis   Discard
                                  S3        ...     ...
```

App developers think about resources and user experience — they `receive()`
messages and `read()` URIs through a common interface. They don't know or care
what backend sits behind the node.

Infrastructure operators choose storage engines, replication strategies, and
retention policies. They don't know or care what apps are sending.

Protocol developers define the validation rules that sit between them — the
schema table. They don't couple to either side.

The SDK provides storage backends (MemoryStore, PostgresStore,
MongoStore, etc.) wrapped by protocol clients (MessageDataClient, SimpleClient)
as ready-made NodeProtocolInterface implementations. But these are tools for
node operators, not framework guarantees. A node using MemoryStore loses
everything on restart. A node using PostgresStore retains everything. Both are
valid B3nd nodes — the framework doesn't distinguish between them.

This is what makes B3nd a universal backend layer. Like HTTPS standardizes
transport without dictating what servers do with requests, B3nd standardizes
resource addressing and validation without dictating what nodes do with
accepted messages.

### Available Stores, Protocol Clients & Transport Clients

**Stores** — pure mechanical storage (no protocol awareness):

| Store                | Package    | Use                        |
| -------------------- | ---------- | -------------------------- |
| `MemoryStore`        | Both       | Testing, in-process        |
| `PostgresStore`      | JSR        | PostgreSQL storage         |
| `MongoStore`         | JSR        | MongoDB storage            |
| `SqliteStore`        | JSR        | SQLite storage             |
| `S3Store`            | JSR        | S3-compatible storage      |
| `FsStore`            | JSR        | Filesystem storage         |
| `LocalStorageStore`  | NPM        | Browser offline cache      |
| `IndexedDBStore`     | NPM        | Browser IndexedDB storage  |

**Protocol clients** — wrap a Store into a NodeProtocolInterface:

| Client               | Package    | Use                                  |
| -------------------- | ---------- | ------------------------------------ |
| `MessageDataClient`  | Both       | Envelope-aware (wraps any Store)     |
| `SimpleClient`       | Both       | Bare storage access (wraps any Store)|

**Transport clients** — direct NodeProtocolInterface, no Store:

| Client               | Package    | Use                        |
| -------------------- | ---------- | -------------------------- |
| `HttpClient`         | Both       | Connect to any HTTP node   |
| `WebSocketClient`    | Both       | Real-time node connection  |
| `ConsoleClient`      | Both       | Debugging / logging        |

### Packages

| Package                          | Registry | Use Case       |
| -------------------------------- | -------- | -------------- |
| `@bandeira-tech/b3nd-sdk`        | JSR      | Deno, servers  |
| `@bandeira-tech/b3nd-web`        | NPM      | Browser, React |

Subpath imports:

```typescript
// JSR (Deno)
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
import { computeSha256 } from "@bandeira-tech/b3nd-sdk/hash";
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

// NPM (Browser)
import { HttpClient } from "@bandeira-tech/b3nd-web";
import { computeSha256 } from "@bandeira-tech/b3nd-web/hash";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
```

| Feature            | b3nd-sdk (JSR) | b3nd-web (NPM) |
| ------------------ | -------------- | --------------- |
| PostgresStore      | Yes            | No              |
| MongoStore         | Yes            | No              |
| SqliteStore        | Yes            | No              |
| S3Store            | Yes            | No              |
| FsStore            | Yes            | No              |
| LocalStorageStore  | No             | Yes             |
| IndexedDBStore     | No             | Yes             |
| Server primitives  | Full           | Limited         |

---

## Layer 2: Protocol Design

Protocols are built on B3nd by defining program schemas, URI conventions, and
message exchange patterns. B3nd provides the transport and validation. Protocols
provide the rules.

This section covers the mechanics, patterns, and open problems of protocol
design. It starts with how the framework dispatches validation, then builds
up to cross-program composition, worked examples, and design tradeoffs.

### What a Protocol Defines

A protocol built on B3nd makes these choices:

1. **Which programs exist** — the schema table (what schemes and hostnames)
2. **What each program validates** — the validation functions
3. **URI conventions** — how paths organize resources
4. **Message exchange patterns** — workflows for multi-step operations
5. **Consensus model** — how messages become confirmed state
6. **Fee model** — how participants are compensated

### How Envelope Dispatch Works (msgSchema)

When a protocol uses `send()`, the data flows through `msgSchema()` — the
central dispatch function that ties programs together. Understanding this
mechanism is essential for protocol design.

`msgSchema(schema)` handles two cases:

1. **Plain message** `[uri, values, data]` — extracts the program from `uri`, looks up
   the validator in the schema table, calls it with `upstream = undefined`.

2. **Envelope message** `[uri, {}, { auth?, inputs, outputs }]` — does
   three things in sequence:
   - Validates the envelope URI against its program validator (with `upstream = undefined`)
   - Enforces content-hash integrity for any `hash://` output URIs
   - Validates each inner output, passing the envelope as `upstream`

If any step fails, the entire envelope is rejected. There is no partial
acceptance.

```typescript
// What msgSchema() does (simplified):
function msgSchema(programSchema) {
  return async (output, upstream, read) => {
    const [uri, values, data] = output;

    if (!isEnvelope(data)) {
      // Plain message: dispatch to one validator, upstream = undefined
      return programSchema[extractProgram(uri)](output, upstream, read);
    }

    // 1. Validate the envelope itself
    const envelopeResult = await programSchema[extractProgram(uri)](output, upstream, read);
    if (!envelopeResult.valid) return envelopeResult;

    // 2-3. Validate each inner output — envelope becomes upstream
    for (const inner of data.outputs) {
      const [outputUri] = inner;
      // Content-hash check (structural, automatic for hash:// URIs)
      // Then dispatch to the output's program validator
      const result = await programSchema[extractProgram(outputUri)](
        inner,   // the inner output being validated
        output,  // the envelope is upstream
        read,
      );
      if (!result.valid) return result;
    }

    return { valid: true };
  };
}
```

**Key insight:** The envelope's program validator sees the *entire* envelope
as its `output` (i.e., `[envelopeUri, {}, { auth, inputs, outputs }]`). Each inner
output's program validator receives the inner `[uri, value]` as `output`
and the full envelope as `upstream`. This means envelope-level concerns
(signature verification, input references, fee checks) belong in the
envelope's program validator, while per-resource concerns (data format,
ownership) belong in each output's program validator. Inner validators
can inspect their `upstream` to access auth, inputs, and sibling outputs.

### Input Semantics

The `inputs` array in an envelope lists URIs that the message references or
depends on. **The framework does not enforce any semantics on inputs.** It does
not check that they exist, consume them, or lock them.

Whether inputs are "consumed" (UTXO-style spending), "referenced" (proof that
something exists), or purely informational is entirely protocol-defined. The
framework just passes them through. Protocol validators that need input
semantics implement them via `read()`:

```typescript
// Protocol-defined: check that all inputs exist and are unconsumed
const envelopeValidator: Validator = async ([uri, , data], upstream, read) => {
  for (const inputUri of data.inputs) {
    const existing = await read(inputUri);
    if (!existing.success) {
      return { valid: false, error: `Input not found: ${inputUri}` };
    }
  }
  return { valid: true };
};
```

### Cross-Program Reads

Validators can read any URI available on the node, not just URIs in their own
program. This is how protocols compose behavior without coupling programs
together.

```typescript
// A link:// validator that verifies the referenced hash:// content exists
const schema: Schema = {
  "link://accounts": async ([uri, , data], upstream, read) => {
    // data is a hash URI string — verify the content it points to exists
    const content = await read(data);
    if (!content.success) {
      return { valid: false, error: `Referenced content not found: ${data}` };
    }
    return { valid: true };
  },

  "hash://sha256": hashValidator(),  // built-in: verifies data matches hash

  "mutable://accounts": async ([uri, , data], upstream, read) => {
    // Check that the writer owns this account by reading their auth link
    const pubkey = uri.split("/")[3]; // mutable://accounts/{pubkey}/...
    const authLink = await read(`link://accounts/${pubkey}/auth`);
    if (!authLink.success) {
      return { valid: false, error: "Account not registered" };
    }
    return { valid: true };
  },
};
```

Cross-program reads are the *only* composition mechanism. Programs don't import
each other, subscribe to events, or share state directly. A validator in program
A reads from program B's URI space during validation. This keeps programs
independent — you can understand each program by reading its validator, and you
can see its dependencies by looking at which URIs it reads.

### Accessing Envelope Context via `upstream`

For protocols with envelope-based message flows, inner output validators
receive the envelope as `upstream`. This gives them access to auth, inputs,
and sibling outputs — without any special types or wrappers:

```typescript
import type { Validator, Schema } from "@bandeira-tech/b3nd-sdk";
import { isMessageData } from "@bandeira-tech/b3nd-sdk";

// Fee validator: inspects sibling outputs via upstream
const feeValidator: Validator = async ([uri, , data], upstream, read) => {
  // upstream is the envelope [envelopeUri, {}, { auth, inputs, outputs }]
  // For plain writes, upstream is undefined
  if (!upstream) return { valid: false, error: "Fee check requires envelope context" };

  const [, envelope] = upstream;
  if (!isMessageData(envelope)) return { valid: false, error: "Invalid envelope" };

  // Example: require a fee output proportional to data size.
  // The fee is a conserved quantity in the Output's `values` slot (position 1).
  const feeOutput = envelope.outputs.find(([u]) => u.startsWith("fees://"));
  if (!feeOutput) return { valid: false, error: "Fee required" };

  const dataSize = JSON.stringify(data).length;
  const requiredFee = Math.ceil(dataSize / 100);
  const fee = feeOutput[1].fire ?? 0; // values: { fire: N }
  if (fee < requiredFee) {
    return { valid: false, error: `Insufficient fee: need ${requiredFee}` };
  }
  return { valid: true };
};
```

Envelope-level concerns (signature verification, input existence,
conservation laws) belong in the envelope's own program validator.
Per-output concerns (data format, fee checks, ownership) belong in the
output's program validator and can inspect `upstream` when needed:

```typescript
const schema: Schema = {
  // Envelope validator: checks signatures, input existence
  "hash://sha256": async ([, , data], _upstream, read) => {
    if (!isMessageData(data)) return { valid: true }; // plain hash: OK
    // Enforce conservation on the `fire` quantity (Output values slot).
    let inputSum = 0;
    for (const inputUri of data.inputs) {
      const [input] = await read(inputUri);
      if (input.success && input.record) {
        inputSum += input.record.values.fire ?? 0;
      }
    }
    const outputSum = data.outputs.reduce(
      (sum, [, values]) => sum + (values.fire ?? 0),
      0,
    );
    if (outputSum > inputSum) {
      return { valid: false, error: "Outputs exceed inputs" };
    }
    return { valid: true };
  },

  // Per-output validators
  "mutable://accounts": accountValidator,
  "link://accounts": linkValidator,
  "fees://pool": async () => ({ valid: true }),
};
```

### Testing Protocol Validators

Test validators using a `MessageDataClient` backed by `MemoryStore` with your
protocol's schema. Test both the happy path (valid messages accepted) and the
rejection path (invalid messages rejected with the right error):

```typescript
import { assertEquals } from "@std/assert";
import { MessageDataClient, MemoryStore, send } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "mutable://accounts": async ([uri, , data]) => {
    if (!data || typeof data !== "object") {
      return { valid: false, error: "Value must be an object" };
    }
    return { valid: true };
  },
  "hash://sha256": hashValidator(),
};

Deno.test("accepts valid account write", async () => {
  const client = new MessageDataClient(new MemoryStore());
  const result = await send({
    inputs: [],
    outputs: [["mutable://accounts/alice/profile", {}, { name: "Alice" }]],
  }, client);
  assertEquals(result.accepted, true);
});

Deno.test("rejects invalid account write", async () => {
  const client = new MessageDataClient(new MemoryStore());
  const result = await send({
    inputs: [],
    outputs: [["mutable://accounts/alice/profile", {}, null]],
  }, client);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "mutable://accounts: Value must be an object");
});

// Test cross-program reads: pre-populate state, then validate against it
Deno.test("validator reads cross-program state", async () => {
  const crossSchema: Schema = {
    "mutable://balances": async ([uri, , data], upstream, read) => {
      const pubkey = uri.split("/")[3];
      const auth = await read(`link://accounts/${pubkey}/auth`);
      if (!auth.success) return { valid: false, error: "Not registered" };
      return { valid: true };
    },
    "link://accounts": async () => ({ valid: true }),
  };
  const client = new MessageDataClient(new MemoryStore());

  // Pre-populate: register the account
  await client.receive([["link://accounts/alice/auth", {}, { active: true }]]);

  // Now the balance write should succeed (cross-program read finds the auth)
  await client.receive([["mutable://balances/alice/balance", {}, { amount: 100 }]]);
  const [result] = await client.read("mutable://balances/alice/balance");
  assertEquals(result.record?.data, { amount: 100 });
});
```

### Recursive Envelopes and Consensus

The envelope shape `{ inputs, outputs }` is the same at every depth. This
enables a natural consensus architecture:

```
Layer: User request
[hash://sha256/{content}, {}, {
  auth: [{ user, sig }],
  inputs: [],
  outputs: [[uri, {}, value], ...]
}]

Layer: Validation (validator endorses the request)
[hash://sha256/{validated}, {}, {
  auth: [{ validator, sig }],
  inputs: ["hash://sha256/{content}"],
  outputs: [["link://accounts/{validator}/validations/{content_hash}", {}, ...]]
}]

Layer: Confirmation (confirmer finalizes)
[hash://sha256/{confirmed}, {}, {
  auth: [{ confirmer, sig }],
  inputs: ["hash://sha256/{validated}"],
  outputs: [["link://accounts/{confirmer}/confirmed/{content_hash}", {}, ...]]
}]
```

Each layer is just a message that references the previous layer as input and
produces new outputs. The framework doesn't know about consensus — it just
processes `[uri, values, data]` messages. Consensus emerges from the program schemas that
control who can write validation and confirmation links.

To verify a message was confirmed, a validator reads the inner envelope by its
hash URI. Since the envelope was content-addressed, `read("hash://sha256/{content}")`
returns the original user request. The validator can then inspect its auth,
inputs, and outputs to decide whether to endorse it:

```typescript
// Validator endorsement: read the user's envelope, verify, write a link
"link://accounts": async ([uri, , data], upstream, read) => {
  // data = "hash://sha256/{content}" — reference to the user's envelope
  const envelope = await read(data);
  if (!envelope.success) return { valid: false, error: "Envelope not found" };

  // Inspect the original envelope's auth, outputs, etc.
  const envelopeData = envelope.record?.data;
  if (!envelopeData?.auth?.length) return { valid: false, error: "Unsigned envelope" };

  // Verify signature, check business rules, etc.
  return { valid: true };
},
```

**B3nd makes consensus a first-class programmable concern.** Protocol developers
writing validation schemas ARE writing consensus protocols. The complexity
doesn't disappear — it moves into explicit, inspectable program schemas.

### Signing and Intent

Every message at every depth is the same gesture: **signing intent to place
outputs at addresses.** A user signs intent to place their profile. A validator
signs intent to place a validity link. A confirmer signs intent to place a
confirmation link. There is no structural difference.

Per-output signing (signing each `[uri, value]` pair individually) is a protocol
design choice, not a framework requirement. Programs that need per-output intent
verification (e.g., financial transfers) can require it in their schema
validation. Programs that don't (e.g., public announcements) skip it.

### Worked Example: A Minimal Protocol

Here is a complete protocol with three programs that compose via cross-program
reads. It implements a simple content-publishing workflow: users publish content,
a validator endorses it, and a mutable "latest" pointer tracks the most recent
endorsed post.

```typescript
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";
import type { Schema } from "@bandeira-tech/b3nd-sdk";

const TRUSTED_VALIDATOR = "abc123..."; // known validator pubkey

const publishingProtocol: Schema = {
  // Immutable content storage — data must match its hash
  "hash://sha256": hashValidator(),

  // Mutable pointers — only the trusted validator can write endorsement links
  "link://posts": async ([uri, , data], upstream, read) => {
    // data is a hash URI pointing to endorsed content
    if (typeof data !== "string" || !data.startsWith("hash://sha256/")) {
      return { valid: false, error: "Link value must be a hash URI" };
    }
    // Verify the content exists
    const content = await read(data);
    if (!content.success) {
      return { valid: false, error: "Linked content not found" };
    }
    return { valid: true };
  },

  // User profiles — anyone can write to their own path
  "mutable://profiles": async ([uri, , data]) => {
    if (!data || typeof data !== "object") {
      return { valid: false, error: "Profile must be an object" };
    }
    return { valid: true };
  },
};
```

**How it's used:**

```typescript
import { MessageDataClient, MemoryStore, send } from "@bandeira-tech/b3nd-sdk";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";

const client = new MessageDataClient(new MemoryStore());

// 1. User publishes content
const post = { title: "Hello World", body: "First post on B3nd" };
const hash = await computeSha256(post);
const hashUri = generateHashUri(hash);

await send({
  inputs: [],
  outputs: [
    [hashUri, {}, post],                                    // immutable content
    ["link://posts/latest", {}, hashUri],                   // mutable pointer
    ["mutable://profiles/alice", {}, { name: "Alice" }],    // profile update
  ],
}, client);

// 2. Read the latest post via the link
const [link] = await client.read<string>("link://posts/latest");
const [content] = await client.read(link.record!.data);
// content.record?.data = { title: "Hello World", body: "First post on B3nd" }
```

### Protocol Design Patterns

#### Content-Addressing + Links

Send immutable content to its hash, reference it via mutable links:

```typescript
// Send content + create named reference in one envelope
const hash = await computeSha256(content);
const hashUri = `hash://sha256/${hash}`;

await send({
  inputs: [],
  outputs: [
    [hashUri, {}, content],                         // immutable content
    ["link://open/posts/latest", {}, hashUri],       // mutable pointer
  ],
}, client);
```

#### Input Consumption

Hash URIs are immutable — you can't "spend" them. Protocols that need input
consumption (UTXO-style) use links as the consumable layer:

```
1. Link points to current state: link://utxo/{id} → hash://sha256/{state1}
2. Message consumes link (overwrites): link://utxo/{id} → hash://sha256/{state2}
3. Old state still exists at hash://, but the link now points to new state
```

The hash chain provides audit trail. The link provides current state. This is
a protocol pattern — B3nd just provides links and hashes as tools.

#### Verification Fast-Path

Walking the full hash chain for every read is expensive. Protocols should
separate the fast path (current state) from the proof path (audit trail):

- **Fast path:** Read mutable state directly (e.g., `mutable://accounts/{key}/balance`)
- **Proof path:** Walk the hash chain for disputes or verification

Validation outputs should include BOTH: a confirmation link (proof) AND a
mutable state write (fast path). The schema enforces both:

```typescript
// Validator writes to both paths in one envelope
await send({
  inputs: ["hash://sha256/{user_request}"],
  outputs: [
    // Proof path: immutable validation record
    ["link://accounts/{validator}/validations/{hash}", {}, validationAttestation],
    // Fast path: update the user's mutable balance
    ["mutable://accounts/{pubkey}/balance", {}, { amount: newBalance }],
  ],
}, client);
```

#### Validator Namespace Design

Open namespaces (`link://valid/{hash}`) are spam surfaces. Prefer
validator-scoped namespaces:

```
link://accounts/{validator_pubkey}/validations/{content_hash}
```

Confirmers check specific known validators, not an open namespace. The
confirmation schema defines which validator pubkeys are trusted.

### Protocol Versioning

The framework extracts programs as `scheme://hostname`. Changing either
component creates a new program with independent validation. Protocols have
several versioning strategies:

- **Path-based versioning:** Keep the same program, version in the path:
  `mutable://accounts/v2/{pubkey}/profile`. Validators check the path to
  apply version-specific rules. This allows a single program to handle
  migration logic.

- **Hostname-based versioning:** New program per version:
  `mutable://accounts-v2/{pubkey}/profile`. Clean separation but requires
  cross-program reads to access old data.

- **Backward-compatible evolution:** Add optional fields, never remove or
  change the meaning of existing fields. Validators accept both old and new
  formats. This is the simplest strategy when possible.

Whichever strategy you choose, the schema table makes it explicit — you can
see every program version in the schema and understand exactly what each
accepts.

### Open Problems in Protocol Design

These are active design questions. Protocol developers should be aware of them:

**Fee timing.** When does the user pay? If fees are outputs in the message, they
only get accepted if validation succeeds — meaning invalid messages are free to
submit. Options: fee escrow (pre-committed), transport-layer fees (HTTP request
cost), or accept-and-rate-limit. For a concrete example of fee validation using
cross-output checks via `upstream`, see the fee validator example above.

**Circular references.** Two validators can cross-validate each other through
link intermediaries. Prevention requires temporal ordering (timestamps in URIs,
round-based validation) or URI design that structurally prevents cycles. For
example, include the referenced hash in the validation URI:
`link://accounts/{validator}/validations/{content_hash}` — since the hash is
derived from the content, a circular reference would require computing a hash
that references itself, which is computationally infeasible.

**Privacy vs. provenance.** Content encryption solves payload privacy but not
traffic analysis. The auth chain reveals participant pubkeys, timing, and message
flow. Ephemeral/derived keys per message reduce linkability. Full metadata
privacy requires mixing/onion routing outside B3nd's scope.

**Checkpoint mechanisms.** Confirmation envelopes can reference previous
confirmations to create checkpoints. A checkpoint envelope's `inputs` list
includes the last checkpoint and all confirmations since then. Light clients
verify from the latest checkpoint instead of walking the full chain. This is a
protocol design decision — the framework provides the recursive envelope shape,
protocols define checkpoint intervals and what constitutes a valid checkpoint.

---

## Protocol Examples

These examples show progressively more complex protocols, each demonstrating a
different B3nd design pattern. Each includes the schema, a node setup snippet,
and a usage example showing what an app consuming the protocol does.

> **Note on API surface.** The examples in this section use the earlier
> `Schema` / `Validator` shape (return `{ valid, error }`) and the
> `msgSchema()` / `createValidatedClient()` / `createServerNode()`
> helpers. Those helpers are gone in the current SDK — the Rig is the
> single entry point now (`programs: { ... }`, `handlers: { ... }`,
> handlers dispatched by code rather than a boolean). The **patterns**
> below (program keyed by URI prefix, cross-program reads, envelope-
> level vs per-output rules) are still exactly right; the function
> shapes have migrated. See the "What Changed: Schema → Programs"
> section earlier in this document for the translation. If you are
> following these examples against today's SDK, expect to adapt each
> validator to a `Program` returning `{ code, error? }` and to install
> them on a `Rig` instead of calling `createServerNode`.

### Simple Open Protocol

The simplest possible DePIN network: a single program that accepts anything.
No authentication, no constraints.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "mutable://open": async () => ({ valid: true }),
};
```

**Node setup:**

```typescript
import { createServerNode, MessageDataClient, MemoryStore, servers } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

const client = new MessageDataClient(new MemoryStore());
const app = new Hono();
const frontend = servers.httpServer(app);
createServerNode({ frontend, client }).listen(9942);
```

**App usage:**

```typescript
const client = new HttpClient({ url: "http://localhost:9942" });
await client.receive([["mutable://open/notes/1", {}, { text: "Hello world" }]]);
const [result] = await client.read("mutable://open/notes/1");
```

This is the "Hello World" of B3nd protocols. Useful for prototyping and local
development. Not suitable for production — anyone can overwrite anything.

### Auth-Based Protocol

Users own namespaces by pubkey. Only the holder of a private key can write to
URIs under their pubkey. Uses `createPubkeyBasedAccess()` and `authValidation()`
from the auth module.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { authValidation, createPubkeyBasedAccess } from "@bandeira-tech/b3nd-sdk/auth";

const schema: Schema = {
  "mutable://open": async () => ({ valid: true }),

  "mutable://accounts": async ([uri, , data]) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value: data });
    return {
      valid: isValid,
      error: isValid ? undefined : "Signature verification failed",
    };
  },

  "immutable://accounts": async ([uri, , data], upstream, read) => {
    // Auth + write-once
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value: data });
    if (!isValid) return { valid: false, error: "Signature verification failed" };

    const existing = await read(uri);
    return {
      valid: !existing.success,
      error: existing.success ? "Immutable object exists" : undefined,
    };
  },
};
```

**How it works:** `createPubkeyBasedAccess()` extracts the first path segment
as the owner pubkey — URIs like `mutable://accounts/{pubkey}/profile` grant
write access only to `{pubkey}`. `authValidation()` verifies that the value
contains a valid Ed25519 signature from an authorized pubkey.

**App usage:**

```typescript
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

const keys = await encrypt.generateSigningKeyPair();
const signed = await encrypt.createAuthenticatedMessageWithHex(
  { name: "Alice" }, keys.publicKeyHex, keys.privateKeyHex,
);
await send({
  inputs: [],
  outputs: [[`mutable://accounts/${keys.publicKeyHex}/profile`, {}, signed]],
}, client);
```

### Content-Addressed Protocol

Immutable content stored by hash, with mutable link pointers. Uses
`hashValidator()` for write-once, hash-verified storage and `link://` for
named references.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

const schema: Schema = {
  // Content-addressed: data must match its hash URI, write-once
  "hash://sha256": hashValidator(),

  // Links: mutable pointers to hash URIs
  "link://open": async ([uri, , data]) => {
    if (typeof data !== "string" || !data.startsWith("hash://")) {
      return { valid: false, error: "Link must point to a hash URI" };
    }
    return { valid: true };
  },

  // Mutable data for non-immutable state
  "mutable://open": async () => ({ valid: true }),
};
```

**App usage — publish content with a named reference:**

```typescript
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";

const article = { title: "B3nd Intro", body: "Content-addressing is..." };
const hash = await computeSha256(article);
const hashUri = generateHashUri(hash);

await send({
  inputs: [],
  outputs: [
    [hashUri, {}, article],                           // immutable content
    ["link://open/articles/latest", {}, hashUri],      // mutable pointer
  ],
}, client);

// Later: update the pointer to new content without losing the old
const updated = { title: "B3nd Intro v2", body: "Updated..." };
const newHash = await computeSha256(updated);
const newHashUri = generateHashUri(newHash);

await send({
  inputs: [],
  outputs: [
    [newHashUri, {}, updated],
    ["link://open/articles/latest", {}, newHashUri],  // pointer now points to v2
  ],
}, client);

// Old version is still readable at its hash URI
```

**Hash chain for audit trails:** Each message can reference the previous hash as
an input, creating a tamper-evident chain:

```typescript
await send({
  inputs: [previousHashUri],  // reference to previous version
  outputs: [
    [newHashUri, {}, newContent],
    ["link://open/chain/head", {}, newHashUri],
  ],
}, client);
```

### Fee Collection Protocol

Cross-output fee validation. Every data write must include a fee output
proportional to data size. Inner validators inspect sibling outputs via
`upstream`.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { isMessageData } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "immutable://open": async ([uri, , data], upstream, read) => {
    if (!data) return { valid: false, error: "Value required" };

    // When inside an envelope, require a fee output
    if (upstream) {
      const [, envelope] = upstream;
      if (isMessageData(envelope)) {
        const feeOutput = envelope.outputs.find(([u]) => u.startsWith("fees://"));
        if (!feeOutput) return { valid: false, error: "Fee required" };

        const dataSize = JSON.stringify(data).length;
        const requiredFee = Math.ceil(dataSize / 100); // 1 per 100 bytes
        if ((feeOutput[1] as number) < requiredFee) {
          return { valid: false, error: `Insufficient fee: need ${requiredFee}` };
        }
      }
    }
    return { valid: true };
  },

  "fees://pool": async () => ({ valid: true }),
  "hash://sha256": hashValidator(),
};
```

**App usage:**

```typescript
await send({
  inputs: [],
  outputs: [
    ["immutable://open/post/123", {}, { title: "Hello", body: "World..." }],
    ["fees://pool", { fire: 1 }, null],  // fee carried as a conserved quantity
  ],
}, client);
```

### UTXO / Conservation Protocol

Inputs must cover outputs. The envelope's program validator enforces
the conservation law. Per-output validators check individual amounts.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { isMessageData } from "@bandeira-tech/b3nd-sdk";

const nonNegative: Validator = async ([, values]) => {
  if ((values.fire ?? 0) < 0) return { valid: false, error: "Negative amount" };
  return { valid: true };
};

const schema: Schema = {
  // Envelope validator: enforce conservation law
  "hash://sha256": async ([, , data], _upstream, read) => {
    if (!isMessageData(data)) return { valid: true }; // plain hash write
    // Sum input fire values (read existing state)
    let inputSum = 0;
    for (const inputUri of data.inputs) {
      const [input] = await read(inputUri);
      if (input.success && input.record) {
        inputSum += input.record.values.fire ?? 0;
      }
    }
    // Sum output fire values — note the slot is position 1 (values), not 2 (data)
    const outputSum = data.outputs.reduce(
      (sum, [, values]) => sum + (values.fire ?? 0),
      0,
    );
    // Conservation: outputs cannot exceed inputs
    if (outputSum > inputSum) {
      return { valid: false, error: "Outputs exceed inputs" };
    }
    return { valid: true };
  },

  // Per-output validators
  "utxo://alice": nonNegative,
  "utxo://bob": nonNegative,
};
```

**App usage — transfer 50 from Alice to Bob:**

```typescript
// Pre-condition: utxo://alice/1 has { amount: 100 }

await send({
  inputs: ["utxo://alice/1"],        // consume Alice's 100
  outputs: [
    ["utxo://bob/1", { fire: 50 }, null],    // Bob gets 50
    ["utxo://alice/2", { fire: 50 }, null],  // Alice gets change
  ],
}, client);

// Invalid: trying to create money (100 > 50 input)
await send({
  inputs: ["utxo://alice/2"],                 // only 50 available
  outputs: [["utxo://bob/2", { fire: 100 }, null]],  // trying to send 100 — rejected
}, client);
// → { accepted: false, error: "Outputs exceed inputs" }
```

### Hash-Chain Retelling

Each message references the hash of the previous message, creating an ordered,
tamper-evident chain. Useful for audit trails, usage history, and provenance
tracking.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

const schema: Schema = {
  "hash://sha256": hashValidator(),

  // Head pointer: must reference a valid hash URI
  "link://open": async ([uri, , data], upstream, read) => {
    if (typeof data !== "string" || !data.startsWith("hash://sha256/")) {
      return { valid: false, error: "Must point to a hash URI" };
    }
    const content = await read(data);
    if (!content.success) {
      return { valid: false, error: "Referenced content not found" };
    }
    return { valid: true };
  },
};
```

**App usage — building a chain:**

```typescript
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";

// First entry (no previous)
const entry1 = { event: "created", timestamp: Date.now(), previous: null };
const hash1 = await computeSha256(entry1);
const uri1 = generateHashUri(hash1);

await send({
  inputs: [],
  outputs: [
    [uri1, {}, entry1],
    ["link://open/chain/head", {}, uri1],
  ],
}, client);

// Second entry references the first
const entry2 = { event: "updated", timestamp: Date.now(), previous: uri1 };
const hash2 = await computeSha256(entry2);
const uri2 = generateHashUri(hash2);

await send({
  inputs: [uri1],  // reference previous entry
  outputs: [
    [uri2, {}, entry2],
    ["link://open/chain/head", {}, uri2],  // advance the head
  ],
}, client);

// Walk the chain backward from the head
let [head] = await client.read<string>("link://open/chain/head");
let current = head.record?.data;
while (current) {
  const [entry] = await client.read(current);
  console.log(entry.record?.data);
  current = entry.record?.data?.previous;
}
```

The chain is tamper-evident because each entry's hash includes the previous
entry's hash URI. Changing any entry would change its hash, breaking all
subsequent references.

### Consensus Chain

Complete user → validator → confirmer flow. Recursive envelopes with auth at
each layer. The validator reads the inner envelope, the confirmer reads the
validation links. Ties together auth, hash, and link programs.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";
import { authValidation, createPubkeyBasedAccess } from "@bandeira-tech/b3nd-sdk/auth";

const TRUSTED_VALIDATORS = ["validator_pubkey_1", "validator_pubkey_2"];
const TRUSTED_CONFIRMERS = ["confirmer_pubkey_1"];

const schema: Schema = {
  "hash://sha256": hashValidator(),

  // User content: auth-verified, stored at hash
  "mutable://accounts": async ([uri, , data]) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value: data });
    return { valid: isValid, error: isValid ? undefined : "Auth failed" };
  },

  // Validation links: only trusted validators can write
  "link://accounts": async ([uri, , data], upstream, read) => {
    // Extract writer pubkey from URI path
    const pubkey = uri.split("/")[3]; // link://accounts/{pubkey}/...
    if (!TRUSTED_VALIDATORS.includes(pubkey) && !TRUSTED_CONFIRMERS.includes(pubkey)) {
      return { valid: false, error: "Not a trusted validator or confirmer" };
    }

    // data should be a hash URI referencing the envelope being validated
    if (typeof data !== "string" || !data.startsWith("hash://sha256/")) {
      return { valid: false, error: "Must reference a hash URI" };
    }

    // Verify the referenced envelope exists
    const envelope = await read(data);
    if (!envelope.success) {
      return { valid: false, error: "Referenced envelope not found" };
    }
    return { valid: true };
  },
};
```

**Three-layer flow:**

```typescript
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";

// 1. User submits content
const userKeys = await encrypt.generateSigningKeyPair();
const userContent = { title: "My Post", body: "Content here" };
const signed = await encrypt.createAuthenticatedMessageWithHex(
  userContent, userKeys.publicKeyHex, userKeys.privateKeyHex,
);

const userResult = await send({
  auth: [{ pubkey: userKeys.publicKeyHex, signature: "..." }],
  inputs: [],
  outputs: [[`mutable://accounts/${userKeys.publicKeyHex}/posts/1`, {}, signed]],
}, client);
// userResult.uri = "hash://sha256/{content_hash}"

// 2. Validator endorses the user's envelope
const validatorResult = await send({
  auth: [{ pubkey: "validator_pubkey_1", signature: "..." }],
  inputs: [userResult.uri],  // reference the user's envelope
  outputs: [
    [`link://accounts/validator_pubkey_1/validations/${userResult.uri}`, {}, userResult.uri],
  ],
}, client);

// 3. Confirmer finalizes
await send({
  auth: [{ pubkey: "confirmer_pubkey_1", signature: "..." }],
  inputs: [validatorResult.uri],  // reference the validation envelope
  outputs: [
    [`link://accounts/confirmer_pubkey_1/confirmed/${userResult.uri}`, {}, validatorResult.uri],
  ],
}, client);

// Verify: is the user's post confirmed?
const [confirmation] = await client.read(
  `link://accounts/confirmer_pubkey_1/confirmed/${userResult.uri}`,
);
console.log(confirmation.success); // true — post is confirmed
```

Each layer uses the same envelope shape. The protocol defines which pubkeys are
trusted at each layer, and the schema enforces it.

---

## Running Your Protocol's Node

> For operational details (backends, managed mode, monitoring, replication),
> see [OPERATORS.md](./OPERATORS.md). This section covers protocol-specific setup.

After defining your protocol's schema, you need to run a node that validates
messages against it. This section covers generic node setup — for
protocol-specific node setup, see the protocol's docs.

### Schema Module Pattern

Export your schema as a module so it can be imported by the node and by tests:

```typescript
// schema.ts
import type { Schema } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "mutable://open": async ([uri, , data]) => {
    if (!data) return { valid: false, error: "Value required" };
    return { valid: true };
  },
};
export default schema;
```

### createServerNode

```typescript
import { createServerNode, MessageDataClient, MemoryStore, servers } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";
import schema from "./schema.ts";

const client = new MessageDataClient(new MemoryStore());
const app = new Hono();
const frontend = servers.httpServer(app);
const node = createServerNode({ frontend, client });
node.listen(43100);
```

### Multi-Backend Composition

```typescript
import { flood, peer } from "@bandeira-tech/b3nd-sdk/network";

const programs = Object.keys(schema);
const backends = [
  new MessageDataClient(new MemoryStore()),
  new MessageDataClient(new PostgresStore("b3nd", executor)),
];
const composed = flood(backends.map((c, i) => peer(c, { id: `local-${i}` })));

const client = createValidatedClient({
  write: composed,
  read: composed,
  validate: msgSchema(schema),
});

const frontend = servers.httpServer(app);
createServerNode({ frontend, client });
```

### PostgreSQL / MongoDB Setup

```typescript
// Postgres
const pgStore = new PostgresStore("b3nd", executor);
await pgStore.initializeSchema();
const pg = new MessageDataClient(pgStore);

// MongoDB
const mongoStore = new MongoStore("b3nd", executor);
const mongo = new MessageDataClient(mongoStore);
```

---

## Packaging a Protocol SDK

Once your protocol's schema is stable, wrap it into a protocol-specific package
so app developers don't need to understand B3nd internals. This is how a
protocol becomes usable.

**What to export:**

1. **Schema** — the schema table, so node operators can run your protocol
2. **Pre-configured client factory** — a function that returns an `HttpClient`
   pointed at your network
3. **Typed helpers** — functions that build valid messages for your programs
4. **URI builders** — functions that construct URIs following your conventions

**Example: packaging a minimal protocol SDK:**

```typescript
// my-protocol-sdk/mod.ts
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { HttpClient, send } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

// 1. Schema export (for node operators)
export const schema: Schema = {
  "mutable://open": async () => ({ valid: true }),
  "hash://sha256": hashValidator(),
  "link://open": async ([uri, , data]) => {
    if (typeof data !== "string") return { valid: false, error: "Must be string" };
    return { valid: true };
  },
};

// 2. Pre-configured client
export function createClient(url = "https://my-protocol-node.example.com") {
  return new HttpClient({ url });
}

// 3. Typed helpers
export async function writeNote(client: HttpClient, path: string, content: object) {
  return send({
    inputs: [],
    outputs: [[`mutable://open/${path}`, {}, content]],
  }, client);
}

// 4. URI builders
export function noteUri(path: string) {
  return `mutable://open/${path}`;
}
```

**Example:** A protocol's schema module (`apps/b3nd-node/example-schema.ts`)
exports a canonical program schema. The `@bandeira-tech/b3nd-web` and
`@bandeira-tech/b3nd-sdk` packages provide the transport layer. Together they
form the protocol SDK that app developers consume — without knowing they're
using B3nd underneath.

---

## What Apps Look Like

From the protocol developer's perspective, here's what apps do with your SDK.
Understanding this helps you design protocols that are easy to consume.

**Apps call `receive()`, `read()`, and `send()` via `HttpClient`.** That's the
entire surface area. An app developer imports your client factory, connects to a
node, and uses the standard B3nd operations. They never define validators,
inspect schemas, or think about dispatch.

**Apps compose with `LocalStorageStore` for offline.** Browser apps often layer
a local cache (via a protocol client wrapping `LocalStorageStore`) in front of
the remote node. They `receive()` to both local and remote, and `read()` from
local first. This is transparent to the protocol.

**Apps never see the schema.** They trust the node to validate. If an app sends
an invalid message, the node rejects it. The app handles the rejection. The app
never imports your schema — that's the node's responsibility.

**What this means for your protocol design:**

- Make URIs predictable so apps can construct them without consulting docs
- Make error messages clear so apps can show useful feedback
- Keep the number of programs small — each program is a concept app developers
  must learn
- Provide typed helpers in your SDK so apps get autocomplete and compile-time
  checks

For concrete worked examples of apps built on a protocol, see the protocol
SDK documentation — covering Quick Start, React patterns, state management,
and testing for app developers.

---

## Terminology

| Term                     | Meaning                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| **Scheme**               | URI scheme component (e.g., `mutable`, `hash`, `link`)             |
| **Program**              | `scheme://hostname` pair — the unit of validation dispatch         |
| **Resource**             | Data addressed by a URI path within a program                         |
| **Envelope**             | Message with `{ auth?, inputs, outputs }` structure   |
| **Protocol**             | System built on B3nd — defines programs and rules                  |
| **DePIN**                | Decentralized Physical Infrastructure Network                      |

Usage: "program" for `scheme://hostname`. "Protocol" for systems built on B3nd
"Envelope" for `{ auth?, inputs, outputs }` messages.

---

## Tools & Infrastructure

### MCP Tools (Claude Plugin)

| Tool                       | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `b3nd_receive`             | Submit message `[uri, values, data]` (batch)              |
| `b3nd_read`                | Read data from URI (trailing slash = list)        |
| `b3nd_status`              | Backend status + available programs               |
| `b3nd_backends_list`       | List configured backends                          |
| `b3nd_backends_switch`     | Switch active backend                             |
| `b3nd_backends_add`        | Add new backend                                   |
| `b3nd_keygen`              | Generate Ed25519 + X25519 keypair                 |
| `b3nd_sign`                | Sign payload, returns AuthenticatedMessage        |
| `b3nd_node_config_push`    | Sign + write node config to correct URI           |
| `b3nd_node_config_get`     | Read node config from operator/node URI           |
| `b3nd_node_status`         | Read node status from accounts/{nodeKey}/status   |

Configure: `export B3ND_BACKENDS="local=http://localhost:9942"`

### bnd CLI Tool

```bash
./apps/b3nd-cli/bnd read mutable://accounts/{pubkey}/profile
./apps/b3nd-cli/bnd read mutable://accounts/{pubkey}/   # trailing slash = list
./apps/b3nd-cli/bnd config
./apps/b3nd-cli/bnd conf node http://localhost:9942
```

### Developer Dashboard

```bash
cd apps/sdk-inspector && deno task dashboard:build  # Build test artifacts
cd apps/b3nd-web-rig && npm run dev                 # http://localhost:5555/dashboard
```

Browse 125 tests by theme (SDK Core, Network, Database, Auth, Binary, E2E), view
source code with line numbers.

---

## Source Files Reference

### SDK Core
- `src/mod.ts` — Main Deno exports (facade, re-exports from libs/)
- `src/mod.web.ts` — Browser exports (NPM build entry)
- `libs/b3nd-core/types.ts` — Type definitions
- `libs/b3nd-compose/` — Node composition, validators, processors
- `libs/b3nd-hash/` — Content-addressed hashing utilities
- `libs/b3nd-msg/` — Message system, send(), message()

### Stores
- `libs/b3nd-client-memory/` — MemoryStore (in-memory storage)
- `libs/b3nd-client-postgres/` — PostgresStore (PostgreSQL storage)
- `libs/b3nd-client-mongo/` — MongoStore (MongoDB storage)
- `libs/b3nd-client-localstorage/` — LocalStorageStore (browser offline cache)
- `libs/b3nd-client-indexeddb/` — IndexedDBStore (browser IndexedDB storage)

### Protocol Clients
- `libs/b3nd-core/` — MessageDataClient, SimpleClient (wrap Store → NodeProtocolInterface)

### Transport Clients
- `libs/b3nd-client-http/` — HttpClient (HTTP transport)
- `libs/b3nd-client-ws/` — WebSocketClient (WebSocket transport)
- `libs/b3nd-network/` — `network()` verb, `flood(peers)`, `pathVector(peers)`, `tellAndRead(...)`, `bestEffort` decorator

### Auth & Encryption
- `libs/b3nd-auth/` — Pubkey-based access control
- `libs/b3nd-encrypt/` — X25519/Ed25519/AES-GCM encryption

### Servers & Apps
- `libs/b3nd-servers/` — HTTP + WebSocket server primitives
- `apps/b3nd-node/` — Multi-backend HTTP node
- `apps/b3nd-web-rig/` — React/Vite data explorer + dashboard
- `apps/sdk-inspector/` — Test runner backend
- `apps/b3nd-cli/` — bnd CLI tool

### Testing
- `libs/b3nd-testing/shared-suite.ts` — Client conformance suite
- `libs/b3nd-testing/node-suite.ts` — Node interface suite

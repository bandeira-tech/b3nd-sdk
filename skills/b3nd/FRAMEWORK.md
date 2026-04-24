# B3nd — DePIN Framework & SDK

You are here to create a DePIN network. B3nd provides URI-addressed resource
design, program-driven classification, and cryptographic primitives.
Protocols are built on top of B3nd. Apps are built on top of protocols.

This document covers B3nd itself — what the framework provides and how protocols
use it.

---

## Three Layers of Abstraction

| Layer | What | Who | Relies on |
|-------|------|-----|-----------|
| **1. Framework** | B3nd — addressed data, program dispatch, auth primitives, SDK | B3nd developers | Nothing — this is the foundation |
| **2. Protocol** | Programs, handlers, consensus, fees, URI conventions | Protocol developers | B3nd SDK |
| **3. App** | e.g., social network — UX, auth flows, data display | App developers | B3nd SDK + protocol SDK/endpoints |

The SDK is Layer 1's product. It provides tools to everyone above. Protocol
developers reach into it for primitives. App developers reach into it for
clients and helpers.

---

## Layer 1: B3nd Framework

### The Problem

Machines and people need to exchange and verify data across untrusted networks.
B3nd provides the minimal infrastructure: URI-addressed resources,
program-driven classification, cryptographic integrity, and unidirectional
message flow.

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
conserved quantities looks like `["mutable://open/x", {}, data]`. The middle
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

B3nd is small. The entire framework is a classification dispatch loop.
Here's what happens when a message arrives via `rig.receive()`:

```
message arrives: [uri, values, data]
        │
        ▼
  find program in table
  (longest-prefix match)
        │
    ┌───┴───┐
    │       │
 no match  match
    │       │
    ▼       ▼
 dispatch  run program(output, upstream, read)
 direct to      │
 connections    ▼
           returns { code, error? }
                │
           ┌────┴────┐
           │         │
        error      no error
           │         │
           ▼         ▼
        reject    look up handler by code
                       │
                       ▼
                  handler(message, broadcast, read)
```

That's it. There is no queue, no consensus engine, no message manager
inside the framework. A Rig receives a message, classifies it via a
program, and the returned code selects a handler (or rejects if
`error` is set). Everything else — consensus, fees, multi-step
workflows — is built by protocols on top of this loop using the same
message primitive.

**What a Program sees:**

```typescript
import type { Program } from "@bandeira-tech/b3nd-sdk";

const myProgram: Program = async (
  output,   // [uri, values, data]
  upstream, // parent envelope Output, or undefined for plain writes
  read,     // read existing state at any URI
) => {
  const [uri, values, data] = output;
  // Your logic here. Read other URIs, check signatures,
  // enforce business rules — whatever the program needs.
  return { code: "ok" };
  // or: return { code: "rejected", error: "reason" };
};
```

Programs can read any URI available on the node — not just URIs in their own
prefix. A program for `mutable://accounts` can read from `hash://sha256` to
verify content integrity, or from `link://accounts` to check authorization
chains. Cross-program reads are how protocols compose behavior without
coupling programs together.

**What this means for protocol developers:**

The entire protocol is a `programs` table (a
`Record<string, Program>`) plus a `handlers` table (a
`Record<string, CodeHandler>`). There is no other extension point. You
don't register middleware, subscribe to events, or override framework
methods. You write programs and handlers, and the Rig calls them.

This constraint is deliberate. Every protocol can be fully understood
by reading its two tables. Every program's behavior is defined in one
place. There are no hidden interactions between programs — only explicit
reads during classification.

**What happens with envelopes (MessageData):**

When a `MessageDataClient.receive()` call contains a `MessageData`
envelope, the client decomposes it into its own underlying `Store` —
inputs get deleted, each output in `outputs` gets written to that
Store. These writes do **not** re-enter the Rig for cross-connection
routing. The envelope itself is stored at its content-addressed hash
URI as an audit trail. See
[DESIGN_PRIMITIVE.md](./DESIGN_PRIMITIVE.md#envelopes-and-the-rig) —
and call `rig.receive([msg, msg, msg])` directly when you need the
Rig to fan out each output across connections.

### Programs and Dispatch

A **program** is identified by `scheme://hostname` in a URI. Programs
classify messages — they decide what data is acceptable, who can write,
what constraints apply, and which handler should run next.

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

### Closed-by-default dispatch

Unmatched URIs dispatch straight to connections without classification.
To close a prefix, install an explicit rejecter program at it:

```typescript
const rejectUnknown: Program = (msg) => Promise.resolve({
  code: "rejected",
  error: `rejected by program: ${msg[0]}`,
});

const rig = new Rig({
  connections: [...],
  programs: {
    "mutable://accounts": accountsProgram,
    // Programs match by longest prefix, so this only catches URIs that
    // don't match a more specific program above.
    "mutable://": rejectUnknown,
  },
});
```

This is the pattern used in the rig test suite (`libs/b3nd-rig/rig.test.ts`,
look for the `rejectUnknown` fixture) and in `libs/b3nd-client-memory/mod.ts`
(`createTestPrograms`).

### Programs validate receives, not sends

The program pipeline (`_runProgram` in `libs/b3nd-rig/rig.ts`) is invoked
only from `rig.receive()`. `rig.send()` takes a pre-built `MessageData`
envelope, runs the `beforeSend` hook, and dispatches **directly to
connections** — it never classifies the envelope or its outputs.

Use `rig.receive(msgs)` when you ingest external input and want the
programs table to classify it. Use `rig.send(envelope)` (typically via
`Identity.rig(rig).send(...)`) when the envelope is already signed and
the signature — not classification — is the authority that matters.

If you need program-level enforcement on authenticated writes, choose
one of:

- **Route writes through `receive()` with a signed payload in `data`.** The
  identity signs a nested payload, the top-level URI's program verifies the
  signature and the outputs before any storage happens. This is the idiom
  the rig tests use for signed-write enforcement.
- **Use a `beforeSend` hook** to throw on unauthorized envelopes. Hooks
  run on `rig.send()` as well as on `session.send()`.
- **Accept that trust is established transport-side** — e.g. by requiring
  HTTPS + authenticated transport before the envelope ever reaches the rig.

When a message arrives via `receive()`, the framework extracts
`scheme://hostname` from the URI, looks up the program, and calls it. If no
program matches, the message is dispatched to connections without
classification. Programs decide everything: mutability, authentication,
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

`status()` returns node health information and the available program
prefixes.

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

Multiple backends compose by wiring each client as its own connection on
the Rig. The Rig's `connections` array is the single composition point —
writes broadcast to every connection whose `receive` patterns match, reads
try connections in declaration order.

```typescript
import {
  connection,
  MemoryStore,
  MessageDataClient,
  Rig,
} from "@bandeira-tech/b3nd-sdk";
import { PostgresStore } from "@bandeira-tech/b3nd-client-postgres";

const memory = new MessageDataClient(new MemoryStore());
const postgres = new MessageDataClient(
  new PostgresStore({
    connection: "postgresql://…",
    tablePrefix: "b3nd",
    poolSize: 5,
    connectionTimeout: 10000,
  }),
);

const rig = new Rig({
  connections: [
    connection(memory,   { receive: ["*"], read: ["*"] }),
    connection(postgres, { receive: ["*"], read: ["*"] }),
  ],
  programs,
});
```

For a peer mesh that fans reads and writes across remote nodes, see
`@bandeira-tech/b3nd-sdk/network` — `network(rig, peers, policies?)`
subscribes peer observe streams into the Rig's receive pipeline.

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
   subscriptions at the protocol level. Nodes receive, classify, accept or reject.

2. **No liveness guarantees.** B3nd is fire-and-forget. The framework makes no
   promises about delivery, timing, or retry. If you mail a letter, the postal
   system doesn't guarantee arrival. Protocols that need delivery guarantees
   build them on top (receipt messages, acknowledgment patterns).

3. **Programs are law.** If a program returns a code without `error`, the
   message is accepted and its handler runs. If the program sets `error`,
   the message never happened — no partial acceptance, no pending state
   at the framework level.

4. **Programs are protocol-defined.** The framework dispatches to programs
   but makes no rules about what programs should represent. Programs can
   be broad behavioral layers or narrow domain-specific classifiers —
   that's a protocol design choice.

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

Protocol developers define the classification rules that sit between them —
the programs and handlers. They don't couple to either side.

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

1. **Which programs exist** — the `programs` table (what schemes and hostnames)
2. **What each program classifies** — the `Program` functions and the `handlers` they dispatch to
3. **URI conventions** — how paths organize resources
4. **Message exchange patterns** — workflows for multi-step operations
5. **Consensus model** — how messages become confirmed state
6. **Fee model** — how participants are compensated

### Envelope Dispatch

`rig.receive(msgs)` treats each message the same way:

- Extract `scheme://hostname` from the URI.
- Find the longest-prefix-matching program in the `programs` table.
- Call `program(output, upstream, read)`.
- If the result has `error`, reject the message.
- Otherwise, dispatch to the handler registered for `code` (or fall
  through to a default handler that broadcasts `msg` to the matching
  connections).

Envelopes are just messages whose `data` happens to be a
`{ auth?, inputs, outputs }` record. Their top-level URI (a
`hash://sha256/…` derived from the envelope's canonical JSON) routes to
an envelope-level program. If a protocol wants the Rig to also classify
each inner output, the envelope's program can explicitly re-feed the
outputs by calling `rig.receive(data.outputs)` — otherwise, when the
envelope lands on a `MessageDataClient`, the client decomposes it into
its own `Store` without re-running the `programs` table.

This split keeps two concerns separate:

- **Envelope-level concerns** — signature verification, input
  existence, conservation laws — go in the envelope's program (keyed on
  `hash://sha256`).
- **Per-output concerns** — data format, per-URI ownership — go in each
  output's program and get invoked when the Rig (or an explicit
  `rig.receive(data.outputs)`) classifies those outputs.

### Input Semantics

The `inputs` array in an envelope lists URIs that the message
references or depends on. **The framework does not enforce any
semantics on inputs.** It does not check that they exist, consume them,
or lock them.

Whether inputs are "consumed" (UTXO-style spending), "referenced" (proof
that something exists), or purely informational is entirely
protocol-defined. The framework just passes them through. A program
that needs input semantics implements them via `read()`:

```typescript
import type { Program } from "@bandeira-tech/b3nd-sdk";

// Protocol-defined: check that all inputs exist
const envelopeProgram: Program = async ([, , data], _upstream, read) => {
  const envelope = data as { inputs: string[] };
  for (const inputUri of envelope.inputs) {
    const [existing] = await read(inputUri);
    if (!existing?.success) {
      return { code: "envelope:rejected", error: `Input not found: ${inputUri}` };
    }
  }
  return { code: "envelope:accepted" };
};
```

### Cross-Program Reads

Programs can read any URI available on the node, not just URIs in their
own prefix. This is how protocols compose behavior without coupling
programs together.

```typescript
import type { Program } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

// A link:// program that verifies the referenced hash:// content exists
const programs: Record<string, Program> = {
  "link://accounts": async ([_uri, , data], _upstream, read) => {
    // data is a hash URI string — verify the content it points to exists
    const [content] = await read(data as string);
    if (!content?.success) {
      return {
        code: "link:rejected",
        error: `Referenced content not found: ${data}`,
      };
    }
    return { code: "link:accepted" };
  },

  "hash://sha256": hashValidator(),  // built-in: verifies data matches hash

  "mutable://accounts": async ([uri], _upstream, read) => {
    // Check that the writer owns this account by reading their auth link
    const pubkey = uri.split("/")[3]; // mutable://accounts/{pubkey}/...
    const [authLink] = await read(`link://accounts/${pubkey}/auth`);
    if (!authLink?.success) {
      return { code: "account:rejected", error: "Account not registered" };
    }
    return { code: "account:accepted" };
  },
};
```

Cross-program reads are the *only* composition mechanism. Programs
don't import each other, subscribe to events, or share state directly.
A program in prefix A reads from prefix B's URI space during
classification. This keeps programs independent — you can understand
each program by reading its source, and you can see its dependencies by
looking at which URIs it reads.

### Accessing Envelope Context via `upstream`

When an envelope's program explicitly re-dispatches its outputs (via
`rig.receive(data.outputs)` or the equivalent) with the envelope as
`upstream`, each inner output's program gets access to the envelope's
auth, inputs, and sibling outputs.

```typescript
import type { Program } from "@bandeira-tech/b3nd-sdk";

// Fee program: requires a fee output in its sibling outputs
const feeProgram: Program = async ([, , data], upstream) => {
  if (!upstream) {
    return { code: "fee:rejected", error: "Fee check requires envelope context" };
  }
  const envelope = upstream[2] as {
    outputs: Array<[string, Record<string, number>, unknown]>;
  };

  // Require a fee output proportional to data size.
  // The fee is a conserved quantity in the Output's `values` slot (position 1).
  const feeOutput = envelope.outputs.find(([u]) => u.startsWith("fees://"));
  if (!feeOutput) return { code: "fee:rejected", error: "Fee required" };

  const dataSize = JSON.stringify(data).length;
  const requiredFee = Math.ceil(dataSize / 100);
  const fee = feeOutput[1].fire ?? 0; // values: { fire: N }
  if (fee < requiredFee) {
    return { code: "fee:rejected", error: `Insufficient fee: need ${requiredFee}` };
  }
  return { code: "fee:accepted" };
};
```

Envelope-level concerns (signature verification, input existence,
conservation laws) belong in the envelope's own program. Per-output
concerns (data format, fee checks, ownership) belong in the output's
program and can inspect `upstream` when needed:

```typescript
import type { Program } from "@bandeira-tech/b3nd-sdk";

type Envelope = {
  inputs: string[];
  outputs: Array<[string, Record<string, number>, unknown]>;
};

const programs: Record<string, Program> = {
  // Envelope program: enforces conservation on the `fire` quantity
  "hash://sha256": async ([, , data], _upstream, read) => {
    const envelope = data as Envelope | unknown;
    if (!envelope || typeof envelope !== "object" || !("outputs" in envelope)) {
      return { code: "hash:accepted" }; // plain hash write, not an envelope
    }
    const env = envelope as Envelope;

    let inputSum = 0;
    for (const inputUri of env.inputs) {
      const [input] = await read(inputUri);
      if (input?.success && input.record) {
        inputSum += (input.record.values as Record<string, number>).fire ?? 0;
      }
    }
    const outputSum = env.outputs.reduce(
      (sum, [, values]) => sum + (values.fire ?? 0),
      0,
    );
    if (outputSum > inputSum) {
      return { code: "envelope:rejected", error: "Outputs exceed inputs" };
    }
    return { code: "envelope:accepted" };
  },

  // Per-output programs
  "mutable://accounts": accountProgram,
  "link://accounts": linkProgram,
  "fees://pool": async () => ({ code: "fee:accepted" }),
};
```

### Testing Programs

Test programs by running them through a Rig whose connections point at a
`MessageDataClient` backed by `MemoryStore`. Exercise both the happy path
(accepted messages land in storage) and the rejection path (programs
return a code with `error` set):

```typescript
import { assertEquals } from "@std/assert";
import {
  connection,
  MemoryStore,
  MessageDataClient,
  Rig,
} from "@bandeira-tech/b3nd-sdk";
import type { Program } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

const programs: Record<string, Program> = {
  "mutable://accounts": async ([_uri, , data]) => {
    if (!data || typeof data !== "object") {
      return { code: "account:rejected", error: "Value must be an object" };
    }
    return { code: "account:accepted" };
  },
  "hash://sha256": hashValidator(),
};

function makeRig() {
  const client = new MessageDataClient(new MemoryStore());
  return new Rig({
    connections: [connection(client, { receive: ["*"], read: ["*"] })],
    programs,
    handlers: {
      "account:accepted": async (msg, broadcast) => { await broadcast([msg]); },
    },
  });
}

Deno.test("accepts valid account write", async () => {
  const rig = makeRig();
  const [result] = await rig.receive([
    ["mutable://accounts/alice/profile", {}, { name: "Alice" }],
  ]);
  assertEquals(result.accepted, true);
});

Deno.test("rejects invalid account write", async () => {
  const rig = makeRig();
  const [result] = await rig.receive([
    ["mutable://accounts/alice/profile", {}, null],
  ]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "Value must be an object");
});

// Test cross-program reads: pre-populate state, then classify against it
Deno.test("program reads cross-program state", async () => {
  const crossPrograms: Record<string, Program> = {
    "mutable://balances": async ([uri], _upstream, read) => {
      const pubkey = uri.split("/")[3];
      const [auth] = await read(`link://accounts/${pubkey}/auth`);
      if (!auth?.success) {
        return { code: "balance:rejected", error: "Not registered" };
      }
      return { code: "balance:accepted" };
    },
    "link://accounts": async () => ({ code: "link:accepted" }),
  };
  const client = new MessageDataClient(new MemoryStore());
  const rig = new Rig({
    connections: [connection(client, { receive: ["*"], read: ["*"] })],
    programs: crossPrograms,
    handlers: {
      "balance:accepted": async (msg, broadcast) => { await broadcast([msg]); },
      "link:accepted":    async (msg, broadcast) => { await broadcast([msg]); },
    },
  });

  // Pre-populate: register the account
  await rig.receive([["link://accounts/alice/auth", {}, { active: true }]]);

  // Now the balance write should succeed (cross-program read finds the auth)
  await rig.receive([
    ["mutable://balances/alice/balance", {}, { amount: 100 }],
  ]);
  assertEquals(
    await rig.readData("mutable://balances/alice/balance"),
    { amount: 100 },
  );
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
processes `[uri, values, data]` messages. Consensus emerges from the programs
that control who can write validation and confirmation links.

To verify a message was confirmed, a program reads the inner envelope by its
hash URI. Since the envelope was content-addressed, `read("hash://sha256/{content}")`
returns the original user request. The program can then inspect its auth,
inputs, and outputs to decide whether to endorse it:

```typescript
// Link program: read the user's envelope, verify, emit an accept code
"link://accounts": async ([_uri, , data], _upstream, read) => {
  // data = "hash://sha256/{content}" — reference to the user's envelope
  const [envelope] = await read(data as string);
  if (!envelope?.success) {
    return { code: "link:rejected", error: "Envelope not found" };
  }

  // Inspect the original envelope's auth, outputs, etc.
  const envelopeData = envelope.record?.data as { auth?: unknown[] } | undefined;
  if (!envelopeData?.auth?.length) {
    return { code: "link:rejected", error: "Unsigned envelope" };
  }

  // Verify signature, check business rules, etc.
  return { code: "link:accepted" };
},
```

**B3nd makes consensus a first-class programmable concern.** Protocol developers
writing programs ARE writing consensus protocols. The complexity
doesn't disappear — it moves into explicit, inspectable program schemas.

### Signing and Intent

Every message at every depth is the same gesture: **signing intent to place
outputs at addresses.** A user signs intent to place their profile. A validator
signs intent to place a validity link. A confirmer signs intent to place a
confirmation link. There is no structural difference.

Per-output signing (signing each output individually) is a protocol
design choice, not a framework requirement. Programs that need
per-output intent verification (e.g., financial transfers) can require
it in their classification logic. Programs that don't (e.g., public
announcements) skip it.

### Worked Example: A Minimal Protocol

Here is a complete protocol with three programs that compose via
cross-program reads. It implements a simple content-publishing workflow:
users publish content, a validator endorses it, and a mutable "latest"
pointer tracks the most recent endorsed post.

```typescript
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";
import type { Program } from "@bandeira-tech/b3nd-sdk";

const publishingProgram: Record<string, Program> = {
  // Immutable content storage — data must match its hash
  "hash://sha256": hashValidator(),

  // Mutable pointers — reject if the linked content doesn't exist
  "link://posts": async ([_uri, , data], _upstream, read) => {
    if (typeof data !== "string" || !data.startsWith("hash://sha256/")) {
      return { code: "link:rejected", error: "Link value must be a hash URI" };
    }
    const [content] = await read(data);
    if (!content?.success) {
      return { code: "link:rejected", error: "Linked content not found" };
    }
    return { code: "link:accepted" };
  },

  // User profiles — anyone can write to their own path
  "mutable://profiles": async ([_uri, , data]) => {
    if (!data || typeof data !== "object") {
      return { code: "profile:rejected", error: "Profile must be an object" };
    }
    return { code: "profile:accepted" };
  },
};
```

**How it's used:**

```typescript
import {
  connection,
  Identity,
  MemoryStore,
  MessageDataClient,
  Rig,
} from "@bandeira-tech/b3nd-sdk";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";

const client = new MessageDataClient(new MemoryStore());
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  programs: publishingProgram,
  handlers: {
    "link:accepted":    async (msg, broadcast) => { await broadcast([msg]); },
    "profile:accepted": async (msg, broadcast) => { await broadcast([msg]); },
    "hash:accepted":    async (msg, broadcast) => { await broadcast([msg]); },
  },
});

// 1. User publishes content
const post = { title: "Hello World", body: "First post on B3nd" };
const hashUri = generateHashUri(await computeSha256(post));

const id = await Identity.fromSeed("alice-seed");
await id.rig(rig).send({
  inputs: [],
  outputs: [
    [hashUri, {}, post],                                   // immutable content
    ["link://posts/latest", {}, hashUri],                  // mutable pointer
    ["mutable://profiles/alice", {}, { name: "Alice" }],   // profile update
  ],
});

// 2. Read the latest post via the link
const latest = await rig.readData<string>("link://posts/latest");
const content = await rig.readData(latest!);
// content = { title: "Hello World", body: "First post on B3nd" }
```

### Protocol Design Patterns

#### Content-Addressing + Links

Send immutable content to its hash, reference it via mutable links. The
identity wraps the rig and signs a single envelope containing both
outputs:

```typescript
const hashUri = `hash://sha256/${await computeSha256(content)}`;

await id.rig(rig).send({
  inputs: [],
  outputs: [
    [hashUri, {}, content],                         // immutable content
    ["link://open/posts/latest", {}, hashUri],       // mutable pointer
  ],
});
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
mutable state write (fast path). The programs enforce both:

```typescript
// Validator writes to both paths in one envelope
await validatorId.rig(rig).send({
  inputs: ["hash://sha256/{user_request}"],
  outputs: [
    // Proof path: immutable validation record
    ["link://accounts/{validator}/validations/{hash}", {}, validationAttestation],
    // Fast path: update the user's mutable balance
    ["mutable://accounts/{pubkey}/balance", {}, { amount: newBalance }],
  ],
});
```

#### Validator Namespace Design

Open namespaces (`link://valid/{hash}`) are spam surfaces. Prefer
validator-scoped namespaces:

```
link://accounts/{validator_pubkey}/validations/{content_hash}
```

Confirmers check specific known validators, not an open namespace. The
confirmation program defines which validator pubkeys are trusted.

### Protocol Versioning

The framework keys programs by `scheme://hostname`. Changing either
component creates a new program with independent classification.
Protocols have several versioning strategies:

- **Path-based versioning:** Keep the same program, version in the path:
  `mutable://accounts/v2/{pubkey}/profile`. The program inspects the path
  to apply version-specific rules. This lets a single program handle
  migration logic.

- **Hostname-based versioning:** New program per version:
  `mutable://accounts-v2/{pubkey}/profile`. Clean separation but requires
  cross-program reads to access old data.

- **Backward-compatible evolution:** Add optional fields, never remove or
  change the meaning of existing fields. Programs accept both old and new
  formats. This is the simplest strategy when possible.

Whichever strategy you choose, the programs table makes it explicit —
you can see every program version in the table and understand exactly
what each accepts.

### Open Problems in Protocol Design

These are active design questions. Protocol developers should be aware of them:

**Fee timing.** When does the user pay? If fees are outputs in the message, they
only get accepted if classification succeeds — meaning rejected messages are
free to submit. Options: fee escrow (pre-committed), transport-layer fees
(HTTP request cost), or accept-and-rate-limit. For a concrete example of fee
checks using cross-output access via `upstream`, see the fee program example
above.

**Circular references.** Two programs can cross-classify each other through
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
different B3nd design pattern. Each includes the programs table, a node setup
snippet, and a usage example showing what an app consuming the protocol does.

### Simple Open Protocol

The simplest possible DePIN network: a single program that accepts anything.
No authentication, no constraints.

```typescript
import type { Program } from "@bandeira-tech/b3nd-sdk";

const programs: Record<string, Program> = {
  "mutable://open": async () => ({ code: "open:accepted" }),
};
```

**Node setup:**

```typescript
import {
  connection,
  httpApi,
  MemoryStore,
  MessageDataClient,
  Rig,
} from "@bandeira-tech/b3nd-sdk";

const client = new MessageDataClient(new MemoryStore());
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  programs,
  handlers: {
    "open:accepted": async (msg, broadcast) => { await broadcast([msg]); },
  },
});
Deno.serve({ port: 9942 }, httpApi(rig));
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
import type { Program } from "@bandeira-tech/b3nd-sdk";
import {
  authValidation,
  createPubkeyBasedAccess,
} from "@bandeira-tech/b3nd-sdk/auth";

const programs: Record<string, Program> = {
  "mutable://open": async () => ({ code: "open:accepted" }),

  "mutable://accounts": async ([uri, , data]) => {
    const validator = authValidation(createPubkeyBasedAccess());
    const isValid = await validator({ uri, value: data as never });
    return isValid
      ? { code: "account:accepted" }
      : { code: "account:rejected", error: "Signature verification failed" };
  },

  "immutable://accounts": async ([uri, , data], _upstream, read) => {
    const validator = authValidation(createPubkeyBasedAccess());
    const isValid = await validator({ uri, value: data as never });
    if (!isValid) {
      return { code: "account:rejected", error: "Signature verification failed" };
    }
    const [existing] = await read(uri);
    if (existing?.success) {
      return { code: "account:rejected", error: "Immutable object exists" };
    }
    return { code: "account:accepted" };
  },
};
```

**How it works:** `createPubkeyBasedAccess()` extracts the first path segment
as the owner pubkey — URIs like `mutable://accounts/{pubkey}/profile` grant
write access only to `{pubkey}`. `authValidation()` verifies that the value
contains a valid Ed25519 signature from an authorized pubkey.

**App usage:**

```typescript
import { Identity } from "@bandeira-tech/b3nd-sdk";

const id = await Identity.fromSeed("alice-seed");
await id.rig(rig).send({
  inputs: [],
  outputs: [
    [`mutable://accounts/${id.publicKeyHex}/profile`, {}, { name: "Alice" }],
  ],
});
```

### Content-Addressed Protocol

Immutable content stored by hash, with mutable link pointers. Uses
`hashValidator()` for write-once, hash-verified storage and `link://` for
named references.

```typescript
import type { Program } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

const programs: Record<string, Program> = {
  // Content-addressed: data must match its hash URI, write-once
  "hash://sha256": hashValidator(),

  // Links: mutable pointers to hash URIs
  "link://open": async ([_uri, , data]) => {
    if (typeof data !== "string" || !data.startsWith("hash://")) {
      return { code: "link:rejected", error: "Link must point to a hash URI" };
    }
    return { code: "link:accepted" };
  },

  // Mutable data for non-immutable state
  "mutable://open": async () => ({ code: "open:accepted" }),
};
```

**App usage — publish content with a named reference:**

```typescript
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";

const article = { title: "B3nd Intro", body: "Content-addressing is..." };
const hashUri = generateHashUri(await computeSha256(article));

await id.rig(rig).send({
  inputs: [],
  outputs: [
    [hashUri, {}, article],                           // immutable content
    ["link://open/articles/latest", {}, hashUri],      // mutable pointer
  ],
});

// Later: update the pointer to new content without losing the old
const updated = { title: "B3nd Intro v2", body: "Updated..." };
const newHashUri = generateHashUri(await computeSha256(updated));

await id.rig(rig).send({
  inputs: [],
  outputs: [
    [newHashUri, {}, updated],
    ["link://open/articles/latest", {}, newHashUri],  // pointer now points to v2
  ],
});

// Old version is still readable at its hash URI
```

**Hash chain for audit trails:** Each message can reference the previous hash as
an input, creating a tamper-evident chain:

```typescript
await id.rig(rig).send({
  inputs: [previousHashUri],  // reference to previous version
  outputs: [
    [newHashUri, {}, newContent],
    ["link://open/chain/head", {}, newHashUri],
  ],
});
```

### Fee Collection Protocol

Cross-output fee checks. Every data write must include a fee output with a
`fire` value proportional to data size. Inner programs inspect sibling outputs
via `upstream` (the envelope message).

```typescript
import type { Program } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

type Envelope = {
  inputs: string[];
  outputs: Array<[string, Record<string, number>, unknown]>;
};

const programs: Record<string, Program> = {
  "immutable://open": async ([_uri, , data], upstream) => {
    if (data === undefined || data === null) {
      return { code: "content:rejected", error: "Value required" };
    }

    // When inside an envelope, require a fee output
    if (upstream) {
      const env = upstream[2] as Envelope;
      const feeOutput = env.outputs.find(([u]) => u.startsWith("fees://"));
      if (!feeOutput) return { code: "content:rejected", error: "Fee required" };

      const dataSize = JSON.stringify(data).length;
      const requiredFee = Math.ceil(dataSize / 100); // 1 per 100 bytes
      const fee = feeOutput[1].fire ?? 0;
      if (fee < requiredFee) {
        return {
          code: "content:rejected",
          error: `Insufficient fee: need ${requiredFee}`,
        };
      }
    }
    return { code: "content:accepted" };
  },

  "fees://pool": async () => ({ code: "fee:accepted" }),
  "hash://sha256": hashValidator(),
};
```

**App usage:**

```typescript
await id.rig(rig).send({
  inputs: [],
  outputs: [
    ["immutable://open/post/123", {}, { title: "Hello", body: "World..." }],
    ["fees://pool", { fire: 1 }, null],  // fee carried as a conserved quantity
  ],
});
```

### UTXO / Conservation Protocol

Inputs must cover outputs. The envelope's program enforces the conservation
law on the `fire` quantity. Per-output programs check individual amounts.

```typescript
import type { Program } from "@bandeira-tech/b3nd-sdk";

type Envelope = {
  inputs: string[];
  outputs: Array<[string, Record<string, number>, unknown]>;
};

const nonNegative: Program = async ([, values]) => {
  if ((values.fire ?? 0) < 0) {
    return { code: "utxo:rejected", error: "Negative amount" };
  }
  return { code: "utxo:accepted" };
};

const programs: Record<string, Program> = {
  // Envelope program: enforce conservation law on `fire`
  "hash://sha256": async ([, , data], _upstream, read) => {
    if (!data || typeof data !== "object" || !("outputs" in data)) {
      return { code: "hash:accepted" }; // plain hash write, not an envelope
    }
    const env = data as Envelope;

    let inputSum = 0;
    for (const inputUri of env.inputs) {
      const [input] = await read(inputUri);
      if (input?.success && input.record) {
        inputSum += (input.record.values as Record<string, number>).fire ?? 0;
      }
    }
    const outputSum = env.outputs.reduce(
      (sum, [, values]) => sum + (values.fire ?? 0),
      0,
    );
    if (outputSum > inputSum) {
      return { code: "envelope:rejected", error: "Outputs exceed inputs" };
    }
    return { code: "envelope:accepted" };
  },

  // Per-output programs
  "utxo://alice": nonNegative,
  "utxo://bob": nonNegative,
};
```

**App usage — transfer 50 from Alice to Bob:**

```typescript
// Pre-condition: utxo://alice/1 holds { fire: 100 }

await aliceId.rig(rig).send({
  inputs: ["utxo://alice/1"],        // consume Alice's 100
  outputs: [
    ["utxo://bob/1",   { fire: 50 }, null],  // Bob gets 50
    ["utxo://alice/2", { fire: 50 }, null],  // Alice gets change
  ],
});

// Invalid: trying to create money (100 > 50 input)
const [bad] = await rig.receive([/* the signed envelope that tries to spend 100 */]);
// → { accepted: false, error: "Outputs exceed inputs" }
```

### Hash-Chain Retelling

Each message references the hash of the previous message, creating an ordered,
tamper-evident chain. Useful for audit trails, usage history, and provenance
tracking.

```typescript
import type { Program } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

const programs: Record<string, Program> = {
  "hash://sha256": hashValidator(),

  // Head pointer: must reference a valid hash URI
  "link://open": async ([_uri, , data], _upstream, read) => {
    if (typeof data !== "string" || !data.startsWith("hash://sha256/")) {
      return { code: "link:rejected", error: "Must point to a hash URI" };
    }
    const [content] = await read(data);
    if (!content?.success) {
      return { code: "link:rejected", error: "Referenced content not found" };
    }
    return { code: "link:accepted" };
  },
};
```

**App usage — building a chain:**

```typescript
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";

// First entry (no previous)
const entry1 = { event: "created", timestamp: Date.now(), previous: null };
const uri1 = generateHashUri(await computeSha256(entry1));

await id.rig(rig).send({
  inputs: [],
  outputs: [
    [uri1, {}, entry1],
    ["link://open/chain/head", {}, uri1],
  ],
});

// Second entry references the first
const entry2 = { event: "updated", timestamp: Date.now(), previous: uri1 };
const uri2 = generateHashUri(await computeSha256(entry2));

await id.rig(rig).send({
  inputs: [uri1],  // reference previous entry
  outputs: [
    [uri2, {}, entry2],
    ["link://open/chain/head", {}, uri2],  // advance the head
  ],
});

// Walk the chain backward from the head
let current = await rig.readData<string>("link://open/chain/head");
while (current) {
  const entry = await rig.readData<{ previous: string | null }>(current);
  console.log(entry);
  current = entry?.previous ?? null;
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
import type { Program } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";
import {
  authValidation,
  createPubkeyBasedAccess,
} from "@bandeira-tech/b3nd-sdk/auth";

const TRUSTED_VALIDATORS = ["validator_pubkey_1", "validator_pubkey_2"];
const TRUSTED_CONFIRMERS = ["confirmer_pubkey_1"];

const programs: Record<string, Program> = {
  "hash://sha256": hashValidator(),

  // User content: auth-verified, stored at the pubkey path
  "mutable://accounts": async ([uri, , data]) => {
    const validator = authValidation(createPubkeyBasedAccess());
    const isValid = await validator({ uri, value: data as never });
    return isValid
      ? { code: "account:accepted" }
      : { code: "account:rejected", error: "Auth failed" };
  },

  // Validation links: only trusted validators/confirmers can write
  "link://accounts": async ([uri, , data], _upstream, read) => {
    const pubkey = uri.split("/")[3]; // link://accounts/{pubkey}/...
    if (!TRUSTED_VALIDATORS.includes(pubkey) && !TRUSTED_CONFIRMERS.includes(pubkey)) {
      return { code: "link:rejected", error: "Not a trusted validator or confirmer" };
    }

    if (typeof data !== "string" || !data.startsWith("hash://sha256/")) {
      return { code: "link:rejected", error: "Must reference a hash URI" };
    }

    const [envelope] = await read(data);
    if (!envelope?.success) {
      return { code: "link:rejected", error: "Referenced envelope not found" };
    }
    return { code: "link:accepted" };
  },
};
```

**Three-layer flow:**

```typescript
import { Identity } from "@bandeira-tech/b3nd-sdk";

// 1. User submits content
const user = await Identity.fromSeed("user-seed");
const userContent = { title: "My Post", body: "Content here" };

const userResult = await user.rig(rig).send({
  inputs: [],
  outputs: [[`mutable://accounts/${user.publicKeyHex}/posts/1`, {}, userContent]],
});
// userResult.uri = "hash://sha256/{content_hash}"

// 2. Validator endorses the user's envelope
const validator = await Identity.fromSeed("validator-seed-1");
const validatorResult = await validator.rig(rig).send({
  inputs: [userResult.uri],  // reference the user's envelope
  outputs: [
    [
      `link://accounts/${validator.publicKeyHex}/validations/${userResult.uri}`,
      {},
      userResult.uri,
    ],
  ],
});

// 3. Confirmer finalizes
const confirmer = await Identity.fromSeed("confirmer-seed-1");
await confirmer.rig(rig).send({
  inputs: [validatorResult.uri],  // reference the validation envelope
  outputs: [
    [
      `link://accounts/${confirmer.publicKeyHex}/confirmed/${userResult.uri}`,
      {},
      validatorResult.uri,
    ],
  ],
});

// Verify: is the user's post confirmed?
const [confirmation] = await rig.read(
  `link://accounts/${confirmer.publicKeyHex}/confirmed/${userResult.uri}`,
);
console.log(confirmation.success); // true — post is confirmed
```

Each layer uses the same envelope shape. The protocol defines which pubkeys are
trusted at each layer, and the programs table enforces it.

---

## Running Your Protocol's Node

> For operational details (backends, managed mode, monitoring, replication),
> see [OPERATORS.md](./OPERATORS.md). This section covers protocol-specific setup.

A node is a Rig plus a transport. The Rig owns the `programs` table, the
`handlers`, and the connections to storage; `httpApi(rig)` exposes it as a
standalone `(Request) => Promise<Response>` handler you can hand to any
runtime.

### Programs Module Pattern

Export your programs as a module so operators and tests both import the same
contract:

```typescript
// programs.ts
import type { Program } from "@bandeira-tech/b3nd-sdk";

export const programs: Record<string, Program> = {
  "mutable://open": async ([_uri, , data]) => {
    if (data === undefined || data === null) {
      return { code: "open:rejected", error: "Value required" };
    }
    return { code: "open:accepted" };
  },
};
```

### Serving the Rig over HTTP

```typescript
import {
  connection,
  httpApi,
  MemoryStore,
  MessageDataClient,
  Rig,
} from "@bandeira-tech/b3nd-sdk";
import { programs } from "./programs.ts";

const client = new MessageDataClient(new MemoryStore());
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  programs,
  handlers: {
    "open:accepted": async (msg, broadcast) => { await broadcast([msg]); },
  },
});

Deno.serve({ port: 43100 }, httpApi(rig));
```

### Multi-Backend Composition

Wire each backend as its own connection. Writes broadcast to every
connection whose `receive` patterns match; reads try connections in
declaration order.

```typescript
import {
  connection,
  MemoryStore,
  MessageDataClient,
  Rig,
} from "@bandeira-tech/b3nd-sdk";
import { PostgresStore } from "@bandeira-tech/b3nd-client-postgres";
import { programs } from "./programs.ts";

const memory = new MessageDataClient(new MemoryStore());
const postgres = new MessageDataClient(
  new PostgresStore({
    connection: "postgresql://…",
    tablePrefix: "b3nd",
    poolSize: 5,
    connectionTimeout: 10000,
  }),
);

const rig = new Rig({
  connections: [
    connection(memory,   { receive: ["*"], read: ["*"] }),
    connection(postgres, { receive: ["*"], read: ["*"] }),
  ],
  programs,
});
```

### PostgreSQL / MongoDB Setup

```typescript
// Postgres
const pgStore = new PostgresStore({
  connection: "postgresql://…",
  tablePrefix: "b3nd",
  poolSize: 5,
  connectionTimeout: 10000,
});
await pgStore.initializeSchema();
const pg = new MessageDataClient(pgStore);

// MongoDB
const mongoStore = new MongoStore({
  connectionString: "mongodb://localhost:27017/mydb",
  collectionName: "b3nd_data",
});
const mongo = new MessageDataClient(mongoStore);
```

---

## Packaging a Protocol SDK

Once your protocol's programs are stable, wrap them into a protocol-specific
package so app developers don't need to understand B3nd internals. This is
how a protocol becomes usable.

**What to export:**

1. **Programs** — the `Record<string, Program>` table, so node operators can
   run your protocol.
2. **Pre-configured client factory** — a function that returns an `HttpClient`
   pointed at your network.
3. **Typed helpers** — functions that build well-formed 3-tuple messages for
   your programs.
4. **URI builders** — functions that construct URIs following your
   conventions.

**Example: packaging a minimal protocol SDK:**

```typescript
// my-protocol-sdk/mod.ts
import type { Program } from "@bandeira-tech/b3nd-sdk";
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

// 1. Programs export (for node operators)
export const programs: Record<string, Program> = {
  "mutable://open": async () => ({ code: "open:accepted" }),
  "hash://sha256": hashValidator(),
  "link://open": async ([_uri, , data]) => {
    if (typeof data !== "string") {
      return { code: "link:rejected", error: "Must be string" };
    }
    return { code: "link:accepted" };
  },
};

// 2. Pre-configured client
export function createClient(url = "https://my-protocol-node.example.com") {
  return new HttpClient({ url });
}

// 3. Typed helpers — produce the 3-tuple apps pass to receive/send.
export function buildNote(path: string, content: object) {
  return [`mutable://open/${path}`, {}, content] as const;
}

// 4. URI builders
export function noteUri(path: string) {
  return `mutable://open/${path}`;
}
```

**Example:** A protocol's programs module exports the canonical programs
table. The `@bandeira-tech/b3nd-web` and `@bandeira-tech/b3nd-sdk` packages
provide the transport layer. Together they form the protocol SDK that app
developers consume — without knowing they're using B3nd underneath.

---

## What Apps Look Like

From the protocol developer's perspective, here's what apps do with your SDK.
Understanding this helps you design protocols that are easy to consume.

**Apps call `receive()`, `read()`, and `send()` via `HttpClient`.** That's the
entire surface area. An app developer imports your client factory, connects to a
node, and uses the standard B3nd operations. They never define programs, inspect
the programs table, or think about dispatch.

**Apps compose with `LocalStorageStore` for offline.** Browser apps often layer
a local cache (via a protocol client wrapping `LocalStorageStore`) in front of
the remote node. They `receive()` to both local and remote, and `read()` from
local first. This is transparent to the protocol.

**Apps never see the programs table.** They trust the node to classify. If an
app sends an invalid message, the node rejects it. The app handles the
rejection. The app never imports your programs module — that's the node's
responsibility.

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
| **Program**              | `scheme://hostname` pair — the unit of classification dispatch     |
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
- `libs/b3nd-rig/` — Rig, Identity, connection(), httpApi()
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
- `libs/b3nd-rig/http.ts` — `httpApi(rig)` standalone HTTP handler
- `apps/b3nd-node/` — Multi-backend HTTP node
- `apps/b3nd-web-rig/` — React/Vite data explorer + dashboard
- `apps/sdk-inspector/` — Test runner backend
- `apps/b3nd-cli/` — bnd CLI tool

### Testing
- `libs/b3nd-testing/shared-suite.ts` — Client conformance suite
- `libs/b3nd-testing/node-suite.ts` — Node interface suite

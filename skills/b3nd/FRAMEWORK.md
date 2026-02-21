---
name: b3nd-framework
description: B3nd DePIN framework — for protocol designers building decentralized networks. Message primitives, schema dispatch, envelope structure, NodeProtocolInterface, auth primitives, encryption, content-addressing, client composition, protocol examples (open CRUD, auth-based, content-addressed, fee collection, UTXO conservation, hash-chain retelling, consensus), ProgramValidator, createOutputValidator, protocol versioning, packaging a protocol SDK, running protocol nodes. Use when building a new DePIN protocol or extending the B3nd framework. For app development on Firecat, see the firecat skill.
---

# B3nd — DePIN Framework & SDK

You are here to create a DePIN network. B3nd provides URI-addressed resource
design, schema-driven validation, and cryptographic primitives. Protocols (like
Firecat) are built on top of B3nd. Apps are built on top of protocols.

This document covers B3nd itself — what the framework provides and how protocols
use it. **Building an app?** See [FIRECAT.md](./FIRECAT.md) for the Firecat
protocol's Quick Start, server setup, browser apps, and testing.

---

## Three Layers of Abstraction

| Layer | What | Who | Relies on |
|-------|------|-----|-----------|
| **1. Framework** | B3nd — addressed data, schema dispatch, auth primitives, SDK | B3nd developers | Nothing — this is the foundation |
| **2. Protocol** | e.g., Firecat — program schemas, consensus, fees, URI conventions | Protocol developers | B3nd SDK |
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

All state changes flow through a single operation. A message is a tuple:

```typescript
type Message<D = unknown> = [uri: string, data: D];
```

URIs address where data goes. Data is whatever you're sending. That's it.

### The Envelope Shape

Messages that carry multiple outputs use the envelope structure:

```typescript
interface MessageData<V = unknown> {
  auth?: Array<{ pubkey: string; signature: string }>;
  payload: {
    inputs: string[];                    // references to existing state
    outputs: Array<[string, V]>;        // [uri, value] pairs to write
  };
}
```

An envelope is itself a message — `[uri, { auth?, payload: { inputs, outputs } }]`.
`auth` is optional — programs decide whether they need it. `payload` always
contains `{ inputs, outputs }`. Envelopes can reference other envelopes. This
recursive structure is the foundation for protocol design: content → validation →
confirmation are all just envelopes referencing envelopes.

```
[envelope_uri, {
  auth: [{ pubkey, signature }],
  payload: { inputs: [...], outputs: [[uri, value], ...] }
}]
```

Every layer — user request, validator attestation, confirmer finalization — uses
this same shape. The framework doesn't distinguish between them.

### How It Works

B3nd is small. The entire framework is a validation dispatch loop. Here's
what happens when a message arrives at a node:

```
message arrives: [uri, data]
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
 reject   run validator(uri, data, read)
            │
        ┌───┴───┐
        │       │
     invalid   valid
        │       │
        ▼       ▼
     reject   accept message
              return accepted
```

That's it. There is no queue, no consensus engine, no transaction manager
inside the framework. A node receives a message, dispatches to a validator,
and accepts or rejects. Everything else — consensus, fees, multi-step
workflows — is built by protocols on top of this loop using the same message
primitive.

**What the validator sees:**

```typescript
async function myValidator(write: {
  uri: string;           // where data wants to go
  value: unknown;        // the data itself
  read: (uri) => ...;    // read existing state (any URI)
}) {
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
automatically unpacks it. Each output in `payload.outputs` becomes a separate
`receive()` call to the node. The envelope itself is sent to its
content-addressed hash URI as an audit trail.

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

The **schema** is a mapping from program keys to validation functions:

```typescript
type ValidationFn = (write: {
  uri: string;
  value: unknown;
  read: <T>(uri: string) => Promise<ReadResult<T>>;
}) => Promise<{ valid: boolean; error?: string }>;

type Schema = Record<string, ValidationFn>;

// Example: a schema with two programs
const schema: Schema = {
  "mutable://open": async ({ value }) => ({ valid: !!value }),
  "test://data": async () => ({ valid: true }),
};
```

When a message arrives, the framework extracts `scheme://hostname` from the URI,
looks up the validation function, and calls it. If no program matches, the
message is rejected. Programs decide everything: mutability, authentication,
content-addressing, access patterns.

### NodeProtocolInterface

All clients implement:

```typescript
interface NodeProtocolInterface {
  receive<D>(msg: Message<D>): Promise<ReceiveResult>;
  read<T>(uri: string): Promise<ReadResult<T>>;
  readMulti<T>(uris: string[]): Promise<ReadMultiResult<T>>;
  list(uri: string, options?: ListOptions): Promise<ListResult>;
  delete(uri: string): Promise<DeleteResult>;
  health(): Promise<HealthStatus>;
  getSchema(): Promise<string[]>;
  cleanup(): Promise<void>;
}
```

`receive()` is the fundamental write operation — every state change flows
through it. This is the unidirectional flow: messages go in, state comes out.

`list()` returns flat results — all URIs matching the prefix:

```typescript
interface ListItem { uri: string; }
```

### Basic Operations

```typescript
// Deno
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
// Browser
import { HttpClient } from "@bandeira-tech/b3nd-web";

const client = new HttpClient({ url: "http://localhost:9942" });

// Write — single message
await client.receive(["mutable://open/my-app/config", { theme: "dark" }]);

// Read
const result = await client.read("mutable://open/my-app/config");
console.log(result.record?.data); // { theme: "dark" }

// List
const items = await client.list("mutable://open/my-app/");

// Delete
await client.delete("mutable://open/my-app/config");
```

### The send() and message() API

`send()` batches multiple writes into a content-addressed envelope. It computes
a SHA256 hash of the payload (via RFC 8785 canonical JSON), sends through the
client, and returns the result:

```typescript
import { send } from "@bandeira-tech/b3nd-sdk";
// or: import { send } from "@bandeira-tech/b3nd-web";

const result = await send({
  payload: {
    inputs: [],
    outputs: [
      ["mutable://open/app/config", { theme: "dark" }],
      ["mutable://open/app/status", { active: true }],
    ],
  },
}, client);
// result.uri = "hash://sha256/{hex}" — the envelope's content-addressed URI
// result.accepted = true

// With auth:
const authResult = await send({
  auth: [{ pubkey, signature }],
  payload: {
    inputs: [],
    outputs: [["mutable://accounts/{pubkey}/profile", signedData]],
  },
}, client);
```

- `msgSchema(schema)` validates the envelope AND each output against its
  program's schema
- Each client's `receive()` detects MessageData and dispatches outputs individually
- The envelope is sent to its hash URI as an audit trail

The lower-level `message()` function builds the tuple without sending:

```typescript
import { message } from "@bandeira-tech/b3nd-sdk";

const [uri, data] = await message({
  payload: {
    inputs: [],
    outputs: [["mutable://open/config", { theme: "dark" }]],
  },
});
// uri = "hash://sha256/{computed-hash}"
// data = { payload: { inputs: [], outputs: [...] } }
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
  createValidatedClient, parallelBroadcast, firstMatchSequence, msgSchema,
  FunctionalClient,
} from "@bandeira-tech/b3nd-sdk";

// Compose multiple backends
const client = createValidatedClient({
  receive: parallelBroadcast([postgresClient, memoryClient]),
  read: firstMatchSequence([postgresClient, memoryClient]),
  validate: msgSchema(schema),
});

// Validators: seq(), any(), all(), msgSchema(), schemaValidator()
// Combinators: parallelBroadcast(), firstMatchSequence()

// Custom behavior without class inheritance
const client = new FunctionalClient({
  receive: async (msg) => backend.receive(msg),
  read: async (uri) => backend.read(uri),
  list: async (uri, options) => backend.list(uri, options),
});
```

### URI Design

URI paths work like filesystem directories. Data at a leaf URI is a resource.
Prefix listing (`client.list("prefix/")`) enumerates children.

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
│  Frontends  │    [uri, data] →     │     B3nd Node    │
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

The SDK provides client implementations (PostgresClient, MemoryClient,
MongoClient, etc.) as ready-made backends. But these are tools for node
operators, not framework guarantees. A node using MemoryClient loses everything
on restart. A node using PostgresClient retains everything. Both are valid B3nd
nodes — the framework doesn't distinguish between them.

This is what makes B3nd a universal backend layer. Like HTTPS standardizes
transport without dictating what servers do with requests, B3nd standardizes
resource addressing and validation without dictating what nodes do with
accepted messages.

### Available Clients

| Client               | Package    | Use                        |
| -------------------- | ---------- | -------------------------- |
| `HttpClient`         | Both       | Connect to any HTTP node   |
| `MemoryClient`       | Both       | Testing, in-process        |
| `LocalStorageClient` | NPM        | Browser offline cache      |
| `IndexedDBClient`    | NPM        | Browser IndexedDB storage  |
| `PostgresClient`     | JSR        | PostgreSQL storage         |
| `MongoClient`        | JSR        | MongoDB storage            |

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
| PostgresClient     | Yes            | No              |
| MongoClient        | Yes            | No              |
| LocalStorageClient | No             | Yes             |
| IndexedDBClient    | No             | Yes             |
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

1. **Plain message** `[uri, data]` — extracts the program from `uri`, looks up
   the validator in the schema table, calls it. Same as the basic dispatch loop.

2. **Envelope message** `[uri, { auth?, payload: { inputs, outputs } }]` — does
   three things in sequence:
   - Validates the envelope URI against its program validator
   - Enforces content-hash integrity for any `hash://` output URIs
   - Validates each output `[uri, value]` against its program validator

If any step fails, the entire envelope is rejected. There is no partial
acceptance.

```typescript
// What msgSchema() does (simplified):
function msgSchema(schema) {
  return async (msg, read) => {
    const [uri, data] = msg;

    if (!isEnvelope(data)) {
      // Plain message: dispatch to one validator
      return schema[extractProgram(uri)]({ uri, value: data, read });
    }

    // 1. Validate the envelope itself
    const envelopeResult = await schema[extractProgram(uri)]({ uri, value: data, read });
    if (!envelopeResult.valid) return envelopeResult;

    // 2-3. Validate each output against its program
    for (const [outputUri, outputValue] of data.payload.outputs) {
      // Content-hash check (structural, automatic for hash:// URIs)
      // Then dispatch to the output's program validator
      const result = await schema[extractProgram(outputUri)]({
        uri: outputUri, value: outputValue, read,
      });
      if (!result.valid) return result;
    }

    return { valid: true };
  };
}
```

**Key insight:** The envelope's program validator sees the *entire* envelope
(auth, inputs, outputs) as its `value`. Each output's program validator sees
only that output's `value`. This means envelope-level concerns (signature
verification, input references, fee checks) belong in the envelope's program
validator, while per-resource concerns (data format, ownership) belong in
each output's program validator.

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
const envelopeValidator = async ({ value: data, read }) => {
  for (const inputUri of data.payload.inputs) {
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
const schema = {
  "link://accounts": async ({ uri, value, read }) => {
    // value is a hash URI string — verify the content it points to exists
    const content = await read(value);
    if (!content.success) {
      return { valid: false, error: `Referenced content not found: ${value}` };
    }
    return { valid: true };
  },

  "hash://sha256": hashValidator(),  // built-in: verifies data matches hash

  "mutable://accounts": async ({ uri, value, read }) => {
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

### The ProgramValidator and createOutputValidator

For protocols with envelope-based message flows, the SDK provides richer
validator types and a composition helper:

```typescript
import type { MessageValidationContext, ProgramValidator, ProgramSchema }
  from "@bandeira-tech/b3nd-sdk";

// ProgramValidator receives full context: uri, value, inputs, outputs, read
const feeValidator: ProgramValidator = async (ctx) => {
  // ctx.uri      — this output's URI
  // ctx.value    — this output's value
  // ctx.inputs   — all inputs from the envelope
  // ctx.outputs  — all outputs from the envelope (for cross-output checks)
  // ctx.read     — read any URI on the node

  // Example: require a fee output proportional to data size
  const feeOutput = ctx.outputs.find(([uri]) => uri.startsWith("fees://"));
  if (!feeOutput) return { valid: false, error: "Fee required" };

  const dataSize = JSON.stringify(ctx.value).length;
  const requiredFee = Math.ceil(dataSize / 100);
  if ((feeOutput[1] as number) < requiredFee) {
    return { valid: false, error: `Insufficient fee: need ${requiredFee}` };
  }
  return { valid: true };
};
```

`createOutputValidator()` composes a `ProgramSchema` into a full message
validator with optional pre-validation (for envelope-level checks like
signatures or input verification):

```typescript
import { createOutputValidator } from "@bandeira-tech/b3nd-sdk";

const validator = createOutputValidator({
  schema: {
    "mutable://accounts": accountValidator,
    "link://accounts": linkValidator,
    "fees://pool": async () => ({ valid: true }),
  },
  // Pre-validation runs before per-output dispatch
  preValidate: async (msg, read) => {
    const [, data] = msg;
    // Check signatures, verify input existence, enforce conservation laws
    let inputSum = 0;
    for (const inputUri of data.payload.inputs) {
      const input = await read<{ amount: number }>(inputUri);
      if (input.success && input.record) inputSum += input.record.data.amount;
    }
    const outputSum = data.payload.outputs.reduce(
      (sum, [, v]) => sum + (v as number), 0,
    );
    if (outputSum > inputSum) {
      return { valid: false, error: "Outputs exceed inputs" };
    }
    return { valid: true };
  },
});
```

### Testing Protocol Validators

Test validators using `MemoryClient` with your protocol's schema. Test both
the happy path (valid messages accepted) and the rejection path (invalid
messages rejected with the right error):

```typescript
import { assertEquals } from "@std/assert";
import { MemoryClient, send } from "@bandeira-tech/b3nd-sdk";

const schema = {
  "mutable://accounts": async ({ uri, value, read }) => {
    if (!value || typeof value !== "object") {
      return { valid: false, error: "Value must be an object" };
    }
    return { valid: true };
  },
  "hash://sha256": hashValidator(),
};

Deno.test("accepts valid account write", async () => {
  const client = new MemoryClient({ schema });
  const result = await send({
    payload: {
      inputs: [],
      outputs: [["mutable://accounts/alice/profile", { name: "Alice" }]],
    },
  }, client);
  assertEquals(result.accepted, true);
  await client.cleanup();
});

Deno.test("rejects invalid account write", async () => {
  const client = new MemoryClient({ schema });
  const result = await send({
    payload: {
      inputs: [],
      outputs: [["mutable://accounts/alice/profile", null]],
    },
  }, client);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "mutable://accounts: Value must be an object");
  await client.cleanup();
});

// Test cross-program reads: pre-populate state, then validate against it
Deno.test("validator reads cross-program state", async () => {
  const crossSchema = {
    "mutable://balances": async ({ uri, value, read }) => {
      const pubkey = uri.split("/")[3];
      const auth = await read(`link://accounts/${pubkey}/auth`);
      if (!auth.success) return { valid: false, error: "Not registered" };
      return { valid: true };
    },
    "link://accounts": async () => ({ valid: true }),
  };
  const client = new MemoryClient({ schema: crossSchema });

  // Pre-populate: register the account
  await client.receive(["link://accounts/alice/auth", { active: true }]);

  // Now the balance write should succeed (cross-program read finds the auth)
  await client.receive(["mutable://balances/alice/balance", { amount: 100 }]);
  const result = await client.read("mutable://balances/alice/balance");
  assertEquals(result.record?.data, { amount: 100 });
  await client.cleanup();
});
```

### Recursive Envelopes and Consensus

The envelope shape `{ inputs, outputs }` is the same at every depth. This
enables a natural consensus architecture:

```
Layer: User request
[hash://sha256/{content}, {
  auth: [{ user, sig }],
  payload: { inputs: [], outputs: [[uri, value], ...] }
}]

Layer: Validation (validator endorses the request)
[hash://sha256/{validated}, {
  auth: [{ validator, sig }],
  payload: {
    inputs: ["hash://sha256/{content}"],
    outputs: [["link://accounts/{validator}/validations/{content_hash}", ...]]
  }
}]

Layer: Confirmation (confirmer finalizes)
[hash://sha256/{confirmed}, {
  auth: [{ confirmer, sig }],
  payload: {
    inputs: ["hash://sha256/{validated}"],
    outputs: [["link://accounts/{confirmer}/confirmed/{content_hash}", ...]]
  }
}]
```

Each layer is just a message that references the previous layer as input and
produces new outputs. The framework doesn't know about consensus — it just
processes `[uri, data]` messages. Consensus emerges from the program schemas that
control who can write validation and confirmation links.

To verify a message was confirmed, a validator reads the inner envelope by its
hash URI. Since the envelope was content-addressed, `read("hash://sha256/{content}")`
returns the original user request. The validator can then inspect its auth,
inputs, and outputs to decide whether to endorse it:

```typescript
// Validator endorsement: read the user's envelope, verify, write a link
"link://accounts": async ({ uri, value, read }) => {
  // value = "hash://sha256/{content}" — reference to the user's envelope
  const envelope = await read(value);
  if (!envelope.success) return { valid: false, error: "Envelope not found" };

  // Inspect the original envelope's auth, outputs, etc.
  const data = envelope.record?.data;
  if (!data?.auth?.length) return { valid: false, error: "Unsigned envelope" };

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
  "link://posts": async ({ uri, value, read }) => {
    // value is a hash URI pointing to endorsed content
    if (typeof value !== "string" || !value.startsWith("hash://sha256/")) {
      return { valid: false, error: "Link value must be a hash URI" };
    }
    // Verify the content exists
    const content = await read(value);
    if (!content.success) {
      return { valid: false, error: "Linked content not found" };
    }
    return { valid: true };
  },

  // User profiles — anyone can write to their own path
  "mutable://profiles": async ({ uri, value }) => {
    if (!value || typeof value !== "object") {
      return { valid: false, error: "Profile must be an object" };
    }
    return { valid: true };
  },
};
```

**How it's used:**

```typescript
import { MemoryClient, send } from "@bandeira-tech/b3nd-sdk";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";

const client = new MemoryClient({ schema: publishingProtocol });

// 1. User publishes content
const post = { title: "Hello World", body: "First post on B3nd" };
const hash = await computeSha256(post);
const hashUri = generateHashUri(hash);

await send({
  payload: {
    inputs: [],
    outputs: [
      [hashUri, post],                                    // immutable content
      ["link://posts/latest", hashUri],                   // mutable pointer
      ["mutable://profiles/alice", { name: "Alice" }],    // profile update
    ],
  },
}, client);

// 2. Read the latest post via the link
const link = await client.read<string>("link://posts/latest");
const content = await client.read(link.record!.data);
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
  payload: {
    inputs: [],
    outputs: [
      [hashUri, content],                        // immutable content
      ["link://open/posts/latest", hashUri],      // mutable pointer
    ],
  },
}, client);
```

#### Input Consumption

Hash URIs are immutable — you can't "spend" them. Protocols that need input
consumption (UTXO-style) use links as the consumable layer:

```
1. Link points to current state: link://utxo/{id} → hash://sha256/{state1}
2. Transaction consumes link (overwrites): link://utxo/{id} → hash://sha256/{state2}
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
  payload: {
    inputs: ["hash://sha256/{user_request}"],
    outputs: [
      // Proof path: immutable validation record
      ["link://accounts/{validator}/validations/{hash}", validationAttestation],
      // Fast path: update the user's mutable balance
      ["mutable://accounts/{pubkey}/balance", { amount: newBalance }],
    ],
  },
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
cross-output checks, see the `ProgramValidator` fee example above.

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
import { createServerNode, MemoryClient, servers } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

const client = new MemoryClient({ schema });
const app = new Hono();
const frontend = servers.httpServer(app);
createServerNode({ frontend, client }).listen(9942);
```

**App usage:**

```typescript
const client = new HttpClient({ url: "http://localhost:9942" });
await client.receive(["mutable://open/notes/1", { text: "Hello world" }]);
const result = await client.read("mutable://open/notes/1");
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

  "mutable://accounts": async ({ uri, value }) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value });
    return {
      valid: isValid,
      error: isValid ? undefined : "Signature verification failed",
    };
  },

  "immutable://accounts": async ({ uri, value, read }) => {
    // Auth + write-once
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value });
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
  payload: {
    inputs: [],
    outputs: [[`mutable://accounts/${keys.publicKeyHex}/profile`, signed]],
  },
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
  "link://open": async ({ value }) => {
    if (typeof value !== "string" || !value.startsWith("hash://")) {
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
  payload: {
    inputs: [],
    outputs: [
      [hashUri, article],                          // immutable content
      ["link://open/articles/latest", hashUri],     // mutable pointer
    ],
  },
}, client);

// Later: update the pointer to new content without losing the old
const updated = { title: "B3nd Intro v2", body: "Updated..." };
const newHash = await computeSha256(updated);
const newHashUri = generateHashUri(newHash);

await send({
  payload: {
    inputs: [],
    outputs: [
      [newHashUri, updated],
      ["link://open/articles/latest", newHashUri],  // pointer now points to v2
    ],
  },
}, client);

// Old version is still readable at its hash URI
```

**Hash chain for audit trails:** Each message can reference the previous hash as
an input, creating a tamper-evident chain:

```typescript
await send({
  payload: {
    inputs: [previousHashUri],  // reference to previous version
    outputs: [
      [newHashUri, newContent],
      ["link://open/chain/head", newHashUri],
    ],
  },
}, client);
```

### Fee Collection Protocol

Cross-output fee validation. Every data write must include a fee output
proportional to data size. Uses `ProgramValidator` with `ctx.outputs` for
cross-output inspection.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { createOutputValidator } from "@bandeira-tech/b3nd-sdk";

const outputValidator = createOutputValidator({
  schema: {
    "immutable://open": async (ctx) => {
      // Require fee proportional to data size
      const feeOutput = ctx.outputs.find(([uri]) => uri.startsWith("fees://"));
      if (!feeOutput) return { valid: false, error: "Fee required" };

      const dataSize = JSON.stringify(ctx.value).length;
      const requiredFee = Math.ceil(dataSize / 100); // 1 per 100 bytes
      if ((feeOutput[1] as number) < requiredFee) {
        return { valid: false, error: `Insufficient fee: need ${requiredFee}` };
      }
      return { valid: true };
    },

    "fees://pool": async () => ({ valid: true }),
  },
});

// Wrap into a standard schema for node use
const schema: Schema = {
  "immutable://open": async ({ uri, value }) => ({ valid: !!value }),
  "fees://pool": async () => ({ valid: true }),
  "hash://sha256": hashValidator(),
};
```

**App usage:**

```typescript
await send({
  payload: {
    inputs: [],
    outputs: [
      ["immutable://open/post/123", { title: "Hello", body: "World..." }],
      ["fees://pool", 1],  // fee covers data size
    ],
  },
}, client);
```

### UTXO / Conservation Protocol

Inputs must cover outputs. Implements conservation law enforcement using
`createOutputValidator` with `preValidate`. Balance checking via `read()`.

```typescript
import { createOutputValidator } from "@bandeira-tech/b3nd-sdk";

const validator = createOutputValidator<number>({
  schema: {
    "utxo://alice": async (ctx) => {
      if (ctx.value < 0) return { valid: false, error: "Negative amount" };
      return { valid: true };
    },
    "utxo://bob": async (ctx) => {
      if (ctx.value < 0) return { valid: false, error: "Negative amount" };
      return { valid: true };
    },
  },

  preValidate: async (msg, read) => {
    const [, data] = msg;

    // Sum inputs (read existing state)
    let inputSum = 0;
    for (const inputUri of data.payload.inputs) {
      const input = await read<{ amount: number }>(inputUri);
      if (input.success && input.record) inputSum += input.record.data.amount;
    }

    // Sum outputs
    const outputSum = data.payload.outputs.reduce(
      (sum, [, value]) => sum + (value as number), 0,
    );

    // Conservation: outputs cannot exceed inputs
    if (outputSum > inputSum) {
      return { valid: false, error: "Outputs exceed inputs" };
    }
    return { valid: true };
  },
});
```

**App usage — transfer 50 from Alice to Bob:**

```typescript
// Pre-condition: utxo://alice/1 has { amount: 100 }

await send({
  payload: {
    inputs: ["utxo://alice/1"],        // consume Alice's 100
    outputs: [
      ["utxo://bob/1", 50],            // Bob gets 50
      ["utxo://alice/2", 50],           // Alice gets change
    ],
  },
}, client);

// Invalid: trying to create money (100 > 50 input)
await send({
  payload: {
    inputs: ["utxo://alice/2"],        // only 50 available
    outputs: [["utxo://bob/2", 100]],  // trying to send 100 — rejected
  },
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
  "link://open": async ({ value, read }) => {
    if (typeof value !== "string" || !value.startsWith("hash://sha256/")) {
      return { valid: false, error: "Must point to a hash URI" };
    }
    const content = await read(value);
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
  payload: {
    inputs: [],
    outputs: [
      [uri1, entry1],
      ["link://open/chain/head", uri1],
    ],
  },
}, client);

// Second entry references the first
const entry2 = { event: "updated", timestamp: Date.now(), previous: uri1 };
const hash2 = await computeSha256(entry2);
const uri2 = generateHashUri(hash2);

await send({
  payload: {
    inputs: [uri1],  // reference previous entry
    outputs: [
      [uri2, entry2],
      ["link://open/chain/head", uri2],  // advance the head
    ],
  },
}, client);

// Walk the chain backward from the head
let current = (await client.read<string>("link://open/chain/head")).record?.data;
while (current) {
  const entry = await client.read(current);
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
  "mutable://accounts": async ({ uri, value }) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value });
    return { valid: isValid, error: isValid ? undefined : "Auth failed" };
  },

  // Validation links: only trusted validators can write
  "link://accounts": async ({ uri, value, read }) => {
    // Extract writer pubkey from URI path
    const pubkey = uri.split("/")[3]; // link://accounts/{pubkey}/...
    if (!TRUSTED_VALIDATORS.includes(pubkey) && !TRUSTED_CONFIRMERS.includes(pubkey)) {
      return { valid: false, error: "Not a trusted validator or confirmer" };
    }

    // Value should be a hash URI referencing the envelope being validated
    if (typeof value !== "string" || !value.startsWith("hash://sha256/")) {
      return { valid: false, error: "Must reference a hash URI" };
    }

    // Verify the referenced envelope exists
    const envelope = await read(value);
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
  payload: {
    inputs: [],
    outputs: [[`mutable://accounts/${userKeys.publicKeyHex}/posts/1`, signed]],
  },
}, client);
// userResult.uri = "hash://sha256/{content_hash}"

// 2. Validator endorses the user's envelope
const validatorResult = await send({
  auth: [{ pubkey: "validator_pubkey_1", signature: "..." }],
  payload: {
    inputs: [userResult.uri],  // reference the user's envelope
    outputs: [
      [`link://accounts/validator_pubkey_1/validations/${userResult.uri}`, userResult.uri],
    ],
  },
}, client);

// 3. Confirmer finalizes
await send({
  auth: [{ pubkey: "confirmer_pubkey_1", signature: "..." }],
  payload: {
    inputs: [validatorResult.uri],  // reference the validation envelope
    outputs: [
      [`link://accounts/confirmer_pubkey_1/confirmed/${userResult.uri}`, validatorResult.uri],
    ],
  },
}, client);

// Verify: is the user's post confirmed?
const confirmation = await client.read(
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
Firecat-specific node setup, see [FIRECAT.md > Running a Firecat Node](./FIRECAT.md).

### Schema Module Pattern

Export your schema as a module so it can be imported by the node and by tests:

```typescript
// schema.ts
import type { Schema } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "mutable://open": async ({ uri, value, read }) => {
    if (!value) return { valid: false, error: "Value required" };
    return { valid: true };
  },
};
export default schema;
```

### createServerNode

```typescript
import { createServerNode, MemoryClient, servers } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";
import schema from "./schema.ts";

const client = new MemoryClient({ schema });
const app = new Hono();
const frontend = servers.httpServer(app);
const node = createServerNode({ frontend, client });
node.listen(43100);
```

### Multi-Backend Composition

```typescript
const clients = [
  new MemoryClient({ schema }),
  new PostgresClient({ connection, schema, tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000 }),
];

const client = createValidatedClient({
  receive: parallelBroadcast(clients),
  read: firstMatchSequence(clients),
  validate: msgSchema(schema),
});

const frontend = servers.httpServer(app);
createServerNode({ frontend, client });
```

### PostgreSQL / MongoDB Setup

```typescript
// Postgres
const pg = new PostgresClient({
  connection: "postgresql://user:pass@localhost:5432/db",
  schema, tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000,
}, executor);
await pg.initializeSchema();

// MongoDB
const mongo = new MongoClient({
  connectionString: "mongodb://localhost:27017/mydb",
  schema, collectionName: "b3nd_data",
}, executor);
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
  "link://open": async ({ value }) => {
    if (typeof value !== "string") return { valid: false, error: "Must be string" };
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
    payload: { inputs: [], outputs: [[`mutable://open/${path}`, content]] },
  }, client);
}

// 4. URI builders
export function noteUri(path: string) {
  return `mutable://open/${path}`;
}
```

**How Firecat does it:** Firecat's schema module (`apps/b3nd-node/example-schema.ts`)
exports the canonical 8-program schema. The `@bandeira-tech/b3nd-web` and
`@bandeira-tech/b3nd-sdk` packages provide the transport layer. Together they
form the Firecat SDK that app developers consume — without knowing they're
using B3nd underneath.

---

## What Apps Look Like

From the protocol developer's perspective, here's what apps do with your SDK.
Understanding this helps you design protocols that are easy to consume.

**Apps call `receive()`, `read()`, and `send()` via `HttpClient`.** That's the
entire surface area. An app developer imports your client factory, connects to a
node, and uses the standard B3nd operations. They never define validators,
inspect schemas, or think about dispatch.

**Apps compose with `LocalStorageClient` for offline.** Browser apps often layer
a local cache in front of the remote node. They `receive()` to both local and
remote, and `read()` from local first. This is transparent to the protocol.

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

For a concrete worked example of an app built on a protocol, see
[FIRECAT.md](./FIRECAT.md) — it covers Quick Start, React patterns, state
management, and testing for app developers consuming the Firecat protocol.

---

## Terminology

| Term                     | Meaning                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| **Scheme**               | URI scheme component (e.g., `mutable`, `hash`, `link`)             |
| **Program**              | `scheme://hostname` pair — the unit of validation dispatch         |
| **Resource**             | Data addressed by a URI path within a program                         |
| **Envelope**             | Message with `{ auth?, payload: { inputs, outputs } }` structure   |
| **Protocol**             | System built on B3nd (e.g., Firecat) — defines programs and rules  |
| **DePIN**                | Decentralized Physical Infrastructure Network                      |

Usage: "program" for `scheme://hostname`. "Protocol" for systems built on B3nd
(like Firecat). "Envelope" for `{ auth?, payload: { inputs, outputs } }` messages.

---

## Tools & Infrastructure

### MCP Tools (Claude Plugin)

| Tool                       | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `b3nd_receive`             | Submit message `[uri, data]`                      |
| `b3nd_read`                | Read data from URI                                |
| `b3nd_list`                | List items at URI prefix                          |
| `b3nd_delete`              | Delete data                                       |
| `b3nd_health`              | Backend health check                              |
| `b3nd_schema`              | Get available programs                            |
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
./apps/b3nd-cli/bnd list mutable://accounts/{pubkey}/
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

### Clients
- `libs/b3nd-client-memory/` — In-memory client
- `libs/b3nd-client-http/` — HTTP client
- `libs/b3nd-client-ws/` — WebSocket client
- `libs/b3nd-client-postgres/` — PostgreSQL client
- `libs/b3nd-client-mongo/` — MongoDB client
- `libs/b3nd-client-localstorage/` — LocalStorage client
- `libs/b3nd-client-indexeddb/` — IndexedDB client
- `libs/b3nd-combinators/` — parallelBroadcast, firstMatchSequence

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

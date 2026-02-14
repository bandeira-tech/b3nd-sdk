---
name: b3nd
description: B3nd DePIN framework and SDK for URI-based data persistence. Use when working with B3nd URIs, programs, schemas, encryption, auth primitives, protocol design, SDK tooling, JSR (@bandeira-tech/b3nd-sdk), NPM (@bandeira-tech/b3nd-web), HttpClient, PostgresClient, MongoClient, MemoryClient, LocalStorageClient, IndexedDBClient, client composition, message envelopes, content-addressing, or any B3nd development task. For Firecat-specific topics (canonical schema, React apps, resource visibility), see the firecat skill.
---

# B3nd — DePIN Framework & SDK

B3nd is a Decentralized Physical Infrastructure Network (DePIN) framework. It
provides addressed data persistence, schema-driven validation, and cryptographic
primitives. Protocols (like Firecat) are built on top of B3nd. Apps are built on
top of protocols.

This document covers B3nd itself — what the framework provides, how protocols
use it, and how apps consume protocols. For the Firecat protocol specifically,
see the separate firecat skill.

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

Machines and people need to store, share, and verify data across untrusted
networks. B3nd provides the minimal infrastructure: addressed data with
schema-driven validation, cryptographic integrity, and unidirectional flow.

Think of it as a postal system. Letters (data) go into addressed envelopes
(messages). Post offices (nodes) validate and file them. The postal system
doesn't read your mail — it delivers, validates, and stores.

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

Programs are low-level data substrates, not domain boundaries. They provide
behavioral guarantees (mutability, authentication, content-addressing). Domain
concepts are organized as paths within programs — not as new programs.

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

`list()` returns flat results — all stored URIs matching the prefix:

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
- Each client's `receive()` detects MessageData and stores outputs individually
- The envelope is stored at its hash URI as an audit trail

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
   subscriptions at the protocol level. Nodes receive, validate, store.

2. **No liveness guarantees.** B3nd is fire-and-forget. The framework makes no
   promises about delivery, timing, or retry. If you mail a letter, the postal
   system doesn't guarantee arrival. Protocols that need delivery guarantees
   build them on top (receipt messages, acknowledgment patterns).

3. **Schema is law.** If the schema accepts a message, it's valid. If it
   rejects, it never happened. There is no partial acceptance, no pending state
   at the framework level.

4. **Programs are substrates.** Programs don't own domain concepts. They provide
   behavioral guarantees (mutability, auth, content-addressing). Domain
   organization happens in URI paths.

5. **Encryption is client-side.** B3nd nodes store what they're given. Privacy
   is achieved by encrypting before sending. The network is untrusted by design.

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
message exchange patterns. B3nd provides the transport and storage. Protocols
provide the rules.

This section discusses protocol design patterns, tradeoffs, and open problems.
Protocol developers should understand these before designing their own systems.

### What a Protocol Defines

A protocol built on B3nd makes these choices:

1. **Which programs exist** — the schema table (what schemes and hostnames)
2. **What each program validates** — the validation functions
3. **URI conventions** — how paths organize resources
4. **Message exchange patterns** — workflows for multi-step operations
5. **Consensus model** — how messages become confirmed state
6. **Fee model** — how participants are compensated

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

**B3nd makes consensus a first-class programmable concern.** Protocol developers
writing validation schemas ARE writing consensus protocols. The complexity
doesn't disappear — it moves into explicit, inspectable program schemas.

### Signing and Intent

Every message at every depth is the same gesture: **signing intent to place
outputs at addresses.** A user signs intent to store their profile. A validator
signs intent to place a validity link. A confirmer signs intent to place a
confirmation link. There is no structural difference.

Per-output signing (signing each `[uri, value]` pair individually) is a protocol
design choice, not a framework requirement. Programs that need per-output intent
verification (e.g., financial transfers) can require it in their schema
validation. Programs that don't (e.g., public announcements) skip it.

### Protocol Design Patterns

#### Content-Addressing + Links

Store immutable content at its hash, reference it via mutable links:

```typescript
// Store content + create named reference in one envelope
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
mutable state write (fast path). The schema enforces both.

#### Validator Namespace Design

Open namespaces (`link://valid/{hash}`) are spam surfaces. Prefer
validator-scoped namespaces:

```
link://accounts/{validator_pubkey}/validations/{content_hash}
```

Confirmers check specific known validators, not an open namespace. The
confirmation schema defines which validator pubkeys are trusted.

### Open Problems in Protocol Design

These are active design questions. Protocol developers should be aware of them:

**Fee timing.** When does the user pay? If fees are outputs in the message, they
only get stored if validation succeeds — meaning invalid messages are free to
submit. Options: fee escrow (pre-committed), transport-layer fees (HTTP request
cost), or accept-and-rate-limit.

**Circular references.** Two validators can cross-validate each other through
link intermediaries. Prevention requires temporal ordering (timestamps in URIs,
round-based validation) or URI design that structurally prevents cycles (include
the referenced hash in the validation URI).

**Privacy vs. provenance.** Content encryption solves payload privacy but not
traffic analysis. The auth chain reveals participant pubkeys, timing, and message
flow. Ephemeral/derived keys per message reduce linkability. Full metadata
privacy requires mixing/onion routing outside B3nd's scope.

**Checkpoint mechanisms.** Confirmation envelopes can reference previous
confirmations to create checkpoints. Light clients verify from the latest
checkpoint instead of walking the full chain. This is a protocol design decision
— the framework provides the recursive envelope shape, protocols define
checkpoint intervals.

---

## Layer 3: App Development

Apps are built on top of protocols using the B3nd SDK and protocol-specific
endpoints/schemas.

### Server-Side (Deno/JSR)

#### Installation

```typescript
// deno.json
{ "imports": { "@bandeira-tech/b3nd-sdk": "jsr:@bandeira-tech/b3nd-sdk" } }

import {
  createServerNode, createValidatedClient, firstMatchSequence,
  FunctionalClient, HttpClient, MemoryClient, MongoClient, msgSchema,
  parallelBroadcast, PostgresClient, send, servers,
} from "@bandeira-tech/b3nd-sdk";
```

#### HTTP Server with Hono

```typescript
import { createServerNode, MemoryClient, servers } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

const schema = { "mutable://open": async ({ value }) => ({ valid: !!value }) };
const client = new MemoryClient({ schema });
const app = new Hono();
const frontend = servers.httpServer(app);
const node = createServerNode({ frontend, client });
node.listen(43100);
```

#### Multi-Backend Server

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

#### PostgreSQL / MongoDB Setup

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

#### Schema Module Pattern

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

#### Environment Variables

```bash
PORT=43100
CORS_ORIGIN=*
BACKEND_URL=postgres://user:pass@localhost:5432/db
SCHEMA_MODULE=./my-schema.ts
# Multiple backends:
BACKEND_URL=memory://,postgres://...,http://other-node:9942
```

### Browser Apps (NPM)

#### Installation

```bash
npm install @bandeira-tech/b3nd-web
```

```typescript
import { HttpClient, LocalStorageClient } from "@bandeira-tech/b3nd-web";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-web/hash";
```

#### LocalStorageClient

```typescript
const local = new LocalStorageClient({
  keyPrefix: "myapp_",
  schema: {/* optional */},
});
```

### Deno CLI & Scripts

```typescript
#!/usr/bin/env -S deno run -A
import { HttpClient } from "@bandeira-tech/b3nd-sdk";

const BACKEND_URL = Deno.env.get("BACKEND_URL") || "http://localhost:9942";
const client = new HttpClient({ url: BACKEND_URL });

async function main() {
  const command = Deno.args[0];
  switch (command) {
    case "read": {
      const result = await client.read(Deno.args[1]);
      if (result.success) console.log(JSON.stringify(result.record?.data, null, 2));
      else console.error(result.error);
      break;
    }
    case "list": {
      const result = await client.list(Deno.args[1], { limit: 10 });
      if (result.success) console.log(result.data);
      break;
    }
    default:
      console.log("Usage: cli.ts <read|list> <uri>");
  }
}
main();
```

### Testing with MemoryClient

```typescript
import { assertEquals } from "@std/assert";
import { MemoryClient, send } from "@bandeira-tech/b3nd-sdk";

Deno.test("send and read", async () => {
  const schema = { "test://data": async () => ({ valid: true }) };
  const client = new MemoryClient({ schema });
  const result = await send({
    payload: {
      inputs: [],
      outputs: [["test://data/item1", { name: "Test" }]],
    },
  }, client);
  assertEquals(result.accepted, true);
  const read = await client.read("test://data/item1");
  assertEquals(read.record?.data, { name: "Test" });
  await client.cleanup();
});
```

#### Shared Test Suites

```typescript
import { runSharedSuite } from "../tests/shared-suite.ts";
import { runNodeSuite } from "../tests/node-suite.ts";

runSharedSuite("MyClient", {
  happy: () => createMyClient(happySchema),
  validationError: () => createMyClient(strictSchema),
});
```

#### Makefile

```makefile
test:
ifdef t
	@deno test --allow-all $(t)
else
	@deno test --allow-all tests/
endif
start:
	@deno run -A mod.ts
```

---

## Terminology

| Term                     | Meaning                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| **Scheme**               | URI scheme component (e.g., `mutable`, `hash`, `link`)             |
| **Program**              | `scheme://hostname` pair defining behavioral constraints           |
| **Substrate**            | Synonym for program, emphasizing the low-level data layer          |
| **Resource**             | Data stored at a URI path within a program                         |
| **Envelope**             | Message with `{ auth?, payload: { inputs, outputs } }` structure   |
| **Protocol**             | System built on B3nd (e.g., Firecat) — defines programs and rules  |
| **DePIN**                | Decentralized Physical Infrastructure Network                      |

Usage: "program" for `scheme://hostname`. "Protocol" for systems built on B3nd
(like Firecat). "Envelope" for `{ auth?, payload: { inputs, outputs } }` messages.

---

## Tools & Infrastructure

### MCP Tools (Claude Plugin)

| Tool                   | Description                  |
| ---------------------- | ---------------------------- |
| `b3nd_receive`         | Submit message `[uri, data]` |
| `b3nd_read`            | Read data from URI           |
| `b3nd_list`            | List items at URI prefix     |
| `b3nd_delete`          | Delete data                  |
| `b3nd_health`          | Backend health check         |
| `b3nd_schema`          | Get available programs       |
| `b3nd_backends_list`   | List configured backends     |
| `b3nd_backends_switch` | Switch active backend        |
| `b3nd_backends_add`    | Add new backend              |

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
- `libs/b3nd-hash/` — Content-addressed storage utilities
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

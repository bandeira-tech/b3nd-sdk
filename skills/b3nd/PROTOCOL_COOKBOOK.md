# Designing Protocols

Recipes and worked examples for building DePIN protocols on B3nd. Each section
is self-contained — jump to what you need.

For reference material on the B3nd framework, message primitives, schema
dispatch, and auth primitives, see [FRAMEWORK.md](./FRAMEWORK.md).

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

const client = new MemoryClient();
const app = new Hono();
const frontend = servers.httpServer(app);
createServerNode({ frontend, client }).listen(9942);
```

**App usage:**

```typescript
const client = new HttpClient({ url: "http://localhost:9942" });
await client.receive([["mutable://open/notes/1", {}, { text: "Hello world" }]]);
const result = await client.read("mutable://open/notes/1");
```

This is the "Hello World" of B3nd protocols. Useful for prototyping and local
development. Not suitable for production — anyone can overwrite anything.

---

### Auth-Based Protocol

Users own namespaces by pubkey. Only the holder of a private key can write to
URIs under their pubkey. Uses `createPubkeyBasedAccess()` and `authValidation()`
from the auth module.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { authValidation, createPubkeyBasedAccess } from "@bandeira-tech/b3nd-sdk/auth";

const schema: Schema = {
  "mutable://open": async () => ({ valid: true }),

  "mutable://accounts": async ([uri, value], _upstream, _read) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator([uri, value]);
    return {
      valid: isValid,
      error: isValid ? undefined : "Signature verification failed",
    };
  },

  "immutable://accounts": async ([uri, value], _upstream, read) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator([uri, value]);
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

---

### Content-Addressed Protocol

Immutable content stored by hash, with mutable link pointers. Uses
`hashValidator()` for write-once, hash-verified storage and `link://` for
named references.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

const schema: Schema = {
  "hash://sha256": hashValidator(),

  "link://open": async ([_uri, value]) => {
    if (typeof value !== "string" || !value.startsWith("hash://")) {
      return { valid: false, error: "Link must point to a hash URI" };
    }
    return { valid: true };
  },

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
```

---

### Fee Collection Protocol

Cross-output fee validation. Every data write must include a fee output
proportional to data size. Inner output validators receive the envelope as
`upstream`, enabling cross-output inspection via `upstream[1].payload.outputs`.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "immutable://open": async ([_uri, value], upstream) => {
    if (!value) return { valid: false, error: "Value required" };
    if (!upstream) return { valid: true }; // plain write, no fee check

    const outputs = upstream[1].payload.outputs;
    const feeOutput = outputs.find(([uri]: [string, unknown]) => uri.startsWith("fees://"));
    if (!feeOutput) return { valid: false, error: "Fee required" };

    const dataSize = JSON.stringify(value).length;
    const requiredFee = Math.ceil(dataSize / 100);
    if ((feeOutput[1] as number) < requiredFee) {
      return { valid: false, error: `Insufficient fee: need ${requiredFee}` };
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
  payload: {
    inputs: [],
    outputs: [
      ["immutable://open/post/123", { title: "Hello", body: "World..." }],
      ["fees://pool", 1],
    ],
  },
}, client);
```

---

### UTXO / Conservation Protocol

Inputs must cover outputs. The envelope validator checks conservation
using `upstream` to access sibling outputs and `read` for input balances.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "utxo://alice": async ([_uri, value]) => {
    if ((value as number) < 0) return { valid: false, error: "Negative amount" };
    return { valid: true };
  },
  "utxo://bob": async ([_uri, value]) => {
    if ((value as number) < 0) return { valid: false, error: "Negative amount" };
    return { valid: true };
  },

  // The envelope validator enforces conservation
  "hash://sha256": async ([_uri, data], _upstream, read) => {
    if (!data?.payload) return { valid: true }; // non-envelope hash

    let inputSum = 0;
    for (const inputUri of data.payload.inputs) {
      const input = await read<{ amount: number }>(inputUri);
      if (input.success && input.record) inputSum += input.record.data.amount;
    }

    const outputSum = data.payload.outputs.reduce(
      (sum: number, [, value]: [string, unknown]) => sum + (value as number), 0,
    );

    if (outputSum > inputSum) {
      return { valid: false, error: "Outputs exceed inputs" };
    }
    return { valid: true };
  },
};
```

**App usage — transfer 50 from Alice to Bob:**

```typescript
await send({
  payload: {
    inputs: ["utxo://alice/1"],
    outputs: [
      ["utxo://bob/1", 50],
      ["utxo://alice/2", 50],
    ],
  },
}, client);
```

---

### Hash-Chain Retelling

Each message references the hash of the previous message, creating an ordered,
tamper-evident chain. Useful for audit trails, usage history, and provenance
tracking.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

const schema: Schema = {
  "hash://sha256": hashValidator(),

  "link://open": async ([_uri, value], _upstream, read) => {
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
    inputs: [uri1],
    outputs: [
      [uri2, entry2],
      ["link://open/chain/head", uri2],
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

---

### Consensus Chain

Complete user → validator → confirmer flow. Recursive envelopes with auth at
each layer.

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";
import { authValidation, createPubkeyBasedAccess } from "@bandeira-tech/b3nd-sdk/auth";

const TRUSTED_VALIDATORS = ["validator_pubkey_1", "validator_pubkey_2"];
const TRUSTED_CONFIRMERS = ["confirmer_pubkey_1"];

const schema: Schema = {
  "hash://sha256": hashValidator(),

  "mutable://accounts": async ([uri, value]) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator([uri, value]);
    return { valid: isValid, error: isValid ? undefined : "Auth failed" };
  },

  "link://accounts": async ([uri, value], _upstream, read) => {
    const pubkey = uri.split("/")[3];
    if (!TRUSTED_VALIDATORS.includes(pubkey) && !TRUSTED_CONFIRMERS.includes(pubkey)) {
      return { valid: false, error: "Not a trusted validator or confirmer" };
    }

    if (typeof value !== "string" || !value.startsWith("hash://sha256/")) {
      return { valid: false, error: "Must reference a hash URI" };
    }

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
const signed = await encrypt.createAuthenticatedMessageWithHex(
  { title: "My Post", body: "Content here" },
  userKeys.publicKeyHex, userKeys.privateKeyHex,
);

const userResult = await send({
  auth: [{ pubkey: userKeys.publicKeyHex, signature: "..." }],
  payload: {
    inputs: [],
    outputs: [[`mutable://accounts/${userKeys.publicKeyHex}/posts/1`, signed]],
  },
}, client);

// 2. Validator endorses
const validatorResult = await send({
  auth: [{ pubkey: "validator_pubkey_1", signature: "..." }],
  payload: {
    inputs: [userResult.uri],
    outputs: [
      [`link://accounts/validator_pubkey_1/validations/${userResult.uri}`, userResult.uri],
    ],
  },
}, client);

// 3. Confirmer finalizes
await send({
  auth: [{ pubkey: "confirmer_pubkey_1", signature: "..." }],
  payload: {
    inputs: [validatorResult.uri],
    outputs: [
      [`link://accounts/confirmer_pubkey_1/confirmed/${userResult.uri}`, validatorResult.uri],
    ],
  },
}, client);
```

---

## Running Your Protocol's Node

After defining your protocol's schema, you need to run a node that validates
messages against it.

### Schema Module Pattern

Export your schema as a module so it can be imported by the node and by tests:

```typescript
// schema.ts
import type { Schema } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "mutable://open": async ([_uri, value]) => {
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

const client = new MemoryClient();
const app = new Hono();
const frontend = servers.httpServer(app);
const node = createServerNode({ frontend, client });
node.listen(43100);
```

### Multi-Backend Composition

```typescript
const clients = [
  new MemoryClient(),
  new PostgresClient({ connection, tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000 }),
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
  tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000,
}, executor);
await pg.initializeSchema();

// MongoDB
const mongo = new MongoClient({
  connectionString: "mongodb://localhost:27017/mydb",
  collectionName: "b3nd_data",
}, executor);
```

---

## Packaging a Protocol SDK

Once your protocol's schema is stable, wrap it into a protocol-specific package
so app developers don't need to understand B3nd internals.

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
  "link://open": async ([_uri, value]) => {
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

**How Firecat does it:** Firecat's schema module exports the canonical 8-program
schema. The `@bandeira-tech/b3nd-web` and `@bandeira-tech/b3nd-sdk` packages
provide the transport layer. Together they form the Firecat SDK that app
developers consume — without knowing they're using B3nd underneath.

# b3nd-rig

The universal harness for b3nd. Single import, convention over configuration.

## Quick Start

```typescript
import { Identity, Rig } from "@b3nd/rig";

// Create an identity (deterministic from seed, or generate fresh)
const id = await Identity.fromSeed("my-secret");

// Connect to a node
const rig = await Rig.init({
  identity: id,
  use: "https://node.b3nd.net",
});

// Send (auto-signs with identity)
await rig.send({
  inputs: [],
  outputs: [["mutable://myapp/config", { theme: "dark" }]],
});

// Read
const result = await rig.read("mutable://myapp/config");
```

## What It Does

The rig eliminates manual wiring. Before:

```typescript
// without rig — 15 lines of setup
const pgClient = new PostgresClient({
  connection,
  schema,
  tablePrefix,
  poolSize,
  connectionTimeout,
}, executor);
await pgClient.initializeSchema();
const httpClient = new HttpClient({ url: replicaUrl });
const write = parallelBroadcast([pgClient, httpClient]);
const read = firstMatchSequence([pgClient, httpClient]);
const client = createValidatedClient({
  write,
  read,
  validate: msgSchema(schema),
});
const identity = await IdentityKey.fromPem(pem, pubkey);
const signature = await identity.sign(payload);
const msg = { auth: [{ pubkey, signature }], payload };
await send(msg, client);
```

After:

```typescript
// with rig — 4 lines
const rig = await Rig.init({
  use: ["postgresql://localhost/b3nd", "https://replica.b3nd.net"],
  schema,
  executors: { postgres: createPostgresExecutor },
});
rig.identity = await Identity.fromPem(pem, pubkey);
await rig.send({ inputs: [], outputs: [["mutable://app/key", value]] });
```

## `use` — URL to Client Mapping

Every URL string in `use` becomes a typed client:

| URL Protocol           | Client                                           |
| ---------------------- | ------------------------------------------------ |
| `https://` / `http://` | `HttpClient`                                     |
| `wss://` / `ws://`     | `WebSocketClient`                                |
| `memory://`            | `MemoryClient`                                   |
| `postgresql://`        | `PostgresClient` (requires `executors.postgres`) |
| `mongodb://`           | `MongoClient` (requires `executors.mongo`)       |

Multiple URLs = `parallelBroadcast` for writes, `firstMatchSequence` for reads.
Single URL = direct pass-through.

## Identity

Bundles Ed25519 signing + X25519 encryption into one object.

```typescript
// Fresh random
const id = await Identity.generate();

// Deterministic from seed (same seed = same keys)
const id = await Identity.fromSeed("passphrase-or-secret");

// From PEM (server keys)
const id = await Identity.fromPem(signingPem, pubkeyHex, encPrivKeyHex?, encPubKeyHex?);

// Public-only (for addressing others — cannot sign)
const peer = Identity.publicOnly({ signing: "ab12...", encryption: "cd34..." });

id.pubkey;              // Ed25519 public key hex
id.encryptionPubkey;    // X25519 public key hex
id.canSign;             // true if private keys available

await id.sign(payload);                        // { pubkey, signature }
await id.verify(payload, signature);           // boolean
await id.encrypt(data, recipientPubkey);       // EncryptedPayload
await id.decrypt(encryptedPayload);            // Uint8Array
await id.signMessage(payload);                 // AuthenticatedMessage
id.signer;                                     // { privateKey, publicKeyHex }
```

Identity is **swappable** on the rig at any time:

```typescript
rig.identity = alice; // sign as alice
rig.identity = bob; // now sign as bob
rig.identity = null; // read-only mode (send() throws)
```

## API

### Send (outbound)

```typescript
// Auto-signed MessageData envelope (most common)
await rig.send({ inputs: [...], outputs: [[uri, value]] });
```

Signs with the current identity, hashes the envelope, and broadcasts to all
backends.

### Receive (inbound)

```typescript
// Validate → store
await rig.receive(uri, data);
```

Passes data through schema validation (if configured), then stores in all
backends. This is the counterpart to `send()`.

### Read

```typescript
await rig.read<T>(uri);                    // ReadResult<T>
await rig.readMany<T>([uri1, uri2]);       // ReadMultiResult<T>
await rig.list(uri, options?);             // ListResult
```

### Other

```typescript
await rig.delete(uri);
await rig.health();
await rig.getSchema();
await rig.cleanup();
rig.client; // escape hatch: raw NodeProtocolInterface
```

### HTTP Server (separate layer)

The rig is the "brain" — it doesn't serve HTTP. The HTTP server is a separate
media/transport layer:

```typescript
import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { servers } from "@bandeira-tech/b3nd-sdk";

const app = new Hono();
app.use("*", cors({ origin: "*" }));

const frontend = servers.httpServer(app, { healthMeta: { version: "1.0" } });
frontend.configure({ client: rig.client });
frontend.listen(3000);
```

## Examples

### Client app connecting to a remote node

```typescript
const rig = await Rig.init({ use: "https://testnet.fire.cat" });
const items = await rig.list("mutable://open/posts");
```

### Server node with PostgreSQL

```typescript
const rig = await Rig.init({
  use: "postgresql://user:pass@localhost/b3nd",
  schema: mySchema,
  executors: { postgres: createPostgresExecutor },
});

// Wire HTTP separately
const app = new Hono();
const frontend = servers.httpServer(app);
frontend.configure({ client: rig.client });
frontend.listen(3000);
```

### Multi-backend with replication

```typescript
const rig = await Rig.init({
  use: ["postgresql://localhost/b3nd", "https://replica.b3nd.net"],
  schema: mySchema,
  executors: { postgres: createPostgresExecutor },
});
// Writes go to both, reads try local first then replica
```

### Pre-built client (escape hatch)

```typescript
const myClient = new MemoryClient({ schema });
const rig = await Rig.init({ client: myClient });
```

# b3nd-rig

The universal harness for b3nd. One import, convention over configuration.

## Quick Start

```typescript
import { Identity, Rig } from "@b3nd/rig";

const id = await Identity.fromSeed("my-secret");
const rig = await Rig.connect("https://node.b3nd.net", id);

await rig.send({
  inputs: [],
  outputs: [["mutable://myapp/config", { theme: "dark" }]],
});

const data = await rig.readData("mutable://myapp/config");
```

## Two Core Actions

The rig has two core actions. Everything else is observation.

- **`send()`** — outward: builds a signed envelope, content-addresses it, sends
  to network
- **`receive()`** — inward: accepts a raw message `[uri, data]` from an external
  source

```typescript
// Send a signed envelope (auto-signs with identity, content-addressed)
await rig.send({ inputs: [], outputs: [["mutable://app/key", value]] });

// Receive a raw message from an external source
await rig.receive(["mutable://open/external", { source: "webhook" }]);
```

## Observation

```typescript
await rig.read<T>(uri);                    // ReadResult<T>
await rig.readData<T>(uri);                // T | null (unwrapped)
await rig.readOrThrow<T>(uri);             // T (throws if missing)
await rig.readMany<T>([uri1, uri2]);       // ReadMultiResult<T>
await rig.readDataMany<T>(uris);           // Map<string, T>
await rig.readAll<T>(prefix);              // Map<string, T> (list + read)

await rig.list(uri, options?);             // ListResult
await rig.listData(uri, options?);         // string[] (URIs only)
await rig.count(uri);                      // number

await rig.exists(uri);                     // boolean

await rig.delete(uri);                     // DeleteResult
await rig.deleteMany(uris);               // DeleteResult[]
await rig.deleteAll(prefix);              // DeleteResult[]
```

## Encrypted Operations

```typescript
// Send with encrypted outputs (encrypt to self or a recipient)
await rig.sendEncrypted({ inputs: [], outputs: [[uri, secret]] });
await rig.sendEncrypted(
  { inputs: [], outputs: [[uri, secret]] },
  recipientPubkey,
);

// Read and decrypt
const secret = await rig.readEncrypted<T>(uri);
const [a, b] = await rig.readEncryptedMany<T>([uri1, uri2]);
```

## Reactive

```typescript
// Watch a URI for changes (polling with dedup)
for await (const value of rig.watch<T>(uri, { intervalMs: 2000, signal })) {
  console.log("Changed:", value);
}

// Watch a collection (added/removed/changed diffs)
for await (
  const snap of rig.watchAll<T>(prefix, { intervalMs: 2000, signal })
) {
  console.log(
    `${snap.items.size} items, +${snap.added.length} -${snap.removed.length}`,
  );
}

// Callback style
const unsub = rig.subscribe<T>(uri, (value) => render(value));
unsub(); // stop
```

## Client Filtering

Clients declare what URIs they accept per-operation. The rig routes
automatically.

```typescript
import { Rig, withFilter } from "@b3nd/rig";

const rig = await Rig.init({
  clients: [
    // Read-only cache (tried first for reads)
    withFilter(redisClient, {
      read: ["mutable://accounts/:key/*", "hash://sha256/*"],
    }),

    // Primary storage (reads + writes)
    withFilter(postgresClient, {
      receive: ["mutable://*", "immutable://*", "hash://*", "link://*"],
      read: ["mutable://*", "immutable://*", "hash://*", "link://*"],
      list: ["mutable://*", "immutable://*"],
      delete: ["mutable://*"],
    }),

    // Local-only (never leaves the device)
    withFilter(memoryClient, {
      receive: ["local://*", "rig://*"],
      read: ["local://*", "rig://*"],
    }),
  ],
});
```

Writes broadcast to all accepting clients. Reads try accepting clients in order
(first success wins — put cache before primary). Unfiltered clients accept
everything (backwards compat).

Patterns use the same Express-style matching as observe: `:param` captures a
segment, `*` matches the rest.

## Hooks

Hooks are synchronous pipelines that run inside operations. Frozen after init.

- **Pre-hooks** run before the operation. **Throw** to reject — no silent drops.
- **Post-hooks** run after. They observe the result but **cannot modify it**.

```typescript
const rig = await Rig.init({
  use: "https://node.b3nd.net",
  hooks: {
    receive: { pre: [validateSchema, rateLimit] },
    read: { post: [auditRead] },
    send: { pre: [requireIdentity] },
  },
});
```

Hooks are immutable after init. Want different hooks? Create a new rig.

## Events

Events are async fire-and-forget handlers that run after operations complete.
They never block the caller. Handler errors are caught and logged.

```typescript
const rig = await Rig.init({
  use: "https://node.b3nd.net",
  on: {
    "send:success": [audit, notifyPeers],
    "receive:error": [alertOps],
    "*:success": [metrics], // wildcard — all operations
  },
});

// Runtime event registration
const unsub = rig.on("receive:success", (e) => console.log(e.uri));
unsub(); // remove

rig.off("receive:success", handler); // remove by reference
```

Event names: `send:success`, `send:error`, `receive:success`, `receive:error`,
`read:success`, `read:error`, `list:success`, `list:error`, `delete:success`,
`delete:error`, `*:success`, `*:error`.

## Observe

URI-pattern reactions that fire on successful writes (send or receive).

```typescript
const rig = await Rig.init({
  use: "memory://",
  observe: {
    "mutable://app/users/:id": (uri, data, { id }) => {
      console.log(`User ${id} updated`);
    },
    "hash://sha256/*": (uri, data) => {
      console.log("New content stored");
    },
  },
});

// Runtime registration
const unsub = rig.observe(
  "mutable://app/posts/:slug",
  (uri, data, { slug }) => {
    rebuildIndex(slug);
  },
);
unsub(); // remove
```

## Identity

Ed25519 signing + X25519 encryption in one object.

```typescript
const id = await Identity.generate();                        // random
const id = await Identity.fromSeed("passphrase");            // deterministic
const id = await Identity.fromPem(pem, pubkey, encPriv?, encPub?); // from keys
const peer = Identity.publicOnly({ signing: "ab12...", encryption: "cd34..." });

id.pubkey;            // Ed25519 public key hex
id.encryptionPubkey;  // X25519 public key hex
id.canSign;           // true if private keys available
id.canEncrypt;        // true if encryption keys available

await id.sign(payload);                   // { pubkey, signature }
await id.verify(payload, signature);      // boolean
await id.encrypt(data, recipientPubkey);  // EncryptedPayload
await id.decrypt(encryptedPayload);       // Uint8Array
await id.signMessage(payload);            // AuthenticatedMessage
```

Identity is swappable:

```typescript
rig.identity = alice; // sign as alice
rig.identity = bob; // now sign as bob
rig.identity = null; // read-only mode (send() throws)
```

## Inspection

```typescript
rig.info();
// {
//   pubkey: "ab12...",
//   encryptionPubkey: "cd34...",
//   canSign: true,
//   canEncrypt: true,
//   hasIdentity: true,
//   behavior: {
//     hooks: { receive: { pre: 2, post: 0 }, read: { pre: 0, post: 1 } },
//     events: { "receive:success": 1, "*:error": 1 },
//     observers: 3,
//   },
// }

await rig.health(); // HealthStatus
await rig.getSchema(); // string[] (protocol keys)
```

## Initialization

```typescript
// One-liner
const rig = await Rig.connect("https://node.b3nd.net");
const rig = await Rig.connect("https://node.b3nd.net", identity);

// Full config
const rig = await Rig.init({
  use: "https://node.b3nd.net",            // URL(s) → clients
  identity,                                 // optional
  schema,                                   // optional validation
  executors: { postgres: factory },         // for DB backends
  hooks: { ... },                           // frozen after init
  on: { ... },                              // event handlers
  observe: { ... },                         // URI pattern reactions
  clients: [ ... ],                         // filtered client array
});
```

### URL Protocol Mapping

| URL Protocol           | Client            | Notes                         |
| ---------------------- | ----------------- | ----------------------------- |
| `https://` / `http://` | `HttpClient`      |                               |
| `wss://` / `ws://`     | `WebSocketClient` |                               |
| `memory://`            | `MemoryClient`    |                               |
| `postgresql://`        | `PostgresClient`  | Requires `executors.postgres` |
| `mongodb://`           | `MongoClient`     | Requires `executors.mongo`    |
| `sqlite://`            | `SqliteClient`    | Requires `executors.sqlite`   |
| `file://`              | `FsClient`        | Requires `executors.fs`       |
| `ipfs://`              | `IpfsClient`      | Requires `executors.ipfs`     |

## HTTP Handler

```typescript
const handler = await rig.handler({ healthMeta: { version: "1.0" } });
Deno.serve({ port: 3000 }, handler);
```

Returns a standard `(Request) => Promise<Response>` with all b3nd API routes.
Framework-agnostic — plug into Deno.serve, Hono, Express, Cloudflare Workers.

## NodeProtocolInterface

The Rig structurally satisfies `NodeProtocolInterface`. Pass it directly to any
function that expects a client — hooks, events, and observe fire for every
operation.

```typescript
// These all work — the rig IS a client
respondTo(handler, { identity, client: rig });
connect(rig, { prefix, processor });
createHandler(rig, config);
loadConfig(rig, operatorKey, nodeId);
```

## Cleanup

```typescript
// Cleanup all client resources
await rig.cleanup();

// Drain pending events (returns array of in-flight promises)
const pending = rig.drain();
await Promise.allSettled(pending);
```

## Batch Operations

```typescript
// Send multiple envelopes in sequence
const results = await rig.sendMany([
  { inputs: [], outputs: [["mutable://app/a", 1]] },
  { inputs: [], outputs: [["mutable://app/b", 2]] },
]);
```

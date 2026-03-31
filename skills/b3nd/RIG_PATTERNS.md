# Rig Patterns — A Visual Guide

A scrollable catalog of rig setups. Each card shows a situation you'll encounter while building with b3nd, a minimal description of why, and the rig config that solves it.

Cards are grouped by theme. Start anywhere.

---

## Getting Connected

### Connect to a remote node

You have a running b3nd node and just want to talk to it.

```typescript
const rig = await Rig.init({ url: "https://my-node.example.com" });

const result = await rig.read("mutable://open/app/status");
```

---

### Connect to a local in-memory backend

Tests, prototypes, offline-first apps — no network needed.

```typescript
const rig = await Rig.init({ url: "memory://" });

await rig.receive(["mutable://open/test/hello", { msg: "works" }]);
const data = await rig.readData("mutable://open/test/hello");
// { msg: "works" }
```

---

### Connect with identity

Signed writes require an identity. The rig is identity-free — identity drives authenticated operations via `identity.rig(rig)`.

```typescript
const id = await Identity.fromSeed("alice-secret-seed-phrase");
const rig = await Rig.init({ url: "https://node.example.com" });
const session = id.rig(rig);

await session.send({
  inputs: [],
  outputs: [["mutable://accounts/" + id.pubkey + "/app/profile", { name: "Alice" }]],
});
```

---

### Generate a fresh identity

For new users — random keypair, export for storage.

```typescript
const id = await Identity.generate();

console.log(id.pubkey);           // Ed25519 public key hex
console.log(id.encryptionPubkey); // X25519 public key hex

// Export for localStorage / secure storage
const exported = await id.export();
localStorage.setItem("identity", JSON.stringify(exported));

// Later: restore and create a session
const restored = await Identity.fromExport(
  JSON.parse(localStorage.getItem("identity")!),
);
const rig = await Rig.init({ url: "https://node.example.com" });
const session = restored.rig(rig);
```

---

### Build a client from a database URL

Server-side — build a database client with `createClientFromUrl`, then hand it to the rig. Clients are plumbing; the rig orchestrates.

```typescript
import { Rig, createClientFromUrl } from "@b3nd/rig";
import { Pool } from "pg";

const client = await createClientFromUrl("postgresql://localhost:5432/mydb", {
  executors: {
    postgres: async (connStr) => {
      const pool = new Pool({ connectionString: connStr });
      return {
        query: (sql, args) =>
          pool.query(sql, args).then((r) => ({
            rows: r.rows,
            rowCount: r.rowCount,
          })),
        transaction: async (fn) => {
          const c = await pool.connect();
          /* ... */
        },
        cleanup: () => pool.end(),
      };
    },
  },
});

const rig = await Rig.init({ client, schema: appSchema });
```

---

### URL vs Client

`url` is the one-liner — Rig builds a client internally. `client` is the explicit path for when you build clients yourself.

```typescript
// One-liner — builds HttpClient or MemoryClient for you
const rig = await Rig.init({ url: "https://node.example.com" });

// Explicit — you bring the client
const client = new HttpClient({ url: "https://node.example.com" });
const rig = await Rig.init({ client, schema: mySchema });
```

---

## Reading and Writing

### Basic CRUD

The four operations map directly to rig methods.

```typescript
// Write
await rig.receive(["mutable://open/app/pages/home", { title: "Home", body: "Welcome" }]);

// Read (full result)
const result = await rig.read("mutable://open/app/pages/home");
if (result.success) console.log(result.record?.data);

// Read (just the data)
const page = await rig.readData("mutable://open/app/pages/home");

// List
const uris = await rig.listData("mutable://open/app/pages");

// Delete
await rig.delete("mutable://open/app/pages/home");
```

---

### Read with error handling

`readData` returns `null` on miss. `readOrThrow` throws.

```typescript
// Safe — returns null if missing
const config = await rig.readData<AppConfig>("mutable://open/app/config");
if (!config) {
  await rig.receive(["mutable://open/app/config", defaultConfig]);
}

// Strict — throws if missing (use for required data)
const required = await rig.readOrThrow<AppConfig>("mutable://open/app/config");
```

---

### Check existence without reading

```typescript
if (await rig.exists("mutable://open/app/users/alice")) {
  // user is registered
}
```

---

### Batch read

Read multiple URIs in parallel. The map omits misses.

```typescript
const data = await rig.readDataMany<UserProfile>([
  "mutable://open/app/users/alice",
  "mutable://open/app/users/bob",
  "mutable://open/app/users/charlie",
]);

for (const [uri, profile] of data) {
  console.log(uri, profile.name);
}
```

---

### Read all items under a prefix

List + batch read in one call.

```typescript
const allUsers = await rig.readAll<UserProfile>("mutable://open/app/users");
// Map<string, UserProfile>

for (const [uri, user] of allUsers) {
  console.log(user.name);
}
```

---

### Count items

```typescript
const total = await rig.count("mutable://open/app/posts");
console.log(`${total} posts`);
```

---

### Batch delete

```typescript
const results = await rig.deleteMany([
  "mutable://open/app/temp/a",
  "mutable://open/app/temp/b",
  "mutable://open/app/temp/c",
]);
// Array of DeleteResult — one per URI
```

---

### Signed envelope (send)

`session.send()` wraps outputs in a content-addressed, signed envelope. This is how you write to `accounts://` programs or any schema that requires identity. The identity signs; the rig delivers.

```typescript
const id = await Identity.fromSeed("alice-secret");
const rig = await Rig.init({ url: "https://node.example.com" });
const session = id.rig(rig);

await session.send({
  inputs: ["mutable://accounts/" + id.pubkey + "/app/balance"],
  outputs: [
    ["mutable://accounts/" + id.pubkey + "/app/balance", { amount: 100 }],
    ["mutable://accounts/" + id.pubkey + "/app/tx/001", { type: "deposit", amount: 100 }],
  ],
});
```

---

## Schema — Application-Level Validation

### Schema is a rig concern

The schema defines which URI programs your application accepts. It lives on the rig — the application layer — not on clients. Clients are pure plumbing that store and retrieve data without opinions.

```typescript
import { Rig } from "@b3nd/rig";
import { MemoryClient } from "@b3nd/client-memory";

const schema = {
  "mutable://open": async () => ({ valid: true }),
  "mutable://accounts": async (data) => {
    if (!data.amount) return { valid: false, error: "missing amount" };
    return { valid: true };
  },
};

// Schema on the rig — client has no schema
const client = new MemoryClient();
const rig = await Rig.init({ client, schema });

// Succeeds — mutable://open is in the schema
await rig.receive(["mutable://open/app/hello", { msg: "hi" }]);

// Rejected — unknown://foo is not in the schema
await rig.receive(["unknown://foo", { v: 1 }]);
// → error: no validator for program "unknown://foo"
```

---

### Schema with URL

Pass `schema` alongside `url` — Rig builds the client and wires validation.

```typescript
// No schema validation
const simple = await Rig.init({ url: "memory://" });

// With schema validation
const validated = await Rig.init({ url: "memory://", schema: mySchema });
```

---

### Schema + hooks = defense in depth

Schema validates URI programs. Hooks validate data shapes. Together they form a layered security model.

```typescript
const rig = await Rig.init({
  client,
  schema: appSchema,
  hooks: {
    beforeReceive: (ctx) => {
      const data = ctx.data as Record<string, unknown>;
      if (!data.title || typeof data.title !== "string") {
        throw new Error("missing title");
      }
    },
  },
});

// Must pass BOTH schema (known URI program) AND hook (valid shape)
await rig.receive(["mutable://open/app/post", { title: "Hello" }]); // ok
await rig.receive(["mutable://open/app/post", { oops: true }]);     // hook rejects
await rig.receive(["unknown://app/post", { title: "Hello" }]);      // schema rejects
```

---

## Encrypted Data

### Encrypt to self

Store secrets only you can decrypt. The identity's X25519 key is used automatically.

```typescript
const id = await Identity.generate();
const rig = await Rig.init({ url: "memory://" });
const session = id.rig(rig);

await session.sendEncrypted({
  inputs: [],
  outputs: [
    ["mutable://accounts/" + id.pubkey + "/secrets", { apiKey: "sk-abc123" }],
  ],
});

const secrets = await session.readEncrypted<{ apiKey: string }>(
  "mutable://accounts/" + id.pubkey + "/secrets",
);
console.log(secrets?.apiKey); // "sk-abc123"
```

---

### Encrypt to another party

Send a message only the recipient can read.

```typescript
const alice = await Identity.generate();
const bob = await Identity.generate();

const rig = await Rig.init({ url: "memory://" });
const aliceSession = alice.rig(rig);

// Alice encrypts to Bob's encryption public key
await aliceSession.sendEncrypted(
  {
    inputs: [],
    outputs: [
      ["mutable://inbox/" + bob.pubkey + "/msg/001", { text: "Hello Bob" }],
    ],
  },
  bob.encryptionPubkey,
);

// Bob decrypts (same rig, different identity session)
const bobSession = bob.rig(rig);
const msg = await bobSession.readEncrypted<{ text: string }>(
  "mutable://inbox/" + bob.pubkey + "/msg/001",
);
```

---

### Batch decrypt

```typescript
const session = id.rig(rig);
const [secretA, secretB] = await session.readEncryptedMany<{ key: string }>([
  "mutable://accounts/" + id.pubkey + "/secrets/a",
  "mutable://accounts/" + id.pubkey + "/secrets/b",
]);
```

---

## Hooks — Flat, Typed, Single-Function

Hooks are frozen at init. Before-hooks throw to reject. After-hooks observe only. One function per slot — compose on your end if needed.

### Validate on receive

Reject writes that don't match your app's shape.

```typescript
const rig = await Rig.init({
  client,
  hooks: {
    beforeReceive: (ctx) => {
      const data = ctx.data as Record<string, unknown>;
      if (!data.title || typeof data.title !== "string") {
        throw new Error("receive rejected: missing title");
      }
    },
  },
});

// This succeeds
await rig.receive(["mutable://open/app/post", { title: "Hello" }]);

// This throws: "receive rejected: missing title"
await rig.receive(["mutable://open/app/post", { oops: true }]);
```

---

### Rate-limit writes

A before-hook that enforces a cooldown.

```typescript
let lastWrite = 0;
const COOLDOWN_MS = 1000;

const rig = await Rig.init({
  client,
  hooks: {
    beforeReceive: () => {
      const now = Date.now();
      if (now - lastWrite < COOLDOWN_MS) {
        throw new Error("rate limit: too many writes");
      }
      lastWrite = now;
    },
  },
});
```

---

### Audit trail on reads

After-hooks can't modify the result, but they can observe it.

```typescript
const auditLog: Array<{ uri: string; ts: number }> = [];

const rig = await Rig.init({
  client,
  hooks: {
    afterRead: (ctx, _result) => {
      auditLog.push({ uri: ctx.uri, ts: Date.now() });
    },
  },
});
```

---

### Restrict deletes to admin URIs

```typescript
const rig = await Rig.init({
  client,
  hooks: {
    beforeDelete: (ctx) => {
      if (!ctx.uri.includes("/admin/")) {
        throw new Error("only admin URIs can be deleted");
      }
    },
  },
});
```

---

### Rewrite a URI in a before-hook

Before-hooks can return `{ ctx }` to replace the context — useful for URI rewriting, normalization, or aliasing.

```typescript
const rig = await Rig.init({
  client,
  hooks: {
    beforeRead: (ctx) => {
      // Redirect alias to canonical URI
      if (ctx.uri === "mutable://open/app/latest") {
        return { ctx: { uri: "mutable://open/app/v2/current" } };
      }
    },
  },
});
```

---

### Compose multiple checks in one hook

The rig takes one function per hook slot. If you need multiple checks, compose them yourself.

```typescript
function composeChecks(...fns: Array<(ctx: SendCtx) => void>): BeforeHook<SendCtx> {
  return (ctx) => {
    for (const fn of fns) fn(ctx);
  };
}

const rig = await Rig.init({
  client,
  hooks: {
    beforeSend: composeChecks(
      (ctx) => { /* 1. check identity */ },
      (ctx) => { /* 2. check envelope size */ },
      (ctx) => { /* 3. check URI namespace */ },
    ),
  },
});
```

---

### Why hooks are frozen

Hooks cannot be added at runtime. This is intentional — your security invariants don't change after boot. If you need different hooks, create a new rig.

```typescript
// Build-time:
const prodRig = await Rig.init({ client: prodClient, hooks: prodHooks });
const testRig = await Rig.init({ client: new MemoryClient(), hooks: testHooks });

// Runtime: rig.hook() does NOT exist — hooks are sealed.
```

---

### The hook slots

Each operation has a typed before/after pair. No `ctx.op` check needed — the type tells you which operation you're in.

| Slot | Context Type | Fields |
| --- | --- | --- |
| `beforeSend` / `afterSend` | `SendCtx` | `envelope`, `identity` |
| `beforeReceive` / `afterReceive` | `ReceiveCtx` | `uri`, `data` |
| `beforeRead` / `afterRead` | `ReadCtx` | `uri` |
| `beforeList` / `afterList` | `ListCtx` | `uri`, `options?` |
| `beforeDelete` / `afterDelete` | `DeleteCtx` | `uri` |

---

## Events — Async Fire-and-Forget

Events never block the caller. They fire after an operation completes.

### Log every operation

```typescript
const rig = await Rig.init({
  client,
  on: {
    "*:success": [(e) => console.log(`[ok] ${e.op} ${e.uri}`)],
    "*:error": [(e) => console.error(`[err] ${e.op} ${e.uri}: ${e.error}`)],
  },
});
```

---

### Track metrics

```typescript
const metrics = { reads: 0, writes: 0, errors: 0 };

const rig = await Rig.init({
  client,
  on: {
    "read:success": [(e) => { metrics.reads++; }],
    "receive:success": [(e) => { metrics.writes++; }],
    "send:success": [(e) => { metrics.writes++; }],
    "*:error": [(e) => { metrics.errors++; }],
  },
});
```

---

### Add events at runtime

Unlike hooks, events can be registered and removed dynamically.

```typescript
const rig = await Rig.init({ url: "memory://" });

// Add
const unsub = rig.on("receive:success", (e) => {
  console.log(`Wrote to ${e.uri}`);
});

// Later: remove
unsub();

// Or remove by reference
const handler = (e) => { /* ... */ };
rig.on("send:success", handler);
rig.off("send:success", handler);
```

---

### Drain pending events before shutdown

Events are async — if the process exits, some handlers might not finish. `drain()` gives you their promises.

```typescript
const rig = await Rig.init({
  client,
  on: {
    "receive:success": [
      async (e) => {
        await fetch("https://webhooks.example.com", {
          method: "POST",
          body: JSON.stringify(e),
        });
      },
    ],
  },
});

await rig.receive(["mutable://open/app/x", { v: 1 }]);

// Before exit — wait for all pending event handlers
await Promise.allSettled(rig.drain());
await rig.cleanup();
```

---

## Observe — URI Pattern Reactions

Observers fire on successful writes and match against URI patterns with `:param` and `*` wildcards.

### React to user profile changes

```typescript
const rig = await Rig.init({
  client,
  observe: {
    "mutable://open/app/users/:userId/profile": (uri, data, { userId }) => {
      console.log(`User ${userId} updated their profile:`, data);
    },
  },
});

await rig.receive(["mutable://open/app/users/alice/profile", { name: "Alice" }]);
// → "User alice updated their profile: { name: 'Alice' }"
```

---

### Wildcard — observe all writes under a namespace

```typescript
const rig = await Rig.init({
  client,
  observe: {
    "mutable://open/app/*": (uri, data) => {
      console.log(`Write to ${uri}`);
    },
  },
});

await rig.receive(["mutable://open/app/pages/home", { title: "Home" }]);
// → "Write to mutable://open/app/pages/home"

await rig.receive(["mutable://open/app/config", { theme: "dark" }]);
// → "Write to mutable://open/app/config"
```

---

### Add observers at runtime

```typescript
const rig = await Rig.init({ url: "memory://" });

const unsub = rig.observe(
  "mutable://open/chat/rooms/:room/messages/:msgId",
  (uri, data, { room, msgId }) => {
    console.log(`[${room}] New message ${msgId}`);
  },
);

// Stop observing
unsub();
```

---

### Hooks vs Events vs Observe

|  | Hooks | Events | Observe |
| --- | --- | --- | --- |
| **Timing** | Before/after op | After op | After write |
| **Blocking** | Before-hooks block | Never blocks | Never blocks |
| **Can reject** | Before-hooks throw | No | No |
| **Can modify** | Before-hooks replace ctx | No | No |
| **Mutable** | Frozen at init | Add/remove anytime | Add/remove anytime |
| **Scope** | All operations | All operations | Writes only |
| **Pattern match** | No | By event name | By URI pattern |
| **Multiplicity** | One function per slot | Array of handlers | One per pattern |

---

## Client Routing

### Single backend (most common)

One URL, one client, all operations go to the same place.

```typescript
const rig = await Rig.init({ url: "https://node.example.com" });
```

---

### Filtered clients — route by URI pattern

Different URIs go to different backends. The rig inspects `accepts()` on each client and routes accordingly.

```typescript
import { Rig, subscribe } from "@b3nd/rig";
import { HttpClient } from "@b3nd/client-http";
import { MemoryClient } from "@b3nd/client-memory";

const remote = new HttpClient({ url: "https://node.example.com" });
const local = new MemoryClient();

const rig = await Rig.init({
  subscriptions: [
    subscribe(remote, {
      receive: ["mutable://*", "hash://*"],
      read: ["mutable://*", "hash://*"],
      list: ["mutable://*"],
      delete: ["mutable://*"],
    }),
    subscribe(local, {
      receive: ["local://*"],
      read: ["local://*"],
      list: ["local://*"],
      delete: ["local://*"],
    }),
  ],
});

// Goes to remote
await rig.receive(["mutable://open/app/data", { v: 1 }]);

// Goes to local
await rig.receive(["local://cache/session", { token: "abc" }]);

// Read routes the same way
const remoteData = await rig.readData("mutable://open/app/data");
const localData = await rig.readData("local://cache/session");
```

---

### How routing works

- **Writes** (receive/send): broadcast to **all** accepting clients
- **Reads** (read/list): try clients in order, return **first match**
- **No accepting client**: returns an error result (does not throw)

```typescript
// A write to mutable:// hits the remote client.
// A write to local:// hits the local client.
// A write to unknown:// has no accepting client → error.
```

---

### Multiple write targets (replication)

Writes broadcast to every client that accepts. Use this for replication.

```typescript
const primary = new HttpClient({ url: "https://primary.example.com" });
const replica = new HttpClient({ url: "https://replica.example.com" });

const rig = await Rig.init({
  subscriptions: [
    subscribe(primary, {
      receive: ["mutable://*"],
      read: ["mutable://*"],
    }),
    subscribe(replica, {
      receive: ["mutable://*"],
      // no read — replica is write-only from the rig's perspective
    }),
  ],
});

// This write goes to both primary and replica
await rig.receive(["mutable://open/app/data", { v: 1 }]);

// Reads come from primary (first client with read acceptance)
const data = await rig.readData("mutable://open/app/data");
```

---

### Unfiltered clients accept everything

A client without `accepts()` is treated as accepting all operations and URIs. This is backwards-compatible.

```typescript
const rig = await Rig.init({
  subscriptions: [
    subscribe(special, { receive: ["special://*"], read: ["special://*"] }),
    generalClient, // no filter — catches everything else
  ],
});
```

---

### Per-operation routing (subscriptions)

Explicit per-operation routing via subscriptions. Each subscription declares which operations it handles.

```typescript
const pgClient = await createClientFromUrl("postgresql://primary", {
  executors: { postgres: pgFactory },
});
const cacheClient = new MemoryClient();

const rig = await Rig.init({
  subscriptions: [
    subscribe(cacheClient, { read: ["mutable://*", "hash://*"] }),
    subscribe(pgClient, {
      receive: ["mutable://*", "immutable://*", "hash://*"],
      read: ["mutable://*", "immutable://*", "hash://*"],
      list: ["mutable://*"],
      delete: ["mutable://*"],
    }),
  ],
  schema: appSchema,
});
```

---

## Watching and Subscribing

### Watch a single URI for changes

Polling-based async generator. Yields when the value changes.

```typescript
const abort = new AbortController();

for await (const value of rig.watch<AppConfig>(
  "mutable://open/app/config",
  { intervalMs: 2000, signal: abort.signal },
)) {
  console.log("Config changed:", value);
  applyConfig(value);
}

// Stop watching
abort.abort();
```

---

### Watch a collection

Polls a prefix, reads all items, diffs against previous snapshot.

```typescript
const abort = new AbortController();

for await (const snapshot of rig.watchAll<UserProfile>(
  "mutable://open/app/users",
  { intervalMs: 3000, signal: abort.signal },
)) {
  console.log(`${snapshot.items.size} users`);
  console.log("Added:", snapshot.added);
  console.log("Removed:", snapshot.removed);
  console.log("Changed:", snapshot.changed);

  // snapshot.items is Map<string, UserProfile>
  renderUserList(snapshot.items);
}
```

---

### Subscribe to a single URI (callback style)

```typescript
const unsub = rig.subscribe<AppConfig>(
  "mutable://open/app/config",
  (value) => {
    if (value) applyConfig(value);
  },
  { intervalMs: 2000 },
);

// Later
unsub();
```

---

### Subscribe to a URI pattern

Uses SSE when the backend is HTTP, falls back to polling otherwise. Pattern syntax matches observe.

```typescript
const unsub = rig.subscribe<ChatMessage>(
  "mutable://open/chat/rooms/:room/messages/:msgId",
  (uri, data, { room, msgId }) => {
    console.log(`[${room}] ${msgId}: ${data.text}`);
  },
);

// Fires whenever a new message is written to any room
```

---

## Serving Over HTTP

### Expose the rig as an HTTP endpoint

The rig has a built-in HTTP handler. Build the client outside, hand it to the rig.

```typescript
const client = await createClientFromUrl("postgresql://localhost:5432/mydb", {
  executors: { postgres: pgFactory },
});

const rig = await Rig.init({ client, schema: appSchema });

const handler = rig.handler();

// Deno
Deno.serve({ port: 9942 }, handler);

// Bun
Bun.serve({ port: 9942, fetch: handler });
```

---

### What the handler exposes

| Route | Method | Description |
| --- | --- | --- |
| `/status` | GET | Status (health + registered programs) |
| `/receive` | POST | Write data |
| `/read?uri=...` | GET | Read a URI |
| `/list?uri=...` | GET | List URIs under prefix |
| `/delete?uri=...` | DELETE | Delete a URI |
| `/subscribe?pattern=...` | GET | SSE stream for URI patterns |

---

### Handler with hooks and events

The HTTP handler goes through the same rig pipeline — hooks, events, observe all fire.

```typescript
const rig = await Rig.init({
  client,
  schema: appSchema,
  hooks: {
    beforeReceive: validatePayload,
  },
  on: {
    "*:success": [logToStdout],
  },
  observe: {
    "mutable://open/app/*": notifyWebhook,
  },
});

// HTTP requests go through the full pipeline
Deno.serve({ port: 9942 }, rig.handler());
```

---

## The Rig as a Client

The rig satisfies `NodeProtocolInterface`. Anything that accepts a client also accepts a rig.

### Pass the rig where a client is expected

```typescript
const rig = await Rig.init({ client });

// Any function that takes NodeProtocolInterface works
function processData(client: NodeProtocolInterface) {
  return client.read("mutable://open/app/data");
}

// Pass the rig directly — no .client escape hatch
await processData(rig);
```

---

### Compose rigs

A rig can be a client inside another rig's routing table.

```typescript
const innerRig = await Rig.init({
  client: new MemoryClient(),
  hooks: { beforeReceive: validateInner },
});

const outerRig = await Rig.init({
  subscriptions: [
    subscribe(innerRig, {
      receive: ["local://*"],
      read: ["local://*"],
    }),
    subscribe(httpClient, {
      receive: ["mutable://*"],
      read: ["mutable://*"],
    }),
  ],
});

// local:// writes go through innerRig's hooks
// mutable:// writes go to the HTTP backend
```

---

## Identity Patterns

### Identity drives, rig delivers

The rig is identity-free — pure orchestration. Identity is external: you create a session with `identity.rig(rig)` for authenticated operations. Multiple identities can share the same rig.

```typescript
const rig = await Rig.init({ url: "https://node.example.com" });
const alice = await Identity.fromSeed("alice-secret");
const bob = await Identity.fromSeed("bob-secret");

// Each identity gets its own session — same rig, different signers
const aliceSession = alice.rig(rig);
const bobSession = bob.rig(rig);

await aliceSession.send({ inputs: [], outputs: [[aliceUri, data]] });
await bobSession.send({ inputs: [], outputs: [[bobUri, data]] });
```

---

### Check capabilities before acting

```typescript
const rig = await Rig.init({ url: "https://node.example.com" });
const identity = getIdentityOrNull(); // your app logic

if (identity?.canSign) {
  const session = identity.rig(rig);
  await session.send({ inputs: [], outputs: [[uri, data]] });
} else {
  // No identity — fall back to unsigned receive
  await rig.receive([uri, data]);
}

if (identity?.canEncrypt) {
  const session = identity.rig(rig);
  await session.sendEncrypted({ inputs: [], outputs: [[uri, secret]] });
}
```

---

### Inspect rig state

```typescript
const info = rig.info();

console.log(info.behavior.hooks);     // ["beforeReceive", "afterRead", ...]
console.log(info.behavior.events);    // { "send:success": 1, "*:error": 1 }
console.log(info.behavior.observers); // 3
```

---

## Full Init Examples

### Minimal app backend

A server node with schema validation, logging, and HTTP.

```typescript
const client = await createClientFromUrl("postgresql://localhost:5432/app", {
  schema: appSchema,
  executors: { postgres: pgFactory },
});

const rig = await Rig.init({
  client,
  schema: appSchema,
  on: {
    "*:success": [(e) => console.log(`[${e.op}] ${e.uri}`)],
    "*:error": [(e) => console.error(`[${e.op}] ${e.uri}: ${e.error}`)],
  },
});

Deno.serve({ port: 9942 }, rig.handler());
```

---

### Browser app with local cache + remote sync

```typescript
const remote = new HttpClient({ url: "https://node.example.com" });
const cache = new MemoryClient();

const rig = await Rig.init({
  subscriptions: [
    subscribe(remote, {
      receive: ["mutable://*", "hash://*"],
      read: ["mutable://*", "hash://*"],
    }),
    subscribe(cache, {
      receive: ["local://*"],
      read: ["local://*"],
      list: ["local://*"],
      delete: ["local://*"],
    }),
  ],
  on: {
    "receive:error": [(e) => showToast(`Write failed: ${e.error}`)],
  },
  observe: {
    "mutable://accounts/:key/app/notifications/*": (uri, data) => {
      showNotification(data);
    },
  },
});

// Identity is separate — create a session for authenticated writes
const id = await Identity.fromExport(savedIdentity);
const session = id.rig(rig);
```

---

### Multi-protocol node with hooks

A node that speaks to Postgres for mutable data and the filesystem for blobs, with validation hooks.

```typescript
const pg = await createClientFromUrl("postgresql://localhost:5432/data", {
  schema: appSchema,
  executors: { postgres: pgFactory },
});

const fs = await createClientFromUrl("file:///var/data/blobs", {
  executors: { fs: fsFactory },
});

const rig = await Rig.init({
  schema: appSchema,
  subscriptions: [
    subscribe(pg, {
      receive: ["mutable://*"],
      read: ["mutable://*"],
      list: ["mutable://*"],
      delete: ["mutable://*"],
    }),
    subscribe(fs, {
      receive: ["hash://*"],
      read: ["hash://*"],
    }),
  ],
  hooks: {
    beforeReceive: (ctx) => {
      const size = JSON.stringify(ctx.data).length;
      if (size > 1_000_000) throw new Error("payload too large");
    },
  },
  on: {
    "receive:success": [
      async (e) => {
        await fetch("https://webhooks.example.com/ingest", {
          method: "POST",
          body: JSON.stringify({ uri: e.uri, ts: e.ts }),
        });
      },
    ],
  },
});

Deno.serve({ port: 9942 }, rig.handler());
```

---

### Test rig with assertions

```typescript
import { assertEquals } from "@std/assert";

Deno.test("app write and read round-trip", async () => {
  const events: string[] = [];

  const rig = await Rig.init({ url: "memory://" });
  rig.on("receive:success", (e) => { events.push(e.uri!); });
  rig.observe(
    "mutable://open/test/:key",
    (uri, data, { key }) => { assertEquals(key, "hello"); },
  );

  await rig.receive(["mutable://open/test/hello", { msg: "world" }]);

  assertEquals(await rig.readData("mutable://open/test/hello"), {
    msg: "world",
  });
  assertEquals(events, ["mutable://open/test/hello"]);

  await Promise.allSettled(rig.drain());
  await rig.cleanup();
});
```

---

### CLI tool backed by a rig

```typescript
const rig = await Rig.init({
  url: Deno.env.get("BACKEND_URL") || "memory://",
});

// All commands use the rig
switch (command) {
  case "read":
    console.log(await rig.readData(args.uri));
    break;
  case "write":
    await rig.receive([args.uri, JSON.parse(args.data)]);
    break;
  case "list":
    console.log(await rig.listData(args.uri));
    break;
  case "health":
    console.log(await rig.status());
    break;
}

await rig.cleanup();
```

---

## Edge Cases and Gotchas

### Rig.send() requires pre-built MessageData

The rig's `send()` accepts pre-signed `MessageData` — it never signs. Use `session.send()` for the convenient sign-and-send workflow, or `rig.receive()` for unsigned writes.

```typescript
const rig = await Rig.init({ url: "memory://" });

// Unsigned write — no identity needed
await rig.receive(["mutable://open/app/x", { v: 1 }]);

// Signed write — identity drives, rig delivers
const session = id.rig(rig);
await session.send({ inputs: [], outputs: [["mutable://open/app/x", { v: 2 }]] });

// Manual signing — build MessageData yourself
const payload = { inputs: [], outputs: [["mutable://open/app/x", { v: 3 }]] };
const auth = [await id.sign(payload)];
await rig.send({ auth, payload });
```

---

### Before-hook throw vs after-hook throw

Before-hook throws prevent the operation. After-hook throws are bugs — the operation already happened.

```typescript
// Before-hook: operation is rejected, client never called
hooks: {
  beforeReceive: (ctx) => {
    throw new Error("nope");
  },
}

// After-hook: operation already completed, throw = your bug
hooks: {
  afterReceive: (ctx, result) => {
    // Observe only. If you throw here, it's a violation
    // of the after-hook contract (result is already committed).
  },
}
```

---

### Event handlers that fail

Event handler errors are caught and logged. They never crash the caller.

```typescript
const rig = await Rig.init({
  client,
  on: {
    "receive:success": [
      async () => {
        throw new Error("webhook down");
      },
    ],
  },
});

// This succeeds — the event error is logged, not thrown
const result = await rig.receive(["mutable://open/x", { v: 1 }]);
console.log(result.accepted); // true
```

---

### No accepting client for a URI

When using filtered clients, a URI that no client accepts returns an error result.

```typescript
const rig = await Rig.init({
  subscriptions: [
    subscribe(client, { receive: ["mutable://*"], read: ["mutable://*"] }),
  ],
});

// No client accepts "unknown://" → error (not a throw)
const result = await rig.read("unknown://something");
console.log(result.success); // false
console.log(result.error); // "no client accepts read for unknown://something"
```

---

### Cleanup order

Drain events before cleanup to ensure pending async handlers finish.

```typescript
// 1. Drain pending events
await Promise.allSettled(rig.drain());

// 2. Cleanup the rig (closes clients, DB connections, etc.)
await rig.cleanup();
```

---

### readData vs read

`read()` returns the full result envelope. `readData()` unwraps it.

```typescript
// Full result — has .success, .error, .record
const result = await rig.read<Profile>("mutable://open/app/profile");
if (result.success) {
  console.log(result.record?.data.name);
}

// Just the data — null if missing
const profile = await rig.readData<Profile>("mutable://open/app/profile");
console.log(profile?.name);

// Throws if missing
const required = await rig.readOrThrow<Profile>("mutable://open/app/profile");
```

---

### receive vs send

`receive()` is the node's ingest — takes a `[uri, data]` tuple, no signature.
`session.send()` is the identity's outbound — signs and wraps outputs in a content-addressed envelope.

```typescript
// receive: direct write, no identity needed
await rig.receive(["mutable://open/app/x", data]);

// send: signed envelope via identity session
const session = id.rig(rig);
await session.send({
  inputs: [],
  outputs: [["mutable://accounts/" + id.pubkey + "/app/x", data]],
});
```

---

## Summary: The Rig Mental Model

```
  Identity                   Rig
  (external)          ┌──────────────────────────────────────┐
     │                │                                      │
     │  .rig(rig)     │  Schema     Hooks      Events        │
     └───────►        │  (validate) (guard)    (notify)      │
  AuthenticatedRig    │                                      │
  (sign, encrypt)     │         ┌────────────────┐           │
     │                │         │  Core Operation │           │
     │  .send()       │         └───────┬────────┘           │
     └───────►        │                 │                    │
                      │           ┌─────┴─────┐              │
                      │           │  Observe   │              │
                      │           │ (patterns) │              │
                      │           └───────────┘              │
                      │                 │                    │
                      │   ┌─────────────┼─────────────┐      │
                      │   │ accepts?    │ accepts?    │      │
                      │   ▼             ▼             ▼      │
                      │ Client A    Client B    Client C     │
                      │ (plumbing)  (plumbing)  (plumbing)   │
                      └──────────────────────────────────────┘
```

The rig is pure orchestration — identity-free. Identity is the security principal: it signs and encrypts externally, then dispatches pre-signed messages through the rig. `identity.rig(rig)` creates an `AuthenticatedRig` session. Schema validates. Hooks guard. Clients are pure plumbing. Events notify. Observers react. A compromised rig can dispatch but cannot forge signatures — the security boundary is the identity, not the rig.

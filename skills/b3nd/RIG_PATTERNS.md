# Rig Patterns — A Visual Guide

A scrollable catalog of rig setups. Each card shows a situation you'll encounter while building with b3nd, a minimal description of why, and the rig config that solves it.

Cards are grouped by theme. Start anywhere.

---

## Getting Connected

### Connect to a remote node

You have a running b3nd node and just want to talk to it.

```typescript
const rig = await Rig.connect("https://my-node.example.com");

const result = await rig.read("mutable://open/app/status");
```

---

### Connect to a local in-memory backend

Tests, prototypes, offline-first apps — no network needed.

```typescript
const rig = await Rig.connect("memory://");

await rig.receive(["mutable://open/test/hello", { msg: "works" }]);
const data = await rig.readData("mutable://open/test/hello");
// { msg: "works" }
```

---

### Connect with identity

Signed writes require an identity. Seed-based is deterministic — same seed, same keys.

```typescript
const id = await Identity.fromSeed("alice-secret-seed-phrase");
const rig = await Rig.connect("https://node.example.com", id);

await rig.send({
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
const exported = id.export();
localStorage.setItem("identity", JSON.stringify(exported));

// Later: restore
const restored = Identity.fromExported(
  JSON.parse(localStorage.getItem("identity")!),
);
const rig = await Rig.connect("https://node.example.com", restored);
```

---

### Connect to a database backend directly

Server-side — the rig talks to Postgres, Mongo, SQLite, or the filesystem with no HTTP hop.

```typescript
import { Pool } from "pg";

const rig = await Rig.init({
  use: "postgresql://localhost:5432/mydb",
  schema: mySchema,
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

`send()` wraps outputs in a content-addressed, signed envelope. This is how you write to `accounts://` programs or any schema that requires identity.

```typescript
const id = await Identity.fromSeed("alice-secret");
const rig = await Rig.init({ use: "https://node.example.com", identity: id });

await rig.send({
  inputs: ["mutable://accounts/" + id.pubkey + "/app/balance"],
  outputs: [
    ["mutable://accounts/" + id.pubkey + "/app/balance", { amount: 100 }],
    ["mutable://accounts/" + id.pubkey + "/app/tx/001", { type: "deposit", amount: 100 }],
  ],
});
```

---

## Encrypted Data

### Encrypt to self

Store secrets only you can decrypt. The identity's X25519 key is used automatically.

```typescript
const id = await Identity.generate();
const rig = await Rig.init({ use: "memory://", identity: id });

await rig.sendEncrypted({
  inputs: [],
  outputs: [
    ["mutable://accounts/" + id.pubkey + "/secrets", { apiKey: "sk-abc123" }],
  ],
});

const secrets = await rig.readEncrypted<{ apiKey: string }>(
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

const rig = await Rig.init({ use: "memory://", identity: alice });

// Alice encrypts to Bob's encryption public key
await rig.sendEncrypted(
  {
    inputs: [],
    outputs: [
      ["mutable://inbox/" + bob.pubkey + "/msg/001", { text: "Hello Bob" }],
    ],
  },
  bob.encryptionPubkey,
);

// Bob decrypts (needs his own rig with his identity)
const bobRig = await Rig.init({ use: "memory://", identity: bob });
// (assuming shared backend — in practice both point to the same node)
```

---

### Batch decrypt

```typescript
const [secretA, secretB] = await rig.readEncryptedMany<{ key: string }>([
  "mutable://accounts/" + id.pubkey + "/secrets/a",
  "mutable://accounts/" + id.pubkey + "/secrets/b",
]);
```

---

## Hooks — Synchronous Pipelines

Hooks are frozen at init time. Pre-hooks throw to reject. Post-hooks observe only.

### Validate on receive

Reject writes that don't match your app's shape.

```typescript
const rig = await Rig.init({
  use: "memory://",
  hooks: {
    receive: {
      pre: [
        (ctx) => {
          if (ctx.op !== "receive") return;
          const data = ctx.data as Record<string, unknown>;
          if (!data.title || typeof data.title !== "string") {
            throw new Error("receive rejected: missing title");
          }
        },
      ],
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

A pre-hook that enforces a cooldown.

```typescript
let lastWrite = 0;
const COOLDOWN_MS = 1000;

const rig = await Rig.init({
  use: "memory://",
  hooks: {
    receive: {
      pre: [
        () => {
          const now = Date.now();
          if (now - lastWrite < COOLDOWN_MS) {
            throw new Error("rate limit: too many writes");
          }
          lastWrite = now;
        },
      ],
    },
  },
});
```

---

### Audit trail on reads

Post-hooks can't modify the result, but they can observe it.

```typescript
const auditLog: Array<{ uri: string; ts: number }> = [];

const rig = await Rig.init({
  use: "memory://",
  hooks: {
    read: {
      post: [
        (ctx) => {
          if (ctx.op === "read") {
            auditLog.push({ uri: ctx.uri, ts: Date.now() });
          }
        },
      ],
    },
  },
});
```

---

### Restrict deletes to admin URIs

```typescript
const rig = await Rig.init({
  use: "memory://",
  hooks: {
    delete: {
      pre: [
        (ctx) => {
          if (ctx.op !== "delete") return;
          if (!ctx.uri.includes("/admin/")) {
            throw new Error("only admin URIs can be deleted");
          }
        },
      ],
    },
  },
});
```

---

### Multiple pre-hooks (pipeline)

Pre-hooks run sequentially. The first throw stops the chain.

```typescript
const rig = await Rig.init({
  use: "memory://",
  hooks: {
    send: {
      pre: [
        (ctx) => {
          /* 1. check identity */
        },
        (ctx) => {
          /* 2. check envelope size */
        },
        (ctx) => {
          /* 3. check URI namespace */
        },
      ],
    },
  },
});
```

---

### Why hooks are frozen

Hooks cannot be added at runtime. This is intentional — your security invariants don't change after boot. If you need different hooks, create a new rig.

```typescript
// Build-time:
const prodRig = await Rig.init({ use: url, hooks: prodHooks });
const testRig = await Rig.init({ use: "memory://", hooks: testHooks });

// Runtime: rig.hook() does NOT exist — hooks are sealed.
```

---

## Events — Async Fire-and-Forget

Events never block the caller. They fire after an operation completes.

### Log every operation

```typescript
const rig = await Rig.init({
  use: "memory://",
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
  use: "memory://",
  on: {
    "read:success": [
      (e) => {
        metrics.reads++;
      },
    ],
    "receive:success": [
      (e) => {
        metrics.writes++;
      },
    ],
    "send:success": [
      (e) => {
        metrics.writes++;
      },
    ],
    "*:error": [
      (e) => {
        metrics.errors++;
      },
    ],
  },
});
```

---

### Add events at runtime

Unlike hooks, events can be registered and removed dynamically.

```typescript
const rig = await Rig.connect("memory://");

// Add
const unsub = rig.on("receive:success", (e) => {
  console.log(`Wrote to ${e.uri}`);
});

// Later: remove
unsub();

// Or remove by reference
const handler = (e) => {
  /* ... */
};
rig.on("send:success", handler);
rig.off("send:success", handler);
```

---

### Drain pending events before shutdown

Events are async — if the process exits, some handlers might not finish. `drain()` gives you their promises.

```typescript
const rig = await Rig.init({
  use: "memory://",
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
  use: "memory://",
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
  use: "memory://",
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
const rig = await Rig.connect("memory://");

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
| **Blocking** | Synchronous (pre-hooks) | Never blocks | Never blocks |
| **Can reject** | Pre-hooks throw | No | No |
| **Can modify** | Pre-hooks can replace ctx | No | No |
| **Mutable** | Frozen at init | Add/remove anytime | Add/remove anytime |
| **Scope** | All operations | All operations | Writes only |
| **Pattern match** | No | By event name | By URI pattern |

---

## Client Routing

### Single backend (most common)

One URL, one client, all operations go to the same place.

```typescript
const rig = await Rig.connect("https://node.example.com");
```

---

### Filtered clients — route by URI pattern

Different URIs go to different backends. The rig inspects `accepts()` on each client and routes accordingly.

```typescript
import { Rig, withFilter } from "@b3nd/rig";
import { HttpClient, MemoryClient } from "@bandeira-tech/b3nd-sdk";

const remote = new HttpClient({ url: "https://node.example.com" });
const local = new MemoryClient({ schema: {} });

const rig = await Rig.init({
  clients: [
    withFilter(remote, {
      receive: ["mutable://*", "hash://*"],
      read: ["mutable://*", "hash://*"],
      list: ["mutable://*"],
      delete: ["mutable://*"],
    }),
    withFilter(local, {
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
  clients: [
    withFilter(primary, {
      receive: ["mutable://*"],
      read: ["mutable://*"],
    }),
    withFilter(replica, {
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
  clients: [
    withFilter(special, { receive: ["special://*"], read: ["special://*"] }),
    generalClient, // no filter — catches everything else
  ],
});
```

---

### Per-operation routing (legacy object form)

Explicit per-operation client assignment. Less flexible than filtered clients but still supported.

```typescript
const rig = await Rig.init({
  use: "postgresql://primary",
  clients: {
    read: ["redis://cache", "postgresql://primary"],
  },
  executors: { postgres: myPgFactory },
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

The rig has a built-in HTTP handler. No framework needed.

```typescript
const rig = await Rig.init({
  use: "postgresql://localhost:5432/mydb",
  schema: mySchema,
  executors: { postgres: pgFactory },
});

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
| `/health` | GET | Health check |
| `/schema` | GET | List registered programs |
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
  use: "memory://",
  hooks: {
    receive: { pre: [validatePayload] },
  },
  on: {
    "*:success": [logToStdout],
  },
  observe: {
    "mutable://app/*": notifyWebhook,
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
const rig = await Rig.init({ use: "memory://" });

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
  use: "memory://",
  hooks: { receive: { pre: [validateInner] } },
});

const outerRig = await Rig.init({
  clients: [
    withFilter(innerRig, {
      receive: ["local://*"],
      read: ["local://*"],
    }),
    withFilter(httpClient, {
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

### Check capabilities before acting

```typescript
const rig = await Rig.connect("https://node.example.com");

if (rig.canSign) {
  await rig.send({ inputs: [], outputs: [[uri, data]] });
} else {
  // No identity — fall back to unsigned receive
  await rig.receive([uri, data]);
}

if (rig.canEncrypt) {
  await rig.sendEncrypted({ inputs: [], outputs: [[uri, secret]] });
}
```

---

### Inspect rig state

```typescript
const info = rig.info();

console.log(info.pubkey); // hex or null
console.log(info.hasIdentity); // boolean
console.log(info.canSign); // boolean
console.log(info.canEncrypt); // boolean
console.log(info.behavior.hooks); // { receive: { pre: 2, post: 1 }, ... }
console.log(info.behavior.events); // { "send:success": 1, "*:error": 1 }
console.log(info.behavior.observers); // 3
```

---

## Full Init Examples

### Minimal app backend

A server node with schema validation, logging, and HTTP.

```typescript
const rig = await Rig.init({
  use: "postgresql://localhost:5432/app",
  schema: appSchema,
  executors: { postgres: pgFactory },
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
const cache = new MemoryClient({ schema: {} });

const id = Identity.fromExported(savedIdentity);

const rig = await Rig.init({
  identity: id,
  clients: [
    withFilter(remote, {
      receive: ["mutable://*", "hash://*"],
      read: ["mutable://*", "hash://*"],
    }),
    withFilter(cache, {
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
  clients: [
    withFilter(pg, {
      receive: ["mutable://*"],
      read: ["mutable://*"],
      list: ["mutable://*"],
      delete: ["mutable://*"],
    }),
    withFilter(fs, {
      receive: ["hash://*"],
      read: ["hash://*"],
    }),
  ],
  hooks: {
    receive: {
      pre: [
        (ctx) => {
          if (ctx.op !== "receive") return;
          const size = JSON.stringify(ctx.data).length;
          if (size > 1_000_000) throw new Error("payload too large");
        },
      ],
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

  const rig = await Rig.init({
    use: "memory://",
    on: {
      "receive:success": [
        (e) => {
          events.push(e.uri!);
        },
      ],
    },
    observe: {
      "mutable://open/test/:key": (uri, data, { key }) => {
        assertEquals(key, "hello");
      },
    },
  });

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
  use: Deno.env.get("BACKEND_URL") || "memory://",
  executors: { postgres: pgFactory },
  on: {
    "*:success": [
      (e) => {
        if (Deno.env.get("VERBOSE")) console.log(`${e.op} ${e.uri}`);
      },
    ],
  },
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
    console.log(await rig.health());
    break;
}

await rig.cleanup();
```

---

## Edge Cases and Gotchas

### No identity + send = throw

`send()` requires an identity because it signs the envelope. Use `receive()` for unsigned writes.

```typescript
const rig = await Rig.connect("memory://");

// This works (unsigned)
await rig.receive(["mutable://open/app/x", { v: 1 }]);

// This throws: "no identity set"
await rig.send({ inputs: [], outputs: [["mutable://open/app/x", { v: 2 }]] });
```

---

### Pre-hook throw vs post-hook throw

Pre-hook throws prevent the operation. Post-hook throws are bugs — the operation already happened.

```typescript
// Pre-hook: operation is rejected, client never called
hooks: {
  receive: {
    pre: [
      (ctx) => {
        throw new Error("nope");
      },
    ],
  },
}

// Post-hook: operation already completed, throw = your bug
hooks: {
  receive: {
    post: [
      (ctx, result) => {
        // Observe only. If you throw here, it's a violation
        // of the post-hook contract (result is already committed).
      },
    ],
  },
}
```

---

### Event handlers that fail

Event handler errors are caught and logged. They never crash the caller.

```typescript
const rig = await Rig.init({
  use: "memory://",
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
  clients: [
    withFilter(client, { receive: ["mutable://*"], read: ["mutable://*"] }),
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
`send()` is the identity's outbound — wraps outputs in a signed envelope.

```typescript
// receive: direct write, no identity needed
await rig.receive(["mutable://open/app/x", data]);

// send: signed envelope, identity required
await rig.send({
  inputs: [],
  outputs: [["mutable://accounts/:key/app/x", data]],
});
```

---

## Summary: The Rig Mental Model

```
┌─────────────────────────────────────────────┐
│                    Rig                      │
│                                             │
│  ┌─────────┐  ┌──────┐  ┌─────────┐        │
│  │  Hooks  │→ │ Core │→ │  Events │        │
│  │ (pre)   │  │ Op   │  │ (async) │        │
│  │ frozen  │  │      │  │         │        │
│  └─────────┘  └──┬───┘  └─────────┘        │
│                  │                          │
│            ┌─────┴─────┐                    │
│            │  Observe   │                    │
│            │ (patterns) │                    │
│            └───────────┘                    │
│                  │                          │
│    ┌─────────────┼─────────────┐            │
│    │ accepts?    │ accepts?    │            │
│    ▼             ▼             ▼            │
│  Client A    Client B    Client C           │
│  mutable://* local://*   hash://*           │
└─────────────────────────────────────────────┘
```

The rig is the single entry point. Identity signs. Hooks guard. Clients route. Events notify. Observers react. Everything flows through one place.

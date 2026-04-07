# Rig Patterns — A Visual Guide

A scrollable catalog of rig setups. Each card shows a situation you'll encounter
while building with b3nd, a minimal description of why, and the rig config that
solves it.

Cards are grouped by theme. Start anywhere.

---

## Getting Connected

### Connect to a remote node

You have a running b3nd node and just want to talk to it.

```typescript
const client = new HttpClient({ url: "https://my-node.example.com" });
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
});

const [result] = await rig.read("mutable://open/app/status");
```

---

### Connect to a local in-memory backend

Tests, prototypes, offline-first apps — no network needed.

```typescript
const rig = new Rig({
  connections: [
    connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
  ],
});

await rig.receive(["mutable://open/test/hello", { msg: "works" }]);
const [result] = await rig.read("mutable://open/test/hello");
// result.data → { msg: "works" }
```

---

### Connect with identity

Signed writes require an identity. The rig is identity-free — identity drives
authenticated operations via `identity.rig(rig)`.

```typescript
const id = await Identity.fromSeed("alice-secret-seed-phrase");
const client = new HttpClient({ url: "https://node.example.com" });
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
});
const session = id.rig(rig);

await session.send({
  inputs: [],
  outputs: [["mutable://accounts/" + id.pubkey + "/app/profile", {
    name: "Alice",
  }]],
});
```

---

### Generate a fresh identity

For new users — random keypair, export for storage.

```typescript
const id = await Identity.generate();

console.log(id.pubkey); // Ed25519 public key hex
console.log(id.encryptionPubkey); // X25519 public key hex

// Export for localStorage / secure storage
const exported = await id.export();
localStorage.setItem("identity", JSON.stringify(exported));

// Later: restore and create a session
const restored = await Identity.fromExport(
  JSON.parse(localStorage.getItem("identity")!),
);
const client = new HttpClient({ url: "https://node.example.com" });
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
});
const session = restored.rig(rig);
```

---

### Build a client from a database URL

Server-side — build a database client with `createClientFromUrl`, then hand it
to the rig. Clients are plumbing; the rig orchestrates.

```typescript
import { createClientFromUrl, Rig } from "@b3nd/rig";
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
      };
    },
  },
});

const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  schema: appSchema,
});
```

---

### Connections are explicit

The rig always takes explicit connections. You build the client, wrap it in
`connection()` with patterns, and hand it to the rig.

```typescript
// Build the client yourself
const client = new HttpClient({ url: "https://node.example.com" });
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  schema: mySchema,
});
```

---

## Reading and Writing

### Basic read and write

The node interface has 3 methods: `receive`, `read`, `status`.

```typescript
// Write
await rig.receive(["mutable://open/app/pages/home", {
  title: "Home",
  body: "Welcome",
}]);

// Read (returns ReadResult[])
const [result] = await rig.read("mutable://open/app/pages/home");
if (result.success) console.log(result.record?.data);

// List (trailing slash = list)
const results = await rig.read("mutable://open/app/pages/");

// Status
const status = await rig.status();
```

---

### Read with error handling

`read()` always returns `ReadResult[]`. Check `.success` on each result.

```typescript
// read returns an array — destructure for single reads
const [result] = await rig.read("mutable://open/app/config");
if (!result.success) {
  await rig.receive(["mutable://open/app/config", defaultConfig]);
}
```

---

### Check existence via read

```typescript
const [result] = await rig.read("mutable://open/app/users/alice");
if (result.success) {
  // user is registered
}
```

---

### Batch read

Pass an array of URIs — `read()` accepts `string | string[]` and always returns
`ReadResult[]`.

```typescript
const results = await rig.read([
  "mutable://open/app/users/alice",
  "mutable://open/app/users/bob",
  "mutable://open/app/users/charlie",
]);

for (const result of results) {
  if (result.success) console.log(result.record?.data);
}
```

---

### List items under a prefix

Trailing slash on the URI means list.

```typescript
const results = await rig.read("mutable://open/app/users/");

for (const result of results) {
  if (result.success) console.log(result.record?.data);
}
```

---

### Count items

Use list (trailing slash) and count the results.

```typescript
const results = await rig.read("mutable://open/app/posts/");
console.log(`${results.length} posts`);
```

---

### Signed envelope (send)

`session.send()` wraps outputs in a content-addressed, signed envelope. This is
how you write to `accounts://` programs or any schema that requires identity.
The identity signs; the rig delivers.

```typescript
const id = await Identity.fromSeed("alice-secret");
const client = new HttpClient({ url: "https://node.example.com" });
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
});
const session = id.rig(rig);

await session.send({
  inputs: ["mutable://accounts/" + id.pubkey + "/app/balance"],
  outputs: [
    ["mutable://accounts/" + id.pubkey + "/app/balance", { amount: 100 }],
    ["mutable://accounts/" + id.pubkey + "/app/tx/001", {
      type: "deposit",
      amount: 100,
    }],
  ],
});
```

---

## Schema — Application-Level Validation

### Schema is a rig concern

The schema defines which URI programs your application accepts. It lives on the
rig — the application layer — not on clients. Clients are pure plumbing that
store and retrieve data without opinions.

```typescript
import { Rig } from "@b3nd/rig";
import { MemoryClient } from "@b3nd/client-memory";

const schema = {
  "mutable://open": async () => ({ valid: true }),
  "mutable://accounts": async ([_uri, data]) => {
    if (!data.amount) return { valid: false, error: "missing amount" };
    return { valid: true };
  },
};

// Schema on the rig — client has no schema
const client = new MemoryClient();
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  schema,
});

// Succeeds — mutable://open is in the schema
await rig.receive(["mutable://open/app/hello", { msg: "hi" }]);

// Rejected — unknown://foo is not in the schema
await rig.receive(["unknown://foo", { v: 1 }]);
// → error: no validator for program "unknown://foo"
```

---

### Schema with connections

Pass `schema` alongside `connections` — the rig validates, the client stores.

```typescript
const client = new MemoryClient();

// No schema validation
const simple = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
});

// With schema validation
const validated = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  schema: mySchema,
});
```

---

### Schema + hooks = defense in depth

Schema validates URI programs. Hooks validate data shapes. Together they form a
layered security model.

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
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
await rig.receive(["mutable://open/app/post", { oops: true }]); // hook rejects
await rig.receive(["unknown://app/post", { title: "Hello" }]); // schema rejects
```

---

## Encrypted Data

### Encrypt to self

Store secrets only you can decrypt. The identity's X25519 key is used
automatically.

```typescript
const id = await Identity.generate();
const rig = new Rig({
  connections: [
    connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
  ],
});
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

const rig = new Rig({
  connections: [
    connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
  ],
});
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

Hooks are frozen at init. Before-hooks throw to reject. After-hooks observe
only. One function per slot — compose on your end if needed.

### Validate on receive

Reject writes that don't match your app's shape.

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
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

const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
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

const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  hooks: {
    afterRead: (ctx, _result) => {
      auditLog.push({ uri: ctx.uri, ts: Date.now() });
    },
  },
});
```

---

### Rewrite a URI in a before-hook

Before-hooks can return `{ ctx }` to replace the context — useful for URI
rewriting, normalization, or aliasing.

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
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

The rig takes one function per hook slot. If you need multiple checks, compose
them yourself.

```typescript
function composeChecks(
  ...fns: Array<(ctx: SendCtx) => void>
): BeforeHook<SendCtx> {
  return (ctx) => {
    for (const fn of fns) fn(ctx);
  };
}

const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  hooks: {
    beforeSend: composeChecks(
      (ctx) => {/* 1. check identity */},
      (ctx) => {/* 2. check envelope size */},
      (ctx) => {/* 3. check URI namespace */},
    ),
  },
});
```

---

### Why hooks are frozen

Hooks cannot be added at runtime. This is intentional — your security invariants
don't change after boot. If you need different hooks, create a new rig.

```typescript
// Build-time:
const prodRig = new Rig({
  connections: [connection(prodClient, { receive: ["*"], read: ["*"] })],
  hooks: prodHooks,
});
const testRig = new Rig({
  connections: [
    connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
  ],
  hooks: testHooks,
});

// Runtime: rig.hook() does NOT exist — hooks are sealed.
```

---

### The hook slots

Each operation has a typed before/after pair. No `ctx.op` check needed — the
type tells you which operation you're in.

| Slot                             | Context Type | Fields                 |
| -------------------------------- | ------------ | ---------------------- |
| `beforeSend` / `afterSend`       | `SendCtx`    | `envelope`, `identity` |
| `beforeReceive` / `afterReceive` | `ReceiveCtx` | `uri`, `data`          |
| `beforeRead` / `afterRead`       | `ReadCtx`    | `uri`                  |

---

## Events — Async Fire-and-Forget

Events never block the caller. They fire after an operation completes.

### Log every operation

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
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

const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  on: {
    "read:success": [(e) => {
      metrics.reads++;
    }],
    "receive:success": [(e) => {
      metrics.writes++;
    }],
    "send:success": [(e) => {
      metrics.writes++;
    }],
    "*:error": [(e) => {
      metrics.errors++;
    }],
  },
});
```

---

### Add events at runtime

Unlike hooks, events can be registered and removed dynamically.

```typescript
const rig = new Rig({
  connections: [
    connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
  ],
});

// Add
const unsub = rig.on("receive:success", (e) => {
  console.log(`Wrote to ${e.uri}`);
});

// Later: remove
unsub();

// Or remove by reference
const handler = (e) => {/* ... */};
rig.on("send:success", handler);
rig.off("send:success", handler);
```

---

### Drain pending events before shutdown

Events are async — if the process exits, some handlers might not finish.
`drain()` gives you their promises.

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
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
```

---

## Reactions — URI Pattern Reactions

Observers fire on successful writes and match against URI patterns with `:param`
and `*` wildcards.

### Reaction to user profile changes

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  reactions: {
    "mutable://open/app/users/:userId/profile": (uri, data, { userId }) => {
      console.log(`User ${userId} updated their profile:`, data);
    },
  },
});

await rig.receive(["mutable://open/app/users/alice/profile", {
  name: "Alice",
}]);
// → "User alice updated their profile: { name: 'Alice' }"
```

---

### Wildcard — reaction to all writes under a namespace

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  reactions: {
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

### Add reactions at runtime

```typescript
const rig = new Rig({
  connections: [
    connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
  ],
});

const unsub = rig.reaction(
  "mutable://open/chat/rooms/:room/messages/:msgId",
  (uri, data, { room, msgId }) => {
    console.log(`[${room}] New message ${msgId}`);
  },
);

// Stop reacting
unsub();
```

---

### Hooks vs Events vs Observe

|                   | Hooks                    | Events             | Observe            |
| ----------------- | ------------------------ | ------------------ | ------------------ |
| **Timing**        | Before/after op          | After op           | After write        |
| **Blocking**      | Before-hooks block       | Never blocks       | Never blocks       |
| **Can reject**    | Before-hooks throw       | No                 | No                 |
| **Can modify**    | Before-hooks replace ctx | No                 | No                 |
| **Mutable**       | Frozen at init           | Add/remove anytime | Add/remove anytime |
| **Scope**         | All operations           | All operations     | Writes only        |
| **Pattern match** | No                       | By event name      | By URI pattern     |
| **Multiplicity**  | One function per slot    | Array of handlers  | One per pattern    |

---

## Client Routing

### Single backend (most common)

One client, one connection, all operations go to the same place.

```typescript
const client = new HttpClient({ url: "https://node.example.com" });
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
});
```

---

### Filtered clients — route by URI pattern

Different URIs go to different backends. The rig inspects `accepts()` on each
client and routes accordingly.

```typescript
import { connection, Rig } from "@b3nd/rig";
import { HttpClient } from "@b3nd/client-http";
import { MemoryClient } from "@b3nd/client-memory";

const remote = new HttpClient({ url: "https://node.example.com" });
const local = new MemoryClient();

const rig = new Rig({
  connections: [
    connection(remote, {
      receive: ["mutable://*", "hash://*"],
      read: ["mutable://*", "hash://*"],
    }),
    connection(local, {
      receive: ["local://*"],
      read: ["local://*"],
    }),
  ],
});

// Goes to remote
await rig.receive(["mutable://open/app/data", { v: 1 }]);

// Goes to local
await rig.receive(["local://cache/session", { token: "abc" }]);

// Read routes the same way
const [remoteResult] = await rig.read("mutable://open/app/data");
const [localResult] = await rig.read("local://cache/session");
```

---

### How routing works

- **Writes** (receive/send): broadcast to **all** accepting clients
- **Reads** (read): try clients in order, return **first match**
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

const rig = new Rig({
  connections: [
    connection(primary, {
      receive: ["mutable://*"],
      read: ["mutable://*"],
    }),
    connection(replica, {
      receive: ["mutable://*"],
      // no read — replica is write-only from the rig's perspective
    }),
  ],
});

// This write goes to both primary and replica
await rig.receive(["mutable://open/app/data", { v: 1 }]);

// Reads come from primary (first client with read acceptance)
const [result] = await rig.read("mutable://open/app/data");
```

---

### Unfiltered clients accept everything

A client without `accepts()` is treated as accepting all operations and URIs.
This is backwards-compatible.

```typescript
const rig = new Rig({
  connections: [
    connection(special, { receive: ["special://*"], read: ["special://*"] }),
    connection(generalClient, { receive: ["*"], read: ["*"] }),
  ],
});
```

---

### Per-operation routing (connections)

Explicit per-operation routing via connections. Each connection declares which
operations it handles.

```typescript
const pgClient = await createClientFromUrl("postgresql://primary", {
  executors: { postgres: pgFactory },
});
const cacheClient = new MemoryClient();

const rig = new Rig({
  connections: [
    connection(cacheClient, { read: ["mutable://*", "hash://*"] }),
    connection(pgClient, {
      receive: ["mutable://*", "immutable://*", "hash://*"],
      read: ["mutable://*", "immutable://*", "hash://*"],
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

for await (
  const value of rig.watch<AppConfig>(
    "mutable://open/app/config",
    { intervalMs: 2000, signal: abort.signal },
  )
) {
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

for await (
  const snapshot of rig.watchAll<UserProfile>(
    "mutable://open/app/users",
    { intervalMs: 3000, signal: abort.signal },
  )
) {
  console.log(`${snapshot.items.size} users`);
  console.log("Added:", snapshot.added);
  console.log("Removed:", snapshot.removed);
  console.log("Changed:", snapshot.changed);

  // snapshot.items is Map<string, UserProfile>
  renderUserList(snapshot.items);
}
```

---

### Observe a URI pattern (real-time streaming)

Routes to the client's native transport (SSE for HTTP, internal events for
Memory, etc.). Connection must have `observe` patterns configured.

```typescript
const abort = new AbortController();
for await (
  const result of rig.observe<ChatMessage>(
    "mutable://open/chat/rooms/:room/messages/:msgId",
    abort.signal,
  )
) {
  if (result.success && result.record) {
    console.log(`${result.uri}: ${result.record.data.text}`);
  }
}
```

---

### Reaction to writes (fire-and-forget)

Local write-reactions that fire on successful `send()` or `receive()`.

```typescript
const unsub = rig.reaction(
  "mutable://open/app/users/:id",
  (uri, data, { id }) => {
    console.log(`User ${id} updated:`, data);
  },
);

// Later
unsub();
```

---

## Serving Over HTTP

### Expose the rig as an HTTP endpoint

The rig has a built-in HTTP handler. Build the client outside, hand it to the
rig.

```typescript
const client = await createClientFromUrl("postgresql://localhost:5432/mydb", {
  executors: { postgres: pgFactory },
});

const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  schema: appSchema,
});

const api = httpApi(rig);

// Deno
Deno.serve({ port: 9942 }, api);

// Bun
Bun.serve({ port: 9942, fetch: api });
```

---

### What the handler exposes

| Route                    | Method | Description                        |
| ------------------------ | ------ | ---------------------------------- |
| `/status`                | GET    | Status check (includes schema)     |
| `/receive`               | POST   | Write data                         |
| `/read?uri=...`          | GET    | Read a URI (trailing slash = list) |
| `/subscribe?pattern=...` | GET    | SSE stream for URI patterns        |

---

### Handler with hooks and events

The HTTP handler goes through the same rig pipeline — hooks, events, observe all
fire.

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  schema: appSchema,
  hooks: {
    beforeReceive: validatePayload,
  },
  on: {
    "*:success": [logToStdout],
  },
  reactions: {
    "mutable://open/app/*": notifyWebhook,
  },
});

// HTTP requests go through the full pipeline
Deno.serve({ port: 9942 }, httpApi(rig));
```

---

## The Rig as a Client

The rig satisfies `NodeProtocolInterface`. Anything that accepts a client also
accepts a rig.

### Pass the rig where a client is expected

```typescript
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
});

// Any function that takes NodeProtocolInterface works
function processData(node: NodeProtocolInterface) {
  return node.read("mutable://open/app/data");
}

// Pass the rig directly — no .client escape hatch
await processData(rig);
```

---

### Compose rigs

A rig can be a client inside another rig's routing table.

```typescript
const innerRig = new Rig({
  connections: [
    connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
  ],
  hooks: { beforeReceive: validateInner },
});

const outerRig = new Rig({
  connections: [
    connection(innerRig, {
      receive: ["local://*"],
      read: ["local://*"],
    }),
    connection(httpClient, {
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

The rig is identity-free — pure orchestration. Identity is external: you create
a session with `identity.rig(rig)` for authenticated operations. Multiple
identities can share the same rig.

```typescript
const client = new HttpClient({ url: "https://node.example.com" });
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
});
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
const client = new HttpClient({ url: "https://node.example.com" });
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
});
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

console.log(info.behavior.hooks); // ["beforeReceive", "afterRead", ...]
console.log(info.behavior.events); // { "send:success": 1, "*:error": 1 }
console.log(info.behavior.observers); // 3
```

---

## Full Init Examples

### Minimal app backend

A server node with schema validation, logging, and HTTP.

```typescript
const client = await createClientFromUrl("postgresql://localhost:5432/app", {
  executors: { postgres: pgFactory },
});

const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  schema: appSchema,
  on: {
    "*:success": [(e) => console.log(`[${e.op}] ${e.uri}`)],
    "*:error": [(e) => console.error(`[${e.op}] ${e.uri}: ${e.error}`)],
  },
});

Deno.serve({ port: 9942 }, httpApi(rig));
```

---

### Browser app with local cache + remote sync

```typescript
const remote = new HttpClient({ url: "https://node.example.com" });
const cache = new MemoryClient();

const rig = new Rig({
  connections: [
    connection(remote, {
      receive: ["mutable://*", "hash://*"],
      read: ["mutable://*", "hash://*"],
    }),
    connection(cache, {
      receive: ["local://*"],
      read: ["local://*"],
    }),
  ],
  on: {
    "receive:error": [(e) => showToast(`Write failed: ${e.error}`)],
  },
  reactions: {
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

A node that speaks to Postgres for mutable data and the filesystem for blobs,
with validation hooks.

```typescript
const pg = await createClientFromUrl("postgresql://localhost:5432/data", {
  executors: { postgres: pgFactory },
});

const fs = await createClientFromUrl("file:///var/data/blobs", {
  executors: { fs: fsFactory },
});

const rig = new Rig({
  schema: appSchema,
  connections: [
    connection(pg, {
      receive: ["mutable://*"],
      read: ["mutable://*"],
    }),
    connection(fs, {
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

Deno.serve({ port: 9942 }, httpApi(rig));
```

---

### Test rig with assertions

```typescript
import { assertEquals } from "@std/assert";

Deno.test("app write and read round-trip", async () => {
  const events: string[] = [];

  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  rig.on("receive:success", (e) => {
    events.push(e.uri!);
  });
  rig.reaction(
    "mutable://open/test/:key",
    (uri, data, { key }) => {
      assertEquals(key, "hello");
    },
  );

  await rig.receive(["mutable://open/test/hello", { msg: "world" }]);

  const [result] = await rig.read("mutable://open/test/hello");
  assertEquals(result.record?.data, { msg: "world" });
  assertEquals(events, ["mutable://open/test/hello"]);

  await Promise.allSettled(rig.drain());
});
```

---

### CLI tool backed by a rig

```typescript
const client = new MemoryClient(); // or build from env
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
});

// All commands use the rig — 3 methods: receive, read, status
switch (command) {
  case "read":
    console.log(await rig.read(args.uri));
    break;
  case "write":
    await rig.receive([args.uri, JSON.parse(args.data)]);
    break;
  case "list":
    console.log(await rig.read(args.uri + "/")); // trailing slash = list
    break;
  case "status":
    console.log(await rig.status());
    break;
}
```

---

## Edge Cases and Gotchas

### Rig.send() requires pre-built MessageData

The rig's `send()` accepts pre-signed `MessageData` — it never signs. Use
`session.send()` for the convenient sign-and-send workflow, or `rig.receive()`
for unsigned writes.

```typescript
const rig = new Rig({
  connections: [
    connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
  ],
});

// Unsigned write — no identity needed
await rig.receive(["mutable://open/app/x", { v: 1 }]);

// Signed write — identity drives, rig delivers
const session = id.rig(rig);
await session.send({
  inputs: [],
  outputs: [["mutable://open/app/x", { v: 2 }]],
});

// Manual signing — build MessageData yourself
const payload = { inputs: [], outputs: [["mutable://open/app/x", { v: 3 }]] };
const auth = [await id.sign(payload)];
await rig.send({ auth, payload });
```

---

### Before-hook throw vs after-hook throw

Before-hook throws prevent the operation. After-hook throws are bugs — the
operation already happened.

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
const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
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

When using filtered clients, a URI that no client accepts returns an error
result.

```typescript
const rig = new Rig({
  connections: [
    connection(client, { receive: ["mutable://*"], read: ["mutable://*"] }),
  ],
});

// No client accepts "unknown://" → error (not a throw)
const [result] = await rig.read("unknown://something");
console.log(result.success); // false
console.log(result.error); // "no client accepts read for unknown://something"
```

---

### Drain before shutdown

Drain events to ensure pending async handlers finish.

```typescript
// Drain pending events before process exit
await Promise.allSettled(rig.drain());
```

---

### read returns ReadResult[]

`read()` accepts `string | string[]` and always returns `ReadResult[]`.
Destructure for single reads.

```typescript
// Single read — destructure
const [result] = await rig.read("mutable://open/app/profile");
if (result.success) {
  console.log(result.record?.data.name);
}

// Batch read — array of URIs
const results = await rig.read([
  "mutable://open/app/a",
  "mutable://open/app/b",
]);

// List — trailing slash
const listed = await rig.read("mutable://open/app/profiles/");
```

---

### receive vs send

`receive()` is the node's ingest — takes a `[uri, data]` tuple, no signature.
`session.send()` is the identity's outbound — signs and wraps outputs in a
content-addressed envelope.

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

The rig is pure orchestration — identity-free. Identity is the security
principal: it signs and encrypts externally, then dispatches pre-signed messages
through the rig. `identity.rig(rig)` creates an `AuthenticatedRig` session.
Schema validates. Hooks guard. Clients are pure plumbing. Events notify.
Observers react. A compromised rig can dispatch but cannot forge signatures —
the security boundary is the identity, not the rig.

# Designing Protocols

Recipes for deploying and packaging DePIN protocols built on B3nd.

For protocol examples (open CRUD, auth-based, content-addressed, fee collection,
UTXO conservation, hash-chain, consensus chain), see the Protocol Examples
section in [FRAMEWORK.md](./FRAMEWORK.md).

---

## Programs, Handlers, and Broadcast — A Worked Example

The `programs` + `handlers` + `broadcast` trio is the main composition point
for a protocol's runtime behavior. Programs classify messages by URI prefix;
handlers decide what each classification **code** means operationally and
use `broadcast` to push messages direct to clients (bypassing the program
pipeline). This section walks through a complete example.

**The shape of things:**

```typescript
import type { Program, CodeHandler } from "@bandeira-tech/b3nd-sdk";
import { connection, Rig } from "@bandeira-tech/b3nd-sdk/rig";

// Program: classify by URI prefix, return { code, error? }
type Program = (
  output: [uri, values, data],
  upstream: Output | undefined,
  read: (uri: string) => Promise<ReadResult>,
) => Promise<{ code: string; error?: string }>;

// Handler: run when a program returns a specific code.
// `broadcast` dispatches direct to clients — it does NOT re-run programs.
type CodeHandler = (
  message: Message,
  broadcast: (msgs: Message[]) => Promise<ReceiveResult[]>,
  read: (uri: string) => Promise<ReadResult>,
) => Promise<void>;
```

### Worked example — classify, then fan out

The scenario: user posts arrive at `mutable://app/posts/:user/:id`. We want to

1. Reject if the URI path is malformed.
2. For well-formed *normal* posts, store them as-is.
3. For well-formed *flagged* posts, also mirror them to a moderation
   queue at `mutable://app/moderation/flagged/:id` and keep an audit
   trail at `log://app/moderation/:id`.
4. For any other post type, drop it silently (acknowledged, but not
   stored).

One program classifies into four codes; a handler decides what each code
means; broadcast does the fan-out.

```typescript
import { connection, Rig } from "@bandeira-tech/b3nd-sdk/rig";
import { MessageDataClient, MemoryStore } from "@bandeira-tech/b3nd-sdk";
import type { Program, CodeHandler } from "@bandeira-tech/b3nd-sdk";

// 1. Program: inspect URI + data, return a code.
const postsProgram: Program = async ([uri, , data]) => {
  // mutable://app/posts/:user/:id
  const parts = uri.replace("mutable://app/posts/", "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { code: "posts:malformed", error: "expected /posts/:user/:id" };
  }
  const post = data as { kind?: string };
  if (post.kind === "normal") return { code: "posts:normal" };
  if (post.kind === "flagged") return { code: "posts:flagged" };
  return { code: "posts:drop" };
};

// 2. Handlers: one per code. `broadcast` is direct-to-clients.
const handlers: Record<string, CodeHandler> = {
  // Normal posts: just store at the original URI.
  "posts:normal": async (msg, broadcast) => {
    await broadcast([msg]);
  },

  // Flagged posts: store original, mirror to moderation, audit log.
  // This is the cookbook's fan-out pattern — one classification, three writes.
  "posts:flagged": async (msg, broadcast) => {
    const [uri, values, data] = msg;
    const id = uri.split("/").pop()!;
    await broadcast([
      [uri, values, data],                                       // original
      [`mutable://app/moderation/flagged/${id}`, {}, data],      // mirror
      [`log://app/moderation/${id}`, {}, {                       // audit trail
        action: "flagged",
        originalUri: uri,
        ts: Date.now(),
      }],
    ]);
  },

  // Drop: acknowledged (accepted by the Rig), but nothing written.
  "posts:drop": async () => {
    // Intentionally do nothing. The Rig returns { accepted: true }.
  },

  // Malformed: rejection. Program set `error`, so the handler isn't
  // called — the Rig returns { accepted: false, error } directly.
};

// 3. Wire it up.
const client = new MessageDataClient(new MemoryStore());
const rig = new Rig({
  connections: [
    connection(client, {
      receive: [
        "mutable://app/posts/*",
        "mutable://app/moderation/*",
        "log://app/moderation/*",
      ],
      read: ["*"],
    }),
  ],
  programs: { "mutable://app/posts": postsProgram },
  handlers,
});

// A normal post is stored exactly where it arrived.
await rig.receive([[
  "mutable://app/posts/alice/001", {}, { kind: "normal", body: "hello" },
]]);
await rig.readData("mutable://app/posts/alice/001");
// → { kind: "normal", body: "hello" }

// A flagged post fans out to three URIs.
await rig.receive([[
  "mutable://app/posts/alice/002", {}, { kind: "flagged", body: "ugh" },
]]);
await rig.readData("mutable://app/moderation/flagged/002"); // mirror
await rig.readData("log://app/moderation/002");              // audit

// Malformed URI is rejected without any storage.
const [bad] = await rig.receive([[
  "mutable://app/posts/malformed", {}, { kind: "normal" },
]]);
bad.accepted; // false
bad.error;    // "expected /posts/:user/:id"
```

### What the pattern gives you

- **One classification per message, many outcomes.** The program runs
  once; the handler decides how many writes to emit, to which URIs.
- **Operator overrides without forking the protocol.** If you ship the
  `postsProgram` + default `handlers` as a protocol package, an operator
  can override just `"posts:flagged"` (e.g. to also push to a Kafka
  topic) without touching the classifier.
- **`broadcast` bypasses programs.** That's what makes fan-out cheap —
  the handler is trusted internal code, so it can write to any URI
  without re-triggering classification or looping.
- **Codes are protocol-defined.** `"posts:flagged"` means whatever your
  protocol says it means. There is no framework-level notion of valid
  vs invalid, only the `error` field on a program result triggering
  rejection.

For the full `CodeHandler` signature and more on the classifier / handler /
broadcast split, see `libs/b3nd-rig/types.ts` and
[DESIGN_PRIMITIVE.md](./DESIGN_PRIMITIVE.md#the-rig). For the receive-vs-send
asymmetry (programs don't fire on `send()`), see
[RIG_PATTERNS.md](./RIG_PATTERNS.md#programs-run-on-receive-not-on-send).

---

## Running Your Protocol's Node

> **Note on API surface.** The sections below still reference the older
> `Schema` / `Validator` / `createServerNode` / `msgSchema` API. Those
> helpers are gone in the current SDK — the Rig is the single entry
> point, and `programs:` + `handlers:` replace the old `schema:` key.
> The patterns shown (schema module, multi-backend composition, node
> setup) are still conceptually correct; port the function shapes per
> the "What Changed: Schema → Programs" section of
> [FRAMEWORK.md](./FRAMEWORK.md#what-changed-schema--programs).

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

const backends = [
  new MessageDataClient(new MemoryStore()),
  new PostgresStore({ connection, tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000 }),
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
const pg = new PostgresStore({
  connection: "postgresql://user:pass@localhost:5432/db",
  tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000,
}, executor);
await pg.initializeSchema();

// MongoDB
const mongo = new MongoStore({
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

A protocol's schema module exports the canonical program schema. The
`@bandeira-tech/b3nd-web` and `@bandeira-tech/b3nd-sdk` packages provide the
transport layer. Together they form the protocol SDK that app developers
consume — without knowing they're using B3nd underneath.

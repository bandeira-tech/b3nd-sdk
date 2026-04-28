# B3nd

A framework for building DePIN protocols. Wire up storage, define validation
rules, and get a running network — the Rig composes everything.

[Website](https://b3nd.dev) | [GitHub](https://github.com/bandeira-tech/b3nd) |
[JSR](https://jsr.io/@bandeira-tech/b3nd-sdk) |
[NPM](https://www.npmjs.com/package/@bandeira-tech/b3nd-web)

## The Rig

The Rig is B3nd's top-level abstraction. It wires storage, validation, and
behavior into a single object that speaks the universal protocol interface.

```typescript
import { connection, Identity, Rig } from "@bandeira-tech/b3nd-sdk/rig";
import { MemoryStore, MessageDataClient } from "@bandeira-tech/b3nd-sdk";

const rig = new Rig({
  connections: [
    connection(new MessageDataClient(new MemoryStore()), {
      receive: ["*"],
      read: ["*"],
    }),
  ],
});

// Write
await rig.receive([["mutable://open/greeting", {}, { text: "Hello" }]]);

// Read
const data = await rig.readData("mutable://open/greeting");
// → { text: "Hello" }
```

That's a working node. No config files, no database — just a rig with a memory
connection. Swap `MemoryStore` for `PostgresStore` and it's persistent. Add a
second connection and writes broadcast to both.

### Connections — Where Data Lives

Connections bind clients to URI patterns. The rig routes automatically: writes
broadcast to all matching connections, reads try each in order.

```typescript
const rig = new Rig({
  connections: [
    // Fast cache (tried first on reads)
    connection(memoryClient, {
      read: ["mutable://*", "hash://*"],
    }),

    // Persistent storage
    connection(postgresClient, {
      receive: ["mutable://*", "hash://*", "link://*"],
      read: ["mutable://*", "hash://*", "link://*"],
    }),

    // Local-only state (never leaves the device)
    connection(memoryClient, {
      receive: ["local://*"],
      read: ["local://*"],
    }),
  ],
});
```

### Programs — The Rules

Programs are pure functions that classify messages. A protocol defines them; the
rig dispatches to them by URI prefix.

```typescript
const rig = new Rig({
  connections: [...],
  programs: {
    "store://balance": balanceProgram,
    "proto://msg":     msgProgram,
  },
  handlers: {
    "proto:valid":     async (msg, broadcast) => { /* store opaquely */ },
    "proto:confirmed": async (msg, broadcast, read) => { /* apply state */ },
  },
});
```

Programs return codes (`"proto:valid"`, `"proto:confirmed"`, `"proto:invalid"`).
Handlers decide what each code means operationally. Same programs, different
handlers — that's how you get full nodes, light nodes, indexers, and mirrors
from one protocol definition.

### Identity — Sign and Encrypt

```typescript
const id = await Identity.fromSeed("my-secret");
const session = id.rig(rig);

// Signed envelope — content-addressed, authenticated
await session.send({
  inputs: [],
  outputs: [["mutable://accounts/" + id.pubkey + "/profile", {}, {
    name: "Alice",
  }]],
});

// Encrypted
await session.sendEncrypted({
  inputs: [],
  outputs: [["mutable://accounts/" + id.pubkey + "/private", {}, secret]],
});
```

### Hooks, Events, Reactions

The rig has three behavior layers beyond connections and programs:

```typescript
const rig = new Rig({
  connections: [...],
  hooks: {
    beforeReceive: (ctx) => { validateSchema(ctx); },  // throw to reject
    afterRead: (ctx, result) => { audit(ctx, result); },
  },
  on: {
    "send:success": [notifyPeers],
    "*:error": [alertOps],
  },
  reactions: {
    "mutable://app/users/:id": (uri, data, { id }) => {
      console.log(`User ${id} updated`);
    },
  },
});
```

- **Hooks** are synchronous gates — throw to reject, observe after
- **Events** are async fire-and-forget — never block the caller
- **Reactions** are URI-pattern triggers on successful writes

### HTTP API

The rig is pure orchestration. Transport is external:

```typescript
import { httpApi } from "@bandeira-tech/b3nd-sdk/rig/http";

const api = httpApi(rig);
Deno.serve({ port: 9942 }, api);
```

One function — returns a standard `(Request) => Promise<Response>` handler.
Works with Deno.serve, Hono, Express, Cloudflare Workers.

---

## Framework Layers

```
┌─────────────────────────────────────────────┐
│  App          (UX, domain logic, display)    │
├─────────────────────────────────────────────┤
│  Protocol     (programs, handlers, URI       │
│                conventions, consensus)        │
├─────────────────────────────────────────────┤
│  B3nd         (rig, connections, storage,    │
│                transport, crypto primitives)  │
└─────────────────────────────────────────────┘
```

**Protocol designers** use B3nd to define programs and handlers — the rules for
their network. This is B3nd's primary audience.

**App developers** use a protocol SDK built on B3nd. They call `send()`,
`read()`, `list()` and don't need to know the framework internals.

**Infrastructure operators** run rigs loaded with a protocol's programs. They
choose connections (backends), manage replication, handle uptime.

## Packages

| Package                                                                          | Registry | Use Case       |
| -------------------------------------------------------------------------------- | -------- | -------------- |
| [@bandeira-tech/b3nd-sdk](https://jsr.io/@bandeira-tech/b3nd-sdk)                | JSR      | Deno, servers  |
| [@bandeira-tech/b3nd-web](https://www.npmjs.com/package/@bandeira-tech/b3nd-web) | NPM      | Browser, React |

```typescript
// Deno/Server
import { connection, Identity, Rig } from "@bandeira-tech/b3nd-sdk/rig";
import {
  HttpClient,
  MemoryStore,
  MessageDataClient,
  PostgresStore,
} from "@bandeira-tech/b3nd-sdk";

// Browser/React
import { connection, Identity, Rig } from "@bandeira-tech/b3nd-web/rig";
import { HttpClient, IndexedDBStore } from "@bandeira-tech/b3nd-web";
```

## Storage Backends

| Store                | Environment | Backend               |
| -------------------- | ----------- | --------------------- |
| `MemoryStore`        | Any         | In-memory             |
| `PostgresStore`      | Deno/Node   | PostgreSQL            |
| `MongoStore`         | Deno/Node   | MongoDB               |
| `SqliteStore`        | Deno/Node   | SQLite                |
| `FsStore`            | Deno/Node   | Local filesystem      |
| `S3Store`            | Deno/Node   | S3-compatible storage |
| `IpfsStore`          | Deno/Node   | IPFS via Kubo         |
| `ElasticsearchStore` | Deno/Node   | Elasticsearch         |
| `LocalStorageStore`  | Browser     | localStorage          |
| `IndexedDBStore`     | Browser     | IndexedDB             |

## Transport Clients

| Client            | Environment | Backend                     |
| ----------------- | ----------- | --------------------------- |
| `HttpClient`      | Any         | Remote HTTP node            |
| `WebSocketClient` | Any         | Remote WebSocket node       |
| `ConsoleClient`   | Any         | Console output (write-only) |

All clients implement `ProtocolInterfaceNode`. The rig itself also satisfies
this interface — pass it anywhere a client is expected.

## Running a Node

The prebuilt node binary (`apps/b3nd-node/`) configures a rig from environment
variables:

| Variable        | Description              | Example                         |
| --------------- | ------------------------ | ------------------------------- |
| `BACKEND_URL`   | Comma-separated backends | `memory://`, `postgresql://...` |
| `SCHEMA_MODULE` | Path to protocol schema  | `./my-protocol-schema.ts`       |
| `PORT`          | Listen port              | `9942`                          |
| `CORS_ORIGIN`   | Allowed origins          | `*`                             |

```bash
# Memory (no dependencies)
PORT=9942 BACKEND_URL=memory:// deno run -A apps/b3nd-node/mod.ts

# PostgreSQL
PORT=9942 BACKEND_URL=postgresql://b3nd:b3nd@localhost:5432/b3nd deno run -A apps/b3nd-node/mod.ts

# Hybrid (memory cache + postgres persistence)
BACKEND_URL=memory://,postgresql://b3nd:b3nd@localhost:5432/b3nd

# Docker
docker run -p 9942:9942 -e BACKEND_URL=memory:// -e PORT=9942 -e CORS_ORIGIN=* \
  ghcr.io/bandeira-tech/b3nd/b3nd-node:latest
```

Multiple backends: **writes broadcast to all**, **reads try each in order**.

## Development

```bash
make test-unit              # Run tests
deno check src/mod.ts       # Type check
npm run build               # Build npm package
make version v=X.Y.Z        # Version + publish
```

## Project Structure

```
src/           # SDK entry points (mod.ts, mod.web.ts)
libs/          # Core libraries (rig, clients, compose, encrypt, etc.)
apps/          # Deployables (b3nd-node, vault-listener, web-rig)
skills/        # Framework documentation for AI agents
```

## Learn More

- [skills/b3nd/](skills/b3nd/) — Framework reference, protocol design, node
  operations, and architecture documents

## License

MIT

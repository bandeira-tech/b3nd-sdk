# Designing Protocols

Recipes for deploying and packaging DePIN protocols built on B3nd.

For protocol examples (open CRUD, auth-based, content-addressed, fee collection,
UTXO conservation, hash-chain, consensus chain), see the Protocol Examples
section in [FRAMEWORK.md](./FRAMEWORK.md).

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

### Wiring a Rig + transport server

The umbrella SDK exposes the Rig and `createServers()`. The transport
servers themselves are separate JSR packages from
[`bandeira-tech/b3nd-servers`](https://github.com/bandeira-tech/b3nd-servers)
— pull only the ones you need:

```typescript
import {
  Rig,
  connection,
  createServers,
  MemoryStore,
  SimpleClient,
} from "@bandeira-tech/b3nd-sdk";
import { httpServer } from "@bandeira-tech/b3nd-server-http";
// Optional: also serve gRPC
// import { grpcServer } from "@bandeira-tech/b3nd-grpc/server";
import schema from "./schema.ts";

const client = new SimpleClient(new MemoryStore());
const rig = new Rig({
  routes: {
    receive: [connection(client, ["*"])],
    read:    [connection(client, ["*"])],
  },
  programs: schema,
});

const servers = createServers(rig, [
  httpServer({ port: 43100, cors: "*" }),
  // grpcServer({ port: 50051 }),
]);
await Promise.all(servers.map((s) => s.start()));
```

If you're embedding B3nd in an existing Hono app, the underlying `httpApi`
helper from `@bandeira-tech/b3nd-core` returns a plain
`(Request) => Promise<Response>` you can mount yourself — see the Rig's HTTP
API section in [FRAMEWORK.md](./FRAMEWORK.md).

### Multi-Backend Composition

```typescript
import { flood, peer } from "@bandeira-tech/b3nd-sdk/network";
import { httpServer } from "@bandeira-tech/b3nd-server-http";

const backends = [
  new MessageDataClient(new MemoryStore()),
  new PostgresStore({
    connection,
    tablePrefix: "b3nd",
    poolSize: 5,
    connectionTimeout: 10000,
  }),
];
const composed = flood(backends.map((c, i) => peer(c, { id: `local-${i}` })));

const client = createValidatedClient({
  write: composed,
  read: composed,
  validate: msgSchema(schema),
});

const rig = new Rig({
  routes: { receive: [connection(client, ["*"])], read: [connection(client, ["*"])] },
});
const servers = createServers(rig, [httpServer({ port: 43100 })]);
await Promise.all(servers.map((s) => s.start()));
```

### PostgreSQL / MongoDB Setup

```typescript
// Postgres
const pg = new PostgresStore({
  connection: "postgresql://user:pass@localhost:5432/db",
  tablePrefix: "b3nd",
  poolSize: 5,
  connectionTimeout: 10000,
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
import { HttpClient, message } from "@bandeira-tech/b3nd-sdk";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";

// 1. Schema export (for node operators)
export const schema: Schema = {
  "mutable://open": async () => ({ valid: true }),
  "hash://sha256": hashValidator(),
  "link://open": async ([_uri, value]) => {
    if (typeof value !== "string") {
      return { valid: false, error: "Must be string" };
    }
    return { valid: true };
  },
};

// 2. Pre-configured client
export function createClient(url = "https://my-protocol-node.example.com") {
  return new HttpClient({ url });
}

// 3. Typed helpers
export async function writeNote(
  client: HttpClient,
  path: string,
  content: object,
) {
  const envelope = await message({
    inputs: [],
    outputs: [[`mutable://open/${path}`, content]],
  });
  const results = await client.receive([envelope]);
  return { uri: envelope[0], ...results[0] };
}

// 4. URI builders
export function noteUri(path: string) {
  return `mutable://open/${path}`;
}
```

A protocol's schema module exports the canonical program schema. The
`@bandeira-tech/b3nd-web` and `@bandeira-tech/b3nd-sdk` packages provide the
transport layer. Together they form the protocol SDK that app developers consume
— without knowing they're using B3nd underneath.

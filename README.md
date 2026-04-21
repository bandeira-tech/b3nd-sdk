# B3nd

A framework for building DePIN protocols. B3nd provides URI-addressed resources,
schema-driven validation, and cryptographic primitives. You define the rules —
what data is allowed, who can write where, how messages are validated — and B3nd
handles the rest: dispatch, storage composition, transport, and encryption.

Protocols are built on B3nd. Apps are built on protocols.

[Website](https://b3nd.dev) | [GitHub](https://github.com/bandeira-tech/b3nd) |
[JSR](https://jsr.io/@bandeira-tech/b3nd-sdk) |
[NPM](https://www.npmjs.com/package/@bandeira-tech/b3nd-web)

## The Framework in 30 Seconds

Every piece of data has a URI. Programs validate what can be written where.
Four operations do everything:

```typescript
const client = new HttpClient({ url: "http://localhost:9942" });

// Write — submit a message [uri, values, data]
await client.receive([["mutable://open/my-app/greeting", {}, {
  text: "Hello, world",
}]]);

// Read — get data from any URI
const result = await client.read("mutable://open/my-app/greeting");
console.log(result.record?.data); // { text: "Hello, world" }

// List — browse URIs by prefix
const items = await client.list("mutable://open/my-app/");

// Delete — remove data
await client.delete("mutable://open/my-app/greeting");
```

The URI scheme determines which program validates the message. `mutable://open`
is a permissive program that accepts anything — useful for prototyping. Real
protocols define their own programs with authentication, conservation rules,
and custom validation logic.

## What You Build With B3nd

B3nd is the foundation layer. Here's how the pieces stack:

```
┌─────────────────────────────────────────────┐
│  App          (UX, auth flows, data display) │
├─────────────────────────────────────────────┤
│  Protocol     (programs, validation rules,   │
│                URI conventions, consensus)    │
├─────────────────────────────────────────────┤
│  B3nd         (framework: dispatch, storage, │
│                transport, crypto primitives)  │
└─────────────────────────────────────────────┘
```

**Protocol designers** use B3nd to define programs — the rules for their
network. What URIs exist, who can write to them, how messages are validated.

**App developers** use B3nd + a protocol SDK to build applications. They don't
need to know the framework internals — just `receive()`, `read()`, `list()`.

**Infrastructure operators** run B3nd nodes with a protocol's schema loaded.
They choose backends, manage replication, and handle uptime.

## Packages

| Package                                                                          | Registry | Use Case       |
| -------------------------------------------------------------------------------- | -------- | -------------- |
| [@bandeira-tech/b3nd-sdk](https://jsr.io/@bandeira-tech/b3nd-sdk)                | JSR      | Deno, servers  |
| [@bandeira-tech/b3nd-web](https://www.npmjs.com/package/@bandeira-tech/b3nd-web) | NPM      | Browser, React |

```typescript
// Deno/Server
import {
  ConsoleClient,
  MessageDataClient,
  HttpClient,
  MemoryStore,
  PostgresStore,
  S3Store,
  SqliteStore,
} from "@bandeira-tech/b3nd-sdk";

// Browser/React
import {
  HttpClient,
  IndexedDBStore,
  LocalStorageStore,
  WalletClient,
} from "@bandeira-tech/b3nd-web";
```

## Quick Start

### Define a Protocol

A protocol is a set of programs that validate messages:

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { authValidation, createPubkeyBasedAccess } from "@bandeira-tech/b3nd-sdk/auth";

const schema: Schema = {
  // Open program — anyone can write
  "mutable://open": async () => ({ valid: true }),

  // Auth program — only the key holder can write
  "mutable://accounts": async ([uri, value]) => {
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator([uri, value]);
    return { valid: isValid, error: isValid ? undefined : "Auth failed" };
  },
};
```

### Run a Node

```typescript
import { createServerNode, MessageDataClient, MemoryStore, servers } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

const client = new MessageDataClient(new MemoryStore());
const app = new Hono();
const frontend = servers.httpServer(app);
createServerNode({ frontend, client, schema }).listen(9942);
```

### Use It

```typescript
const client = new HttpClient({ url: "http://localhost:9942" });

await client.receive([["mutable://open/notes/1", {}, { text: "Hello" }]]);
const result = await client.read("mutable://open/notes/1");
```

## Architecture

The framework separates storage from protocol logic:

- **Stores** handle mechanical read/write (MemoryStore, PostgresStore, S3Store, etc.)
- **Protocol clients** wrap a Store to implement `NodeProtocolInterface` (MessageDataClient, SimpleClient)
- **Transport clients** talk to remote nodes (HttpClient, WebSocketClient, ConsoleClient)

```typescript
// Store-backed: choose your storage, wrap with a protocol client
const client = new MessageDataClient(new MemoryStore());

// Transport: connect to a remote node
const remote = new HttpClient({ url: "https://api.example.com" });
```

### Stores

| Store                | Environment | Backend               |
| -------------------- | ----------- | --------------------- |
| `MemoryStore`        | Any         | In-memory             |
| `PostgresStore`      | Deno/Node   | PostgreSQL database   |
| `MongoStore`         | Deno/Node   | MongoDB database      |
| `SqliteStore`        | Deno/Node   | SQLite database       |
| `FsStore`            | Deno/Node   | Local filesystem      |
| `S3Store`            | Deno/Node   | S3-compatible storage |
| `IpfsStore`          | Deno/Node   | IPFS via Kubo         |
| `ElasticsearchStore` | Deno/Node   | Elasticsearch         |
| `LocalStorageStore`  | Browser     | localStorage          |
| `IndexedDBStore`     | Browser     | IndexedDB             |

### Transport Clients

| Client            | Environment | Backend                     |
| ----------------- | ----------- | --------------------------- |
| `HttpClient`      | Any         | Remote HTTP server          |
| `WebSocketClient` | Any         | Remote WebSocket server     |
| `ConsoleClient`   | Any         | Console output (write-only) |

## Running a Node

The B3nd node lives in `apps/b3nd-node/`. Configuration is via environment
variables:

| Variable        | Description              | Example                                                                         |
| --------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `BACKEND_URL`   | Comma-separated backends | `memory://`, `postgresql://...`, `sqlite://...`, `s3://bucket`, or combinations |
| `SCHEMA_MODULE` | Path to protocol schema  | `./my-protocol-schema.ts`                                                       |
| `PORT`          | Listen port              | `9942`                                                                          |
| `CORS_ORIGIN`   | Allowed origins          | `*`                                                                             |

When multiple backends are listed, **writes broadcast to all** and **reads try
each in order** until one succeeds.

### Memory only (no dependencies)

```bash
cd apps/b3nd-node
cp .env.example .env   # BACKEND_URL=memory://
deno task dev           # http://localhost:9942
```

### With PostgreSQL

```bash
# Ephemeral test DBs (Postgres :55432, Mongo :57017)
make up p=test

# — or — persistent dev DBs (Postgres :5432, Mongo :27017)
make up p=dev
```

Then set `.env`:

```bash
# Test DB
BACKEND_URL=postgresql://postgres:postgres@localhost:55432/b3nd_test

# Dev DB
BACKEND_URL=postgresql://b3nd:b3nd@localhost:5432/b3nd
```

```bash
cd apps/b3nd-node
deno task dev
```

The node auto-creates the required tables on first connect.

### With SQLite

No containers needed — SQLite runs embedded:

```bash
BACKEND_URL=sqlite:///tmp/b3nd.sqlite
```

### With S3 (MinIO)

```bash
make up p=dev   # Starts MinIO on :9000 (console on :9001)
make node-s3    # B3nd node with S3 backend
```

Or configure manually:

```bash
BACKEND_URL=s3://b3nd
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
```

### Memory + PostgreSQL (hybrid)

```bash
BACKEND_URL=memory://,postgresql://postgres:postgres@localhost:55432/b3nd_test
```

### Docker (production)

```bash
make pkg target=b3nd-node
docker run -p 9942:9942 \
  -e BACKEND_URL=memory:// \
  -e SCHEMA_MODULE=./my-protocol-schema.ts \
  -e PORT=9942 \
  -e CORS_ORIGIN=* \
  ghcr.io/bandeira-tech/b3nd/b3nd-node:latest
```

### Verify

```bash
curl http://localhost:9942/api/v1/health
```

## Development

```bash
# Run tests
make test-unit

# Type check
deno check src/mod.ts

# Build npm package
npm run build

# Publish
make version v=X.Y.Z
make publish
```

## Project Structure

```
src/           # SDK entry points (mod.ts, mod.web.ts)
libs/          # Core libraries (clients, compose, encrypt, etc.)
apps/          # Server applications (b3nd-node, vault-listener, etc.)
tests/         # E2E tests
skills/        # Claude Code plugin skills
```

## Claude Code Plugin

The B3nd plugin provides a unified `b3nd` skill for AI-assisted development:

```bash
claude mcp add b3nd -- npx -y @anthropic-ai/mcp-b3nd
```

MCP tools: `b3nd_read`, `b3nd_receive`, `b3nd_list`, `b3nd_delete`,
`b3nd_health`

## Learn More

- [AGENTS.md](AGENTS.md) — Agent reference, architecture, and development
  workflows
- [skills/b3nd/](skills/b3nd/) — Framework reference, protocol design,
  node operations, and design documents

## License

MIT

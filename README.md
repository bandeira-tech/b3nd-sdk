# B3nd

A protocol for URI-based data where users own their data, privacy is
encryption, and any app can read the same addresses.

[Website](https://b3nd.dev) |
[GitHub](https://github.com/bandeira-tech/b3nd) |
[JSR](https://jsr.io/@bandeira-tech/b3nd-sdk) |
[NPM](https://www.npmjs.com/package/@bandeira-tech/b3nd-web)

## The Protocol in 30 Seconds

Every piece of data has a URI. Four operations do everything:

```typescript
const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });

// Write — submit a message to a URI
await client.receive(["mutable://open/my-app/greeting", { text: "Hello, world" }]);

// Read — get data from any URI
const result = await client.read("mutable://open/my-app/greeting");
console.log(result.record?.data); // { text: "Hello, world" }

// List — browse URIs by prefix
const items = await client.list("mutable://open/my-app/");

// Delete — remove data
await client.delete("mutable://open/my-app/greeting");
```

URIs define behavior (mutable, immutable, encrypted), not meaning. The same
protocol works for profiles, posts, configs, messages — any data.

## Packages

| Package | Registry | Use Case |
|---------|----------|----------|
| [@bandeira-tech/b3nd-sdk](https://jsr.io/@bandeira-tech/b3nd-sdk) | JSR | Deno, servers |
| [@bandeira-tech/b3nd-web](https://www.npmjs.com/package/@bandeira-tech/b3nd-web) | NPM | Browser, React |

```typescript
// Deno/Server
import { HttpClient, MemoryClient, PostgresClient } from "@bandeira-tech/b3nd-sdk";

// Browser/React
import { HttpClient, WalletClient, LocalStorageClient } from "@bandeira-tech/b3nd-web";
```

## Quick Start

```typescript
const client = new HttpClient({ url: "http://localhost:9942" });

// Write
await client.receive(["mutable://users/alice/profile", { name: "Alice", age: 30 }]);

// Read
const result = await client.read("mutable://users/alice/profile");
console.log(result.record?.data); // { name: "Alice", age: 30 }

// List
const items = await client.list("mutable://users/");
console.log(items.data); // [{ uri: "mutable://users/alice/profile" }]

// Delete
await client.delete("mutable://users/alice/profile");
```

## Available Clients

| Client | Environment | Backend |
|--------|-------------|---------|
| `MemoryClient` | Any | In-memory storage |
| `HttpClient` | Any | Remote HTTP server |
| `WebSocketClient` | Any | Remote WebSocket server |
| `PostgresClient` | Deno/Node | PostgreSQL database |
| `MongoClient` | Deno/Node | MongoDB database |
| `LocalStorageClient` | Browser | localStorage |
| `IndexedDBClient` | Browser | IndexedDB |

## Running a Node

The B3nd node lives in `apps/b3nd-node/`. Configuration is via `.env`:

| Variable | Description | Example |
|----------|-------------|---------|
| `BACKEND_URL` | Comma-separated backends | `memory://`, `postgresql://...`, or both |
| `SCHEMA_MODULE` | Path to schema file | `./example-schema.ts` |
| `PORT` | Listen port | `9942` |
| `CORS_ORIGIN` | Allowed origins | `*` |

When multiple backends are listed, **writes broadcast to all** and **reads try each
in order** until one succeeds.

### Memory only (no dependencies)

```bash
cd apps/b3nd-node
cp .env.example .env   # BACKEND_URL=memory://
deno task dev           # http://localhost:9942
```

### With PostgreSQL

Start a Postgres container, then point the node at it:

```bash
# Ephemeral test DBs (Postgres :55432, Mongo :57017)
make compose-test-up

# — or — persistent dev DBs (Postgres :5432, Mongo :27017)
make compose-dev-up
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

### Memory + PostgreSQL (hybrid)

Combine backends for fast reads with persistent fallback:

```bash
BACKEND_URL=memory://,postgresql://postgres:postgres@localhost:55432/b3nd_test
```

### Docker (production)

```bash
make pkg target=b3nd-node
docker run -p 9942:9942 \
  -e BACKEND_URL=memory:// \
  -e SCHEMA_MODULE=./example-schema.ts \
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
apps/          # Server applications (b3nd-node, wallet-node, etc.)
tests/         # E2E tests
skills/        # Claude Code plugin skills
```

## Claude Code Plugin

The B3nd plugin provides a unified `b3nd` skill for AI-assisted development:

```bash
claude mcp add b3nd -- npx -y @anthropic-ai/mcp-b3nd
```

MCP tools: `b3nd_read`, `b3nd_receive`, `b3nd_list`, `b3nd_delete`, `b3nd_health`

## Learn More

- [AGENTS.md](AGENTS.md) — Agent reference, architecture, and development workflows
- Protocol philosophy: URIs express behavior (mutability, authentication), not
  meaning. Higher-level features are workflows on canonical protocols.

## License

MIT

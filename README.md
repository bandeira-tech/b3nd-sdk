# B3nd SDK

Universal persistence SDK with URI-based data addressing, encryption, and multi-backend support.

## Packages

| Package | Registry | Use Case |
|---------|----------|----------|
| [@bandeira-tech/b3nd-sdk](https://jsr.io/@bandeira-tech/b3nd-sdk) | JSR | Deno, servers |
| [@bandeira-tech/b3nd-web](https://www.npmjs.com/package/@bandeira-tech/b3nd-web) | npm | Browser, React |

```typescript
// Deno/Server
import { HttpClient, MemoryClient, PostgresClient } from "@bandeira-tech/b3nd-sdk";

// Browser/React
import { HttpClient, WalletClient, LocalStorageClient } from "@bandeira-tech/b3nd-web";
```

## Quick Start

```typescript
const client = new HttpClient({ url: "http://localhost:8842" });

// Write data (receive a message)
await client.receive(["mutable://users/alice/profile", { name: "Alice", age: 30 }]);

// Read data
const result = await client.read("mutable://users/alice/profile");
console.log(result.record?.data); // { name: "Alice", age: 30 }

// List items
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

## Server Deployment

### Docker with PostgreSQL

```bash
cd apps/b3nd-node
docker-compose up -d
```

### Deno

```bash
cd apps/b3nd-node
deno task dev
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
```

## Claude Code Plugin

Install the B3nd plugin for AI-assisted development:

```bash
claude mcp add b3nd -- npx -y @anthropic-ai/mcp-b3nd
```

Included skills: `b3nd-general`, `b3nd-sdk`, `b3nd-web`, `b3nd-webapp`, `b3nd-denocli`

MCP tools: `b3nd_read`, `b3nd_receive`, `b3nd_list`, `b3nd_delete`, `b3nd_health`

## License

MIT

---
name: b3nd-sdk
description: Deno/JSR package @bandeira-tech/b3nd-sdk for servers. Use when importing from JSR, setting up B3nd HTTP servers, using PostgresClient, MongoClient, MemoryClient, or building multi-backend Deno servers.
---

# @bandeira-tech/b3nd-sdk (Deno/JSR Package)

Full B3nd SDK for Deno and server-side applications.

## Installation

```typescript
// deno.json
{
  "imports": {
    "@bandeira-tech/b3nd-sdk": "jsr:@bandeira-tech/b3nd-sdk"
  }
}
```

Or import directly:

```typescript
import { MemoryClient } from "jsr:@bandeira-tech/b3nd-sdk";
```

## Package Info

- **Package name**: `@bandeira-tech/b3nd-sdk`
- **Registry**: JSR (jsr.io)
- **Entry point**: `./src/mod.ts`

## Main Exports

```typescript
import {
  // Clients
  MemoryClient,
  HttpClient,
  WebSocketClient,
  PostgresClient,
  MongoClient,

  // Server primitives
  createServerNode,
  servers,
  wsservers,

  // Combinators
  parallelBroadcast,
  firstMatchSequence,

  // Postgres utilities
  generatePostgresSchema,
  generateCompleteSchemaSQL,
  extractSchemaVersion,

  // Crypto
  pemToCryptoKey,
  deriveObfuscatedPath,
} from "@bandeira-tech/b3nd-sdk";
```

## Subpath Exports

```typescript
// Types only
import type { Schema, NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk/types";

// Auth utilities
import { ... } from "@bandeira-tech/b3nd-sdk/auth";

// Encryption
import { ... } from "@bandeira-tech/b3nd-sdk/encrypt";

// Specific clients
import { MemoryClient } from "@bandeira-tech/b3nd-sdk/clients/memory";
import { HttpClient } from "@bandeira-tech/b3nd-sdk/clients/http";
import { WebSocketClient } from "@bandeira-tech/b3nd-sdk/clients/websocket";
import { PostgresClient } from "@bandeira-tech/b3nd-sdk/clients/postgres";

// Wallet client
import { WalletClient } from "@bandeira-tech/b3nd-sdk/wallet";

// Apps client
import { AppsClient } from "@bandeira-tech/b3nd-sdk/apps";
```

## Server Usage

### HTTP Server

```typescript
import { createServerNode, servers, MemoryClient } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

const schema = {
  "users": async ({ value }) => ({ valid: !!value }),
};

const backend = new MemoryClient({ schema });
const app = new Hono();
const frontend = servers.httpServer(app);

const node = createServerNode({ frontend, backend, schema });
node.listen(43100);
```

### Multi-Backend Server

```typescript
import {
  createServerNode,
  servers,
  parallelBroadcast,
  firstMatchSequence,
  MemoryClient,
  PostgresClient,
} from "@bandeira-tech/b3nd-sdk";

const clients = [
  new MemoryClient({ schema }),
  new PostgresClient({ connection, schema, tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000 }),
];

const writeBackend = parallelBroadcast(clients);  // Write to all
const readBackend = firstMatchSequence(clients);  // Read from first success

const backend = { write: writeBackend, read: readBackend };
```

### PostgreSQL Client

```typescript
import { PostgresClient, generateCompleteSchemaSQL } from "@bandeira-tech/b3nd-sdk";

const pg = new PostgresClient({
  connection: "postgresql://user:pass@localhost:5432/db",
  schema,
  tablePrefix: "b3nd",
  poolSize: 5,
  connectionTimeout: 10000,
}, executor);

await pg.initializeSchema();
```

### MongoDB Client

```typescript
import { MongoClient } from "@bandeira-tech/b3nd-sdk";

const mongo = new MongoClient({
  connectionString: "mongodb://localhost:27017/mydb",
  schema,
  collectionName: "b3nd_data",
}, executor);
```

## Development Tasks

```bash
# Run tests
deno task test

# Lint
deno task lint

# Format
deno task fmt

# Type check
deno task check

# Publish to JSR
deno task publish:jsr
```

## Types

```typescript
import type {
  Schema,
  ValidationFn,
  NodeProtocolInterface,
  NodeProtocolWriteInterface,
  NodeProtocolReadInterface,
  MemoryClientConfig,
  HttpClientConfig,
  WebSocketClientConfig,
  PostgresClientConfig,
  MongoClientConfig,
  ReadResult,
  WriteResult,
  ListResult,
  DeleteResult,
  ListItem,
  ListOptions,
  PersistenceRecord,
  HealthStatus,
  ClientError,
} from "@bandeira-tech/b3nd-sdk";
```

## Key Differences from b3nd-web

| Feature | b3nd-sdk | b3nd-web |
|---------|----------|----------|
| Target | Deno/JSR | Browser/NPM |
| PostgresClient | Yes | No |
| MongoClient | Yes | No |
| LocalStorageClient | No | Yes |
| Server primitives | Full | Limited |
| Auth module | Yes | No |

## Source Files

- `sdk/src/mod.ts` - Main Deno exports
- `sdk/src/types.ts` - Type definitions
- `sdk/clients/postgres/mod.ts` - PostgreSQL client
- `sdk/clients/mongo/mod.ts` - MongoDB client
- `sdk/servers/node.ts` - Server node creation
- `sdk/servers/http.ts` - HTTP server utilities
- `sdk/servers/websocket.ts` - WebSocket server utilities

## Environment Variables (HTTP Server Installation)

```bash
PORT=43100
CORS_ORIGIN=*
BACKEND_URL=postgres://user:pass@localhost:5432/db
SCHEMA_MODULE=./my-schema.ts
```

Multiple backends supported:

```bash
BACKEND_URL=memory://,postgres://...,http://other-node:9942
```

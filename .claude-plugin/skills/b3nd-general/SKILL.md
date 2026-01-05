---
name: b3nd-general
description: B3nd universal persistence protocol and SDK architecture. Use when working with B3nd data layer, URI schemes, clients, servers, schemas, or wallet authentication.
---

# B3nd SDK - Universal Persistence Protocol

B3nd provides a universal client/server persistence protocol with multiple backend support.

## Core Concepts

### URI Scheme

All data is addressed via URIs: `protocol://domain/path`

```typescript
// Examples
"mutable://users/alice/profile"
"immutable://content/hash123"
"events://app/user-actions"
```

### NodeProtocolInterface

All clients implement this interface:

```typescript
interface NodeProtocolInterface {
  write<T>(uri: string, value: T): Promise<WriteResult<T>>;
  read<T>(uri: string): Promise<ReadResult<T>>;
  list(uri: string, options?: ListOptions): Promise<ListResult>;
  delete(uri: string): Promise<DeleteResult>;
  health(): Promise<HealthStatus>;
  getSchema(): Promise<string[]>;
  cleanup(): Promise<void>;
}
```

### Schema & Validation

Schema maps protocol keys to validation functions:

```typescript
const schema: Schema = {
  "users": async ({ uri, value, read }) => {
    if (!value || typeof value !== "object") {
      return { valid: false, error: "Invalid user data" };
    }
    return { valid: true };
  },
};
```

## Available Clients

| Client | Import | Use Case |
|--------|--------|----------|
| `MemoryClient` | `@bandeira-tech/b3nd-sdk` | Testing, in-memory storage |
| `HttpClient` | Both packages | Connect to HTTP API |
| `WebSocketClient` | Both packages | Real-time connections |
| `LocalStorageClient` | `@bandeira-tech/b3nd-web` | Browser local storage |
| `PostgresClient` | `@bandeira-tech/b3nd-sdk` | Postgres backend |
| `MongoClient` | `@bandeira-tech/b3nd-sdk` | MongoDB backend |

## Combinators

Compose multiple backends:

```typescript
import { parallelBroadcast, firstMatchSequence } from "@bandeira-tech/b3nd-sdk";

// Writes go to all backends
const writeBackend = parallelBroadcast([client1, client2]);

// Reads try backends in order until success
const readBackend = firstMatchSequence([client1, client2]);
```

## Server Setup

Create HTTP or WebSocket servers:

```typescript
import { createServerNode, servers } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

const app = new Hono();
const frontend = servers.httpServer(app);
const node = createServerNode({ frontend, backend, schema });
node.listen(8080);
```

## Wallet & Authentication

For authenticated writes and encryption:

```typescript
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";

const wallet = new WalletClient({
  walletServerUrl: "http://localhost:3001",
  apiBasePath: "/api/v1",
});

// Signup/login, then proxy writes with encryption
await wallet.proxyWrite({
  uri: "mutable://data/my-app/profile",
  data: { name: "Alice" },
  encrypt: true
});
```

## Project Structure

```
sdk/
  src/           # Core types and entry points
  clients/       # Client implementations (memory, http, websocket, postgres, mongo)
  servers/       # Server primitives (http, websocket)
  wallet/        # Wallet client for auth
  wallet-server/ # Wallet server implementation
  apps/          # Apps client
  encrypt/       # Encryption utilities
  auth/          # Authentication utilities

installations/
  http-server/   # Deployable HTTP server
  wallet-server/ # Deployable wallet server
```

## Key Files

- `sdk/src/mod.ts` - Main Deno/JSR exports
- `sdk/src/mod.web.ts` - Browser/NPM exports
- `sdk/src/types.ts` - Core type definitions
- `installations/http-server/mod.ts` - HTTP server example with multi-backend support

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

## Resource Visibility Strategy

B3nd enables private, protected, and public resources through deterministic key generation and client-side encryption. The network stores encrypted data; access control is cryptographic.

### Visibility Levels

| Level | Key Derivation | Access |
|-------|---------------|--------|
| **Private** | `SALT:uri:ownerPubkey` | Owner only (uses account pubkey as password) |
| **Protected** | `SALT:uri:password` | Anyone with password |
| **Public** | `SALT:uri:""` | Anyone with URI (empty password) |

### Deterministic Key Derivation

Keys are derived from location + secret, never stored:

```typescript
async function deriveResourceKey(
  uri: string,
  password: string = ""
): Promise<string> {
  const seed = `${APP_SALT}:${uri}:${password}`;
  return await deriveKeyFromSeed(seed, APP_SALT, 100000); // PBKDF2
}
```

### Resource Identity with Keypairs

Each resource has an Ed25519 keypair for identity and signing:

```typescript
interface ResourceKeyBundle {
  publicKeyHex: string;   // Resource address/identity
  privateKeyHex: string;  // For signing writes (owner only)
}

// Resource URI uses pubkey: mutable://accounts/{resourcePubkey}/data
```

### Encryption Pattern

```typescript
// 1. Derive symmetric key from location + password
const key = await deriveResourceKey(uri, password);

// 2. Encrypt data
const encrypted = await encrypt(data, key);

// 3. Sign with resource's private key
const signed = await sign(encrypted, resourcePrivateKey);

// 4. Write to network
await client.write(uri, signed);
```

### Visibility-Aware Access

```typescript
async function loadResource(pubkey: string, visibility: Visibility, password: string) {
  const uri = `mutable://accounts/${pubkey}/data`;
  const signed = await client.read(uri);
  const encrypted = extractPayload(signed);

  // Derive key based on visibility
  const decryptPassword = visibility === "private"
    ? ownerAccountPubkey  // Private: owner's pubkey as password
    : password;           // Protected/Public: user-provided (or empty)

  const data = await tryDecrypt(encrypted, uri, decryptPassword);
  return data; // null if wrong password
}
```

### Index Storage Pattern

User's resource index stored encrypted at their account:

```typescript
// At: mutable://accounts/{userPubkey}/resources
interface UserResourceEntry {
  resourcePubkey: string;
  resourcePrivateKeyHex: string;  // For signing
  visibility: "private" | "protected" | "public";
}
```

### Security Properties

- **Passwords never stored** - only used to derive keys via KDF
- **Wrong password = no access** - decryption fails, returns null
- **Deterministic keys** - same URI + password = same key
- **Strong KDF** - 100,000 PBKDF2 iterations
- **Signed data** - Ed25519 prevents tampering
- **Network assumes no trust** - all data encrypted client-side

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

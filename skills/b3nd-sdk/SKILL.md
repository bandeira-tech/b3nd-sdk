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

## Blob and Link Module

The SDK includes a dedicated blob module for content-addressed storage and URI references.

```typescript
import {
  computeSha256,        // Hash any value (Uint8Array or JSON)
  generateBlobUri,      // Generate blob://open/sha256:{hash} URI
  parseBlobUri,         // Parse blob URI to extract algorithm and hash
  validateLinkValue,    // Validate link is a valid URI string
  generateLinkUri,      // Generate link://accounts/{pubkey}/{path} URI
  isValidSha256Hash,    // Check if string is valid 64-char hex hash
  verifyBlobContent,    // Verify content matches its blob URI
} from "@bandeira-tech/b3nd-sdk/blob";
```

### Hash Computation (for Blobs)

```typescript
import { computeSha256, generateBlobUri } from "@bandeira-tech/b3nd-sdk/blob";

// Compute SHA256 hash of any value
const data = { title: "Hello", content: "World" };
const hash = await computeSha256(data);
// Returns: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

// Generate blob URI
const blobUri = generateBlobUri(hash);
// Returns: "blob://open/sha256:2cf24dba..."
```

### Link Validation

```typescript
import { validateLinkValue, generateLinkUri } from "@bandeira-tech/b3nd-sdk/blob";

// Validate that a value is a valid link (string URI)
const result = validateLinkValue("blob://open/sha256:abc123...");
// Returns: { valid: true }

const invalid = validateLinkValue({ target: "blob://..." });
// Returns: { valid: false, error: "Link value must be a string URI" }

// Generate authenticated link URI
const linkUri = generateLinkUri(pubkeyHex, "files/avatar.png");
// Returns: "link://accounts/{pubkey}/files/avatar.png"
```

### Schema Validators

```typescript
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { computeSha256, validateLinkValue } from "@bandeira-tech/b3nd-sdk/blob";

const schema: Schema = {
  // Content-addressed blob storage
  "blob://open": async ({ uri, value }) => {
    const url = new URL(uri);
    const match = url.pathname.match(/^\/sha256:([a-f0-9]{64})$/i);
    if (!match) return { valid: false, error: "Invalid blob URI" };

    const expectedHash = match[1];
    const actualHash = await computeSha256(value);

    if (actualHash !== expectedHash) {
      return { valid: false, error: "Hash mismatch" };
    }
    return { valid: true };
  },

  // Authenticated links (signature-verified)
  "link://accounts": async ({ uri, value }) => {
    // Verify signature first, then validate link value
    // (See auth module for signature verification)
    return validateLinkValue(value);
  },

  // Unauthenticated links
  "link://open": async ({ uri, value }) => {
    return validateLinkValue(value);
  },
};
```

## Encryption Module

The SDK includes a comprehensive encryption module for client-side encryption.

```typescript
import {
  // Key generation
  generateSigningKeyPair,      // Ed25519 for signing
  generateEncryptionKeyPair,   // X25519 for encryption

  // Asymmetric encryption (ECDH + AES-GCM)
  encrypt,                     // Encrypt to recipient's public key
  decrypt,                     // Decrypt with private key

  // Symmetric encryption (AES-GCM)
  encryptSymmetric,           // Encrypt with hex key
  decryptSymmetric,           // Decrypt with hex key

  // Key derivation
  deriveKeyFromSeed,          // PBKDF2-SHA256 (100k iterations)

  // Signing
  sign,
  verify,
  signWithHex,

  // Authenticated messages
  createAuthenticatedMessage,
  createAuthenticatedMessageWithHex,
  createSignedEncryptedMessage,
  verifyAndDecryptMessage,
} from "@bandeira-tech/b3nd-sdk/encrypt";
```

### Encrypted Blob Pattern

```typescript
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";
import { computeSha256 } from "./validators.ts";

// Private blob (encrypted to recipient)
const data = { secret: "private content" };
const encrypted = await encrypt.encrypt(data, recipientPublicKeyHex);
const hash = await computeSha256(encrypted);
await client.write(`blob://open/sha256:${hash}`, encrypted);

// Protected blob (password-encrypted)
const key = await encrypt.deriveKeyFromSeed(password, salt, 100000);
const encrypted = await encrypt.encryptSymmetric(data, key);
const hash = await computeSha256(encrypted);
await client.write(`blob://open/sha256:${hash}`, encrypted);
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
  LinkValue,        // string - URI reference
  BlobData,         // { type?, encoding?, data }
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

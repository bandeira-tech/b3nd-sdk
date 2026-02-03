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

  // Unified Node system
  createNode,
  // Composition utilities
  seq,
  any,
  all,
  parallel,
  pipeline,
  firstMatch,
  // Built-in validators
  schemaValidator,
  txnSchema,
  format,
  uriPattern,
  requireFields,
  accept,
  reject,
  // Built-in processors
  emit,
  when,
  log,
  noop,

  // Transaction data
  isTransactionData,

  // Server primitives
  createServerNode,
  servers,
  wsservers,

  // Legacy combinators
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
import type { Schema, NodeProtocolInterface, Node, Transaction, ReceiveResult } from "@bandeira-tech/b3nd-sdk/types";

// Node system
import { createNode, seq, parallel, txnSchema, schemaValidator } from "@bandeira-tech/b3nd-sdk/node";

// Transaction data utilities
import { isTransactionData } from "@bandeira-tech/b3nd-sdk/txn-data";
import type { TransactionData } from "@bandeira-tech/b3nd-sdk/txn-data";

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

## Unified Node System

All state changes flow through a single `receive(tx)` interface. The unified node pattern:

```typescript
import { createNode, txnSchema, parallel, firstMatch } from "@bandeira-tech/b3nd-sdk";

const schema = {
  "mutable://users": async ({ value }) => ({ valid: !!value?.name }),
  "txn://open": async () => ({ valid: true }),
};

// Create unified node — clients are passed directly to parallel()
const node = createNode({
  read: firstMatch(postgresClient, memoryClient),
  validate: txnSchema(schema),
  process: parallel(postgresClient, memoryClient),
});

// Plain transactions
const result = await node.receive(["mutable://users/alice", { name: "Alice" }]);
// result: { accepted: true } or { accepted: false, error: "..." }

// Transaction envelopes — outputs are unpacked and stored individually by each client
const txResult = await node.receive(["txn://open/batch-1", {
  inputs: [],
  outputs: [
    ["mutable://users/alice", { name: "Alice" }],
    ["mutable://users/bob", { name: "Bob" }],
  ],
}]);
// Each output stored at its own URI, readable via client.read("mutable://users/alice")
```

### TransactionData Convention

Transaction envelopes wrap multiple writes into a single atomic-intent operation:

```typescript
import type { TransactionData } from "@bandeira-tech/b3nd-sdk";

const txData: TransactionData = {
  inputs: ["mutable://open/ref/1"],  // References (for future UTXO support)
  outputs: [                          // Each [uri, data] pair gets stored individually
    ["mutable://open/users/alice", { name: "Alice" }],
    ["mutable://open/users/bob", { name: "Bob" }],
  ],
};

await node.receive(["txn://open/my-batch", txData]);
```

- `txnSchema(schema)` validates the envelope URI AND each output against its program's schema
- Each client's `receive()` detects TransactionData and stores outputs individually
- The envelope itself is also stored at its `txn://` URI as an audit trail
- Plain (non-TransactionData) transactions work unchanged

### Composition Utilities

```typescript
// Validators
seq(v1, v2)      // Sequential, stops on first failure
any(v1, v2)      // First to pass wins
all(v1, v2)      // All must pass (parallel)

// Processors — accept Processor functions or receivers (clients) directly
parallel(c1, c2)   // Parallel, at least one must succeed
pipeline(p1, p2)   // Sequential, all must succeed
when(cond, proc)   // Conditional processing
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
  // Core types
  Schema,
  ValidationFn,
  NodeProtocolInterface,
  NodeProtocolWriteInterface,
  NodeProtocolReadInterface,
  // Node types
  Node,
  NodeConfig,
  Transaction,
  ReceiveResult,
  ReadInterface,
  Validator,
  Processor,
  // Client configs
  MemoryClientConfig,
  HttpClientConfig,
  WebSocketClientConfig,
  PostgresClientConfig,
  MongoClientConfig,
  // Results
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

## List Interface

`list()` returns flat results — all stored URIs matching the prefix. No directory/file type distinction:

```typescript
interface ListItem {
  uri: string;  // Full stored URI
}

const result = await client.list("mutable://users/");
// result.data = [{ uri: "mutable://users/alice/profile" }, { uri: "mutable://users/bob/profile" }]
```

## MCP Tools (Claude Plugin)

When the B3nd plugin is installed, agents can use MCP tools directly: `b3nd_receive`, `b3nd_read`, `b3nd_list`, `b3nd_delete`, `b3nd_health`, `b3nd_schema`, `b3nd_backends_list`, `b3nd_backends_switch`, `b3nd_backends_add`.

## bnd CLI Tool

The B3nd CLI (`cli/bnd`) provides command-line access: `./cli/bnd read <uri>`, `./cli/bnd list <uri>`, `./cli/bnd config`.

## Developer Dashboard

```bash
cd explorer/dashboard && deno task dashboard:build  # Build test artifacts
cd explorer/app && npm run dev                      # http://localhost:5555/dashboard
```

Browse test results by theme, view source code with line numbers, search across 125 tests.

## Source Files

- `sdk/src/mod.ts` - Main Deno exports
- `sdk/src/types.ts` - Type definitions
- `sdk/src/node/types.ts` - Node/Transaction/Validator types
- `sdk/clients/postgres/mod.ts` - PostgreSQL client
- `sdk/clients/mongo/mod.ts` - MongoDB client
- `sdk/servers/node.ts` - Server node creation
- `sdk/servers/http.ts` - HTTP server utilities
- `sdk/servers/websocket.ts` - WebSocket server utilities
- `sdk/tests/shared-suite.ts` - Shared client conformance suite
- `sdk/tests/node-suite.ts` - Node interface test suite

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

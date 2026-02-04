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
  accept,
  all,
  any,
  // Deprecated (still exported for backward compat)
  createNode,
  // Server primitives
  createServerNode,
  // Validated client composition
  createValidatedClient,
  deriveObfuscatedPath,
  emit,
  extractSchemaVersion,
  firstMatch,
  firstMatchSequence,
  format,
  // FunctionalClient (custom behavior without class inheritance)
  FunctionalClient,
  generateCompleteSchemaSQL,
  // Postgres utilities
  generatePostgresSchema,
  HttpClient,
  // Message data
  isMessageData,
  log,
  // Clients
  MemoryClient,
  MongoClient,
  // Validators
  msgSchema,
  noop,
  parallel,
  // Client combinators
  parallelBroadcast,
  // Crypto
  pemToCryptoKey,
  pipeline,
  PostgresClient,
  reject,
  requireFields,
  schemaValidator,
  seq,
  servers,
  uriPattern,
  WebSocketClient,
  when,
  wsservers,
} from "@bandeira-tech/b3nd-sdk";
```

## Subpath Exports

```typescript
// Types only
import type { Schema, NodeProtocolInterface, Node, Message, ReceiveResult } from "@bandeira-tech/b3nd-sdk/types";

// Node system
import { createNode, seq, parallel, msgSchema, schemaValidator } from "@bandeira-tech/b3nd-sdk/node";

// Message data utilities
import { isMessageData } from "@bandeira-tech/b3nd-sdk/msg-data";
import type { MessageData } from "@bandeira-tech/b3nd-sdk/msg-data";

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

## Client Composition

All state changes flow through a single `receive(msg)` interface. Use
`createValidatedClient` to compose clients with validation:

```typescript
import {
  createValidatedClient,
  firstMatchSequence,
  msgSchema,
  parallelBroadcast,
} from "@bandeira-tech/b3nd-sdk";

const schema = {
  "mutable://users": async ({ value }) => ({ valid: !!value?.name }),
  "msg://open": async () => ({ valid: true }),
};

// Compose a validated client from multiple backends
const client = createValidatedClient({
  write: parallelBroadcast([postgresClient, memoryClient]),
  read: firstMatchSequence([postgresClient, memoryClient]),
  validate: msgSchema(schema),
});

// Plain messages
const result = await client.receive(["mutable://users/alice", {
  name: "Alice",
}]);
// result: { accepted: true } or { accepted: false, error: "..." }

// Message envelopes — outputs are unpacked and stored individually by each client
const msgResult = await client.receive(["msg://open/batch-1", {
  inputs: [],
  outputs: [
    ["mutable://users/alice", { name: "Alice" }],
    ["mutable://users/bob", { name: "Bob" }],
  ],
}]);
// Each output stored at its own URI, readable via client.read("mutable://users/alice")
```

For custom behavior without class inheritance, use `FunctionalClient`:

```typescript
import { FunctionalClient } from "@bandeira-tech/b3nd-sdk";

const client = new FunctionalClient({
  receive: async (msg) => backend.receive(msg),
  read: async (uri) => backend.read(uri),
  list: async (uri, options) => backend.list(uri, options),
});
```

### MessageData Convention

Message envelopes wrap multiple operations into a single atomic-intent message:

```typescript
import type { MessageData } from "@bandeira-tech/b3nd-sdk";

const msgData: MessageData = {
  inputs: ["mutable://open/ref/1"], // References (for future UTXO support)
  outputs: [ // Each [uri, data] pair gets stored individually
    ["mutable://open/users/alice", { name: "Alice" }],
    ["mutable://open/users/bob", { name: "Bob" }],
  ],
};

await node.receive(["msg://open/my-batch", msgData]);
```

- `msgSchema(schema)` validates the envelope URI AND each output against its
  program's schema
- Each client's `receive()` detects MessageData and stores outputs individually
- The envelope itself is also stored at its `msg://` URI as an audit trail
- Plain (non-MessageData) messages work unchanged

### Composition Utilities

```typescript
// Validators
seq(v1, v2); // Sequential, stops on first failure
any(v1, v2); // First to pass wins
all(v1, v2); // All must pass (parallel)

// Client combinators
parallelBroadcast(clients); // Broadcast writes to all, read from first
firstMatchSequence(clients); // Try clients in order until one succeeds
```

## Server Usage

### HTTP Server

```typescript
import {
  createServerNode,
  MemoryClient,
  servers,
} from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

const schema = {
  "mutable://users": async ({ value }) => ({ valid: !!value }),
};

const client = new MemoryClient({ schema });
const app = new Hono();
const frontend = servers.httpServer(app);

// New simplified config — just pass the client
const node = createServerNode({ frontend, client });
node.listen(43100);
```

### Multi-Backend Server

```typescript
import {
  createServerNode,
  createValidatedClient,
  firstMatchSequence,
  MemoryClient,
  msgSchema,
  parallelBroadcast,
  PostgresClient,
  servers,
} from "@bandeira-tech/b3nd-sdk";

const clients = [
  new MemoryClient({ schema }),
  new PostgresClient({
    connection,
    schema,
    tablePrefix: "b3nd",
    poolSize: 5,
    connectionTimeout: 10000,
  }),
];

// Compose a validated client from multiple backends
const client = createValidatedClient({
  write: parallelBroadcast(clients),
  read: firstMatchSequence(clients),
  validate: msgSchema(schema),
});

const frontend = servers.httpServer(app);
createServerNode({ frontend, client });
```

### PostgreSQL Client

```typescript
import {
  generateCompleteSchemaSQL,
  PostgresClient,
} from "@bandeira-tech/b3nd-sdk";

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

The SDK includes a dedicated blob module for content-addressed storage and URI
references.

```typescript
import {
  computeSha256, // Hash any value (Uint8Array or JSON)
  generateBlobUri, // Generate blob://open/sha256:{hash} URI
  generateLinkUri, // Generate link://accounts/{pubkey}/{path} URI
  isValidSha256Hash, // Check if string is valid 64-char hex hash
  parseBlobUri, // Parse blob URI to extract algorithm and hash
  validateLinkValue, // Validate link is a valid URI string
  verifyBlobContent, // Verify content matches its blob URI
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
import {
  generateLinkUri,
  validateLinkValue,
} from "@bandeira-tech/b3nd-sdk/blob";

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
  // Authenticated messages
  createAuthenticatedMessage,
  createAuthenticatedMessageWithHex,
  createSignedEncryptedMessage,
  decrypt, // Decrypt with private key
  decryptSymmetric, // Decrypt with hex key
  // Key derivation
  deriveKeyFromSeed, // PBKDF2-SHA256 (100k iterations)
  // Asymmetric encryption (ECDH + AES-GCM)
  encrypt, // Encrypt to recipient's public key
  // Symmetric encryption (AES-GCM)
  encryptSymmetric, // Encrypt with hex key
  generateEncryptionKeyPair, // X25519 for encryption
  // Key generation
  generateSigningKeyPair, // Ed25519 for signing
  // Signing
  sign,
  signWithHex,
  verify,
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
await client.receive(["msg://open/store-private-blob", {
  inputs: [],
  outputs: [[`blob://open/sha256:${hash}`, encrypted]],
}]);

// Protected blob (password-encrypted)
const key = await encrypt.deriveKeyFromSeed(password, salt, 100000);
const encrypted = await encrypt.encryptSymmetric(data, key);
const hash = await computeSha256(encrypted);
await client.receive(["msg://open/store-protected-blob", {
  inputs: [],
  outputs: [[`blob://open/sha256:${hash}`, encrypted]],
}]);
```

## Types

```typescript
import type {
  BlobData,
  ClientError,
  DeleteResult,
  // FunctionalClient config
  FunctionalClientConfig,
  HealthStatus,
  HttpClientConfig,
  LinkValue,
  ListItem,
  ListOptions,
  ListResult,
  // Client configs
  MemoryClientConfig,
  Message,
  MongoClientConfig,
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  PersistenceRecord,
  PostgresClientConfig,
  // Results
  ReadResult,
  ReceiveResult,
  // Core types
  Schema,
  ValidationFn,
  // Compose types
  Validator,
  WebSocketClientConfig,
  WriteResult,
} from "@bandeira-tech/b3nd-sdk";
```

## Key Differences from b3nd-web

| Feature            | b3nd-sdk | b3nd-web    |
| ------------------ | -------- | ----------- |
| Target             | Deno/JSR | Browser/NPM |
| PostgresClient     | Yes      | No          |
| MongoClient        | Yes      | No          |
| LocalStorageClient | No       | Yes         |
| Server primitives  | Full     | Limited     |
| Auth module        | Yes      | No          |

## List Interface

`list()` returns flat results — all stored URIs matching the prefix. No
directory/file type distinction:

```typescript
interface ListItem {
  uri: string; // Full stored URI
}

const result = await client.list("mutable://users/");
// result.data = [{ uri: "mutable://users/alice/profile" }, { uri: "mutable://users/bob/profile" }]
```

## MCP Tools (Claude Plugin)

When the B3nd plugin is installed, agents can use MCP tools directly:
`b3nd_receive`, `b3nd_read`, `b3nd_list`, `b3nd_delete`, `b3nd_health`,
`b3nd_schema`, `b3nd_backends_list`, `b3nd_backends_switch`,
`b3nd_backends_add`.

## bnd CLI Tool

The B3nd CLI (`apps/b3nd-cli/bnd`) provides command-line access:
`./apps/b3nd-cli/bnd read <uri>`, `./apps/b3nd-cli/bnd list <uri>`,
`./apps/b3nd-cli/bnd config`.

## Developer Dashboard

```bash
cd apps/sdk-inspector && deno task dashboard:build  # Build test artifacts
cd apps/b3nd-web-rig && npm run dev                      # http://localhost:5555/dashboard
```

Browse test results by theme, view source code with line numbers, search across
125 tests.

## Source Files

- `libs/b3nd-sdk/src/mod.ts` - Main Deno exports (facade, re-exports from
  sibling libs)
- `libs/b3nd-core/types.ts` - Type definitions
- `libs/b3nd-compose/types.ts` - Node/Message/Validator types
- `libs/b3nd-client-postgres/mod.ts` - PostgreSQL client
- `libs/b3nd-client-mongo/mod.ts` - MongoDB client
- `libs/b3nd-servers/node.ts` - Server node creation
- `libs/b3nd-servers/http.ts` - HTTP server utilities
- `libs/b3nd-servers/websocket.ts` - WebSocket server utilities
- `libs/b3nd-testing/shared-suite.ts` - Shared client conformance suite
- `libs/b3nd-testing/node-suite.ts` - Node interface test suite

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

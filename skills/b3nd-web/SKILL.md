---
name: b3nd-web
description: NPM package @bandeira-tech/b3nd-web for browsers. Use when importing B3nd from npm, using HttpClient/WalletClient/LocalStorageClient in browser, or building frontend apps with B3nd persistence.
---

# @bandeira-tech/b3nd-web (NPM Package)

Browser-focused B3nd SDK distribution for React, Vue, and other frontend frameworks.

## Installation

```bash
npm install @bandeira-tech/b3nd-web
```

## Package Info

- **Package name**: `@bandeira-tech/b3nd-web`
- **Entry point**: `./dist/src/mod.web.js`
- **Node version**: `>=24.11.1`

## Main Exports

```typescript
import {
  HttpClient,
  WebSocketClient,
  LocalStorageClient,
  WalletClient,
  encrypt
} from "@bandeira-tech/b3nd-web";
```

## Subpath Exports

```typescript
// Specific client imports
import { HttpClient } from "@bandeira-tech/b3nd-web/clients/http";
import { LocalStorageClient } from "@bandeira-tech/b3nd-web/clients/local-storage";
import { WebSocketClient } from "@bandeira-tech/b3nd-web/clients/websocket";
import { MemoryClient } from "@bandeira-tech/b3nd-web/clients/memory";

// Wallet
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";

// Encryption
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

// Wallet server (for browser-based wallet servers)
import { WalletServerCore } from "@bandeira-tech/b3nd-web/wallet-server";
import { BrowserAdapter } from "@bandeira-tech/b3nd-web/wallet-server/adapters/browser";
```

## Browser Client Usage

### HttpClient

```typescript
import { HttpClient } from "@bandeira-tech/b3nd-web";

const client = new HttpClient({ url: "https://api.example.com" });

// Submit transaction
const result = await client.receive(["txn://open/update-profile", {
  inputs: [],
  outputs: [["users://alice/profile", { name: "Alice" }]],
}]);
if (result.accepted) {
  console.log("Transaction accepted");
}

// Read data
const readResult = await client.read("users://alice/profile");
if (readResult.success) {
  console.log(readResult.record.data);
}

// List items
const list = await client.list("users://", { limit: 10 });
```

### LocalStorageClient

```typescript
import { LocalStorageClient } from "@bandeira-tech/b3nd-web/clients/local-storage";

const local = new LocalStorageClient({
  keyPrefix: "myapp_",
  schema: { /* optional validation */ }
});

await local.receive(["txn://local/update-settings", {
  inputs: [],
  outputs: [["settings://theme", { dark: true }]],
}]);
```

### WalletClient

```typescript
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";

const wallet = new WalletClient({
  walletServerUrl: "https://wallet.example.com",
  apiBasePath: "/api/v1",
});

// Login and get session
const session = await wallet.login(appKey, { username, password });
wallet.setSession(session);

// Proxy transaction with encryption
await wallet.proxyWrite({
  uri: "mutable://data/profile",
  data: { name: "Alice" },
  encrypt: true
});

// Proxy read with auto-decryption
const data = await wallet.proxyRead({
  uri: "mutable://data/profile"
});
```


## Blob and Link Usage (Browser)

### Blob Module

```typescript
import {
  computeSha256,        // Hash any value (Uint8Array or JSON)
  generateBlobUri,      // Generate blob://open/sha256:{hash} URI
  validateLinkValue,    // Validate link is a valid URI string
  generateLinkUri,      // Generate link://accounts/{pubkey}/{path} URI
  verifyBlobContent,    // Verify content matches its blob URI
} from "@bandeira-tech/b3nd-web/blob";
```

### Content-Addressed Blobs

```typescript
import { HttpClient } from "@bandeira-tech/b3nd-web";
import { computeSha256, generateBlobUri } from "@bandeira-tech/b3nd-web/blob";

const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });

// Store blob + link in one transaction
const data = { title: "Hello", content: "World" };
const hash = await computeSha256(data);
const blobUri = generateBlobUri(hash);

await client.receive(["txn://open/store-content", {
  inputs: [],
  outputs: [
    [blobUri, data],
    ["link://open/my-content", blobUri],
  ],
}]);
```

### Authenticated Links with Wallet

```typescript
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";

// Authenticated link (requires wallet session)
await wallet.proxyWrite({
  uri: `link://accounts/${userPubkey}/avatar`,
  data: "blob://open/sha256:abc123...",
  encrypt: false
});
```

### Encrypted Blobs (Private Data)

```typescript
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { computeSha256, generateBlobUri } from "@bandeira-tech/b3nd-web/blob";

// 1. Generate encryption keypair
const { publicKey, privateKey } = await encrypt.generateEncryptionKeyPair();

// 2. Encrypt data
const privateData = { secret: "my private content" };
const encrypted = await encrypt.encrypt(privateData, publicKey.publicKeyHex);

// 3. Hash encrypted payload and store
const hash = await computeSha256(encrypted);
const blobUri = generateBlobUri(hash);
await client.receive(["txn://open/store-encrypted", {
  inputs: [],
  outputs: [[blobUri, encrypted]],
}]);

// 4. Later: decrypt with private key
const result = await client.read(blobUri);
const decrypted = await encrypt.decrypt(result.record.data, privateKey);
```

### Password-Protected Blobs

```typescript
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { computeSha256, generateBlobUri } from "@bandeira-tech/b3nd-web/blob";

// Encrypt with password
const key = await encrypt.deriveKeyFromSeed(password, "my-salt", 100000);
const encrypted = await encrypt.encryptSymmetric(data, key);

// Store encrypted blob
const hash = await computeSha256(encrypted);
const blobUri = generateBlobUri(hash);
await client.receive(["txn://open/store-protected", {
  inputs: [],
  outputs: [[blobUri, encrypted]],
}]);

// Decrypt with same password
const key = await encrypt.deriveKeyFromSeed(password, "my-salt", 100000);
const decrypted = await encrypt.decryptSymmetric(encrypted, key);
```

## Types

```typescript
import type {
  HttpClientConfig,
  LocalStorageClientConfig,
  WebSocketClientConfig,
  NodeProtocolInterface,
  ReadResult,
  ReceiveResult,
  ListResult,
  DeleteResult,
  PersistenceRecord,
  Schema,
  ValidationFn,
  LinkValue,        // string - URI reference
  BlobData,         // { type?, encoding?, data }
} from "@bandeira-tech/b3nd-web";
```

## Key Differences from b3nd-sdk

| Feature | b3nd-web | b3nd-sdk |
|---------|----------|----------|
| Target | Browser/NPM | Deno/JSR |
| PostgresClient | No | Yes |
| MongoClient | No | Yes |
| LocalStorageClient | Yes | No |
| IndexedDBClient | Yes (browser) | No |
| Server primitives | Limited | Full |

## Build

```bash
cd sdk
npm run build  # Uses tsup
```

## List Interface

`list()` returns flat results — all stored URIs matching the prefix. No directory/file type distinction:

```typescript
interface ListItem {
  uri: string;  // Full stored URI
}
```

## MCP Tools (Claude Plugin)

When the B3nd plugin is installed, agents can use MCP tools directly to interact with backends: `b3nd_receive`, `b3nd_read`, `b3nd_list`, `b3nd_delete`, `b3nd_health`, `b3nd_schema`.

## Source Files

- `sdk/src/mod.web.ts` - Main web exports
- `sdk/clients/http/mod.ts` - HTTP client
- `sdk/clients/local-storage/mod.ts` - LocalStorage client
- `sdk/wallet/mod.ts` - Wallet client
- `sdk/apps/mod.ts` - Apps client

---
name: b3nd-general
description: B3nd SDK and Firecat network - URI schemes, resource visibility, encryption, wallet auth. Use when asking about B3nd, Firecat, mutable/immutable protocols, accounts, open data, private/protected/public resources, deterministic keys, client-side encryption.
---

# B3nd SDK & Firecat Network

## B3nd vs Firecat

**B3nd** is the protocol and SDK - software you can run anywhere. **Firecat** is
the public network running B3nd nodes - the default for most apps.

| Concept | B3nd                       | Firecat         |
| ------- | -------------------------- | --------------- |
| What    | Protocol + SDK             | Public network  |
| Like    | HTTP protocol              | The Internet    |
| Use     | Local dev, private servers | Production apps |

**Default: Connect to Firecat** unless you need a private deployment.

```typescript
// Connect to Firecat (production)
const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });

// Or local B3nd node
const client = new HttpClient({ url: "http://localhost:9942" });
```

## Firecat Endpoints

| Service       | URL                                  |
| ------------- | ------------------------------------ |
| Backend Node  | `https://testnet-evergreen.fire.cat` |
| Wallet Server | `https://testnet-wallet.fire.cat`    |
| App Server    | `https://testnet-app.fire.cat`       |

## Canonical Firecat Schema

**Use these protocols** - don't create custom schemas unless you're running your
own network.

### Available Protocols

| Protocol               | Access                | Use Case                           |
| ---------------------- | --------------------- | ---------------------------------- |
| `mutable://open`       | Anyone                | Public data, no auth needed        |
| `mutable://accounts`   | Pubkey-signed         | User data, requires wallet auth    |
| `immutable://open`     | Anyone, once          | Content-addressed, no overwrites   |
| `immutable://accounts` | Pubkey-signed, once   | Permanent user data                |
| `immutable://inbox`    | Message inbox         | Suggestions, notifications         |
| `blob://open`          | Anyone, hash-verified | Content-addressed storage (SHA256) |
| `link://open`          | Anyone                | Unauthenticated URI references     |
| `link://accounts`      | Pubkey-signed writes  | Authenticated URI references       |

### Protocol Patterns

```typescript
// Transaction delivering data to multiple protocols
await client.receive(["txn://open/setup-batch", {
  inputs: [],
  outputs: [
    ["mutable://open/my-app/config", { theme: "dark" }],
    ["immutable://open/content/abc123", { title: "Post" }],
  ],
}]);

// Each output is stored at its own URI
const config = await client.read("mutable://open/my-app/config");

// User account data (requires wallet signature)
await wallet.proxyWrite({
  uri: "mutable://accounts/{userPubkey}/profile",
  data: { name: "Alice" },
  encrypt: false,
});

// Private inbox message
await wallet.proxyWrite({
  uri: "immutable://inbox/{recipientPubkey}/messages/{timestamp}",
  data: suggestion,
  encrypt: true,
});
```

### Blob Protocol (Content-Addressed Storage)

Blobs are content-addressed using SHA256 hashes. The hash in the URI must match
the content.

```typescript
import { computeSha256 } from "./validators.ts"; // or implement your own

// Compute hash and store blob via transaction
const data = { title: "Hello", content: "World" };
const hash = await computeSha256(data);
const blobUri = `blob://open/sha256:${hash}`;

await client.receive(["txn://open/store-blob", {
  inputs: [],
  outputs: [[blobUri, data]],
}]);

// Read blob - content verified by hash
const result = await client.read(blobUri);
```

**Key Properties:**

- **Immutable**: Content cannot change (hash would change)
- **Deduplicated**: Same content = same URI
- **Trustless**: Anyone can verify content matches hash
- **Format**: `blob://open/sha256:<64-hex-chars>`

### Link Protocol (URI References)

Links are simple string values pointing to other URIs. They provide a mutable
reference layer.

```typescript
// Authenticated link (requires wallet signature)
await wallet.proxyWrite({
  uri: "link://accounts/{userPubkey}/avatar",
  data: "blob://open/sha256:abc123...", // Just a string URI!
  encrypt: false,
});

// Unauthenticated link via transaction
await client.receive(["txn://open/update-link", {
  inputs: [],
  outputs: [["link://open/latest-release", "blob://open/sha256:def456..."]],
}]);

// Read link to get target URI
const linkResult = await client.read<string>("link://accounts/alice/avatar");
const targetUri = linkResult.record.data; // "blob://open/sha256:abc123..."

// Then fetch the target
const blobResult = await client.read(targetUri);
```

**Key Properties:**

- **Simple Strings**: Link values are just URI strings, no complex objects
- **Mutable References**: Update link to point to new content
- **Authentication Layer**: `link://accounts` proves who created the reference
- **Deduplication**: Multiple links can point to the same blob

### Encrypted Blobs (Private Data on Public Networks)

To store private data on public networks, encrypt before hashing. The hash is
computed on the encrypted payload.

```typescript
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

// 1. Encrypt data with recipient's public key (asymmetric)
const privateData = { secret: "my private data" };
const encrypted = await encrypt.encrypt(privateData, recipientPublicKeyHex);

// 2. Compute hash of ENCRYPTED payload
const hash = await computeSha256(encrypted);
const blobUri = `blob://open/sha256:${hash}`;

// 3. Store encrypted blob via transaction
await client.receive(["txn://open/store-encrypted", {
  inputs: [],
  outputs: [[blobUri, encrypted]],
}]);

// 4. Recipient decrypts after reading
const result = await client.read(blobUri);
const decrypted = await encrypt.decrypt(
  result.record.data,
  recipientPrivateKey,
);
```

**Symmetric Encryption (Password-Based):**

```typescript
// Derive key from password
const key = await encrypt.deriveKeyFromSeed(password, salt, 100000);

// Encrypt with symmetric key
const encrypted = await encrypt.encryptSymmetric(data, key);

// Hash and store
const hash = await computeSha256(encrypted);
await client.receive(["txn://open/store-symmetric", {
  inputs: [],
  outputs: [[`blob://open/sha256:${hash}`, encrypted]],
}]);

// Decrypt with same password
const decrypted = await encrypt.decryptSymmetric(encrypted, key);
```

**Privacy Levels for Blobs:**

| Level     | Encryption Key                | Access               |
| --------- | ----------------------------- | -------------------- |
| Public    | None                          | Anyone can read      |
| Protected | Password-derived (PBKDF2)     | Anyone with password |
| Private   | Recipient's X25519 public key | Only recipient       |

### Blob + Link Pattern (Recommended)

Combine blobs (data layer) with links (reference layer):

```typescript
// 1. Store content as blob + create link in one transaction
const content = { title: "My Post", body: "..." };
const hash = await computeSha256(content);
const blobUri = `blob://open/sha256:${hash}`;

await client.receive(["txn://open/publish-post", {
  inputs: [],
  outputs: [
    [blobUri, content], // blob data
    ["link://open/posts/latest", blobUri], // link to blob
  ],
}]);

// 2. Update link to new version (blob is immutable, link is mutable)
const newContent = { title: "My Post v2", body: "..." };
const newHash = await computeSha256(newContent);
const newBlobUri = `blob://open/sha256:${newHash}`;

await client.receive(["txn://open/update-post", {
  inputs: [blobUri], // references previous version
  outputs: [
    [newBlobUri, newContent],
    ["link://open/posts/latest", newBlobUri], // points to new blob
  ],
}]);
```

### Accounts Protocol (Pubkey-Based Access)

The `mutable://accounts` and `immutable://accounts` protocols use signature
verification:

```typescript
// URI structure: {protocol}://accounts/{pubkey}/{path}
"mutable://accounts/052fee.../profile";
"mutable://accounts/052fee.../data";
"immutable://accounts/052fee.../posts/1";

// The pubkey in the URI determines who can submit transactions
// Transactions must be signed with the matching private key
```

## Transactions

All state changes flow through a single `receive(tx)` interface. A transaction
is a tuple `[uri, data]`:

```typescript
type Transaction<D = unknown> = [uri: string, data: D];

interface ReceiveResult {
  accepted: boolean;
  error?: string;
}
```

### Single-Output Transactions

A transaction with one output stores data at a single URI:

```typescript
const result = await client.receive(["txn://open/update-config", {
  inputs: [],
  outputs: [["mutable://open/my-app/config", { theme: "dark" }]],
}]);
// result: { accepted: true } or { accepted: false, error: "..." }

// Read it back
const config = await client.read("mutable://open/my-app/config");
```

### Transaction Envelopes (TransactionData)

Transaction envelopes wrap multiple operations into a single atomic-intent
transaction:

```typescript
import type { TransactionData } from "@bandeira-tech/b3nd-sdk";

const txData: TransactionData = {
  inputs: ["mutable://open/ref/1"], // References (for future UTXO support)
  outputs: [ // Each [uri, data] pair gets stored individually
    ["mutable://open/users/alice", { name: "Alice" }],
    ["mutable://open/users/bob", { name: "Bob" }],
  ],
};

await client.receive(["txn://open/my-batch", txData]);
// Each output stored at its own URI, readable via client.read("mutable://open/users/alice")
// The envelope itself is also stored at its txn:// URI as an audit trail
```

**Key properties:**

- `txnSchema(schema)` validates the envelope URI AND each output against its
  protocol's schema
- Each client's `receive()` detects TransactionData and stores outputs
  individually
- Plain (non-TransactionData) transactions work unchanged

## NodeProtocolInterface

All clients implement:

```typescript
interface NodeProtocolInterface {
  receive<D>(tx: Transaction<D>): Promise<ReceiveResult>;
  read<T>(uri: string): Promise<ReadResult<T>>;
  list(uri: string, options?: ListOptions): Promise<ListResult>;
  delete(uri: string): Promise<DeleteResult>;
  health(): Promise<HealthStatus>;
  getSchema(): Promise<string[]>;
  cleanup(): Promise<void>;
}
```

## Wallet Authentication

For `accounts` protocols, use WalletClient:

```typescript
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

const wallet = new WalletClient({
  walletServerUrl: "https://testnet-wallet.fire.cat",
  apiBasePath: "/api/v1",
});
```

**IMPORTANT:** Both signup AND login require an approved session keypair.

### Session Keypair Flow

The protocol supports local approval (same process) and remote approval (async
workflows):

```typescript
// Session flow - direct transactions to data node
// App needs its Ed25519 keypair (public key = appKey)

const backendClient = new HttpClient({ url: "http://localhost:9942" });

// App keys (Ed25519) - generate once, store securely
const APP_KEY = "app-public-key-hex"; // appKey = public key
const APP_PRIVATE_KEY = "app-private-key-hex";

// 1. Generate session keypair
const sessionKeypair = await encrypt.generateSigningKeyPair();

// 2. Client posts SIGNED request to inbox (proves session key ownership)
const requestPayload = { timestamp: Date.now() }; // add any app-specific fields
const signedRequest = await encrypt.createAuthenticatedMessageWithHex(
  requestPayload,
  sessionKeypair.publicKeyHex,
  sessionKeypair.privateKeyHex,
);
await backendClient.receive(["txn://open/session-request", {
  inputs: [],
  outputs: [[
    `immutable://inbox/${APP_KEY}/sessions/${sessionKeypair.publicKeyHex}`,
    signedRequest,
  ]],
}]);

// 3. App APPROVES session (value = 1, signed by app's key)
const signedApproval = await encrypt.createAuthenticatedMessageWithHex(
  1,
  APP_KEY,
  APP_PRIVATE_KEY,
);
await backendClient.receive(["txn://open/session-approve", {
  inputs: [],
  outputs: [[
    `mutable://accounts/${APP_KEY}/sessions/${sessionKeypair.publicKeyHex}`,
    signedApproval,
  ]],
}]);

// 4. Now signup or login works
const session = await wallet.signup(APP_KEY, sessionKeypair, {
  type: "password",
  username,
  password,
});
// or
const session = await wallet.login(APP_KEY, sessionKeypair, {
  type: "password",
  username,
  password,
});

wallet.setSession(session);
```

**That's it!** Just two transactions to the data node:

1. `immutable://inbox/{appKey}/sessions/{sessionPubkey}` - signed request
2. `mutable://accounts/{appKey}/sessions/{sessionPubkey}` - approval (value=1)

For remote/async approval, the app monitors the inbox and approves later.

### User Data

```typescript
// Send to accounts (signed automatically)
await wallet.proxyWrite({
  uri: "mutable://accounts/{userPubkey}/profile",
  data: { name: "Alice" },
  encrypt: true, // Optional encryption
});

// Read with decryption
const data = await wallet.proxyRead({
  uri: "mutable://accounts/{userPubkey}/profile",
});
```

## Resource Identity Pattern

**Every resource has its own Ed25519 keypair.** The public key becomes the
resource's permanent identity/address.

### Resource Keypair

```typescript
interface ResourceKeyBundle {
  publicKeyHex: string; // Resource ID/address
  privateKeyHex: string; // For signing transactions (owner stores this)
}

// Generate new resource identity
const resourceKeys = await generateSigningKeyPair();
const resourceId = resourceKeys.publicKeyHex;

// Resource lives at: mutable://accounts/{resourceId}/data
const resourceUri = `mutable://accounts/${resourceId}/data`;
```

### Key Storage in User Account

Resource private keys are stored **encrypted in the user's account index**:

```typescript
// User's resource index at: mutable://accounts/{userPubkey}/resources
interface UserResourceEntry {
  resourcePubkey: string; // Resource identity
  resourcePrivateKeyHex: string; // For signing (encrypted to user)
  visibility: "private" | "protected" | "public";
}

// Store index via wallet (encrypted to user's X25519 key)
await wallet.proxyWrite({
  uri: `mutable://accounts/${userPubkey}/resources`,
  data: { resources: entries },
  encrypt: true,
});
```

### User Account Structure

```
mutable://accounts/{userPubkey}/
├── profile          (encrypted to user - private settings)
├── public-profile   (encrypted with app key - discoverable)
├── resources        (encrypted to user - resource keys index)
└── executions       (encrypted to user - activity log)
```

## App Identity Pattern

Apps derive a **deterministic keypair** from the app key for app-owned shared
resources:

```typescript
// All app instances derive the same identity
const appIdentity = await deriveKeypairFromSeed(appKey);

// App owns shared indexes at:
// mutable://accounts/{appPubkey}/public-resources
// mutable://accounts/{appPubkey}/discovery-index
```

### App-Owned Resources

```typescript
// Public discovery index (app signs these entries)
const indexUri =
  `mutable://accounts/${appPubkey}/public-resources/${resourceId}`;

// Normalized entry - references only, no duplication
const entry = {
  resourcePubkey: resourceId,
  authorPubkey: userPubkey,
  publishedAt: Date.now(),
};

// Sign with app's key and submit as transaction
const signed = await sign(entry, appIdentity.privateKeyHex);
await client.receive(["txn://open/publish-resource", {
  inputs: [],
  outputs: [[indexUri, signed]],
}]);
```

## Public Discovery Index

Public resources are announced to app-owned indexes for discoverability:

```typescript
// Publish to discovery (normalized - no data duplication)
interface NormalizedIndexEntry {
  resourcePubkey: string; // Reference to resource
  authorPubkey: string; // Reference to author
  publishedAt: number;
}

// Browse discovery - batch resolve references
const entries = await client.list(
  `mutable://accounts/${appPubkey}/public-resources`,
);
const resourceIds = entries.map((e) => e.resourcePubkey);
const resources = await batchResolve(resourceIds); // Fetch actual data
```

## Meta Files

Public/protected resources store metadata for features like suggestions:

```typescript
// At: mutable://accounts/{resourcePubkey}/meta
interface ResourceMeta {
  suggestionPubkey: string; // Owner's X25519 key for encrypted suggestions
}

// Suggestions written to inbox
await wallet.proxyWrite({
  uri: `immutable://inbox/${resourcePubkey}/suggestions/${timestamp}`,
  data: suggestion,
  encrypt: true, // Encrypted to owner's suggestionPubkey
});
```

## Resource Visibility Strategy

Visibility is achieved through client-side encryption, not server access
control.

| Level         | Key Derivation         | Access                  |
| ------------- | ---------------------- | ----------------------- |
| **Private**   | `SALT:uri:ownerPubkey` | Owner only              |
| **Protected** | `SALT:uri:password`    | Anyone with password    |
| **Public**    | `SALT:uri:""`          | Anyone (empty password) |

### Deterministic Key Derivation

```typescript
async function deriveKey(uri: string, password: string = ""): Promise<string> {
  const seed = `${APP_SALT}:${uri}:${password}`;
  return await deriveKeyFromSeed(seed, APP_SALT, 100000); // PBKDF2
}
```

### Encryption Pattern

```typescript
// 1. Generate keypair for resource identity
const resourceKeys = generateKeypair();
const uri = `mutable://accounts/${resourceKeys.publicKeyHex}/data`;

// 2. Derive encryption key from visibility
const encryptKey = visibility === "private"
  ? ownerAccountPubkey // Private: owner's pubkey
  : (password || ""); // Protected/Public

// 3. Encrypt data
const encrypted = await encrypt(data, await deriveKey(uri, encryptKey));

// 4. Sign with resource key and send
await wallet.proxyWrite({ uri, data: signed(encrypted, resourceKeys) });
```

### Security Properties

- **Passwords never stored** - only used to derive keys
- **Wrong password = no access** - decryption fails
- **Deterministic** - same URI + password = same key
- **Network is untrusted** - all sensitive data encrypted client-side

## Available Clients

| Client               | Package                          | Use                                 |
| -------------------- | -------------------------------- | ----------------------------------- |
| `HttpClient`         | Both                             | Connect to Firecat or any HTTP node |
| `WalletClient`       | `@bandeira-tech/b3nd-web/wallet` | Authenticated transactions          |
| `LocalStorageClient` | `@bandeira-tech/b3nd-web`        | Browser offline cache               |
| `MemoryClient`       | `@bandeira-tech/b3nd-sdk`        | Testing                             |
| `PostgresClient`     | `@bandeira-tech/b3nd-sdk`        | PostgreSQL storage                  |
| `MongoClient`        | `@bandeira-tech/b3nd-sdk`        | MongoDB storage                     |

### List Interface

`list()` returns flat results — all stored URIs matching the prefix. No
directory/file type:

```typescript
interface ListItem {
  uri: string; // Full stored URI
}
```

## Packages

```typescript
// Browser/React (NPM)
import { HttpClient, WalletClient } from "@bandeira-tech/b3nd-web";

// Deno/Server (JSR)
import { HttpClient, MemoryClient } from "@bandeira-tech/b3nd-sdk";
```

## MCP Tools (Claude Plugin)

When the B3nd Claude plugin is installed, these MCP tools are available for
agents to interact with backends directly:

| Tool                   | Description                      |
| ---------------------- | -------------------------------- |
| `b3nd_receive`         | Submit transaction `[uri, data]` |
| `b3nd_read`            | Read data from URI               |
| `b3nd_list`            | List items at URI prefix         |
| `b3nd_delete`          | Delete data                      |
| `b3nd_health`          | Backend health check             |
| `b3nd_schema`          | Get available protocols          |
| `b3nd_backends_list`   | List configured backends         |
| `b3nd_backends_switch` | Switch active backend            |
| `b3nd_backends_add`    | Add new backend                  |

Configure: `export B3ND_BACKENDS="local=http://localhost:9942"`

## bnd CLI Tool

Command-line access to B3nd nodes at `apps/b3nd-cli/bnd`:

```bash
./apps/b3nd-cli/bnd read mutable://users/alice/profile
./apps/b3nd-cli/bnd list mutable://users/
./apps/b3nd-cli/bnd config
./apps/b3nd-cli/bnd conf node http://localhost:9942
```

## Developer Dashboard

Test results browser and source code explorer:

```bash
cd apps/sdk-inspector && deno task dashboard:build
cd apps/b3nd-web-rig && npm run dev  # http://localhost:5555/dashboard
```

Features: 125 tests across 8 test files, browsable by theme (SDK Core, Network,
Database, Auth, Binary, E2E), source code with line numbers.

## Explorer Web App

The React app at `apps/b3nd-web-rig/` provides:

- **Explorer** (`/explorer/*`) — Browse B3nd data by URI
- **Writer** (`/writer/*`) — Write data to B3nd nodes
- **Dashboard** (`/dashboard/*`) — Test results and code exploration
- **Accounts** (`/accounts`) — Account management
- **Settings** (`/settings`) — Backend configuration

## Custom Schemas (Enterprise)

Only create custom schemas if running your own B3nd network:

```typescript
// Enterprise/team deployment only
const schema: Schema = {
  "mutable://my-company": async ({ uri, value }) => {
    // Custom validation logic
    return { valid: true };
  },
};
```

Most apps should use the canonical Firecat schema protocols.

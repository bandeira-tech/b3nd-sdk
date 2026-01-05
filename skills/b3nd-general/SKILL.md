---
name: b3nd-general
description: B3nd SDK and Firecat network - URI schemes, resource visibility, encryption, wallet auth. Use when asking about B3nd, Firecat, mutable/immutable protocols, accounts, open data, private/protected/public resources, deterministic keys, client-side encryption.
---

# B3nd SDK & Firecat Network

## B3nd vs Firecat

**B3nd** is the protocol and SDK - software you can run anywhere.
**Firecat** is the public network running B3nd nodes - the default for most apps.

| Concept | B3nd | Firecat |
|---------|------|---------|
| What | Protocol + SDK | Public network |
| Like | HTTP protocol | The Internet |
| Use | Local dev, private servers | Production apps |

**Default: Connect to Firecat** unless you need a private deployment.

```typescript
// Connect to Firecat (production)
const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });

// Or local development
const client = new HttpClient({ url: "http://localhost:8842" });
```

## Firecat Endpoints

| Service | URL |
|---------|-----|
| Backend Node | `https://testnet-evergreen.fire.cat` |
| Wallet Server | `https://testnet-wallet.fire.cat` |
| App Server | `https://testnet-app.fire.cat` |

## Canonical Firecat Schema

**Use these protocols** - don't create custom schemas unless you're running your own network.

### Available Protocols

| Protocol | Access | Use Case |
|----------|--------|----------|
| `mutable://open` | Anyone can write | Public data, no auth needed |
| `mutable://accounts` | Pubkey-signed writes | User data, requires wallet auth |
| `immutable://open` | Anyone can write once | Content-addressed, no overwrites |
| `immutable://accounts` | Pubkey-signed, write once | Permanent user data |
| `immutable://inbox` | Message inbox | Suggestions, notifications |

### Protocol Patterns

```typescript
// Public data (no auth)
await client.write("mutable://open/my-app/config", { theme: "dark" });

// User account data (requires wallet signature)
await wallet.proxyWrite({
  uri: "mutable://accounts/{userPubkey}/profile",
  data: { name: "Alice" },
  encrypt: false
});

// Immutable content (can't overwrite)
await client.write("immutable://open/content/abc123", { title: "Post" });

// Private inbox message
await wallet.proxyWrite({
  uri: "immutable://inbox/{recipientPubkey}/messages/{timestamp}",
  data: suggestion,
  encrypt: true
});
```

### Accounts Protocol (Pubkey-Based Access)

The `mutable://accounts` and `immutable://accounts` protocols use signature verification:

```typescript
// URI structure: {protocol}://accounts/{pubkey}/{path}
"mutable://accounts/052fee.../profile"
"mutable://accounts/052fee.../data"
"immutable://accounts/052fee.../posts/1"

// The pubkey in the URI determines who can write
// Writes must be signed with the matching private key
```

## NodeProtocolInterface

All clients implement:

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

## Wallet Authentication

For `accounts` protocols, use WalletClient:

```typescript
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";

const wallet = new WalletClient({
  walletServerUrl: "https://testnet-wallet.fire.cat",
  apiBasePath: "/api/v1",
});

// Login
const session = await wallet.login(appKey, { username, password });
wallet.setSession(session);

// Write to accounts (signed automatically)
await wallet.proxyWrite({
  uri: "mutable://accounts/{userPubkey}/profile",
  data: { name: "Alice" },
  encrypt: true  // Optional encryption
});

// Read with decryption
const data = await wallet.proxyRead({
  uri: "mutable://accounts/{userPubkey}/profile"
});
```

## Resource Visibility Strategy

Visibility is achieved through client-side encryption, not server access control.

| Level | Key Derivation | Access |
|-------|---------------|--------|
| **Private** | `SALT:uri:ownerPubkey` | Owner only |
| **Protected** | `SALT:uri:password` | Anyone with password |
| **Public** | `SALT:uri:""` | Anyone (empty password) |

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
  ? ownerAccountPubkey      // Private: owner's pubkey
  : (password || "");        // Protected/Public

// 3. Encrypt data
const encrypted = await encrypt(data, await deriveKey(uri, encryptKey));

// 4. Sign with resource key and write
await wallet.proxyWrite({ uri, data: signed(encrypted, resourceKeys) });
```

### Security Properties

- **Passwords never stored** - only used to derive keys
- **Wrong password = no access** - decryption fails
- **Deterministic** - same URI + password = same key
- **Network is untrusted** - all sensitive data encrypted client-side

## Available Clients

| Client | Package | Use |
|--------|---------|-----|
| `HttpClient` | Both | Connect to Firecat or any HTTP node |
| `WalletClient` | `@bandeira-tech/b3nd-web/wallet` | Authenticated writes |
| `LocalStorageClient` | `@bandeira-tech/b3nd-web` | Browser offline cache |
| `MemoryClient` | `@bandeira-tech/b3nd-sdk` | Testing |

## Packages

```typescript
// Browser/React (NPM)
import { HttpClient, WalletClient } from "@bandeira-tech/b3nd-web";

// Deno/Server (JSR)
import { HttpClient, MemoryClient } from "@bandeira-tech/b3nd-sdk";
```

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

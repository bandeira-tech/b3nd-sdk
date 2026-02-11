---
name: b3nd
description: B3nd protocol and SDK for URI-based data persistence. Use when working with B3nd URIs, Firecat network, mutable/immutable programs, accounts, open data, encryption, wallet auth, resource visibility, React/Zustand/React Query apps, Vite web apps, Deno servers, CLI tools, JSR (@bandeira-tech/b3nd-sdk), NPM (@bandeira-tech/b3nd-web), HttpClient, WalletClient, PostgresClient, MongoClient, MemoryClient, LocalStorageClient, IndexedDBClient, or any B3nd development task.
---

# B3nd Development Guide

## Quick Reference

### B3nd vs Firecat

**B3nd** is the protocol and SDK — software you can run anywhere. **Firecat** is
the public network running B3nd nodes — the default for most apps.

| Concept | B3nd                       | Firecat         |
| ------- | -------------------------- | --------------- |
| What    | Protocol + SDK             | Public network  |
| Like    | HTTP protocol              | The Internet    |
| Use     | Local dev, private servers | Production apps |

**Default: Connect to Firecat** unless you need a private deployment.

### Firecat Endpoints

| Service       | URL                                  |
| ------------- | ------------------------------------ |
| Backend Node  | `https://testnet-evergreen.fire.cat` |
| Wallet Server | `https://testnet-wallet.fire.cat`    |
| App Server    | `https://testnet-app.fire.cat`       |

### Packages

| Package                          | Registry | Use Case       |
| -------------------------------- | -------- | -------------- |
| `@bandeira-tech/b3nd-sdk`        | JSR      | Deno, servers  |
| `@bandeira-tech/b3nd-web`        | NPM      | Browser, React |

### Available Clients

| Client               | Package    | Use                                 |
| -------------------- | ---------- | ----------------------------------- |
| `HttpClient`         | Both       | Connect to Firecat or any HTTP node |
| `WalletClient`       | NPM/wallet | Authenticated messages              |
| `LocalStorageClient` | NPM        | Browser offline cache               |
| `IndexedDBClient`    | NPM        | Browser IndexedDB storage           |
| `MemoryClient`       | Both       | Testing                             |
| `PostgresClient`     | JSR        | PostgreSQL storage                  |
| `MongoClient`        | JSR        | MongoDB storage                     |

### Terminology

| Term                     | Meaning                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| **Scheme**               | URI scheme: `mutable`, `immutable`, `hash`, `link`                 |
| **Program**              | `scheme://hostname` pair defining behavioral constraints           |
| **Substrate**            | Synonym for program, emphasizing the low-level data layer          |
| **Resource**             | Data stored at a URI path within a program                         |
| **B3nd Protocol**        | The B3nd network protocol itself (only use of "protocol")          |
| **Application protocol** | Pattern of message exchange on canonical substrates                |

Usage: "protocol" only means the B3nd Protocol. Use "program" for
`scheme://hostname`. Use "application protocol" or "workflow" for higher-level
patterns built on top of programs.

---

## Guide: Programs & URIs

### Data Architecture: Programs, URIs, and Resources

B3nd is a lightweight backend for a public, untrusted network. Cryptography
ensures data privacy at the level you choose, while simple programs make data
accessible from anywhere you can reach a network node — executable on any
machine, inexpensive, with built-in safeguards and directional flow.

**Programs** are the behavioral layer. A program is defined by a schema
(`mutable://accounts`, `hash://sha256`, `immutable://inbox`, etc.) and determines
the constraints: mutability, authentication, content-addressing, access patterns.
Programs are low-level data substrates — what Firecat and other B3nd networks
provide.

**URIs** are the vehicle for information. The scheme + hostname selects the
program (and its guarantees), while the path is where users organize resources —
structuring domain-specific layouts like `/nodes/{id}/config` or `/posts/latest`
on top of program guarantees. URIs carry information at every level: `hash://`
selects content-addressed storage, `accounts` selects pubkey-authenticated
access, and the path locates the resource within that substrate.

**Programs are substrates, not domain boundaries.** Creating a program like
`mutable://nodes` does not prevent users from describing their nodes on any other
substrate — `mutable://open/my-nodes/...`, `mutable://accounts/.../nodes/...`,
or anywhere else. Programs have no ownership over domain concepts. Treating them
as if they do creates a false sense of control over resources that live on a
public network. Instead, higher-level application protocols are patterns of message exchange
on top of canonical substrates. Libraries provide TypeScript types, URI
conventions, and interpretation logic — they define how resources are organized
and exchanged, not new programs.

```
WRONG:  mutable://nodes/{key}/{id}/config          (new program for a domain concept)
RIGHT:  mutable://accounts/{key}/nodes/{id}/config  (domain resources on canonical substrate)
```

The result: B3nd serves as a shared filesystem where users (humans and agents)
own their data and connections. The UI/frontend is a separate concern from the
data persistence layer — B3nd handles storage, access control, and encryption,
while applications attach their own interpretation, analysis, and interaction
on top.

### Canonical Schema

| Program                | Access                | Use Case                           |
| ---------------------- | --------------------- | ---------------------------------- |
| `mutable://open`       | Anyone                | Public data, no auth needed        |
| `mutable://accounts`   | Pubkey-signed         | User data, requires wallet auth    |
| `immutable://open`     | Anyone, once          | Content-addressed, no overwrites   |
| `immutable://accounts` | Pubkey-signed, once   | Permanent user data                |
| `immutable://inbox`    | Message inbox         | Suggestions, notifications         |
| `hash://sha256`        | Anyone, hash-verified | Content-addressed storage (SHA256) |
| `link://open`          | Anyone                | Unauthenticated URI references     |
| `link://accounts`      | Pubkey-signed writes  | Authenticated URI references       |

### URI Structure

```typescript
// Pattern: {scheme}://accounts/{pubkey}/{path}
"mutable://accounts/052fee.../profile"
"immutable://accounts/052fee.../posts/1"
"hash://sha256/2cf24dba..."
"link://accounts/052fee.../avatar"
```

### Messages

All state changes flow through a single `receive(msg)` interface. A message is a
tuple `[uri, data]`:

```typescript
type Message<D = unknown> = [uri: string, data: D];
await client.receive(["mutable://accounts/{pubkey}/profile", { name: "Alice" }]);
await client.read("mutable://accounts/{pubkey}/profile");
await client.list("mutable://accounts/{pubkey}/");
await client.delete("mutable://accounts/{pubkey}/profile");
```

### The `send()` and `message()` API

The `send()` function is the primary way to batch multiple writes into a single
message. It builds a content-addressed envelope (SHA256 hash of the payload via
RFC 8785 canonical JSON), sends it through the client, and returns the result:

```typescript
import { send } from "@bandeira-tech/b3nd-sdk";
// or: import { send } from "@bandeira-tech/b3nd-web";

const result = await send({
  outputs: [
    ["mutable://open/app/config", { theme: "dark" }],
    ["mutable://open/app/status", { active: true }],
  ],
}, client);
// result.uri = "hash://sha256/{hex}" — the envelope's content-addressed URI
// result.accepted = true
// Replay protection: same payload = same hash = already exists = rejected
```

- `msgSchema(schema)` validates the envelope AND each output against its
  program's schema
- Each client's `receive()` detects MessageData and stores outputs individually
- The envelope is stored at `hash://sha256/{hex}` as an audit trail

The lower-level `message()` function builds the tuple without sending — useful
when you need the raw `[uri, data]` pair:

```typescript
import { message } from "@bandeira-tech/b3nd-sdk";

const [uri, data] = await message({
  outputs: [["mutable://open/config", { theme: "dark" }]],
});
// uri = "hash://sha256/{computed-hash}"
// data = { inputs: [], outputs: [...] }
```

### NodeProtocolInterface

All clients implement:

```typescript
interface NodeProtocolInterface {
  receive<D>(msg: Message<D>): Promise<ReceiveResult>;
  read<T>(uri: string): Promise<ReadResult<T>>;
  list(uri: string, options?: ListOptions): Promise<ListResult>;
  delete(uri: string): Promise<DeleteResult>;
  health(): Promise<HealthStatus>;
  getSchema(): Promise<string[]>;
  cleanup(): Promise<void>;
}
```

`list()` returns flat results — all stored URIs matching the prefix:

```typescript
interface ListItem { uri: string; }
const result = await client.list("mutable://accounts/{pubkey}/");
// result.data = [{ uri: "mutable://accounts/{pubkey}/profile" }, ...]
```

### URI Design Guidance

**Paths as folders, resources as files.** URI paths work like filesystem
directories. Data at a leaf URI is like a file's content. Prefix listing
(`client.list("mutable://accounts/{key}/posts/")`) is like `ls posts/`.

**Favor secure, crypto-backed patterns.** `mutable://open` is for truly public
data anyone can modify (like app announcements). User data MUST use
`mutable://accounts/{pubkey}/...` (signature-protected).

**URI mapping — common patterns:**

```
Private user data:   mutable://accounts/{userPubkey}/app/settings      (signed, encrypted)
User-owned resource: mutable://accounts/{resourcePubkey}/data          (resource has own keypair)
Public announcements: mutable://open/app/announcements                 (anyone can write — use sparingly)
Content-addressed:   hash://sha256/{hash}                               (trustless, immutable)
Named reference:     link://accounts/{userPubkey}/app/avatar            (signed pointer to hash)
Inbox message:       immutable://inbox/{recipientPubkey}/topic/{ts}    (write-once delivery)
Message envelope:    hash://sha256/{hex}                                 (via send(), content-addressed audit trail)
```

**Obfuscation pattern:** Encrypt path segments using deterministic key
derivation. Instead of `/medical/records/blood-test`, derive
`/{hex1}/{hex2}/{hex3}` from `SALT + segment + password`. The owner regenerates
deterministically; observers see opaque hex.

```typescript
// Deterministic path obfuscation
async function obfuscatePath(segments: string[], password: string): Promise<string> {
  const parts = await Promise.all(
    segments.map(async (seg) => {
      const key = await deriveKeyFromSeed(`${APP_SALT}:${seg}:${password}`, APP_SALT, 100000);
      return key.slice(0, 16); // truncate for readability
    }),
  );
  return parts.join("/");
}
```

---

## Guide: Getting Started

### Installation

```typescript
// Deno/Server (JSR) — deno.json
{ "imports": { "@bandeira-tech/b3nd-sdk": "jsr:@bandeira-tech/b3nd-sdk" } }

// Browser/React (NPM)
// npm install @bandeira-tech/b3nd-web
```

### Basic Operations

```typescript
// Deno
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
// Browser
import { HttpClient } from "@bandeira-tech/b3nd-web";

// Connect to Firecat (production)
const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });
// Or local: new HttpClient({ url: "http://localhost:9942" });

// Write
await client.receive(["mutable://open/my-app/config", { theme: "dark" }]);

// Read
const result = await client.read("mutable://open/my-app/config");
console.log(result.record?.data); // { theme: "dark" }

// List
const items = await client.list("mutable://open/my-app/");

// Delete
await client.delete("mutable://open/my-app/config");
```

---

## Guide: Content-Addressed Storage (hash://), Links & Encryption

### Content-Addressed Storage (hash://)

Content-addressed data uses SHA256 hashes. The hash in the URI must match
the content.

```typescript
import { send } from "@bandeira-tech/b3nd-sdk";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";
// or from "@bandeira-tech/b3nd-web" and "@bandeira-tech/b3nd-web/hash" in browser

const data = { title: "Hello", content: "World" };
const hash = await computeSha256(data);
const hashUri = generateHashUri(hash); // "hash://sha256/{hash}"

await send({ outputs: [[hashUri, data]] }, client);

// Read — content verified by hash
const result = await client.read(hashUri);
```

**Key Properties:** Immutable, deduplicated, trustless verification, format:
`hash://sha256/<64-hex-chars>`

### Link Program (URI References)

Links are simple string values pointing to other URIs:

```typescript
// Authenticated link (requires wallet)
await wallet.proxyWrite({
  uri: "link://accounts/{userPubkey}/avatar",
  data: "hash://sha256/abc123...",
  encrypt: false,
});

// Read link → get target URI → fetch target
const linkResult = await client.read<string>("link://accounts/alice/avatar");
const hashResult = await client.read(linkResult.record.data);
```

### Hash + Link Pattern (Recommended)

```typescript
// Store content as hash + create link in one message
const content = { title: "My Post", body: "..." };
const hash = await computeSha256(content);
const hashUri = `hash://sha256/${hash}`;

await send({
  outputs: [
    [hashUri, content],
    ["link://open/posts/latest", hashUri],
  ],
}, client);

// Update: new hash + update link
const v2 = { title: "My Post v2", body: "..." };
const v2Hash = await computeSha256(v2);
const v2Uri = `hash://sha256/${v2Hash}`;

await send({
  inputs: [hashUri],
  outputs: [
    [v2Uri, v2],
    ["link://open/posts/latest", v2Uri],
  ],
}, client);
```

### Asymmetric Encryption (Private Data)

```typescript
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
// or from "@bandeira-tech/b3nd-sdk/encrypt"

// Encrypt data with recipient's public key
const encrypted = await encrypt.encrypt(data, recipientPublicKeyHex);

// Hash encrypted payload and store content-addressed
const hash = await computeSha256(encrypted);
await send({ outputs: [[`hash://sha256/${hash}`, encrypted]] }, client);

// Recipient decrypts
const result = await client.read(`hash://sha256/${hash}`);
const decrypted = await encrypt.decrypt(result.record.data, recipientPrivateKey);
```

### Symmetric Encryption (Password-Based)

```typescript
const key = await encrypt.deriveKeyFromSeed(password, salt, 100000);
const encrypted = await encrypt.encryptSymmetric(data, key);
// Store encrypted, decrypt with same password later
const decrypted = await encrypt.decryptSymmetric(encrypted, key);
```

### Privacy Levels

| Level     | Encryption Key                | Access               |
| --------- | ----------------------------- | -------------------- |
| Public    | None                          | Anyone can read      |
| Protected | Password-derived (PBKDF2)     | Anyone with password |
| Private   | Recipient's X25519 public key | Only recipient       |

---

## Guide: Wallet & Authentication

### WalletClient Setup

```typescript
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";

const wallet = new WalletClient({
  walletServerUrl: "https://testnet-wallet.fire.cat",
  apiBasePath: "/api/v1",
});
```

### Session Keypair Flow

**Both signup AND login require an approved session keypair.**

```typescript
import { send } from "@bandeira-tech/b3nd-web";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

const backendClient = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });
const APP_KEY = "app-public-key-hex";
const APP_PRIVATE_KEY = "app-private-key-hex";

// 1. Generate session keypair
const sessionKeypair = await encrypt.generateSigningKeyPair();

// 2. Post SIGNED request to inbox (proves session key ownership)
const signedRequest = await encrypt.createAuthenticatedMessageWithHex(
  { timestamp: Date.now() },
  sessionKeypair.publicKeyHex,
  sessionKeypair.privateKeyHex,
);
await send({
  outputs: [[
    `immutable://inbox/${APP_KEY}/sessions/${sessionKeypair.publicKeyHex}`,
    signedRequest,
  ]],
}, backendClient);

// 3. App APPROVES session (value = 1, signed by app's key)
const signedApproval = await encrypt.createAuthenticatedMessageWithHex(
  1, APP_KEY, APP_PRIVATE_KEY,
);
await send({
  outputs: [[
    `mutable://accounts/${APP_KEY}/sessions/${sessionKeypair.publicKeyHex}`,
    signedApproval,
  ]],
}, backendClient);

// 4. Now signup or login works
const session = await wallet.signup(APP_KEY, sessionKeypair, {
  type: "password", username, password,
});
// or: await wallet.login(APP_KEY, sessionKeypair, { type: "password", username, password });

wallet.setSession(session);
```

### proxyWrite / proxyRead

```typescript
// Write to accounts (signed + optionally encrypted)
await wallet.proxyWrite({
  uri: "mutable://accounts/{userPubkey}/profile",
  data: { name: "Alice" },
  encrypt: true,
});

// Read with auto-decryption
const data = await wallet.proxyRead({
  uri: "mutable://accounts/{userPubkey}/profile",
});
```

### Resource Identity Pattern

Every resource has its own Ed25519 keypair. The public key becomes the resource's
permanent identity/address:

```typescript
const resourceKeys = await encrypt.generateSigningKeyPair();
const resourceUri = `mutable://accounts/${resourceKeys.publicKeyHex}/data`;

// Resource private keys stored encrypted in user's account index
await wallet.proxyWrite({
  uri: `mutable://accounts/${userPubkey}/resources`,
  data: { resources: entries },
  encrypt: true,
});
```

### App Identity Pattern

Apps derive a deterministic keypair for app-owned shared resources:

```typescript
const appIdentity = await deriveKeypairFromSeed(appKey);
// App owns: mutable://accounts/{appPubkey}/public-resources
```

---

## Guide: Resource Visibility

Visibility is achieved through client-side encryption, not server access control.

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

### User Account Structure

```
mutable://accounts/{userPubkey}/
├── profile          (encrypted to user — private settings)
├── public-profile   (encrypted with app key — discoverable)
├── resources        (encrypted to user — resource keys index)
└── executions       (encrypted to user — activity log)
```

---

## Guide: Server-Side (Deno/JSR)

### Installation & Imports

```typescript
// deno.json
{ "imports": { "@bandeira-tech/b3nd-sdk": "jsr:@bandeira-tech/b3nd-sdk" } }

import {
  createServerNode, createValidatedClient, firstMatchSequence,
  FunctionalClient, HttpClient, MemoryClient, MongoClient, msgSchema,
  parallelBroadcast, PostgresClient, send, servers,
} from "@bandeira-tech/b3nd-sdk";
```

### Client Composition

```typescript
const client = createValidatedClient({
  receive: parallelBroadcast([postgresClient, memoryClient]),
  read: firstMatchSequence([postgresClient, memoryClient]),
  validate: msgSchema(schema),
});

// Validators: seq(), any(), all(), msgSchema(), schemaValidator()
// Combinators: parallelBroadcast(), firstMatchSequence()
```

For custom behavior without class inheritance:

```typescript
const client = new FunctionalClient({
  receive: async (msg) => backend.receive(msg),
  read: async (uri) => backend.read(uri),
  list: async (uri, options) => backend.list(uri, options),
});
```

### HTTP Server with Hono

```typescript
import { createServerNode, MemoryClient, servers } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

const schema = { "mutable://open": async ({ value }) => ({ valid: !!value }) };
const client = new MemoryClient({ schema });
const app = new Hono();
const frontend = servers.httpServer(app);
const node = createServerNode({ frontend, client });
node.listen(43100);
```

### Multi-Backend Server

```typescript
const clients = [
  new MemoryClient({ schema }),
  new PostgresClient({ connection, schema, tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000 }),
];

const client = createValidatedClient({
  receive: parallelBroadcast(clients),
  read: firstMatchSequence(clients),
  validate: msgSchema(schema),
});

const frontend = servers.httpServer(app);
createServerNode({ frontend, client });
```

### PostgreSQL / MongoDB Setup

```typescript
// Postgres
const pg = new PostgresClient({
  connection: "postgresql://user:pass@localhost:5432/db",
  schema, tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000,
}, executor);
await pg.initializeSchema();

// MongoDB
const mongo = new MongoClient({
  connectionString: "mongodb://localhost:27017/mydb",
  schema, collectionName: "b3nd_data",
}, executor);
```

### Schema Module Pattern

```typescript
// schema.ts
import type { Schema } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "mutable://open": async ({ uri, value, read }) => {
    if (!value) return { valid: false, error: "Value required" };
    return { valid: true };
  },
};
export default schema;
```

### Environment Variables

```bash
PORT=43100
CORS_ORIGIN=*
BACKEND_URL=postgres://user:pass@localhost:5432/db
SCHEMA_MODULE=./my-schema.ts
# Multiple backends:
BACKEND_URL=memory://,postgres://...,http://other-node:9942
```

---

## Guide: Browser Apps (NPM)

### Installation & Imports

```bash
npm install @bandeira-tech/b3nd-web
```

```typescript
// Main
import { HttpClient, LocalStorageClient, WalletClient } from "@bandeira-tech/b3nd-web";

// Subpath imports
import { HttpClient } from "@bandeira-tech/b3nd-web/clients/http";
import { LocalStorageClient } from "@bandeira-tech/b3nd-web/clients/local-storage";
import { MemoryClient } from "@bandeira-tech/b3nd-web/clients/memory";
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-web/hash";
```

### LocalStorageClient

```typescript
const local = new LocalStorageClient({
  keyPrefix: "myapp_",
  schema: {/* optional */},
});
```

### Key Differences: SDK vs Web

| Feature            | b3nd-sdk (JSR) | b3nd-web (NPM) |
| ------------------ | -------------- | --------------- |
| PostgresClient     | Yes            | No              |
| MongoClient        | Yes            | No              |
| LocalStorageClient | No             | Yes             |
| IndexedDBClient    | No             | Yes             |
| Server primitives  | Full           | Limited         |

---

## Guide: React Applications

### Project Setup

```json
{
  "dependencies": {
    "@bandeira-tech/b3nd-web": "^0.3.0",
    "@tanstack/react-query": "^5.90.2",
    "zustand": "^5.0.8",
    "react": "^19.1.0",
    "react-router-dom": "^7.9.3"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.0.3",
    "vite": "^7.1.7",
    "tailwindcss": "^3.4.0"
  }
}
```

### Firecat Config

```typescript
export const FIRECAT = {
  backend: "https://testnet-evergreen.fire.cat",
  wallet: "https://testnet-wallet.fire.cat",
  app: "https://testnet-app.fire.cat",
};
export const LOCAL = {
  backend: "http://localhost:9942",
  wallet: "http://localhost:9943",
  app: "http://localhost:9944",
};
export const config = import.meta.env.DEV ? LOCAL : FIRECAT;
```

### Zustand State Management

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  backends: BackendConfig[];
  activeBackendId: string | null;
  currentPath: string;
}

export const useAppStore = create<AppState & AppActions>()(
  persist(
    (set) => ({
      backends: [],
      activeBackendId: null,
      currentPath: "/",
      setActiveBackend: (id) => set({ activeBackendId: id, currentPath: "/" }),
      navigateToPath: (path) => set({ currentPath: path }),
    }),
    { name: "app-state", partialize: (s) => ({ activeBackendId: s.activeBackendId }) },
  ),
);
```

### React Query Hooks

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HttpClient, send } from "@bandeira-tech/b3nd-web";

const client = new HttpClient({ url: config.backend });

export function useRecord(uri: string) {
  return useQuery({
    queryKey: ["record", uri],
    queryFn: async () => {
      const result = await client.read(uri);
      if (!result.success) throw new Error(result.error);
      return result.record;
    },
  });
}

export function useList(uri: string, options?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ["list", uri, options],
    queryFn: async () => {
      const result = await client.list(uri, options);
      if (!result.success) throw new Error(result.error);
      return result;
    },
  });
}

export function useSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ outputs }: { outputs: [string, unknown][] }) => {
      const result = await send({ outputs }, client);
      if (!result.accepted) throw new Error(result.error);
      return result;
    },
    onSuccess: (_, { outputs }) => {
      for (const [uri] of outputs) {
        queryClient.invalidateQueries({ queryKey: ["record", uri] });
      }
    },
  });
}
```

### Component Patterns

```typescript
function RecordViewer({ uri }: { uri: string }) {
  const { data, isLoading, error } = useRecord(uri);
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  return <pre className="bg-gray-100 p-4 rounded">{JSON.stringify(data?.data, null, 2)}</pre>;
}
```

### Visibility-Aware Routes

```typescript
// types
type Visibility = "private" | "protected" | "public";
type VisibilityCode = "pvt" | "pro" | "pub";

// Router
<Routes>
  <Route path="/resources/:visibilityCode/:id" element={<ResourcePage />} />
</Routes>

// ResourcePage: show PasswordDialog for "pro", auto-load for "pub", require login for "pvt"
```

### Password Dialog

```typescript
function PasswordDialog({ isOpen, onSubmit, onCancel }) {
  const [password, setPassword] = useState("");
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-lg">
        <h2>Enter Password</h2>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="border p-2 w-full" />
        <div className="flex gap-2 mt-4">
          <button onClick={() => onSubmit(password)}>Unlock</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

---

## Guide: Deno CLI & Scripts

### CLI Pattern

```typescript
#!/usr/bin/env -S deno run -A
import { HttpClient } from "@bandeira-tech/b3nd-sdk";

const BACKEND_URL = Deno.env.get("BACKEND_URL") || "http://localhost:9942";
const client = new HttpClient({ url: BACKEND_URL });

async function main() {
  const command = Deno.args[0];
  switch (command) {
    case "read": {
      const result = await client.read(Deno.args[1]);
      if (result.success) console.log(JSON.stringify(result.record?.data, null, 2));
      else console.error(result.error);
      break;
    }
    case "list": {
      const result = await client.list(Deno.args[1], { limit: 10 });
      if (result.success) console.log(result.data);
      break;
    }
    default:
      console.log("Usage: cli.ts <read|list> <uri>");
  }
}
main();
```

### Testing with MemoryClient

```typescript
import { assertEquals } from "@std/assert";
import { hashValidator, MemoryClient, send } from "@bandeira-tech/b3nd-sdk";

Deno.test("send and read", async () => {
  const client = new MemoryClient({
    schema: { "test://data": async () => ({ valid: true }), "hash://sha256": hashValidator() },
  });
  const result = await send({
    outputs: [["test://data/item1", { name: "Test" }]],
  }, client);
  assertEquals(result.accepted, true);
  const read = await client.read("test://data/item1");
  assertEquals(read.record?.data, { name: "Test" });
  await client.cleanup();
});
```

### Shared Test Suites

```typescript
import { runSharedSuite } from "../tests/shared-suite.ts";
import { runNodeSuite } from "../tests/node-suite.ts";

runSharedSuite("MyClient", {
  happy: () => createMyClient(happySchema),
  validationError: () => createMyClient(strictSchema),
});
```

### Makefile

```makefile
test:
ifdef t
	@deno test --allow-all $(t)
else
	@deno test --allow-all tests/
endif
start:
	@deno run -A mod.ts
```

---

## Guide: E2E Testing

### Playwright Setup

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:5173/?e2e",  // ?e2e triggers in-memory mode
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
```

### PersistedMemoryClient

Memory client that survives page reloads by backing to localStorage:

```typescript
export class PersistedMemoryClient implements NodeProtocolInterface {
  private client: MemoryClient;
  private storageKey: string;

  constructor(config: { schema: Schema }, storageKey: string) {
    this.storageKey = storageKey;
    this.client = new MemoryClient(config);
    this.loadFromStorage();
  }

  async receive<D>(msg: Message<D>) {
    const result = await this.client.receive(msg);
    this.persistStorage();
    return result;
  }
  // read/list/delete/health/getSchema/cleanup delegate to this.client
}
```

### URL Parameter Detection

```typescript
// ?e2e triggers full in-memory mode
// ?data=memory://&wallet=memory:// for explicit params
export function parseUrlConfig(): Partial<BackendConfig> | null {
  const params = new URLSearchParams(window.location.search);
  if (params.has("e2e")) return { dataUrl: "memory://", walletUrl: "memory://", appUrl: "memory://" };
  return null;
}
```

### Test Client Injection

Initialize test clients BEFORE AuthContext loads:

```typescript
// main.tsx
if (useMemoryMode) {
  const { initializeLocalBackend } = await import("./domain/clients/local-backend");
  await initializeLocalBackend(backendConfig);
}
```

### Test Helpers

```typescript
export const TEST_USERS = {
  alice: { username: "alice", email: "alice@test.com", password: "alice-password-123" },
  bob: { username: "bob", email: "bob@test.com", password: "bob-password-123" },
};

export async function signupTestUser(page: Page, userKey: keyof typeof TEST_USERS) { /* ... */ }
export async function loginAsTestUser(page: Page, userKey: keyof typeof TEST_USERS) { /* ... */ }
export async function clearTestData(page: Page) { /* ... */ }
```

Key patterns: URL param detection, early initialization, persisted memory,
session restoration, test client injection, data isolation.

---

## Tools & Infrastructure

### MCP Tools (Claude Plugin)

| Tool                   | Description                  |
| ---------------------- | ---------------------------- |
| `b3nd_receive`         | Submit message `[uri, data]` |
| `b3nd_read`            | Read data from URI           |
| `b3nd_list`            | List items at URI prefix     |
| `b3nd_delete`          | Delete data                  |
| `b3nd_health`          | Backend health check         |
| `b3nd_schema`          | Get available programs       |
| `b3nd_backends_list`   | List configured backends     |
| `b3nd_backends_switch` | Switch active backend        |
| `b3nd_backends_add`    | Add new backend              |

Configure: `export B3ND_BACKENDS="local=http://localhost:9942"`

### bnd CLI Tool

```bash
./apps/b3nd-cli/bnd read mutable://accounts/{pubkey}/profile
./apps/b3nd-cli/bnd list mutable://accounts/{pubkey}/
./apps/b3nd-cli/bnd config
./apps/b3nd-cli/bnd conf node http://localhost:9942
```

### Developer Dashboard

```bash
cd apps/sdk-inspector && deno task dashboard:build  # Build test artifacts
cd apps/b3nd-web-rig && npm run dev                 # http://localhost:5555/dashboard
```

Browse 125 tests by theme (SDK Core, Network, Database, Auth, Binary, E2E), view
source code with line numbers.

### Custom Programs (Your Own Network)

Custom programs only make sense when running your own B3nd network — a private
deployment with a different trust model or custom validation requirements.

**Why run your own network?** You control the schema, validation, and access. On
a private network, the "false control" argument relaxes because you DO control
what programs exist on your infrastructure.

**Why this is valuable for B3nd:** More networks running B3nd = a larger
ecosystem. Private networks validate the protocol in different environments.

**This section is NOT for Firecat app developers.** If you're building on
Firecat, use the canonical programs above.

```typescript
const schema: Schema = {
  "mutable://my-company": async ({ uri, value }) => ({ valid: true }),
};
```

---

## Source Files Reference

### SDK Core
- `src/mod.ts` — Main Deno exports (facade, re-exports from libs/)
- `src/mod.web.ts` — Browser exports (NPM build entry)
- `libs/b3nd-core/types.ts` — Type definitions
- `libs/b3nd-compose/` — Node composition, validators, processors
- `libs/b3nd-blob/` — Content-addressed storage utilities (hash:// scheme)
- `libs/b3nd-msg/` — Message system

### Clients
- `libs/b3nd-client-memory/` — In-memory client
- `libs/b3nd-client-http/` — HTTP client
- `libs/b3nd-client-ws/` — WebSocket client
- `libs/b3nd-client-postgres/` — PostgreSQL client
- `libs/b3nd-client-mongo/` — MongoDB client
- `libs/b3nd-client-localstorage/` — LocalStorage client
- `libs/b3nd-client-indexeddb/` — IndexedDB client
- `libs/b3nd-combinators/` — parallelBroadcast, firstMatchSequence

### Auth & Encryption
- `libs/b3nd-auth/` — Pubkey-based access control
- `libs/b3nd-encrypt/` — X25519/Ed25519/AES-GCM encryption
- `libs/b3nd-wallet/` — Wallet client
- `libs/b3nd-wallet-server/` — Wallet server implementation

### Servers & Apps
- `libs/b3nd-servers/` — HTTP + WebSocket server primitives
- `apps/b3nd-node/` — Multi-backend HTTP node
- `apps/wallet-node/` — Wallet/auth server
- `apps/b3nd-web-rig/` — React/Vite data explorer + dashboard
- `apps/sdk-inspector/` — Test runner backend
- `apps/b3nd-cli/` — bnd CLI tool

### Testing
- `libs/b3nd-testing/shared-suite.ts` — Client conformance suite
- `libs/b3nd-testing/node-suite.ts` — Node interface suite

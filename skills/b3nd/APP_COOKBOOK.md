# Building Firecat Apps

Recipes and patterns for building apps on the Firecat network. Each section is
self-contained — jump to what you need.

For reference material on Firecat's schema, URIs, auth, and visibility model,
see [FIRECAT.md](./FIRECAT.md).

---

## Quick Start

Get something working in 60 seconds, then read the architecture below.

**Browser (NPM):**

```bash
npm install @bandeira-tech/b3nd-web
```

```typescript
import { HttpClient, send } from "@bandeira-tech/b3nd-web";

const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });

// Write
await client.receive(["mutable://open/my-app/hello", { message: "it works" }]);

// Read
const result = await client.read("mutable://open/my-app/hello");
console.log(result.record?.data); // { message: "it works" }

// Batch write (content-addressed envelope)
await send({
  payload: {
    inputs: [],
    outputs: [
      ["mutable://open/my-app/config", { theme: "dark" }],
      ["mutable://open/my-app/status", { active: true }],
    ],
  },
}, client);
```

**Deno (JSR):**

```typescript
// deno.json: { "imports": { "@bandeira-tech/b3nd-sdk": "jsr:@bandeira-tech/b3nd-sdk" } }
import { HttpClient, send } from "@bandeira-tech/b3nd-sdk";

const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });

// Same API — receive(), read(), send() work identically
await client.receive(["mutable://open/my-app/hello", { message: "it works" }]);
```

**Vocabulary note:** From the app's perspective you *send* data. From the node's
perspective it *receives* a message. The fundamental write operation is called
`receive()` because it describes what the node does. The `send()` function is a
higher-level helper that batches multiple writes into a single content-addressed
envelope.

---

## URI Design for App Entities

Organize your app's data under a consistent namespace. Use the program
that matches your access model and structure paths by entity type:

```
# Public content (anyone can read/write — good for demos, open wikis)
mutable://open/my-app/pages/{slug}
mutable://open/my-app/announcements/latest

# User-owned content (requires Ed25519 signature from the user's key)
mutable://accounts/{userKey}/my-app/profile
mutable://accounts/{userKey}/my-app/posts/{slug}
mutable://accounts/{userKey}/my-app/settings

# Content-addressed blobs (images, files — immutable, hash-verified)
hash://sha256/{hash}

# Named pointers to blobs (signed, updatable references)
link://accounts/{userKey}/my-app/avatar
link://accounts/{userKey}/my-app/posts/{slug}/cover-image

# Write-once delivery (notifications, suggestions)
immutable://inbox/{recipientKey}/my-app/notifications/{timestamp}
```

**Convention:** Always namespace your paths with your app name
(`my-app/`) to avoid collisions with other apps on the same network.

---

## CRUD Operations

Every data operation maps to a client method:

```typescript
import { HttpClient, send } from "@bandeira-tech/b3nd-web";

const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });

// CREATE / UPDATE — write data to a URI
await client.receive(["mutable://open/my-app/pages/about", {
  title: "About Us",
  body: "Welcome to our app.",
  updatedAt: Date.now(),
}]);

// READ — fetch a single record
const result = await client.read("mutable://open/my-app/pages/about");
if (result.success) {
  console.log(result.record?.data); // { title: "About Us", body: "...", ... }
}

// LIST — enumerate items under a path
const list = await client.list("mutable://open/my-app/pages/", {
  limit: 20,
  page: 1,
  sortBy: "timestamp",
  sortOrder: "desc",
});
if (list.success) {
  for (const item of list.data) {
    console.log(item.uri); // "mutable://open/my-app/pages/about", ...
  }
  console.log(list.pagination); // { page: 1, limit: 20, total: 5 }
}

// DELETE — remove a record
const del = await client.delete("mutable://open/my-app/pages/about");
console.log(del.success); // true
```

**List options:**

| Option      | Type                     | Description                        |
| ----------- | ------------------------ | ---------------------------------- |
| `page`      | `number`                 | Page number (default: 1)           |
| `limit`     | `number`                 | Items per page (default: 50)       |
| `pattern`   | `string`                 | Regex filter on URI                |
| `sortBy`    | `"name" \| "timestamp"` | Sort field                         |
| `sortOrder` | `"asc" \| "desc"`       | Sort direction                     |

---

## Authenticated CRUD (User-Owned Content)

For `accounts` programs, every write must be signed. The pattern is
the same CRUD but wrapped in authentication:

```typescript
import { HttpClient, send } from "@bandeira-tech/b3nd-web";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });

// Generate a user keypair (do this once at signup, store the keys)
const user = await encrypt.generateSigningKeyPair();
// user.publicKeyHex — the user's identity / address component
// user.privateKeyHex — keep secret, used to sign writes

// WRITE a signed post
const postData = {
  title: "My First Post",
  body: "Hello world!",
  createdAt: Date.now(),
};
const signed = await encrypt.createAuthenticatedMessageWithHex(
  postData,
  user.publicKeyHex,
  user.privateKeyHex,
);
await client.receive([
  `mutable://accounts/${user.publicKeyHex}/my-app/posts/my-first-post`,
  signed,
]);

// READ — works the same as open (no auth needed to read)
const post = await client.read(
  `mutable://accounts/${user.publicKeyHex}/my-app/posts/my-first-post`,
);

// LIST all posts by this user
const posts = await client.list(
  `mutable://accounts/${user.publicKeyHex}/my-app/posts/`,
);

// UPDATE — same as create, just write to the same URI with new signed data
const updated = await encrypt.createAuthenticatedMessageWithHex(
  { ...postData, title: "Updated Title", updatedAt: Date.now() },
  user.publicKeyHex,
  user.privateKeyHex,
);
await client.receive([
  `mutable://accounts/${user.publicKeyHex}/my-app/posts/my-first-post`,
  updated,
]);

// DELETE
await client.delete(
  `mutable://accounts/${user.publicKeyHex}/my-app/posts/my-first-post`,
);
```

---

## Batch Writes with Envelopes

Use `send()` to write multiple resources atomically:

```typescript
await send({
  payload: {
    inputs: [],
    outputs: [
      [`mutable://open/my-app/pages/home`, { title: "Home", body: "Welcome" }],
      [`mutable://open/my-app/pages/about`, { title: "About", body: "About us" }],
      [`mutable://open/my-app/config`, { theme: "dark", language: "en" }],
    ],
  },
}, client);
```

---

## Privacy Patterns

Firecat provides two distinct privacy tiers. Choosing the wrong one is a
security mistake. Read this section carefully before storing user data.

> **Key distinction:** "private" visibility in Firecat uses deterministic key
> derivation (obscured URIs). It is NOT encrypted in a way that prevents a
> determined adversary from reading the data. For true confidentiality, you
> must use asymmetric or shared-secret encryption explicitly.

See also: `libs/b3nd-encrypt/mod.ts` module-level JSDoc for the full privacy
model, and [FIRECAT.md > Resource Visibility](./FIRECAT.md#resource-visibility)
for the protocol-level visibility table.

### Pattern 1: Obscured URI (when obscurity suffices)

Use this when the data is low-sensitivity and you just want to prevent casual
enumeration. Examples: user preferences, app theme settings, non-sensitive
configuration.

The key is derived from `SALT:uri:ownerPubkey` via PBKDF2. Anyone who can
reconstruct the seed can derive the same key and decrypt the data.

```typescript
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { HttpClient } from "@bandeira-tech/b3nd-web";

const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });
const APP_SALT = "my-app-v1";

// Derive a deterministic encryption key from the URI and owner pubkey
const uri = `mutable://accounts/${userPubkey}/my-app/preferences`;
const seed = `${APP_SALT}:${uri}:${userPubkey}`;
const keyHex = await encrypt.deriveKeyFromSeed(seed, APP_SALT, 100000);

// Encrypt and write
const secretKey = encrypt.SecretEncryptionKey.fromHex(keyHex);
const plaintext = new TextEncoder().encode(JSON.stringify({ theme: "dark" }));
const encrypted = await secretKey.encrypt(plaintext);

const signed = await encrypt.createAuthenticatedMessageWithHex(
  encrypted,
  userPubkey,
  userPrivateKeyHex,
);
await client.receive([uri, signed]);

// Read and decrypt (anyone who knows the inputs can do this)
const result = await client.read(uri);
const payload = result.record?.data?.payload ?? result.record?.data;
const decrypted = await secretKey.decrypt(payload);
const preferences = JSON.parse(new TextDecoder().decode(decrypted));
```

**Threat model:** A node operator, network observer, or any party who knows
your app salt, the URI pattern, and the user's public key can derive the same
key and read this data. The public key is visible in the URI itself.

### Pattern 2: Encrypted at rest (when confidentiality is required)

Use this when the data must be unreadable without the recipient's private key.
Examples: private messages, financial records, medical data, API keys.

```typescript
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { HttpClient } from "@bandeira-tech/b3nd-web";

const client = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });

// Generate an X25519 encryption keypair (do once, store securely)
const { privateKey: encPrivKey, publicKey: encPubKey } =
  await encrypt.PrivateEncryptionKey.generatePair();

// Generate a signing keypair (for auth)
const signingKeys = await encrypt.generateSigningKeyPair();

// Encrypt data to the recipient's public key (X25519 + AES-GCM)
const plaintext = new TextEncoder().encode(JSON.stringify({
  accountNumber: "1234-5678",
  balance: 42000,
}));

const message = await encrypt.createSignedEncryptedMessage({
  data: plaintext,
  identity: await encrypt.IdentityKey.fromHex({
    privateKeyHex: signingKeys.privateKeyHex,
    publicKeyHex: signingKeys.publicKeyHex,
  }),
  encryptionKey: encPubKey,
});

// Write the signed+encrypted message
const uri = `mutable://accounts/${signingKeys.publicKeyHex}/my-app/financial`;
await client.receive([uri, message]);

// Read and decrypt (only the private key holder can do this)
const result = await client.read(uri);
const { data, verified, signers } = await encrypt.verifyAndDecryptMessage({
  message: result.record?.data,
  encryptionKey: encPrivKey,
});
const financialData = JSON.parse(new TextDecoder().decode(data));
console.log(financialData); // { accountNumber: "1234-5678", balance: 42000 }
console.log(verified);      // true
```

**Threat model:** The data is encrypted with X25519 ECDH + AES-GCM using an
ephemeral keypair. Even the node operator cannot decrypt it. Only the holder
of the X25519 private key can recover the plaintext. Each encryption uses a
fresh ephemeral key, providing forward secrecy.

### When to use which

| Scenario                        | Pattern               | Why                                         |
| ------------------------------- | --------------------- | ------------------------------------------- |
| User theme / UI preferences     | Obscured URI          | Low sensitivity, convenience over security  |
| App settings (non-secret)       | Obscured URI          | Prevents casual browsing, not a secret      |
| Private messages                | Encrypted at rest     | Confidentiality required                    |
| Financial / medical records     | Encrypted at rest     | Regulatory and ethical obligation            |
| API keys or credentials         | Encrypted at rest     | Compromise = account takeover               |
| Shared secret (team data)       | `SecretEncryptionKey` | Share the symmetric key with authorized users |
| Public data                     | No encryption         | Intentionally open                          |

---

## Recipe: Content App (Pages + Posts + Users)

A complete data model for a content app with public pages, user-authored
posts, and user profiles:

```typescript
// --- URI helpers ---

const APP = "my-app";

// Public pages (anyone can read, app-managed)
const pageUri = (slug: string) =>
  `mutable://open/${APP}/pages/${slug}`;

// User profile
const profileUri = (userKey: string) =>
  `mutable://accounts/${userKey}/${APP}/profile`;

// User posts
const postUri = (userKey: string, slug: string) =>
  `mutable://accounts/${userKey}/${APP}/posts/${slug}`;

const postsListUri = (userKey: string) =>
  `mutable://accounts/${userKey}/${APP}/posts/`;

// --- Operations ---

// Create a public page (no auth)
async function createPage(slug: string, title: string, body: string) {
  await client.receive([pageUri(slug), { title, body, updatedAt: Date.now() }]);
}

// List all public pages
async function listPages() {
  const result = await client.list(`mutable://open/${APP}/pages/`);
  return result.success ? result.data : [];
}

// Create a user post (signed)
async function createPost(
  userKey: string, userPrivKey: string,
  slug: string, title: string, body: string,
) {
  const data = { title, body, author: userKey, createdAt: Date.now() };
  const signed = await encrypt.createAuthenticatedMessageWithHex(
    data, userKey, userPrivKey,
  );
  await client.receive([postUri(userKey, slug), signed]);
}

// List all posts by a user
async function listUserPosts(userKey: string) {
  const result = await client.list(postsListUri(userKey));
  return result.success ? result.data : [];
}

// Read a single post
async function getPost(userKey: string, slug: string) {
  const result = await client.read(postUri(userKey, slug));
  return result.success ? result.record?.data : null;
}

// Save user profile (signed)
async function saveProfile(
  userKey: string, userPrivKey: string,
  profile: { displayName: string; bio: string },
) {
  const signed = await encrypt.createAuthenticatedMessageWithHex(
    { ...profile, updatedAt: Date.now() }, userKey, userPrivKey,
  );
  await client.receive([profileUri(userKey), signed]);
}
```

---

## React Hooks for Content Apps

Build on the React Query hooks from the browser app setup below with
domain-specific hooks:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HttpClient, send } from "@bandeira-tech/b3nd-web";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

const client = new HttpClient({ url: config.backend });

// Read a single record by URI
export function useRecord(uri: string) {
  return useQuery({
    queryKey: ["record", uri],
    queryFn: async () => {
      const result = await client.read(uri);
      if (!result.success) throw new Error(result.error);
      return result.record?.data;
    },
    enabled: !!uri,
  });
}

// List records under a URI path
export function useList(uri: string, options?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ["list", uri, options],
    queryFn: async () => {
      const result = await client.list(uri, options);
      if (!result.success) throw new Error(result.error);
      return result;
    },
    enabled: !!uri,
  });
}

// Write (unsigned, for open programs)
export function useWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ uri, data }: { uri: string; data: unknown }) => {
      const result = await client.receive([uri, data]);
      if (!result.accepted) throw new Error(result.error);
      return result;
    },
    onSuccess: (_, { uri }) => {
      qc.invalidateQueries({ queryKey: ["record", uri] });
      const parentUri = uri.substring(0, uri.lastIndexOf("/") + 1);
      qc.invalidateQueries({ queryKey: ["list", parentUri] });
    },
  });
}

// Signed write (for accounts programs)
export function useSignedWrite(userKey: string, userPrivKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ uri, data }: { uri: string; data: unknown }) => {
      const signed = await encrypt.createAuthenticatedMessageWithHex(
        data, userKey, userPrivKey,
      );
      const result = await client.receive([uri, signed]);
      if (!result.accepted) throw new Error(result.error);
      return result;
    },
    onSuccess: (_, { uri }) => {
      qc.invalidateQueries({ queryKey: ["record", uri] });
      const parentUri = uri.substring(0, uri.lastIndexOf("/") + 1);
      qc.invalidateQueries({ queryKey: ["list", parentUri] });
    },
  });
}

// Delete a record
export function useDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (uri: string) => {
      const result = await client.delete(uri);
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: (_, uri) => {
      qc.invalidateQueries({ queryKey: ["record", uri] });
      const parentUri = uri.substring(0, uri.lastIndexOf("/") + 1);
      qc.invalidateQueries({ queryKey: ["list", parentUri] });
    },
  });
}
```

### Example: Posts List Component

```typescript
function PostsList({ userKey }: { userKey: string }) {
  const { data, isLoading } = useList(
    `mutable://accounts/${userKey}/my-app/posts/`,
    { limit: 20 },
  );

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="space-y-4">
      {data?.data.map((item) => (
        <PostCard key={item.uri} uri={item.uri} />
      ))}
    </div>
  );
}

function PostCard({ uri }: { uri: string }) {
  const { data } = useRecord(uri);
  if (!data) return null;
  return (
    <article className="border rounded-lg p-4">
      <h2 className="text-xl font-bold">{data.title}</h2>
      <p className="text-gray-600 mt-2">{data.body}</p>
    </article>
  );
}
```

### Example: Create Post Form

```typescript
function CreatePostForm({ userKey, userPrivKey }: { userKey: string; userPrivKey: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const signedWrite = useSignedWrite(userKey, userPrivKey);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await signedWrite.mutateAsync({
      uri: `mutable://accounts/${userKey}/my-app/posts/${slug}`,
      data: { title, body, author: userKey, createdAt: Date.now() },
    });
    setTitle("");
    setBody("");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="Post title" className="w-full border p-2 rounded"
      />
      <textarea
        value={body} onChange={(e) => setBody(e.target.value)}
        placeholder="Write your post..." className="w-full border p-2 rounded h-32"
      />
      <button type="submit" disabled={signedWrite.isPending}
        className="bg-blue-600 text-white px-4 py-2 rounded">
        {signedWrite.isPending ? "Publishing..." : "Publish"}
      </button>
    </form>
  );
}
```

---

## Building Browser Apps

### Installation

```bash
npm install @bandeira-tech/b3nd-web
```

```typescript
import { HttpClient, LocalStorageClient } from "@bandeira-tech/b3nd-web";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-web/hash";
```

### React Project Setup

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
};
export const LOCAL = {
  backend: "http://localhost:9942",
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
      const result = await send({
        payload: { inputs: [], outputs },
      }, client);
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

---

## Testing Firecat Apps

### Unit Testing with MemoryClient

```typescript
import { assertEquals } from "@std/assert";
import { MemoryClient, send } from "@bandeira-tech/b3nd-sdk";

import firecatSchema from "./firecat-schema.ts";

Deno.test("send and read on Firecat schema", async () => {
  const client = new MemoryClient({ schema: firecatSchema });
  const result = await send({
    payload: {
      inputs: [],
      outputs: [["mutable://open/my-app/item1", { name: "Test" }]],
    },
  }, client);
  assertEquals(result.accepted, true);
  const read = await client.read("mutable://open/my-app/item1");
  assertEquals(read.record?.data, { name: "Test" });
  await client.cleanup();
});
```

### E2E Testing with Playwright

#### Playwright Setup

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:5173/?e2e",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
```

#### PersistedMemoryClient

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

#### URL Parameter Detection

```typescript
// ?e2e triggers full in-memory mode
export function parseUrlConfig(): Partial<BackendConfig> | null {
  const params = new URLSearchParams(window.location.search);
  if (params.has("e2e")) return { dataUrl: "memory://" };
  return null;
}
```

#### Test Helpers

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

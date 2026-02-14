---
name: firecat
description: Firecat public B3nd network — canonical schema, wallet auth, session keypairs, accounts, resource visibility, React/Zustand/React Query apps, proxyWrite/proxyRead, resource identity, app identity, E2E testing. Use when working with Firecat endpoints, mutable://accounts, immutable://inbox, hash://sha256, link://accounts, WalletClient, or building apps on the Firecat network.
---

# Firecat — Public B3nd Network

Firecat is a protocol built on B3nd. It defines a specific set of programs
(schema), authentication model, and URI conventions for a public network. Apps
built on Firecat use these programs as their data layer.

For the B3nd framework itself (message primitives, SDK tools, protocol design
patterns), see the b3nd skill.

## Firecat Endpoints

| Service       | URL                                  |
| ------------- | ------------------------------------ |
| Backend Node  | `https://testnet-evergreen.fire.cat` |
| Wallet Server | `https://testnet-wallet.fire.cat`    |
| App Server    | `https://testnet-app.fire.cat`       |

## Canonical Schema

These are the programs Firecat nodes run. App developers use these — don't
create custom programs on Firecat.

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

## URI Structure

```typescript
// Pattern: {scheme}://accounts/{pubkey}/{path}
"mutable://accounts/052fee.../profile"
"immutable://accounts/052fee.../posts/1"
"hash://sha256/2cf24dba..."
"link://accounts/052fee.../avatar"
```

**URI mapping — common Firecat patterns:**

```
Private user data:   mutable://accounts/{userPubkey}/app/settings      (signed, encrypted)
User-owned resource: mutable://accounts/{resourcePubkey}/data          (resource has own keypair)
Public announcements: mutable://open/app/announcements                 (anyone can write — use sparingly)
Content-addressed:   hash://sha256/{hash}                               (trustless, immutable)
Named reference:     link://accounts/{userPubkey}/app/avatar            (signed pointer to hash)
Inbox message:       immutable://inbox/{recipientPubkey}/topic/{ts}    (write-once delivery)
```

## Wallet & Authentication

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

Two messages to the data node:
1. `immutable://inbox/{appKey}/sessions/{sessionPubkey}` — signed request
2. `mutable://accounts/{appKey}/sessions/{sessionPubkey}` — approval (value=1)

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

## Resource Identity Pattern

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

## App Identity Pattern

Apps derive a deterministic keypair for app-owned shared resources:

```typescript
const appIdentity = await deriveKeypairFromSeed(appKey);
// App owns: mutable://accounts/{appPubkey}/public-resources
```

## Resource Visibility

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

## React Applications

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

## E2E Testing

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

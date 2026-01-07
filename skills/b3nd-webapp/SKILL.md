---
name: b3nd-webapp
description: React/Vite web apps with B3nd SDK and Firecat network. Use when building React apps with B3nd, implementing visibility controls, password-protected resources, Zustand state management, React Query, or connecting to Firecat.
---

# B3nd Web Application Development

React/Vite apps connecting to the Firecat network.

## Firecat Configuration

Default endpoints for production apps:

```typescript
// config/firecat.ts
export const FIRECAT = {
  backend: "https://testnet-evergreen.fire.cat",
  wallet: "https://testnet-wallet.fire.cat",
  app: "https://testnet-app.fire.cat",
};

// For local B3nd services (ports: 9942, 9943, 9944)
export const LOCAL = {
  backend: "http://localhost:9942",
  wallet: "http://localhost:9943",
  app: "http://localhost:9944",
};

export const config = import.meta.env.DEV ? LOCAL : FIRECAT;
```

## Available Protocols

Use the canonical Firecat schema - don't create custom protocols:

| Protocol | Use Case |
|----------|----------|
| `mutable://open/{path}` | Public data, no auth |
| `mutable://accounts/{pubkey}/{path}` | User data, wallet auth |
| `immutable://open/{path}` | Permanent public content |
| `immutable://accounts/{pubkey}/{path}` | Permanent user content |
| `immutable://inbox/{pubkey}/{path}` | Private messages |

## Project Setup

### Dependencies

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
    "typescript": "~5.8.3",
    "tailwindcss": "^3.4.0"
  }
}
```

### Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5555 },
});
```

## Client Integration Pattern

### HTTP Adapter

Wrap `HttpClient` in an adapter for your app:

```typescript
import { HttpClient } from "@bandeira-tech/b3nd-web";

export class HttpAdapter {
  private client: HttpClient;

  constructor(baseUrl: string) {
    this.client = new HttpClient({ url: baseUrl });
  }

  async listPath(path: string, options?: { page?: number; limit?: number }) {
    const uri = this.pathToUri(path);
    const result = await this.client.list(uri, options);
    if (!result.success) throw new Error(result.error);
    return result;
  }

  async readRecord(path: string) {
    const uri = this.pathToUri(path);
    const result = await this.client.read(uri);
    if (!result.success) throw new Error(result.error);
    return result.record;
  }

  private pathToUri(path: string): string {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 1) return `${parts[0]}://`;
    const protocol = parts[0];
    const domain = parts[1];
    const subpath = "/" + parts.slice(2).join("/");
    return `${protocol}://${domain}${subpath}`;
  }
}
```

## State Management with Zustand

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { HttpAdapter } from "./adapters/HttpAdapter";

interface AppState {
  backends: BackendConfig[];
  activeBackendId: string | null;
  currentPath: string;
}

interface AppActions {
  setActiveBackend: (id: string) => void;
  navigateToPath: (path: string) => void;
}

export const useAppStore = create<AppState & AppActions>()(
  persist(
    (set, get) => ({
      backends: [],
      activeBackendId: null,
      currentPath: "/",

      setActiveBackend: (id) => {
        set({ activeBackendId: id, currentPath: "/" });
      },

      navigateToPath: (path) => {
        set({ currentPath: path });
      },
    }),
    {
      name: "app-state",
      partialize: (state) => ({
        activeBackendId: state.activeBackendId,
      }),
    }
  )
);
```

## React Query Integration

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HttpClient } from "@bandeira-tech/b3nd-web";

const client = new HttpClient({ url: "http://localhost:9942" });

// Read query
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

// List query
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

// Write mutation
export function useWrite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ uri, data }: { uri: string; data: unknown }) => {
      const result = await client.write(uri, data);
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: (_, { uri }) => {
      queryClient.invalidateQueries({ queryKey: ["record", uri] });
    },
  });
}
```

## Wallet Authentication

**IMPORTANT:** Both signup AND login require an approved session keypair.

Sessions use Ed25519 keypairs for authentication. Flow:
1. Client generates session keypair via `generateSessionKeypair()`
2. Client posts SIGNED request to inbox: `immutable://inbox/{appKey}/sessions/{sessionPubkey}`
   - Signature proves ownership of session private key
   - Payload is arbitrary (app developers decide what info to require)
3. App validates signature, examines payload, and APPROVES: `mutable://accounts/{appKey}/sessions/{sessionPubkey} = 1`
4. Client signs auth payload with session private key
5. Wallet validates: session approved (=1), signature valid

This supports both local approval (same process) and remote/async approval workflows.

```typescript
import { WalletClient, generateSessionKeypair } from "@bandeira-tech/b3nd-web/wallet";
import type { SessionKeypair } from "@bandeira-tech/b3nd-web/wallet";
import { HttpClient } from "@bandeira-tech/b3nd-web";

const wallet = new WalletClient({
  walletServerUrl: "http://localhost:9943",
  apiBasePath: "/api/v1",
});

// Signup requires approved session
async function signup(
  appKey: string,
  sessionKeypair: SessionKeypair,
  credentials: { username: string; password: string }
) {
  // Session must be approved first via: mutable://accounts/{appKey}/sessions/{sessionPubkey} = 1
  const result = await wallet.signup(appKey, sessionKeypair, credentials);
  wallet.setSession(result);
  return result;
}

// Login requires approved session
async function login(
  appKey: string,
  sessionKeypair: SessionKeypair,
  credentials: { username: string; password: string }
) {
  // Session must be approved first via: mutable://accounts/{appKey}/sessions/{sessionPubkey} = 1
  const result = await wallet.login(appKey, sessionKeypair, credentials);
  wallet.setSession(result);
  return result;
}

// Session flow - direct writes to data node
// App needs its Ed25519 keypair (public key = appKey)

import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

async function createAndApproveSession(
  appKey: string,
  appPrivateKeyHex: string, // App's Ed25519 private key (hex)
  backendClient: HttpClient,
  extraPayload: Record<string, unknown> = {}
): Promise<SessionKeypair> {
  // 1. Generate session keypair
  const sessionKeypair = await generateSessionKeypair();

  // 2. Post SIGNED session request to inbox (proves session key ownership)
  const requestPayload = { timestamp: Date.now(), ...extraPayload };
  const signedRequest = await encrypt.createAuthenticatedMessageWithHex(
    requestPayload,
    sessionKeypair.publicKeyHex,
    sessionKeypair.privateKeyHex
  );
  await backendClient.write(
    `immutable://inbox/${appKey}/sessions/${sessionKeypair.publicKeyHex}`,
    signedRequest
  );

  // 3. App APPROVES session - write 1 signed by app's key
  const signedApproval = await encrypt.createAuthenticatedMessageWithHex(
    1,
    appKey,
    appPrivateKeyHex
  );
  await backendClient.write(
    `mutable://accounts/${appKey}/sessions/${sessionKeypair.publicKeyHex}`,
    signedApproval
  );

  return sessionKeypair;
}

// Complete auth flow example
async function authFlow(backendClient: HttpClient) {
  const APP_KEY = "your-app-public-key-hex";
  const APP_PRIVATE_KEY = "your-app-private-key-hex";

  // 1. Create and approve session
  const sessionKeypair = await createAndApproveSession(
    APP_KEY,
    APP_PRIVATE_KEY,
    backendClient
  );

  // 2. Signup (first time)
  const session = await wallet.signup(APP_KEY, sessionKeypair, {
    type: 'password',
    username: "alice",
    password: "secret123"
  });

  // Or login (returning user)
  const session = await wallet.login(APP_KEY, sessionKeypair, {
    type: 'password',
    username: "alice",
    password: "secret123"
  });

  wallet.setSession(session);
  return session;
}
```

## Component Patterns

### Data Display Component

```typescript
function RecordViewer({ uri }: { uri: string }) {
  const { data, isLoading, error } = useRecord(uri);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <pre className="bg-gray-100 p-4 rounded">
      {JSON.stringify(data?.data, null, 2)}
    </pre>
  );
}
```

### Navigation Tree

```typescript
function NavigationTree({ path }: { path: string }) {
  const { data } = useList(path);
  const navigate = useAppStore((s) => s.navigateToPath);

  return (
    <ul>
      {data?.data.map((item) => (
        <li key={item.uri} onClick={() => navigate(item.uri)}>
          {item.type === "directory" ? "📁" : "📄"} {item.uri}
        </li>
      ))}
    </ul>
  );
}
```

## Resource Visibility in React

Implement private, protected, and public resources with client-side encryption.

### Crypto Utilities

```typescript
// crypto/keys.ts
import nacl from "tweetnacl";

const APP_SALT = "myapp-v1-salt";

export async function deriveKey(uri: string, password: string = ""): Promise<string> {
  const seed = `${APP_SALT}:${uri}:${password}`;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(seed), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(APP_SALT), iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function generateKeypair() {
  const keyPair = nacl.sign.keyPair();
  return {
    publicKeyHex: bytesToHex(keyPair.publicKey),
    privateKeyHex: bytesToHex(keyPair.secretKey),
  };
}
```

### Visibility Types

```typescript
// types/visibility.ts
export type Visibility = "private" | "protected" | "public";
export type VisibilityCode = "pvt" | "pro" | "pub";

export const visibilityToCode: Record<Visibility, VisibilityCode> = {
  private: "pvt", protected: "pro", public: "pub"
};

export const codeToVisibility: Record<VisibilityCode, Visibility> = {
  pvt: "private", pro: "protected", pub: "public"
};

// URL: /resources/{visibilityCode}/{resourceId}
export function getResourcePath(id: string, visibility: Visibility): string {
  return `/resources/${visibilityToCode[visibility]}/${id}`;
}
```

### Resource API with Encryption

```typescript
// api/resources.ts
export class ResourceAPI {
  private passwordCache = new Map<string, string>();

  async createResource(data: ResourceData, visibility: Visibility, password?: string) {
    const keys = generateKeypair();
    const uri = `mutable://accounts/${keys.publicKeyHex}/data`;

    // Derive encryption key based on visibility
    const encryptPassword = visibility === "private"
      ? this.getAccountPubkey()  // Owner's pubkey for private
      : (password || "");         // User password or empty for public

    const encrypted = await this.encrypt(data, uri, encryptPassword);
    const signed = await this.sign(encrypted, keys.privateKeyHex);

    await httpClient.write(uri, signed);

    // Cache password for session
    this.passwordCache.set(keys.publicKeyHex, encryptPassword);

    return { id: keys.publicKeyHex, visibility };
  }

  async loadResource(id: string, visibility: Visibility, password?: string) {
    const uri = `mutable://accounts/${id}/data`;
    const result = await httpClient.read(uri);
    if (!result.success) return null;

    const decryptPassword = visibility === "private"
      ? this.getAccountPubkey()
      : (password || "");

    try {
      return await this.decrypt(result.record.data, uri, decryptPassword);
    } catch {
      return null; // Wrong password
    }
  }
}
```

### Password Dialog Component

```typescript
// components/PasswordDialog.tsx
function PasswordDialog({
  isOpen,
  onSubmit,
  onCancel
}: {
  isOpen: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-lg">
        <h2>Enter Password</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border p-2 w-full"
        />
        <div className="flex gap-2 mt-4">
          <button onClick={() => onSubmit(password)}>Unlock</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

### Visibility-Aware Route

```typescript
// pages/ResourcePage.tsx
function ResourcePage() {
  const { visibilityCode, id } = useParams<{ visibilityCode: VisibilityCode; id: string }>();
  const visibility = codeToVisibility[visibilityCode!];
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [resource, setResource] = useState<Resource | null>(null);

  useEffect(() => {
    if (visibility === "protected") {
      setShowPasswordDialog(true);
    } else {
      loadResource(id!, visibility, "").then(setResource);
    }
  }, [id, visibility]);

  const handlePassword = async (password: string) => {
    const data = await loadResource(id!, visibility, password);
    if (data) {
      setResource(data);
      setShowPasswordDialog(false);
    } else {
      alert("Wrong password");
    }
  };

  return (
    <>
      <PasswordDialog
        isOpen={showPasswordDialog}
        onSubmit={handlePassword}
        onCancel={() => navigate("/")}
      />
      {resource && <ResourceViewer data={resource} />}
    </>
  );
}
```

### Router Setup

```typescript
// App.tsx
<Routes>
  <Route path="/resources/:visibilityCode/:id" element={<ResourcePage />} />
  {/* /resources/pub/{id} - public */}
  {/* /resources/pro/{id} - protected (shows password dialog) */}
  {/* /resources/pvt/{id} - private (requires owner login) */}
</Routes>
```

## Configuration Files

### instances.json (runtime config)

```json
{
  "defaults": {
    "backend": "firecat-testnet",
    "wallet": "firecat-wallet"
  },
  "backends": {
    "firecat-testnet": { "name": "Firecat Testnet", "baseUrl": "https://testnet-evergreen.fire.cat" },
    "local": { "name": "Local Dev", "baseUrl": "http://localhost:9942" }
  },
  "walletServers": {
    "firecat-wallet": { "name": "Firecat Wallet", "url": "https://testnet-wallet.fire.cat" },
    "local-wallet": { "name": "Local Wallet", "url": "http://localhost:9943" }
  }
}
```

## E2E Testing with Playwright

Full integration testing using in-memory B3nd clients that persist across page reloads.

### Playwright Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    // ?e2e triggers in-memory B3nd mode
    baseURL: 'http://localhost:5173/?e2e',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

### Backend Configuration with URL Params

Detect test mode via URL parameters:

```typescript
// domain/clients/backend-config.ts
export function parseUrlConfig(): Partial<BackendConfig> | null {
  const params = new URLSearchParams(window.location.search);

  // ?e2e triggers full in-memory mode
  if (params.has('e2e')) {
    return {
      dataUrl: 'memory://',
      walletUrl: 'memory://',
      appUrl: 'memory://',
      appKey: 'e2e-app-key',
    };
  }

  // Or explicit params: ?data=memory://&wallet=memory://
  const data = params.get('data');
  const wallet = params.get('wallet');
  if (data || wallet) {
    return { dataUrl: data || undefined, walletUrl: wallet || undefined };
  }

  return null;
}

// Resolution priority: URL params > localStorage > environment
export function resolveBackendConfig(): BackendConfig {
  const urlConfig = parseUrlConfig();
  if (urlConfig) return { ...getEnvConfig(), ...urlConfig };

  const storedConfig = loadStoredConfig();
  if (storedConfig) return storedConfig;

  return getEnvConfig();
}
```

### Persisted Memory Client

Memory client that survives page reloads:

```typescript
// test/persisted-memory-client.ts
import { MemoryClient, NodeProtocolInterface } from "@bandeira-tech/b3nd-web";

export class PersistedMemoryClient implements NodeProtocolInterface {
  private client: MemoryClient;
  private storageKey: string;

  constructor(config: { schema: Schema }, storageKey: string) {
    this.storageKey = storageKey;
    this.client = new MemoryClient(config);
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      const data = JSON.parse(saved);
      // Restore internal storage map
      for (const [key, value] of Object.entries(data)) {
        (this.client as any).storage.set(key, value);
      }
    }
  }

  private persistStorage(): void {
    const storage = (this.client as any).storage;
    const serialized: Record<string, unknown> = {};
    for (const [key, value] of storage.entries()) {
      serialized[key] = value;
    }
    localStorage.setItem(this.storageKey, JSON.stringify(serialized));
  }

  async write<T>(uri: string, value: T) {
    const result = await this.client.write(uri, value);
    this.persistStorage();
    return result;
  }

  async read<T>(uri: string) { return this.client.read<T>(uri); }
  async list(uri: string, options?: ListOptions) { return this.client.list(uri, options); }
  async delete(uri: string) {
    const result = await this.client.delete(uri);
    this.persistStorage();
    return result;
  }
  async health() { return this.client.health(); }
  async getSchema() { return this.client.getSchema(); }
  async cleanup() { return this.client.cleanup(); }
}
```

### Test Client Injection

Replace production clients with test clients:

```typescript
// domain/clients/index.ts
let httpClient: HttpClient | null = null;
let testHttpClient: NodeProtocolInterface | null = null;

export function getHttpClient(): NodeProtocolInterface {
  if (testHttpClient) return testHttpClient;  // Test override
  if (!httpClient) {
    httpClient = new HttpClient({ url: config.backendUrl });
  }
  return httpClient;
}

// Called during E2E initialization
export function configureTestClients(config: {
  httpClient: NodeProtocolInterface;
  localClient: NodeProtocolInterface;
  walletFetch: (request: Request) => Response | Promise<Response>;
}): void {
  testHttpClient = config.httpClient;
  testLocalClient = config.localClient;
  testWalletFetch = config.walletFetch;
}

export function resetTestClients(): void {
  testHttpClient = null;
  testLocalClient = null;
  testWalletFetch = null;
}
```

### App Initialization for E2E

Initialize test clients BEFORE AuthContext loads:

```typescript
// main.tsx
const backendConfig = resolveBackendConfig();
const useMemoryMode = backendConfig.dataUrl?.startsWith('memory://');

async function startApp() {
  // CRITICAL: Initialize test clients before AuthContext import
  if (useMemoryMode) {
    const { initializeLocalBackend } = await import('./domain/clients/local-backend');
    await initializeLocalBackend(backendConfig);
  }

  // Dynamic imports after backend setup
  const { AuthProvider } = await import('./contexts/AuthContext');
  const { default: App } = await import('./App.tsx');

  createRoot(document.getElementById('root')!).render(
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}

startApp();
```

### Test Helpers - User Management

```typescript
// e2e/helpers/auth.ts
export const TEST_USERS = {
  alice: { username: 'alice', email: 'alice@test.com', password: 'alice-password-123' },
  bob: { username: 'bob', email: 'bob@test.com', password: 'bob-password-123' },
};

const createdUsers = new Set<string>();

export async function signupTestUser(page: Page, userKey: keyof typeof TEST_USERS) {
  const user = TEST_USERS[userKey];

  await page.goto('/signup?e2e');
  await page.getByLabel(/Email/).fill(user.email);
  await page.getByLabel(/^Password/).first().fill(user.password);
  await page.getByLabel(/Confirm Password/).fill(user.password);
  await page.getByRole('button', { name: /create account/i }).click();

  // Complete profile setup
  await page.waitForURL(/\/account\/settings/);
  await page.getByLabel(/Username/).fill(user.username);
  await page.getByRole('button', { name: /save/i }).click();

  // Save session for fast switching
  await saveUserSession(page, userKey);
  createdUsers.add(userKey);
}

async function saveUserSession(page: Page, userKey: string) {
  await page.evaluate((key) => {
    const keys = ['app-memory-storage', 'app-wallet-storage', 'app-server-keys'];
    const data: Record<string, string> = {};
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v) data[k] = v;
    }
    const sessions = JSON.parse(localStorage.getItem('e2e-sessions') || '{}');
    sessions[key] = data;
    localStorage.setItem('e2e-sessions', JSON.stringify(sessions));
  }, userKey);
}

export async function loginAsTestUser(page: Page, userKey: keyof typeof TEST_USERS) {
  if (!createdUsers.has(userKey)) {
    await signupTestUser(page, userKey);
    return;
  }
  // Fast path: restore from saved session
  await restoreUserSession(page, userKey);
  await page.reload();
}

export async function clearTestData(page: Page) {
  createdUsers.clear();
  await page.goto('/?e2e');
  await page.evaluate(() => {
    const keys = ['app-memory-storage', 'app-wallet-storage', 'app-server-keys', 'e2e-sessions'];
    keys.forEach(k => localStorage.removeItem(k));
  });
  await page.goto('/?e2e');
}
```

### Example Test Pattern

```typescript
// e2e/resource-crud.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsTestUser, clearTestData } from './helpers/auth';

test.describe('Resource CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await clearTestData(page);
    await loginAsTestUser(page, 'alice');
  });

  test('can create and view resource', async ({ page }) => {
    await page.goto('/create?e2e');
    await page.getByLabel('Title').fill('Test Resource');
    await page.getByRole('button', { name: /create/i }).click();

    await expect(page).toHaveURL(/\/resources\//);
    await expect(page.getByText('Test Resource')).toBeVisible();
  });

  test('user isolation - users see only their resources', async ({ page }) => {
    // Alice creates resource
    await page.goto('/create?e2e');
    await page.getByLabel('Title').fill('Alice Resource');
    await page.getByRole('button', { name: /create/i }).click();

    // Switch to Bob
    await loginAsTestUser(page, 'bob');
    await page.goto('/my-resources?e2e');

    // Bob doesn't see Alice's resource
    await expect(page.getByText('Alice Resource')).not.toBeVisible();
  });
});
```

### npm Scripts

```json
{
  "test": "vitest",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "test:e2e:headed": "playwright test --headed",
  "test:e2e:debug": "playwright test --debug"
}
```

### Key Patterns

1. **URL Parameter Detection**: `?e2e` triggers in-memory mode
2. **Early Initialization**: Backend setup before AuthContext import
3. **Persisted Memory**: All storage survives page reloads via localStorage
4. **Session Restoration**: Fast user switching without re-signup
5. **Test Client Injection**: `configureTestClients()` replaces production clients
6. **Data Isolation**: `clearTestData()` resets state between tests

## Key Files Reference

- `explorer/app/src/App.tsx` - Main app with React Query + Zustand
- `explorer/app/src/stores/appStore.ts` - Zustand store with persistence
- `explorer/app/src/adapters/HttpAdapter.ts` - HttpClient adapter pattern
- `explorer/app/src/types/index.ts` - TypeScript types for app state

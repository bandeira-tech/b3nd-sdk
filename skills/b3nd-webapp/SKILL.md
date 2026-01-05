---
name: b3nd-webapp
description: React/Vite web apps with B3nd SDK, resource visibility UI, password dialogs, encrypted storage. Use when building React apps with B3nd, implementing visibility controls, password-protected resources, Zustand state management, or React Query with B3nd.
---

# B3nd Web Application Development

Patterns for building React/Vite web applications with B3nd.

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

const client = new HttpClient({ url: "http://localhost:8842" });

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

```typescript
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";

const wallet = new WalletClient({
  walletServerUrl: "http://localhost:8843",
  apiBasePath: "/api/v1",
});

// In a React component
function useWalletAuth() {
  const [session, setSession] = useState(null);

  const login = async (appKey: string, credentials: { username: string; password: string }) => {
    const result = await wallet.login(appKey, credentials);
    wallet.setSession(result);
    setSession(result);
  };

  const proxyWrite = async (uri: string, data: unknown, encrypt = false) => {
    return wallet.proxyWrite({ uri, data, encrypt });
  };

  return { session, login, proxyWrite };
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
    "backend": "local-api",
    "wallet": "local-wallet"
  },
  "backends": {
    "local-api": { "name": "Local API", "baseUrl": "http://localhost:8842" }
  },
  "walletServers": {
    "local-wallet": { "name": "Local Wallet", "url": "http://localhost:8843" }
  }
}
```

## Key Files Reference

- `explorer/app/src/App.tsx` - Main app with React Query + Zustand
- `explorer/app/src/stores/appStore.ts` - Zustand store with persistence
- `explorer/app/src/adapters/HttpAdapter.ts` - HttpClient adapter pattern
- `explorer/app/src/types/index.ts` - TypeScript types for app state

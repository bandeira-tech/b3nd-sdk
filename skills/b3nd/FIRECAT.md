---
name: firecat
description: Firecat app development — building apps on the Firecat public B3nd network. Quick start (browser + Deno), canonical schema, authentication, resource identity, app identity, resource visibility, running a Firecat node (HTTP server, Postgres/MongoDB, multi-backend), building browser apps (React, Zustand, React Query), Deno CLI, testing (MemoryClient, E2E Playwright), environment variables. Use when building any app on Firecat or asking about Firecat programs, URIs, visibility, accounts. For building your own DePIN protocol, see the b3nd-framework skill.
---

# Firecat — Building Apps on the Public B3nd Network

Firecat is a protocol built on B3nd. It defines a specific set of programs
(schema), authentication model, and URI conventions for a public network. Apps
built on Firecat use these programs as their data layer.

If you're building an app, you're in the right place. For building your own
DePIN protocol, see the b3nd-framework skill.

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

## Firecat Endpoints

| Service       | URL                                  |
| ------------- | ------------------------------------ |
| Backend Node  | `https://testnet-evergreen.fire.cat` |

## Canonical Schema

These are the programs Firecat nodes run. App developers use these — don't
create custom programs on Firecat.

| Program                | Access                | Use Case                           |
| ---------------------- | --------------------- | ---------------------------------- |
| `mutable://open`       | Anyone                | Public data, no auth needed        |
| `mutable://accounts`   | Pubkey-signed         | User data, requires auth           |
| `immutable://open`     | Anyone, once          | Content-addressed, no overwrites   |
| `immutable://accounts` | Pubkey-signed, once   | Permanent user data                |
| `immutable://inbox`    | Message inbox         | Suggestions, notifications         |
| `hash://sha256`        | Anyone, hash-verified | Content-addressed data (SHA256) |
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

## Authentication

Writes to `accounts` programs require Ed25519 signatures. The pubkey in the URI
determines who can write. Messages must be signed with the matching private key
using `createAuthenticatedMessageWithHex` from the encrypt module.

```typescript
import { send } from "@bandeira-tech/b3nd-sdk";
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

const backendClient = new HttpClient({ url: "https://testnet-evergreen.fire.cat" });

// Sign data with your keypair
const signed = await encrypt.createAuthenticatedMessageWithHex(
  { name: "Alice" },
  publicKeyHex,
  privateKeyHex,
);

// Write to your account
await send({
  payload: {
    inputs: [],
    outputs: [[
      `mutable://accounts/${publicKeyHex}/profile`,
      signed,
    ]],
  },
}, backendClient);
```

## Resource Identity Pattern

Every resource has its own Ed25519 keypair. The public key becomes the resource's
permanent identity/address:

```typescript
const resourceKeys = await encrypt.generateSigningKeyPair();
const resourceUri = `mutable://accounts/${resourceKeys.publicKeyHex}/data`;

// Sign and write resource data
const signed = await encrypt.createAuthenticatedMessageWithHex(
  { title: "My Resource" },
  resourceKeys.publicKeyHex,
  resourceKeys.privateKeyHex,
);
await send({
  payload: { inputs: [], outputs: [[resourceUri, signed]] },
}, backendClient);
```

Resource private keys are sent encrypted to the owner's account index.

## App Identity Pattern

Apps derive a deterministic keypair for app-owned shared resources:

```typescript
const appIdentity = await encrypt.deriveKeyFromSeed(appKey, APP_SALT, 100000);
// App owns: mutable://accounts/{appPubkey}/public-resources
```

## Node Operator Responsibility

Firecat nodes accept messages that pass schema validation. What happens after
acceptance — storage engine, retention policy, replication — is the node
operator's choice. The Firecat protocol defines validation rules, not storage
requirements.

Testnet nodes (`testnet-evergreen.fire.cat`) use persistent backends, but this
is an operator decision. A Firecat node backed by MemoryClient is still a valid
Firecat node — it just loses state on restart. App developers should not assume
durability from the protocol. If an app needs guaranteed persistence, it should
confirm reads after writes or use redundant nodes.

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

---

## Running a Firecat Node

Run your own Firecat node for local development or to operate a public node on
the Firecat network. Firecat nodes validate messages against the canonical
schema above.

### Installation

```typescript
// deno.json
{ "imports": { "@bandeira-tech/b3nd-sdk": "jsr:@bandeira-tech/b3nd-sdk" } }

import {
  createServerNode, createValidatedClient, firstMatchSequence,
  FunctionalClient, HttpClient, MemoryClient, MongoClient, msgSchema,
  parallelBroadcast, PostgresClient, send, servers,
} from "@bandeira-tech/b3nd-sdk";
```

### HTTP Server with Hono

```typescript
import { createServerNode, MemoryClient, servers } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

// Import or define the Firecat schema
import firecatSchema from "./firecat-schema.ts";

const client = new MemoryClient({ schema: firecatSchema });
const app = new Hono();
const frontend = servers.httpServer(app);
const node = createServerNode({ frontend, client });
node.listen(43100);
```

### Multi-Backend Server

```typescript
const clients = [
  new MemoryClient({ schema: firecatSchema }),
  new PostgresClient({ connection, schema: firecatSchema, tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000 }),
];

const client = createValidatedClient({
  receive: parallelBroadcast(clients),
  read: firstMatchSequence(clients),
  validate: msgSchema(firecatSchema),
});

const frontend = servers.httpServer(app);
createServerNode({ frontend, client });
```

### PostgreSQL / MongoDB Setup

```typescript
// Postgres
const pg = new PostgresClient({
  connection: "postgresql://user:pass@localhost:5432/db",
  schema: firecatSchema, tablePrefix: "b3nd", poolSize: 5, connectionTimeout: 10000,
}, executor);
await pg.initializeSchema();

// MongoDB
const mongo = new MongoClient({
  connectionString: "mongodb://localhost:27017/mydb",
  schema: firecatSchema, collectionName: "b3nd_data",
}, executor);
```

### Environment Variables

```bash
PORT=43100
CORS_ORIGIN=*
BACKEND_URL=postgres://user:pass@localhost:5432/db
SCHEMA_MODULE=./firecat-schema.ts
# Multiple backends:
BACKEND_URL=memory://,postgres://...,http://other-node:9942
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

### LocalStorageClient

```typescript
const local = new LocalStorageClient({
  keyPrefix: "myapp_",
  schema: {/* optional */},
});
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

## Deno CLI & Scripts

```typescript
#!/usr/bin/env -S deno run -A
import { HttpClient } from "@bandeira-tech/b3nd-sdk";

const BACKEND_URL = Deno.env.get("BACKEND_URL") || "https://testnet-evergreen.fire.cat";
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

---

## Testing Firecat Apps

### Unit Testing with MemoryClient

```typescript
import { assertEquals } from "@std/assert";
import { MemoryClient, send } from "@bandeira-tech/b3nd-sdk";

// Use the Firecat schema for realistic testing
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

### Shared Test Suites

```typescript
import { runSharedSuite } from "../tests/shared-suite.ts";
import { runNodeSuite } from "../tests/node-suite.ts";

runSharedSuite("MyClient", {
  happy: () => createMyClient(firecatSchema),
  validationError: () => createMyClient(strictSchema),
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

#### Test Client Injection

Initialize test clients BEFORE AuthContext loads:

```typescript
// main.tsx
if (useMemoryMode) {
  const { initializeLocalBackend } = await import("./domain/clients/local-backend");
  await initializeLocalBackend(backendConfig);
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

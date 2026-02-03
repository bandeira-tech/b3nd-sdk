# B3ND SDK Browser User Manual

A comprehensive guide to using the B3ND SDK in browser applications for local and remote data management.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Local Storage Management](#1-local-storage-management)
3. [HTTP API Integration](#2-http-api-integration)
4. [WebSocket API Integration](#3-websocket-api-integration)
5. [Hybrid Local + HTTP Setup](#4-hybrid-local--http-setup)
6. [Advanced Patterns](#advanced-patterns)
7. [Complete Examples](#complete-examples)

---

## Quick Start

### Installation

```bash
npm install @bandeira-tech/b3nd-sdk
```

### Basic Concept

The B3ND SDK uses a URI-based approach for data storage:

```
protocol://domain/path
```

Examples:
- `users://alice/profile`
- `cache://session/data`
- `posts://article-123/content`

All clients implement the same interface, making it easy to switch between local and remote storage.

---

## 1. Local Storage Management

### Option A: localStorage (5-10MB, Synchronous)

**Best for:** User preferences, session data, auth tokens, small datasets

```typescript
import { LocalStorageClient } from '@bandeira-tech/b3nd-sdk';

// Create client
const storage = new LocalStorageClient({
  keyPrefix: "myapp:",  // Avoid key collisions
  schema: {
    "users://": async ({ value }) => {
      // Optional validation
      if (typeof value === 'object' && value !== null && 'email' in value) {
        return { valid: true };
      }
      return { valid: false, error: "Users must have email" };
    },
  },
});

// Write data
const result = await storage.receive(["users://current/profile", {
  email: "user@example.com",
  name: "John Doe",
  preferences: { theme: "dark" },
}]);

if (result.accepted) {
  console.log("Transaction accepted");
}

// Read data
const readResult = await storage.read("users://current/profile");
if (readResult.success) {
  console.log("User data:", readResult.record?.data);
}

// List all items
const listResult = await storage.list("users://", {
  page: 1,
  limit: 20,
  sortBy: "timestamp",
  sortOrder: "desc",
});

// Delete data
await storage.delete("users://current/profile");

// Check storage health
const health = await storage.health();
console.log("Storage used:", health.details?.totalSize, "bytes");

// Cleanup when done
await storage.cleanup();
```

**Custom Serialization Example:**

```typescript
const encryptedStorage = new LocalStorageClient({
  keyPrefix: "secure:",
  serializer: {
    serialize: (data) => {
      const json = JSON.stringify(data);
      return btoa(json);  // Base64 encode (use real encryption in production)
    },
    deserialize: (data) => {
      const json = atob(data);
      return JSON.parse(json);
    },
  },
});
```

---

### Option B: IndexedDB (50MB+, Asynchronous)

**Best for:** Large datasets, offline-first apps, caching large objects, images

```typescript
import { IndexedDBClient } from '@bandeira-tech/b3nd-sdk';

// Create client
const db = new IndexedDBClient({
  databaseName: "myapp-db",
  storeName: "records",
  version: 1,
  schema: {
    "articles://": async ({ value }) => {
      if (typeof value === 'object' && value !== null && 'title' in value) {
        return { valid: true };
      }
      return { valid: false, error: "Articles need a title" };
    },
  },
});

// Store large objects
const article = {
  title: "Getting Started with B3ND",
  content: "... very long content ...",
  images: ["data:image/png;base64,..."],
  metadata: {
    tags: ['tutorial', 'javascript'],
    author: "Jane",
    publishedAt: Date.now(),
  },
};

await db.receive(["articles://post-1", article]);

// Efficient pagination
const page1 = await db.list("articles://", {
  page: 1,
  limit: 50,
  sortBy: "timestamp",
  sortOrder: "desc",
});

console.log(`Showing ${page1.data.length} of ${page1.pagination.total} articles`);

// Pattern matching
const searchResults = await db.list("articles://", {
  pattern: "tutorial",  // Match URIs containing "tutorial"
  limit: 10,
});

// Health monitoring
const health = await db.health();
console.log("Total records:", health.details?.totalRecords);

await db.cleanup();
```

**Choosing Between localStorage and IndexedDB:**

| Feature | localStorage | IndexedDB |
|---------|-------------|-----------|
| Size limit | ~5-10MB | ~50MB+ (can be higher) |
| API style | Synchronous | Asynchronous |
| Performance | Fast for small data | Fast for large data |
| Indexing | No | Yes |
| Use case | Preferences, tokens | Large datasets, offline apps |

---

## 2. HTTP API Integration

**Best for:** Production backends, multi-user systems, server-side validation, shared data

```typescript
import { HttpClient } from '@bandeira-tech/b3nd-sdk';

// Create client
const api = new HttpClient({
  url: "https://api.example.com",
  instanceId: "production",  // Optional: for multi-tenant APIs
  headers: {
    "Authorization": "Bearer your-jwt-token",
    "X-Custom-Header": "value",
  },
  timeout: 5000,  // 5 second timeout
});

// Send a transaction to the server
const result = await api.receive(["users://alice/profile", {
  name: "Alice",
  email: "alice@example.com",
  role: "admin",
}]);

if (result.accepted) {
  console.log("Transaction accepted");
} else {
  console.error("Server error:", result.error);
}

// Read from server
const readResult = await api.read("users://alice/profile");

// List with server-side pagination
const listResult = await api.list("users://", {
  page: 1,
  limit: 20,
  sortBy: "timestamp",
  sortOrder: "desc",
});

// Delete from server
await api.delete("users://alice/profile");

// Server health check
const health = await api.health();
console.log("Server status:", health.status);  // "healthy" | "degraded" | "unhealthy"

// Get server schemas
const schemas = await api.getSchema();
console.log("Supported programs:", schemas);  // ["users://", "posts://", ...]
```

**API Endpoints Used:**

```
POST   /api/v1/receive          (body: { tx: [uri, data] })
GET    /api/v1/read/{instance}/{protocol}/{domain}{path}
GET    /api/v1/list/{instance}/{protocol}/{domain}{path}?page=1&limit=20
DELETE /api/v1/delete/{protocol}/{domain}{path}
GET    /api/v1/health
GET    /api/v1/schema
```

**Dynamic Headers (Authentication):**

```typescript
async function getAuthenticatedClient() {
  const token = await getAuthToken();  // Your auth logic

  return new HttpClient({
    url: "https://api.example.com",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
    timeout: 10000,
  });
}

const client = await getAuthenticatedClient();
await client.receive(["data://test", { value: 123 }]);
```

---

## 3. WebSocket API Integration

**Best for:** Real-time updates, live collaboration, chat apps, notifications, low-latency operations

```typescript
import { WebSocketClient } from '@bandeira-tech/b3nd-sdk';

// Create client with reconnection
const ws = new WebSocketClient({
  url: "wss://realtime.example.com",
  auth: {
    type: "bearer",
    token: "your-jwt-token",
  },
  reconnect: {
    enabled: true,
    maxAttempts: 10,
    interval: 1000,
    backoff: "exponential",  // 1s, 2s, 4s, 8s, 16s...
  },
  timeout: 10000,
});

// All operations work the same way
await ws.receive(["events://user-123/action", {
  action: "clicked-button",
  timestamp: Date.now(),
  metadata: { page: "home" },
}]);

const event = await ws.read("events://user-123/action");

const events = await ws.list("events://user-123/");

// Subscribe to real-time updates
await ws.receive(["subscriptions://room/chat-123", {
  subscribed: true,
  userId: "user-123",
}]);

// Check connection health
const health = await ws.health();
if (health.status === "healthy") {
  console.log("WebSocket connected");
}

// Cleanup (disconnects)
await ws.cleanup();
```

**Authentication Methods:**

```typescript
// Bearer Token
const wsBearer = new WebSocketClient({
  url: "wss://api.example.com/ws",
  auth: {
    type: "bearer",
    token: "eyJhbGc...",
  },
});

// Basic Auth
const wsBasic = new WebSocketClient({
  url: "wss://api.example.com/ws",
  auth: {
    type: "basic",
    username: "user",
    password: "pass",
  },
});

// Custom Headers
const wsCustom = new WebSocketClient({
  url: "wss://api.example.com/ws",
  auth: {
    type: "custom",
    custom: {
      "X-API-Key": "secret-key",
      "X-User-ID": "user-123",
    },
  },
});
```

**Handling Connection Events:**

```typescript
const ws = new WebSocketClient({
  url: "wss://realtime.example.com",
  reconnect: { enabled: true },
});

// Monitor health status
setInterval(async () => {
  const health = await ws.health();
  if (health.status !== "healthy") {
    console.warn("Connection issue:", health.message);
  }
}, 5000);

// Use timeout for operations
try {
  const result = await ws.receive(["data://test", { value: 1 }]);
} catch (error) {
  console.error("Operation timed out or failed:", error);
}
```

---

## 4. Hybrid Local + HTTP Setup

Combine local storage with HTTP API for the best of both worlds: instant local access with server persistence.

### Pattern A: Parallel Broadcast (Write Everywhere)

**Use case:** Keep data in sync across local cache and server

```typescript
import { parallelBroadcast, LocalStorageClient, HttpClient } from '@bandeira-tech/b3nd-sdk';

// Local cache
const local = new LocalStorageClient({
  keyPrefix: "cache:",
});

// Remote server
const remote = new HttpClient({
  url: "https://api.example.com",
  headers: { "Authorization": `Bearer ${token}` },
});

// Combine clients
const hybrid = parallelBroadcast([local, remote]);

// Write to both in parallel
const result = await hybrid.receive(["users://alice/profile", {
  name: "Alice",
  email: "alice@example.com",
}]);

// Succeeds only if BOTH accept
if (result.accepted) {
  console.log("Saved locally AND to server");
} else {
  console.error("At least one failed:", result.error);
}

// Read from first client (local in this case)
const data = await hybrid.read("users://alice/profile");
console.log("Read from local cache:", data.record?.data);

// Delete from both
await hybrid.delete("users://alice/profile");

// Cleanup both
await hybrid.cleanup();
```

**With IndexedDB + HTTP:**

```typescript
const db = new IndexedDBClient({ databaseName: "app-cache" });
const api = new HttpClient({ url: "https://api.example.com" });
const hybrid = parallelBroadcast([db, api]);

// Store large objects both locally and remotely
await hybrid.receive(["articles://post-1", {
  title: "Article",
  content: "...",
  images: ["..."],
}]);
```

---

### Pattern B: First Match Sequence (Fallback Chain)

**Use case:** Try local first, fallback to server if not found (offline-first)

```typescript
import { firstMatchSequence, LocalStorageClient, HttpClient } from '@bandeira-tech/b3nd-sdk';

const local = new LocalStorageClient({ keyPrefix: "cache:" });
const remote = new HttpClient({ url: "https://api.example.com" });

// Try local first, then remote
const hybrid = firstMatchSequence([local, remote]);

// Read: tries local first, then remote if not found
const result = await hybrid.read("articles://post-1");

if (result.success) {
  if (result.record?.data.source === 'cache') {
    console.log("Loaded from cache (instant)");
  } else {
    console.log("Loaded from server");

    // Cache for next time
    await local.receive(["articles://post-1", result.record?.data]);
  }
}

// Write: tries local first, then remote if local fails
await hybrid.receive(["articles://post-2", {
  title: "New Article",
  content: "...",
}]);

// List: tries local first, then remote
const articles = await hybrid.list("articles://");
```

**Offline-First with Sync:**

```typescript
const cache = new IndexedDBClient({ databaseName: "offline-cache" });
const api = new HttpClient({ url: "https://api.example.com" });
const offlineFirst = firstMatchSequence([cache, api]);

// Always works, even offline
const data = await offlineFirst.read("data://important");

// Sync when online
window.addEventListener('online', async () => {
  console.log("Back online, syncing...");

  // Get all cached items
  const cached = await cache.list("data://");

  // Push to server
  for (const item of cached.data) {
    const localData = await cache.read(item.uri);
    if (localData.success) {
      await api.receive([item.uri, localData.record?.data]);
    }
  }

  console.log("Sync complete");
});
```

---

### Pattern C: Complete Multi-Layer Hybrid

**Use case:** Memory cache + persistent local + remote server

```typescript
import {
  MemoryClient,
  IndexedDBClient,
  HttpClient,
  parallelBroadcast,
  firstMatchSequence,
} from '@bandeira-tech/b3nd-sdk';

// Layer 1: Fast in-memory cache
const memory = new MemoryClient({
  schema: {
    "cache://": async () => ({ valid: true }),
  },
});

// Layer 2: Persistent local storage
const db = new IndexedDBClient({
  databaseName: "app-db",
});

// Layer 3: Remote API
const api = new HttpClient({
  url: "https://api.example.com",
  headers: { "Authorization": `Bearer ${token}` },
});

// Write to all layers
const writeAll = parallelBroadcast([memory, db, api]);

// Read from layers in order (fastest first)
const readCascade = firstMatchSequence([memory, db, api]);

// Usage
async function saveData(uri: string, data: any) {
  return await writeAll.receive([uri, data]);
}

async function loadData(uri: string) {
  const result = await readCascade.read(uri);

  if (result.success) {
    // If found in db or api, update memory cache
    await memory.receive([uri, result.record?.data]);
  }

  return result;
}

// Example usage
await saveData("users://alice/profile", {
  name: "Alice",
  email: "alice@example.com",
});

const profile = await loadData("users://alice/profile");
```

---

## Advanced Patterns

### Smart Caching with TTL

```typescript
import { MemoryClient, HttpClient, firstMatchSequence } from '@bandeira-tech/b3nd-sdk';

const cache = new MemoryClient({ schema: {} });
const api = new HttpClient({ url: "https://api.example.com" });

async function getCachedData(uri: string, ttlMs: number = 5 * 60 * 1000) {
  // Check cache
  const cached = await cache.read(uri);

  if (cached.success) {
    const age = Date.now() - (cached.record?.ts || 0);

    if (age < ttlMs) {
      console.log("Cache hit (fresh)");
      return cached.record?.data;
    }

    console.log("Cache hit (stale), refreshing...");
  }

  // Fetch from API
  const fresh = await api.read(uri);

  if (fresh.success) {
    // Update cache
    await cache.receive([uri, fresh.record?.data]);
    return fresh.record?.data;
  }

  // Return stale cache if API fails
  if (cached.success) {
    console.log("API failed, using stale cache");
    return cached.record?.data;
  }

  throw new Error("No data available");
}

// Usage
const userData = await getCachedData("users://alice/profile", 5 * 60 * 1000);
```

---

### Optimistic UI Updates

```typescript
import { LocalStorageClient, HttpClient } from '@bandeira-tech/b3nd-sdk';

const local = new LocalStorageClient({ keyPrefix: "app:" });
const api = new HttpClient({ url: "https://api.example.com" });

async function optimisticWrite(uri: string, data: any) {
  // 1. Update local immediately (instant UI feedback)
  const localResult = await local.receive([uri, data]);

  if (!localResult.accepted) {
    return { success: false, error: "Local receive failed" };
  }

  // 2. Update UI (caller can continue)
  updateUI(data);

  // 3. Send to server in background
  const serverResult = await api.receive([uri, data]);

  if (!serverResult.accepted) {
    // 4. Rollback local on server error
    console.error("Server receive failed, rolling back");
    await local.delete(uri);
    showError("Failed to save to server");
    return { success: false, error: serverResult.error };
  }

  return { success: true };
}

// Usage
await optimisticWrite("posts://new-post", {
  title: "My Post",
  content: "...",
});
```

---

### Real-Time Sync with WebSocket

```typescript
import { IndexedDBClient, WebSocketClient } from '@bandeira-tech/b3nd-sdk';

const db = new IndexedDBClient({ databaseName: "realtime-app" });
const ws = new WebSocketClient({
  url: "wss://realtime.example.com",
  auth: { type: "bearer", token: token },
  reconnect: { enabled: true },
});

// Local write + real-time broadcast
async function writeWithBroadcast(uri: string, data: any) {
  // Save locally
  await db.receive([uri, data]);

  // Broadcast to other clients via WebSocket
  await ws.receive([uri, data]);
}

// Subscribe to updates
async function subscribeToUpdates(program: string, callback: (uri: string, data: any) => void) {
  // Tell server we want updates
  await ws.receive([`subscriptions://${program}`, { subscribed: true }]);

  // Poll for updates (in real app, server would push)
  setInterval(async () => {
    const health = await ws.health();
    if (health.status === "healthy") {
      // Check for updates
      const updates = await ws.list(program);
      for (const item of updates.data) {
        const result = await ws.read(item.uri);
        if (result.success) {
          // Update local cache
          await db.receive([item.uri, result.record?.data]);
          // Notify callback
          callback(item.uri, result.record?.data);
        }
      }
    }
  }, 1000);
}

// Usage
await writeWithBroadcast("messages://room-1/msg-1", {
  text: "Hello!",
  author: "Alice",
});

subscribeToUpdates("messages://room-1/", (uri, data) => {
  console.log("New message:", data);
  updateChatUI(data);
});
```

---

## Complete Examples

### Example 1: Todo App (localStorage + HTTP)

```typescript
import { LocalStorageClient, HttpClient, parallelBroadcast } from '@bandeira-tech/b3nd-sdk';

// Setup
const local = new LocalStorageClient({
  keyPrefix: "todos:",
  schema: {
    "todos://": async ({ value }) => {
      if (typeof value === 'object' && value !== null && 'text' in value) {
        return { valid: true };
      }
      return { valid: false, error: "Todos must have text" };
    },
  },
});

const api = new HttpClient({
  url: "https://api.example.com",
  headers: { "Authorization": `Bearer ${getToken()}` },
});

const storage = parallelBroadcast([local, api]);

// Add todo
async function addTodo(text: string) {
  const id = Date.now();
  const result = await storage.receive([`todos://user/todo-${id}`, {
    id,
    text,
    completed: false,
    createdAt: Date.now(),
  }]);

  if (result.accepted) {
    console.log("Todo added");
    return id;
  } else {
    console.error("Failed to add todo:", result.error);
    return null;
  }
}

// List todos
async function listTodos() {
  const result = await storage.list("todos://user/", {
    sortBy: "timestamp",
    sortOrder: "desc",
  });

  const todos = [];
  for (const item of result.data) {
    const todo = await storage.read(item.uri);
    if (todo.success) {
      todos.push(todo.record?.data);
    }
  }

  return todos;
}

// Toggle todo
async function toggleTodo(id: number) {
  const uri = `todos://user/todo-${id}`;
  const current = await storage.read(uri);

  if (current.success) {
    const updated = {
      ...current.record?.data,
      completed: !current.record?.data.completed,
    };
    await storage.receive([uri, updated]);
  }
}

// Delete todo
async function deleteTodo(id: number) {
  await storage.delete(`todos://user/todo-${id}`);
}
```

---

### Example 2: Offline-First Blog Reader

```typescript
import { IndexedDBClient, HttpClient, firstMatchSequence } from '@bandeira-tech/b3nd-sdk';

const cache = new IndexedDBClient({
  databaseName: "blog-cache",
  schema: {
    "articles://": async ({ value }) => {
      return { valid: typeof value === 'object' && value !== null && 'title' in value };
    },
  },
});

const api = new HttpClient({ url: "https://blog-api.example.com" });
const reader = firstMatchSequence([cache, api]);

// Fetch article (offline-first)
async function getArticle(slug: string) {
  const uri = `articles://${slug}`;
  const result = await reader.read(uri);

  if (result.success) {
    // Cache for offline access
    await cache.receive([uri, result.record?.data]);
    return result.record?.data;
  }

  throw new Error("Article not found");
}

// List cached articles (works offline)
async function getCachedArticles() {
  const result = await cache.list("articles://", {
    sortBy: "timestamp",
    sortOrder: "desc",
    limit: 50,
  });

  const articles = [];
  for (const item of result.data) {
    const article = await cache.read(item.uri);
    if (article.success) {
      articles.push(article.record?.data);
    }
  }

  return articles;
}

// Background sync when online
async function syncArticles() {
  if (!navigator.onLine) {
    console.log("Offline, skipping sync");
    return;
  }

  const latest = await api.list("articles://", { limit: 100 });

  for (const item of latest.data) {
    const article = await api.read(item.uri);
    if (article.success) {
      await cache.receive([item.uri, article.record?.data]);
    }
  }

  console.log("Sync complete");
}

// Auto-sync every 5 minutes
setInterval(syncArticles, 5 * 60 * 1000);
window.addEventListener('online', syncArticles);
```

---

### Example 3: Real-Time Collaboration (WebSocket + localStorage)

```typescript
import { LocalStorageClient, WebSocketClient } from '@bandeira-tech/b3nd-sdk';

const local = new LocalStorageClient({ keyPrefix: "collab:" });
const ws = new WebSocketClient({
  url: "wss://collab.example.com",
  auth: { type: "bearer", token: sessionToken },
  reconnect: { enabled: true, maxAttempts: 10 },
});

// Save document locally and broadcast changes
async function updateDocument(docId: string, content: string) {
  const uri = `documents://${docId}`;
  const doc = {
    content,
    lastModified: Date.now(),
    author: currentUser,
  };

  // Save locally (instant)
  await local.receive([uri, doc]);

  // Broadcast to other users
  await ws.receive([uri, doc]);

  return doc;
}

// Load document (local first, then sync)
async function loadDocument(docId: string) {
  const uri = `documents://${docId}`;

  // Try local first
  const localResult = await local.read(uri);

  // Get latest from server
  const serverResult = await ws.read(uri);

  if (serverResult.success) {
    // Update local cache
    await local.receive([uri, serverResult.record?.data]);
    return serverResult.record?.data;
  }

  // Fallback to local
  if (localResult.success) {
    return localResult.record?.data;
  }

  throw new Error("Document not found");
}

// Listen for remote changes
async function watchDocument(docId: string, onChange: (doc: any) => void) {
  const uri = `documents://${docId}`;

  // Subscribe to changes
  await ws.receive([`subscriptions://${docId}`, { subscribed: true }]);

  // Poll for updates (in production, server would push)
  const interval = setInterval(async () => {
    const health = await ws.health();
    if (health.status === "healthy") {
      const result = await ws.read(uri);
      if (result.success) {
        // Update local
        await local.receive([uri, result.record?.data]);
        // Notify
        onChange(result.record?.data);
      }
    }
  }, 500);

  return () => {
    clearInterval(interval);
    ws.write(`subscriptions://${docId}`, { subscribed: false });
  };
}

// Usage
const doc = await loadDocument("doc-123");
console.log("Loaded:", doc.content);

const unsubscribe = await watchDocument("doc-123", (updated) => {
  console.log("Document updated by", updated.author);
  renderDocument(updated.content);
});

// Make changes
await updateDocument("doc-123", "Updated content");

// Cleanup
unsubscribe();
```

---

## Error Handling

Transactions return `accepted: boolean`. Read operations return `success: boolean`:

```typescript
// For receive (transactions)
const txResult = await client.receive(["data://test", { value: 1 }]);

if (!txResult.accepted) {
  console.error("Transaction rejected:", txResult.error);

  // Handle specific errors
  if (txResult.error?.includes("validation")) {
    showValidationError(txResult.error);
  } else if (txResult.error?.includes("network")) {
    showOfflineWarning();
  } else {
    showGenericError(txResult.error);
  }
} else {
  console.log("Transaction accepted");
}

// For read operations
const readResult = await client.read("data://test");

if (readResult.success) {
  console.log("Data:", readResult.record?.data);
} else {
  console.error("Read failed:", readResult.error);
}
```

---

## Best Practices

1. **Always check `success` flag** before using results
2. **Use appropriate storage** for your data size:
   - < 5MB: localStorage
   - > 5MB: IndexedDB
3. **Implement timeouts** for HTTP/WebSocket operations
4. **Use key prefixes** to avoid collisions in localStorage
5. **Implement cleanup** when components unmount
6. **Handle offline scenarios** with hybrid patterns
7. **Validate data** with schemas before writing
8. **Monitor health** of remote connections

---

## Troubleshooting

**localStorage quota exceeded:**
```typescript
const health = await storage.health();
if (health.status === "degraded") {
  console.warn("Storage almost full, cleaning up...");
  // Delete old items
}
```

**HTTP timeout:**
```typescript
const api = new HttpClient({
  url: "https://api.example.com",
  timeout: 10000,  // Increase timeout
});
```

**WebSocket won't connect:**
```typescript
const health = await ws.health();
if (health.status === "unhealthy") {
  console.error("Connection failed:", health.message);
  // Fall back to HTTP or show error
}
```

---

## API Reference

### Core Types

```typescript
// Transaction: the core primitive for state changes
type Transaction<D = unknown> = [uri: string, data: D];

// Result of receiving a transaction
interface ReceiveResult {
  accepted: boolean;
  error?: string;
}

interface ReadResult<T> {
  success: boolean;
  record?: {
    ts: number;
    data: T;
  };
  error?: string;
}

interface DeleteResult {
  success: boolean;
  error?: string;
}

interface ListResult {
  data: Array<{
    uri: string;
    type: "file" | "directory";
  }>;
  pagination: {
    page: number;
    limit: number;
    total?: number;
  };
}

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  details?: Record<string, unknown>;
}
```

### Client Methods

All clients implement the `NodeProtocolInterface`:

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

---

This manual covers the four main use cases for browser applications. Feel free to point out any mistakes or request clarifications!

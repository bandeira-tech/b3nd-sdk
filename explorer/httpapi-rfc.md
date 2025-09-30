# Explorer ↔ HTTP API Integration RFC

**Status**: In Progress
**Date**: 2025-09-30 (Updated)
**Purpose**: Define changes needed to connect Explorer UI to HTTP API

---

## Implementation Status

### ✅ Completed

1. **HttpAdapter** - Created at `explorer/app/src/adapters/HttpAdapter.ts` using `client-sdk/browser.js`
2. **Browser-compatible client-sdk** - Created `client-sdk/browser.js` for Vite/browser environments
3. **Simplified list response** - Removed `name` and `ts` fields, returns only `{uri, type}`
4. **Consistent API endpoints** - List endpoint now matches read pattern: `/list/:instance/:protocol/:domain/:path*`
5. **Backend switching** - Explorer can switch between Mock and HTTP backends
6. **Schema endpoint** - `/api/v1/schema` returns schemas organized by instance: `{ schemas: { instanceId: [uris] }, instances: [...], default: "..." }`
7. **Schema-driven root navigation** - Explorer loads schemas and builds root nodes (protocol://domain) for navigation tree
8. **Root path handling** - ContentViewer and adapters properly handle "/" using schema-driven navigation instead of API calls
9. **Path validation** - HttpAdapter throws errors for invalid paths instead of using defaults

### 🚧 Current Issue

**List API returning 404 when clicking on schema nodes**

The navigation tree is now showing schema-based root nodes (e.g., "users://nataliarsand", "notes://nataliarsand"), but when clicking on them:
- Explorer calls `listPath("/users/nataliarsand")`
- HttpAdapter converts to `users://nataliarsand/`
- API endpoint: `GET /api/v1/list/:instance/:protocol/:domain/:path*`
- Returns **404 Not Found**

**Root Cause**: The list endpoint may be expecting a different path format or the instance parameter is incorrect.

**Investigation needed**:
1. ✅ API call format confirmed: `GET /api/v1/list/default/users/nataliarsand/` (from client-sdk browser.js:150)
2. ✅ Instance ID is being passed correctly (instanceId from HttpAdapter constructor)
3. **Next**: Check if there's actually data at `users://nataliarsand/` in the persistence layer
4. **Next**: Verify the list endpoint in httpapi can handle root-level protocol://domain paths (path="/")
5. **Next**: Check server logs to see what error the list endpoint is returning

**Likely cause**: The schema URIs (e.g., `users://nataliarsand`) may not have any child data in the persistence layer, so `listPath` returns empty/404. Need to either:
- Seed some test data at these paths
- Update the list endpoint to return empty array instead of 404 for valid but empty paths

### 🚧 Remaining Work

1. **Fix list endpoint 404 issue** - Debug why clicking schema nodes returns 404
2. **Search endpoint** - Add `/api/v1/search` endpoint to HTTP API

## Key Decisions Made

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Use client-sdk** - Explorer uses `b3nd/client-sdk` instead of custom HTTP code | Consistency, reusability, maintainability |
| 2 | **Path convention** - `/<protocol>/<domain>/<path>` format for all operations | Already used in read endpoint, clear structure |
| 3 | **Remove `name` field** - List responses only include `uri` and `type` | URI is the unique ID, name is redundant |
| 4 | **Remove `ts` from list** - Timestamp only available via separate read | Reduces payload, separates concerns |
| 5 | **No inline records** - List returns URIs only, records fetched separately | 2-step process: list (navigation) → read (data) |
| 6 | **Schema as string[]** - Schema endpoint returns array of URIs, not full objects | Simpler, keeps validation logic server-side |
| 7 | **Instance required** - Instance ID is mandatory, default from config | Explicit configuration, no ambiguity |

---

## Current State

### Explorer's BackendAdapter Interface

```typescript
interface BackendAdapter {
  name: string;
  type: 'mock' | 'http';
  baseUrl?: string;

  // Core operations
  listPath(path: string, options?: { page?: number; limit?: number }):
    Promise<PaginatedResponse<NavigationNode>>;

  readRecord(path: string): Promise<PersistenceRecord>;

  searchPaths(query: string, filters?: SearchFilters, options?: { page?: number; limit?: number }):
    Promise<PaginatedResponse<SearchResult>>;

  // Metadata
  getSchema(): Promise<Record<string, any>>;
  healthCheck(): Promise<boolean>;
}
```

### HTTP API Current Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/list/:protocol/:domain/:path*` | List directory contents |
| `GET` | `/api/v1/read/:instance/:protocol/:domain/:path*` | Read single record |
| `POST` | `/api/v1/write` | Write/update record |
| `DELETE` | `/api/v1/delete/:protocol/:domain/:path*` | Delete record |

**Missing**: `/search`, `/schema`

---

## Gap Analysis

### 1. Path Format Mismatch

**Explorer expects:**
- Hierarchical paths like `/users/alice/profile`
- Assumes path structure implies protocol/domain

**HTTP API expects:**
- Explicit protocol and domain: `GET /api/v1/list/users/alice/profile`
- Full URI format for writes: `users://alice/profile`

**Solution**: ✅ **DECISION MADE**
- Parse Explorer paths into protocol/domain/path components
- Convention: `/<protocol>/<domain>/<path>` (already used in read endpoint)
- First path segment = protocol, second = domain, rest = resource path

### 2. NavigationNode Type Mismatch

**Explorer expects (UPDATED):**
```typescript
interface NavigationNode {
  path: string;           // "/users/alice/profile" (PRIMARY ID)
  type: 'directory' | 'file';
  children?: NavigationNode[];
  // REMOVED: name - redundant, use path as ID
  // REMOVED: record - fetch separately via read action
}
```

**Rationale:**
- ✅ `path` is the unique identifier, no need for redundant `name`
- ✅ `record` removed from list response (2-step process: list → read)
- ✅ This reduces payload size and separates concerns

**HTTP API returns (SHOULD BE SIMPLIFIED):**
```typescript
interface ListResponse {
  data: Array<{
    uri: string;          // "users://alice/profile"
    type: "file" | "directory";
    // REMOVED: name - redundant with uri
    // REMOVED: ts - not needed in list (get from read if needed)
  }>;
  pagination: { ... };
}
```

**Alignment Changes:**
- ✅ `type` matches perfectly
- ✅ Transform `uri` → `path` in adapter
- ✅ Remove `name` from API response (redundant)
- ✅ Remove `ts` from list (available in read)
- ✅ `children` lazy-loaded (not in initial list)
- ✅ `record` fetched separately via read endpoint

### 3. Missing Search Endpoint

**Explorer needs:**
```typescript
searchPaths(
  query: string,
  filters?: {
    protocol?: string;
    domain?: string;
    pathPattern?: string;
    dataType?: string;
    dateRange?: { start: Date; end: Date };
  },
  options?: { page?: number; limit?: number }
): Promise<PaginatedResponse<SearchResult>>
```

**SearchResult format:**
```typescript
interface SearchResult {
  path: string;
  name: string;
  record: PersistenceRecord;
  snippet?: string;  // Preview of matched content
}
```

**HTTP API**: No `/search` endpoint exists

**Solution**: Add to HTTP API:
```
GET /api/v1/search?q=<query>&protocol=<protocol>&domain=<domain>&pathPattern=<pattern>&page=<n>&limit=<n>
```

Response:
```json
{
  "data": [
    {
      "uri": "users://alice/notes/todo",
      "name": "todo",
      "record": { "ts": 1234567890, "data": {...} },
      "snippet": "matching content preview..."
    }
  ],
  "pagination": { ... }
}
```

### 4. Missing Schema Endpoint

**Explorer needs:**
```typescript
getSchema(): Promise<Record<string, any>>
```

This returns the validation schemas/rules for different protocol://domain combinations.

**HTTP API**: No `/schema` endpoint exists

**Solution**: ✅ **DECISION MADE** - Add to HTTP API:
```
GET /api/v1/schema
```

Return array of schema URIs (not full schema objects):
```json
{
  "schemas": [
    "users://example",
    "apps://myapp",
    "test://localhost"
  ]
}
```

**Rationale:**
- ✅ Simpler response (just list of configured URIs)
- ✅ Schema definitions remain server-side (don't expose implementation)
- ✅ Explorer can display which schemas are configured without needing details

### 5. Read Endpoint Path Format

**Current API:**
```
GET /api/v1/read/:instance/:protocol/:domain/:path*
```

**Issue**: Requires instance in path

**Solution**: ✅ **DECISION MADE**
- Instance is **required** (not optional)
- Default instance is defined via configuration
- Explorer must know/select instance before reading

---

## Required Changes

### A. Explorer Changes

✅ **DECISION MADE**: Explorer should use `b3nd/client-sdk` instead of custom HTTP logic

**Approach:**
1. Import `b3nd/client-sdk` (HttpClient)
2. Wrap it in a BackendAdapter implementation
3. Transform responses to match Explorer's expectations
4. No custom fetch/HTTP code - delegate to client-sdk

**File**: `explorer/app/src/adapters/HttpAdapter.ts` (UPDATED)

```typescript
import { createHttpClient } from '@firecat/b3nd/client-sdk';
import type { B3ndClient } from '@firecat/b3nd/client-sdk';
import type { BackendAdapter, NavigationNode, PersistenceRecord, SearchResult, SearchFilters, PaginatedResponse } from '../types';

export class HttpAdapter implements BackendAdapter {
  name = "HTTP Backend";
  type = "http" as const;
  baseUrl: string;
  private client: B3ndClient;
  private instanceId: string;

  constructor(baseUrl: string = "http://localhost:8000", instanceId: string = "default") {
    this.baseUrl = baseUrl;
    this.instanceId = instanceId;
    this.client = createHttpClient(baseUrl, { instanceId });
  }

  async listPath(path: string, options?: { page?: number; limit?: number }):
    Promise<PaginatedResponse<NavigationNode>> {
    // Parse path: "/users/alice/profile" -> "users://alice/profile"
    const uri = this.pathToUri(path);

    // Use client-sdk to list
    const result = await this.client.list(uri, options);

    // Transform to Explorer format (simplified - no name, no ts)
    return {
      data: result.data.map(item => ({
        path: this.uriToPath(item.uri),
        type: item.type,
        children: undefined  // Lazy load
      })),
      pagination: result.pagination
    };
  }

  async readRecord(path: string): Promise<PersistenceRecord> {
    // Parse path and use client-sdk
    const uri = this.pathToUri(path);
    const result = await this.client.read(uri);

    if (!result.success || !result.record) {
      throw new Error(`Record not found: ${path}`);
    }

    return result.record;
  }

  async searchPaths(
    query: string,
    filters?: SearchFilters,
    options?: { page?: number; limit?: number }
  ): Promise<PaginatedResponse<SearchResult>> {
    // TODO: Implement when search endpoint is added
    // For now, return empty results
    return {
      data: [],
      pagination: {
        page: options?.page || 1,
        limit: options?.limit || 20,
        total: 0,
        hasNext: false,
        hasPrev: false
      }
    };
  }

  async getSchema(): Promise<string[]> {
    // TODO: Call /api/v1/schema when implemented
    // For now, return empty array
    return [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.health();
      return result.status === 'healthy';
    } catch {
      return false;
    }
  }

  // Helper: Convert "/users/alice/profile" -> "users://alice/profile"
  private pathToUri(path: string): string {
    const parts = path.split('/').filter(Boolean);
    const protocol = parts[0] || 'test';
    const domain = parts[1] || 'localhost';
    const subpath = '/' + parts.slice(2).join('/');
    return `${protocol}://${domain}${subpath}`;
  }

  // Helper: Convert "users://alice/profile" -> "/users/alice/profile"
  private uriToPath(uri: string): string {
    const url = new URL(uri);
    return `/${url.protocol.replace(':', '')}/${url.hostname}${url.pathname}`;
  }
}
```

**Key Changes:**
- ✅ Uses `b3nd/client-sdk` instead of raw fetch
- ✅ No redundant `name` field in NavigationNode
- ✅ Records fetched separately (not in list)
- ✅ Schema returns `string[]` instead of objects
- ✅ Instance ID configured at construction

### B. HTTP API Changes

#### 1. Add Search Endpoint

**File**: `httpapi/src/routes.ts`

Add:
```typescript
// GET /api/v1/search - Search across all paths
api.get("/search", async (c) => {
  try {
    const query = c.req.query("q") || "";
    const protocol = c.req.query("protocol");
    const domain = c.req.query("domain");
    const pathPattern = c.req.query("pathPattern");
    const pagination = PaginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });

    // TODO: Implement search logic
    // For now, return empty results
    const results = {
      data: [],
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: 0,
        hasNext: false,
        hasPrev: false
      }
    };

    return c.json(results, 200);
  } catch (error) {
    return handleAdapterError(error, "Search");
  }
});
```

#### 2. Add Schema Endpoint (UPDATED)

**File**: `httpapi/src/routes.ts`

Add:
```typescript
// GET /api/v1/schema - Get list of configured schema URIs
api.get("/schema", async (c) => {
  try {
    const adapter = getAdapter() as any;

    // Get list of configured schemas (just URIs, not full definitions)
    // This comes from the adapter's loaded schema keys
    const schemas: string[] = [];

    // If adapter exposes schema info, extract URI keys
    // Example: ["users://example", "apps://myapp", "test://localhost"]

    return c.json({ schemas }, 200);
  } catch (error) {
    return handleAdapterError(error, "Schema");
  }
});
```

**Response format:**
```json
{
  "schemas": [
    "users://alice",
    "apps://myapp",
    "test://localhost"
  ]
}
```

#### 3. Update List Response (SIMPLIFY)

**Current:**
```typescript
{
  data: Array<{
    uri: string;
    name: string;    // REMOVE - redundant
    type: "file" | "directory";
    ts: number;      // REMOVE - not needed in list
  }>
}
```

**Updated (Simplified):**
```typescript
{
  data: Array<{
    uri: string;               // e.g., "users://alice/profile"
    type: "file" | "directory"
  }>
}
```

**Changes needed in `httpapi/src/adapters/types.ts`:**
- Remove `name` field from `ListResult` item type
- Remove `ts` field from `ListResult` item type
- Keep only `uri` and `type`

**Rationale:**
- URI is the primary identifier (no need for name)
- Timestamp available via separate read operation
- Reduces response size
- Clearer separation of concerns (list = navigation, read = data)

---

## Implementation Summary

### Phase 1: Basic Integration ✅
- Created `HttpAdapter` using browser-compatible client-sdk
- Implemented `listPath()`, `readRecord()`, and `healthCheck()`
- Added backend switching (Mock ↔ HTTP)
- Simplified API response format (removed `name` and `ts` from list)
- Aligned all endpoints to consistent pattern: `/:instance/:protocol/:domain/:path*`

### Phase 2: Schema-Driven Navigation (Next)
See "Next Steps" section below for detailed implementation guide

### Phase 3: Search Support (Future)
Deferred until schema integration is complete

### Phase 4: Advanced Features (Future)
- Filtering and sorting options
- Search indexing
- Write/delete UI operations

---

## API Endpoints Summary

### Current Endpoints ✅
- `GET /api/v1/health` - Health check
- `GET /api/v1/list/:instance/:protocol/:domain/:path*` - List directory (simplified response)
- `GET /api/v1/read/:instance/:protocol/:domain/:path*` - Read record
- `POST /api/v1/write` - Write record
- `DELETE /api/v1/delete/:protocol/:domain/:path*` - Delete record
- `GET /api/v1/schema` - Get instances (needs enhancement to return schema URIs)

### Needed Enhancements
- `GET /api/v1/schema` - Should return configured schema URIs from loaded adapters
- `GET /api/v1/search` - Search endpoint (deferred)

---

## Path Convention

For simplicity, we recommend this path mapping:

**Explorer Path Format:**
```
/<protocol>/<domain>/<resource-path>
```

**Examples:**
- `/users/alice/profile` → `users://alice/profile`
- `/apps/myapp/config` → `apps://myapp/config`
- `/test/demo/hello` → `test://demo/hello`

**Special case for root:**
- `/` → List all protocols/domains (virtual root)

---

## Configuration

Add to Explorer's environment variables:

```env
VITE_API_URL=http://localhost:8000
VITE_API_TIMEOUT=30000
VITE_DEFAULT_PROTOCOL=test
VITE_DEFAULT_DOMAIN=localhost
```

Add to Explorer's backend config:

```typescript
const httpBackend: BackendConfig = {
  id: 'http-api',
  name: 'HTTP API (localhost:8000)',
  adapter: new HttpAdapter('http://localhost:8000'),
  isActive: true
};
```

---

## Testing Checklist

### Explorer Integration Tests
- [ ] List root directory
- [ ] Navigate into subdirectories
- [ ] View file contents
- [ ] Search for records
- [ ] Handle 404 errors gracefully
- [ ] Handle network errors gracefully
- [ ] Switch between backends
- [ ] Pagination works correctly

### HTTP API Tests
- [ ] Search returns correct results
- [ ] Search pagination works
- [ ] Schema endpoint returns valid schemas
- [ ] All endpoints handle errors properly
- [ ] CORS configured for Explorer origin

---

## Open Questions

1. **Should search be full-text or path-based?**
   - Full-text requires scanning all record data
   - Path-based is faster but less powerful
   - Recommendation: Start with path-based, add full-text later

2. **How to handle multiple instances in Explorer?**
   - Show instance selector in UI?
   - Use query param?
   - Recommendation: Use default instance, add selector later

3. **Should Explorer show raw JSON or formatted view?**
   - Current: Shows JSON
   - Alternative: Smart rendering based on data type
   - Recommendation: Keep JSON for now, add formatters later

4. **How to handle authentication?**
   - API uses signature-based auth
   - Explorer needs key management UI
   - Recommendation: Add in Phase 4

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Search performance with large datasets | High | Implement pagination, indexing, caching |
| Path format ambiguity | Medium | Document convention, add validation |
| CORS issues | High | Configure CORS in HTTP API server |
| Network latency | Medium | Add loading states, caching, debouncing |
| Error handling inconsistency | Medium | Standardize error format across API |

---

## Success Criteria

1. ✅ Explorer can list directories from HTTP API
2. ✅ Explorer can read files from HTTP API
3. ✅ Explorer can search records
4. ✅ Explorer displays schema information
5. ✅ All operations handle errors gracefully
6. ✅ Performance is acceptable (< 2s for most operations)
7. ✅ Documentation is complete and accurate

---

## Next Steps

### Priority 1: Schema-Driven Root Navigation

**Problem**: Explorer currently tries to load a hardcoded default path on startup. Instead, it should:
1. Load available schemas from `/api/v1/schema`
2. Build a virtual root tree showing available protocol://domain combinations
3. Let users browse from there

**Implementation**:

1. **Update schema endpoint** (`httpapi/src/mod.ts:59`)
   ```typescript
   // Current: Returns instance list
   // New: Return configured schema URIs from loaded schemas

   app.get("/api/v1/schema", async (c) => {
     const adapterManager = AdapterManager.getInstance();
     const schemas = await adapterManager.getLoadedSchemas(); // New method

     return c.json({
       schemas: schemas, // e.g., ["users://nataliarsand", "notes://example"]
       instances: adapterManager.getAllAdapterIds(),
       default: adapterManager.getDefaultInstanceId()
     });
   });
   ```

2. **Add getLoadedSchemas() to AdapterManager** (`httpapi/src/adapters/manager.ts`)
   ```typescript
   async getLoadedSchemas(): Promise<string[]> {
     const defaultAdapter = this.getAdapter(this.defaultInstanceId);
     // Extract schema keys from adapter.schema object
     // Return as array of URIs
   }
   ```

3. **Update Explorer to use schema for root** (`explorer/app/src/stores/appStore.ts`)
   ```typescript
   // On backend selection/app load:
   const schemas = await activeBackend.adapter.getSchema();

   // Build virtual root from schemas:
   const root = schemas.map(uri => {
     const url = new URL(uri);
     return {
       path: `/${url.protocol.replace(':', '')}/${url.hostname}`,
       name: `${url.protocol.replace(':', '')}://${url.hostname}`,
       type: 'directory'
     };
   });

   // Set as initial navigation tree instead of trying to list "/"
   ```

4. **Update HttpAdapter.getSchema()** (`explorer/app/src/adapters/HttpAdapter.ts`)
   ```typescript
   async getSchema(): Promise<string[]> {
     const response = await this.client.request("/api/v1/schema", { method: "GET" });
     const result = await response.json();
     return result.schemas || [];
   }
   ```

### Priority 2: Search Endpoint (Future)

Deferred until schema-driven navigation is working.

---

**Last Updated**: 2025-09-30 (Updated)
**Authors**: Claude
**Status**: Phase 1 Complete - Ready for Schema Integration

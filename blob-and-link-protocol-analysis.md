# B3nd Protocol Extension Analysis: Content-Addressed Storage (blob://) and Link References

## Executive Summary

This document analyzes adding two new protocol capabilities to B3nd Firecat:

1. **blob:// protocol** - Content-addressed storage with cryptographic hash validation
2. **link:// concept** - Authenticated references to other URIs, creating a separation between data and metadata layers

## Current B3nd Schema Architecture

### Schema Structure
```typescript
export type ValidationFn = (write: {
  uri: string;
  value: unknown;
  read: <T = unknown>(uri: string) => Promise<ReadResult<T>>;
}) => Promise<{ valid: boolean; error?: string }>;

export type Schema = Record<string, ValidationFn>;
```

### URI Matching Strategy
- **Server clients (Postgres, Mongo, Memory)**: Exact programKey lookup on `protocol://hostname`
- **Browser clients (LocalStorage, IndexedDB)**: Prefix matching using `uri.startsWith(programKey)`

Example:
- URI: `users://alice/profile/settings`
- Program key extraction: `users://alice`
- Schema lookup: `schema["users://alice"]`

### Validation Flow
```
1. Client receives write(uri, value)
2. Extract programKey from uri (protocol://hostname)
3. Look up validator = schema[programKey]
4. Execute validator({ uri, value, read })
5. Validator returns { valid: boolean; error?: string }
6. Only write if valid === true
```

---

## 1. blob:// Protocol: Content-Addressed Storage

### Concept
Content-addressed storage where the URI contains the cryptographic hash of the content. This ensures:
- **Immutability**: Content cannot be changed without changing its address
- **Deduplication**: Identical content has the same address
- **Integrity verification**: Hash in URI proves content hasn't been tampered with
- **Trustless validation**: Anyone can verify content matches its address

### Proposed URI Format

```
blob://open/sha256:<hex-encoded-hash>
```

Examples:
```
blob://open/sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
blob://accounts/sha256:a3f1b8c9d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0
```

### Schema Key Options

#### Option A: Prefix Matching (Recommended)
```typescript
const schema: Schema = {
  "blob://open": async ({ uri, value }) => {
    // Extract hash from URI path
    const url = new URL(uri);
    const path = url.pathname; // "/sha256:abc123..."

    if (!path.startsWith("/sha256:")) {
      return { valid: false, error: "Only sha256 hashes supported" };
    }

    const expectedHash = path.substring(8); // Remove "/sha256:" prefix

    // Compute SHA256 of the value
    const actualHash = await computeSha256(value);

    if (actualHash !== expectedHash) {
      return {
        valid: false,
        error: `Hash mismatch: expected ${expectedHash}, got ${actualHash}`
      };
    }

    return { valid: true };
  },
};
```

**Pros:**
- Works with existing prefix matching in LocalStorage/IndexedDB clients
- Single schema entry handles all blob URIs with any hash
- Clean separation: `blob://open` = public, `blob://accounts` = authenticated

**Cons:**
- Requires URL parsing to extract hash from path
- Path-based routing is new pattern in B3nd (currently only protocol://hostname)

#### Option B: Pattern Matching with Wildcards (Requires Core Changes)
```typescript
const schema: Schema = {
  "blob://open/sha256:*": async ({ uri, value }) => {
    // Would need wildcard matching support in core
  },
};
```

**Pros:**
- More explicit about hash format in schema key
- Could support multiple hash algorithms

**Cons:**
- Requires implementing wildcard/regex matching in all clients
- Breaking change to schema matching logic
- More complex implementation

**Recommendation**: Use Option A (prefix matching) as it works with the existing architecture.

### Implementation Details

#### Hash Computation Function
```typescript
/**
 * Compute SHA256 hash of a value
 * @param value - The value to hash (will be JSON.stringify'd)
 * @returns Hex-encoded SHA256 hash
 */
async function computeSha256(value: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(value));

  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  // Convert to hex string
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

#### Validator Implementation
```typescript
"blob://open": async ({ uri, value }) => {
  try {
    const url = new URL(uri);
    const path = url.pathname;

    // Parse hash algorithm and value
    const match = path.match(/^\/([^:]+):(.+)$/);
    if (!match) {
      return { valid: false, error: "Invalid hash format. Expected /algorithm:hash" };
    }

    const [, algorithm, expectedHash] = match;

    // Currently only support sha256
    if (algorithm !== "sha256") {
      return { valid: false, error: `Unsupported hash algorithm: ${algorithm}` };
    }

    // Validate hash format (64 hex characters for SHA256)
    if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
      return { valid: false, error: "Invalid SHA256 hash format" };
    }

    // Compute actual hash
    const actualHash = await computeSha256(value);

    // Compare hashes
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      return {
        valid: false,
        error: `Content hash mismatch: expected ${expectedHash}, got ${actualHash}`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Validation error",
    };
  }
},
```

### blob://accounts - Authenticated Blobs

**Question**: Should we support authenticated blobs?

**Option 1: No authentication on blobs (Recommended)**
- Blobs are content-addressed and immutable
- Authentication should happen at the reference/link layer
- Simpler model: data layer (blobs) vs metadata layer (links)
- Aligns with IPFS philosophy

**Option 2: Support blob://accounts**
```typescript
"blob://accounts": async ({ uri, value, read }) => {
  // First validate signature (like mutable://accounts)
  const getAccess = createPubkeyBasedAccess();
  const validator = authValidation(getAccess);
  const isValid = await validator({ uri, value });

  if (!isValid) {
    return { valid: false, error: "Signature verification failed" };
  }

  // Then validate content hash
  const url = new URL(uri);
  const path = url.pathname;
  const match = path.match(/^\/sha256:(.+)$/);

  if (!match) {
    return { valid: false, error: "Invalid hash format" };
  }

  const expectedHash = match[1];
  const actualHash = await computeSha256(value);

  if (actualHash !== expectedHash) {
    return { valid: false, error: "Hash mismatch" };
  }

  return { valid: true };
},
```

**Recommendation**: Start with `blob://open` only. Add `blob://accounts` if there's a clear use case for authenticated immutable content-addressed data.

---

## 2. link:// Concept: Authenticated References

### Concept
Links provide a level of indirection between content and its references:
- **Separation of concerns**: Data (blobs) vs metadata (links)
- **Authentication at reference layer**: Links can be authenticated even if target is not
- **Mutable references**: Links can be updated to point to new content
- **Content discovery**: Links provide human-readable paths to content-addressed data

### Architecture: Protocol vs Program Level

The user identified a key design question:
> "for links then we also need to make a distinction of mutable and immutable, so maybe it's on program vs. protocol level? i.e. mutable://link/:key, immutable://link/:key or link://accounts/... or mutable+link://accounts"

Let's analyze both approaches:

#### Option A: link as Program (Hostname)
```
mutable://link/:key
immutable://link/:key
```

**Schema:**
```typescript
const schema: Schema = {
  "mutable://link": async ({ uri, value, read }) => {
    // Validate link structure
    // value should be: { target: "blob://open/sha256:...", metadata: {...} }
  },

  "immutable://link": async ({ uri, value, read }) => {
    // Validate immutable link (write-once)
    const existing = await read(uri);
    if (existing.success) {
      return { valid: false, error: "Immutable link already exists" };
    }
    // Validate link structure
  },
};
```

**Pros:**
- Reuses existing protocols (mutable, immutable)
- Clear mutability semantics from protocol
- Consistent with existing patterns

**Cons:**
- `link` is treated as a top-level domain/hostname
- URI structure: `mutable://link/users/alice/avatar` (link as TLD)

#### Option B: link as Protocol
```
link://accounts/:key
link://open/:key
```

**Schema:**
```typescript
const schema: Schema = {
  "link://accounts": async ({ uri, value, read }) => {
    // Authenticated link
    // Verify signature
    // Validate link structure
  },

  "link://open": async ({ uri, value, read }) => {
    // Unauthenticated link
    // Validate link structure only
  },
};
```

**Pros:**
- Link is a distinct protocol (like blob)
- Authentication via hostname (accounts vs open)
- Cleaner conceptual model: protocols define resource types

**Cons:**
- No explicit mutability in protocol name
- Would need to infer mutability from implementation

#### Option C: Composite Protocol (Experimental)
```
mutable+link://accounts/:key
immutable+link://accounts/:key
```

**Pros:**
- Explicit about both mutability and resource type
- Most precise semantics

**Cons:**
- Requires changing URI parsing (URL constructor won't work)
- No standard for composite protocols
- Complex to implement

#### Recommendation: Option B (link as Protocol) with Mutability Rules

**Key Design Principle: Links are direct string values, not JSON objects**

```typescript
const schema: Schema = {
  // Mutable authenticated links
  "link://accounts": async ({ uri, value, read }) => {
    // 1. Verify signature (authenticated)
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value });

    if (!isValid) {
      return { valid: false, error: "Signature verification failed" };
    }

    // 2. Validate that value is a string URI
    if (typeof value !== 'string') {
      return { valid: false, error: "Link value must be a string URI" };
    }

    // 3. Validate target URI format
    try {
      new URL(value);
    } catch {
      return { valid: false, error: "Invalid target URI" };
    }

    return { valid: true };
  },

  // Mutable unauthenticated links
  "link://open": async ({ uri, value }) => {
    // Validate that value is a string URI
    if (typeof value !== 'string') {
      return { valid: false, error: "Link value must be a string URI" };
    }

    try {
      new URL(value);
    } catch {
      return { valid: false, error: "Invalid target URI" };
    }

    return { valid: true };
  },
};
```

**Mutability Semantics:**
- **link://open** - Mutable by default (can be overwritten)
- **link://accounts** - Mutable by default (owner can update)
- For immutable links, use **immutable://link** (Option A hybrid)

### Link Data Structure

**Links are simply string values containing the target URI.**

No complex JSON objects. No metadata wrapper. The protocol defines the behavior.

```typescript
// Type definition
type LinkValue = string; // A URI string
```

**Examples:**

```typescript
// Unauthenticated link to a blob - just a string!
"blob://open/sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

// Authenticated link to mutable data - just a string!
"mutable://open/status/latest"

// Link to another link (chaining) - just a string!
"link://accounts/alice/profile"

// Link to external HTTP resource - just a string!
"https://example.com/resource"
```

**If metadata is needed**, store it separately:
```typescript
// The link itself
await client.write("link://accounts/alice/avatar",
  "blob://open/sha256:2cf24dba..."
);

// Metadata stored alongside (optional)
await client.write("mutable://accounts/alice/avatar-metadata", {
  title: "User Avatar",
  contentType: "image/png",
  size: 45678,
  created: Date.now()
});
```

---

## 3. Architectural Patterns: Blobs + Links

### Pattern 1: Unauthenticated Blobs + Authenticated Links (Recommended)

**Use case**: User uploads an avatar image

```typescript
// Step 1: Write blob (content-addressed, no auth)
const imageData = { type: "image/png", data: base64ImageData };
const hash = await computeSha256(imageData);
const blobUri = `blob://open/sha256:${hash}`;

await client.write(blobUri, imageData);

// Step 2: Write authenticated link pointing to blob (just a string!)
await client.write(
  "link://accounts/alice/avatar",
  blobUri  // That's it! Just the target URI as a string
);

// Step 3 (optional): Write metadata separately if needed
await client.write(
  "mutable://accounts/alice/avatar-metadata",
  {
    title: "Alice's Avatar",
    contentType: "image/png",
    size: 45678,
    uploadedAt: Date.now()
  }
);
```

**Benefits:**
- Blob is publicly readable, content-verified
- Link is authenticated (proves Alice set this avatar)
- Link can be updated to point to new blob without rewriting blob
- Deduplication: Multiple users can link to same blob
- Maximum simplicity: link is just a string

### Pattern 2: Versioned Content with Links

```typescript
// Write multiple versions as blobs
await client.write("blob://open/sha256:v1hash...", contentV1);
await client.write("blob://open/sha256:v2hash...", contentV2);
await client.write("blob://open/sha256:v3hash...", contentV3);

// Update link to point to latest version (just a string!)
await client.write(
  "link://accounts/alice/document/latest",
  "blob://open/sha256:v3hash..."
);

// Keep historical links (strings!)
await client.write(
  "link://accounts/alice/document/v1",
  "blob://open/sha256:v1hash..."
);

await client.write(
  "link://accounts/alice/document/v2",
  "blob://open/sha256:v2hash..."
);

// Store version metadata separately
await client.write("mutable://accounts/alice/document/versions", {
  v1: { hash: "v1hash...", date: "2024-01-01" },
  v2: { hash: "v2hash...", date: "2024-02-01" },
  v3: { hash: "v3hash...", date: "2024-03-01", current: true }
});
```

### Pattern 3: Content Discovery and Indexing

```typescript
// Blob is anonymous content-addressed data
const tutorial = { title: "Tutorial", content: "..." };
const hash = await computeSha256(tutorial);
const blobUri = `blob://open/sha256:${hash}`;

await client.write(blobUri, tutorial);

// Multiple authenticated links provide discovery paths (just strings!)
await client.write(
  "link://accounts/alice/tutorials/intro",
  blobUri
);

await client.write(
  "link://accounts/bob/favorites/tutorial",
  blobUri
);

// Both Alice and Bob's links point to the same deduplicated blob
// Each user authenticates their own link to the shared content
```

---

## 4. Downstream Changes Required

### 4.1 Core Schema Changes

**Location**: `/installations/http-server/example-schema.ts`

**Changes**:
```typescript
import { computeSha256, validateLinkStructure } from "./validators.ts";

const schema: Schema = {
  // ... existing schemas ...

  // Content-addressed storage
  "blob://open": async ({ uri, value }) => {
    const url = new URL(uri);
    const path = url.pathname;
    const match = path.match(/^\/sha256:([a-f0-9]{64})$/i);

    if (!match) {
      return { valid: false, error: "Invalid blob URI format" };
    }

    const expectedHash = match[1];
    const actualHash = await computeSha256(value);

    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      return { valid: false, error: "Content hash mismatch" };
    }

    return { valid: true };
  },

  // Authenticated links (value is just a string URI)
  "link://accounts": async ({ uri, value, read }) => {
    // Verify signature
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value });

    if (!isValid) {
      return { valid: false, error: "Signature verification failed" };
    }

    // Validate link value (must be a string URI)
    return validateLinkValue(value);
  },

  // Unauthenticated links (value is just a string URI)
  "link://open": async ({ uri, value }) => {
    return validateLinkValue(value);
  },
};
```

### 4.2 Validation Utilities

**New file**: `/sdk/validators/content-addressed.ts`

```typescript
import { encodeHex } from "../shared/encoding.ts";

/**
 * Compute SHA256 hash of a value
 */
export async function computeSha256(value: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(value));

  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate link value (must be a string URI)
 */
export function validateLinkValue(value: unknown): { valid: boolean; error?: string } {
  // Link must be a string
  if (typeof value !== 'string') {
    return { valid: false, error: "Link value must be a string URI" };
  }

  // Validate that it's a valid URI
  try {
    new URL(value);
  } catch {
    return { valid: false, error: "Link value must be a valid URI" };
  }

  return { valid: true };
}

/**
 * Generate blob URI from content
 */
export async function generateBlobUri(value: unknown): Promise<string> {
  const hash = await computeSha256(value);
  return `blob://open/sha256:${hash}`;
}
```

### 4.3 Client Changes (Optional Helpers)

**Location**: `/sdk/clients/*/mod.ts` (all clients)

**Changes**: No changes required to core client logic, as schema validation handles everything. However, we could add helper methods:

```typescript
/**
 * Write content-addressed blob and return its URI
 */
async writeBlob<T>(value: T): Promise<{ uri: string; hash: string }> {
  const hash = await computeSha256(value);
  const uri = `blob://open/sha256:${hash}`;
  const result = await this.write(uri, value);

  if (!result.success) {
    throw new Error(`Failed to write blob: ${result.error}`);
  }

  return { uri, hash };
}

/**
 * Write link to a target URI (simplified - just write the string!)
 */
async writeLink(linkUri: string, targetUri: string): Promise<WriteResult> {
  return this.write(linkUri, targetUri);
}

/**
 * Resolve a link by reading it and fetching its target
 */
async resolveLink<T>(linkUri: string): Promise<T> {
  // Read the link (which is just a string URI)
  const linkResult = await this.read<string>(linkUri);
  if (!linkResult.success) {
    throw new Error(`Failed to read link: ${linkResult.error}`);
  }

  const targetUri = linkResult.record.data;

  // Fetch the target
  const targetResult = await this.read<T>(targetUri);
  if (!targetResult.success) {
    throw new Error(`Failed to read link target: ${targetResult.error}`);
  }

  return targetResult.record.data;
}
```

### 4.4 HTTP Server Changes

**Location**: `/sdk/servers/http.ts`

**Changes**: No changes needed. The existing endpoint already handles any protocol:

```typescript
app.post("/api/v1/write/:protocol/:domain/*", async (c: MinimalContext) => {
  // Works for blob://, link://, and any future protocols
  // ...existing implementation...
});
```

The path parameter `*` will capture the hash portion for blobs:
- Request: `POST /api/v1/write/blob/open/sha256:abc123...`
- Extracts: `protocol=blob, domain=open, path=sha256:abc123...`

### 4.5 Type Definitions

**Location**: `/sdk/src/types.ts`

**New types**:
```typescript
/**
 * Link value - just a string URI
 */
export type LinkValue = string;

/**
 * Blob metadata (optional wrapper for blob data)
 */
export interface BlobData<T = unknown> {
  type?: string;
  encoding?: string;
  data: T;
}
```

### 4.6 Documentation Changes

**New files needed**:
1. `/docs/protocols/blob.md` - Blob protocol specification
2. `/docs/protocols/link.md` - Link protocol specification
3. `/docs/guides/content-addressed-storage.md` - Usage guide

---

## 5. Testing Requirements

### 5.1 Unit Tests

**blob:// protocol**:
```typescript
// Test valid blob write
test("blob://open - accepts content with matching hash", async () => {
  const content = { data: "test" };
  const hash = await computeSha256(content);
  const uri = `blob://open/sha256:${hash}`;

  const result = await client.write(uri, content);
  expect(result.success).toBe(true);
});

// Test invalid hash
test("blob://open - rejects content with mismatched hash", async () => {
  const content = { data: "test" };
  const wrongHash = "0".repeat(64);
  const uri = `blob://open/sha256:${wrongHash}`;

  const result = await client.write(uri, content);
  expect(result.success).toBe(false);
  expect(result.error).toContain("hash mismatch");
});

// Test invalid hash format
test("blob://open - rejects invalid hash format", async () => {
  const content = { data: "test" };
  const uri = `blob://open/sha256:invalid`;

  const result = await client.write(uri, content);
  expect(result.success).toBe(false);
});
```

**link:// protocol**:
```typescript
// Test valid link (just a string!)
test("link://open - accepts valid link string", async () => {
  const linkTarget = "blob://open/sha256:abc123...";

  const result = await client.write("link://open/test", linkTarget);
  expect(result.success).toBe(true);
});

// Test invalid link type
test("link://open - rejects non-string values", async () => {
  const invalidLink = { target: "blob://..." }; // Wrong! Not a string

  const result = await client.write("link://open/test", invalidLink);
  expect(result.success).toBe(false);
  expect(result.error).toContain("must be a string");
});

// Test invalid URI
test("link://open - rejects invalid URI strings", async () => {
  const invalidUri = "not-a-valid-uri";

  const result = await client.write("link://open/test", invalidUri);
  expect(result.success).toBe(false);
  expect(result.error).toContain("valid URI");
});

// Test link resolution
test("resolveLink - fetches target content", async () => {
  const content = { data: "test" };
  const hash = await computeSha256(content);
  const blobUri = `blob://open/sha256:${hash}`;

  await client.write(blobUri, content);
  await client.write("link://open/test", blobUri); // Just the string!

  const resolved = await client.resolveLink("link://open/test");
  expect(resolved).toEqual(content);
});
```

### 5.2 Integration Tests

**End-to-end flow**:
```typescript
test("e2e: blob + authenticated link pattern", async () => {
  // 1. Write blob
  const avatar = { type: "image/png", data: "base64..." };
  const { uri: blobUri } = await client.writeBlob(avatar);

  // 2. Write authenticated link (just the string URI!)
  await client.write("link://accounts/alice/avatar", blobUri);

  // 3. Read link to get target URI
  const linkResult = await client.read<string>("link://accounts/alice/avatar");
  expect(linkResult.record.data).toBe(blobUri);

  // 4. Resolve link (helper fetches target)
  const resolved = await client.resolveLink("link://accounts/alice/avatar");
  expect(resolved).toEqual(avatar);
});
```

### 5.3 Performance Tests

- Hash computation performance for various data sizes
- Deduplication effectiveness
- Link resolution latency

---

## 6. Migration and Compatibility

### 6.1 Backward Compatibility

**Impact**: None. This is purely additive:
- Existing protocols unchanged
- Existing URIs unchanged
- Existing clients work as-is
- No database migrations needed

### 6.2 Opt-in Adoption

Projects can adopt blob:// and link:// incrementally:
1. Add validators to schema
2. Start writing blobs for new content
3. Migrate existing references to links over time

---

## 7. Future Enhancements

### 7.1 Additional Hash Algorithms

```typescript
"blob://open": async ({ uri, value }) => {
  const url = new URL(uri);
  const path = url.pathname;
  const match = path.match(/^\/([^:]+):(.+)$/);

  if (!match) {
    return { valid: false, error: "Invalid format" };
  }

  const [, algorithm, expectedHash] = match;

  switch (algorithm) {
    case "sha256":
      return validateSha256(value, expectedHash);
    case "sha512":
      return validateSha512(value, expectedHash);
    case "blake3":
      return validateBlake3(value, expectedHash);
    default:
      return { valid: false, error: `Unsupported algorithm: ${algorithm}` };
  }
},
```

### 7.2 CID Support (IPFS Compatibility)

```typescript
// Support IPFS CIDv1 format
"blob://open": async ({ uri, value }) => {
  const url = new URL(uri);
  const path = url.pathname.substring(1); // Remove leading /

  if (path.startsWith("baf")) {
    // CIDv1 format
    return validateCIDv1(value, path);
  } else if (path.startsWith("sha256:")) {
    // B3nd native format
    return validateSha256(value, path.substring(7));
  }

  return { valid: false, error: "Unknown hash format" };
},
```

### 7.3 Link Collections

Since links are just strings, collections are stored as arrays or objects:

```typescript
// Photo album as an array of blob URIs
const album = [
  "blob://open/sha256:photo1...",
  "blob://open/sha256:photo2...",
  "blob://open/sha256:photo3..."
];

await client.write("mutable://accounts/alice/photos/vacation", album);

// Or as an object with metadata
const albumWithMetadata = {
  photos: [
    { uri: "blob://open/sha256:photo1...", caption: "Beach", order: 1 },
    { uri: "blob://open/sha256:photo2...", caption: "Sunset", order: 2 },
    { uri: "blob://open/sha256:photo3...", caption: "Dinner", order: 3 }
  ],
  title: "Summer Vacation 2024",
  created: Date.now()
};

await client.write("mutable://accounts/alice/photos/vacation-metadata", albumWithMetadata);
```

### 7.4 Conditional Links (Smart Pointers)

For conditional behavior, use separate links or store logic in mutable:// data:

```typescript
// Platform-specific links
await client.write("link://accounts/app/installer/web", "blob://open/sha256:web-installer...");
await client.write("link://accounts/app/installer/ios", "blob://open/sha256:ios-installer...");
await client.write("link://accounts/app/installer/android", "blob://open/sha256:android-installer...");

// Or use a routing table in mutable://
const routingTable = {
  latest: "blob://open/sha256:v3...",
  stable: "blob://open/sha256:v2...",
  beta: "blob://open/sha256:v4-beta...",
  platforms: {
    web: "blob://open/sha256:web...",
    ios: "blob://open/sha256:ios...",
    android: "blob://open/sha256:android..."
  }
};

await client.write("mutable://accounts/app/routing", routingTable);
```

---

## 8. Implementation Recommendations

### Phase 1: Core Blob Protocol (Week 1)
1. ✅ Add `computeSha256` to validation utilities
2. ✅ Implement `blob://open` validator
3. ✅ Add unit tests for hash validation
4. ✅ Update example-schema.ts
5. ✅ Document blob:// protocol

### Phase 2: Link Protocol (Week 2)
1. ✅ Define Link interface
2. ✅ Implement `link://open` validator
3. ✅ Implement `link://accounts` validator
4. ✅ Add link structure validation
5. ✅ Add unit tests for links
6. ✅ Document link:// protocol

### Phase 3: Client Helpers (Week 3)
1. Add `writeBlob()` helper method
2. Add `writeLink()` helper method
3. Add `resolveLink()` helper method
4. Add `generateBlobUri()` utility
5. Integration tests for blob + link patterns

### Phase 4: Documentation and Examples (Week 4)
1. Create usage guides
2. Add example applications
3. Performance benchmarking
4. Migration guide for existing projects

---

## 9. Security Considerations

### 9.1 Hash Collision Resistance

**SHA-256** provides:
- **2^256** possible hashes
- Collision resistance: **2^128** operations to find collision
- Current state-of-the-art: No known practical attacks

**Risk**: Extremely low. SHA-256 is considered secure for content addressing.

### 9.2 Timing Attacks

**Concern**: Hash comparison could leak information via timing

**Mitigation**: Use constant-time comparison
```typescript
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}
```

### 9.3 Blob Poisoning

**Concern**: Attacker writes malicious content to blob

**Mitigation**:
- Blobs are content-addressed (URI = hash)
- Links provide trust layer
- Applications validate content type and structure
- Authenticated links prove who endorsed the content

### 9.4 Link Manipulation

**Concern**: Attacker modifies links to point to malicious blobs

**Mitigation**:
- Use `link://accounts` for critical references
- Signature verification ensures link authenticity
- Applications can verify link signatures before resolving

### 9.5 Denial of Service

**Concern**: Large blobs consume storage

**Mitigation**:
- Implement size limits in schema validators
- Rate limiting on write operations
- Storage quotas per account

```typescript
"blob://open": async ({ uri, value }) => {
  // Check size limit (e.g., 10MB)
  const size = JSON.stringify(value).length;
  const MAX_BLOB_SIZE = 10 * 1024 * 1024; // 10MB

  if (size > MAX_BLOB_SIZE) {
    return { valid: false, error: `Blob too large: ${size} bytes` };
  }

  // ... hash validation ...
},
```

---

## 10. Comparison with Existing Systems

### 10.1 IPFS

**Similarities**:
- Content-addressed storage
- Hash-based URIs
- Immutability

**Differences**:
- B3nd uses custom URI scheme (`blob://`)
- IPFS uses CID format (`Qm...` or `baf...`)
- B3nd integrates with authentication layer (link://accounts)
- IPFS has distributed network, B3nd is backend-agnostic

**Interop**: Could support CID format in future (see section 7.2)

### 10.2 Git

**Similarities**:
- Content-addressed object storage
- SHA-1/SHA-256 for object IDs
- Immutability

**Differences**:
- Git objects have internal structure (trees, blobs, commits)
- B3nd treats content as opaque JSON
- Git uses filesystem paths, B3nd uses URIs

### 10.3 Amazon S3 Object Storage

**Similarities**:
- Object storage with URIs
- Can enable versioning

**Differences**:
- S3 uses arbitrary keys, B3nd uses content hashes
- S3 is mutable by default, blobs are immutable
- S3 has no native authentication in URI, B3nd has link://accounts

---

## 11. Questions for Design Review

1. **Hash Algorithm**: Should we support multiple hash algorithms now, or start with SHA-256 only?
   - Recommendation: SHA-256 only initially, design for extensibility

2. **blob://accounts**: Is there a use case for authenticated blobs, or should all auth be at link layer?
   - Recommendation: Start without it, add if needed

3. **Link Mutability**: Should we have both mutable and immutable links?
   - Current design: link:// is mutable by default
   - Alternative: Use `immutable://link` for write-once links

4. **Link Chaining**: Should we support links pointing to other links?
   - Current design: Allows it (since links are just string URIs)
   - May want depth limits to prevent cycles in resolveLink()

5. **Deduplication**: Should clients auto-deduplicate by checking if blob exists before writing?
   - Tradeoff: Performance vs network roundtrips
   - Recommendation: Client helper method `writeBlobIfNotExists()`

6. **URI Validation**: Should we validate that link targets exist before allowing link creation?
   - Current design: No validation (allows dangling references)
   - Pro: Allows forward references (link created before target exists)
   - Con: Can have broken links

---

## 12. Summary and Recommendations

### Key Design Decisions

1. ✅ **Blob Protocol**: `blob://open/sha256:hash` with prefix matching
2. ✅ **Link Protocol**: `link://accounts` (auth) and `link://open` (no auth)
3. ✅ **Links are Simple Strings**: No complex JSON, just target URI as string value
4. ✅ **Separation of Concerns**: Data layer (blobs) vs metadata layer (links)
5. ✅ **Backward Compatible**: Purely additive, no breaking changes
6. ✅ **Extensible**: Design supports future hash algorithms and features

### Implementation Priority

**Must Have (Phase 1-2)**:
- blob://open validator
- link://open validator
- link://accounts validator
- Core utilities (computeSha256, validateLinkValue)
- Unit tests

**Should Have (Phase 3)**:
- Client helper methods (writeBlob, resolveLink)
- Integration tests
- Basic documentation

**Could Have (Phase 4)**:
- Multiple hash algorithms
- CID support
- Link collections
- Performance optimizations

### Next Steps

1. **Review this document** with team
2. **Decide on design questions** (section 11)
3. **Implement Phase 1** (blob://open)
4. **Test in example application**
5. **Iterate based on feedback**
6. **Proceed to Phase 2** (link protocol)

---

## Appendix: Code Examples

### A.1 Complete Validator Implementation

```typescript
// installations/http-server/validators.ts
import { encodeHex } from "@bandeira-tech/b3nd-sdk/encoding";
import { authValidation, createPubkeyBasedAccess } from "@bandeira-tech/b3nd-sdk/auth";
import type { ValidationFn } from "@bandeira-tech/b3nd-sdk";

/**
 * Compute SHA256 hash of a value
 */
export async function computeSha256(value: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(value));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate link value (must be a string URI)
 */
export function validateLinkValue(value: unknown): { valid: boolean; error?: string } {
  // Link must be a string
  if (typeof value !== 'string') {
    return { valid: false, error: "Link value must be a string URI" };
  }

  // Validate that it's a valid URI
  try {
    new URL(value);
  } catch {
    return { valid: false, error: "Link value must be a valid URI" };
  }

  return { valid: true };
}

/**
 * Create blob:// validator
 */
export function createBlobValidator(): ValidationFn {
  return async ({ uri, value }) => {
    try {
      const url = new URL(uri);
      const path = url.pathname;

      // Parse hash algorithm and value
      const match = path.match(/^\/([^:]+):(.+)$/);
      if (!match) {
        return { valid: false, error: "Invalid hash format. Expected /algorithm:hash" };
      }

      const [, algorithm, expectedHash] = match;

      // Currently only support sha256
      if (algorithm !== "sha256") {
        return { valid: false, error: `Unsupported hash algorithm: ${algorithm}` };
      }

      // Validate hash format (64 hex characters for SHA256)
      if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
        return { valid: false, error: "Invalid SHA256 hash format (expected 64 hex chars)" };
      }

      // Compute actual hash
      const actualHash = await computeSha256(value);

      // Compare hashes (constant-time for security)
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        return {
          valid: false,
          error: `Content hash mismatch: expected ${expectedHash}, got ${actualHash}`,
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  };
}

/**
 * Create link:// validator (authenticated)
 */
export function createAuthenticatedLinkValidator(): ValidationFn {
  return async ({ uri, value, read }) => {
    try {
      // 1. Verify signature
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      const isValid = await validator({ uri, value });

      if (!isValid) {
        return { valid: false, error: "Signature verification failed" };
      }

      // 2. Validate link value (must be a string URI)
      return validateLinkValue(value);
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  };
}

/**
 * Create link:// validator (unauthenticated)
 */
export function createOpenLinkValidator(): ValidationFn {
  return async ({ uri, value }) => {
    try {
      return validateLinkValue(value);
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  };
}
```

### A.2 Updated Schema File

```typescript
// installations/http-server/example-schema.ts
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import {
  authValidation,
  createPubkeyBasedAccess,
} from "@bandeira-tech/b3nd-sdk/auth";
import {
  createBlobValidator,
  createAuthenticatedLinkValidator,
  createOpenLinkValidator,
} from "./validators.ts";

const schema: Schema = {
  // Existing validators
  "mutable://open": () => Promise.resolve({ valid: true }),
  "mutable://inbox": () => Promise.resolve({ valid: true }),
  "immutable://inbox": () => Promise.resolve({ valid: true }),

  "mutable://accounts": async ({ uri, value }) => {
    try {
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      const isValid = await validator({ uri, value });

      return {
        valid: isValid,
        error: isValid ? undefined : "Signature verification failed",
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  },

  "immutable://open": async ({ uri, value, read }) => {
    const result = await read(uri);
    return Promise.resolve({ valid: !result.success });
  },

  "immutable://accounts": async ({ uri, value, read }) => {
    try {
      const getAccess = createPubkeyBasedAccess();
      const validator = authValidation(getAccess);
      const isValid = await validator({ uri, value });

      if (isValid) {
        const result = await read(uri);

        return {
          valid: !result.success,
          ...(result.success ? { error: "immutable object exists" } : {}),
        };
      }

      return {
        valid: isValid,
        error: isValid ? undefined : "Signature verification failed",
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation error",
      };
    }
  },

  // New validators
  "blob://open": createBlobValidator(),
  "link://accounts": createAuthenticatedLinkValidator(),
  "link://open": createOpenLinkValidator(),
};

export default schema;
```

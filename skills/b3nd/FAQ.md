# B3nd FAQ

## Why

### Why does B3nd make no liveness guarantees?

B3nd is a DePIN framework for untrusted networks. Promising delivery, ordering,
or timing requires trusting infrastructure that may not be trustworthy. Instead
of providing guarantees the framework cannot enforce, B3nd is explicit: messages
are fire-and-forget.

Protocols that need delivery guarantees build them as message exchange patterns
on top of the framework. This keeps the framework minimal and honest, while
allowing protocols to define the exact guarantees they can actually provide.

### Why is encryption client-side?

B3nd nodes are untrusted by design. Nodes accept what they receive — they have no
knowledge of whether content is encrypted or plaintext. Privacy is achieved by
encrypting before sending and decrypting after reading. The network never needs
to be trusted with cleartext data.

This means a compromised node leaks nothing sensitive. It also means the same
B3nd node can serve public and private data simultaneously without configuration
changes.

### Why is signing the same gesture at every layer?

Every message — whether from a user, a validator, or a confirmer — is the same
action: signing intent to place outputs at addresses. A user signs intent to
place a profile. A validator signs intent to place a validity link. A confirmer
signs intent to place a confirmation link.

This uniformity means the framework handles all messages identically. The program
schemas determine what signatures are required and who is authorized to write
where. The framework just dispatches.

### Why does the framework not define specific programs?

Programs like `hash://sha256` or `link://accounts` are protocol-level choices.
The B3nd SDK provides tools that make implementing these programs easy
(`hashValidator()`, `computeSha256()`), but which programs a network runs is a
decision made by the protocol built on B3nd.

Different protocols may use different content-addressing algorithms, different
authentication models, or entirely different program architectures. The framework
provides the dispatch mechanism and the toolbox. Protocols assemble the parts.

### Why use envelopes instead of individual messages?

Envelopes group related writes into a single atomic-intent unit. A transfer
that debits one account and credits another should succeed or fail as a whole —
not leave one side written and the other missing.

The envelope is content-addressed (sent to its hash URI), which provides an
audit trail and replay protection. Individual `receive()` calls remain available
for simple single-resource writes where atomicity across multiple URIs is not
needed.

### Why doesn't B3nd guarantee storage?

B3nd validates and dispatches messages. Whether an accepted message is stored,
cached, forwarded, or discarded is a node operator decision — not a framework
guarantee.

This separation is what makes B3nd a universal interface layer. App developers
write against the `receive()`/`read()` interface without coupling to any
specific storage backend. Node operators choose their infrastructure — Postgres,
MongoDB, in-memory, or something custom — without coupling to any specific
application.

A node using MemoryClient and a node using PostgresClient are both valid B3nd
nodes. The framework treats them identically. Storage durability, replication,
and retention are infrastructure concerns that B3nd intentionally leaves to the
people who run the infrastructure.

### What are the record size limits per backend?

The B3nd SDK does not enforce a single global record size limit. Limits depend
on the backend client and, for HTTP transport, the web server framework:

| Backend          | Limiting Factor                       | Practical Limit                |
| ---------------- | ------------------------------------- | ------------------------------ |
| **MemoryClient** | JavaScript heap memory                | No explicit limit; bounded by available process memory. Individual records can be arbitrarily large until the process runs out of heap. |
| **PostgresClient** | PostgreSQL `JSONB` column type      | ~255 MB per value (PostgreSQL JSONB internal limit). The `uri` column is `VARCHAR(2048)`, capping URI length at 2048 characters. Data is stored as `JSONB`, which PostgreSQL compresses via TOAST for values over ~2 KB. |
| **MongoClient**  | MongoDB BSON document size limit      | 16 MB per document (MongoDB hard limit). Each record is one document containing `uri`, `data`, `timestamp`, and metadata fields, so the usable data size is slightly under 16 MB. |
| **HttpClient**   | HTTP request body / framework config  | Depends on the server framework (e.g., Hono, Deno.serve). The SDK's HTTP server (`libs/b3nd-servers/http.ts`) does not configure an explicit body size limit -- it relies on the underlying framework defaults. Deno.serve has no built-in request body limit. Hono does not impose one by default. Reverse proxies (nginx, Cloudflare) may impose their own limits (commonly 1 MB to 100 MB). |

**Recommendations:**

- For JSON data, keep individual records under **1 MB** for reliable
  cross-backend compatibility and reasonable HTTP transfer times.
- For binary data (images, files), use `hash://sha256` content-addressed
  storage and keep blobs under **10 MB**. For larger files, store them
  externally and write a reference URI.
- If you need to store data larger than 16 MB, MemoryClient and PostgresClient
  can handle it, but MongoClient cannot. Design for the smallest common
  denominator if your app may run on multiple backends.

### Is `send()` atomic?

**No. `send()` is not atomic.** Outputs are written sequentially, and a failure
partway through leaves earlier outputs written while later outputs are not.

Here is what happens when you call `send()`:

1. `send()` calls `message()` to build a content-addressed envelope: it
   serializes the `MessageData` (inputs + outputs), computes its SHA-256 hash,
   and produces a `[hash://sha256/{hex}, data]` tuple.

2. `send()` calls `client.receive([hash_uri, envelope])` -- a single write of
   the entire envelope to its hash URI.

3. Inside `receive()`, after storing the envelope itself, the client detects
   that the data matches the `MessageData` shape (via `isMessageData()`). It
   then iterates over `payload.outputs` and calls `this.receive()` **for each
   output individually, in sequence**:

   ```
   for (const [outputUri, outputValue] of data.payload.outputs) {
     const outputResult = await this.receive([outputUri, outputValue]);
     if (!outputResult.accepted) {
       return { accepted: false, error: ... };
     }
   }
   ```

4. If any individual output write fails (validation rejection, database error),
   the loop stops and returns `{ accepted: false }`. **Outputs that were
   already written before the failure remain written.** There is no rollback.

This behavior is identical across all backend clients (MemoryClient,
PostgresClient, MongoClient). None of them wrap the output writes in a
database transaction.

**What this means for developers:**

- **Idempotent writes are safe.** If all your outputs are simple key-value
  upserts (the common case), a partial failure means some data was written
  and some was not. Retrying the entire `send()` will overwrite the
  already-written outputs and write the missing ones, converging to the
  correct state.

- **Non-idempotent operations need caution.** If your schema validators have
  side effects or your outputs depend on ordering (e.g., spend-once semantics
  for `immutable://` URIs), a partial failure can leave inconsistent state.
  Design your validators to handle retries gracefully.

- **The envelope itself is always written first.** The `hash://sha256/{hex}`
  record is stored before any outputs are processed. This means you can
  always verify what was *intended* even if not all outputs were applied.

- **For true atomicity**, you would need a custom client that wraps the
  output loop in a database transaction. The SDK does not provide this
  out of the box because MemoryClient has no transaction concept and the
  framework is designed to be backend-agnostic.

## How

### How do I hide sensitive path segments?

Use deterministic key derivation to obfuscate URI paths. Instead of readable
segments like `/medical/records/blood-test`, derive hex segments from a salt,
the segment name, and a password:

```typescript
async function obfuscatePath(segments: string[], password: string): Promise<string> {
  const parts = await Promise.all(
    segments.map(async (seg) => {
      const key = await deriveKeyFromSeed(
        `${APP_SALT}:${seg}:${password}`, APP_SALT, 100000,
      );
      return key.slice(0, 16);
    }),
  );
  return parts.join("/");
}
```

The owner regenerates paths deterministically. Observers see opaque hex.

### How do I use the canonicalize package in Deno?

The `canonicalize` npm package (RFC 8785 JSON Canonicalization Scheme) requires
a CJS/ESM interop cast in Deno:

```typescript
import _canonicalize from "canonicalize";
const canonicalize = _canonicalize as unknown as (input: unknown) => string | undefined;
```

The root `deno.json` import map includes `"canonicalize": "npm:canonicalize@2.0.0"`.

### How do I run tests without LocalStorageClient failures?

LocalStorageClient requires `window.localStorage`, which is unavailable in Deno
CLI. Exclude it:

```bash
deno test --allow-all libs/ --ignore=libs/b3nd-client-localstorage
```

### How do I run my own B3nd network?

Define a custom schema and start a server:

```typescript
import { createServerNode, MemoryClient, servers } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

const schema: Schema = {
  "mutable://my-company": async ({ uri, value }) => ({ valid: true }),
  "custom://audit": async ({ uri, value, read }) => {
    return { valid: true };
  },
};

const client = new MemoryClient({ schema });
const app = new Hono();
const frontend = servers.httpServer(app);
createServerNode({ frontend, client }).listen(43100);
```

The schema defines your network's programs. Replace `MemoryClient` with
`PostgresClient` or `MongoClient` for persistent storage.

### How do I organize domain concepts in URI paths?

Use protocol-provided programs and organize domain concepts
as paths:

```
mutable://accounts/{key}/nodes/{id}/config    (node config as a path)
mutable://accounts/{key}/posts/{slug}         (blog posts as paths)
mutable://accounts/{key}/settings/theme       (app settings as a path)
```

Each of these uses the same program (`mutable://accounts`) which handles
authentication. The paths provide the domain structure.

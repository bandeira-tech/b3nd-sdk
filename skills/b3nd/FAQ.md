---
name: b3nd-faq
description: Frequently asked questions about B3nd development. Use when developers ask about design rationale, implementation techniques, common patterns, or when troubleshooting B3nd SDK issues.
---

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

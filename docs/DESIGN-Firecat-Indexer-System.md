# B3nd Indexer System -- Technical Design Document

**Date:** 2026-02-21 **Status:** Proposal **Context:** Addresses the #1 gap
identified in the
[Firecat App Exploration PRD](./PRD-Firecat-App-Exploration.md) -- no
server-side querying or aggregation.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Indexer Definition API](#2-indexer-definition-api)
3. [Message Feed / Event Stream](#3-message-feed--event-stream)
4. [Trust & Key Exchange](#4-trust--key-exchange)
5. [Query Interface](#5-query-interface)
6. [View Definitions & Projections](#6-view-definitions--projections)
7. [Consistency & Freshness](#7-consistency--freshness)
8. [Security Model](#8-security-model)
9. [Integration with Existing Compositors](#9-integration-with-existing-compositors)
10. [Concrete Examples](#10-concrete-examples)

---

## 1. Architecture Overview

### How Indexers Fit into the Existing B3nd Node Architecture

B3nd nodes today implement `NodeProtocolInterface` with operations: `receive`,
`read`, `readMulti`, `list`, `delete`, and `status`. All state changes flow
through `receive(msgs)`, where each msg is a `[uri, values, data]` tuple. Nodes validate
messages against a schema, then persist them to one or more backends (Memory,
Postgres, MongoDB, HTTP) via compositors like `parallelBroadcast` and
`firstMatchSequence`.

An **Indexer** is a separate process that:

1. **Observes** the stream of accepted messages flowing through a node.
2. **Transforms** message data into derived views (search indexes, counters,
   aggregations, filtered lists).
3. **Serves** queries against those derived views through an extended API.

Indexers do not modify or intercept the core write path. They are **read-side
projections** -- materialized views built from the event stream of accepted
messages.

### Relationship Between Nodes, Indexers, and App Clients

```
            +-----------------+
            |   App Client    |
            |  (Browser/CLI)  |
            +--------+--------+
                     |
       +-------------+-------------+
       |                           |
write / read               query (indexed)
       |                           |
+------+------+            +-------+-------+
|  B3nd Node  |---feed---->|    Indexer     |
| (validated  |            | (projections,  |
|  storage)   |            |  search, agg)  |
+------+------+            +-------+-------+
       |                           |
+------+------+            +-------+-------+
|   Backend   |            |  Index Store  |
| (Postgres,  |            | (Postgres FTS,|
|  Memory...) |            |  ES, SQLite,  |
+-------------+            |  Redis, etc.) |
                           +---------------+
```

The app client uses the standard `NodeProtocolInterface` for writes and basic
reads. For queries that go beyond URI-prefix listing, it calls the Indexer's
query API. The Indexer receives a feed of accepted messages from the node and
builds projections in technology-appropriate stores.

### Deployment Topology

Indexers support three deployment modes:

**Sidecar (same process).** The indexer runs as a processor in the node's
`receive` pipeline. Wired into `parallelBroadcast` alongside the storage
backend. The node process owns both the storage and the index.

**Sidecar (separate process, same machine).** The indexer runs as a standalone
process on the same host. The node pushes accepted messages to the indexer via a
local socket, HTTP POST, or shared message queue. The indexer has its own
process, memory, and failure domain.

**Remote service.** The indexer runs on a different machine, receiving messages
via HTTP webhook or a pull-based polling loop. Most decoupled model, suitable
for third-party indexer operators and for scaling indexer compute independently
of node compute.

All three modes use the same `IndexerDefinition` API. The deployment topology is
a wiring concern, not an API concern.

---

## 2. Indexer Definition API

### The Indexer "Program"

An indexer is defined by a **view definition** -- a set of functions that map
incoming messages to operations on a derived view. The core abstraction:

```typescript
// libs/b3nd-indexer/types.ts

import type { Message, ReadResult } from "../b3nd-core/types.ts";
import type { EncryptedPayload } from "../b3nd-encrypt/mod.ts";

/**
 * A cursor representing the indexer's position in the message stream.
 * Opaque to the indexer logic; managed by the runtime.
 */
export interface IndexerCursor {
  /** Monotonic sequence number or timestamp */
  position: number;
  /** Optional: hash of the last processed message for integrity */
  lastMessageHash?: string;
}

/**
 * Context provided to indexer map functions.
 */
export interface IndexerContext {
  /** Read current state from the source node */
  read: <T = unknown>(uri: string) => Promise<ReadResult<T>>;
  /** Decrypt an encrypted payload using the configured view key */
  decrypt?: (payload: EncryptedPayload) => Promise<unknown>;
  /** The URI of the message being processed */
  uri: string;
  /** Timestamp when the message was accepted by the node */
  timestamp: number;
}

/**
 * An operation to apply to the index store.
 */
export type IndexOperation =
  | { type: "put"; key: string; value: unknown }
  | { type: "delete"; key: string }
  | { type: "increment"; key: string; field: string; amount: number }
  | { type: "append"; key: string; value: unknown }
  | {
    type: "fts_upsert";
    key: string;
    text: string;
    metadata?: Record<string, unknown>;
  }
  | { type: "fts_delete"; key: string }
  | { type: "sql"; statement: string; params: unknown[] };

/**
 * The core indexer definition.
 */
export interface IndexerDefinition<D = unknown> {
  name: string;
  version: number;
  /** Fast URI-based filter. Return false to skip the message entirely. */
  filter: (uri: string) => boolean;
  /** Map a message + context to index operations */
  map: (msg: Message<D>, ctx: IndexerContext) => Promise<IndexOperation[]>;
  /** One-time setup (create tables, indexes, etc.) */
  setup?: (backend: IndexerBackend) => Promise<void>;
  /** Teardown (drop tables, etc.) */
  teardown?: (backend: IndexerBackend) => Promise<void>;
}

/**
 * The backend interface that indexer operations are dispatched to.
 */
export interface IndexerBackend {
  apply(ops: IndexOperation[]): Promise<void>;
  query<T = unknown>(query: IndexQuery): Promise<IndexQueryResult<T>>;
  /** Execute raw backend-specific query (escape hatch) */
  raw<T = unknown>(statement: string, params?: unknown[]): Promise<T[]>;
  setup?(): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * A query against an indexer's derived views.
 */
export interface IndexQuery {
  /** The view/collection/table to query */
  view: string;
  /** Filter conditions */
  filter?: Record<string, unknown>;
  /** Full-text search query */
  search?: string;
  /** Fields to return */
  select?: string[];
  /** Sort specification */
  sort?: { field: string; order: "asc" | "desc" }[];
  /** Pagination */
  limit?: number;
  offset?: number;
  /** Aggregation pipeline (optional) */
  aggregate?: AggregationStage[];
}

export type AggregationStage =
  | { $match: Record<string, unknown> }
  | {
    $group: {
      _id: string | null;
      [field: string]: AggregationOp | string | null;
    };
  }
  | { $sort: Record<string, 1 | -1> }
  | { $limit: number }
  | { $project: Record<string, 0 | 1 | string> };

export type AggregationOp =
  | { $sum: string | number }
  | { $avg: string }
  | { $min: string }
  | { $max: string }
  | { $count: Record<string, never> };

export interface IndexQueryResult<T = unknown> {
  data: T[];
  total?: number;
  cursor?: IndexerCursor;
}
```

### Example: Counter Indexer (recipes by tag)

```typescript
export const recipeTagCounter: IndexerDefinition<RecipeData> = {
  name: "recipe-tag-counter",
  version: 1,

  filter: (uri) =>
    uri.startsWith("mutable://accounts/") && uri.includes("/recipes/"),

  async setup(backend) {
    await backend.raw(`
      CREATE TABLE IF NOT EXISTS recipe_tag_counts (
        tag TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      )
    `);
  },

  async map(msg, ctx) {
    const [uri, , data] = msg;
    let content = data as RecipeData;
    if (ctx.decrypt && isEncryptedPayload(data)) {
      content = await ctx.decrypt(data as any) as RecipeData;
    }

    const ops: IndexOperation[] = [];
    if (content.tags) {
      for (const tag of content.tags) {
        ops.push({
          type: "increment",
          key: `tag:${tag}`,
          field: "count",
          amount: 1,
        });
      }
    }
    return ops;
  },
};
```

### Example: Full-Text Search Indexer (recipes)

```typescript
export const recipeSearch: IndexerDefinition = {
  name: "recipe-search",
  version: 1,

  filter: (uri) => uri.includes("/recipes/"),

  async setup(backend) {
    await backend.raw(`
      CREATE TABLE IF NOT EXISTS recipe_search (
        uri TEXT PRIMARY KEY,
        title TEXT,
        description TEXT,
        tags TEXT[],
        author TEXT,
        created_at BIGINT,
        search_vector TSVECTOR
      );
      CREATE INDEX IF NOT EXISTS recipe_search_fts
        ON recipe_search USING gin(search_vector);
    `);
  },

  async map(msg, ctx) {
    const [uri, , data] = msg;
    let content = data as any;
    if (ctx.decrypt && content?.data && content?.nonce) {
      content = await ctx.decrypt(content);
    }

    return [{
      type: "sql",
      statement: `
        INSERT INTO recipe_search (uri, title, description, tags, author, created_at, search_vector)
        VALUES ($1, $2, $3, $4, $5, $6, to_tsvector('english', $2 || ' ' || $3))
        ON CONFLICT (uri) DO UPDATE SET
          title = EXCLUDED.title, description = EXCLUDED.description,
          tags = EXCLUDED.tags, search_vector = EXCLUDED.search_vector
      `,
      params: [
        uri,
        content.title || "",
        content.description || "",
        content.tags || [],
        ctx.uri.split("/")[3],
        ctx.timestamp,
      ],
    }];
  },
};
```

### Example: Revenue Aggregation Indexer (invoicing)

```typescript
export const revenueAggregation: IndexerDefinition = {
  name: "revenue-aggregation",
  version: 1,

  filter: (uri) => uri.includes("/invoices/") && !uri.endsWith("/draft"),

  async setup(backend) {
    await backend.raw(`
      CREATE TABLE IF NOT EXISTS invoice_index (
        uri TEXT PRIMARY KEY,
        amount NUMERIC NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL,
        client_name TEXT,
        issued_at BIGINT,
        due_at BIGINT,
        paid_at BIGINT
      );
      CREATE INDEX IF NOT EXISTS idx_invoice_status ON invoice_index(status);
      CREATE INDEX IF NOT EXISTS idx_invoice_issued ON invoice_index(issued_at);
    `);
  },

  async map(msg, ctx) {
    const [uri, , data] = msg;
    let invoice = data as any;
    if (ctx.decrypt && invoice?.data && invoice?.nonce) {
      invoice = await ctx.decrypt(invoice);
    }

    return [{
      type: "sql",
      statement: `
        INSERT INTO invoice_index (uri, amount, currency, status, client_name, issued_at, due_at, paid_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (uri) DO UPDATE SET
          amount = EXCLUDED.amount, status = EXCLUDED.status,
          client_name = EXCLUDED.client_name, paid_at = EXCLUDED.paid_at
      `,
      params: [
        uri,
        invoice.amount,
        invoice.currency || "USD",
        invoice.status,
        invoice.clientName,
        invoice.issuedAt,
        invoice.dueAt,
        invoice.paidAt,
      ],
    }];
  },
};
```

---

## 3. Message Feed / Event Stream

### (a) In-Process Hook (Sidecar Mode)

The indexer is wired as a processor in the node's pipeline using the existing
`emit` processor:

```typescript
import { createIndexerProcessor } from "@bandeira-tech/b3nd-indexer";
import { recipeSearch } from "./indexers/recipe-search.ts";

const indexerProcessor = createIndexerProcessor({
  indexers: [recipeSearch],
  backend: postgresIndexerBackend,
});

// Wrap the client to also feed the indexer on receive
const indexedClient = createIndexedClient(client, indexerProcessor);
```

The processor implementation:

```typescript
// libs/b3nd-indexer/processor.ts

export interface IndexerProcessorConfig {
  indexers: IndexerDefinition[];
  backend: IndexerBackend;
  read?: <T>(uri: string) => Promise<any>;
  decrypt?: (payload: any) => Promise<unknown>;
  /** If true, index synchronously (blocks the write). Default: false. */
  synchronous?: boolean;
}

export function createIndexerProcessor(
  config: IndexerProcessorConfig,
): Processor {
  const { indexers, backend, read, decrypt, synchronous } = config;

  return async (msg: Message) => {
    const [uri, , data] = msg;
    const timestamp = Date.now();

    const work = async () => {
      for (const indexer of indexers) {
        if (!indexer.filter(uri)) continue;

        const ctx: IndexerContext = {
          read: read ||
            (async () => ({ success: false, error: "no read handle" })),
          decrypt,
          uri,
          timestamp,
        };

        try {
          const ops = await indexer.map(msg, ctx);
          if (ops.length > 0) {
            await backend.apply(ops);
          }
        } catch (err) {
          console.error(
            `[indexer:${indexer.name}] Error processing ${uri}:`,
            err,
          );
          // Indexer errors are non-fatal -- they don't reject the message
        }
      }
    };

    if (synchronous) {
      await work();
    } else {
      // Fire-and-forget: don't block the write path
      work().catch((err) =>
        console.error("[indexer] Unhandled error in async indexing:", err)
      );
    }

    return { success: true };
  };
}
```

### (b) Webhook / Push Feed (Separate Process)

The node pushes accepted messages to the indexer via HTTP POST:

```typescript
import { emit } from "@bandeira-tech/b3nd-sdk";

const pushToIndexer = emit(async (msg) => {
  const [uri, , data] = msg;
  await fetch("http://localhost:9950/api/v1/feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uri, data, timestamp: Date.now() }),
  });
});
```

### (c) Pull Feed (Polling)

The indexer polls the node for new messages since its last cursor:

```
GET /api/v1/feed?since={cursor}&limit=100
```

### Backfill (Indexing Historical Data)

When an indexer starts for the first time (or after a schema version change), it
needs to process all existing data:

```typescript
// libs/b3nd-indexer/backfill.ts

export interface BackfillConfig {
  source: NodeProtocolInterface;
  indexer: IndexerDefinition;
  backend: IndexerBackend;
  prefixes: string[];
  decrypt?: (payload: any) => Promise<unknown>;
  batchSize?: number;
  onProgress?: (processed: number, total: number) => void;
}

export async function backfill(
  config: BackfillConfig,
): Promise<{ processed: number }> {
  const { source, indexer, backend, prefixes, decrypt, batchSize = 50 } =
    config;
  let processed = 0;

  for (const prefix of prefixes) {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const listResult = await source.list(prefix, { page, limit: batchSize });
      if (!listResult.success || listResult.data.length === 0) {
        hasMore = false;
        continue;
      }

      const uris = listResult.data.map((item) => item.uri);
      const readResult = await source.readMulti(uris);

      for (const item of readResult.results) {
        if (!item.success) continue;
        const uri = item.uri;
        if (!indexer.filter(uri)) continue;

        const ctx: IndexerContext = {
          read: source.read.bind(source),
          decrypt,
          uri,
          timestamp: item.record.values?.ts ?? Date.now(),
        };

        const ops = await indexer.map([uri, item.record.values ?? {}, item.record.data], ctx);
        if (ops.length > 0) {
          await backend.apply(ops);
        }
        processed++;
      }

      if (config.onProgress && listResult.pagination?.total) {
        config.onProgress(processed, listResult.pagination.total);
      }

      page++;
      hasMore = listResult.data.length === batchSize;
    }
  }

  return { processed };
}
```

### Cursor / Checkpoint Management

```typescript
export interface CursorStore {
  get(indexerName: string): Promise<IndexerCursor | null>;
  set(indexerName: string, cursor: IndexerCursor): Promise<void>;
}

// Simple implementation using the B3nd node itself as the cursor store
export function createNodeCursorStore(
  client: NodeProtocolInterface,
): CursorStore {
  return {
    async get(indexerName: string) {
      const result = await client.read<IndexerCursor>(
        `mutable://open/_indexer/cursors/${indexerName}`,
      );
      return result.success ? result.record!.data : null;
    },
    async set(indexerName: string, cursor: IndexerCursor) {
      await client.receive([
        `mutable://open/_indexer/cursors/${indexerName}`,
        cursor,
      ]);
    },
  };
}
```

---

## 4. Trust & Key Exchange

### The Problem

B3nd data can be encrypted client-side. An indexer cannot build useful views
from ciphertext. It needs plaintext. But giving the indexer the user's master
encryption key would give it full access to everything. We need a **scoped
delegation mechanism**.

### View Keys

A **view key** is a symmetric AES-256 key derived specifically for use by
indexers. It is scoped to a URI prefix and purpose. The user derives the view
key and shares it with a trusted indexer operator.

```typescript
import { deriveKeyFromSeed } from "@bandeira-tech/b3nd-sdk/encrypt";

/**
 * Derive a view key for an indexer.
 *
 * Deterministic: same inputs always produce the same key.
 * The user can re-derive it without storing it.
 *
 * @param masterSecret - The user's master encryption secret (or password)
 * @param indexerPubkey - The indexer operator's public key (binds the key to the indexer)
 * @param uriPrefix - The URI prefix this key is scoped to
 * @param purpose - Human-readable purpose label ("search", "analytics", etc.)
 */
export async function deriveViewKey(params: {
  masterSecret: string;
  indexerPubkey: string;
  uriPrefix: string;
  purpose: string;
}): Promise<string> {
  const seed = [
    "b3nd-view-key-v1",
    params.indexerPubkey,
    params.uriPrefix,
    params.purpose,
    params.masterSecret,
  ].join(":");

  return await deriveKeyFromSeed(seed, "b3nd-view-key-salt", 100000);
}
```

### How the User Delegates

1. The app developer or user generates a view key scoped to the data they want
   indexed.
2. They encrypt the view key to the indexer operator's X25519 public key.
3. They write this encrypted delegation to a well-known URI:

```typescript
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

// 1. Derive the view key
const viewKey = await deriveViewKey({
  masterSecret: userPassword,
  indexerPubkey: indexerOperatorPubkey,
  uriPrefix: `mutable://accounts/${userPubkey}/my-app/recipes/`,
  purpose: "recipe-search",
});

// 2. Encrypt the delegation to the indexer operator
const delegation = await encrypt.encrypt(
  {
    viewKeyHex: viewKey,
    uriPrefix: `mutable://accounts/${userPubkey}/my-app/recipes/`,
    grantedAt: Date.now(),
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
    permissions: ["search", "aggregate"],
  },
  indexerOperatorEncryptionPubkey,
);

// 3. Write the delegation to the user's account
const signed = await encrypt.createAuthenticatedMessageWithHex(
  delegation,
  userPubkey,
  userPrivkey,
);
await client.receive([
  `mutable://accounts/${userPubkey}/_indexer/delegations/${indexerOperatorPubkey}`,
  signed,
]);
```

### Encryption Flow for Indexed Data

The app uses the **view key as the encryption key** for data that is intended to
be indexed. Both the user and the indexer derive the same symmetric key:

```typescript
// App side: encrypt with view key
const viewKey = SecretEncryptionKey.fromHex(viewKeyHex);
const encrypted = await viewKey.encrypt(recipeData);
await client.receive([recipeUri, encrypted]);

// Indexer side: decrypt with same view key (received via delegation)
const decrypted = await viewKey.decrypt(encrypted);
```

### Scoping View Keys

- **URI prefix scope**: The `uriPrefix` parameter binds the key to a specific
  path.
- **Field-level scope**: The app can encrypt different fields with different
  view keys. The indexer only receives the view key for the fields it needs.
- **Time scope**: The delegation includes `expiresAt`. The indexer must
  re-request delegation after expiry.

### Compromised Indexer

If an indexer operator is compromised:

1. **Blast radius**: The attacker gains access to plaintext of data encrypted
   with view keys delegated to that indexer. They cannot access data encrypted
   with the user's master key or data from other URI prefixes.
2. **Revocation**: The user deletes the delegation record and stops encrypting
   new data with the compromised view key.
3. **Rotation**: The user derives a new view key with a different
   `indexerPubkey`, re-encrypts their data, and writes new delegations.

### Key Rotation

```typescript
async function rotateViewKey(params: {
  client: NodeProtocolInterface;
  oldViewKeyHex: string;
  newViewKeyHex: string;
  uriPrefix: string;
}) {
  const oldKey = SecretEncryptionKey.fromHex(params.oldViewKeyHex);
  const newKey = SecretEncryptionKey.fromHex(params.newViewKeyHex);

  const list = await params.client.list(params.uriPrefix);
  if (!list.success) return;

  for (const item of list.data) {
    const read = await params.client.read(item.uri);
    if (!read.success || !read.record) continue;

    // Decrypt with old key, re-encrypt with new key
    const plaintext = await oldKey.decrypt(read.record.data as any);
    const reEncrypted = await newKey.encrypt(plaintext);
    await params.client.receive([item.uri, reEncrypted]);
  }
}
```

---

## 5. Query Interface

### IndexerClient

The `IndexerClient` implements a superset of `NodeProtocolInterface`, adding
query and aggregation methods:

```typescript
// libs/b3nd-indexer/client.ts

export interface IndexerClientInterface extends NodeProtocolInterface {
  /**
   * Query an indexed view with filters, search, and pagination.
   */
  query<T = unknown>(query: IndexQuery): Promise<IndexQueryResult<T>>;

  /**
   * Run an aggregation pipeline on an indexed view.
   */
  aggregate<T = unknown>(
    view: string,
    pipeline: AggregationStage[],
  ): Promise<AggregationResult<T>>;

  /**
   * Full-text search across indexed content.
   */
  search<T = unknown>(params: {
    view: string;
    query: string;
    limit?: number;
    offset?: number;
    filter?: Record<string, unknown>;
  }): Promise<IndexQueryResult<T>>;

  /**
   * Get the freshness status of the indexer.
   */
  indexerHealth(): Promise<{
    status: "current" | "behind" | "stale" | "error";
    lastProcessedPosition: number;
    lastProcessedTimestamp: number;
    lag: number;
    indexerName: string;
    viewVersion: number;
  }>;
}
```

### HTTP IndexerClient

```typescript
export class HttpIndexerClient implements IndexerClientInterface {
  private nodeClient: NodeProtocolInterface;
  private indexerUrl: string;

  constructor(config: {
    nodeClient: NodeProtocolInterface;
    indexerUrl: string;
  }) {
    this.nodeClient = config.nodeClient;
    this.indexerUrl = config.indexerUrl.replace(/\/$/, "");
  }

  // Standard CRUD: proxy to node
  receive<D>(msg: Message<D>) {
    return this.nodeClient.receive(msg);
  }
  read<T>(uri: string) {
    return this.nodeClient.read<T>(uri);
  }
  readMulti<T>(uris: string[]) {
    return this.nodeClient.readMulti<T>(uris);
  }
  list(uri: string, opts?: ListOptions) {
    return this.nodeClient.list(uri, opts);
  }
  delete(uri: string) {
    return this.nodeClient.delete(uri);
  }
  status() {
    return this.nodeClient.status();
  }
  cleanup() {
    return this.nodeClient.cleanup();
  }

  // Indexer-specific operations
  async query<T>(query: IndexQuery): Promise<IndexQueryResult<T>> {
    const res = await fetch(`${this.indexerUrl}/api/v1/indexer/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
    return res.json();
  }

  async aggregate<T>(
    view: string,
    pipeline: AggregationStage[],
  ): Promise<AggregationResult<T>> {
    const res = await fetch(`${this.indexerUrl}/api/v1/indexer/aggregate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view, pipeline }),
    });
    return res.json();
  }

  async search<T>(params: {
    view: string;
    query: string;
    limit?: number;
    offset?: number;
    filter?: Record<string, unknown>;
  }): Promise<IndexQueryResult<T>> {
    const res = await fetch(`${this.indexerUrl}/api/v1/indexer/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async indexerHealth() {
    const res = await fetch(`${this.indexerUrl}/api/v1/indexer/health`);
    return res.json();
  }
}
```

### React Hooks

```typescript
// hooks/useIndexer.ts

/**
 * Query an indexed view with filters, search, and pagination.
 */
export function useIndexedQuery<T = unknown>(
  client: IndexerClientInterface,
  query: IndexQuery,
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  return useQuery<IndexQueryResult<T>>({
    queryKey: ["indexer-query", query.view, query],
    queryFn: () => client.query<T>(query),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Full-text search hook.
 */
export function useIndexedSearch<T = unknown>(
  client: IndexerClientInterface,
  params: {
    view: string;
    query: string;
    limit?: number;
    filter?: Record<string, unknown>;
  },
  options?: { enabled?: boolean },
) {
  return useQuery<IndexQueryResult<T>>({
    queryKey: ["indexer-search", params.view, params.query, params.filter],
    queryFn: () => client.search<T>(params),
    enabled: (options?.enabled ?? true) && params.query.length > 0,
  });
}

/**
 * Aggregation hook for dashboards and analytics.
 */
export function useAggregation<T = unknown>(
  client: IndexerClientInterface,
  view: string,
  pipeline: AggregationStage[],
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  return useQuery<AggregationResult<T>>({
    queryKey: ["indexer-aggregate", view, pipeline],
    queryFn: () => client.aggregate<T>(view, pipeline),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Hook to check indexer freshness.
 */
export function useIndexerHealth(client: IndexerClientInterface) {
  return useQuery({
    queryKey: ["indexer-health"],
    queryFn: () => client.indexerHealth(),
    refetchInterval: 30_000,
  });
}
```

### Indexer Service HTTP Endpoints

| Method | Path                        | Description                              |
| ------ | --------------------------- | ---------------------------------------- |
| POST   | `/api/v1/indexer/query`     | Query a view with filters/pagination     |
| POST   | `/api/v1/indexer/search`    | Full-text search                         |
| POST   | `/api/v1/indexer/aggregate` | Run aggregation pipeline                 |
| GET    | `/api/v1/indexer/health`    | Indexer freshness status                 |
| POST   | `/api/v1/indexer/feed`      | Receive message from node (webhook mode) |
| GET    | `/api/v1/indexer/views`     | List available views                     |

---

## 6. View Definitions & Projections

### What is a "View"?

A view is a named, typed projection of B3nd data optimized for a specific query
pattern. Views are defined by `IndexerDefinition` objects and materialized by
the indexer runtime into the chosen backend.

Views are analogous to materialized views in a database, or to projections in
event sourcing. They are derived data -- always rebuildable from the source
messages.

### Projection Types

| Type                 | IndexOperation              | Use Case                                                  |
| -------------------- | --------------------------- | --------------------------------------------------------- |
| **Table**            | `sql`                       | Relational queries, joins, aggregations, full-text search |
| **Key-Value**        | `put` / `delete`            | Fast lookups by key                                       |
| **Counter**          | `increment`                 | Aggregation counters                                      |
| **Full-Text Search** | `fts_upsert` / `fts_delete` | Search indexes                                            |

### Schema Evolution

When an indexer definition's `version` changes, the runtime:

1. Detects the version mismatch between the stored cursor metadata and the new
   definition.
2. Calls `teardown` on the old version (drops tables/indexes).
3. Calls `setup` on the new version (creates new tables/indexes).
4. Runs a full backfill with the new `map` function.
5. Resumes live indexing.

```typescript
// libs/b3nd-indexer/runtime.ts

export async function initializeIndexer(
  config: IndexerRuntimeConfig,
): Promise<void> {
  const { definition, backend, cursorStore, source } = config;
  const existingCursor = await cursorStore.get(definition.name);

  if (
    !existingCursor || (existingCursor as any).version !== definition.version
  ) {
    console.log(
      `[indexer:${definition.name}] Initializing v${definition.version}...`,
    );

    if (existingCursor && definition.teardown) {
      await definition.teardown(backend);
    }

    if (definition.setup) {
      await definition.setup(backend);
    }

    // Backfill from source, then set cursor
    await cursorStore.set(definition.name, {
      position: Date.now(),
      ...(({ version: definition.version }) as any),
    });
  }
}
```

### Example: Join View (social feed -- posts by followed users)

Two indexers compose to enable a join:

```typescript
// Indexer 1: Follow graph
export const followGraph: IndexerDefinition = {
  name: "follow-graph",
  version: 1,
  filter: (uri) => uri.includes("/social/following/"),
  async setup(backend) {
    await backend.raw(`
      CREATE TABLE IF NOT EXISTS follows (
        follower TEXT NOT NULL,
        followed TEXT NOT NULL,
        PRIMARY KEY (follower, followed)
      );
      CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower);
    `);
  },
  async map(msg, ctx) {
    const [uri] = msg;
    const parts = uri.split("/");
    const follower = parts[3];
    const followed = parts[parts.length - 1];
    return [{
      type: "sql",
      statement:
        "INSERT INTO follows (follower, followed) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      params: [follower, followed],
    }];
  },
};

// Indexer 2: Post index
export const postIndex: IndexerDefinition = {
  name: "post-index",
  version: 1,
  filter: (uri) => uri.includes("/posts/"),
  async setup(backend) {
    await backend.raw(`
      CREATE TABLE IF NOT EXISTS posts (
        uri TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        title TEXT,
        body TEXT,
        created_at BIGINT,
        search_vector TSVECTOR
      );
      CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    `);
  },
  async map(msg, ctx) {
    const [uri, , data] = msg;
    let content = data as any;
    if (content?.auth && content?.payload) content = content.payload;
    const author = uri.split("/")[3];
    return [{
      type: "sql",
      statement:
        `INSERT INTO posts (uri, author, title, body, created_at, search_vector)
                  VALUES ($1, $2, $3, $4, $5, to_tsvector('english', COALESCE($3,'') || ' ' || COALESCE($4,'')))
                  ON CONFLICT (uri) DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body`,
      params: [
        uri,
        author,
        content.title || "",
        content.body || "",
        ctx.timestamp,
      ],
    }];
  },
};

// Query: "feed for user X" is a join:
// SELECT p.* FROM posts p
// JOIN follows f ON p.author = f.followed
// WHERE f.follower = $1
// ORDER BY p.created_at DESC LIMIT $2
```

---

## 7. Consistency & Freshness

### Consistency Model

Indexers provide **eventual consistency**. Lag depends on the feed mechanism:

| Feed Mode          | Typical Lag         | Guaranteed             |
| ------------------ | ------------------- | ---------------------- |
| In-process (sync)  | < 1ms               | Same-transaction       |
| In-process (async) | < 10ms              | Within event loop turn |
| Webhook push       | 50-500ms            | Delivery + processing  |
| Pull polling       | Up to poll interval | At-least-once          |

### Freshness Reporting

Every `IndexerClient` exposes `indexerHealth()` which returns the indexer's lag.
The app can use this to display a freshness indicator:

```typescript
function FreshnessIndicator({ client }: { client: IndexerClientInterface }) {
  const { data } = useIndexerHealth(client);
  if (!data) return null;

  const label = data.lag < 1000
    ? "Live"
    : data.lag < 10000
    ? "Updating..."
    : "Stale";

  return <span className="text-sm text-gray-500">{label}</span>;
}
```

### Ordering Guarantees

Messages are processed in the order they were accepted by the node. The indexer
maintains a monotonic cursor and does not skip messages. If the indexer crashes
mid-batch, it resumes from the last committed cursor position. Index operations
must be idempotent (the `ON CONFLICT DO UPDATE` pattern ensures this).

---

## 8. Security Model

### What a Compromised Indexer Can Leak

1. **Plaintext of view-key-encrypted data** -- any data the indexer has been
   delegated a view key for.
2. **Query patterns** -- which queries the app makes, leaking user behavior.
3. **URI metadata** -- URIs, timestamps, and data sizes are visible even without
   view keys.

### What a Compromised Indexer CANNOT Leak

1. Data encrypted with keys not delegated to it.
2. Private keys or signing keys -- never shared with the indexer.
3. The user's password or master secret -- view key derivation is
   computationally irreversible.

### Verifying Indexer Results (Spot-Check)

The app can randomly verify indexer results against source data:

```typescript
async function verifyIndexerResult(
  nodeClient: NodeProtocolInterface,
  indexerResult: { uri: string; [key: string]: unknown },
  decrypt: (payload: any) => Promise<unknown>,
): Promise<{ verified: boolean; discrepancies: string[] }> {
  const sourceRead = await nodeClient.read(indexerResult.uri);
  if (!sourceRead.success) {
    return { verified: false, discrepancies: ["source_not_found"] };
  }

  let sourceData = sourceRead.record!.data as any;
  if (sourceData?.data && sourceData?.nonce) {
    sourceData = await decrypt(sourceData);
  }
  if (sourceData?.auth && sourceData?.payload) {
    sourceData = sourceData.payload;
  }

  const discrepancies: string[] = [];
  for (const [key, value] of Object.entries(indexerResult)) {
    if (key === "uri") continue;
    if (JSON.stringify(sourceData[key]) !== JSON.stringify(value)) {
      discrepancies.push(key);
    }
  }

  return { verified: discrepancies.length === 0, discrepancies };
}
```

### Attestation

The indexer can sign query results with its operator key for non-repudiation:

```typescript
const response = {
  data: queryResults,
  cursor: currentCursor,
  timestamp: Date.now(),
};
const signature = await indexerIdentity.sign(response);
return { ...response, attestation: { pubkey: indexerPubkey, signature } };
```

---

## 9. Integration with Existing Compositors

### Composing with FunctionalClient

The `IndexerClient` implements `NodeProtocolInterface`, so it drops in anywhere:

```typescript
const nodeClient = new HttpClient({
  url: "https://testnet-evergreen.fire.cat",
});
const indexerClient = new HttpIndexerClient({
  nodeClient,
  indexerUrl: "https://indexer.my-app.com",
});

// Use anywhere you'd use a standard client
await indexerClient.receive([["mutable://open/test", {}, { hello: "world" }]]);

// Plus: indexed queries
const recipes = await indexerClient.search({
  view: "recipe-search",
  query: "pasta carbonara",
  limit: 10,
});
```

### Using with parallelBroadcast and firstMatchSequence

```typescript
// Write to both primary and backup, with indexing
const writeClient = parallelBroadcast([primaryClient, backupClient]);

// Read from indexer first (for enhanced queries), fall back to primary node
const readClient = firstMatchSequence([indexerClient, primaryClient]);

const client = createValidatedClient({
  write: writeClient,
  read: readClient,
  validate: msgSchema(schema),
});
```

### Smart Routing (Transparent Query Upgrade)

A `FunctionalClient` can transparently route list operations to the indexer when
filter parameters are provided:

```typescript
const smartClient = new FunctionalClient({
  receive: (msg) => nodeClient.receive(msg),
  read: (uri) => nodeClient.read(uri),
  readMulti: (uris) => nodeClient.readMulti(uris),
  list: async (uri, options) => {
    if (
      (options as IndexedListOptions)?.search ||
      (options as IndexedListOptions)?.where
    ) {
      const result = await indexerClient.query({
        view: inferViewFromUri(uri),
        search: (options as IndexedListOptions).search,
        filter: (options as IndexedListOptions).where,
        limit: options?.limit,
        offset: options?.page ? (options.page - 1) * (options.limit || 50) : 0,
      });
      return {
        success: true,
        data: result.data.map((item: any) => ({ uri: item.uri })),
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 50,
          total: result.total,
        },
      };
    }
    return nodeClient.list(uri, options);
  },
  delete: (uri) => nodeClient.delete(uri),
  status: () => nodeClient.status(),
  cleanup: () => nodeClient.cleanup(),
});
```

### HTTP Server Integration

Mount indexer routes alongside standard B3nd routes:

```typescript
import { Hono } from "hono";
import { createServerNode, servers } from "@bandeira-tech/b3nd-sdk";
import { mountIndexerRoutes } from "@bandeira-tech/b3nd-indexer/server";

const app = new Hono();
const frontend = servers.httpServer(app);
createServerNode({ frontend, client });

// Mount indexer routes on the same server
mountIndexerRoutes(app, {
  indexers: [recipeSearch, revenueAggregation],
  backend: postgresIndexerBackend,
});

// Same server handles both:
// POST /api/v1/receive          -- standard B3nd write
// GET  /api/v1/read/...         -- standard B3nd read
// POST /api/v1/indexer/query    -- indexed query
// POST /api/v1/indexer/search   -- full-text search
```

---

## 10. Concrete Examples

### Example 1: Recipe App -- Tag Index and Full-Text Search

```typescript
// App setup
const nodeClient = new HttpClient({
  url: "https://testnet-evergreen.fire.cat",
});
const client = new HttpIndexerClient({
  nodeClient,
  indexerUrl: "https://recipe-indexer.my-app.com",
});

// Search for pasta recipes
const results = await client.search({
  view: "recipes",
  query: "pasta carbonara",
  limit: 20,
  filter: { tags: { $contains: "italian" } },
});

// React component
function RecipeSearch() {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  const { data, isLoading } = useIndexedSearch(client, {
    view: "recipes",
    query,
    limit: 20,
    filter: tag ? { tags: { $contains: tag } } : undefined,
  });

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search recipes..."
      />
      <div className="flex gap-2 mt-2">
        {["italian", "vegan", "quick"].map((t) => (
          <button
            key={t}
            onClick={() => setTag(tag === t ? null : t)}
            className={tag === t ? "bg-blue-600 text-white" : "bg-gray-200"}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-4">
        {data?.data.map((recipe: any) => (
          <div key={recipe.uri} className="border p-4 rounded">
            <h3 className="font-bold">{recipe.title}</h3>
            <p className="text-gray-600">{recipe.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Example 2: Invoicing App -- Revenue Dashboard

```typescript
function RevenueDashboard({ userPubkey }: { userPubkey: string }) {
  const now = Date.now();
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  ).getTime();

  const { data: monthlyRevenue } = useAggregation(client, "invoices", [
    {
      $match: {
        owner: userPubkey,
        status: "paid",
        paid_at: { $gte: monthStart },
      },
    },
    { $group: { _id: null, total: { $sum: "amount" }, count: { $count: {} } } },
  ]);

  const { data: overdue } = useIndexedQuery(client, {
    view: "invoices",
    filter: { owner: userPubkey, status: "sent", due_at: { $lt: now } },
    sort: [{ field: "due_at", order: "asc" }],
    limit: 50,
  });

  return (
    <div className="grid grid-cols-2 gap-4">
      <DashboardCard
        title="This Month"
        value={`$${monthlyRevenue?.data?.[0]?.total?.toFixed(2) || "0.00"}`}
        subtitle={`${monthlyRevenue?.data?.[0]?.count || 0} invoices paid`}
      />
      <DashboardCard
        title="Overdue"
        value={`${overdue?.data?.length || 0}`}
        subtitle="invoices past due"
      />
    </div>
  );
}
```

### Example 3: Journal App -- Local Encrypted Full-Text Search

The journal runs a **local indexer** in the browser. No key delegation to a
third party.

```typescript
// Derive a view key scoped to self (local indexer)
const viewKeyHex = await deriveViewKey({
  masterSecret: userPassword,
  indexerPubkey: userPubkey, // self -- local indexer
  uriPrefix: `mutable://accounts/${userPubkey}/journal/`,
  purpose: "local-search",
});

const viewKey = SecretEncryptionKey.fromHex(viewKeyHex);

// In-memory search backend (runs in browser)
class LocalSearchBackend implements IndexerBackend {
  private entries = new Map<
    string,
    { uri: string; title: string; body: string; date: number }
  >();

  async apply(ops: IndexOperation[]) {
    for (const op of ops) {
      if (op.type === "put") this.entries.set(op.key, op.value as any);
      else if (op.type === "delete") this.entries.delete(op.key);
    }
  }

  async query<T>(query: IndexQuery): Promise<IndexQueryResult<T>> {
    let results = Array.from(this.entries.values());
    if (query.search) {
      const terms = query.search.toLowerCase().split(/\s+/);
      results = results.filter((entry) => {
        const text = `${entry.title} ${entry.body}`.toLowerCase();
        return terms.every((term) => text.includes(term));
      });
    }
    results.sort((a, b) => b.date - a.date);
    const offset = query.offset || 0;
    const limit = query.limit || 50;
    return {
      data: results.slice(offset, offset + limit) as T[],
      total: results.length,
    };
  }

  async raw() {
    return [];
  }
  async cleanup() {
    this.entries.clear();
  }
}

// Wire it: zero-trust local search
const localBackend = new LocalSearchBackend();
const indexerProcessor = createIndexerProcessor({
  indexers: [journalSearchIndexer],
  backend: localBackend,
  decrypt: (payload) => viewKey.decrypt(payload),
  synchronous: true,
});
```

---

## Proposed Package Structure

```
libs/b3nd-indexer/
  types.ts          -- IndexerDefinition, IndexOperation, IndexQuery, etc.
  processor.ts      -- createIndexerProcessor (wires into node pipeline)
  backfill.ts       -- backfill utility
  runtime.ts        -- initializeIndexer, schema evolution
  client.ts         -- IndexerClientInterface, HttpIndexerClient
  server.ts         -- mountIndexerRoutes
  backends/
    postgres.ts     -- PostgresIndexerBackend
    memory.ts       -- MemoryIndexerBackend (for testing/local)
    sqlite.ts       -- SQLiteIndexerBackend (for local/edge)
  hooks.ts          -- React hooks (useIndexedQuery, useIndexedSearch, useAggregation)
  view-keys.ts      -- deriveViewKey, delegation helpers
  verify.ts         -- spot-check verification utilities
  deno.json
```

## Key Design Decisions

| Decision                                        | Rationale                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Indexers are separate from nodes                | Separation of concerns: nodes validate + persist, indexers project. Indexer failures don't affect writes.                             |
| `filter` + `map` pattern                        | Mirrors MapReduce/event-sourcing. `filter` is cheap (string match), `map` is expensive (decrypt, parse).                              |
| `IndexOperation` is a union type                | Backend-agnostic: same definition works with Postgres, SQLite, Elasticsearch, or in-memory. `sql` escape hatch covers advanced cases. |
| View keys are derived, not generated            | Deterministic derivation means user can re-derive without storing. Binds to indexer identity + URI prefix.                            |
| `IndexerClient` extends `NodeProtocolInterface` | Drop-in compatibility with all existing compositors.                                                                                  |
| Eventual consistency by default                 | Matches B3nd's philosophy. Freshness API lets apps make informed UX decisions.                                                        |
| Three deployment modes, same API                | Start simple (in-process), scale to separate services without code changes.                                                           |

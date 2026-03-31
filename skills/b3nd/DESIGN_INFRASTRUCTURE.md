# Infrastructure & Deployment

A B3nd node is a process that speaks the `NodeProtocolInterface` — it
can `receive()`, `read()`, `list()`, and `delete()` messages. Everything
else is a deployment choice. This document explores what nodes need to
support handlers and listeners, how to deploy them, and how to scale.

---

## Node Requirements for Handler Support

A Firecat node that supports handlers must provide the full protocol
interface. Handlers compose with these operations:

```
┌──────────────────────────────────────────────────────────┐
│                  NodeProtocolInterface                    │
│                                                          │
│  receive(msg)    ── accept a [uri, data] message         │
│  read(uri)       ── fetch a single record                │
│  list(uri, opts) ── enumerate records under a prefix     │
│  delete(uri)     ── remove a record                      │
│  status()        ── report node status + list programs    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

A handler uses these operations in a specific pattern:

```
┌──────────┐                    ┌────────────────────┐
│  Client   │                    │       Node         │
│           │   ① receive()      │                    │
│           │───────────────────>│  inbox/handler/ts  │
│           │                    │                    │
│           │                    │   ② list()         │
│           │                    │   ③ read()         │
│           │                    │        │           │
│           │                    │   ┌────▼────┐      │
│           │                    │   │ Handler │      │
│           │                    │   └────┬────┘      │
│           │                    │        │           │
│           │                    │   ④ receive()      │
│           │   ⑤ read()         │   (response)       │
│           │<───────────────────│  outbox/client/ts  │
│           │                    │                    │
│           │                    │   ⑥ delete()       │
│           │                    │   (cleanup inbox)   │
└──────────┘                    └────────────────────┘
```

**Step by step:**

1. Client writes an encrypted request to the handler's inbox URI
2. Handler (via `connect()`) calls `list()` to discover new inbox items
3. Handler calls `read()` to fetch each request
4. Handler processes the request and calls `receive()` to write the
   encrypted response to the client's outbox
5. Client calls `read()` to fetch the response
6. Handler calls `delete()` to clean up the processed inbox item

The node must support all six operations. A read-only node or a
write-only node cannot host handlers.

---

## Deployment Topologies

### Single Node + Embedded Handler

The simplest deployment. The handler runs in the same process as the node.

```
┌─────────────────────────────────┐
│           Process               │
│                                 │
│  ┌─────────┐    ┌───────────┐  │
│  │  HTTP    │    │  Memory   │  │
│  │  Server  │───>│  Client   │  │
│  │  (Hono)  │    │           │  │
│  └─────────┘    └─────┬─────┘  │
│                       │        │
│                  ┌────▼────┐   │
│                  │ Handler │   │
│                  │ (loop)  │   │
│                  └─────────┘   │
│                                 │
└─────────────────────────────────┘
```

```typescript
const client = new MemoryClient();
const processor = respondTo(handler, { identity, client });
const conn = connect(client, { prefix: INBOX, processor });
conn.start();

const app = new Hono();
const frontend = servers.httpServer(app);
createServerNode({ frontend, client });
```

**Best for:** Development, prototypes, single-purpose services.

**Characteristics:**
- Zero network hops between handler and storage
- Single process to monitor
- Handler failure takes down the node
- No horizontal scaling

### Node + Remote Listener

The handler runs in a separate process and polls the node over HTTP.

```
┌──────────────┐            ┌──────────────┐
│    Node      │            │   Listener   │
│              │   HTTP     │              │
│  ┌────────┐  │<───────────│  connect()   │
│  │Postgres│  │   list()   │              │
│  │        │  │   read()   │  respondTo() │
│  │        │  │   receive()│              │
│  │        │  │   delete() │  handler()   │
│  └────────┘  │            │              │
│              │            └──────────────┘
│  ┌────────┐  │
│  │  HTTP  │  │
│  │ Server │  │
│  └────────┘  │
└──────────────┘
```

```typescript
// listener process
const remote = new HttpClient({ url: "https://node.example.com" });
const processor = respondTo(handler, { identity, client: remote });
const conn = connect(remote, { prefix: INBOX, processor });
conn.start();
```

**Best for:** Production deployments, the vault listener pattern.

**Characteristics:**
- Handler restarts don't affect the node
- Handler can run on different hardware / region
- Network latency on each poll cycle
- Handler and node can scale independently

### Node Cluster + Shared Listeners

Multiple nodes share the same backend. Listeners connect to any node.

```
┌───────────┐  ┌───────────┐  ┌───────────┐
│  Node A   │  │  Node B   │  │  Node C   │
│  (HTTP)   │  │  (HTTP)   │  │  (HTTP)   │
└─────┬─────┘  └─────┬─────┘  └─────┬─────┘
      │              │              │
      └──────────────┼──────────────┘
                     │
              ┌──────▼───────┐
              │   Postgres   │
              │   (shared)   │
              └──────────────┘
                     ▲
                     │
              ┌──────┴───────┐
              │   Listener   │
              │  (connects   │
              │   to any     │
              │   node)      │
              └──────────────┘
```

**Best for:** High availability, load balancing, geographic distribution.

**Characteristics:**
- Any node can accept writes — they all share storage
- Listener polls through one node but could failover
- Load balancer distributes client traffic
- Database becomes the bottleneck and single point of failure

### Peer Replication + Local Handlers

Each node has its own storage and replicates with peers. Handlers run
locally on each node.

```
┌──────────────┐            ┌──────────────┐
│    Node A    │   sync     │    Node B    │
│              │<──────────>│              │
│  ┌────────┐  │            │  ┌────────┐  │
│  │Storage │  │            │  │Storage │  │
│  └────────┘  │            │  └────────┘  │
│  ┌────────┐  │            │  ┌────────┐  │
│  │Handler │  │            │  │Handler │  │
│  └────────┘  │            │  └────────┘  │
└──────────────┘            └──────────────┘
        ▲                           ▲
        │                           │
   ┌────┴────┐                 ┌────┴────┐
   │Client A │                 │Client B │
   └─────────┘                 └─────────┘
```

**Best for:** Distributed networks, censorship resistance, edge
deployments.

**Characteristics:**
- No single point of failure
- Eventual consistency between nodes
- Handler logic runs at the edge
- Conflict resolution needed for concurrent writes
- Highest operational complexity

---

## Inbox / Outbox Convention

Handlers use URI conventions to discover and route messages. These are
not protocol requirements — they're the pattern that `respondTo()` and
`connect()` implement.

### URI Patterns

```
Inbox (client → handler):
  immutable://inbox/{handlerPubkey}/{topic}/{timestamp}

Outbox (handler → client):
  immutable://inbox/{clientPubkey}/{topic}/{timestamp}
```

Both directions use `immutable://inbox` — write-once delivery. The
handler's pubkey identifies its inbox. The client's pubkey identifies
its outbox (from the handler's perspective).

### Discovery Pattern

```typescript
// Handler discovers new messages by listing its inbox prefix
const items = await client.list(
  `immutable://inbox/${handlerPubkey}/`,
  { sortBy: "timestamp", sortOrder: "asc" }
);

// Process each message
for (const item of items.data) {
  const msg = await client.read(item.uri);
  await process(msg);
  await client.delete(item.uri);  // cleanup
}
```

### Cleanup Strategies

| Strategy          | How                                    | When                          |
| ----------------- | -------------------------------------- | ----------------------------- |
| Immediate delete  | `delete()` after processing            | Default, saves storage        |
| TTL-based         | Periodic sweep of old URIs             | When audit trail needed       |
| Archive           | Move to `hash://` before deleting      | When responses need history   |
| Never delete      | Leave inbox items forever              | Development / debugging       |

### Topic Namespacing

Topics let a single handler serve multiple concerns:

```
immutable://inbox/{handler}/auth/{ts}      ← auth requests
immutable://inbox/{handler}/query/{ts}     ← data queries
immutable://inbox/{handler}/admin/{ts}     ← admin operations
```

The handler's `connect()` prefix determines scope:

```typescript
// Listen to everything
connect(client, { prefix: `immutable://inbox/${key}/` });

// Listen only to auth requests
connect(client, { prefix: `immutable://inbox/${key}/auth/` });
```

---

## Scaling Considerations

### Message Queuing via URI Space

The URI space is the queue. `list()` with pagination is the consumer.

```
immutable://inbox/handler/topic/
├── 1708700000000    ← oldest
├── 1708700001000
├── 1708700002000
├── 1708700003000    ← newest
```

**Poll model (current):** Handler calls `list()` on an interval. Simple,
resilient, high latency.

```
┌────────┐  list() every 5s  ┌──────────┐
│Handler │──────────────────>│   Node   │
│        │<──items[]─────────│          │
│        │                   │          │
│        │  read() per item  │          │
│        │──────────────────>│          │
└────────┘                   └──────────┘
```

**Push model (future):** Node notifies handler when new items arrive.
Lower latency, more complex.

```
┌────────┐  subscribe()      ┌──────────┐
│Handler │──────────────────>│   Node   │
│        │                   │          │
│        │<──event: new item─│          │
│        │                   │          │
│        │  read(uri)        │          │
│        │──────────────────>│          │
└────────┘                   └──────────┘
```

### Backpressure

When a handler can't keep up, the inbox grows. The `list()` pagination
provides natural backpressure:

```typescript
// Process one page at a time
const page = await client.list(prefix, { limit: 50, page: 1 });
for (const item of page.data) {
  await process(item);
}
// Don't request page 2 until page 1 is done
```

If the inbox grows beyond a threshold, the handler can:
- Increase poll frequency
- Process items in parallel (within a page)
- Alert the operator
- Drop items older than a TTL

### Multiple Listeners Per Inbox

Multiple listener instances can share an inbox if they coordinate:

```
┌────────────┐
│ Listener 1 │──list(page=1)──>┌──────────┐
└────────────┘                 │          │
                               │   Node   │
┌────────────┐                 │          │
│ Listener 2 │──list(page=2)──>│          │
└────────────┘                 └──────────┘
```

This requires external coordination (lock service, partitioning) to
prevent duplicate processing. Simpler: run one listener per inbox and
scale by adding more inboxes (topic sharding).

---

## Operational Model

### What Operators Need

A production node deployment requires:

```
┌─────────────────────────────────────────────┐
│                Deployment                    │
│                                              │
│  ┌────────────┐  Environment:               │
│  │   Node     │  PORT=43100                  │
│  │  Process   │  CORS_ORIGIN=*               │
│  │            │  BACKEND_URL=postgres://...   │
│  └─────┬──────┘                              │
│        │                                     │
│  ┌─────▼──────┐  Health:                     │
│  │  Backend   │  GET /api/v1/status           │
│  │ (Postgres) │  → { status, programs, ... }  │
│  └────────────┘                              │
│                                              │
│  ┌────────────┐  Monitoring:                 │
│  │  Listener  │  Poll interval logs          │
│  │  Process   │  Message count per cycle     │
│  │            │  Error rate                   │
│  └────────────┘  Processing latency          │
│                                              │
└─────────────────────────────────────────────┘
```

### Environment Variables

| Variable           | Purpose                          | Example                         |
| ------------------ | -------------------------------- | ------------------------------- |
| `PORT`             | HTTP server port                 | `43100`                         |
| `CORS_ORIGIN`      | Allowed origins                  | `*` or `https://app.example`    |
| `BACKEND_URL`      | Storage backend connection       | `postgres://user:pass@host/db`  |
| `VAULT_SECRET`     | Handler-specific secret          | `(random 256-bit hex)`          |
| `VAULT_SEED`       | Deterministic identity seed      | `(random 256-bit hex)`          |
| `POLL_INTERVAL_MS` | Listener poll frequency          | `5000`                          |
| `FIRECAT_URL`      | Remote node URL (for listeners)  | `https://testnet.fire.cat`      |

### Health Checks

The `/api/v1/status` endpoint returns:

```json
{
  "status": "healthy",
  "uptime": 86400,
  "programs": ["mutable://open", "mutable://accounts", "..."]
}
```

For listeners, health is measured by poll success rate. A listener that
fails to `list()` for N consecutive cycles should alert.

### Graceful Shutdown

```typescript
// Node: stop accepting new connections, drain in-flight requests
process.on("SIGTERM", async () => {
  await node.close();        // stop HTTP server
  await client.cleanup();    // close DB connections
});

// Listener: finish current poll cycle, then stop
const stop = connection.start();
process.on("SIGTERM", () => {
  stop();                    // stop polling loop
});
```

### Monitoring Hooks

Key metrics to track:

```
node_receive_total          ← messages received
node_receive_errors         ← validation failures
node_read_total             ← read operations
node_list_total             ← list operations
listener_poll_total         ← poll cycles completed
listener_poll_items         ← items found per poll
listener_process_duration   ← time to process one message
listener_process_errors     ← handler failures
```

---

## The Vault as Reference Architecture

The `apps/vault-listener/` is the canonical example of a deployed handler.
It demonstrates every pattern in this document.

```
┌─────────────────────────────────────────────────────────┐
│                   Vault Listener                         │
│                                                          │
│  ┌─────────────────┐    ┌──────────────────────────┐    │
│  │    connect()     │    │      respondTo()          │    │
│  │                  │    │                            │    │
│  │  polls inbox     │───>│  decrypt request           │    │
│  │  prefix:         │    │  verify OAuth token        │    │
│  │  inbox/{vault}/  │    │  derive HMAC secret        │    │
│  │                  │    │  encrypt response           │    │
│  │  pollInterval:   │    │  sign & write to outbox     │    │
│  │  5000ms          │    │                            │    │
│  └─────────────────┘    └──────────────────────────┘    │
│                                                          │
│  Identity: deterministic (from VAULT_SEED)               │
│  Client: HttpClient → remote Firecat node                │
│  Handler: vault.ts (pure function)                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### What it demonstrates

| Pattern               | Implementation                                        |
| --------------------- | ----------------------------------------------------- |
| Remote listener       | `HttpClient` to remote node, `connect()` for polling  |
| Encrypted boundary    | `respondTo()` wraps handler in encrypt/decrypt         |
| Deterministic identity| `VAULT_SEED` env var → same keypair on restart        |
| Stateless handler     | `vault.ts` is a pure function, no database needed     |
| Inbox convention      | `immutable://inbox/{vaultPubkey}/...`                 |
| Outbox convention     | Writes response to `immutable://inbox/{clientPubkey}/`|
| Graceful lifecycle    | Signal handling, poll loop stop                       |

### Deploying Your Own Handler

Follow the vault pattern:

1. **Write the handler** — A function `(req: T) => Promise<U>`
2. **Wrap with `respondTo()`** — Adds crypto boundary
3. **Connect with `connect()`** — Adds transport (poll or push)
4. **Configure identity** — Deterministic (seed) or ephemeral (random)
5. **Set environment** — Node URL, secrets, poll interval
6. **Deploy** — Docker, Deno Deploy, bare metal — the handler doesn't care

```typescript
// minimal handler deployment
import { connect, respondTo } from "@bandeira-tech/b3nd-sdk/listener";
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

const client = new HttpClient({ url: Deno.env.get("FIRECAT_URL")! });
const identity = await encrypt.generateSigningKeyPair();

const processor = respondTo(
  async (req: { action: string }) => {
    return { result: `processed: ${req.action}` };
  },
  { identity, client },
);

const conn = connect(client, {
  prefix: `immutable://inbox/${identity.publicKeyHex}/`,
  processor,
  pollIntervalMs: 5000,
});

const stop = conn.start();
console.log(`Listening as ${identity.publicKeyHex}`);

Deno.addSignalListener("SIGTERM", () => stop());
```

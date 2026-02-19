---
name: b3nd-operators
description: B3nd node operations — running, deploying, and managing B3nd nodes. Two-phase binary (standalone + managed), backend configuration (memory, PostgreSQL, MongoDB, HTTP), managed mode (config-over-B3nd, heartbeat, metrics, hot reconfiguration, software updates), peer replication (push/pull/bidirectional), multi-node networks (NetworkManifest, docker-compose generation, local dev), key generation, environment variables. Use when asking about deploying nodes, managing infrastructure, monitoring, Docker deployment, multi-node setup, or operational concerns. For app development see the firecat skill. For protocol design see the b3nd-framework skill.
---

# B3nd Node Operations

You run the infrastructure. The protocol (schema) comes from someone else —
a protocol designer who defined validation rules using the B3nd framework.
Your job is uptime, backends, replication, and monitoring.

This document covers everything an infrastructure operator needs: standalone
nodes, managed mode, backend configuration, peer replication, monitoring,
Docker deployment, and multi-node networks.

**Building an app?** See [FIRECAT.md](./FIRECAT.md).
**Designing a protocol?** See [FRAMEWORK.md](./FRAMEWORK.md).

---

## Architecture

The B3nd node binary (`apps/b3nd-node/mod.ts`) runs in two phases:

```
┌──────────────────────────────────────────────────────────┐
│  Phase 1: Standalone Node (always runs)                  │
│                                                          │
│  ENV: PORT, BACKEND_URL, CORS_ORIGIN, SCHEMA_MODULE      │
│       ↓                                                  │
│  Parse backends → Build clients → Compose → HTTP server  │
│       ↓                                                  │
│  Listening on :PORT                                      │
└──────────────────────────┬───────────────────────────────┘
                           │ CONFIG_URL set?
                           ▼
┌──────────────────────────────────────────────────────────┐
│  Phase 2: Managed Mode (conditional)                     │
│                                                          │
│  ENV: CONFIG_URL, OPERATOR_KEY, NODE_ID,                 │
│       NODE_PRIVATE_KEY_PEM, encryption keys               │
│       ↓                                                  │
│  Load config from B3nd URI                               │
│  Hot-swap backends from config                           │
│  Load schema from schemaModuleUrl (if set)               │
│  Start: heartbeat, metrics, config watcher,              │
│         module watcher, update checker                   │
│  Wire peer replication (push/pull clients)               │
└──────────────────────────────────────────────────────────┘
```

Phase 1 always runs — it gives you a working node from environment variables
alone. Phase 2 activates when `CONFIG_URL` is set and adds self-configuration,
monitoring, schema hot-reload, software update checks, and peer replication.

If Phase 2's config is unavailable at startup, the node runs on Phase 1
backends and retries via the config watcher. This graceful degradation means
nodes boot even when the config server is down.

### Management URI Scheme

Managed mode stores operational data as B3nd messages:

```
mutable://accounts/{operatorKey}/nodes/{nodeId}/config   — signed+encrypted config
mutable://accounts/{nodeKey}/status                      — signed+encrypted heartbeat
mutable://accounts/{nodeKey}/metrics                     — signed+encrypted metrics
mutable://accounts/{operatorKey}/nodes/{nodeId}/update   — signed update manifest
mutable://accounts/{operatorKey}/networks/{networkId}    — network manifest
```

All management data flows through B3nd's own protocol — operators manage nodes
using the same `receive()`/`read()` interface that apps use.

---

## Quick Start: Standalone Node

The minimum to get a node running:

```bash
PORT=9942 \
CORS_ORIGIN=* \
BACKEND_URL=memory:// \
deno run -A apps/b3nd-node/mod.ts
```

This starts a permissive node (accepts any URI pattern) backed by in-memory
storage. Useful for development and testing.

### With a Schema

To enforce validation rules from a protocol schema:

```bash
PORT=9942 \
CORS_ORIGIN=* \
BACKEND_URL=memory:// \
SCHEMA_MODULE=./my-schema.ts \
deno run -A apps/b3nd-node/mod.ts
```

The schema module must export a default `Schema` object:

```typescript
// my-schema.ts
import type { Schema } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "mutable://open": async () => ({ valid: true }),
  "mutable://accounts": async ({ uri, value }) => {
    // your validation logic
    return { valid: true };
  },
};
export default schema;
```

### Verify

```bash
curl http://localhost:9942/health
# { "status": "healthy", "backends": ["memory"] }
```

---

## Backends

B3nd nodes support multiple storage backends. Each backend implements the
`NodeProtocolInterface` — the same interface apps use to talk to nodes.

### Backend Types

| Type         | URL Scheme        | Use Case                     |
| ------------ | ----------------- | ---------------------------- |
| Memory       | `memory://`       | Development, testing         |
| PostgreSQL   | `postgresql://`   | Production persistent storage|
| MongoDB      | `mongodb://`      | Production document storage  |
| HTTP         | `http://` `https://` | Peer/upstream forwarding  |

### Single Backend

```bash
BACKEND_URL=postgresql://user:pass@localhost:5432/b3nd
```

### Multi-Backend

Comma-separated URLs compose multiple backends:

```bash
BACKEND_URL=memory://,postgresql://user:pass@localhost:5432/b3nd
```

### How Composition Works

Multiple backends are composed using two combinators:

- **`parallelBroadcast`** — writes go to ALL backends simultaneously. A write
  succeeds if at least one backend accepts it. This provides redundancy.

- **`firstMatchSequence`** — reads try backends in order and return the first
  successful result. This provides fallback behavior.

```
Write: [message] → parallelBroadcast → [memory, postgres, peer1, peer2]
                                        ↓        ↓         ↓       ↓
                                       all receive simultaneously

Read:  read(uri) → firstMatchSequence → memory → postgres → peer1
                                        miss      miss      hit → return
```

Local backends are tried before peer backends on reads.

---

## Managed Mode

Managed mode turns a standalone node into a self-configuring node that loads
its configuration from the B3nd network itself.

### Activation

Set `CONFIG_URL` to activate managed mode:

```bash
PORT=9942 \
CORS_ORIGIN=* \
BACKEND_URL=memory:// \
CONFIG_URL=http://config-server:9900 \
OPERATOR_KEY=052fee... \
NODE_ID=a1b2c3... \
NODE_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n..." \
deno run -A apps/b3nd-node/mod.ts
```

### Required Environment Variables

| Variable | Description |
| -------- | ----------- |
| `CONFIG_URL` | URL of the config server (B3nd node holding configs) |
| `OPERATOR_KEY` | Operator's Ed25519 public key hex (signs configs) |
| `NODE_ID` | This node's Ed25519 public key hex (identity) |
| `NODE_PRIVATE_KEY_PEM` | This node's Ed25519 private key in PEM format |

### Optional Environment Variables

| Variable | Description |
| -------- | ----------- |
| `NODE_ENCRYPTION_PRIVATE_KEY_HEX` | X25519 private key hex for encrypted config/metrics |
| `OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX` | Operator's X25519 public key hex for encrypting status/metrics |

### What Managed Mode Provides

1. **Config loading** — reads `ManagedNodeConfig` from the config server
2. **Backend hot-swap** — replaces Phase 1 backends with config-specified ones
3. **Schema hot-reload** — loads schema from `schemaModuleUrl` in config
4. **Heartbeat** — periodic signed status writes
5. **Metrics** — operation latency tracking (p50/p99, ops/sec, error rate)
6. **Config watcher** — polls for config changes and applies them live
7. **Module watcher** — detects schema URL changes and hot-loads new schemas
8. **Update checker** — polls for software update manifests
9. **Peer replication** — push/pull data to/from peer nodes

### Graceful Degradation

If config is unavailable at startup, the node logs a warning and runs on
Phase 1 backends. The config watcher retries periodically. When config becomes
available, backends are hot-swapped automatically.

---

## Key Generation

B3nd uses two key types:

### Ed25519 Identity (Signing)

Used for signing configs, heartbeats, metrics, and authenticated messages.

```typescript
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

// Generate a signing keypair
const keys = await encrypt.generateSigningKeyPair();
console.log("Public key (hex):", keys.publicKeyHex);
console.log("Private key (hex):", keys.privateKeyHex);

// Export private key as PEM (for NODE_PRIVATE_KEY_PEM env var)
const pem = await encrypt.exportPrivateKeyPem(keys.privateKey);
```

### X25519 Encryption

Used for encrypting config, status, and metrics so only the intended recipient
can read them.

```typescript
const encKeys = await encrypt.generateEncryptionKeyPair();
console.log("Encryption public key (hex):", encKeys.publicKeyHex);
console.log("Encryption private key (hex):", encKeys.privateKeyHex);
```

### What Goes Where

| Key | Who holds it | Used for |
| --- | ------------ | -------- |
| Operator signing private key | Operator | Signing configs and updates |
| Operator signing public key | All nodes (`OPERATOR_KEY`) | Verifying config signatures |
| Operator encryption public key | All nodes (`OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX`) | Encrypting status/metrics to operator |
| Node signing private key | Each node (`NODE_PRIVATE_KEY_PEM`) | Signing heartbeats and metrics |
| Node signing public key | Config server (`NODE_ID`) | Node identity, URI paths |
| Node encryption private key | Each node (`NODE_ENCRYPTION_PRIVATE_KEY_HEX`) | Decrypting config from operator |
| Node encryption public key | Config server (in `NetworkNodeEntry`) | Operator encrypts config to node |

---

## Writing Node Configs

Configs are `ManagedNodeConfig` objects signed by the operator and stored at
the config URI.

### ManagedNodeConfig Structure

```typescript
interface ManagedNodeConfig {
  configVersion: 1;
  nodeId: string;
  name: string;
  server: {
    port: number;
    corsOrigin: string;
  };
  backends: BackendSpec[];           // { type, url, options? }
  schemaModuleUrl?: string;          // URL to dynamically load schema from
  schemaInline?: Record<string, SchemaRule>;
  peers?: PeerSpec[];                // { url, direction }
  monitoring: {
    heartbeatIntervalMs: number;
    configPollIntervalMs: number;
    metricsEnabled: boolean;
  };
  networkId?: string;
  tags?: Record<string, string>;
}
```

### Signing and Publishing a Config

```typescript
import { HttpClient, send } from "@bandeira-tech/b3nd-sdk";
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

const configClient = new HttpClient({ url: "http://config-server:9900" });

// Your operator keys
const operatorPubKeyHex = "052fee...";
const operatorPrivKeyHex = "abc123...";

// The config to publish
const config: ManagedNodeConfig = {
  configVersion: 1,
  nodeId: "a1b2c3...",
  name: "evergreen-1",
  server: { port: 9942, corsOrigin: "*" },
  backends: [
    { type: "postgresql", url: "postgresql://b3nd:b3nd@postgres:5432/b3nd" },
  ],
  peers: [
    { url: "http://evergreen-2:9943", direction: "bidirectional" },
  ],
  monitoring: {
    heartbeatIntervalMs: 60_000,
    configPollIntervalMs: 30_000,
    metricsEnabled: true,
  },
};

// Sign the config
const signed = await encrypt.createAuthenticatedMessageWithHex(
  config,
  operatorPubKeyHex,
  operatorPrivKeyHex,
);

// Publish to config URI
const uri = `mutable://accounts/${operatorPubKeyHex}/nodes/${config.nodeId}/config`;
await configClient.receive([uri, signed]);
```

The node's config watcher will detect the new config and apply it.

---

## Monitoring

### Heartbeat

Managed nodes periodically write a `NodeStatus` document to:

```
mutable://accounts/{nodeKey}/status
```

The status includes:
- Node identity and name
- Status: `"online"`, `"degraded"`, or `"offline"`
- Last heartbeat timestamp
- Uptime
- Backend connection statuses
- Optional metrics snapshot

Interval: configurable via `monitoring.heartbeatIntervalMs` (default: 60s).

Status is signed by the node's Ed25519 key and optionally encrypted to the
operator's X25519 key.

### Metrics

When `monitoring.metricsEnabled` is `true`, the node collects:

| Metric | Description |
| ------ | ----------- |
| `writeLatencyP50` | Median write latency (ms) |
| `writeLatencyP99` | 99th percentile write latency (ms) |
| `readLatencyP50` | Median read latency (ms) |
| `readLatencyP99` | 99th percentile read latency (ms) |
| `opsPerSecond` | Operations per second (reads + writes) |
| `errorRate` | Fraction of operations that failed (0.0-1.0) |

Metrics are written to:

```
mutable://accounts/{nodeKey}/metrics
```

Signed and optionally encrypted, same as heartbeat.

### Reading Operational Data

As an operator, read your node's status:

```typescript
const status = await configClient.read(`mutable://accounts/${nodeId}/status`);
// Decrypt if encrypted:
// const decrypted = await encrypt.decrypt(status.record.data.payload, operatorEncryptionPrivateKey);
```

---

## Hot Reconfiguration

Managed nodes support live reconfiguration without restart.

### Config Watcher

The config watcher polls the config URI at `monitoring.configPollIntervalMs`.
When a new config is detected (by timestamp change), it:

1. Loads and verifies the new config (signature check)
2. Builds new backend clients from the config's `backends[]`
3. Wires peer replication from the config's `peers[]`
4. Hot-swaps the frontend's client via `frontend.configure()`
5. Updates the module watcher URL if `schemaModuleUrl` changed

The node continues serving requests during the swap.

### Schema Hot-Reload

If `schemaModuleUrl` is set in config, the module watcher periodically checks
for changes. When the URL changes (via config update), the watcher:

1. Dynamically imports the new schema module (with cache-busting)
2. Rebuilds the composed client with the new schema
3. Hot-swaps via `frontend.configure()`

This allows deploying schema changes without restarting nodes.

### What Triggers a Rebuild

| Change | Effect |
| ------ | ------ |
| Config timestamp changes | Full client rebuild (backends + peers + schema) |
| `schemaModuleUrl` changes | Schema reload + client rebuild |
| `backends[]` changes | New backend clients created |
| `peers[]` changes | New peer push/pull clients wired |

---

## Software Updates

The update protocol allows operators to publish software update manifests
that nodes detect automatically.

### Update Manifest

```typescript
interface ModuleUpdate {
  version: string;
  moduleUrl: string;      // URL to the new module
  checksum: string;       // SHA256 of the module
  releaseNotes?: string;
}
```

### Publishing an Update

Sign and publish to the node's update URI:

```typescript
const update: ModuleUpdate = {
  version: "1.2.0",
  moduleUrl: "https://releases.example.com/b3nd-node-1.2.0.ts",
  checksum: "abc123...",
  releaseNotes: "Performance improvements and bug fixes",
};

const signed = await encrypt.createAuthenticatedMessageWithHex(
  update,
  operatorPubKeyHex,
  operatorPrivKeyHex,
);

const uri = `mutable://accounts/${operatorPubKeyHex}/nodes/${nodeId}/update`;
await configClient.receive([uri, signed]);
```

### Update Detection

The update checker polls the update URI at `monitoring.configPollIntervalMs`.
When a new version is detected, it logs the availability:

```
[managed] Update available: v1.2.0 at https://releases.example.com/b3nd-node-1.2.0.ts
[managed] Release notes: Performance improvements and bug fixes
```

Updates are **log-only** — actual application is operator-initiated (restart
with new binary). The checker provides awareness, not automatic deployment.

---

## Peer Replication

Peer replication enables nodes to push writes to and pull reads from other
nodes. Peers are configured in `ManagedNodeConfig.peers[]`.

### PeerSpec

```typescript
interface PeerSpec {
  url: string;
  direction: "push" | "pull" | "bidirectional";
}
```

### Directions

| Direction | Writes | Reads |
| --------- | ------ | ----- |
| `push` | Best-effort broadcast to peer | No |
| `pull` | No | Fallback read from peer |
| `bidirectional` | Best-effort broadcast | Fallback read |

### How It Works

**Push**: After a local write succeeds, the message is also sent to push peers
via `parallelBroadcast`. Push peers are wrapped in a best-effort client that
swallows errors — a downed peer never blocks local writes.

**Pull**: When a local read misses (no data found), pull peers are tried in
sequence via `firstMatchSequence`. This provides read fallback without requiring
full data replication.

**Bidirectional**: Both push and pull. The peer receives writes and serves as
a read fallback.

### Configuration

```typescript
const config: ManagedNodeConfig = {
  // ...
  peers: [
    { url: "http://peer-1:9943", direction: "push" },
    { url: "http://peer-2:9944", direction: "pull" },
    { url: "http://peer-3:9945", direction: "bidirectional" },
  ],
};
```

### Composition

```
Local write → parallelBroadcast([local backends, bestEffort(push peers)])
Local read  → firstMatchSequence([local backends, pull peers])
```

Local backends always come first. Peer failures are isolated:
- Push failures are swallowed (logged as warnings)
- Pull failures cause fallthrough to the next backend

---

## Multi-Node Networks

### NetworkManifest

A `NetworkManifest` describes a set of nodes that form a network:

```typescript
interface NetworkManifest {
  networkId: string;
  name: string;
  description?: string;
  nodes: NetworkNodeEntry[];
}

interface NetworkNodeEntry {
  nodeId: string;
  name: string;
  role: string;
  publicKey: string;
  encryptionPublicKey?: string;
  config: ManagedNodeConfig;
}
```

### Docker Compose Generation

Generate a `docker-compose.yml` from a manifest:

```typescript
import { generateCompose } from "@b3nd/managed-node/compose";

const yaml = generateCompose(manifest, {
  operatorPubKeyHex: "052fee...",
  projectRoot: ".",
});

Deno.writeTextFileSync("docker-compose.yml", yaml);
```

The generated compose file includes:
- A **config-server** node (memory-backed) for storing configs
- **Database services** (Postgres, MongoDB) as needed by node configs
- One **managed-node** container per node in the manifest
- Proper `depends_on` ordering

### Local Development Runner

For faster iteration without Docker:

```typescript
import { startLocalNetwork } from "@b3nd/managed-node/runner";

const network = await startLocalNetwork(manifest, {
  entryPoint: "apps/b3nd-node/mod.ts",
  operatorPubKeyHex: "052fee...",
  configServerUrl: "http://localhost:9900",
  nodeKeys: {
    "node1-pubkey": "-----BEGIN PRIVATE KEY-----\n...",
    "node2-pubkey": "-----BEGIN PRIVATE KEY-----\n...",
  },
});

// Nodes are running as Deno child processes
// Output is streamed with node name prefixes

// Stop all nodes
await network.stop();
```

The local runner expects databases to already be running locally. It spawns
Deno processes for each node with the appropriate environment variables.

### Config Server as Coordination Point

In a multi-node network, the config server is the coordination point:

1. Operator generates keys for each node
2. Operator writes each node's `ManagedNodeConfig` to the config server
3. Nodes boot with `CONFIG_URL` pointing to the config server
4. Nodes load their config, hot-swap backends, wire peers
5. Config changes propagate automatically via config watchers

The config server itself is a simple B3nd node — it can run with `memory://`
for dev or `postgresql://` for production persistence.

---

## Docker Deployment

### Building

```bash
# From project root
docker build -f apps/b3nd-node/Dockerfile -t b3nd-node .

# Or via Makefile
make pkg
```

### Image

```
ghcr.io/bandeira-tech/b3nd/b3nd-node
```

### Running

```bash
docker run -d \
  -e PORT=9942 \
  -e CORS_ORIGIN=* \
  -e BACKEND_URL=memory:// \
  -p 9942:9942 \
  b3nd-node
```

### With Managed Mode

```bash
docker run -d \
  -e PORT=9942 \
  -e CORS_ORIGIN=* \
  -e BACKEND_URL=memory:// \
  -e CONFIG_URL=http://config-server:9900 \
  -e OPERATOR_KEY=052fee... \
  -e NODE_ID=a1b2c3... \
  -e NODE_PRIVATE_KEY_PEM="$(cat node.pem)" \
  -p 9942:9942 \
  b3nd-node
```

### Docker Compose Profiles

**Dev (persistent)**:
```yaml
services:
  node:
    build: .
    ports: ["9942:9942"]
    environment:
      BACKEND_URL: postgresql://b3nd:b3nd@postgres:5432/b3nd
    depends_on: [postgres]

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: b3nd
      POSTGRES_PASSWORD: b3nd
      POSTGRES_DB: b3nd
    volumes: [pgdata:/var/lib/postgresql/data]

volumes:
  pgdata:
```

**Test (ephemeral)**:
```yaml
services:
  node:
    build: .
    ports: ["9942:9942"]
    environment:
      BACKEND_URL: memory://
```

---

## Environment Variables Reference

### Phase 1 (Always Required)

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `PORT` | Yes | HTTP server port |
| `BACKEND_URL` | Yes | Backend URL(s), comma-separated |
| `CORS_ORIGIN` | Yes | CORS allowed origin (`*` for any) |
| `SCHEMA_MODULE` | No | Path/URL to schema module (default: accept all) |

### Phase 2 (Managed Mode)

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `CONFIG_URL` | Activates Phase 2 | URL of config server |
| `OPERATOR_KEY` | Yes (if Phase 2) | Operator's Ed25519 public key hex |
| `NODE_ID` | Yes (if Phase 2) | Node's Ed25519 public key hex |
| `NODE_PRIVATE_KEY_PEM` | Yes (if Phase 2) | Node's Ed25519 private key PEM |
| `NODE_ENCRYPTION_PRIVATE_KEY_HEX` | No | Node's X25519 private key hex (for encrypted config) |
| `OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX` | No | Operator's X25519 public key hex (for encrypted status/metrics) |

### Backend URL Examples

```bash
# Single memory backend
BACKEND_URL=memory://

# Single PostgreSQL
BACKEND_URL=postgresql://user:pass@localhost:5432/b3nd

# Single MongoDB
BACKEND_URL=mongodb://localhost:27017/b3nd

# Multi-backend (memory + postgres + upstream peer)
BACKEND_URL=memory://,postgresql://user:pass@localhost:5432/b3nd,http://upstream:9942

# MongoDB with custom collection
BACKEND_URL=mongodb://localhost:27017/mydb?collection=my_collection
```

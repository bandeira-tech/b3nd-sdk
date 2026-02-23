# Running Nodes

Recipes and patterns for deploying and managing B3nd nodes. Each section is
self-contained — jump to what you need.

For reference material on node architecture, backends, managed mode, and
replication, see [OPERATORS.md](./OPERATORS.md).

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
  backends: BackendSpec[];
  schemaModuleUrl?: string;
  schemaInline?: Record<string, SchemaRule>;
  peers?: PeerSpec[];
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

### Reading Operational Data

As an operator, read your node's status:

```typescript
const status = await configClient.read(`mutable://accounts/${nodeId}/status`);
// Decrypt if encrypted:
// const decrypted = await encrypt.decrypt(status.record.data.payload, operatorEncryptionPrivateKey);
```

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
await network.stop();
```

### Config Server as Coordination Point

In a multi-node network, the config server is the coordination point:

1. Operator generates keys for each node
2. Operator writes each node's `ManagedNodeConfig` to the config server
3. Nodes boot with `CONFIG_URL` pointing to the config server
4. Nodes load their config, hot-swap backends, wire peers
5. Config changes propagate automatically via config watchers

---

## Docker Deployment

### Building

```bash
# From project root
docker build -f apps/b3nd-node/Dockerfile -t b3nd-node .

# Or via Makefile
make pkg
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

**Dev (persistent):**

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

**Test (ephemeral):**

```yaml
services:
  node:
    build: .
    ports: ["9942:9942"]
    environment:
      BACKEND_URL: memory://
```

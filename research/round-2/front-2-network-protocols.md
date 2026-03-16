# Front 2: Network Architecture & Protocols — Round 2 Deep-Dive

**Round 2 — b3nd Framework & Firecat Network**
**Date:** 2026-03-16

---

## Executive Summary

Round 1 identified 10 critical gaps in b3nd's network architecture. This deep-dive provides concrete protocol designs, wire formats, and implementation strategies for each. The highest-priority items are: (1) Merkle tree delta replication, (2) SSE push/subscribe, and (3) NAT traversal with relay fallback. Together these transform b3nd from a single-node HTTP API into a functional peer-to-peer network.

---

## 1. Delta Replication via Merkle Trees (Critical)

### Current State

No replication protocol exists. The `parallelBroadcast` combinator in `libs/b3nd-combinators/` writes to multiple backends simultaneously, but there is no mechanism for nodes to synchronize after divergence. If a node goes offline and comes back, it has no way to determine what changed.

The Postgres client's `list()` (libs/b3nd-client-postgres/mod.ts:278-341) loads all matching rows, making full-sync replication prohibitively expensive at scale.

### Problem Analysis

Without delta replication:
- Multi-node deployments cannot recover from partitions
- Adding a new node requires a full data transfer
- No consistency guarantees between peer nodes
- The "DePIN" promise of distributed nodes is hollow without sync

### Proposed Solution: Merkle Tree-Based Anti-Entropy

**Data structure:** Binary Merkle tree over the sorted URI keyspace.

```
Level 0 (leaves): H(uri || ts || data_hash) for each record
Level 1: H(child_left || child_right) for pairs
...
Root: H(all leaves)
```

**Sync protocol (pull-based):**

```
Node A → Node B: SyncRequest { root_hash, level: 0 }
Node B → Node A: SyncResponse {
  match: false,
  children: [
    { hash: "abc...", range: ["a://", "m://"] },
    { hash: "def...", range: ["m://", "z://"] }
  ]
}
// A compares hashes at each level, recursing into mismatched subtrees
// At leaf level, exchange the actual records
```

**Wire format (JSON over HTTP, upgradeable to CBOR):**

```typescript
interface SyncRequest {
  type: "sync_request";
  nodeId: string;
  treeLevel: number;       // 0 = root, increasing = deeper
  rangeStart: string;       // URI range start (inclusive)
  rangeEnd: string;         // URI range end (exclusive)
  hash: string;             // SHA-256 of this subtree
}

interface SyncResponse {
  type: "sync_response";
  match: boolean;
  children?: Array<{
    hash: string;
    rangeStart: string;
    rangeEnd: string;
    recordCount: number;
  }>;
  records?: Array<{         // Only at leaf level
    uri: string;
    ts: number;
    data: unknown;
  }>;
}
```

**Complexity:**
- Tree construction: O(N log N) where N = number of URIs
- Sync with K differences: O(K log N) comparisons + O(K) record transfers
- Full sync of 1M records with 100 differences: ~1700 hash comparisons vs 1M record scan

**Incremental maintenance:** On each `receive()`, update the leaf hash and propagate up. Amortized O(log N) per write.

### Implementation Complexity

- Merkle tree module: ~500 lines
- Sync protocol endpoints: ~300 lines
- Integration with persistence layer: ~200 lines
- **Total: ~1000 lines, 2-3 weeks**

### Tradeoffs
- Storage overhead: ~32 bytes per URI for intermediate hashes (negligible)
- CPU cost: SHA-256 hashing on every write (sub-microsecond on modern hardware)
- Merkle trees don't handle deletes well — need a tombstone mechanism
- Clock-independent: only compares data hashes, no timestamp dependency

### Open Questions
- Binary vs radix tree? (Radix better for URI-prefix-heavy workloads)
- How to handle concurrent writes during sync? (Snapshot isolation or best-effort)
- Should the Merkle tree be URI-ordered or timestamp-ordered?

### Cross-Front Dependencies
- **Front 1 (Crypto):** Data hashes must cover encrypted payloads
- **Front 3 (Systems):** Persistence layer needs hash column
- **Front 5 (Consensus):** Consensus metadata should be in a separate Merkle tree

---

## 2. Push/Subscribe Mechanism via SSE (High)

### Current State

The `connect()` function in `libs/b3nd-listener/mod.ts` implements polling:

```typescript
// Simplified from listener implementation
while (running) {
  const items = await client.list(prefix);
  for (const item of items.data) {
    const msg = await client.read(item.uri);
    await processor(msg);
  }
  await delay(pollInterval); // Default: 1000ms
}
```

This means:
- Minimum latency = pollInterval (default 1s)
- Wasted bandwidth when no messages arrive
- CPU cost scales linearly with number of listeners × poll frequency

### Problem Analysis

Polling is fundamentally wrong for messaging. At 1000 listeners polling every 1s, the node handles 1000 list+read requests/sec even with zero messages. SSE reduces this to zero idle traffic.

### Proposed Solution: Server-Sent Events (SSE) Endpoint

**New endpoint:** `GET /api/v1/subscribe?prefix=<uri_prefix>&since=<timestamp>`

```typescript
// Server-side (in b3nd-servers/http.ts)
app.get("/api/v1/subscribe", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const prefix = req.query.prefix as string;
  const since = Number(req.query.since) || 0;

  // Send backlog first
  const backlog = await client.list(prefix, { sortBy: "timestamp", sortOrder: "asc" });
  for (const item of backlog.data.filter(i => i.ts > since)) {
    res.write(`event: message\ndata: ${JSON.stringify(item)}\n\n`);
  }

  // Then stream new writes
  const unsubscribe = writeEmitter.on(prefix, (record) => {
    res.write(`event: message\ndata: ${JSON.stringify(record)}\n\n`);
  });

  req.on("close", unsubscribe);
});
```

**Client-side integration:**

```typescript
// New: SSE-based connect() variant
export function connectSSE(url: string, config: {
  prefix: string;
  processor: Processor;
  since?: number;
}): Connection {
  const eventSource = new EventSource(
    `${url}/api/v1/subscribe?prefix=${encodeURIComponent(config.prefix)}&since=${config.since || 0}`
  );

  eventSource.addEventListener("message", async (event) => {
    const record = JSON.parse(event.data);
    await config.processor(record);
  });

  return {
    start: () => eventSource,
    stop: () => eventSource.close(),
  };
}
```

**Backpressure:** If the client can't keep up, use a bounded buffer with `retry:` field for reconnection.

### Implementation Complexity
- SSE endpoint: ~150 lines
- Write event emitter (in-process pub/sub): ~100 lines
- Client SSE adapter: ~100 lines
- **Total: ~350 lines, 1 week**

### Tradeoffs
- SSE is HTTP/1.1 compatible, works through most proxies and CDNs
- Unidirectional (server → client only) — client still uses POST for writes
- One TCP connection per subscription (vs WebSocket multiplexing)
- No browser connection limit issues (SSE auto-reconnects)

### Open Questions
- SSE vs WebSocket? SSE is simpler and sufficient for push; WebSocket adds bidirectional but more complexity
- How to handle prefix wildcards in subscriptions?
- Should we support filtered subscriptions (e.g., only messages matching a pattern)?

### Cross-Front Dependencies
- **Front 3 (Systems):** Write pipeline must emit events
- **Front 5 (Consensus):** Consensus confirmations should be subscribable

---

## 3. NAT Traversal Architecture (High)

### Current State

b3nd nodes are assumed to be publicly reachable HTTP servers. No mechanism exists for residential nodes behind NAT to participate as full peers.

### Problem Analysis

For a DePIN network, nodes MUST run on consumer hardware behind residential NATs. Without traversal:
- Only datacenter/VPS nodes can participate
- Decentralization is limited to operators who can afford public IPs
- The network cannot leverage edge/home infrastructure

### Proposed Solution: Three-Tier Connectivity

```
Tier 1: Direct (public IP)
  → Standard HTTP/WebSocket connection
  → ~40% of nodes (datacenter, VPS, ISPs with public IPs)

Tier 2: UPnP/NAT-PMP (auto-configured)
  → Node requests port mapping from router
  → Advertises external IP:port to network
  → ~30% of nodes (home routers supporting UPnP)

Tier 3: Relay (TURN-like)
  → Node connects outbound to a relay server
  → Relay forwards traffic between nodes
  → ~30% of nodes (strict NAT, CGNAT, enterprise firewalls)
```

**UPnP implementation:**

```typescript
interface NatMapping {
  internalPort: number;
  externalPort: number;
  externalIp: string;
  protocol: "TCP";
  ttl: number;        // Refresh interval (typically 3600s)
}

async function setupUPnP(internalPort: number): Promise<NatMapping | null> {
  // 1. SSDP discovery: multicast to 239.255.255.250:1900
  // 2. Parse UPnP device description
  // 3. AddPortMapping SOAP call
  // 4. GetExternalIPAddress for public IP
  // 5. Return mapping or null if unsupported
}
```

**Relay protocol:**

```typescript
// Relay server maintains a registry of connected nodes
interface RelayRegistration {
  nodeId: string;
  publicKey: string;
  connectedAt: number;
  websocket: WebSocket;  // Outbound WS from node to relay
}

// When node A wants to reach node B behind NAT:
// 1. A sends to relay: { to: "nodeB_id", payload: ... }
// 2. Relay forwards via B's existing WebSocket connection
// 3. B responds through the same channel
```

**STUN for hole-punching (optimization):**

After relay establishes initial contact, attempt UDP hole-punch:
1. Both nodes send binding requests to STUN server
2. Exchange reflexive addresses via relay
3. Attempt direct UDP communication
4. If successful, upgrade from relay to direct

### Implementation Complexity
- UPnP client: ~400 lines
- Relay server: ~500 lines
- STUN integration: ~300 lines
- Connection manager (tier selection): ~300 lines
- **Total: ~1500 lines, 3-4 weeks**

### Tradeoffs
- UPnP is a security concern (opens ports automatically) — make it opt-in
- Relay adds latency (~50-100ms RTT) and bandwidth costs
- Relay servers are centralization points — need multiple relays for resilience
- STUN hole-punching has ~60-75% success rate on residential connections

### Open Questions
- Who operates relay servers? (Node operators with public IPs, incentivized via fees)
- How to prevent relay abuse (DDoS amplification)?
- Should relay traffic be encrypted end-to-end (yes — use the existing asymmetric encryption)

### Cross-Front Dependencies
- **Front 1 (Crypto):** End-to-end encryption through relays
- **Front 4 (Economics):** Relay operators need compensation
- **Front 5 (Consensus):** Consensus messages must work through relays

---

## 4. Peer Discovery (High)

### Current State

No peer discovery mechanism. Nodes must be manually configured with peer URLs.

### Proposed Solution: Hybrid Discovery

**Layer 1: Bootstrap registry (internet-wide)**

```typescript
// Well-known HTTPS endpoint
const BOOTSTRAP_REGISTRIES = [
  "https://bootstrap.firecat.network/api/v1/peers",
  "https://bootstrap2.firecat.network/api/v1/peers",
];

interface PeerAdvertisement {
  nodeId: string;
  publicKey: string;
  endpoints: string[];     // ["https://1.2.3.4:8080", "wss://1.2.3.4:8081"]
  capabilities: string[];  // ["storage", "relay", "validator"]
  region: string;          // "us-east-1"
  version: string;         // "0.8.1"
  lastSeen: number;
  signature: string;       // Signed by node's identity key
}

// Peer discovery flow:
// 1. Node starts, queries bootstrap registries
// 2. Gets initial peer list (10-50 peers)
// 3. Gossip protocol propagates peer info
// 4. Periodic re-advertisement (every 5 minutes)
```

**Layer 2: mDNS (LAN-local)**

```typescript
// Advertise on local network
const SERVICE_TYPE = "_b3nd._tcp.local";

function advertiseMDNS(port: number, nodeId: string): void {
  // Multicast DNS advertisement
  // Other nodes on same LAN discover automatically
  // Enables zero-config local clusters
}
```

**Layer 3: Gossip protocol (peer-to-peer)**

```typescript
// Each node maintains a peer table of ~50 peers
// On receiving a new peer advertisement:
// 1. Validate signature
// 2. Add to local peer table (if not full)
// 3. Forward to K random peers (K=3)
// Convergence: O(log N) hops for N-node network
```

### Implementation Complexity
- Bootstrap client: ~200 lines
- mDNS advertisement/discovery: ~200 lines
- Gossip protocol: ~400 lines
- Peer table management: ~200 lines
- **Total: ~1000 lines, 2 weeks**

### Tradeoffs
- Bootstrap registries are centralization points (mitigated by multiple registries + gossip)
- mDNS only works on same broadcast domain (LAN)
- Gossip has convergence delay (~5-10s for 1000 nodes)

### Open Questions
- How to handle peer churn (nodes joining/leaving frequently)?
- Sybil protection for peer discovery? (Require proof-of-stake or rate-limit per IP)
- DHT (Kademlia) vs gossip for large networks? (Kademlia for >10K nodes)

### Cross-Front Dependencies
- **Front 1 (Crypto):** Peer advertisements must be signed
- **Front 5 (Consensus):** Validator discovery is a specialization of peer discovery

---

## 5. Consensus Storage Overhead Reduction (Medium)

### Current State

From the temporal consensus spec (`libs/firecat-protocol/TEMPORAL_CONSENSUS.md`), each user message generates:
- 1 pending message
- N attestations (one per validator)
- 1 confirmation
- Inclusion in a slot

With 5 validators: 7 records per user message → **7x storage overhead**.

### Proposed Solution: BLS Aggregation + Pruning

**BLS signature aggregation** collapses N attestation records into 1:

```
Before: 5 attestations × ~250 bytes = 1250 bytes
After:  1 aggregated attestation = ~300 bytes (48-byte BLS sig + metadata)
Reduction: 76%
```

**Pruning schedule:**

```
Stage          | Retain for  | After
Pending        | Until confirmed | Delete
Individual     | Until aggregated| Delete
attestations   |                 |
Aggregated     | Until slotted   | Archive (compressed)
attestation    |                 |
Confirmation   | Forever (or     | Keep
               | until finalized)|
Slot           | Forever         | Keep
```

**Net overhead after aggregation + pruning:** ~2x (down from 7x).

### Implementation Complexity
- BLS library integration (WASM): ~300 lines
- Aggregation logic: ~200 lines
- Pruning scheduler: ~200 lines
- **Total: ~700 lines, 2 weeks**

### Tradeoffs
- BLS signatures are ~10x slower to verify than Ed25519
- WASM BLS library adds ~500KB to node binary
- Pruning means historical attestation details are lost
- Aggregated signatures can't identify which specific validator signed (only that K-of-N did)

### Open Questions
- Should individual attestations be retained for dispute resolution?
- How does pruning interact with light client verification?
- Can we use BLS for signing AND attestation to avoid two signature schemes?

### Cross-Front Dependencies
- **Front 1 (Crypto):** BLS signature security analysis
- **Front 5 (Consensus):** Pruning affects consensus safety proofs
- **Front 6 (Math):** Storage complexity analysis

---

## 6. CBOR Content Negotiation (Medium)

### Current State

All data is serialized as JSON (`JSON.stringify`) and transported over HTTP with `Content-Type: application/json`. The `serializeMsgData()` function in `libs/b3nd-client-http/mod.ts:27` wraps binary data in a base64 marker object for JSON transport, adding ~33% overhead for binary payloads.

### Proposed Solution

**Content negotiation via Accept header:**

```
Client → Server: Accept: application/cbor, application/json;q=0.9
Server → Client: Content-Type: application/cbor
```

```typescript
// Server-side content negotiation
function negotiate(acceptHeader: string): "cbor" | "json" {
  if (acceptHeader.includes("application/cbor")) return "cbor";
  return "json";
}

// CBOR serialization (using existing cborg library)
import { encode, decode } from "cborg";

function serializeResponse(data: unknown, format: "cbor" | "json"): Uint8Array {
  if (format === "cbor") return encode(data);
  return new TextEncoder().encode(JSON.stringify(data));
}
```

**Benefits:**
- Binary data: 0% overhead (vs 33% for base64-in-JSON)
- Typical message: 20-30% smaller
- Faster parse times (CBOR is designed for machine parsing)
- Native Uint8Array support (no `__b3nd_binary__` wrapper needed)

### Implementation Complexity
- CBOR encode/decode integration: ~100 lines
- Content negotiation middleware: ~50 lines
- Client-side CBOR support: ~100 lines
- **Total: ~250 lines, 3-5 days**

### Tradeoffs
- CBOR is less human-debuggable than JSON (need tooling)
- Adds a dependency (cborg is ~15KB)
- Both formats must be maintained indefinitely
- JSON remains the default for backward compatibility

### Open Questions
- Should CBOR be the default for node-to-node communication? (Yes)
- Support MessagePack as well? (No — CBOR is the IETF standard, RFC 8949)

### Cross-Front Dependencies
- **Front 3 (Systems):** All clients must handle both formats

---

## 7. Delivery Guarantees for Inbox (Medium)

### Current State

The inbox pattern (write to `inbox://<recipient>/...`, recipient polls and reads) has no delivery guarantees. If the recipient reads a message and then crashes before processing it, the message is lost (it was already read and may be deleted or overwritten).

### Proposed Solution: Ack + Retry with Dead Letter

```typescript
interface InboxMessage {
  id: string;
  payload: unknown;
  status: "pending" | "processing" | "acked" | "dead";
  attempts: number;
  firstSeen: number;
  lastAttempt: number;
  visibilityTimeout: number;  // Message invisible to other readers until timeout
}

// Read with visibility timeout (SQS-like)
// 1. Reader claims message: status → "processing", set visibilityTimeout
// 2. Reader processes message
// 3. Reader ACKs: status → "acked"
// 4. If no ACK before timeout: status → "pending" (retry)
// 5. After maxAttempts: status → "dead" (dead letter queue)
```

**Wire protocol:**

```
POST /api/v1/inbox/claim
  Body: { prefix: "inbox://alice/requests/", count: 10, visibilityTimeout: 30000 }
  Response: { messages: [...] }

POST /api/v1/inbox/ack
  Body: { messageIds: ["msg1", "msg2"] }
  Response: { acked: 2 }

POST /api/v1/inbox/nack
  Body: { messageIds: ["msg3"], delay: 5000 }
  Response: { nacked: 1 }
```

### Implementation Complexity
- Inbox claim/ack/nack endpoints: ~300 lines
- Visibility timeout scheduler: ~150 lines
- Dead letter queue: ~100 lines
- **Total: ~550 lines, 1.5 weeks**

### Tradeoffs
- Adds state to what was a stateless read pattern
- Visibility timeout requires a timer/scheduler on the node
- Dead letter queue needs monitoring/alerting
- More complex than simple read-and-delete

### Open Questions
- Should ack be at-least-once or exactly-once? (At-least-once is practical; exactly-once requires dedup)
- How does this interact with encrypted inboxes? (Claim returns encrypted payloads, ACK is by ID)
- Maximum message retention time?

### Cross-Front Dependencies
- **Front 3 (Systems):** Persistence layer changes for message status
- **Front 4 (Economics):** Delivery guarantee pricing

---

## 8. Capability Advertisement (Low)

### Current State

The `health()` endpoint returns `{ status: "healthy" | "degraded" | "unhealthy", message?, details? }`. No information about what the node can do.

### Proposed Solution

Extend health response:

```typescript
interface ExtendedHealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  capabilities: {
    protocols: string[];        // ["http", "ws", "sse"]
    serialization: string[];    // ["json", "cbor"]
    storage: string[];          // ["memory", "postgres", "mongo"]
    consensus: boolean;         // Participates in consensus
    relay: boolean;             // Can relay for NAT-ed nodes
    maxMessageSize: number;     // Bytes
    version: string;            // SDK version
    schemaKeys: string[];       // Supported program keys
  };
  network: {
    nodeId: string;
    publicKey: string;
    region?: string;
    peers: number;
    uptime: number;
  };
}
```

### Implementation Complexity
- ~100 lines, 2-3 days

### Cross-Front Dependencies
- **Front 4 (Economics):** Capabilities affect pricing tiers

---

## 9. Geographic Routing (Low)

### Current State

No region awareness. All reads/writes go to a single configured endpoint.

### Proposed Solution

**Region metadata in peer advertisements** (from Section 4):

```typescript
// Client-side: select closest peer
async function selectPeer(peers: PeerAdvertisement[], targetRegion: string): PeerAdvertisement {
  // 1. Filter by region match
  // 2. If no match, find nearest region
  // 3. Fallback to latency-based selection (ping)
  const regionPeers = peers.filter(p => p.region === targetRegion);
  if (regionPeers.length > 0) return randomChoice(regionPeers);
  return lowestLatency(peers);
}
```

**Region-aware replication:** Tag data with origin region. Replicate to at least 2 regions for durability.

### Implementation Complexity
- Region tagging: ~100 lines
- Peer selection logic: ~150 lines
- **Total: ~250 lines, 1 week**

### Cross-Front Dependencies
- **Front 2 (self):** Requires peer discovery (Section 4)
- **Front 4 (Economics):** Cross-region replication costs

---

## 10. WebTransport Readiness (Low)

### Current State

Transport is HTTP/1.1 + WebSocket. No QUIC/HTTP3/WebTransport support.

### Proposed Solution

**Wait and prototype.** WebTransport is not yet widely supported:
- Deno: experimental QUIC API (unstable)
- Browsers: Chrome supports, Firefox partial, Safari no
- Node.js: no native support

**Prototype path:**

```typescript
// When Deno stabilizes QUIC:
const transport = await Deno.connectQuic({
  hostname: "node.example.com",
  port: 443,
  alpnProtocols: ["b3nd-v1"],
});

const stream = await transport.createBidirectionalStream();
// Multiplexed streams: one per concurrent operation
// No head-of-line blocking (unlike HTTP/1.1)
// 0-RTT connection resumption
```

**Expected benefits:**
- 20-40% latency improvement for small messages
- Better multiplexing under concurrent load
- 0-RTT reconnection (important for mobile)

### Recommendation
- Prototype in Q3 2026
- Production readiness: Q1 2027 (dependent on Deno/browser ecosystem)

---

## Summary of Priorities

| # | Item | Severity | Effort | Timeline |
|---|------|----------|--------|----------|
| 1 | Merkle delta replication | Critical | 2-3 weeks | Next sprint |
| 2 | SSE push/subscribe | High | 1 week | Next sprint |
| 3 | NAT traversal | High | 3-4 weeks | Next quarter |
| 4 | Peer discovery | High | 2 weeks | Next quarter |
| 7 | Inbox delivery guarantees | Medium | 1.5 weeks | Next sprint |
| 5 | Consensus storage pruning | Medium | 2 weeks | Next quarter |
| 6 | CBOR negotiation | Medium | 3-5 days | Next sprint |
| 8 | Capability advertisement | Low | 2-3 days | Opportunistic |
| 9 | Geographic routing | Low | 1 week | After peer discovery |
| 10 | WebTransport | Low | Prototype only | Q3 2026 |

---

## References

- RFC 8949: CBOR (Concise Binary Object Representation)
- RFC 9000: QUIC Transport Protocol
- W3C Server-Sent Events specification
- RFC 6762: mDNS (Multicast DNS)
- RFC 5389: STUN (Session Traversal Utilities for NAT)
- RFC 5766: TURN (Traversal Using Relays around NAT)
- Maymounkov & Mazières, "Kademlia: A Peer-to-peer Information System" (2002)
- Merkle, R., "A Digital Signature Based on a Conventional Encryption Function" (CRYPTO 1987)
- Boneh, Lynn & Shacham, "Short Signatures from the Weil Pairing" (BLS, 2001)
- Amazon SQS Visibility Timeout documentation (delivery guarantees model)

---

*This report is based on direct source code analysis of b3nd SDK. All code references point to actual implementations reviewed during this research round.*

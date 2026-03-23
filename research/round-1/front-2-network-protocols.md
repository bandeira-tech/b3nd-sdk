# Round 1 Research Report: Network Architecture & Protocols

**Date:** 2026-03-16
**Researcher:** Network Architecture & Protocol Analysis
**Subject:** b3nd DePIN Framework & Firecat Network — Network Layer Assessment

---

## Executive Summary

b3nd implements a URI-addressed message network with a deliberately minimal transport layer: HTTP as primary transport, WebSocket for bidirectional communication, and a poll-based replication model. The network supports three topologies (single node, cluster, peer-replicated) with pluggable storage backends. Firecat adds a temporal consensus protocol that encodes consensus state as messages within the same URI space it governs.

This report evaluates the network architecture against established protocol design principles, compares it with existing decentralized systems, identifies critical gaps for DePIN deployment, and proposes experimentation lines for hardening the network layer.

---

## A. Network Topology Analysis

### A.1 Single Node Model

The simplest topology: one process, one storage backend, serving HTTP/WebSocket.

**Strengths:**
- Zero coordination overhead — all operations are local
- Latency bounded only by storage backend (memory: ~μs, PostgreSQL: ~ms)
- Trivial deployment — `deno run` or Docker container
- Sufficient for development, personal data stores, and IoT edge devices

**Weaknesses:**
- Single point of failure — node down = service down
- No horizontal scaling — throughput capped by single machine
- No data redundancy — storage failure = data loss

**Failure modes:**
- Process crash: All in-flight operations lost, recovery depends on storage durability
- Storage failure: Memory backend = total loss; DB backend = recoverable from DB durability
- Network partition: Node becomes unreachable but data remains consistent locally

**Verdict:** Appropriate for personal nodes, edge devices, development. Not suitable as sole topology for production services.

### A.2 Cluster Model (Shared Backend)

Multiple node processes sharing a PostgreSQL or MongoDB backend.

**Strengths:**
- Horizontal read scaling — multiple frontends serve read traffic
- Storage-layer consistency — DB handles concurrent writes
- Standard deployment pattern — well-understood operational model
- Load balancing via standard HTTP LB (nginx, HAProxy, cloud LBs)

**Weaknesses:**
- Storage backend is single point of failure (mitigated by DB replication, but that's external to b3nd)
- Write scaling limited by backend — all writes funnel through one DB
- No geographic distribution — cluster typically co-located for DB latency

**Failure modes:**
- Frontend crash: LB routes to healthy nodes, no data loss
- DB failure: All nodes fail simultaneously — requires DB-level HA (Patroni, RDS Multi-AZ)
- Split brain: Possible if DB replication lags and nodes read stale data

**Performance characteristics:**
- Read throughput: O(N) where N = frontend nodes
- Write throughput: O(1) bounded by DB write capacity
- Latency: ~1-5ms for DB-backed reads, ~5-20ms for writes (PostgreSQL)

**Verdict:** Good for production services. Standard, well-understood. But doesn't provide the decentralization that DePIN requires.

### A.3 Peer-Replicated Model

Distributed nodes replicating data via HTTP polling of each other's `list` endpoints.

**Strengths:**
- True decentralization — no single point of failure
- Geographic distribution — nodes anywhere in the world
- Censorship resistance — no single node to block
- Data redundancy — multiple copies across independent operators

**Weaknesses:**
- Eventual consistency only — no strong consistency guarantees
- Replication lag proportional to polling interval (seconds to minutes)
- Bandwidth overhead — full list sync is O(total messages) per poll cycle
- No conflict resolution for mutable URIs — last-write-wins by timestamp
- No peer discovery — nodes must be manually configured to know about each other

**Failure modes:**
- Node failure: Other nodes continue operating, data available from replicas
- Network partition: Nodes diverge, reconvergence on partition heal (but mutable conflicts possible)
- Slow node: Replication lag increases for that node, doesn't affect others

**Critical gap: Delta replication.** Currently, peer replication appears to sync full lists. At scale (millions of URIs), this is O(N) per sync cycle. Delta-based replication (send only changes since last sync) would reduce this to O(changes), which is typically orders of magnitude smaller. Approaches:
- Merkle trees for efficient diff detection (like Git, IPFS)
- Vector clocks or hybrid logical clocks for causal ordering
- Anti-entropy protocols (like Dynamo's read repair)

### A.4 Handler/Listener Pattern Analysis

Services communicate via polling `immutable://inbox/{key}/topic`:

```
Client → write to immutable://inbox/{handlerKey}/request/{timestamp}
Handler → polls inbox, processes, writes to immutable://inbox/{clientKey}/response/{timestamp}
```

**Latency analysis:**
- Best case: Handler polls at interval I, message arrives just before poll → latency ≈ processing time
- Worst case: Message arrives just after poll → latency ≈ I + processing time
- Average: I/2 + processing time
- With I = 1 second: average 500ms latency floor

**Comparison with push-based alternatives:**

| Approach | Latency | Complexity | Resource Usage |
|----------|---------|------------|----------------|
| Polling (current) | ~I/2 avg | Low | High (constant requests) |
| Long polling | ~0 + processing | Medium | Medium |
| SSE (Server-Sent Events) | ~0 + processing | Medium | Low (persistent connection) |
| WebSocket push | ~0 + processing | High | Low (persistent connection) |
| WebRTC DataChannel | ~0 + processing | Very High | Low (p2p) |

**Recommendation:** Implement SSE as a complement to polling. SSE is HTTP-native, works through proxies, and provides push semantics with minimal complexity. The endpoint `GET /listen/{uri-prefix}` returning `text/event-stream` would be natural.

---

## B. Protocol Design Assessment

### B.1 Four-Operation Interface Sufficiency

The interface: `receive`, `read`, `list`, `delete`.

**Sufficiency analysis via CRUD mapping:**
- Create → `receive` (write new URI)
- Read → `read` (fetch by URI)
- Update → `receive` (overwrite mutable URI)
- Delete → `delete`
- List/Query → `list` (prefix-based enumeration)
- Subscribe → **missing** (must poll `list` repeatedly)

**Comparison with REST:**
- REST: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- b3nd: receive ≈ POST/PUT, read ≈ GET, list ≈ GET (collection), delete ≈ DELETE
- Missing: HEAD (existence check without data), conditional operations (If-Match, If-None-Match)

**Sufficiency verdict:** The 4-operation model is sufficient for data storage and retrieval. It is NOT sufficient for real-time systems without a subscription/notification mechanism. The `list` operation with cursor-based pagination provides query capability, but lacks filtering beyond prefix matching.

**Proposed addition — `subscribe(prefix, callback)`:** Would complete the model for real-time use cases. Can be implemented as SSE over HTTP or native WebSocket push. Does not require protocol changes — it's a transport-layer addition.

### B.2 URI-Based Routing vs Traditional Service Discovery

**b3nd approach:** URI encodes destination. `mutable://accounts/{pubkey}/app/settings` — the protocol, hostname, and path segments determine which node handles the request and which validator processes it.

**Traditional approaches:**
- **DNS-SD (RFC 6763):** Service discovery via DNS records. Requires DNS infrastructure.
- **mDNS (RFC 6762):** Zero-config local service discovery. LAN only.
- **DHT (Kademlia, Chord):** Distributed hash table for key→node mapping. Complex, high latency for lookups.
- **Gossip (SWIM, HyParView):** Membership and routing via epidemic protocols.

**Analysis:**

| Property | b3nd URI | DNS-SD | DHT | Gossip |
|----------|----------|--------|-----|--------|
| Human readable | Yes | Partial | No (hashes) | No |
| Decentralized | Partial* | No (DNS root) | Yes | Yes |
| Lookup latency | O(1)** | O(1) cached | O(log N) | O(log N) |
| Self-describing | Yes | No | No | No |
| NAT-friendly | Yes (HTTP) | Yes | Varies | Varies |

*Partial because clients must know at least one node's HTTP endpoint.
**O(1) assuming client knows the node to query.

**Key insight:** b3nd's URI routing is a feature, not a limitation. The human-readable, self-describing nature of URIs is a significant advantage for developer experience and debuggability. The gap is peer discovery — currently there's no way for a new node to find existing nodes without out-of-band configuration.

**Proposed: Bootstrap registry.** A well-known URI like `mutable://open/network/nodes` could serve as a peer registry. Nodes announce themselves by writing to this registry. New nodes read it to discover peers. This uses the protocol itself for discovery — elegant self-hosting.

### B.3 Message Format Efficiency

Current: JSON over HTTP.

**Overhead analysis for a typical message:**

```
HTTP request overhead: ~200-400 bytes (headers, method, path)
JSON envelope: ~50-100 bytes ({"auth":[...],"payload":{...}})
URI: ~60-120 bytes (mutable://accounts/{64-char-hex}/app/settings)
Data: variable
Total overhead per message: ~310-620 bytes minimum
```

**Comparison:**

| Format | Overhead | Human Readable | Schema Required |
|--------|----------|----------------|-----------------|
| JSON/HTTP (b3nd) | ~400 bytes | Yes | No |
| Protocol Buffers/gRPC | ~50 bytes | No | Yes (.proto) |
| MessagePack/HTTP | ~200 bytes | No | No |
| CBOR (RFC 8949) | ~150 bytes | No | No |
| Cap'n Proto | ~30 bytes | No | Yes |

**Verdict:** JSON/HTTP overhead is 5-10x higher than binary alternatives. For b3nd's use case (human-readable, debuggable, web-native), this is an acceptable tradeoff at current scale. At high throughput (>10K msg/sec), binary serialization becomes necessary.

**Recommendation:** Support content negotiation. Accept `Content-Type: application/cbor` alongside `application/json`. CBOR (RFC 8949) is the best fit: binary-efficient, schema-free, JSON-compatible data model, IETF standard.

### B.4 Consensus as Messages

Firecat's temporal consensus stores all state as messages in the same URI space:

```
immutable://pending/{hash}/{node}
immutable://attestation/{hash}/{validator}
immutable://confirmation/{hash}
immutable://consensus/{era}/{block}/{slot}/{hash}
```

**Strengths:**
- **Uniform interface:** Same 4 operations for consensus and user data. No separate consensus RPC.
- **Auditability:** All consensus state is readable, listable, inspectable.
- **Self-hosting:** The protocol bootstraps itself — consensus validates messages, and consensus state IS messages.
- **Replication for free:** Peer replication of user data also replicates consensus state.

**Risks:**
- **Circular dependency:** Consensus validates messages, but consensus writes ARE messages that need validation. The bootstrap problem: who validates the first consensus message?
  - **Mitigation:** Genesis state is hardcoded. Consensus messages are validated by their own schema (self-referential but with a fixed point).
- **Performance coupling:** Consensus metadata competes with user data for storage and bandwidth. Heavy consensus traffic could degrade user experience.
  - **Mitigation:** URI prefix partitioning — consensus URIs can be routed to dedicated storage.
- **Bloat:** Every confirmed message generates 3+ additional messages (pending, attestation(s), confirmation). With N validators, that's N+2 messages per user message.
  - **Mitigation:** Archival and pruning policies. Old attestations can be garbage collected after confirmation.

**Comparison with separation approaches:**
- **Celestia:** Separates data availability from execution. b3nd could similarly separate consensus metadata into a dedicated "namespace" while keeping the same protocol.
- **Ethereum:** Beacon chain (consensus) + execution layer — physically separated. More complex but no performance coupling.

---

## C. Performance Modeling

### C.1 Theoretical Throughput

**Single node, memory backend:**
```
Hono HTTP overhead: ~0.1ms per request
JSON parse: ~0.01ms per KB
Validation: ~0.1ms (schema lookup + validator execution)
Memory write: ~0.001ms
Total per receive: ~0.3ms
Theoretical max: ~3,000 msg/sec (single core)
```

**Single node, PostgreSQL backend:**
```
HTTP overhead: ~0.1ms
JSON parse: ~0.01ms/KB
Validation: ~0.1ms + read queries for state-checking validators
PostgreSQL write: ~2-5ms
Total per receive: ~3-6ms
Theoretical max: ~170-330 msg/sec (limited by DB writes)
Connection pooling with 10 connections: ~1,700-3,300 msg/sec
```

**Cluster (shared PostgreSQL, N frontends):**
```
Read throughput: ~N × 5,000 reads/sec
Write throughput: ~3,000 writes/sec (DB-limited, connection pool)
Bottleneck: PostgreSQL write throughput
```

**Peer-replicated (M nodes):**
```
Write throughput per node: as above
Read throughput: M × per-node read throughput
Replication bandwidth: O(new_messages × M) per sync cycle
Consensus overhead: (N_validators + 2) × messages for full confirmation
```

### C.2 Latency Model

| Operation | Memory | PostgreSQL | HTTP Proxy | Peer (eventual) |
|-----------|--------|------------|------------|-----------------|
| receive | <1ms | 3-6ms | 10-50ms + backend | 10-50ms + replication lag |
| read | <0.1ms | 1-3ms | 5-20ms + backend | 5-20ms (local replica) |
| list (100) | <1ms | 5-20ms | 20-100ms | 20-100ms (local replica) |
| delete | <0.1ms | 2-5ms | 10-50ms + backend | 10-50ms + replication lag |

### C.3 Bandwidth Model for Peer Replication

Assuming polling-based full list sync:
```
Messages in system: N
URI average length: 100 bytes
List response per page: 100 URIs × 100 bytes = 10KB
Full sync pages: N/100
Full sync bandwidth: N × 100 bytes per peer per sync cycle
Sync interval: I seconds
Bandwidth per peer: (N × 100) / I bytes/sec

At 1M messages, 10-second sync: 10MB/sec per peer — unsustainable
At 1M messages with delta sync: (ΔN × 100) / I bytes/sec
If 100 new messages/sec: 1KB/sec per peer — very sustainable
```

**Critical finding:** Delta replication is not optional — it's required for any meaningful scale. Merkle tree-based sync detection is the standard approach (used by Git, IPFS, Dynamo, Cassandra).

---

## D. Comparison with Existing Systems

### D.1 IPFS / libp2p

| Dimension | b3nd/firecat | IPFS/libp2p |
|-----------|-------------|-------------|
| Addressing | URI (human-readable) | CID (content hash) |
| Mutability | Native (mutable://) | IPNS (slow, unreliable) |
| Discovery | Manual/bootstrap | DHT (Kademlia) |
| Transport | HTTP/WebSocket | QUIC, TCP, WebSocket, WebRTC |
| NAT traversal | None | libp2p AutoNAT, relay, hole-punching |
| Storage incentive | Fee conservation | Filecoin (separate network) |
| Encryption | Client-side (Ed25519/X25519) | Optional (libp2p-noise, TLS) |
| Query | Prefix-based list | None (external indexer needed) |

**Key lessons from IPFS for b3nd:**
1. **Content addressing works.** b3nd's `hash://sha256` is equivalent to IPFS CIDs. Consider supporting CID format for interoperability.
2. **Mutable naming is hard.** IPNS has been IPFS's persistent weakness. b3nd's `mutable://` with owner-signed updates is a cleaner solution.
3. **DHT is fragile.** Kademlia DHT suffers from churn, eclipse attacks, and high latency. b3nd's simpler bootstrap-registry approach may be more robust.
4. **NAT traversal is essential.** libp2p invested heavily in AutoNAT, relay nodes, and DCUTR (hole punching). b3nd must solve this for residential DePIN.

### D.2 ActivityPub / AT Protocol (Bluesky)

| Dimension | b3nd/firecat | ActivityPub | AT Protocol |
|-----------|-------------|-------------|-------------|
| Identity | Ed25519 pubkey | @user@server URL | DID + handle |
| Data ownership | User holds keys | Server holds data | PDS holds data (portable) |
| Federation | Peer replication | Server-to-server HTTP | Relay + AppView |
| Protocol | 4 operations on URIs | JSON-LD activity types | Lexicon schemas |
| Encryption | Client-side default | None standard | None standard |
| Content moderation | Validator schemas | Server-level | Labeling services |

**Key lessons:**
1. **AT Protocol's PDS (Personal Data Server)** is conceptually similar to a b3nd node that stores one user's data. The "bring your own PDS" model is validated.
2. **Relay/AppView separation** in AT Protocol is similar to b3nd's node/handler separation. AT Protocol learned that global indexing is necessary for search — b3nd's `list` with prefix matching is more limited.
3. **ActivityPub's failure mode:** Server operators hold the power. Users can't move without losing followers. b3nd avoids this with key-based identity.

### D.3 NATS / Kafka

| Dimension | b3nd | NATS | Kafka |
|-----------|------|------|-------|
| Pattern | Request-response + polling | Pub/sub + request-reply | Pub/sub + stream |
| Delivery | At-most-once (poll) | At-most-once / at-least-once | Exactly-once (with transactions) |
| Persistence | Backend-dependent | JetStream (optional) | Log-based (always) |
| Ordering | Timestamp-based | Per-subject | Per-partition |
| Scalability | Node-bounded | Cluster (millions msg/sec) | Cluster (millions msg/sec) |
| Use case | Decentralized data | Microservices messaging | Event streaming |

**Key lesson:** b3nd is NOT a message queue — it's a data store with message semantics. The inbox/handler pattern creates message queue-like behavior, but without delivery guarantees (no ack, no retry, no dead letter queue). For critical workflows, b3nd should consider adding:
- **Acknowledgment:** Handler writes receipt to confirm processing
- **Retry:** Unacknowledged messages re-queued after timeout
- **Ordering:** Guaranteed processing order within a topic

### D.4 Tor / I2P

| Dimension | b3nd | Tor | I2P |
|-----------|------|-----|-----|
| Privacy goal | Data encryption | Transport anonymity | Network anonymity |
| Metadata protection | Limited (URI visible) | Onion routing (3 hops) | Garlic routing |
| Threat model | Passive eavesdropper | Global passive adversary | Global passive adversary |
| Performance | HTTP-native (~ms) | High latency (~seconds) | High latency (~seconds) |

**Key insight:** b3nd and Tor/I2P solve different problems. b3nd encrypts data; Tor/I2P hide who's communicating. They are complementary:
- **b3nd over Tor:** Nodes accessible as onion services. Provides both data privacy AND transport anonymity. Latency penalty is significant but acceptable for non-real-time data.
- **Tor-style onion routing in b3nd:** Multi-hop message relay where each node only knows the next hop. Would require relay nodes and circuit establishment — significant complexity.

**Recommendation:** Support Tor onion service endpoints as a deployment option. Don't reinvent onion routing — integrate with existing Tor infrastructure.

---

## E. DePIN-Specific Network Challenges

### E.1 NAT Traversal

**The problem:** ~70% of residential internet connections are behind NAT (RFC 3022). DePIN requires residential nodes to be reachable.

**Solutions (in order of preference):**

1. **UPnP/NAT-PMP (RFC 6886):** Automatic port mapping. Works on ~60% of home routers. Simple to implement.
2. **STUN (RFC 5389):** Discovers public IP and port. Works for UDP (not TCP/HTTP directly).
3. **TURN (RFC 5766):** Relay server for when direct connection fails. Always works but requires relay infrastructure.
4. **ICE (RFC 8445):** Framework combining STUN + TURN. Standard approach for WebRTC.
5. **TCP hole punching:** Works ~60% of the time. Requires coordination server.
6. **libp2p AutoRelay + DCUTR:** Automatic relay with direct connection upgrade. Production-tested in IPFS.

**Recommendation for b3nd:**
- Phase 1: Support UPnP for automatic port mapping (covers majority of home networks)
- Phase 2: Implement relay nodes (TURN-like) for nodes behind strict NAT
- Phase 3: Integrate libp2p for full NAT traversal stack

### E.2 Heterogeneous Node Capabilities

DePIN nodes range from Raspberry Pis to cloud VMs:

| Node Type | Storage | Bandwidth | Uptime | Latency |
|-----------|---------|-----------|--------|---------|
| Raspberry Pi 4 | 32-256GB SD | 100Mbps LAN | Variable | 1-10ms local |
| Old laptop | 256GB-1TB SSD | 50-200Mbps | Variable | 1-10ms local |
| Home server | 1-10TB HDD/SSD | 100Mbps-1Gbps | 95%+ | 1-10ms local |
| Cloud VM (small) | 20-100GB SSD | 1-10Gbps | 99.9%+ | <1ms |
| Cloud VM (large) | 1-10TB SSD | 10-25Gbps | 99.99%+ | <1ms |
| Mobile phone | 1-10GB available | Variable (4G/5G) | <50% | 10-100ms |

**Challenge:** Assigning work proportional to capability. A Raspberry Pi shouldn't be expected to store the same volume as a cloud VM.

**Approach: Capability advertisement.** Nodes declare their capabilities in their health endpoint:
```json
{
  "storage_available_gb": 100,
  "bandwidth_mbps": 200,
  "uptime_target": 0.95,
  "geographic_region": "eu-west",
  "node_type": "residential"
}
```

Clients and confirmers use this to route data appropriately.

### E.3 Censorship Resistance

**Threat levels:**

1. **Application-level blocking:** DNS blocking of firecat domains.
   - **Mitigation:** IP-direct access, alternative DNS (DoH/DoT), ENS/HNS domains

2. **IP-level blocking:** ISP blocks known node IPs.
   - **Mitigation:** Tor onion services, domain fronting (CDN-based), Snowflake-style pluggable transports

3. **Protocol-level DPI:** Deep packet inspection identifies b3nd traffic.
   - **Mitigation:** TLS (looks like normal HTTPS), obfuscation (meek, obfs4)

4. **Complete internet shutdown:** Government shuts down internet.
   - **Mitigation:** Mesh networking (limited), satellite (Starlink), sneakernet

**Recommendation:** b3nd's HTTP-native design is an advantage — b3nd traffic over HTTPS is indistinguishable from normal web traffic. This is better than custom protocols (like BitTorrent or IPFS) that have identifiable traffic patterns.

### E.4 Geographic Distribution & Data Sovereignty

**Challenge:** GDPR (EU), LGPD (Brazil), PIPL (China) require data to stay in specific jurisdictions.

**b3nd advantage:** User-owned, client-side encrypted data arguably doesn't fall under the same data processing regulations as platform-held data. If the node operator never sees plaintext, are they a "data processor" under GDPR?

**Open question for legal research:** Does operating a b3nd node that stores encrypted data you can't read make you a data processor under GDPR Article 4(8)?

**Technical approach:** Geographic tagging in URIs or node metadata. Users can specify preferred storage regions. Validators enforce geographic constraints.

---

## F. Contrarian & Rising Trends

### F.1 Challenge: Is HTTP Sufficient?

**Orthodox view:** HTTP is universal, well-understood, works through firewalls and proxies. Good enough.

**Contrarian view:** HTTP adds 300-600 bytes of overhead per request. For a system targeting millions of messages per second across thousands of nodes, this overhead is significant. A custom binary protocol over QUIC could reduce per-message overhead by 10x.

**Analysis:** At b3nd's current scale (hundreds to thousands of msg/sec), HTTP is fine. At Kafka-scale (millions msg/sec), it's not. The question is: what's the growth trajectory?

**Recommendation:** Start with HTTP (already done). Add QUIC/WebTransport as an alternative transport when throughput demands it. The transport abstraction in b3nd's architecture makes this feasible without protocol changes.

### F.2 Challenge: Polling is Fundamentally Limited

**Orthodox view:** Polling is simple, stateless, works everywhere. Set interval to 1 second and you have ~500ms average latency.

**Contrarian view:** Polling wastes bandwidth (empty responses), adds latency (up to interval), and doesn't scale (N pollers × M topics = N×M requests per interval). Any real-time application (chat, collaboration, live data) needs push.

**Analysis:** Both views are correct. Polling is appropriate for:
- Background sync (peer replication)
- Batch processing (handler pattern for non-real-time work)
- Simple clients (curl, scripts)

Push is necessary for:
- Chat and messaging
- Live collaboration
- IoT telemetry
- Real-time dashboards

**Recommendation:** Implement SSE (Server-Sent Events) as the push mechanism. It's HTTP-native, works through proxies, doesn't require new infrastructure, and maps naturally to b3nd's model: `GET /subscribe/mutable://accounts/{key}/*` → event stream of changes.

### F.3 Explore: WebTransport

WebTransport (W3C/IETF) provides:
- HTTP/3 (QUIC) based — encrypted, multiplexed, 0-RTT
- Bidirectional streams (like WebSocket but over QUIC)
- Unreliable datagrams (UDP-like, for latency-sensitive data)
- Works in browsers (Chrome 97+, Firefox 114+, Safari 17.4+)

**Relevance to b3nd:**
- Could replace both HTTP and WebSocket transports with a single protocol
- QUIC's connection migration handles mobile network changes
- 0-RTT resumption reduces latency for reconnecting nodes
- Multiplexed streams allow concurrent operations without head-of-line blocking

**Timeline:** WebTransport is still maturing. Hono doesn't support it yet. Deno has experimental support. Worth prototyping but not production-ready for b3nd's use case until 2027.

### F.4 Explore: Mesh Networking

**Local-first b3nd:** Nodes on the same LAN discover each other via mDNS and replicate directly over WiFi/Ethernet. No internet required.

**Use cases:**
- Community networks in areas with poor internet
- Conference/event local networks
- Disaster recovery (internet down but local network works)
- Privacy-sensitive deployments (data never leaves the building)

**Technologies:**
- mDNS (RFC 6762) for zero-config discovery
- WiFi Direct for device-to-device without router
- Bluetooth Low Energy for IoT nodes
- LoRa for long-range, low-bandwidth rural networks

**Recommendation:** Implement mDNS-based local peer discovery as a low-effort, high-impact feature. It enables b3nd to work in disconnected or local-first scenarios.

### F.5 Contrarian: Centralized Relays May Be Necessary

**Pure decentralization view:** Every node is equal, no central infrastructure, fully peer-to-peer.

**Pragmatic view:** Signal uses centralized relay servers and serves hundreds of millions of users with excellent privacy. Tor uses a centralized directory authority. Even Bitcoin has DNS seeds.

**For b3nd:**
- Bootstrap nodes (well-known, reliable) help new nodes join the network
- Relay nodes (TURN-like) enable connectivity for nodes behind strict NAT
- Index nodes could provide global search capability that pure prefix-matching can't

**The key principle:** Centralized components for infrastructure (discovery, relay, index) that don't hold user data or keys. The data and identity remain decentralized; the plumbing can be pragmatically centralized.

### F.6 Rising: Satellite Internet and Global DePIN

Starlink, Project Kuiper, and OneWeb are creating global broadband coverage. Implications:
- DePIN nodes in remote areas become viable
- Latency: ~20-40ms (LEO) — acceptable for b3nd operations
- Bandwidth: 50-200Mbps — sufficient for node operation
- Coverage: Global, including areas without terrestrial infrastructure

**Opportunity:** b3nd could target underserved regions where traditional platforms have poor infrastructure, offering an alternative that runs on satellite internet + local storage.

---

## G. Experimentation Lines

### Experiment 1: Transport Overhead Benchmark
**Hypothesis:** JSON/HTTP adds >5x overhead compared to CBOR/QUIC for typical b3nd messages.
**Methodology:** Implement CBOR serialization + QUIC transport. Benchmark 10K messages of varying sizes (100B, 1KB, 10KB, 100KB). Measure throughput, latency, and bandwidth.
**Expected outcome:** Binary format shows 3-8x improvement for small messages, diminishing returns for large payloads.
**Tools:** Deno QUIC API, cbor-x library, custom benchmark harness.

### Experiment 2: Polling vs SSE Latency and Bandwidth
**Hypothesis:** SSE reduces average message delivery latency by >10x and bandwidth by >5x compared to polling.
**Methodology:** Implement SSE endpoint on b3nd node. Compare: (a) 1-second polling, (b) 5-second polling, (c) SSE push for 1000 messages over 10 minutes. Measure latency distribution and total bandwidth.
**Expected outcome:** SSE provides near-zero latency with ~90% less bandwidth than 1-second polling.

### Experiment 3: Merkle Tree Delta Replication
**Hypothesis:** Merkle tree-based sync reduces replication bandwidth by >100x compared to full list sync at scale.
**Methodology:** Implement Merkle tree over URI space. Simulate two nodes with 1M shared messages and 100 new messages/sec. Compare full sync vs Merkle diff bandwidth.
**Expected outcome:** Merkle sync transfers only ~10KB per cycle vs ~100MB for full sync.

### Experiment 4: NAT Traversal Success Rate
**Hypothesis:** UPnP + STUN achieves >70% connectivity for residential nodes without relay servers.
**Methodology:** Deploy test nodes on 50 residential connections across ISPs. Attempt direct connectivity via UPnP, then STUN, then TURN relay. Record success rate at each stage.
**Expected outcome:** UPnP works for ~60%, STUN adds ~15%, remaining ~25% need relay.

### Experiment 5: Consensus Metadata Storage Overhead
**Hypothesis:** Temporal consensus generates >3x storage overhead relative to user data.
**Methodology:** Simulate 10,000 user messages through full consensus (5 validators). Measure total storage: user messages + pending + attestations + confirmations + slots.
**Expected outcome:** With 5 validators: 7x overhead (1 pending + 5 attestations + 1 confirmation per message). With pruning: reducible to ~2x.

### Experiment 6: Geographic Latency Mapping
**Hypothesis:** b3nd read latency stays under 200ms for 95th percentile with globally distributed nodes.
**Methodology:** Deploy nodes in 5 regions (US-East, EU-West, Asia-Pacific, South America, Africa). Measure read/write latency from each region to all others. Map the latency topology.
**Expected outcome:** Intra-region <50ms, cross-continent 100-300ms. Africa/South America may exceed 200ms to Asia.

### Experiment 7: Handler Pattern Throughput Ceiling
**Hypothesis:** The poll-based handler pattern saturates at <500 msg/sec per handler due to HTTP overhead.
**Methodology:** Deploy a handler that processes messages from inbox. Increase message arrival rate from 10 to 1000 msg/sec. Measure processing throughput, latency, and error rate.
**Expected outcome:** Saturation around 200-500 msg/sec depending on processing complexity. Batch processing (multiple messages per poll) improves ceiling.

### Experiment 8: mDNS Local Discovery Prototype
**Hypothesis:** Zero-config local peer discovery via mDNS can be implemented in <200 lines and enables LAN-first b3nd clusters.
**Methodology:** Implement mDNS service advertisement (`_b3nd._tcp.local`) and discovery. Two nodes on same LAN should auto-discover and begin replication within 5 seconds.
**Expected outcome:** Working prototype in <200 lines. Discovery time <3 seconds on typical LAN.

### Experiment 9: Load Testing Under Network Partition
**Hypothesis:** Peer-replicated b3nd nodes maintain availability during network partitions and reconcile correctly after partition heals.
**Methodology:** Set up 3 peer-replicated nodes. Partition into [A] and [B,C]. Write different data to each partition. Heal partition. Verify all data present on all nodes. Check for conflicts on mutable URIs.
**Expected outcome:** Immutable data reconciles perfectly. Mutable data has last-write-wins conflicts. No data loss.

### Experiment 10: WebTransport Prototype
**Hypothesis:** WebTransport can serve as a drop-in replacement for HTTP+WebSocket with lower latency and better multiplexing.
**Methodology:** Implement b3nd node transport using Deno's QUIC/WebTransport API. Run the standard test suite. Benchmark against HTTP transport.
**Expected outcome:** 20-40% latency improvement for small messages. Better behavior under concurrent operations due to no head-of-line blocking.

---

## Summary of Critical Findings

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| No delta replication | Critical | Implement Merkle tree-based sync |
| No push/subscribe mechanism | High | Add SSE endpoints |
| No NAT traversal | High | Implement UPnP + relay nodes |
| No peer discovery | High | Bootstrap registry + mDNS for local |
| Consensus storage overhead | Medium | Implement attestation pruning |
| JSON/HTTP overhead | Medium | Add CBOR content negotiation |
| No delivery guarantees for inbox | Medium | Add ack + retry pattern |
| No capability advertisement | Low | Extend health endpoint |
| No geographic routing | Low | Add region metadata |
| WebTransport readiness | Low | Prototype, wait for ecosystem maturity |

---

## References

- RFC 3022 — Network Address Translation (NAT)
- RFC 5389 — STUN: Session Traversal Utilities for NAT
- RFC 5766 — TURN: Traversal Using Relays around NAT
- RFC 6762 — Multicast DNS (mDNS)
- RFC 6763 — DNS-Based Service Discovery
- RFC 8445 — ICE: Interactive Connectivity Establishment
- RFC 8949 — CBOR: Concise Binary Object Representation
- RFC 9000 — QUIC: A UDP-Based Multiplexed Transport
- RFC 9114 — HTTP/3
- W3C WebTransport specification
- Maymounkov & Mazières, "Kademlia: A Peer-to-peer Information System Based on the XOR Metric" (2002)
- DeCandia et al., "Dynamo: Amazon's Highly Available Key-value Store" (2007)
- Kleppmann, "Designing Data-Intensive Applications" — Chapter 5: Replication (2017)
- libp2p specifications: AutoNAT, Relay, DCUTR (2022)
- AT Protocol specification: https://atproto.com/specs
- ActivityPub W3C Recommendation (2018)

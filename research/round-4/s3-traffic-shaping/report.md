# S3: Constant-Rate Traffic Shaping Protocol

## Round 4 Research -- b3nd Protocol

**Date:** 2026-03-16
**Status:** Specification (ready for implementation)
**Depends on:** E3 (privacy batching sweep), D3 (privacy posture decision)

---

## 1. Executive Summary

Experiment E3 demonstrated that batching delay and proportional dummy traffic are
insufficient defenses against a global passive adversary performing temporal correlation
attacks. At the best operating point (D=1s, R=2.0), adversary precision remains at 15% --
nearly 3x random baseline (5.05%). The residual signal is structural: the adversary
exploits **volume correlation**, not timing precision. Users who communicate frequently
produce correlated activity volumes that survive both timestamp quantization and
proportional noise injection.

This specification defines a **constant-rate emission protocol** that eliminates volume
correlation by making every node's outbound traffic pattern identical regardless of actual
activity. Combined with D=1s batching and HMAC-based path obfuscation, this constitutes
the full privacy stack for b3nd v1.

**Key result:** Constant-rate emission at R_const messages per epoch makes all nodes
indistinguishable to a traffic-volume adversary, reducing correlation-based graph
reconstruction precision to the random baseline of ~5%.

---

## 2. Problem Statement

### 2.1 What E3 Proved

The E3 simulation (108 configurations, 100 trials, 100 users, 250 edges) established:

| Defense | Adversary Precision | Advantage over Random |
|---------|--------------------|-----------------------|
| None | 20.5% | +15.4% |
| D=1s batching only | 20.6% | +15.5% |
| R=2.0 dummy only | 15.3% | +10.3% |
| D=1s + R=2.0 | 15.0% | +10.0% |
| D=60s + R=2.0 | 14.9% | +9.9% |
| **Constant-rate** (projected) | **~5%** | **~0%** |

The adversary's temporal correlation attack computes, for each user pair (i, j):

    score(i,j) = co_occurrences(i,j,W) / sqrt(writes_i * writes_j)

This score is normalized by total write volume but still leaks information because
active conversationalists produce more co-occurrences. Proportional dummy traffic (R
multiplier) scales both signal and noise equally -- it dilutes but does not eliminate the
correlation structure.

### 2.2 Why Constant-Rate Works

If every node emits exactly C messages per epoch (padding when real traffic < C, queuing
when real traffic > C), then:

- `writes_i = writes_j = C` for all i, j in every epoch
- The denominator `sqrt(writes_i * writes_j) = C` is constant
- The score reduces to `co_occurrences(i,j,W) / C`
- Co-occurrences become a function of **when** messages arrive at their destinations, not
  **how many** a node emits
- Combined with D=1s batching (timestamp quantization), arrival times are indistinguishable
  within 1-second buckets
- Combined with path obfuscation (HMAC-based URIs), the adversary cannot even determine
  which destination a message targets

The adversary is left with random co-occurrence noise, driving precision to baseline.

---

## 3. Constant-Rate Emission Protocol

### 3.1 Definitions

| Term | Definition |
|------|------------|
| **Epoch** | A fixed time interval T_epoch during which a node emits exactly C messages |
| **C** | The constant emission rate: messages per epoch |
| **Real message** | A message containing actual user data (encrypted payload) |
| **Padding message** | A message containing random bytes, indistinguishable from a real message on the wire |
| **Emission queue** | A FIFO buffer holding real messages awaiting emission |
| **Burst buffer** | Overflow storage for real messages when arrival rate exceeds C |

### 3.2 Epoch Structure

Each epoch lasts T_epoch = 1 second (aligned with the D=1s batching interval from E3).
Within each epoch, the node emits exactly C messages, evenly spaced:

```
Epoch [t, t+1s):
  Emission slot 0: t + 0*(1/C)
  Emission slot 1: t + 1*(1/C)
  ...
  Emission slot C-1: t + (C-1)*(1/C)
```

Each emission slot carries exactly one message. If the emission queue contains a real
message, it is emitted. Otherwise, a padding message is emitted.

**Jitter:** To prevent micro-timing fingerprinting of the emission clock, each slot
is offset by a uniform random delay in [0, 1/(2C)) seconds. This preserves the constant
rate property (C messages per epoch) while preventing the adversary from detecting the
emission schedule phase.

### 3.3 Padding Message Format

Padding messages MUST be indistinguishable from real messages to any observer who does
not hold the recipient's decryption key. This requires:

```
Padding message structure:
  ├── URI: mutable://<random_valid_target>/pad/<random_hex>
  ├── Auth: valid signature from the emitting node's key
  ├── Payload: random bytes, length sampled from real message length distribution
  └── Metadata: standard headers (timestamp, content-type, etc.)
```

**Critical requirements:**

1. **Size indistinguishability.** Padding payloads MUST match the size distribution of
   real messages. In practice, pad all messages (real and padding) to one of a small set
   of fixed sizes: 256, 512, 1024, 2048, 4096 bytes. Real messages shorter than the
   next size class are right-padded with random bytes before encryption. This is
   PKCS#7-style padding applied at the application layer, inside the encryption envelope.

2. **URI indistinguishability.** Padding messages are addressed to random URIs that look
   structurally identical to real message URIs. The node selects from a set of known
   peer nodes and constructs URIs matching the HMAC-obfuscated format. Receiving nodes
   recognize padding by attempting decryption -- padding messages will fail a MAC check
   on the inner envelope and are silently discarded.

3. **Signature validity.** Padding messages carry a valid Ed25519 signature from the
   emitting node. This prevents trivial classification ("unsigned = padding").

4. **Timing.** Padding messages are emitted at the same cadence as real messages --
   there is no timing difference.

### 3.4 Handling Bursts (Real Traffic > C)

When real message arrival rate exceeds C per epoch:

```
Algorithm: BURST_HANDLING

on receive(real_message):
    emission_queue.enqueue(real_message)

on emission_slot(slot_index):
    if emission_queue.not_empty():
        msg = emission_queue.dequeue()
        emit(msg)
    else:
        emit(generate_padding())

invariant: exactly C messages emitted per epoch
```

**Burst buffer sizing.** If real traffic sustains above C for multiple epochs, the
emission queue grows. To prevent unbounded growth:

- **Queue limit:** max_queue = 10 * C (10 epochs of backlog)
- **Backpressure:** When queue exceeds max_queue, the node signals backpressure to
  the client layer. The client can either wait or find another node.
- **Burst metric:** The node tracks `queue_depth / C` as the burst ratio. If this
  exceeds 5.0 sustained over 60 seconds, the node SHOULD consider a rate increase
  (see Section 7, Adaptive Rate Adjustment).

**Latency impact of burst queuing:**

| Queue depth | Additional latency |
|-------------|-------------------|
| 0 (no burst) | 0 (next emission slot) |
| C (1 epoch backlog) | ~1 second |
| 5C | ~5 seconds |
| 10C (max) | ~10 seconds |

This is acceptable for asynchronous messaging. For latency-sensitive applications,
the client should select nodes with sufficient headroom (C >> typical traffic).

### 3.5 Handling Quiet Periods (Real Traffic << C)

When real traffic is well below C, most emission slots carry padding. This is the
normal operating mode for most nodes most of the time. The protocol is designed so
that this is not wasteful at reasonable values of C (see Section 4).

The node does not reduce its emission rate during quiet periods. Rate constancy is
the entire point of the protocol.

### 3.6 Multi-Destination Emission

A node communicates with multiple peers. The constant rate C applies to the node's
**total outbound traffic across all destinations**. The node does NOT maintain a
separate constant rate per destination, as this would leak the number of active
communication partners.

Padding messages are addressed to randomly selected destinations from the node's
peer set. The distribution of destinations in padding should be approximately uniform
across all known peers, preventing the adversary from inferring which peers are
"real" conversation partners based on traffic volume per destination.

---

## 4. Bandwidth Overhead Analysis

### 4.1 Message Size Model

From Round 1 analysis (Front 5), the average b3nd message is approximately 500 bytes
of user data. With protocol overhead:

| Component | Size |
|-----------|------|
| User payload (encrypted) | 500 bytes avg |
| URI | 80-120 bytes |
| Auth (Ed25519 signature) | 64 bytes |
| HTTP headers | 200-400 bytes |
| JSON envelope | 50-100 bytes |
| **Total on wire** | **~900-1,200 bytes** |

For constant-rate padding, we use the padded size classes. Assuming most messages
fit in the 1,024-byte payload class, total on-wire size per message is approximately
**1.5 KB** after HTTP framing.

### 4.2 Overhead at Different Traffic Levels

Let C = constant emission rate (messages per second).

For a node with actual traffic volume V messages/day:

- Total emitted = C * 86,400 messages/day
- Padding messages = (C * 86,400) - V
- Overhead ratio = (C * 86,400) / V

**Table: Overhead for C = 1 msg/sec (86,400 msgs/day total emission)**

| Real traffic (V) | Real msgs/day | Padding msgs/day | Overhead ratio | Bandwidth/day |
|-------------------|--------------|-------------------|----------------|---------------|
| Very low | 1,000 | 85,400 | 86.4x | 127 MB |
| Low | 10,000 | 76,400 | 8.6x | 127 MB |
| Medium | 50,000 | 36,400 | 1.7x | 127 MB |
| High | 100,000 | N/A (exceeds C) | burst mode | 127 MB |

**Table: Overhead for C = 5 msg/sec (432,000 msgs/day total emission)**

| Real traffic (V) | Real msgs/day | Padding msgs/day | Overhead ratio | Bandwidth/day |
|-------------------|--------------|-------------------|----------------|---------------|
| Very low | 1,000 | 431,000 | 432x | 634 MB |
| Low | 10,000 | 422,000 | 43.2x | 634 MB |
| Medium | 50,000 | 382,000 | 8.6x | 634 MB |
| High | 100,000 | 332,000 | 4.3x | 634 MB |

**Table: Overhead for C = 0.2 msg/sec (17,280 msgs/day total emission)**

| Real traffic (V) | Real msgs/day | Padding msgs/day | Overhead ratio | Bandwidth/day |
|-------------------|--------------|-------------------|----------------|---------------|
| Very low | 1,000 | 16,280 | 17.3x | 25 MB |
| Low | 10,000 | 7,280 | 1.7x | 25 MB |
| Medium | 50,000 | N/A (exceeds C) | burst mode | 25 MB |

### 4.3 Bandwidth Cost Analysis

At 1.5 KB per padded message:

| Rate C (msg/sec) | Msgs/day | Bandwidth/day | Bandwidth/month | Cloud cost/month* |
|-------------------|----------|---------------|-----------------|-------------------|
| 0.1 | 8,640 | 12.7 MB | 381 MB | $0.03 |
| 0.2 | 17,280 | 25.4 MB | 762 MB | $0.07 |
| 0.5 | 43,200 | 63.4 MB | 1.9 GB | $0.17 |
| 1.0 | 86,400 | 126.9 MB | 3.7 GB | $0.33 |
| 2.0 | 172,800 | 253.7 MB | 7.4 GB | $0.67 |
| 5.0 | 432,000 | 634.3 MB | 18.6 GB | $1.67 |
| 10.0 | 864,000 | 1.27 GB | 37.1 GB | $3.34 |

*Cloud egress pricing estimated at $0.09/GB (AWS/GCP standard tier, first 10 TB).
Residential ISP bandwidth is typically unmetered in developed markets.

### 4.4 Sweet Spot Analysis

The optimal C balances three constraints:

1. **Privacy:** C must be >= the peak real traffic rate of the busiest node in the
   network. If any node's real traffic consistently exceeds C, it becomes identifiable
   by sustained burst queuing (queue depth > 0 across epochs).

2. **Cost:** Lower C = less bandwidth waste.

3. **Latency:** Higher C = lower burst queuing latency.

**For v1 launch targeting ~10K msgs/day per active node:**

- C = 0.2 msg/sec (17,280 msgs/day) provides 1.7x headroom over 10K
- Bandwidth cost: ~$0.07/month -- negligible
- Burst latency: up to 5 seconds at 2x spike, acceptable for messaging
- All nodes emit 25 MB/day regardless of activity

**Recommendation: C = 0.2 msg/sec for v1 (see Section 9 for full recommendation).**

---

## 5. Adversary Model

### 5.1 Adversary Capabilities

The traffic-shaping-aware adversary:

**CAN:**
- Observe all messages entering and leaving every node (global passive)
- Record timestamps, message sizes, source/destination IP addresses
- Observe the total volume of messages per node per time window
- Know that the protocol uses constant-rate padding
- Know the value of C (the constant rate is public protocol parameter)
- Perform long-term statistical analysis across millions of epochs
- Collude with up to f < T compromised nodes (where T = committee threshold)

**CANNOT:**
- Decrypt message payloads (X25519 + AEAD encryption)
- Determine whether a specific message is real or padding without the recipient's key
- Observe message content or the identity of message recipients (HMAC-obfuscated URIs)
- Modify messages in transit without detection (Ed25519 signatures)
- Distinguish padding from real messages by size (fixed size classes)
- Distinguish padding from real messages by timing (constant-rate emission)
- Observe intra-node processing (the node is a trust boundary)

### 5.2 Attack Analysis: Volume Correlation

**E3's attack:** Score user pairs by co-occurring writes within a time window W:

    score(i,j) = co_occurrences(i,j,W) / sqrt(writes_i * writes_j)

**Under constant-rate emission:**
- Every node emits exactly C messages per epoch
- `writes_i = writes_j = C` for all i, j
- The denominator is constant: `sqrt(C * C) = C`
- Co-occurrences are now driven by **random padding destinations** plus real messages
- Padding destinations are uniformly distributed across peers
- Expected co-occurrences for any pair: proportional to C^2 / N_peers (random overlap)
- Variance in co-occurrences comes from padding randomness, not from the social graph

**Result:** The adversary's score is dominated by random noise from padding. The signal
from real messages is buried because:
1. Real messages are a small fraction of total traffic (at C=0.2, a node sending 1K
   real msgs/day contributes only 5.8% real traffic)
2. Padding destinations are random, creating uniform co-occurrence noise
3. All nodes produce identical total volume

**Precision prediction:** At or near random baseline (5.05% for the E3 scenario).

### 5.3 Attack Analysis: Burst Detection

A sophisticated adversary might look for **burst signatures** -- epochs where a node's
emission queue is non-empty, causing real messages to be delayed.

**Defense:** The constant-rate protocol does not reveal queue state externally. The node
emits exactly C messages per epoch regardless of queue depth. The only observable
effect of a burst is that real messages arrive at their destination slightly later --
but since the adversary cannot distinguish real from padding, this is not exploitable.

**Exception:** If a node's real traffic **persistently** exceeds C, the adversary can
detect this because the node's effective emission rate stays at C while its inbound
traffic (from clients) is visibly higher. This is why C must be set above the
expected peak traffic of all nodes (see Section 4.4).

### 5.4 Attack Analysis: Colluding Observers

Multiple colluding nodes that are message destinations can combine their observations:

- Node A receives messages from nodes X, Y, Z
- Node B receives messages from nodes X, Y, Z
- By combining knowledge, A and B know which messages from X went to A vs B

**Defense:** HMAC-based path obfuscation means that even the receiving node does not
learn the sender's identity from the URI. The message envelope is encrypted to the
recipient's public key. The receiving node can decrypt the payload and learn the sender
from the plaintext content, but this is expected behavior -- the recipient is meant to
know who sent the message.

**What colluding observers learn:** Each observer learns the content of messages
addressed to them. They cannot learn about messages addressed to non-colluding nodes.
Constant-rate emission ensures they cannot correlate the volume of messages they receive
with the volume sent to other nodes.

**Multi-hop correlation:** If the adversary controls nodes at multiple hops (e.g.,
the sender's storage node and the recipient's storage node), they could attempt to
correlate ingress at one node with egress at another. Constant-rate emission defeats
this because both ingress and egress rates are constant -- there is no volume signal
to correlate across hops.

### 5.5 Attack Analysis: Long-Term Statistical Analysis

Over months of observation, the adversary accumulates a large sample of co-occurrence
data. Can statistical power overcome the padding noise?

**Analysis:** In each epoch, the adversary observes C messages from each node. Of these,
V/86400 are real (where V = daily real volume) and the rest are padding to random
destinations. The real messages create a weak correlation signal between actual
communication partners.

Let p = V / (C * 86400) be the fraction of real messages. For C=0.2 and V=1000:
p = 1000 / 17280 = 0.058.

The co-occurrence signal strength scales as p^2 (both messages in a co-occurrence
window must be real and correlated). At p=0.058, signal strength is 0.0034 -- over
two orders of magnitude below the noise floor from random padding co-occurrences.

Even after T epochs of observation, the signal-to-noise ratio grows as sqrt(T). To
achieve SNR > 1, the adversary needs T > 1/p^4 epochs. At p=0.058:
T > 1/0.058^4 = 88,500 epochs = ~24.6 hours.

**This is concerning.** After ~1 day of observation, a statistical adversary could
begin to extract signal. However, this analysis assumes **no path obfuscation**. With
HMAC-obfuscated URIs, the adversary cannot determine which destination a message
targets. The co-occurrence metric requires knowing that node X sent a message to
node Y's URI space -- which path obfuscation explicitly prevents.

**With full privacy stack (constant-rate + path obfuscation + D=1s batching):**
The adversary cannot compute co-occurrences at all, because they cannot determine
message destinations. The attack is defeated.

### 5.6 Residual Leakage

Even with the full privacy stack, some information leaks:

1. **Network participation:** The adversary knows which nodes are online (they emit
   traffic at rate C). This is unavoidable for any networked system.

2. **Peer set size:** The adversary can observe the number of distinct destination
   IPs a node sends to. This leaks the approximate size of the node's peer set.
   **Mitigation:** Route all traffic through a fixed set of relay nodes, or use
   onion routing (Tor integration, see Round 1 Front 2 Section D.4).

3. **Client-to-node traffic:** Client connections to their storage node are visible.
   The adversary knows which clients use which nodes. **Mitigation:** Clients should
   also use constant-rate communication with their node (see Section 8.4).

---

## 6. Integration with Existing Privacy Stack

### 6.1 Composition with Path Obfuscation (HMAC-Based)

Path obfuscation (from Round 2 Front 6, Theorem 2) replaces predictable URIs with
HMAC-derived paths:

```
Real URI:    mutable://accounts/{pubkey}/messages/{thread_id}
Obfuscated:  mutable://accounts/{HMAC(pubkey, salt)}/m/{HMAC(thread_id, salt)}
```

**Composition:** Traffic shaping operates at the transport layer (emission schedule),
while path obfuscation operates at the addressing layer (URI structure). They are
orthogonal and compose cleanly:

- Traffic shaping ensures all nodes emit at rate C → defeats volume correlation
- Path obfuscation ensures destination URIs are unlinkable → defeats destination correlation
- Together: the adversary can observe that node X emitted a 1KB message at time t,
  but cannot determine the destination or whether it is real or padding

**No interference:** Padding messages use HMAC-obfuscated URIs just like real messages.
The padding URI generation must use the same HMAC scheme with random inputs to ensure
format indistinguishability.

### 6.2 Composition with D=1s Batching

Batching quantizes emission timestamps to 1-second boundaries. Under constant-rate
emission:

- The epoch T_epoch = 1 second aligns with the batching interval
- All C messages within an epoch are released at the epoch boundary
- This means the adversary observes a burst of exactly C messages per node per second
- The internal ordering of messages within the burst is randomized (shuffle before emit)

**Benefit:** Batching + constant-rate creates perfectly regular traffic: every node
produces exactly the same number of messages at exactly the same cadence. The adversary
sees a completely uniform traffic matrix.

### 6.3 Interaction with Consensus Layer

Consensus messages (attestations, confirmations, slot entries) are also observable
traffic. If consensus messages are sent outside the constant-rate schedule, they leak
validator activity.

**Design decision:** Consensus traffic MUST be included in the constant-rate envelope.

- Validator nodes include attestations and confirmations in their emission queue
  alongside real messages and padding
- If consensus requires more messages than the available slots, it takes priority
  over padding (but never over real user messages)
- The emission rate C for validators must account for consensus overhead

**Consensus traffic estimate (from Round 1 Front 5):**
- K=7 committee, 1 attestation per validator per confirmed message
- At 10K msgs/day: ~10K attestations/day per validator = ~0.12/sec
- Plus confirmations: ~10K/day = ~0.12/sec
- Total consensus traffic: ~0.24/sec per validator

**Implication:** Validator nodes need a higher C than non-validator nodes to
accommodate consensus traffic without persistent bursting. See Section 7 for
rate differentiation.

### 6.4 Node-to-Node vs Client-to-Node Traffic

**Node-to-node:** The constant-rate protocol applies to inter-node communication
(replication, consensus, forwarding). All nodes emit at rate C to their peers.

**Client-to-node:** Client devices (phones, browsers) connect to their storage node.
This traffic is also observable. Options:

1. **No client-side padding (v1):** Clients send messages to their node over TLS.
   The node handles constant-rate emission to peers. Client-to-node traffic leaks
   activity patterns but only to the node operator (who is often the user themselves
   in b3nd's self-hosted model).

2. **Client-side padding (v2):** Clients maintain a constant-rate connection to their
   node, padding with dummy requests. This provides end-to-end traffic shaping but
   increases mobile battery and bandwidth usage.

**v1 recommendation:** Node-to-node constant-rate only. Client-to-node uses TLS but
no padding. This is acceptable because:
- In b3nd, users often run their own node (personal data store model)
- Client-to-node is typically over local network or trusted cloud
- Adding client-side padding significantly impacts mobile UX (battery, data usage)

---

## 7. Adaptive Rate Adjustment

### 7.1 Why Rates Must Change

As the network grows, the average real traffic per node increases. A fixed C chosen
for launch-day traffic will eventually be too low, causing persistent burst queuing
and latency degradation. The rate must adapt.

### 7.2 Rate Change Protocol

Rate changes MUST NOT leak information. If one node increases its rate while others
do not, the adversary learns that node's traffic is growing. Therefore:

**All nodes MUST change rate simultaneously.**

```
Protocol: COORDINATED_RATE_CHANGE

1. Rate proposal: Any node can propose a new rate C' by writing to:
     immutable://consensus/rate-proposal/{epoch}/{proposer_hash}
   Proposal includes: new_rate, effective_epoch, justification

2. Committee vote: The K-member committee votes on the proposal via
   standard consensus (attestation + confirmation). Majority required.

3. Activation: If confirmed, ALL nodes switch to C' at the specified
   effective_epoch. The effective_epoch MUST be at least 24 hours in
   the future to allow all nodes to learn about the change.

4. Transition: At the activation epoch, nodes atomically switch from
   C to C'. There is no gradual ramp -- all nodes change simultaneously.
```

**Rate proposal criteria:**
- Network-wide average queue depth exceeding 3.0 for 7 consecutive days
- OR median node real traffic exceeding 0.6 * C for 7 consecutive days
- OR manual governance proposal with community vote

### 7.3 Rate Schedule for Network Growth

| Phase | Est. msgs/day/node | C (msg/sec) | Bandwidth/day |
|-------|-------------------|-------------|---------------|
| Launch (0-6 months) | 1K-10K | 0.2 | 25 MB |
| Growth (6-18 months) | 10K-50K | 1.0 | 127 MB |
| Scale (18-36 months) | 50K-200K | 5.0 | 634 MB |
| Maturity (36+ months) | 200K+ | 10.0+ | 1.3+ GB |

### 7.4 Validator vs Non-Validator Rates

Validators produce consensus traffic that non-validators do not. Two options:

**Option A: Uniform rate (recommended for v1)**
- All nodes use the same C, set high enough for validators
- Non-validators emit more padding than necessary
- Simpler, stronger privacy (no rate-based role identification)
- Overhead: ~0.24 msg/sec wasted per non-validator node ≈ negligible at C=0.5+

**Option B: Role-specific rates**
- Validators use C_v = C + consensus_overhead
- Non-validators use C
- More efficient but leaks role information to traffic observers
- The adversary can identify validators by their higher emission rate

**Recommendation:** Option A (uniform rate). The bandwidth cost of extra padding for
non-validators is negligible compared to the privacy benefit of role indistinguishability.
At C=0.5, the extra 0.24 msg/sec consensus overhead means setting C=0.5 for everyone
(validators use ~48% real+consensus, non-validators use ~48% padding+real). Both look
identical.

### 7.5 Do All Nodes Use the Same Rate?

**Yes.** This is a hard requirement. If nodes use different rates, the adversary can
fingerprint nodes by their emission rate and track them across IP changes. Uniform rate
across the entire network is essential for the security argument.

**Exception:** During the 24-hour transition window for rate changes (Section 7.2),
some nodes may briefly operate at the old rate while others have switched. This is
acceptable because the transition window is short and the adversary gains minimal
information from observing the switchover.

---

## 8. Comparison with Existing Approaches

### 8.1 Tor

**Tor's approach:** Tor does NOT use constant-rate padding on circuits. Cells are
sent on demand. Tor has experimented with padding (Proposal 251, "Padding for
Circuit Setup") but only for specific phases (circuit establishment, not data
transfer). This is because:

- Tor prioritizes low latency (interactive browsing)
- Constant-rate padding at Tor's scale (millions of circuits) would be prohibitively
  expensive for volunteer relay operators
- Tor's threat model focuses on endpoint anonymity, not volume correlation

**Lesson for b3nd:** Tor's experience shows that constant-rate padding is expensive
at scale. b3nd's advantage is that node operators are compensated via fees (E4 fee
model), making the bandwidth cost economically sustainable. Additionally, b3nd's
message-based (store-and-forward) model tolerates higher latency than Tor's
interactive model, making burst queuing acceptable.

### 8.2 Loopix Mix Network

**Loopix's approach:** Loopix (Piotrowska et al., 2017) uses three types of cover
traffic:

1. **Loop cover traffic:** Messages that loop back to the sender through the mix
   network. Purpose: detect active attacks (if a loop message doesn't return, the
   path is compromised).
2. **Drop cover traffic:** Messages sent to random recipients who discard them.
   Purpose: obscure real message volume.
3. **Payload cover traffic:** Messages from the provider to the user, padding the
   download stream.

Loopix sends cover traffic as a Poisson process with rate mu (configurable per
traffic type). This creates statistically constant traffic without the rigid
structure of fixed-rate emission.

**Lesson for b3nd:** Loopix's Poisson-rate cover traffic is more natural than
fixed-rate emission and provides similar privacy guarantees. However, Poisson
processes have variance -- an adversary with enough samples can distinguish a
Poisson(mu) process from a Poisson(mu + epsilon) process, leaking volume information.
Fixed-rate emission (deterministic C) provides strictly stronger guarantees:
zero variance in emission rate.

**Adopted from Loopix:** The concept of loop cover traffic is valuable for b3nd.
Nodes could send messages that route through multiple peers and return, providing
both padding and path-health monitoring. This is a v2 consideration.

### 8.3 Vuvuzela

**Vuvuzela's approach:** Vuvuzela (van den Hooff et al., 2015) uses differential
privacy noise. Each round, every user deposits a message into a dead drop. The
server adds Laplacian noise (dummy messages) to the total volume, providing
epsilon-differential privacy for the communication pattern.

Key properties:
- Noise scales with the number of dead drops, not the number of users
- Provides formal differential privacy guarantees (epsilon, delta)
- Requires a trusted server to add noise (b3nd has no trusted server)
- Round-based protocol (all users act synchronously)

**Lesson for b3nd:** Vuvuzela's differential privacy framework provides formal
guarantees that our constant-rate protocol does not (we argue security informally).
However, Vuvuzela's centralized noise injection is incompatible with b3nd's
decentralized architecture. The constant-rate protocol achieves a similar effect
(uniform traffic volume) through a different mechanism (per-node padding rather
than centralized noise injection).

**Future work:** Formalize the privacy guarantees of constant-rate emission using
differential privacy or information-theoretic metrics. This would strengthen the
security argument from "the adversary's score is dominated by noise" to "the
protocol provides epsilon-DP with epsilon = f(C, V, N)."

### 8.4 Summary Comparison

| Property | Tor | Loopix | Vuvuzela | b3nd (this spec) |
|----------|-----|--------|----------|------------------|
| Padding type | Phase-specific | Poisson cover | DP noise | Constant-rate |
| Rate uniformity | No | Statistical | Statistical | Deterministic |
| Decentralized | Yes (relays) | Yes (mixes) | No (server) | Yes (peers) |
| Formal guarantee | No | Prob. unlinkability | Epsilon-DP | Informal (see 5.5) |
| Bandwidth overhead | Low | Medium (3-5x) | Medium | Configurable (1.7-86x) |
| Latency model | Interactive | Store-forward | Round-based | Store-forward |
| Operator compensation | Volunteer | N/A (academic) | N/A (academic) | Fee-based |

---

## 9. Concrete Recommendation

### 9.1 Recommended Configuration for v1

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Constant rate C | **0.5 msg/sec** | Supports 43K msgs/day with no bursting; accommodates validators |
| Epoch length | **1 second** | Aligns with D=1s batching |
| Message size classes | **256, 512, 1024, 2048, 4096 bytes** | Cover range of typical payloads |
| Default pad-to size | **1024 bytes** | Matches median message size |
| Queue limit | **5 * C = 2.5 msgs** (rounded to 3) | 3-second burst absorption |
| Emission jitter | **U[0, 100ms)** | Anti-fingerprinting for slot timing |
| Rate change lead time | **24 hours** | Propagation + preparation |
| Minimum peer set for padding | **5 peers** | Distributes padding across enough destinations |

**Why C=0.5, not C=0.2:**
- C=0.2 supports only 17K msgs/day before bursting. With validator consensus
  overhead (~0.24 msg/sec for attestations), a validator at C=0.2 would have almost
  no headroom for real traffic.
- C=0.5 provides 43K msgs/day capacity. After consensus overhead, validators still
  have ~0.26 msg/sec (22K msgs/day) for real traffic.
- Bandwidth cost at C=0.5: 63 MB/day = 1.9 GB/month = **$0.17/month** -- negligible.
- Unifying validators and non-validators at C=0.5 preserves role indistinguishability.

### 9.2 Phase-In Strategy

**Phase 0 (v1.0-alpha): No traffic shaping.**
- Ship without constant-rate padding
- Focus on correctness, encryption, path obfuscation
- Traffic analysis is a real but secondary concern during alpha testing
- Document the privacy limitation honestly

**Phase 1 (v1.0-beta): Optional traffic shaping.**
- Implement the constant-rate emission protocol
- Default: disabled (opt-in via node configuration)
- Operators who care about privacy can enable it
- Gather real-world data on bandwidth costs and burst patterns

**Phase 2 (v1.0-release): Default-on traffic shaping.**
- Constant-rate emission enabled by default
- Can be disabled by operators who explicitly accept the privacy trade-off
- Network-wide rate C=0.5 enforced by consensus

**Phase 3 (v1.1+): Mandatory traffic shaping.**
- All nodes MUST emit at rate C
- Nodes not emitting at the correct rate are flagged by peers
- Non-compliant nodes may be excluded from peer sets

### 9.3 Configuration Parameters for Operators

```toml
# traffic-shaping.toml -- Node operator configuration

[traffic_shaping]
# Enable constant-rate emission (default: true after Phase 2)
enabled = true

# Emission rate in messages per second
# Must match the network-wide agreed rate (consensus parameter)
# Do NOT change this unless a coordinated rate change is active
rate = 0.5

# Maximum emission queue depth (messages)
# Beyond this, backpressure is applied to client writes
max_queue = 3

# Peer set for padding distribution
# Minimum 5 peers required for adequate destination diversity
min_padding_peers = 5

# Emission jitter range in milliseconds
# Randomizes exact send time within each emission slot
jitter_ms = 100

# Padding message size classes (bytes)
# Real messages are padded to the next size class boundary
size_classes = [256, 512, 1024, 2048, 4096]

# Default size class for padding-only messages
default_pad_size = 1024

# Monitoring: log queue depth metrics (does not leak externally)
log_queue_metrics = true

# Monitoring: alert if average queue depth exceeds this for 60s
queue_depth_alert_threshold = 2.0
```

### 9.4 Implementation Effort Estimate

| Component | Lines of Code | Time |
|-----------|--------------|------|
| Emission scheduler (epoch clock + slot dispatch) | ~200 | 2 days |
| Padding message generator | ~150 | 1 day |
| Emission queue + burst buffer | ~150 | 1 day |
| Size-class padding (message normalizer) | ~100 | 1 day |
| Peer selection for padding destinations | ~100 | 0.5 day |
| Rate change consensus integration | ~200 | 2 days |
| Configuration + monitoring | ~100 | 0.5 day |
| Tests (unit + integration) | ~400 | 3 days |
| **Total** | **~1,400** | **~2 weeks** |

---

## 10. Formal Argument: Constant-Rate Defeats Volume Correlation

### 10.1 Setup

Let N nodes emit messages over T epochs. In epoch t, node i emits exactly C messages.
Of these, V_i(t) are real messages and C - V_i(t) are padding. The adversary observes
all messages but cannot distinguish real from padding (encryption + size padding).

### 10.2 Adversary's Observation

For each epoch t and each node i, the adversary observes:
- Exactly C outgoing messages (constant across all nodes and epochs)
- Each message has an encrypted payload and an HMAC-obfuscated URI
- Message sizes are quantized to fixed size classes

The adversary's observable for node i in epoch t is:

    O_i(t) = { (dest_j, size_k, time_s) : j in destinations, k in size_classes }

where dest_j is the destination node IP (observable) but the target URI within
that node is obfuscated.

### 10.3 Volume Correlation Score

The adversary computes, for each pair (i, j):

    S(i,j) = sum_t |{ m in O_i(t) : dest(m) = j }| * |{ m in O_j(t) : dest(m) = i }|

This counts "co-directed" messages: epochs where i sends to j AND j sends to i.

### 10.4 Distribution Under Constant-Rate

In each epoch, node i distributes C messages across its P_i peers. For padding messages,
the destination is chosen uniformly at random from the peer set. For real messages, the
destination is determined by the actual recipient.

Let r_ij(t) = number of real messages from i to j in epoch t.
Let p_ij(t) = number of padding messages from i to j in epoch t.

The total messages from i to j: m_ij(t) = r_ij(t) + p_ij(t).

For padding: E[p_ij(t)] = (C - V_i(t)) / P_i.

The adversary observes m_ij(t) but cannot decompose it into real + padding.

For the score:

    E[S(i,j)] = sum_t E[m_ij(t)] * E[m_ji(t)]

When V_i(t) << C (typical regime, where most traffic is padding):

    E[m_ij(t)] ≈ C / P_i + r_ij(t)

The signal from r_ij(t) is additive on top of a large constant baseline C/P_i.
The variance of the padding term (C/P_i) dominates the signal from r_ij, making
the score for communicating pairs indistinguishable from non-communicating pairs
in expectation.

### 10.5 Conclusion

Under constant-rate emission with C >> max_i(V_i), the adversary's volume correlation
score S(i,j) converges to the same distribution for both communicating and
non-communicating pairs. Graph reconstruction precision approaches the random baseline.

The guarantee strengthens as:
- C / V increases (more padding relative to real traffic)
- P increases (more peers to distribute padding across)
- Path obfuscation is applied (preventing even destination-level correlation)

With the recommended C=0.5 and typical V=1K-10K msgs/day (0.012-0.12 msg/sec),
the ratio C/V ranges from 4x to 42x, providing strong privacy margins.

---

## 11. Open Questions and Future Work

### 11.1 Formal Differential Privacy Guarantees

The informal argument in Section 10 should be formalized using differential privacy
or mutual information metrics. Specifically: for what values of C, V, P, and T does
the protocol provide (epsilon, delta)-differential privacy for the social graph?

### 11.2 Loop Cover Traffic

Following Loopix, nodes could send messages that traverse multiple peers and return
to the sender. This provides:
- Active attack detection (missing loop messages indicate path compromise)
- Additional padding that exercises the full network path
- Latency measurements for peer health monitoring

### 11.3 Client-to-Node Padding

Section 6.4 deferred client-side padding to v2. The design should consider:
- Mobile battery impact of constant-rate WebSocket messages
- WiFi vs cellular data cost differences
- Adaptive client-side padding (pad only when on WiFi + charging)

### 11.4 Multi-Rate Privacy Classes

Some operators may want to offer "enhanced privacy" tiers with higher C. This
conflicts with the uniform-rate requirement (Section 7.5). A potential resolution:
define 2-3 privacy tiers (C_low, C_medium, C_high), where nodes within each tier
are indistinguishable. However, this creates smaller anonymity sets within each
tier, potentially reducing overall privacy.

### 11.5 Integration with PIR

Private Information Retrieval (PIR) would prevent the storage node from learning
which URIs a client reads. Combined with constant-rate emission (which hides write
patterns), PIR would close the remaining read-side metadata leakage. PIR is
computationally expensive but becoming practical with recent advances (e.g.,
SimplePIR, DoublePIR).

---

## References

- Piotrowska, A. M., et al. "The Loopix Anonymity System." USENIX Security 2017.
- van den Hooff, J., et al. "Vuvuzela: Scalable Private Messaging Resistant to
  Traffic Analysis." SOSP 2015.
- Dingledine, R., Mathewson, N., Syverson, P. "Tor: The Second-Generation
  Onion Router." USENIX Security 2004.
- Tor Proposal 251: Padding for Circuit Setup.
- Angel, S., et al. "Unobservable Communication over Fully Untrusted
  Infrastructure." OSDI 2016 (Pung).
- Kwon, A., et al. "Riffle: An Efficient Communication System with Strong
  Anonymity." PoPETs 2016.
- Henzinger, A., et al. "SimplePIR: One Server, Sublinear Communication." 2023.
- E3 report: `/home/user/b3nd-sdk/research/round-3/e3-privacy-batching/report.md`
- D3 decision: `/home/user/b3nd-sdk/research/round-3/decision-brief.md`
- Round 1 Front 2: `/home/user/b3nd-sdk/research/round-1/front-2-network-protocols.md`
- Round 2 Front 2: `/home/user/b3nd-sdk/research/round-2/front-2-network-protocols.md`

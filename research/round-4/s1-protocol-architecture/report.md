# Firecat Protocol Architecture

**Round 4, Stream 1 — Protocol Specification**
**Date:** 2026-03-16

---

## Overview

This document synthesizes the 7 decisions from Rounds 1-3 into a complete end-to-end protocol architecture for the firecat network. It defines the message lifecycle, layer architecture, component interactions, state machine, node roles, timing structure, and identifies integration conflicts that require careful engineering.

The 7 governing decisions:

| # | Decision | Value |
|---|----------|-------|
| D1 | Trust model | Open + stake-based Sybil resistance |
| D2 | Committee | K=7 majority (T=4), dynamic scaling, VRF rotation |
| D3 | Privacy | Path obfuscation + constant-rate padding |
| D4 | Fee split | 25% storage / 35% validation / 25% confirmation / 15% treasury @ $0.002/msg floor |
| D5 | Cold-start | Partners + tapering grants ($10-20K/month) |
| D6 | KDF | Argon2id 46MiB/t1/p1 default, PBKDF2 fallback |
| D7 | PQ timeline | Phase 0+1 (hybrid key exchange) in v1.0, hybrid sigs in v1.1 |

---

## 1. Message Lifecycle

A message progresses through six phases from SDK `send()` to finalized slot. Each phase has a defined timing budget and a set of actors.

```
    SDK                Privacy           Crypto            Network          Consensus
     |                   |                 |                  |                |
     | 1. send()         |                 |                  |                |
     |---[payload]------>|                 |                  |                |
     |                   | 2. pad+obfusc   |                  |                |
     |                   |---[padded]----->|                  |                |
     |                   |                 | 3. sign+encrypt  |                |
     |                   |                 |---[sealed]------>|                |
     |                   |                 |                  | 4. receive()   |
     |                   |                 |                  |---[store]----->|
     |                   |                 |                  |                | 5. pending
     |                   |                 |                  |                | 6. attest
     |                   |                 |                  |                | 7. confirm
     |                   |                 |                  |                | 8. slot
     |<-----------------[confirmation receipt]-------------------------------|
```

### Phase Timing

| Phase | Action | Target Duration | Actors |
|-------|--------|-----------------|--------|
| 1. Submission | SDK constructs message, calls `send()` | < 5 ms | SDK client |
| 2. Privacy processing | Constant-rate padding queues message; path obfuscation applied | 0-1000 ms (batch window D=1s) | SDK privacy layer |
| 3. Crypto processing | Argon2id KDF (if password-derived), hybrid sign (Ed25519 + ML-DSA-65 in v1.1), hybrid encrypt (X25519 + ML-KEM-768) | 80-230 ms (KDF) + < 1 ms (sign/encrypt) | SDK crypto layer |
| 4. Network delivery | HTTP POST to storage node, write to local store | 5-50 ms (local), 10-200 ms (remote) | Storage node |
| 5. Pending | Node writes `immutable://pending/{H(M)}/{N_id}`, notifies validators | < 5 ms | Receiving node |
| 6. Attestation | K validators independently verify and write attestations | 100-500 ms (parallel, network-bound) | Validator set |
| 7. Confirmation | Committee of K members vote; T=ceil((K+1)/2) must agree | 200-1000 ms (collect votes) | Committee members |
| 8. Slot finalization | Confirmed message assigned to `immutable://consensus/{era}/{epoch}/{slot}/{H(M)}` | < 100 ms | Slot proposer |

**Total end-to-end latency budget:** 1.5-3.0 seconds typical (dominated by batch window + attestation collection).

### Detailed Sequence

```
 Client              StorageNode         Validator(s)        Committee(K=7)      SlotProposer
   |                      |                   |                    |                   |
   |--1. POST /receive--->|                   |                    |                   |
   |  [sealed message]    |                   |                    |                   |
   |                      |--2. validate----->|                    |                   |
   |                      |  schema + sig     |                    |                   |
   |                      |                   |                    |                   |
   |                      |--3. write-------->|                    |                   |
   |                      |  pending/{H}/{N}  |                    |                   |
   |                      |                   |                    |                   |
   |                      |--4. notify------->|                    |                   |
   |                      |  (SSE/poll)       |                    |                   |
   |                      |                   |                    |                   |
   |                      |                   |--5. verify M------>|                   |
   |                      |                   |  read M, check     |                   |
   |                      |                   |  schema+sig+state  |                   |
   |                      |                   |                    |                   |
   |                      |                   |--6. write--------->|                   |
   |                      |                   |  attestation/      |                   |
   |                      |                   |  {H}/{V_i}         |                   |
   |                      |                   |                    |                   |
   |                      |                   |  [repeat for       |                   |
   |                      |                   |   each validator]  |                   |
   |                      |                   |                    |                   |
   |                      |                   |                    |--7. collect------->|
   |                      |                   |                    |  T attestations    |
   |                      |                   |                    |                    |
   |                      |                   |                    |--8. vote---------->|
   |                      |                   |                    |  each C_j signs    |
   |                      |                   |                    |  confirmation      |
   |                      |                   |                    |                    |
   |                      |                   |                    |  [T of K agree]    |
   |                      |                   |                    |                    |
   |                      |                   |                    |--9. write--------->|
   |                      |                   |                    |  confirmation/     |
   |                      |                   |                    |  {H(M)}            |
   |                      |                   |                    |                    |
   |                      |                   |                    |                    |-10. assign
   |                      |                   |                    |                    |  slot coord
   |                      |                   |                    |                    |
   |                      |                   |                    |                    |-11. write
   |                      |                   |                    |                    |  consensus/
   |                      |                   |                    |                    |  {era}/{ep}/
   |                      |                   |                    |                    |  {slot}/{H}
   |                      |                   |                    |                    |
   |<-----------12. confirmation receipt (async via inbox/SSE)---------------------|
```

---

## 2. Layer Architecture

The protocol is organized into six layers. Each layer has a defined responsibility, interface, and dependency direction. Dependencies flow downward only; no layer may call upward.

```
+================================================================+
|                    APPLICATION LAYER                            |
|  SDK API: send(), read(), list(), delete(), subscribe()        |
+================================================================+
          |                                          ^
          v                                          |
+================================================================+
|                     PRIVACY LAYER                              |
|  Path obfuscation, constant-rate padding, batch window         |
+================================================================+
          |                                          ^
          v                                          |
+================================================================+
|                      CRYPTO LAYER                              |
|  Argon2id KDF, Ed25519+ML-DSA-65 sign, X25519+ML-KEM encrypt  |
+================================================================+
          |                                          ^
          v                                          |
+================================================================+
|                    CONSENSUS LAYER                             |
|  Temporal consensus: pending -> attest -> confirm -> slot      |
|  K=7 majority committee, VRF rotation, equivocation slashing  |
+================================================================+
          |                                          ^
          v                                          |
+================================================================+
|                     NETWORK LAYER                              |
|  HTTP/WSS transport, Merkle-based delta sync, node discovery   |
+================================================================+
          |                                          ^
          v                                          |
+================================================================+
|                    ECONOMIC LAYER                              |
|  Fee collection, 25/35/25/15 distribution, treasury, staking  |
+================================================================+
```

### 2.1 Application Layer (SDK API)

**Responsibility:** Developer-facing interface. Translates application intent into protocol operations.

**Interface:**
```typescript
interface B3ndSDK {
  send(uri: string, data: any, options?: SendOptions): Promise<Receipt>
  read(uri: string): Promise<Message>
  list(prefix: string, cursor?: string): Promise<ListResult>
  delete(uri: string): Promise<void>
  subscribe(prefix: string, callback: (msg: Message) => void): Unsubscribe
}

interface SendOptions {
  visibility: 'private' | 'protected' | 'public'
  password?: string           // for protected visibility
  recipients?: PublicKey[]    // for asymmetric encryption
  priority?: 'normal' | 'high'
  skipConsensus?: boolean     // Tier 0: user-owned mutable, signature-only
}
```

**Tiered consensus (from R1 Front 5, Section F.6):**
- **Tier 0 (no consensus):** User-owned mutable data. Owner signature is sufficient. Bypasses attestation/confirmation entirely. This is the common case (>90% of writes per R1 estimate).
- **Tier 1 (light consensus):** Immutable inbox messages, content-addressed data. Single-node validation. Hash verification is deterministic.
- **Tier 2 (full consensus):** Cross-user operations, transfers, shared resources. Full multi-stage consensus pipeline.

The SDK determines the tier automatically from the URI pattern and `skipConsensus` option.

### 2.2 Privacy Layer

**Responsibility:** Prevent metadata leakage. Two mechanisms operate independently.

**Path obfuscation:**
- All URI path segments after the owner prefix are HMAC-obfuscated using `deriveObfuscatedPath(secret, path)`
- Uses HMAC-SHA256, truncated to 32 hex characters
- The owner pubkey prefix remains visible (required for routing); full path structure is hidden
- Obfuscation is applied by the SDK before the message reaches any network node

**Constant-rate padding:**
- Each SDK client emits writes at a fixed rate R (configurable, default R=1.0 writes/second)
- Real messages are queued and released on the next tick
- If no real message is pending, a dummy message is emitted (encrypted, indistinguishable from real traffic)
- Dummy messages target `immutable://padding/{random}` and are prunable by storage nodes after confirmation
- The batch window D=1s aligns with the padding rate for simplicity

**Design note:** Constant-rate padding replaces the batching+dummy approach from E3, which was shown to be insufficient against volume correlation attacks. Constant-rate eliminates volume correlation entirely because the write rate is constant regardless of actual activity.

### 2.3 Crypto Layer

**Responsibility:** All cryptographic operations. Signing, verification, encryption, decryption, key derivation.

**Key Derivation:**

| Context | Algorithm | Parameters |
|---------|-----------|------------|
| Default (browser) | Argon2id WASM | m=46MiB, t=1, p=1 (~80-230ms) |
| Constrained device | Argon2id WASM | m=19MiB, t=2, p=1 |
| iOS Lockdown Mode | PBKDF2-SHA256 | 600,000 iterations |
| Server (Node.js 24.7+) | Argon2id native | m=64MiB, t=3, p=4 |

Runtime auto-detection: attempt Argon2id WASM first; fall back to PBKDF2 if WASM unavailable. The KDF identifier is stored with the derived key material.

**Signing (v1.0 — Phase 0 forward-compat):**
- Primary: Ed25519 (32-byte pubkey, 64-byte signature)
- `verify()` includes length-based dispatch: if signature > 64 bytes, attempt hybrid verification
- Helper functions for hybrid signature construction are included but not invoked by default

**Signing (v1.1 — Phase 2 hybrid):**
- Hybrid: Ed25519 + ML-DSA-65
- Signature = `{ed25519_sig (64B) || ml_dsa_sig (3,309B)}` = 3,373 bytes total
- Both must verify for the message to be accepted
- Capability advertisement via `/.well-known/capabilities` determines which nodes support hybrid

**Key Exchange (v1.0 — Phase 1 hybrid):**
- Hybrid: X25519 + ML-KEM-768
- `sharedSecret = HKDF-SHA256(X25519_shared || ML-KEM_shared, salt="b3nd-hybrid-kem", info=contextString)`
- Protects stored data against harvest-now-decrypt-later from v1.0 onward
- ML-KEM-768 adds ~1,088 bytes ciphertext + ~1,184 bytes pubkey
- Performance: < 1ms combined overhead

**Encryption pipeline:**
```
plaintext
  -> Argon2id/PBKDF2 (if password-derived key)
  -> HKDF key derivation (domain separation)
  -> X25519+ML-KEM-768 ECDH (shared secret)
  -> HKDF extract+expand (symmetric key)
  -> AES-256-GCM encrypt (12-byte random nonce)
  -> EncryptedPayload { ephemeralPublicKey, kemCiphertext, nonce, data }
```

### 2.4 Consensus Layer

**Responsibility:** Ordering and finality for messages that require cross-user agreement.

**Protocol: Temporal Consensus with K-majority committee.**

**Parameters:**

| Parameter | Value | Source |
|-----------|-------|--------|
| Committee size K | 7 (default, dynamic) | D2, E2, E7 |
| Threshold T | ceil((K+1)/2) = 4 | D2, E7 |
| Max Byzantine fraction | f < T/K = 0.57 theoretical; practical target f ≤ 0.20 | E2 |
| Committee rotation | Per-epoch, VRF-based | D2, E7 |
| Stake cap | 5% max per validator | D2, E2 |
| Scaling formula | K = 2*f_est + 1 | D2, E7 |

**Dynamic scaling table:**

| Estimated f | K | T |
|-------------|---|---|
| ≤ 0.10 | 3 | 2 |
| ≤ 0.15 | 5 | 3 |
| ≤ 0.20 | 7 | 4 |
| ≤ 0.25 | 9 | 5 |
| ≤ 0.33 | ≥15 | ≥8 (needs simulation — open item) |

**Committee selection:**
- VRF-based: each validator computes `VRF(sk, epoch || slot_seed)` and is selected if output < threshold
- Slot seed = RANDAO accumulator: `slot_seed = H(prev_slot_seed || VRF_outputs_of_current_epoch)`
- Grinding resistance: VRF output is unpredictable without the validator's secret key; RANDAO prevents single-validator influence over future seeds

**Equivocation prevention:**
- Double-voting (signing two different confirmations for the same message) is a slashable offense
- Equivocation proofs: any node can submit two conflicting signed messages from the same validator as evidence
- Slashing penalty: configurable fraction of staked amount (suggested: 50% for equivocation)

**Conflict detection (mutable URIs):**
- Two messages conflict if they target the same mutable URI with different content
- Validators must check pending queue for conflicts before attesting
- If conflict exists, validators attest only to the message with the earlier timestamp (HLC-ordered)
- Confirmers include conflict-free proof in the confirmation record

**Consensus message URIs:**
```
immutable://pending/{H(M)}/{node_id}
immutable://attestation/{H(M)}/{validator_pubkey}
immutable://confirmation/{H(M)}
immutable://consensus/{era}/{epoch}/{slot}/{H(M)}
```

All consensus messages are themselves b3nd messages — self-hosting property. Priority routing ensures consensus messages are processed before user data.

### 2.5 Network Layer

**Responsibility:** Transport, replication, node discovery.

**Transport:**
- Primary: HTTPS (HTTP/2 or HTTP/3 where available)
- Bidirectional: WSS (WebSocket Secure) for subscriptions and real-time push
- Future: WebTransport over QUIC (when ecosystem matures)

**Replication: Merkle-based delta sync (from E6):**
- Fanout-16 Merkle tree over URI space
- Each node maintains a root hash of its URI namespace
- Sync protocol: exchange root hashes -> descend tree at points of divergence -> transfer only differing leaves
- 185x more efficient than full-list sync at scale (E6 finding)
- Sync interval: configurable, default 5 seconds for peers

**Node discovery:**
- Bootstrap: well-known seed nodes (DNS-resolvable)
- Registry: `mutable://open/network/nodes/{node_id}` — nodes self-register with capabilities
- Local: mDNS (`_b3nd._tcp.local`) for LAN-first scenarios
- Capability advertisement: `/.well-known/capabilities` endpoint per node (includes PQ support, storage capacity, geographic region)

**NAT traversal (phased):**
- Phase 1: UPnP/NAT-PMP automatic port mapping (~60% of residential)
- Phase 2: Relay nodes for strict NAT (~25% need relay)
- Phase 3: Full libp2p NAT traversal stack (long-term)

### 2.6 Economic Layer

**Responsibility:** Fee collection, distribution, staking, treasury management.

**Fee structure:**
- Minimum fee floor: $0.002 per message (D4)
- Applies only to Tier 2 (full consensus) messages
- Tier 0 and Tier 1 messages: no fee (user-owned data, self-validated)

**Distribution (per confirmed message):**

| Role | Share | Per-message (at floor) |
|------|-------|----------------------|
| Storage node | 25% | $0.0005 |
| Validator(s) | 35% | $0.0007 (split among attestors) |
| Committee confirmers | 25% | $0.0005 (split among T signers) |
| Protocol treasury | 15% | $0.0003 |

**Staking:**
- Validators must stake to participate (stake-based Sybil resistance, D1)
- Minimum stake: TBD (depends on token economics, out of scope for this document)
- Maximum stake per validator: 5% of total staked (anti-whale cap, D2/E2)
- Slashing for equivocation: 50% of stake
- Inactivity leak: gradual stake reduction for extended offline periods

**Treasury:**
- 15% of all fees flow to protocol treasury
- Funds development grants, security audits, emergency reserves
- Governance mechanism for treasury disbursement: TBD

---

## 3. Component Interactions

### 3.1 Crypto <-> Consensus Interaction

Crypto operations happen at two distinct points:

**At message submission (client-side, before consensus):**
1. KDF derives keys (if password-protected)
2. Payload is encrypted (X25519+ML-KEM -> AES-GCM)
3. Encrypted payload is signed (Ed25519, or Ed25519+ML-DSA in v1.1)
4. Signed+encrypted message enters the consensus pipeline

**During consensus (server-side, validators and committee):**
1. Validators verify the outer signature (Ed25519 component; ML-DSA component in v1.1)
2. Validators do NOT decrypt the payload — they verify signature, schema compliance of the envelope, and state consistency
3. Committee members sign their confirmation votes (using their own keypairs)
4. Confirmation record includes K committee signatures (up to K * 3,373 bytes in hybrid mode)

**Critical ordering:** Encryption happens BEFORE signing (sign-over-ciphertext). This ensures:
- Validators can verify authenticity without decrypting
- Ciphertext substitution is detectable
- No surreptitious forwarding attacks

### 3.2 Fee <-> Storage Interaction

Fees are collected at message submission and distributed at confirmation:

```
  Client                 StorageNode                  FeeEscrow
    |                        |                            |
    |--send(msg, fee)------->|                            |
    |                        |--escrow(fee, H(M))-------->|
    |                        |                            |--hold until
    |                        |                            |  confirmation
    |                        |                            |
    ... [consensus completes] ...                         |
    |                        |                            |
    |                        |<--distribute(H(M))---------|
    |                        |  25% to storage            |
    |                        |  35% to validators         |
    |                        |  25% to committee          |
    |                        |  15% to treasury           |
```

**Escrow mechanism:** Fees are locked when the message is submitted and released when confirmation is written. If a message fails to confirm within the epoch timeout, the fee is returned to the sender minus a small processing fee (covers storage node costs for attempted processing).

**Tier 0/1 messages (no consensus):** No fee is collected. Storage nodes serve these as part of their baseline operation, funded by Tier 2 fees and staking rewards.

### 3.3 Privacy <-> Consensus Interaction

Constant-rate padding creates tension with consensus (see Section 5 for full analysis). The key interaction:

- Padding messages are structurally identical to real messages (encrypted, signed)
- Padding messages target `immutable://padding/{random}` — a reserved URI prefix
- Storage nodes recognize padding URIs and store them locally but do NOT submit them for consensus
- Padding messages are prunable after the current epoch ends
- Fee is NOT charged for padding messages

This means consensus only processes real messages, but an external observer watching the network transport layer sees constant-rate traffic from each client.

### 3.4 Privacy <-> Economic Interaction

Path obfuscation interacts with fee routing:

- The fee is attached to the outer envelope, not the obfuscated URI
- Storage nodes can determine fee validity without knowing the true path
- Fee distribution uses `H(M)` as the message identifier, which is computed over the full sealed message (including obfuscated paths)

### 3.5 Consensus <-> Network Interaction

Consensus messages replicate through the same Merkle-based delta sync as user messages, but with priority:

- Consensus URI prefixes (`immutable://pending/*`, `immutable://attestation/*`, `immutable://confirmation/*`, `immutable://consensus/*`) are assigned high priority in the replication queue
- During sync, consensus diffs are transmitted before user data diffs
- This ensures consensus progress is not blocked by large user data transfers

---

## 4. State Machine

### 4.1 Message States

A message exists in exactly one of the following states at any time:

```
                                    +----------+
                                    | REJECTED |
                                    +----------+
                                         ^
                                         | (invalid sig, schema
                                         |  fail, conflict)
                                         |
+--------+     +---------+     +----------+     +-----------+     +----------+
| QUEUED |---->| PENDING |---->| ATTESTED |---->| CONFIRMED |---->| FINALIZED|
+--------+     +---------+     +----------+     +-----------+     +----------+
                    |                                  |
                    v                                  v
               +---------+                       +---------+
               | EXPIRED |                       | EXPIRED |
               +---------+                       +---------+
```

### 4.2 State Definitions

| State | Description | Storage Location |
|-------|-------------|-----------------|
| QUEUED | Message in SDK privacy layer batch queue, awaiting next padding tick | Client memory only |
| PENDING | Written to storage node, pending record created | `immutable://pending/{H(M)}/{N_id}` |
| ATTESTED | At least 1 validator attestation exists | `immutable://attestation/{H(M)}/{V_i}` (multiple) |
| CONFIRMED | T-of-K committee members have signed confirmation | `immutable://confirmation/{H(M)}` |
| FINALIZED | Assigned to consensus slot, fully ordered | `immutable://consensus/{era}/{epoch}/{slot}/{H(M)}` |
| REJECTED | Failed validation at any stage | No persistent record (or rejection receipt) |
| EXPIRED | Timeout reached without advancing to next state | Pending/attestation records prunable |

### 4.3 State Transitions

| Transition | From | To | Condition | Timeout |
|------------|------|----|-----------|---------|
| T1: Submit | QUEUED | PENDING | Storage node accepts `receive()`, writes pending record. Signature valid, schema passes, no conflict detected. | N/A |
| T2: First attestation | PENDING | ATTESTED | At least 1 validator writes attestation record after independent verification. | 1 epoch (pending expires if no attestation) |
| T3: Additional attestations | ATTESTED | ATTESTED | More validators attest. State remains ATTESTED until threshold is met. | Same epoch timeout |
| T4: Committee confirmation | ATTESTED | CONFIRMED | T (= ceil((K+1)/2)) committee members collect ≥ T attestations and sign confirmation. Committee writes confirmation record. | 1 epoch from first attestation |
| T5: Slot assignment | CONFIRMED | FINALIZED | Slot proposer assigns confirmed message to next available slot in current epoch. Writes consensus record. | End of current epoch |
| T6: Reject (submission) | QUEUED | REJECTED | Invalid signature, schema failure, or detected conflict at submission time. | Immediate |
| T7: Reject (attestation) | PENDING | REJECTED | Validator discovers invalidity during independent verification (e.g., state conflict, double-spend). Attestation includes rejection flag. If T validators reject, message is REJECTED. | N/A |
| T8: Expire (pending) | PENDING | EXPIRED | No attestation received within 1 epoch. Message may be resubmitted. | 1 epoch |
| T9: Expire (attested) | ATTESTED | EXPIRED | Insufficient attestations (< T) or committee fails to confirm within epoch. | 1 epoch |

### 4.4 Tier 0 Simplified State Machine

For user-owned mutable data (no consensus required):

```
+--------+     +---------+     +----------+
| QUEUED |---->| PENDING |---->| FINALIZED|
+--------+     +---------+     +----------+
                    |
                    v
               +----------+
               | REJECTED |
               +----------+
```

- No attestation, confirmation, or slot assignment
- The owner's signature is the sole authority
- PENDING -> FINALIZED is immediate upon successful `receive()`
- Storage node validates signature against the URI owner and accepts

---

## 5. Integration Conflicts

The 7 decisions create several points of tension that require careful engineering. Each is analyzed below with its resolution.

### 5.1 Privacy (Constant-Rate Padding) vs. Economics (Fee Per Message)

**Conflict:** D3 requires constant-rate padding (dummy messages indistinguishable from real ones). D4 charges $0.002 per message. If padding messages are charged, the cost to users scales with the padding rate, not their actual usage. If padding messages are free, storage nodes bear the cost of storing/processing dummies without compensation.

**Resolution:**

1. **Padding messages are NOT submitted for consensus and NOT charged a fee.** They exist only at the transport and storage layers.
2. Storage nodes identify padding by the reserved `immutable://padding/*` URI prefix.
3. Padding messages are stored temporarily (current epoch only) and pruned automatically.
4. Storage nodes are compensated for padding overhead indirectly through the 25% storage share of real-message fees, which must be calibrated to cover padding costs.
5. **Implication:** The fee floor ($0.002) may need adjustment upward to account for padding overhead. If each real message generates R dummy messages on average, the effective per-real-message storage cost is (1+R)x. At R=1.0 (default), storage nodes handle 2x the writes, so the storage share effectively halves. The 25% allocation at $0.002 may need to increase to 30%, or the floor may need to rise.

**Open design question:** Should the padding rate R be protocol-mandated or client-configurable? Protocol-mandated ensures uniform traffic patterns (better privacy) but increases costs. Client-configurable allows cost-sensitive applications to reduce padding at the expense of privacy.

**Recommendation:** Protocol-mandated minimum R=0.5, client-configurable up to R=5.0. Default R=1.0.

### 5.2 PQ Signatures (+3KB) vs. Committee Voting (K=7 Signatures Per Confirmation)

**Conflict:** D7 introduces hybrid signatures at 3,373 bytes each. D2 requires K=7 committee members to sign confirmations. A single confirmation record in v1.1 hybrid mode would carry up to 7 * 3,373 = 23,611 bytes of signatures alone. This is a 370x increase over classical (7 * 64 = 448 bytes).

**Resolution:**

1. **Phase-separated deployment.** Phase 0+1 (v1.0) uses classical Ed25519 for committee signatures. Hybrid PQ applies only to user message signatures and key exchange. Committee members continue signing with Ed25519 until Phase 2 (v1.1).
2. **In v1.1 (Phase 2):** Committee confirmation records include hybrid signatures. The 23KB overhead is per-confirmation, not per-message. At the confirmation layer, bandwidth matters more than latency, and confirmations are far fewer than messages.
3. **Mitigation: Signature aggregation.** Explore BLS12-381 aggregation for committee signatures. K=7 BLS signatures can be aggregated into a single ~48-byte aggregate signature. However, BLS is NOT post-quantum. A hybrid BLS+lattice aggregation scheme does not exist in production.
4. **Mitigation: Threshold signatures.** FROST (Flexible Round-Optimized Schnorr Threshold Signatures) produces a single Ed25519-compatible signature from T-of-K participants. The confirmation record would contain one 64-byte threshold signature instead of K individual signatures. FROST+ML-DSA hybrid would produce one ~3,373-byte threshold hybrid signature. This reduces the overhead from 23KB to 3.4KB — a 7x improvement.

**Recommendation:** Use FROST threshold signatures for committee confirmations. This produces a single compact signature regardless of K. Hybrid PQ can be applied to the threshold signature in v1.1 with manageable overhead.

### 5.3 Dynamic Committee Scaling vs. VRF-Based Selection

**Conflict:** D2 specifies dynamic K (scaling from 3 to 15+ based on estimated adversarial fraction f). D2 also specifies VRF-based committee selection per epoch. When K changes, the VRF threshold must be recalibrated so that exactly K validators are selected on average.

**Resolution:**

1. VRF threshold is computed as `threshold = K / N * MAX_VRF_OUTPUT` where N = total active validators.
2. K is determined at the start of each epoch based on the adversarial fraction estimate from the previous epoch.
3. The estimate of f is derived from observed attestation behavior: divergent attestations, missed attestations, and slashing events.
4. K changes take effect at epoch boundaries only — never mid-epoch.
5. **Edge case:** If VRF selection produces fewer than K validators (probabilistic), the committee operates with reduced size. The threshold T is recalculated as `ceil((actual_K+1)/2)`. If fewer than 3 validators are selected, the epoch extends until sufficient validators are selected (liveness recovery).
6. **Edge case:** If VRF selection produces more than K validators, the top-K by VRF output value are selected.

### 5.4 Constant-Rate Padding vs. Merkle-Based Delta Sync

**Conflict:** D3's constant-rate padding generates many short-lived dummy messages. E6's Merkle-based delta sync detects differences between node states efficiently. But padding messages that are constantly being created and pruned cause the Merkle tree to churn, potentially degrading sync efficiency.

**Resolution:**

1. **Separate Merkle trees.** Maintain two trees: one for durable messages (user data + consensus), one for ephemeral messages (padding). Only the durable tree is synced between peers.
2. Padding messages are stored in a local ephemeral store, never replicated to peers.
3. This means padding only protects the client-to-first-node transport link, not the inter-node replication links.
4. **Trade-off:** An observer watching inter-node replication can infer real message volume from the durable tree's change rate. This is acceptable because inter-node traffic is encrypted (TLS) and the primary threat model for constant-rate padding is client-to-node (the first hop where the adversary can correlate a specific user's activity).

### 5.5 Fee Distribution vs. Tiered Consensus

**Conflict:** D4 defines fee shares for storage, validation, confirmation, and treasury. But Tier 0 messages (user-owned mutable data) skip consensus entirely — there are no validators or confirmers to pay.

**Resolution:**

1. Tier 0 and Tier 1 messages have no fee.
2. Storage nodes earn revenue only from Tier 2 messages.
3. The fee floor ($0.002) applies only to Tier 2 (full consensus) messages.
4. **Implication:** Storage nodes must handle Tier 0/1 traffic as a cost of participating in the network. Their compensation comes from Tier 2 fees and staking rewards.
5. **Risk:** If Tier 2 traffic is a small fraction of total traffic, storage nodes may be underpaid. The cold-start strategy (D5) mitigates this with subsidies during the bootstrap phase.

### 5.6 Path Obfuscation vs. Validator Verification

**Conflict:** D3's path obfuscation means validators cannot see the true URI path. But validators need to check for conflicts (e.g., two messages targeting the same mutable URI).

**Resolution:**

1. The obfuscated path is deterministic: the same input always produces the same output. Two messages targeting the same mutable URI will have the same obfuscated path.
2. Conflict detection operates on obfuscated paths — it doesn't need to know the true path, only whether two messages target the same (obfuscated) path.
3. Validators compare `H(obfuscated_path)` values, which are collision-resistant.
4. The owner pubkey prefix remains visible (necessary for routing and signature verification), so validators can verify ownership without deobfuscation.

---

## 6. Node Roles

### 6.1 Storage Node

**Responsibility:** Accept, store, and serve messages. Participate in replication.

**Operations:**
- Accept `receive()` calls, validate schema and signature
- Serve `read()`, `list()`, `delete()` calls
- Write `immutable://pending/{H(M)}/{N_id}` for Tier 2 messages
- Participate in Merkle-based delta sync with peers
- Store and prune padding messages (local only)
- Store and prune attestation records after confirmation

**Requirements:**
- Persistent storage (PostgreSQL recommended for production)
- HTTPS endpoint (publicly reachable or via relay)
- Minimum uptime: 95% for fee eligibility

**Rewards:** 25% of Tier 2 message fees for messages stored on this node.

### 6.2 Validator

**Responsibility:** Independently verify pending messages and produce attestations.

**Operations:**
- Monitor `immutable://pending/*` for new pending records (via SSE or polling)
- For each pending message:
  - Read the original message
  - Verify signature (Ed25519; hybrid in v1.1)
  - Verify schema compliance
  - Check for conflicts (same mutable URI, different content)
  - Check state consistency (referenced inputs exist, no double-spend)
- Write `immutable://attestation/{H(M)}/{V_pubkey}` with signed attestation
- Participate in VRF lottery for committee selection each epoch

**Requirements:**
- Stake deposited (minimum TBD)
- Maximum 5% of total network stake
- Validator software running with access to full message state
- Minimum uptime: 99% (inactivity leak for extended offline)

**Slashable offenses:**
- Equivocation: signing two conflicting attestations for the same slot
- Invalid attestation: attesting to a message that fails validation
- Stake slashing: 50% for equivocation, gradual leak for inactivity

**Rewards:** 35% of Tier 2 message fees, split proportionally among attestors for each message.

### 6.3 Committee Member

**Responsibility:** Participate in the confirmation committee for a given epoch.

**Selection:** VRF-based, per-epoch. A validator becomes a committee member when their VRF output falls below the selection threshold. Committee membership is proven by presenting the VRF proof.

**Operations:**
- Collect attestations for pending messages
- Verify that T or more valid attestations exist
- Participate in threshold signature (FROST) to produce confirmation
- Write `immutable://confirmation/{H(M)}` with the threshold signature
- Act as slot proposer (rotating role within committee)

**Slot proposer (rotating among committee):**
- Bundle confirmed messages into slots
- Write `immutable://consensus/{era}/{epoch}/{slot}/{H(M)}`
- Assign temporal coordinates (era, epoch, slot number)

**Requirements:** Same as Validator, plus committee-specific software.

**Rewards:** 25% of Tier 2 message fees for confirmed messages, split among T signers.

### 6.4 Light Client

**Responsibility:** Verify message finality without storing full state.

**Operations:**
- Connect to one or more full nodes via HTTPS
- Verify confirmation signatures (check threshold signature against known committee pubkeys)
- Verify Merkle inclusion proofs (message exists in the confirmed state tree)
- Sample attestation availability (Data Availability Sampling — query K random attestation URIs to verify they exist)

**Does NOT:**
- Store the full message set
- Participate in consensus
- Earn fees

**Use cases:** Mobile clients, browser-based apps, IoT devices.

**Verification protocol:**
```
1. Client requests confirmation record for H(M)
2. Node returns confirmation + FROST threshold signature + committee pubkeys for epoch
3. Client verifies threshold signature
4. Client requests Merkle inclusion proof for H(M) in consensus state
5. Node returns proof (log2(N) hash path)
6. Client verifies proof against known state root
7. (Optional) Client samples 5 random attestation URIs for DAS
```

---

## 7. Epoch & Slot Structure

### 7.1 Time Hierarchy

```
+--ERA (governance period, ~6 months)---------------------------+
|                                                               |
|  +--EPOCH (committee rotation period, ~10 minutes)----------+ |
|  |                                                          | |
|  |  +--SLOT (message ordering unit, ~2 seconds)----------+  | |
|  |  |                                                    |  | |
|  |  |  [confirmed messages assigned here]                |  | |
|  |  |                                                    |  | |
|  |  +----------------------------------------------------+  | |
|  |  +--SLOT----------------------------------------------+  | |
|  |  |  ...                                               |  | |
|  |  +----------------------------------------------------+  | |
|  |                                                          | |
|  +----------------------------------------------------------+ |
|  +--EPOCH---------------------------------------------------+ |
|  |  ...                                                     | |
|  +----------------------------------------------------------+ |
|                                                               |
+---------------------------------------------------------------+
```

### 7.2 Timing Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Slot duration** | 2 seconds | Accommodates batch window (1s) + attestation collection (500ms) + confirmation (500ms). Leaves margin for network latency. |
| **Epoch duration** | 300 slots = 10 minutes | Long enough for meaningful committee work. Short enough for responsive rotation. Aligns with validator uptime monitoring windows. |
| **Era duration** | ~26,280 epochs = ~6 months | Governance period for protocol parameter changes (fee adjustments, K scaling, stake caps). |
| **Slots per epoch** | 300 | At 2s/slot, yields 150 confirmations/minute = 9,000/hour max throughput per committee. |
| **Committee rotation** | Per epoch (every 10 minutes) | VRF selection at epoch boundary. New committee takes over at slot 0 of new epoch. |
| **Pending timeout** | 1 epoch (10 minutes) | Pending messages not attested within one epoch expire. Sender may resubmit. |
| **Confirmation timeout** | 1 epoch from first attestation | Attested messages not confirmed within one epoch expire. |
| **Padding prune interval** | End of epoch | Padding messages from the previous epoch are eligible for deletion. |

### 7.3 Epoch Lifecycle

```
Epoch N:
  Slot 0:   New committee takes over (selected by VRF at end of epoch N-1)
            RANDAO seed for epoch N committed
            Dynamic K adjustment if adversarial estimate changed

  Slots 1-298: Normal operation
            - Messages submitted, pending records created
            - Validators attest
            - Committee confirms and assigns to slots
            - Fee distribution per confirmed message

  Slot 299: Epoch finalization
            - Remaining pending messages: carry over OR expire
            - Remaining attested messages: carry over OR expire
            - VRF lottery for epoch N+1 committee
            - RANDAO accumulator updated: seed_{N+1} = H(seed_N || VRF_outputs)
            - Attestation pruning for confirmed messages
            - Padding messages from epoch N-1 pruned
            - Adversarial fraction estimate updated
            - K adjustment computed for epoch N+1

Epoch N+1:
  Slot 0:   New committee...
```

### 7.4 Slot Structure

Each slot contains zero or more confirmed messages:

```
immutable://consensus/{era}/{epoch}/{slot}/manifest
  {
    "era": 0,
    "epoch": 1742,
    "slot": 157,
    "timestamp": "2026-03-16T14:23:17.000Z",
    "messages": [
      "sha256/{H(M1)}",
      "sha256/{H(M2)}",
      ...
    ],
    "committee_signature": "<FROST threshold signature>",
    "state_root": "<Merkle root of all confirmed state>",
    "prev_slot_hash": "<H(previous slot manifest)>"
  }
```

The `prev_slot_hash` chains slots together, providing a verifiable ordering sequence. The `state_root` enables light client verification via Merkle inclusion proofs.

### 7.5 View Change (Proposer Failure)

If the current slot proposer fails to produce a slot manifest within the 2-second window:

1. **Timeout:** Committee members wait 2 seconds for the proposer's manifest.
2. **Backup proposer:** The next committee member in VRF-output order takes over.
3. **Empty slot:** If no proposer succeeds, the slot is left empty. Confirmed messages roll into the next slot.
4. **Proposer penalties:** Missed slots count toward the proposer's inactivity score.

**Note:** A full view-change protocol (leader election under Byzantine failure) is identified as an open item from E7. The timeout-and-backup mechanism above is a v1.0 approximation. A formal view-change protocol (e.g., adapted from HotStuff's pacemaker) should be designed in a follow-up work stream (see Round 4, S4).

---

## 8. Open Items

The following items are identified by this architecture but require further work:

| # | Item | Blocking? | Assigned Stream |
|---|------|-----------|-----------------|
| 1 | K≥15 simulation for f=0.33 BFT-level security | No (K=7 is sufficient for v1.0) | S2 (large committee sim) |
| 2 | Constant-rate padding detailed design (rate selection, prune protocol) | Yes (needed for v1.0 privacy) | S3 (traffic shaping) |
| 3 | Formal view-change protocol for proposer failure | No (timeout-and-backup is v1.0 approximation) | S4 (view change) |
| 4 | Base64 vs hex encoding for hybrid signatures (33% wire savings) | No (can be decided at implementation) | S5 (wire format) |
| 5 | FROST threshold signature integration for committee confirmations | Yes (reduces PQ signature overhead from 23KB to 3.4KB) | Engineering |
| 6 | Token economics and staking mechanism design | Yes (required for open network launch) | Separate workstream |
| 7 | Fee floor calibration accounting for padding overhead | No (can tune after testnet data) | Testnet |
| 8 | TLA+ model extension to partial synchrony | No (current synchronous model is sufficient for v1.0) | Research |

---

## Appendix A: Complete Message Wire Format (v1.0)

```
Outer Envelope (transmitted over HTTPS):
{
  "uri": "mutable://accounts/{ed25519_pubkey}/{obfuscated_path}",
  "data": {
    "auth": [
      {
        "pubkey": "<ed25519_pubkey_hex, 64 chars>",
        "signature": "<ed25519_sig_hex, 128 chars>"
      }
    ],
    "payload": {
      "ephemeralPublicKey": "<x25519_ephemeral_hex, 64 chars>",
      "kemCiphertext": "<ml_kem_768_ciphertext, base64, ~1.5KB>",
      "nonce": "<12_byte_nonce_hex, 24 chars>",
      "data": "<aes_256_gcm_ciphertext, base64>"
    }
  },
  "fee": {
    "amount": "0.002",
    "currency": "USD",
    "payer": "<pubkey>"
  }
}
```

**Size breakdown (typical 500-byte payload):**

| Component | v1.0 Classical | v1.0 Hybrid KE | v1.1 Hybrid Full |
|-----------|---------------|-----------------|-------------------|
| URI | ~130 B | ~130 B | ~130 B |
| Auth (signature) | ~200 B | ~200 B | ~3,600 B |
| Ephemeral pubkey | 64 B | 64 B | 64 B |
| KEM ciphertext | — | ~1,088 B | ~1,088 B |
| Nonce | 24 B | 24 B | 24 B |
| Encrypted payload | ~530 B | ~530 B | ~530 B |
| Fee metadata | ~80 B | ~80 B | ~80 B |
| JSON overhead | ~150 B | ~150 B | ~150 B |
| **Total** | **~1,178 B** | **~2,266 B** | **~5,666 B** |

---

## Appendix B: Consensus URI Namespace

All consensus-related URIs live under reserved prefixes. These prefixes are protected — user messages cannot use them.

```
immutable://pending/{message_hash}/{node_id}
immutable://attestation/{message_hash}/{validator_pubkey}
immutable://confirmation/{message_hash}
immutable://consensus/{era}/{epoch}/{slot}/manifest
immutable://consensus/{era}/{epoch}/{slot}/{message_hash}
immutable://slashing/{evidence_hash}
immutable://padding/{random_id}                              (ephemeral, local-only)
mutable://staking/{validator_pubkey}/deposit
mutable://staking/{validator_pubkey}/status
mutable://open/network/nodes/{node_id}                       (peer registry)
mutable://open/network/epochs/{epoch}/committee              (committee roster)
mutable://open/network/epochs/{epoch}/parameters             (K, T, fee floor)
```

---

## Appendix C: Decision Traceability Matrix

Every architectural choice traces back to a specific decision and experiment.

| Architecture Element | Decision | Experiment Evidence |
|---------------------|----------|-------------------|
| Open validator set with staking | D1 | E2 (simulation), E7 (formal) |
| K=7, T=4 majority committee | D2 | E2 (280 configs, zero failures at f≤0.20), E7 (safety iff f<T) |
| VRF+RANDAO committee selection | D2 | E7 (grinding resistance §5.1) |
| 5% stake cap | D2 | E2 (anti-concentration §8.4) |
| Path obfuscation (HMAC-based) | D3 | R1 Front 6 Theorem 2 |
| Constant-rate padding | D3 | E3 (batching alone fails, volume correlation) |
| Batch window D=1s | D3 | E3 (D=1s, R=2.0 operating point) |
| 25/35/25/15 fee split | D4 | E4 (9,600 runs, best validator incentives) |
| $0.002/msg fee floor | D4 | E4 ($0.001 produces 54 fewer operators) |
| Argon2id default KDF | D6 | E5 (80-230ms, all modern devices) |
| PBKDF2 fallback | D6 | E5 (iOS Lockdown Mode requires it) |
| Hybrid X25519+ML-KEM in v1.0 | D7 | E1 (<1ms overhead), E8 (2 functions modified) |
| Ed25519+ML-DSA in v1.1 | D7 | E1 (3,310B/sig, 0.36ms sign), E8 (clean API path) |
| Length-based dispatch in verify() | D7 | E8 (forward-compat, 1 day effort) |
| Merkle-based delta sync (fanout-16) | — | E6 (185x more efficient at scale) |

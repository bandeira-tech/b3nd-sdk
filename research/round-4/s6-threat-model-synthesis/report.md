# Unified Threat Model Synthesis

**Round 4, Stream 6 -- Firecat Protocol**
**Date:** 2026-03-16
**Status:** Complete
**Depends on:** All Round 1-3 experiments, Round 4 S1 (protocol architecture), Round 4 S3 (traffic shaping)

---

## 1. Executive Summary

This document consolidates every threat identified across four rounds of research into a unified threat model for the firecat protocol. It organizes threats by category, maps cross-front attack chains, assigns risk scores, catalogs unmitigated threats, and evaluates protocol readiness for v1 launch.

**Key findings:**

1. **Cryptographic layer is strong.** Algorithm choices (Ed25519, X25519, AES-256-GCM) are sound. The two highest-priority fixes (HKDF in ECDH pipeline, PBKDF2 iteration increase) are low-effort and partially addressed by D6 (Argon2id) and D7 (hybrid PQ). No critical unmitigated crypto threats remain for v1.

2. **Consensus layer is formally verified but incomplete.** Safety and liveness are proven for f < T = ceil((K+1)/2) (E7). However, the model assumes synchrony, does not cover view changes, and committee grinding remains a design-level mitigation (VRF + RANDAO) without implementation verification.

3. **Privacy layer requires traffic shaping to meet its claims.** E3 proved batching alone is ineffective. The S3 constant-rate protocol closes the volume correlation gap, but client-to-node leakage and peer-set size leakage remain for v1.

4. **Economic attacks are the least mitigated front.** Stake concentration, lazy validation, and fee manipulation have design-level mitigations (stake caps, slashing, fee floors) but no simulation or formal verification of the combined economic-consensus interaction.

5. **Cross-front attack chains are the highest-risk category.** Six multi-front chains are identified; three are partially mitigated and three are unmitigated. The most dangerous is the economic-consensus chain (stake acquisition to committee control).

---

## 2. Threat Categories

### 2.1 Cryptographic Threats

| ID | Threat | Description | Source |
|----|--------|-------------|--------|
| C-1 | Key compromise (long-term) | Compromise of an Ed25519 or X25519 private key exposes all past messages encrypted to that key and allows signature forgery | R1-F1 B.6 |
| C-2 | Missing HKDF in ECDH pipeline | Raw X25519 shared secret used directly as AES key without KDF step; non-uniform distribution, no domain separation | R1-F1 A.1, R2-F1 S5 |
| C-3 | Weak PBKDF2 parameters | 100K iterations is below OWASP 2023 minimum (600K); vulnerable to GPU/ASIC brute force for low-entropy passwords | R1-F1 A.2, R2-F1 S1 |
| C-4 | No forward secrecy for recipients | Compromise of recipient X25519 key decrypts all historical messages; no ratcheting mechanism | R1-F1 C.1, R2-F1 S4 |
| C-5 | JSON canonicalization divergence | `sign()` uses `JSON.stringify()` while `hash()` uses RFC 8785 JCS; potential interoperability failures across implementations | R1-F1 A.1 |
| C-6 | Side-channel timing in verify() | Error path timing differences leak whether a pubkey is valid vs. signature is wrong | R1-F1 B.5, R2-F1 S8 |
| C-7 | Quantum vulnerability (Shor) | Ed25519 and X25519 broken by sufficiently large quantum computer; harvest-now-decrypt-later risk for stored data | R1-F1 D.1 |
| C-8 | Vault nodeSecret compromise | Single secret derives all user identities; no rotation mechanism in v1 | R1-F1 B.6, R2-F1 S9 |
| C-9 | Replay on mutable URIs | Captured signed writes can be replayed to revert mutable data to older state; no sequence number or nonce | R1-F1 B.1, R2-F1 S2 |
| C-10 | Signature malleability in multi-signer | Any single valid signature in auth array is sufficient; attacker can strip co-signatures | R1-F1 A.3 |
| C-11 | Client-side crypto in untrusted runtime | JavaScript runtime lacks memory protection; keys in V8 heap vulnerable to extensions, Spectre, heap dumps | R1-F1 E.1 |

### 2.2 Network Threats

| ID | Threat | Description | Source |
|----|--------|-------------|--------|
| N-1 | Eclipse attack | Attacker controls all of a node's connections, feeding false consensus state | R1-F1 B.4 |
| N-2 | Sybil attack | Attacker creates many identities to dominate attestation pool without economic cost | R1-F1 B.3, R1-F4 B.3 |
| N-3 | Network partition | Honest validators in different partitions see different proposals; committee members cannot exchange votes | E7 S7.4 |
| N-4 | MITM on key exchange | Attacker substitutes recipient's public key during initial key discovery; no TOFU or pinning mechanism | R1-F1 B.2 |
| N-5 | DoS on storage nodes | Flooding a node with invalid writes exhausts compute on signature verification and schema validation | S1 |
| N-6 | DoS on attestation layer | Spamming pending messages forces validators to expend verification resources on junk | S1, R1-F4 A.4 |
| N-7 | DNS/BGP hijacking | Redirecting node discovery to attacker-controlled infrastructure | Implied by transport dependency |
| N-8 | Transport-layer eavesdropping | Without TLS, all messages visible in transit; b3nd relies on HTTPS/WSS | R1-F1 B.2 |

### 2.3 Consensus Threats

| ID | Threat | Description | Source |
|----|--------|-------------|--------|
| CO-1 | Double-voting (equivocation) | Byzantine committee member votes for two conflicting messages in the same slot, potentially confirming both | E7 S4.3 |
| CO-2 | Committee grinding | Byzantine proposer manipulates committee selection seed to stack committee with Byzantine members | E7 S5.1 |
| CO-3 | Proposer equivocation | Byzantine proposer sends different messages to different validators, splitting honest votes | E7 S5.2 |
| CO-4 | Attestation withholding | Byzantine validators withhold attestations to degrade evidence quality for confirmation | E7 S5.3 |
| CO-5 | Long-range finality attack | Attacker corrupts validators after committee service, retroactively forging votes for past slots | E7 S5.4 |
| CO-6 | Liveness degradation via timing | Byzantine committee members delay voting, exploiting partial synchrony to cause timeouts | E7 S5.5 |
| CO-7 | No view-change protocol | If proposer is Byzantine and withholds proposal entirely, no backup mechanism exists; slot is lost | E7 S6.6 |
| CO-8 | Supermajority liveness failure | If supermajority threshold were used, 35-88% liveness failure rates even at moderate adversary levels | E2 S3 |
| CO-9 | Stake concentration on committee | At N=500 with fine-grained stake, adversary more precisely hits target fraction; K=7 insufficient for f=0.20 | E2 S6 |

### 2.4 Economic Threats

| ID | Threat | Description | Source |
|----|--------|-------------|--------|
| E-1 | Lazy validation (free-riding) | Rational validators skip actual validation, attest to everything, free-ride on honest validators' work | R1-F4 A.4 |
| E-2 | Validator-confirmer collusion | Validators and confirmers form closed cartel, excluding honest validators from confirmation rewards | R1-F4 B.4 |
| E-3 | Confirmer monopoly | Single low-latency confirmer captures all confirmation slots, centralizing the confirmation layer | R1-F4 B.4 |
| E-4 | Fee floor manipulation | Validators collude to reject messages below an artificially high fee floor, extracting rents | Derived from R1-F4 A.5 |
| E-5 | Subsidy cliff | Flat subsidies with hard cutoffs cause mass operator exit when subsidy ends (E4: drops from 125 to 37 operators) | E4, D5 |
| E-6 | Stake acquisition for committee control | Attacker purchases sufficient stake to dominate committee selection, crossing the f < T safety boundary | R1-F4 B.3, E2 |
| E-7 | MEV extraction | Committee members or proposers reorder messages within a slot for profit (analogous to Ethereum MEV) | Derived from S1 |
| E-8 | Rational deviation under low volume | At low message volume, honest validation costs exceed rewards; rational validators defect | R1-F4 B.2 |
| E-9 | Token speculation distortion | If native token exists, speculation attracts miners not users; Filecoin/Helium pattern | R1-F4 F.2 |

### 2.5 Privacy Threats

| ID | Threat | Description | Source |
|----|--------|-------------|--------|
| P-1 | Volume correlation attack | Adversary infers social graph from correlated activity volumes between user pairs; survives batching and proportional dummy traffic | E3 |
| P-2 | Metadata leakage from URIs | URI structure reveals account pubkey, program type, relationship structure, activity patterns | R1-F1 B.7, R2-F1 S3 |
| P-3 | list() enumeration | `list()` operation reveals existence and count of resources under a URI prefix to node operator | R1-F1 B.7, R2-F1 S10 |
| P-4 | Ciphertext length reveals plaintext size | AES-GCM ciphertext length = plaintext length + 16 bytes; exact payload size recoverable | R1-F1 B.7 |
| P-5 | Visibility tier distinguishable | Presence of `ephemeralPublicKey` in ciphertext distinguishes asymmetric from symmetric encryption | R1-F1 B.7 |
| P-6 | Timing side-channel from JSON serialization | `JSON.stringify()` execution time depends on payload size and structure, leaking characteristics | R1-F1 B.5 |
| P-7 | Peer set size leakage | Adversary observes number of distinct destination IPs a node sends to, revealing peer set size | S3 S5.6 |
| P-8 | Client-to-node traffic leakage | Client connections to storage node reveal activity patterns to network observer | S3 S6.4 |
| P-9 | Burst detection under constant-rate | If real traffic persistently exceeds C, queue depth causes observable latency patterns | S3 S5.3 |
| P-10 | Long-term statistical analysis | After ~24 hours, statistical adversary could extract signal even under constant-rate (without path obfuscation) | S3 S5.5 |

### 2.6 Application Threats

| ID | Threat | Description | Source |
|----|--------|-------------|--------|
| A-1 | SDK misuse: skipping consensus | Developers use `skipConsensus: true` for data requiring integrity guarantees | S1 S2.1 |
| A-2 | Schema injection | Malicious payload passes schema validation but exploits processing logic in consuming applications | Derived from S1 |
| A-3 | Storage manipulation via replay | Without sequence numbers, attacker replays older signed writes to revert application state | R2-F1 S2 |
| A-4 | Cross-program data poisoning | Attacker writes malicious data at URIs consumed by multiple applications, exploiting composability | Derived from R1-F1 |
| A-5 | Identity impersonation via vault compromise | Attacker with vault nodeSecret can derive any user's keys given their OAuth sub | R1-F1 B.6 |
| A-6 | Key discovery poisoning | Attacker provides false PQ public keys via `/.well-known/capabilities`, causing encryption to attacker-controlled key | Derived from D7 |

---

## 3. Cross-Front Attack Chains

This section identifies attacks that span multiple fronts. These are the highest-risk threats because they exploit interactions between subsystems that are typically analyzed in isolation.

### 3.1 Chain: Economic -> Consensus (Stake Acquisition Attack)

**Attack path:**
1. **Economic:** Attacker acquires stake exceeding the safety threshold. With K=7 majority (T=4), attacker needs to control validators whose combined stake gives probability > 50% of placing >= 4 Byzantine members on a 7-member committee.
2. **Consensus:** With committee control, attacker performs double-voting to confirm conflicting messages or censor specific transactions.
3. **Application:** Conflicting confirmations allow double-spending or state corruption at the application layer.

**Prerequisites:**
- Stake market must be liquid enough for attacker to acquire sufficient stake without driving price prohibitively high
- At N=100 with Zipf stake distribution, top 2 validators control ~24% of stake (E2); acquiring these two positions gives significant committee influence
- Anti-whale cap of 5% mitigates but does not eliminate: attacker can distribute across 7+ identities

**Combined mitigation:**
- Stake cap at 5% per validator (D2, E2 S8.4) -- forces attacker to acquire many identities
- VRF-based committee selection with RANDAO (E7 S6.4) -- prevents grinding for favorable committees
- Equivocation slashing (E7 S6.3) -- makes double-voting economically destructive
- Dynamic K scaling: increase K when suspicious attestation behavior detected (D2)
- **Gap:** No formal analysis of combined stake cap + VRF + slashing effectiveness

**Risk:** Critical severity, Medium likelihood. Partially mitigated.

### 3.2 Chain: Privacy -> Network -> Consensus (Targeted Eclipse via Deanonymization)

**Attack path:**
1. **Privacy:** Attacker performs traffic analysis to identify high-value targets (large-stake validators) by correlating on-chain stake information with network traffic patterns (IP addresses, connection patterns).
2. **Network:** With validator IPs identified, attacker performs eclipse attack, isolating target validators from the honest network.
3. **Consensus:** Eclipsed validators receive false consensus state. If enough validators are eclipsed, the adversary can cause them to attest to conflicting proposals or miss attestation windows, effectively increasing the adversary's relative committee power.

**Prerequisites:**
- Validators must be identifiable by IP address (likely during attestation broadcast)
- Attacker needs sufficient network position (ISP-level or BGP control) to eclipse multiple nodes
- Constant-rate padding must be absent or insufficient to hide validator identity

**Combined mitigation:**
- Constant-rate padding (S3) -- hides traffic volume patterns but does not hide IP addresses
- Path obfuscation -- hides URI destinations but not source IPs
- VRF committee selection -- eclipsed validators may not be on the committee for a given slot
- **Gap:** No Tor/relay integration means validator IPs are observable. Uniform emission rate (S3 S7.4) prevents rate-based role identification, but attestation message patterns may still distinguish validators from non-validators if consensus traffic is not perfectly masked.

**Risk:** High severity, Low likelihood (requires ISP-level adversary). Partially mitigated.

### 3.3 Chain: Network -> Economic (Partition-Based Fee Manipulation)

**Attack path:**
1. **Network:** Attacker partitions the network into two segments using BGP hijacking or DNS manipulation.
2. **Economic:** In the smaller partition, reduced validator availability causes confirmation delays. Users in this partition increase fee bids to incentivize faster confirmation. Attacker operates validators in both partitions, collecting inflated fees from the starved partition.
3. **Application:** Users in the starved partition experience degraded service and pay elevated fees.

**Prerequisites:**
- Network partition must be sustained long enough for fee pressure to build
- Attacker must control validators that can operate in both partitions (or switch between them)
- Fee market must be responsive to confirmation latency (currently fee floor is fixed at $0.002/msg)

**Combined mitigation:**
- Fixed fee floor at $0.002/msg (D4) -- limits upward manipulation, but doesn't prevent extraction above floor
- Network partition detection via multi-path validation (not implemented)
- **Gap:** No partition detection mechanism exists. The protocol assumes partial synchrony (E7 S7.1) but does not implement partition-aware fallback.

**Risk:** Medium severity, Low likelihood. Unmitigated.

### 3.4 Chain: Consensus -> Privacy (Byzantine Committee Metadata Leakage)

**Attack path:**
1. **Consensus:** Byzantine committee members (up to f < T) participate honestly in consensus but record all metadata about messages they process: sender pubkeys, recipient patterns, message sizes, timestamps, attestation ordering.
2. **Privacy:** Accumulated metadata from committee participation across many epochs enables social graph reconstruction. Unlike external traffic analysis, committee members see pre-obfuscation URIs for attestation validation.
3. **Application:** Identified communication patterns enable targeted attacks (spear-phishing, blackmail, surveillance).

**Prerequisites:**
- Byzantine committee members must appear honest (to avoid detection and slashing)
- Committee rotation reduces exposure, but over many epochs, a persistent adversary builds a comprehensive metadata database
- Attestation validation may require access to plaintext URIs (depending on whether validation operates on obfuscated or cleartext URIs)

**Combined mitigation:**
- Path obfuscation applied before submission (S1 Phase 2) -- committee members see only HMAC-obfuscated paths
- Constant-rate padding -- padding messages reach attestation layer, diluting real message metadata
- Committee rotation per epoch -- limits any single member's exposure
- **Gap:** Committee members see message hashes, signatures, and timing for every message they validate. Even with obfuscated paths, timing correlation across epochs can reconstruct patterns. No formal analysis of metadata leakage through consensus participation.

**Risk:** High severity, Medium likelihood. Partially mitigated.

### 3.5 Chain: Cryptographic -> Application (Quantum Harvest-Now-Decrypt-Later)

**Attack path:**
1. **Cryptographic:** State-level adversary records all encrypted b3nd traffic today, storing ciphertexts.
2. **Cryptographic:** When cryptographically relevant quantum computers become available (estimated 2035-2045), adversary applies Shor's algorithm to recover X25519 shared secrets from stored ephemeral public keys.
3. **Application:** All historical messages encrypted with X25519-only key agreement are decrypted. Medical records, legal documents, financial data -- anything stored in b3nd before hybrid PQ deployment is exposed.

**Prerequisites:**
- Adversary has storage capacity for years of encrypted traffic
- Quantum computers reach sufficient scale (estimated 2000-4000 logical qubits for Curve25519)
- Target data remains sensitive over decade+ timescales

**Combined mitigation:**
- Hybrid key exchange (X25519 + ML-KEM-768) in v1.0 Phase 1 (D7) -- protects all new data from harvest-now-decrypt-later
- Forward compatibility in `verify()` for hybrid signatures (D7 Phase 0)
- **Gap:** Data encrypted before v1.0 Phase 1 deployment has no protection. Migration path for re-encrypting historical data is undefined.

**Risk:** Critical severity for long-lived data, Low likelihood in near term. Mitigated for new data via D7.

### 3.6 Chain: Economic -> Privacy (Rational Validator Metadata Selling)

**Attack path:**
1. **Economic:** Validators collect metadata as a side effect of validation (message timing, sender pubkeys, obfuscated paths). If validation rewards are insufficient, rational validators have incentive to monetize this metadata.
2. **Privacy:** Validators sell aggregated metadata to analytics firms, advertisers, or surveillance entities. Individual validators have limited views, but a colluding group can reconstruct broad activity patterns.
3. **Application:** User privacy is compromised not by protocol failure but by economic misalignment.

**Prerequisites:**
- Validation rewards must be low enough that metadata monetization is attractive
- A market for b3nd metadata must exist (assumes the network reaches sufficient scale)
- Validators must be able to aggregate data across multiple validators (requires collusion or a data broker)

**Combined mitigation:**
- Adequate fee split (35% to validators per D4) -- makes honest validation profitable
- Path obfuscation limits metadata quality
- Constant-rate padding dilutes metadata signal
- **Gap:** No technical mechanism prevents validators from recording and selling the metadata they observe. This is fundamentally an economic alignment problem. Slashing for metadata selling is unenforceable because the behavior is undetectable on-chain.

**Risk:** Medium severity, Medium likelihood at scale. Unmitigated (only economic deterrence).

---

## 4. Threat Matrix

| ID | Category | Description | Severity | Likelihood | Risk | Mitigation Status | Evidence |
|----|----------|-------------|----------|------------|------|-------------------|----------|
| C-1 | Crypto | Long-term key compromise | Critical | Medium | Critical | Partially mitigated (epoch rotation proposed R2-F1 S4, not implemented) | R1-F1 B.6 |
| C-2 | Crypto | Missing HKDF in ECDH | High | Low | Medium | Mitigated by design (R2-F1 S5 provides implementation spec) | R2-F1 S5 |
| C-3 | Crypto | Weak PBKDF2 iterations | High | Medium | High | Mitigated by D6 (Argon2id replaces PBKDF2 as default) | E5, D6 |
| C-4 | Crypto | No forward secrecy (recipient) | High | Medium | High | Partially mitigated (epoch rotation designed, not built) | R2-F1 S4 |
| C-5 | Crypto | JSON canonicalization divergence | Medium | Medium | Medium | Unmitigated (requires canonicalization in sign path) | R1-F1 A.1 |
| C-6 | Crypto | Timing side-channel in verify() | Low | Low | Low | Partially mitigated (constant-time wrapper proposed R2-F1 S8) | R2-F1 S8 |
| C-7 | Crypto | Quantum vulnerability (Shor) | Critical | Low (near), High (long) | High | Mitigated by D7 (hybrid PQ in v1.0 Phase 1) | E1, E8, D7 |
| C-8 | Crypto | Vault nodeSecret compromise | Critical | Low | High | Partially mitigated (rotation protocol designed R2-F1 S9, not built) | R2-F1 S9 |
| C-9 | Crypto | Replay on mutable URIs | Critical | High | Critical | Partially mitigated (seq number design in R2-F1 S2, not implemented) | R2-F1 S2 |
| C-10 | Crypto | Signature malleability (multi-signer) | Low | Low | Low | Mitigated by design (documented as intentional feature) | R1-F1 A.3 |
| C-11 | Crypto | Untrusted JS runtime | High | Low | Medium | Mitigated by assumption (documented threat boundary) | R1-F1 E.1 |
| N-1 | Network | Eclipse attack | Critical | Low | High | Partially mitigated (multi-party consensus in S1) | R1-F1 B.4 |
| N-2 | Network | Sybil attack | Critical | Medium | Critical | Mitigated by D1 (stake-based Sybil resistance) | E2, E7, D1 |
| N-3 | Network | Network partition | High | Low | Medium | Unmitigated (no partition detection; E7 assumes synchrony) | E7 S7.4 |
| N-4 | Network | MITM on key exchange | High | Low | Medium | Partially mitigated (URI-bound pubkeys; no TOFU/pinning) | R1-F1 B.2 |
| N-5 | Network | DoS on storage nodes | Medium | High | High | Partially mitigated (fee floor creates economic barrier) | S1 |
| N-6 | Network | DoS on attestation layer | Medium | Medium | Medium | Partially mitigated (fee required for pending submission) | S1 |
| N-7 | Network | DNS/BGP hijacking | High | Low | Medium | Unmitigated (relies on transport-layer security) | Derived |
| N-8 | Network | Transport eavesdropping | High | Low | Medium | Mitigated (HTTPS/WSS required; E2E encryption above transport) | R1-F1 B.2 |
| CO-1 | Consensus | Double-voting | Critical | Medium | Critical | Partially mitigated (equivocation slashing designed E7 S6.3, not built) | E7 S4.3 |
| CO-2 | Consensus | Committee grinding | High | Medium | High | Partially mitigated (VRF + RANDAO designed E7 S6.4, not built) | E7 S5.1 |
| CO-3 | Consensus | Proposer equivocation | High | Medium | High | Partially mitigated (proposer sig required E7 S5.2, not implemented) | E7 S5.2 |
| CO-4 | Consensus | Attestation withholding | Medium | Medium | Medium | Mitigated by design (committee votes, not attestation counts) | E7 S5.3 |
| CO-5 | Consensus | Long-range finality attack | High | Low | Medium | Unmitigated (no key rotation after committee service) | E7 S5.4 |
| CO-6 | Consensus | Liveness via timing abuse | Medium | Medium | Medium | Unmitigated (partial synchrony not modeled in E7) | E7 S5.5, S7.1 |
| CO-7 | Consensus | No view-change protocol | High | Medium | High | Unmitigated (identified in E7 S6.6, design pending) | E7 S6.6 |
| CO-8 | Consensus | Supermajority liveness failure | Critical | N/A | N/A | Mitigated by D2 (majority threshold selected, not supermajority) | E2 S3 |
| CO-9 | Consensus | Stake concentration on committee | High | Medium | High | Partially mitigated (5% stake cap per D2; untested at large N) | E2 S6 |
| E-1 | Economic | Lazy validation | High | High | Critical | Partially mitigated (slashing designed R1-F4 A.4, not built) | R1-F4 A.4 |
| E-2 | Economic | Validator-confirmer collusion | High | Medium | High | Partially mitigated (min attestation diversity proposed R1-F4 B.4) | R1-F4 B.4 |
| E-3 | Economic | Confirmer monopoly | Medium | Medium | Medium | Partially mitigated (round-robin proposed R1-F4 B.4) | R1-F4 B.4 |
| E-4 | Economic | Fee floor manipulation | Medium | Low | Low | Mitigated by D4 (fixed floor at $0.002/msg) | D4, E4 |
| E-5 | Economic | Subsidy cliff | High | Medium | High | Mitigated by D5 (tapering grants, max $20K/month) | E4, D5 |
| E-6 | Economic | Stake acquisition for control | Critical | Medium | Critical | Partially mitigated (5% cap, dynamic K; see Chain 3.1) | E2, E7 |
| E-7 | Economic | MEV extraction | Medium | Medium | Medium | Unmitigated (no MEV-resistant ordering mechanism) | Derived from S1 |
| E-8 | Economic | Rational deviation under low volume | High | High | Critical | Partially mitigated (D5 cold-start subsidies) | R1-F4 B.2, E4 |
| E-9 | Economic | Token speculation distortion | Medium | Medium | Medium | Mitigated by design (stablecoin/fiat fees recommended R1-F4 F.5) | R1-F4 F.5 |
| P-1 | Privacy | Volume correlation attack | High | High | Critical | Mitigated by S3 (constant-rate emission) | E3, S3 |
| P-2 | Privacy | Metadata from URIs | High | High | Critical | Mitigated by D3 (HMAC path obfuscation default) | R2-F1 S3, D3 |
| P-3 | Privacy | list() enumeration | Medium | High | High | Partially mitigated (Bloom filter designed R2-F1 S10, not built) | R2-F1 S10 |
| P-4 | Privacy | Ciphertext length leakage | Medium | High | High | Mitigated by S3 (fixed size classes: 256-4096 bytes) | S3 S3.3 |
| P-5 | Privacy | Visibility tier distinguishable | Low | High | Medium | Unmitigated (ephemeralPublicKey presence visible) | R1-F1 B.7 |
| P-6 | Privacy | JSON serialization timing | Low | Low | Low | Mitigated by assumption (network jitter dominates) | R1-F1 B.5 |
| P-7 | Privacy | Peer set size leakage | Medium | High | High | Unmitigated for v1 (relay/Tor deferred) | S3 S5.6 |
| P-8 | Privacy | Client-to-node traffic | Medium | High | High | Unmitigated for v1 (client padding deferred to v2) | S3 S6.4 |
| P-9 | Privacy | Burst detection | Medium | Medium | Medium | Partially mitigated (C set with headroom; persistent bursts detectable) | S3 S5.3 |
| P-10 | Privacy | Long-term statistical analysis | Medium | Medium | Medium | Mitigated by combined stack (constant-rate + path obfuscation) | S3 S5.5 |
| A-1 | Application | SDK misuse (skipConsensus) | Medium | Medium | Medium | Partially mitigated (automatic tier selection in S1 S2.1) | S1 |
| A-2 | Application | Schema injection | Medium | Medium | Medium | Partially mitigated (schema validation in receive pipeline) | S1 |
| A-3 | Application | Storage manipulation via replay | Critical | High | Critical | Partially mitigated (same as C-9) | R2-F1 S2 |
| A-4 | Application | Cross-program data poisoning | Medium | Low | Low | Partially mitigated (signature verification on reads) | Derived |
| A-5 | Application | Identity impersonation via vault | Critical | Low | High | Partially mitigated (vault compromise is targeted, not bulk) | R1-F1 B.6 |
| A-6 | Application | Key discovery poisoning | High | Low | Medium | Unmitigated (no authenticated key discovery for PQ keys) | Derived from D7 |

---

## 5. Unmitigated Threats

### 5.1 Critical Priority

**C-9 / A-3: Replay on mutable URIs**
- **Status:** Design exists (monotonic sequence numbers per R2-F1 S2), not implemented.
- **Required work:** Implement sequence number tracking in persistence layer; add `seq` field to `MutableWritePayload`; update `validateAuthMessage()` to check monotonicity.
- **Effort:** 1 week engineering.
- **Blocks v1 launch:** YES. Without replay protection, any signed mutable write can be reverted by an attacker who captured the original. This undermines the integrity of all mutable data.

**E-1: Lazy validation**
- **Status:** Slashing mechanism designed but not implemented. No random challenge-response protocol.
- **Required work:** Implement equivocation detection and slashing in consensus layer; design and simulate challenge-response protocol for validation proof.
- **Effort:** 2-3 weeks engineering + 1 week simulation.
- **Blocks v1 launch:** YES, but can launch with reduced scope. Minimum viable mitigation: implement equivocation slashing (detects double-voting). Challenge-response for lazy validation can follow in v1.1.

**CO-7: No view-change protocol**
- **Status:** Identified in E7 S6.6 as a gap in the formal model. No design exists.
- **Required work:** Design timeout-based view-change protocol for proposer failure; extend TLA+ specification; implement and test.
- **Effort:** 3-4 weeks (design + formal analysis + implementation).
- **Blocks v1 launch:** YES. Without view-change, a Byzantine or crashed proposer permanently stalls a slot. With K=7 and per-epoch rotation, this affects 1/K slots on average, but a targeted attack on the proposer selection mechanism could cause sustained downtime.

### 5.2 High Priority

**CO-1 / CO-2 / CO-3: Equivocation and grinding defenses**
- **Status:** All three have designs (equivocation slashing, VRF + RANDAO, proposer signatures) from E7 but none are implemented.
- **Required work:** Implement VRF-based committee selection; implement equivocation detection; implement proposer signature requirement.
- **Effort:** 3-4 weeks combined engineering.
- **Blocks v1 launch:** Partially. Equivocation slashing should be in v1. VRF selection should be in v1. RANDAO can be simplified for v1 (use block hash as initial seed).

**E-7: MEV extraction**
- **Status:** No design. Proposer controls message ordering within a slot.
- **Required work:** Research MEV-resistant ordering (encrypted mempool, commit-reveal, fair ordering). Determine whether firecat's message model creates MEV opportunities comparable to Ethereum.
- **Effort:** 2 weeks research + design.
- **Blocks v1 launch:** NO. MEV is primarily a concern at scale. At v1 launch volumes, MEV opportunities are negligible.

**P-7 / P-8: Peer set and client-to-node leakage**
- **Status:** Acknowledged in S3 as v1 limitations. No mitigation planned before v2.
- **Required work:** For P-7: relay-based routing or Tor integration. For P-8: client-side constant-rate protocol.
- **Effort:** 4-6 weeks each.
- **Blocks v1 launch:** NO. These are honest limitations of v1's privacy posture. Must be documented in the v1 privacy disclosure.

**N-3: Network partition handling**
- **Status:** No partition detection or recovery mechanism. E7 formal model assumes synchrony.
- **Required work:** Extend TLA+ to partial synchrony; design partition detection (e.g., monitoring attestation arrival rates); implement partition-aware consensus fallback.
- **Effort:** 4-6 weeks (research + implementation).
- **Blocks v1 launch:** NO, if the protocol honestly assumes partial synchrony and documents the risk. Partition attacks require ISP-level adversary.

### 5.3 Medium Priority

**CO-5: Long-range finality attacks**
- **Required work:** Implement key rotation after committee service; investigate forward-secure signatures.
- **Effort:** 2-3 weeks.
- **Blocks v1 launch:** NO. Finality depth F provides probabilistic protection.

**C-5: JSON canonicalization in sign path**
- **Required work:** Replace `JSON.stringify()` with JCS canonicalization in `sign()` function.
- **Effort:** 1-2 days.
- **Blocks v1 launch:** NO, but should be fixed before multiple SDK implementations exist (interoperability risk).

**P-5: Visibility tier distinguishable**
- **Required work:** Normalize encrypted payload structure so ephemeralPublicKey is always present (use dummy for symmetric).
- **Effort:** 1-2 days.
- **Blocks v1 launch:** NO.

**A-6: Key discovery poisoning for PQ keys**
- **Required work:** Authenticate `/.well-known/capabilities` responses via chain-of-trust from the account's Ed25519 key.
- **Effort:** 1 week.
- **Blocks v1 launch:** NO (PQ signatures not mandatory until v1.1).

---

## 6. Security Assumptions

The protocol's security depends on the following assumptions. If any assumption is violated, the corresponding guarantees fail.

### 6.1 Cryptographic Assumptions

| Assumption | Depends On | What Breaks If Violated |
|------------|-----------|------------------------|
| Discrete log hardness on Curve25519 | No polynomial-time classical algorithm for ECDLP | Ed25519 signatures forgeable; X25519 key exchange compromised |
| Module-LWE / Module-SIS hardness | Lattice problems remain hard for quantum and classical computers | ML-KEM-768 and ML-DSA-65 broken; hybrid PQ layer provides no protection |
| SHA-256 collision resistance | No collision-finding algorithm faster than 2^128 | Content-addressed storage integrity broken; hash-based URIs forgeable |
| AES-256 security | No key-recovery attack faster than 2^256 (2^128 post-quantum via Grover) | All encrypted data exposed |
| HMAC-SHA256 unforgeability | HMAC security reduction to hash function | Path obfuscation broken; vault-derived identities compromised |
| Random oracle model for HKDF | HKDF output indistinguishable from random given good entropy input | Key derivation produces biased keys |
| Argon2id memory hardness | No time-memory tradeoff significantly reduces Argon2id cost | Password-based keys vulnerable to GPU/ASIC brute force (fallback to PBKDF2 risk) |

### 6.2 Network Assumptions

| Assumption | Depends On | What Breaks If Violated |
|------------|-----------|------------------------|
| Partial synchrony | Messages between honest nodes delivered within bounded delay delta | Liveness fails; slots timeout; attestations expire before collection |
| Honest majority of network links | Attacker cannot partition arbitrary honest nodes | Eclipse attacks become feasible; consensus safety compromised |
| TLS availability | HTTPS/WSS transport is correctly implemented and certificates are valid | Transport-layer eavesdropping; MITM on unencrypted connections |
| DNS integrity | DNS resolves to correct IP addresses | Node discovery compromised; users connect to malicious nodes |

### 6.3 Economic Assumptions

| Assumption | Depends On | What Breaks If Violated |
|------------|-----------|------------------------|
| Rational validators | Validators maximize expected profit; do not incur net loss for altruistic behavior | Validators defect when costs exceed rewards; network stalls at low volume |
| Stake distribution not concentrated | No single entity controls > 5% of total stake (enforced by cap) | Committee safety threshold violated; single entity can dominate consensus |
| Sufficient message volume | >= 50K msgs/day for self-sustaining economics (E4) | Validator economics negative; rational exit; network shrinks |
| Slashing is a credible deterrent | Slashed stake must be large enough to exceed profit from misbehavior | Double-voting becomes profitable; lazy validation is rational |
| Fee floor is sustainable | $0.002/msg does not deter users or undercut by competitors | Revenue insufficient for operator profitability |

### 6.4 Trust Assumptions

| Assumption | Depends On | What Breaks If Violated |
|------------|-----------|------------------------|
| Honest majority: f < ceil((K+1)/2) | Byzantine validators fewer than committee threshold | Safety violated; conflicting confirmations possible (E7 Config 3) |
| No state-level adversary for traffic analysis | Adversary cannot observe all network links globally | Even with constant-rate padding, a global adversary can correlate ingress/egress at national borders |
| Trusted client runtime | JavaScript/WASM execution environment not compromised | All client-side crypto is exposed; keys extractable from memory |
| Vault operator is honest (for custodial users) | Vault does not exfiltrate nodeSecret or user secrets | All vault-derived identities compromised |
| Committee selection randomness is unbiased | VRF + RANDAO produces unpredictable, unmanipulable seeds | Committee grinding becomes possible; adversary stacks committees |

---

## 7. Comparison with Known Protocol Attacks

### 7.1 Bitcoin

| Attack | Bitcoin Exposure | Firecat Exposure | Notes |
|--------|-----------------|------------------|-------|
| 51% attack | Requires >50% hashrate | Requires f >= T committee members (E7) | Firecat uses stake, not hashrate; 5% cap makes accumulation harder but not impossible |
| Selfish mining | Withheld blocks create temporary advantage | No direct analog; proposer equivocation (CO-3) is closest | Firecat's committee structure prevents single-proposer block withholding from gaining advantage |
| Eclipse attack | Isolate node to feed false chain | Applicable (N-1); multi-party consensus reduces but does not eliminate risk | Bitcoin mitigates via diverse peer connections; firecat needs similar peer diversity |
| Double-spend | Revert a transaction by mining a longer chain | Double-voting (CO-1) confirms conflicting messages | Firecat uses equivocation slashing rather than PoW finality |
| Transaction malleability | Modify txid without invalidating signature | Not applicable; Ed25519 is deterministic; no txid concept | Firecat uses content-addressed hashes |
| Time warp attack | Manipulate block timestamps to adjust difficulty | Not directly applicable; slot timing is consensus-managed | Firecat has fixed slot timing, no difficulty adjustment |

### 7.2 Ethereum

| Attack | Ethereum Exposure | Firecat Exposure | Notes |
|--------|------------------|------------------|-------|
| MEV (frontrunning, sandwich) | Validators reorder transactions for profit | Applicable (E-7); proposer controls slot ordering | Less acute because firecat messages are not financial transactions (no AMM pools to exploit) but still possible |
| Validator slashing | Punishes equivocation (double-voting, surround vote) | Planned (CO-1 mitigation) but not built | Firecat's slashing conditions are simpler (double-voting only; no surround vote concept) |
| Proposer boost attack | Proposer releases block late to gain fork-choice advantage | Applicable via CO-3 (proposer equivocation); proposer sends different proposals to different partitions | Firecat's per-slot finality (no fork choice) mitigates, but late proposals can cause liveness issues |
| Inactivity leak | Validators penalized for not participating | Not implemented; lazy validation (E-1) is the analog | Firecat should implement inactivity penalties |
| Long-range attack | Create alternative history from a past checkpoint | Applicable (CO-5); attacker corrupts old committee keys | Firecat's finality depth F provides similar protection to Ethereum's checkpoints |
| Blob data availability | Data availability sampling for large blobs | Not applicable; firecat stores full messages, not blobs | Firecat's message model is simpler |

### 7.3 Tendermint/CometBFT

| Attack | Tendermint Exposure | Firecat Exposure | Notes |
|--------|-------------------|------------------|-------|
| > 1/3 Byzantine | Safety breaks at f >= n/3 | Safety breaks at f >= T = ceil((K+1)/2) (E7) | Firecat's threshold is relative to committee K, not total N; K=7 means f >= 4 breaks safety |
| Proposer timeout | Proposer fails to propose; view-change needed | Directly applicable (CO-7); no view-change in firecat | This is a critical gap -- Tendermint has well-tested view-change; firecat does not |
| Vote withholding | Byzantine validators withhold prevotes/precommits | Applicable (CO-4); less impact because firecat uses committee votes, not full attestation counts | Firecat's majority threshold means withholding only matters if it drops honest count below T |
| Amnesia attack | Validator "forgets" locked value after crash, votes for conflicting proposal | Partially applicable; firecat has no lock mechanism (no two-phase commit within slots) | Simpler slot structure avoids this class of attack |
| Evidence expiry | Slashing evidence must be submitted within a window | Not designed yet; firecat's slashing mechanism needs evidence lifecycle | Must define evidence window for equivocation proofs |
| Light client attacks | Fool light clients with forged validator set updates | Applicable if firecat implements light clients; committee rotation proofs needed | Light client security depends on VRF committee selection proofs |

**Key takeaway from comparison:** Firecat's consensus is most similar to a simplified Tendermint. The critical missing pieces relative to Tendermint are: (1) view-change protocol, (2) implemented slashing, and (3) partial synchrony handling. These are well-understood problems with known solutions from the Tendermint/CometBFT codebase.

---

## 8. Security Scorecard

### 8.1 Per-Layer Assessment

| Layer | Maturity | Critical Gaps | v1 Ready? |
|-------|----------|---------------|-----------|
| **Cryptography** | Strong | HKDF fix needed (low effort); replay protection needed (medium effort); PQ hybrid ready | YES, with 2 fixes (C-2, C-9) |
| **Privacy** | Good | Constant-rate spec complete (S3); path obfuscation designed; peer-set and client leakage acknowledged | YES, with honest disclosure of P-7, P-8 limitations |
| **Consensus** | Moderate | Formally verified safety bound; missing view-change, equivocation slashing, VRF selection | CONDITIONAL: needs CO-1 slashing + CO-7 view-change |
| **Network** | Basic | Relies on transport TLS; no partition detection; no eclipse resistance beyond multi-party consensus | YES, with documented assumptions |
| **Economic** | Design-Only | Fee split decided; slashing/lazy-validation unimplemented; no simulation of combined econ+consensus | CONDITIONAL: needs E-1 basic slashing |
| **Application** | Moderate | Tiered consensus designed; schema validation exists; replay protection missing | YES, after C-9 fix |

### 8.2 v1 Launch Blockers (Minimum Viable Security)

The following items MUST be completed before v1 launch:

1. **Replay protection on mutable URIs (C-9).** Without this, any authenticated mutable write can be reverted. Effort: 1 week.

2. **Equivocation slashing (CO-1).** Without this, double-voting has no economic consequence. A committee member can vote for conflicting messages freely. Effort: 2 weeks.

3. **View-change protocol (CO-7).** Without this, a crashed or malicious proposer stalls a slot permanently. Effort: 3-4 weeks.

4. **VRF-based committee selection (CO-2).** Without this, the proposer can manipulate which validators appear on the committee. Effort: 2 weeks.

5. **HKDF in ECDH pipeline (C-2).** Without this, the protocol uses raw ECDH output as an AES key, violating NIST/IETF standards. Effort: 1 day.

**Total estimated effort for launch blockers: 8-10 weeks.**

### 8.3 v1 Launch Warnings (Acceptable Risk with Disclosure)

The following items should be disclosed in v1 security documentation but do not block launch:

- **No forward secrecy for recipient keys (C-4).** Compromise of a recipient's long-term key decrypts all historical messages to that key. Epoch rotation is designed but not implemented.
- **Client-to-node traffic is not padded (P-8).** Network observers can see when a client communicates with their storage node, even though content is encrypted.
- **Peer set size is observable (P-7).** Number of destination IPs is visible to a traffic observer.
- **MEV-resistant ordering not implemented (E-7).** Proposers control message ordering within slots.
- **No partition detection (N-3).** Protocol assumes partial synchrony but has no mechanism to detect or recover from network partitions.
- **Lazy validation has limited deterrence (E-1).** Equivocation slashing catches double-voting but does not prevent validators from skipping validation and attesting blindly.

### 8.4 Overall Security Posture

```
Layer           Threats  Mitigated  Partial  Unmitigated  Score
─────────────────────────────────────────────────────────────
Cryptography      11        4         5          2        6/10
Network            8        2         3          3        5/10
Consensus          9        2         3          4        4/10
Economic           9        3         3          3        5/10
Privacy           10        5         2          3        6/10
Application        6        1         4          1        5/10
─────────────────────────────────────────────────────────────
Cross-Front        6        1         3          2        4/10
─────────────────────────────────────────────────────────────
OVERALL                                                   5/10
```

**Assessment:** The protocol's cryptographic foundations and privacy design are sound and well-researched. The consensus layer has strong formal backing (E7) but critical implementation gaps. The economic layer is the weakest -- important mechanisms (slashing, challenge-response, MEV resistance) exist only as designs. The cross-front attack chains represent the highest-risk category and have received the least analytical attention.

**Verdict:** Firecat is NOT ready for production launch today. With the 5 launch blockers addressed (estimated 8-10 weeks), it reaches minimum viable security for a beta deployment. Full production readiness requires addressing the High-priority unmitigated threats, particularly the economic-consensus interaction (Chain 3.1) and view-change protocol.

**Recommended path to launch:**

| Phase | Timeline | Deliverables |
|-------|----------|-------------|
| Alpha (current) | Now | Research complete; threat model documented |
| Security sprint | Weeks 1-10 | 5 launch blockers implemented and tested |
| Beta | Weeks 11-16 | Closed beta with security-conscious partners; bug bounty |
| Audit | Weeks 17-20 | External security audit of consensus + crypto layers |
| v1.0 | Week 21+ | Public launch with documented security posture |

---

## References

1. E7 report: TLA+ formal verification of temporal consensus. Round 3.
2. E2 report: Stake-weighted committee simulation. Round 3.
3. E3 report: Privacy batching interval sweep. Round 3.
4. E4 report: Fee market simulation. Round 3.
5. S1 report: Protocol architecture specification. Round 4.
6. S3 report: Constant-rate traffic shaping protocol. Round 4.
7. R1-F1: Cryptography and security research. Round 1.
8. R2-F1: Cryptography and security deep-dive. Round 2.
9. R1-F4: Economics and game theory. Round 1.
10. Decision brief: Round 3 consolidated decisions.
11. Buchman, E., Kwon, J., Milosevic, Z. "The latest gossip on BFT consensus." 2018 (Tendermint).
12. Buterin, V. et al. "Combining GHOST and Casper." 2020 (Ethereum consensus).
13. Nakamoto, S. "Bitcoin: A Peer-to-Peer Electronic Cash System." 2008.
14. Piotrowska, A. M. et al. "The Loopix Anonymity System." USENIX Security 2017.
15. van den Hooff, J. et al. "Vuvuzela: Scalable Private Messaging." SOSP 2015.
16. Komlo, C. & Goldberg, I. "FROST: Flexible Round-Optimized Schnorr Threshold Signatures." SAC 2020.
17. NIST FIPS 203: ML-KEM. 2024.
18. NIST FIPS 204: ML-DSA. 2024.
19. RFC 9106: Argon2. 2021.
20. RFC 9180: HPKE. 2022.

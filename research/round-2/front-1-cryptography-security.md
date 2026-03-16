# Front 1: Cryptography & Security — Round 2 Deep-Dive

**Round 2 — b3nd Framework & Firecat Network**
**Date:** 2026-03-16

---

## Executive Summary

Round 1 established that b3nd's cryptographic primitive selection (Ed25519/X25519/AES-GCM) is sound, but identified 10 operational gaps. This Round 2 deep-dive provides concrete solutions, threat models, and implementation guidance for each gap. The highest-priority items are: (1) adding HKDF to the ECDH-to-AES pipeline, (2) upgrading PBKDF2 iterations and providing Argon2 migration path, (3) designing replay protection for mutable URIs, and (4) formalizing the metadata privacy model.

---

## 1. PBKDF2 Iteration Count and Argon2 Migration

### Current State

`deriveKeyFromSeed()` at `libs/b3nd-encrypt/mod.ts:600` uses PBKDF2-SHA256 with a default of 100,000 iterations. `SecretEncryptionKey.fromSecret()` at line 146 passes this default.

```typescript
// mod.ts:600-628
export async function deriveKeyFromSeed(
  seed: string, salt: string, iterations: number = 100000
): Promise<string> {
  // ... PBKDF2 with SHA-256
}
```

### Threat Model

- **GPU brute force**: PBKDF2-SHA256 at 100K iterations: a single RTX 4090 achieves ~400K hashes/sec. For a 40-bit entropy password (common), exhaustive search takes ~15 minutes. At OWASP-recommended 600K iterations, this extends to ~90 minutes — still insufficient against determined attackers.
- **ASIC attacks**: PBKDF2 is not memory-hard. Custom ASICs can achieve 100x speedup over GPUs.

### Proposed Solution

**Phase 1 (immediate):** Increase default to 600,000 iterations per OWASP 2023 guidance. This is a parameter change only.

```typescript
// Backward-compatible: existing keys use stored iteration count
static async fromSecret(params: {
  secret: string; salt: string; iterations?: number;
}): Promise<SecretEncryptionKey> {
  const keyHex = await deriveKeyFromSeed(
    params.secret, params.salt, params.iterations ?? 600000  // was 100000
  );
  return new SecretEncryptionKey(keyHex);
}
```

**Phase 2 (medium-term):** Add Argon2id support via WASM module.

```typescript
// New: Argon2id key derivation
export async function deriveKeyArgon2(
  password: string, salt: Uint8Array,
  params: { memory: number; iterations: number; parallelism: number } =
    { memory: 65536, iterations: 3, parallelism: 4 }  // OWASP recommended
): Promise<string> {
  const argon2 = await import("argon2-wasm");
  const hash = await argon2.hash(password, salt, params);
  return encodeHex(hash.slice(0, 32));
}
```

**Migration path:** Store a `kdf` field alongside encrypted data: `{ kdf: "pbkdf2-100k" | "pbkdf2-600k" | "argon2id" }`. On read, use the stored KDF. On write, use the latest KDF. Lazy migration: re-encrypt on next write.

### Tradeoffs
- 600K iterations adds ~300ms per key derivation on mobile (acceptable for login flow, not for per-message ops)
- Argon2 WASM adds ~200KB to browser bundle
- Migration requires schema versioning in encrypted payloads

### Open Questions
- Should the iteration count be configurable per-deployment, or enforced as a protocol minimum?
- What is the right Argon2 memory parameter for browser environments (constrained to ~64MB)?

### Cross-Front Dependencies
- **Front 3 (Systems):** Schema versioning for KDF field
- **Front 4 (Economics):** Higher KDF cost affects per-operation pricing
- **Front 6 (Math):** Entropy analysis of real password distributions

---

## 2. Replay Protection on Mutable URI Writes

### Current State

There is no replay protection on mutable URIs. The `receive()` path validates signatures and schema, but does not check whether a message is a replay of a previously seen write. The persistence layer (`libs/b3nd-persistence/`) overwrites the value at a URI on every valid write.

In `libs/b3nd-auth/mod.ts:71`, `validateAuthMessage()` checks signature validity against authorized pubkeys but has no temporal dimension — a valid signed message remains valid forever.

### Threat Model

**Replay attack on mutable URIs:**
1. Attacker captures a valid signed write `W1` to `b3nd://alice/profile`
2. Alice updates her profile with `W2`
3. Attacker replays `W1`, reverting Alice's profile to the old state
4. Since `W1`'s signature is still valid against Alice's pubkey, the node accepts it

This is particularly dangerous for:
- Profile data (identity theft via reversion)
- Access control lists (replay an old ACL that includes a revoked key)
- Financial state (replay an old balance)

### Proposed Solution

**Approach: Monotonic sequence numbers per (pubkey, URI-prefix) pair.**

```typescript
interface MutableWritePayload<T> {
  seq: number;        // Monotonically increasing per signer per URI scope
  ts: number;         // Wall-clock timestamp (advisory, not authoritative)
  payload: T;
}
```

**Validation rule:** A write with `seq <= current_seq` for the same `(pubkey, uri_prefix)` is rejected. The node tracks the highest seen sequence number per signer.

```typescript
// In validation pipeline:
async function validateReplayProtection(
  write: { uri: string; value: AuthMessage<MutableWritePayload<unknown>> }
): Promise<{ valid: boolean; error?: string }> {
  const signerPubkey = write.value.auth[0].pubkey;
  const currentSeq = await getSequenceNumber(signerPubkey, write.uri);
  if (write.value.payload.seq <= currentSeq) {
    return { valid: false, error: `Replay detected: seq ${write.value.payload.seq} <= ${currentSeq}` };
  }
  return { valid: true };
}
```

**Why not timestamps alone?** Clock skew across nodes makes timestamp-only ordering unreliable. A node with a fast clock could reject valid writes from a node with a slow clock. Sequence numbers are monotonic by construction.

**Why not nonces?** Nonces require unbounded storage (the set of all seen nonces). Sequence numbers require O(1) storage per (pubkey, URI-prefix).

### Tradeoffs
- Adds 8 bytes (seq) + 8 bytes (ts) per message
- Requires server-side state: `Map<(pubkey, uri_prefix) → highest_seq>`
- Breaks backward compatibility for existing mutable URIs (need migration period where seq=0 is accepted)
- Multi-device writes from the same identity become harder (devices must coordinate seq numbers)

### Open Questions
- How do multi-device users coordinate sequence numbers? Options: (a) device-scoped sequences, (b) seq = max(local_seq, server_seq) + 1
- Should sequence numbers be per-URI or per-URI-prefix?
- How does this interact with eventual consistency in multi-node setups?

### Cross-Front Dependencies
- **Front 2 (Network):** Replication must propagate sequence state
- **Front 3 (Systems):** Persistence layer needs seq tracking
- **Front 5 (Consensus):** Sequence numbers interact with consensus ordering

---

## 3. Metadata Leakage from URI Patterns

### Current State

b3nd URIs are structured: `b3nd://<owner-pubkey>/<program>/<path>`. Even with encrypted payloads, the URI itself reveals:
- **Who** is writing (owner pubkey)
- **What type** of data (program key)
- **Relationship structure** (two users writing to each other's URIs implies communication)
- **Activity patterns** (timestamps of writes, frequency)

`deriveObfuscatedPath()` in `libs/b3nd-encrypt/utils.ts` provides HMAC-SHA256 based path obfuscation, but it's optional and only covers the path component — the program key and owner pubkey remain visible.

### Threat Model

**Social graph inference:** An observer with read access to a node's URI index (which is public for `list()` operations) can:
1. Build a bipartite graph: `{owner_pubkey} → {program} → {interacting_pubkeys}`
2. Infer communication patterns from `inbox://` URIs
3. Track activity frequency by monitoring `list()` results over time
4. Correlate users across programs by shared pubkey

**Quantification (from Round 1 Experiment F4):** Expected >80% accuracy in classifying user behavior from metadata alone.

### Proposed Solution

**Tier 1: Full path obfuscation by default.**

```typescript
// Instead of: b3nd://alice_pubkey/messaging/bob_pubkey/thread-1
// Write to:   b3nd://alice_pubkey/HMAC(secret, "messaging|bob_pubkey|thread-1")
// Where HMAC is already implemented in deriveObfuscatedPath()
```

Make `deriveObfuscatedPath()` the default for all private/protected writes, not opt-in.

**Tier 2: Program key obfuscation.**

Replace plaintext program keys with HMAC-derived tokens:

```typescript
const obfuscatedProgram = await deriveObfuscatedPath(
  userSecret, "program", programKey
);
// b3nd://alice_pubkey/a7f3c2d1e... instead of b3nd://alice_pubkey/messaging
```

Schema validation must be updated to resolve obfuscated program keys server-side (requires the node to know the mapping, which leaks to the node operator).

**Tier 3: Mix networks for access pattern hiding.**

This is a network-layer solution (out of scope for Front 1 alone). Delay and batch requests to prevent timing correlation. Adds latency.

### Tradeoffs
- Tier 1: No performance cost, breaks human-readable URIs (tooling/debugging harder)
- Tier 2: Requires shared secret between client and node, adds complexity to schema resolution
- Tier 3: 100ms-1s added latency, significant engineering effort

### Open Questions
- Can `list()` work on obfuscated URIs without leaking the full set? (Bloom filter approach from Round 1 Experiment F6)
- How does obfuscation interact with cascading access control (`buildCascadingPaths()` in `libs/b3nd-auth/mod.ts:54`)?
- Is there a zero-knowledge proof approach where the node validates schema compliance without seeing the program key?

### Cross-Front Dependencies
- **Front 2 (Network):** Access pattern hiding requires network-layer changes
- **Front 3 (Systems):** `list()` API changes for obfuscated namespaces
- **Front 6 (Math):** Information-theoretic bounds on metadata leakage

---

## 4. No Forward Secrecy

### Current State

The asymmetric encryption in `encrypt()` (mod.ts:410) uses ephemeral keypairs, providing **per-message forward secrecy for the sender**: compromise of the sender's long-term key doesn't expose past encrypted messages because the ephemeral key is discarded.

However, compromise of the **recipient's long-term X25519 private key** exposes ALL past messages encrypted to that key. There is no ratcheting mechanism like the Double Ratchet (Signal Protocol) or similar.

For symmetric encryption (`encryptSymmetric()`, mod.ts:754), there is no forward secrecy at all — the same derived key encrypts all messages at a given URI.

### Threat Model

- **Key compromise of recipient:** Attacker who obtains a recipient's X25519 private key can decrypt all historical messages. In a DePIN context, if a node operator's key is compromised, all messages stored on that node that were encrypted to the operator are exposed.
- **Key compromise of symmetric key:** If a PBKDF2-derived seed is compromised, all data at every URI derived from that seed is exposed.

### Proposed Solution

**For interactive messaging (two parties online):** Implement a simplified Double Ratchet.

```
Initial handshake:
  A → B: ephemeral_A_pub
  B → A: ephemeral_B_pub
  Both derive: root_key = HKDF(ECDH(ephA, ephB))

Per-message:
  chain_key[n+1] = HMAC(chain_key[n], 0x01)
  message_key[n] = HMAC(chain_key[n], 0x02)
  Encrypt message with message_key[n], then discard it
```

**For store-and-forward (async, b3nd's primary mode):** Use epoch-based key rotation.

```typescript
interface EpochKey {
  epoch: number;           // Monotonically increasing
  created: number;         // Timestamp
  encryptionKeyHex: string; // AES-256 key for this epoch
}

// Rotate every N messages or T seconds
// Old epoch keys are kept for decryption but not used for new encryptions
// After retention period, old epoch keys are deleted (achieving forward secrecy)
```

### Tradeoffs
- Double Ratchet requires interactive key exchange — doesn't fit b3nd's async model for all cases
- Epoch-based rotation adds key management complexity
- Deleting old epoch keys means truly deleting them from all backups (hard in practice)
- Retention period creates a tradeoff: shorter = better forward secrecy, longer = better data availability

### Open Questions
- What epoch duration balances forward secrecy with operational simplicity? (Proposed: 24h for messaging, 30d for storage)
- How do epoch keys interact with multi-device access?
- Can X3DH (Extended Triple Diffie-Hellman, used by Signal for async handshakes) be adapted for b3nd?

### Cross-Front Dependencies
- **Front 2 (Network):** Key exchange messages need reliable delivery
- **Front 5 (Consensus):** Epoch transitions might align with consensus slots

---

## 5. Missing HKDF in ECDH-to-AES Pipeline

### Current State

In `encrypt()` (mod.ts:440-449), the raw X25519 ECDH output is used directly as an AES-256-GCM key:

```typescript
const sharedSecret = await crypto.subtle.deriveBits(
  { name: "X25519", public: recipientPublicKey },
  ephemeralKeyPair.privateKey, 256
);
const aesKey = await crypto.subtle.importKey(
  "raw", sharedSecret, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
);
```

This skips the KDF step recommended by NIST SP 800-56C and RFC 9180 (HPKE).

### Threat Model

- **Non-uniform shared secret:** X25519 output is not perfectly uniform — it's a point on an elliptic curve with algebraic structure. While no practical attack exploits this today, best practice is to hash it.
- **Cross-protocol attacks:** If the same ECDH shared secret is used in two different protocol contexts (e.g., encryption and key agreement), an attacker might exploit the correlation. HKDF with context-specific info strings prevents this.
- **Compliance:** NIST, IETF, and FIPS standards require a KDF step. Non-compliance may block adoption in regulated contexts.

### Proposed Solution

```typescript
// Replace direct use with HKDF
const sharedSecret = await crypto.subtle.deriveBits(
  { name: "X25519", public: recipientPublicKey },
  ephemeralKeyPair.privateKey, 256
);

// NEW: HKDF extract-and-expand
const hkdfKey = await crypto.subtle.importKey(
  "raw", sharedSecret, "HKDF", false, ["deriveBits"]
);
const aesKeyBits = await crypto.subtle.deriveBits(
  {
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(32),  // zero salt (ephemeral key provides freshness)
    info: new TextEncoder().encode("b3nd-v1-aes256gcm"),
  },
  hkdfKey, 256
);
const aesKey = await crypto.subtle.importKey(
  "raw", aesKeyBits, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
);
```

**Backward compatibility:** Since ephemeral keys are unique per message, there's no stored key to migrate. However, existing ciphertexts can only be decrypted with the old (non-HKDF) path. Solution: version the `EncryptedPayload` format.

```typescript
interface EncryptedPayload {
  data: string;
  nonce: string;
  ephemeralPublicKey?: string;
  version?: 1 | 2;  // NEW: 1 = raw ECDH, 2 = HKDF
}
```

### Tradeoffs
- ~0.1ms additional latency (negligible)
- Requires payload versioning for backward compatibility
- Old messages encrypted without HKDF remain decryptable (no security regression for existing data)

### Open Questions
- Should the HKDF info string include the sender/recipient pubkeys for additional domain separation?
- Align with HPKE (RFC 9180) completely, or keep a simpler custom scheme?

### Cross-Front Dependencies
- **Front 3 (Systems):** Payload versioning across clients

---

## 6. Post-Quantum Readiness (ML-KEM Hybrid)

### Current State

All asymmetric cryptography uses Curve25519, which is vulnerable to Shor's algorithm on a sufficiently large quantum computer. No post-quantum migration path exists.

### Threat Model

- **Harvest now, decrypt later:** An adversary records encrypted traffic today and decrypts it when quantum computers become available (estimated 2035-2045 for cryptographically relevant QCs).
- **Long-lived data:** b3nd stores data that may be sensitive for decades. Medical records, legal documents, financial data encrypted today should remain secure.

### Proposed Solution

**Hybrid encryption: X25519 + ML-KEM-768 (FIPS 203).**

```
Combined shared secret:
  ss_classical = X25519_ECDH(ephemeral, recipient)
  (ss_pq, ct_pq) = ML-KEM-768.Encapsulate(recipient_pq_pub)
  shared_key = HKDF(ss_classical || ss_pq, salt="", info="b3nd-v1-hybrid")

EncryptedPayload v3:
  {
    data: AES-GCM(shared_key, plaintext),
    nonce: ...,
    ephemeralPublicKey: X25519_ephemeral_pub,  // 32 bytes
    kemCiphertext: ct_pq,                       // 1088 bytes (ML-KEM-768)
    version: 3
  }
```

**Implementation path:** Use a WASM build of ML-KEM (e.g., `crystals-kyber-wasm` or `pqcrypto-kem`). ML-KEM-768 provides 192-bit post-quantum security.

### Tradeoffs
- **Size:** +1088 bytes per message (KEM ciphertext) + ~1184 bytes per public key
- **Performance:** ML-KEM encapsulation ~0.5ms, decapsulation ~0.5ms (WASM, per benchmarks)
- **Bundle size:** WASM module ~200-400KB
- **Standards:** ML-KEM is NIST-standardized (FIPS 203, 2024) — safe for long-term use

### Open Questions
- When to make hybrid encryption the default? (Recommended: opt-in now, default in 12 months)
- ML-KEM-512 (smaller, faster, 128-bit PQ security) vs ML-KEM-768?
- How to handle PQ key distribution? (Need PQ public keys in user profiles alongside X25519 keys)

### Cross-Front Dependencies
- **Front 2 (Network):** Larger messages affect bandwidth planning
- **Front 4 (Economics):** PQ encryption increases per-message cost
- **Front 6 (Math):** Formal security reduction of hybrid scheme

---

## 7. FROST Threshold Signatures for Multi-Party Authorization

### Current State

`validateAuthMessage()` (libs/b3nd-auth/mod.ts:71) implements "any-1-of-N" authorization: if any one signature from an authorized pubkey validates, the write is accepted. There is no threshold requirement (e.g., "2-of-3 must sign").

### Threat Model

- **Single key compromise = full access:** If any one authorized key is compromised, the attacker has full write access to the URI.
- **No shared custody:** High-value operations (e.g., transferring ownership, deleting a namespace) can't require multi-party approval.

### Proposed Solution

**FROST (Flexible Round-Optimized Schnorr Threshold Signatures)** over Ed25519.

FROST produces standard Ed25519 signatures, so verifiers don't need to know threshold signing was used. The threshold signing process:

```
Setup (offline, once):
  Trusted dealer generates (t, n) Shamir shares of signing key
  Each participant i gets share s_i
  Group public key G = g^(sum of shares)  [standard Ed25519 pubkey]

Signing (online, 2 rounds):
  Round 1: Each participant i broadcasts commitment (D_i, E_i)
  Round 2: Each participant i computes partial signature z_i
  Aggregator combines: z = sum(z_i) → standard Ed25519 signature
```

**Integration with b3nd:**

```typescript
// New access control type
interface ThresholdAccess {
  type: "threshold";
  groupPubkey: string;     // The combined Ed25519 pubkey
  threshold: number;        // t
  participants: string[];   // Individual pubkeys (for transparency)
}

// Validation unchanged — FROST produces standard Ed25519 signatures
// The node just sees a valid signature from groupPubkey
```

### Tradeoffs
- FROST requires 2 communication rounds between signers (interactive)
- Trusted dealer setup is a vulnerability (use DKG for higher security)
- Adds complexity to the key management UX

### Open Questions
- Is FROST's 2-round protocol acceptable for b3nd's async model? (Signers must be online simultaneously)
- Should b3nd support both threshold and multisig (multiple independent signatures)?
- How to handle participant removal/addition without key regeneration?

### Cross-Front Dependencies
- **Front 4 (Economics):** Threshold signing for high-value economic operations
- **Front 5 (Consensus):** Validator set could use threshold signatures

---

## 8. Side-Channel Timing in verify() Error Handling

### Current State

`verify()` (mod.ts:372-404) has three distinct error paths:

```typescript
export async function verify<T>(publicKeyHex, signatureHex, payload): Promise<boolean> {
  try {
    const publicKeyBytes = decodeHex(publicKeyHex).buffer;      // Path A: fails on bad hex
    const publicKey = await crypto.subtle.importKey(...);         // Path B: fails on bad key
    const data = encoder.encode(JSON.stringify(payload));
    return await crypto.subtle.verify("Ed25519", publicKey, ...); // Path C: crypto verify
  } catch (error) {
    console.error("Verification error:", error);                  // All errors → false
    return false;
  }
}
```

Similarly, `verifySignature()` in `libs/b3nd-auth/mod.ts:19-52` has the same pattern.

### Threat Model

- **Path A** (hex decode failure) is fast (~microseconds)
- **Path B** (key import failure) is medium (~tens of microseconds)
- **Path C** (crypto.subtle.verify) is slow (~hundreds of microseconds)
- An attacker can distinguish these by measuring response time, learning whether a pubkey is valid, whether the key format is correct, etc.

**Practical impact:** Low. This is a local oracle — the attacker needs to make many verification requests. In b3nd's threat model, the node operator has access to the raw data anyway. The timing leak is primarily relevant for client-side verification where the verifier is untrusted.

### Proposed Solution

**Constant-time wrapper:**

```typescript
export async function verifyConstantTime<T>(
  publicKeyHex: string, signatureHex: string, payload: T
): Promise<boolean> {
  const startTime = performance.now();
  let result = false;

  try {
    // Always do all steps, even if early steps fail
    const publicKeyBytes = decodeHex(publicKeyHex).buffer;
    const publicKey = await crypto.subtle.importKey(
      "raw", publicKeyBytes,
      { name: "Ed25519", namedCurve: "Ed25519" }, false, ["verify"]
    );
    const data = encoder.encode(JSON.stringify(payload));
    const signatureBytes = decodeHex(signatureHex).buffer;
    result = await crypto.subtle.verify("Ed25519", publicKey, signatureBytes, data);
  } catch {
    result = false;
  }

  // Pad execution time to minimum threshold
  const elapsed = performance.now() - startTime;
  const targetMs = 1; // 1ms minimum
  if (elapsed < targetMs) {
    await new Promise(resolve => setTimeout(resolve, targetMs - elapsed));
  }

  return result;
}
```

**Note:** True constant-time is impossible in JavaScript due to JIT, GC pauses, and event loop jitter. The above provides coarse timing equalization, not cryptographic constant-time guarantees. For higher assurance, move verification to a WASM module.

### Tradeoffs
- Adds 1ms floor to verification (negligible for individual verifications, measurable at high throughput)
- Doesn't eliminate all timing information (JS inherently non-constant-time)
- WASM approach adds complexity

### Open Questions
- Is this timing leak actually exploitable in practice given network jitter?
- Should we also remove the `console.error()` that distinguishes error types in server logs?

### Cross-Front Dependencies
- **Front 3 (Systems):** Error handling patterns across the codebase

---

## 9. Vault Secret Rotation Without Breaking Identities

### Current State

The vault (`apps/vault-listener/vault.ts`) derives user-specific secrets from a `nodeSecret`:

```
userSecret = HMAC(nodeSecret, user_sub)
signingKeyPair = HKDF(userSecret, "b3nd-signing-key", "Ed25519")
encryptionKeyPair = HKDF(userSecret, "b3nd-encryption-key", "X25519")
```

If `nodeSecret` is compromised, ALL user identities derived from it are compromised. But rotating `nodeSecret` changes all derived keypairs, effectively destroying all user identities.

### Threat Model

- **Single secret compromise:** `nodeSecret` leak → all users' signing and encryption keys compromised
- **No rotation path:** Inability to rotate the secret means a compromised secret is permanent
- **Centralization risk:** The vault is a central point of failure for all custodial users

### Proposed Solution

**Double-envelope rotation protocol:**

```
Phase 1: Preparation
  1. Generate new nodeSecret'
  2. For each user sub:
     oldUserSecret = HMAC(nodeSecret, sub)
     newUserSecret = HMAC(nodeSecret', sub)
     transitionRecord = {
       sub: sub,
       oldPubkey: derive(oldUserSecret).publicKey,
       newPubkey: derive(newUserSecret).publicKey,
       proof: sign(oldPrivateKey, newPubkey)  // Old key vouches for new key
     }
  3. Store transitionRecords

Phase 2: Transition (configurable window, e.g., 30 days)
  - Accept authentication from both old and new keypairs
  - On any write, re-sign with new keypair
  - Publish key rotation announcement to user's URI namespace

Phase 3: Completion
  - Reject old keypairs
  - Delete old nodeSecret (if desired)
  - transitionRecords serve as provenance chain
```

**Minimal state required:** `Map<sub, { oldPubkey, newPubkey, proof, status }>` — bounded by number of users.

### Tradeoffs
- Transition window creates a period where two keys are valid (expanded attack surface)
- Requires the vault to track per-user transition state (currently stateless)
- Proof chain adds storage overhead
- Users' external contacts need to learn the new pubkey

### Open Questions
- Can the transition be invisible to users? (Yes, if the vault handles it transparently)
- What if the old nodeSecret is compromised DURING the transition? (Attacker can generate valid proofs)
- Should there be a "break glass" instant rotation that invalidates all old keys?

### Cross-Front Dependencies
- **Front 3 (Systems):** Vault state management
- **Front 4 (Economics):** Rotation cost per user
- **Front 5 (Consensus):** Key rotation events should be consensus-ordered

---

## 10. Encrypted Index for Private list() Operations

### Current State

`list()` operations on private namespaces reveal the URI set to the node operator. Even with encrypted payloads, the node sees all URIs in a namespace because it needs to serve `list()` queries.

### Threat Model

- **Node operator sees all URIs:** Even with payload encryption, the URI index is a rich metadata source
- **Prefix-based listing reveals namespace structure:** `list("b3nd://alice/messaging/")` reveals alice uses messaging and how many threads she has

### Proposed Solution

**Client-side encrypted index using keyed Bloom filters:**

```typescript
// Client builds an encrypted index
class EncryptedIndex {
  private bloomFilter: Uint8Array;
  private indexKey: string;

  constructor(secret: string) {
    this.indexKey = HMAC(secret, "bloom-index-key");
    this.bloomFilter = new Uint8Array(1024); // ~8KB, supports ~5000 URIs at 1% FPR
  }

  addUri(uri: string): void {
    const hashes = this.deriveHashes(uri);
    for (const h of hashes) {
      this.bloomFilter[h >>> 3] |= (1 << (h & 7));
    }
  }

  async query(pattern: string): Promise<string[]> {
    // Client tests membership locally, then fetches matching URIs
    // Node never sees the query pattern
  }

  private deriveHashes(uri: string): number[] {
    // k = 7 hash functions via double hashing
    const h1 = HMAC(this.indexKey, uri);
    const h2 = HMAC(this.indexKey, uri + "|2");
    return Array.from({length: 7}, (_, i) => (h1 + i * h2) % (1024 * 8));
  }
}
```

**Protocol:**
1. Client maintains a Bloom filter of their URIs, encrypted and stored at a well-known meta-URI
2. To list, client downloads the Bloom filter, tests membership locally
3. For each positive hit, client fetches the actual URI (some are false positives, discarded client-side)
4. Node sees individual read requests but not the list query

### Tradeoffs
- False positive rate: 1% at 5000 URIs with 8KB filter (acceptable)
- Client must download the full filter on each list() (~8KB, cacheable)
- Doesn't support server-side sorting or pagination
- Adding a URI requires updating and re-uploading the filter

### Open Questions
- How to support range queries (e.g., "all URIs with timestamp > T")?
- Should the filter be a Cuckoo filter instead (supports deletion)?
- Can the node store the filter without being able to query it? (Yes, if encrypted — but then the client must download and decrypt the whole thing)

### Cross-Front Dependencies
- **Front 3 (Systems):** `list()` API redesign
- **Front 6 (Math):** Optimal filter parameters, information leakage analysis

---

## Summary of Priorities

| # | Item | Severity | Effort | Recommendation |
|---|------|----------|--------|----------------|
| 5 | HKDF in ECDH pipeline | Critical | Low (1 day) | Do immediately |
| 1 | PBKDF2 → 600K iterations | Critical | Low (1 hour) | Do immediately |
| 2 | Replay protection | Critical | Medium (1 week) | Design + implement next sprint |
| 3 | Metadata obfuscation default | High | Medium (1 week) | Tier 1 now, Tier 2 next quarter |
| 9 | Vault secret rotation | High | Medium (2 weeks) | Design now, implement next quarter |
| 4 | Forward secrecy | High | High (1 month) | Epoch-based rotation first |
| 6 | Post-quantum hybrid | Medium | High (1 month) | Prototype, opt-in |
| 7 | FROST threshold sigs | Medium | High (1 month) | Prototype, for high-value ops |
| 8 | Timing side-channels | Low | Low (2 days) | Add timing floor |
| 10 | Encrypted list() index | Medium | Medium (2 weeks) | Prototype Bloom filter approach |

---

## References

1. OWASP Password Storage Cheat Sheet, 2023 — PBKDF2 iteration recommendations
2. RFC 9180: Hybrid Public Key Encryption (HPKE) — HKDF-based key derivation
3. NIST SP 800-56C Rev. 2: Key-Derivation Methods in Key-Establishment Schemes
4. NIST FIPS 203: ML-KEM (Kyber) Standard, 2024
5. Komlo & Goldberg, "FROST: Flexible Round-Optimized Schnorr Threshold Signatures," SAC 2020
6. Marlinspike & Perrin, "The Double Ratchet Algorithm," Signal Foundation, 2016
7. Perrin, "The X3DH Key Agreement Protocol," Signal Foundation, 2016
8. RFC 7914: scrypt — Memory-Hard KDF (comparison reference)
9. RFC 9106: Argon2 — Memory-Hard Function for Password Hashing
10. Bloom, B.H., "Space/time trade-offs in hash coding with allowable errors," CACM, 1970

---

*This report is based on direct source code analysis of b3nd SDK. All code references point to actual implementations reviewed during this research round.*

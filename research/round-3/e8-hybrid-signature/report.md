# E8: Hybrid Ed25519 + ML-DSA-65 Signature Design

**Experiment:** E8 — Hybrid Signature Proof-of-Concept
**Informs:** Decision D7 (Post-Quantum Timeline), Phase 2 (opt-in hybrid signatures)
**Date:** 2026-03-16
**Depends on:** E1 (PQ WASM Benchmark)
**Status:** Complete (design + code sketches; no runtime execution)

---

## Executive Summary

This experiment designs a hybrid Ed25519 + ML-DSA-65 dual signature scheme that integrates with b3nd's existing auth module (`libs/b3nd-auth/mod.ts` and `libs/b3nd-encrypt/mod.ts`). The design achieves:

- **Full backward compatibility**: classical-only nodes continue to work unmodified
- **No downgrade attacks**: the Ed25519 signature binds the PQ signature, preventing stripping
- **Minimal API surface change**: 2 functions modified, 0 type definitions broken
- **Smooth migration**: existing ACLs referencing Ed25519 pubkeys still authorize hybrid keys
- **Wire format overhead**: +3,310 bytes per signature, +1,953 bytes per public key

The PoC is implemented in `poc.ts` with complete type definitions, serialization, signing, verification, migration helpers, and version negotiation.

---

## 1. Current API Audit

### libs/b3nd-auth/mod.ts

| Function | Purpose | Signature Surface |
|---|---|---|
| `verifySignature(pubkeyHex, signatureHex, payload)` | Core Ed25519 verification | Consumes 64-char pubkey hex, 128-char signature hex |
| `validateAuthMessage(write, getWriteAccess)` | Validates auth entries against ACL | Iterates `auth[]` entries, calls `verifySignature` |
| `authValidation(getWriteAccess)` | Factory for validation functions | Returns `validateAuthMessage` partial |
| `createPubkeyBasedAccess()` | ACL: first path component is owner pubkey | Returns pubkey strings (64 chars) |
| `createRelativePathAccess(read)` | ACL: reads `.access/` and `~>` files | Returns pubkey strings from storage |
| `createCombinedAccess(read)` | Combines pubkey + relative path ACLs | Merges and deduplicates pubkey strings |

### libs/b3nd-encrypt/mod.ts

| Function / Type | Purpose | Signature Surface |
|---|---|---|
| `KeyPair` | Ed25519 keypair type | `publicKeyHex: string` (64 chars) |
| `IdentityKey` | Signing identity class | `.publicKeyHex`, `.sign(payload)` -> hex signature |
| `sign(privateKey, payload)` | Ed25519 sign, returns hex | Payload JSON-encoded, Ed25519 only |
| `signWithHex(privateKeyHex, payload)` | Sign from hex key | Imports PKCS#8, delegates to `sign()` |
| `verify(pubkeyHex, signatureHex, payload)` | Ed25519 verify | Imports 32-byte raw pubkey |
| `signPayload({payload, identity})` | Convenience: sign + wrap in auth array | Returns `[{ pubkey, signature }]` |
| `verifyPayload({payload, auth})` | Verify all auth entries | Calls `verify()` per entry |
| `createAuthenticatedMessage(payload, signers)` | Build signed message | Signs payload, wraps in `{ auth, payload }` |
| `createAuthenticatedMessageWithHex(payload, pubkey, privkey)` | Hex convenience wrapper | Single signer |
| `AuthenticatedMessage<T>` | Wire type | `auth: [{ pubkey: string, signature: string }]` |

### Key Observations

1. **All keys and signatures are opaque hex strings.** The auth module never parses the byte content of pubkeys or signatures — it just passes hex strings to `verifySignature()` / `verify()`. This is fortunate: hybrid keys and signatures can be longer hex strings without breaking the plumbing.

2. **The `auth` array is the integration point.** Every signed message carries `auth: [{ pubkey: string, signature: string }]`. Hybrid entries use the same structure with longer strings.

3. **ACLs store pubkey hex strings.** The `getWriteAccess()` functions return `string[]` of pubkey hexes. Hybrid keys must either be stored in ACLs as hybrid keys, or the migration logic must match hybrid keys against classical ACL entries.

4. **No version field exists today.** The current protocol has no way to distinguish signature schemes. Version detection must be based on key/signature length or an explicit version byte.

---

## 2. Proposed Changes

### 2.1 New Types (in poc.ts, eventually in b3nd-encrypt/mod.ts)

```typescript
// Version tag for wire format disambiguation
const enum SignatureVersion {
  CLASSICAL = 0x01,    // Ed25519 only
  HYBRID_V1 = 0x02,    // Ed25519 + ML-DSA-65
}

// Hybrid keypair (extends existing pattern)
interface HybridKeypair {
  classical: { publicKey: Uint8Array; privateKey: CryptoKey };
  pq: { publicKey: Uint8Array; privateKey: Uint8Array };
}

// PQ capability advertisement
interface PQCapability {
  hybridSign: boolean;
  hybridKex: boolean;
  minSignatureVersion: SignatureVersion;
}
```

### 2.2 New Functions

| Function | Purpose |
|---|---|
| `generateHybridKeypair()` | Generate Ed25519 + ML-DSA-65 keypair |
| `hybridSign(message, keypair)` | Dual signature with binding |
| `hybridVerify(message, sig, classicalPub, pqPub)` | Verify both signatures |
| `unifiedVerify(pubkeyHex, sigHex, payload)` | Auto-detect and verify (drop-in for `verify()`) |
| `serializeHybridPublicKey(classical, pq)` | Versioned wire format |
| `serializeHybridSignature(classical, pq)` | Versioned wire format |
| `deserializePublicKey(data)` | Parse versioned key |
| `deserializeSignature(data)` | Parse versioned signature |
| `upgradeToHybrid(classicalKey, classicalPub)` | Migration helper |
| `extractClassicalPublicKey(hybridPubHex)` | Backward compat helper |
| `isHybridKey(pubkeyHex)` | Detection helper |
| `negotiateSignatureVersion(local, remote)` | Version negotiation |
| `HybridIdentityKey` class | Drop-in for `IdentityKey` |

### 2.3 Modified Functions

Only **2 functions** need modification in the existing codebase:

#### `verify()` in b3nd-encrypt/mod.ts

**Change:** Replace with `unifiedVerify()` or add length-based dispatch.

```typescript
// BEFORE (current):
export async function verify<T>(pubkeyHex, signatureHex, payload): Promise<boolean> {
  // ... always Ed25519
}

// AFTER (hybrid-aware):
export async function verify<T>(pubkeyHex, signatureHex, payload): Promise<boolean> {
  const pubBytes = decodeHex(pubkeyHex);
  if (pubBytes.length === 32) {
    // Classical path (unchanged)
    return classicalVerify(pubkeyHex, signatureHex, payload);
  }
  // Hybrid path
  return hybridVerifyPayload(pubkeyHex, signatureHex, payload);
}
```

**Breaking change surface:** None. Classical keys (32 bytes / 64 hex chars) take the existing code path. Only longer keys trigger the new path.

#### `validateAuthMessage()` in b3nd-auth/mod.ts

**Change:** Add hybrid key matching against classical ACL entries.

```typescript
// In the authorization check loop, add:
if (!authorizedPubkeys.has(auth.pubkey) && isHybridKey(auth.pubkey)) {
  const classicalPub = extractClassicalPublicKey(auth.pubkey);
  if (authorizedPubkeys.has(classicalPub)) {
    isAuthorized = true;  // Hybrid key's Ed25519 component matches ACL
  }
}
```

**Breaking change surface:** None. This is additive — it allows hybrid keys to match classical ACL entries. Classical behavior is unchanged.

### 2.4 Unmodified Functions

All other functions continue to work because they treat pubkeys and signatures as opaque hex strings:

| Function | Why it works unchanged |
|---|---|
| `sign()` / `signWithHex()` | Only produces classical signatures; hybrid nodes use `HybridIdentityKey.sign()` instead |
| `signPayload()` | Delegates to `IdentityKey.sign()`; hybrid version delegates to `HybridIdentityKey.sign()` |
| `verifyPayload()` | Calls `verify()` per entry; if `verify()` is updated, this works automatically |
| `createAuthenticatedMessage()` | Constructs `{ auth, payload }` — works with any string pubkey/sig |
| `createPubkeyBasedAccess()` | Extracts first path component as pubkey string — URIs will still use classical 64-char pubkeys |
| `createRelativePathAccess()` | Reads pubkey strings from storage — can store either classical or hybrid keys |
| `createCombinedAccess()` | Merges pubkey sets — no length assumptions |
| `authValidation()` | Factory wrapper — delegates to `validateAuthMessage()` |

---

## 3. Wire Format Diff

### 3.1 Hybrid Public Key Layout

```
Offset  Size     Field
------  ------   -----
0       1        Version byte (0x02 = HYBRID_V1)
1       32       Ed25519 public key
33      1952     ML-DSA-65 public key
------  ------
Total:  1985 bytes (3970 hex chars)
```

Classical public key for comparison: 32 bytes (64 hex chars).

### 3.2 Hybrid Signature Layout

```
Offset  Size     Field
------  ------   -----
0       1        Version byte (0x02 = HYBRID_V1)
1       64       Ed25519 signature (over message || pqSig)
65      3309     ML-DSA-65 signature (over message)
------  ------
Total:  3374 bytes (6748 hex chars)
```

Classical signature for comparison: 64 bytes (128 hex chars).

### 3.3 Signature Binding

The Ed25519 signature does NOT sign the raw message. It signs `message || pqSignature`. This binding prevents an attacker from:

1. Stripping the PQ signature and reusing the Ed25519 signature alone
2. Replacing the PQ signature with a different one

Verification order:
1. Parse pqSig and classicalSig from the wire format
2. Verify pqSig against `message` using ML-DSA-65
3. Verify classicalSig against `message || pqSig` using Ed25519
4. Both MUST pass

### 3.4 Message Size Impact

Current `AuthenticatedMessage` with one signer and a small payload:

```json
{
  "auth": [{
    "pubkey": "a1b2...64chars...",
    "signature": "c3d4...128chars..."
  }],
  "payload": { "message": "hello" }
}
```

Approximate JSON size: ~230 bytes

With hybrid:

```json
{
  "auth": [{
    "pubkey": "02a1b2...3970chars...",
    "signature": "02c3d4...6748chars..."
  }],
  "payload": { "message": "hello" }
}
```

Approximate JSON size: ~10,800 bytes

| Component | Classical (bytes) | Hybrid (bytes) | Delta |
|---|---|---|---|
| pubkey field (hex string) | 64 | 3,970 | +3,906 |
| signature field (hex string) | 128 | 6,748 | +6,620 |
| Total auth entry overhead | 192 | 10,718 | +10,526 |
| Raw binary overhead (not hex) | 96 | 5,359 | +5,263 |

Note: hex encoding doubles the binary size. If the protocol moved to base64 encoding for hybrid entries, the overhead would be reduced by ~25%.

### 3.5 Impact on MutableWritePayload / MessageData

The `AuthenticatedMessage<T>` type is generic over `T`. The `auth` array entries are `{ pubkey: string, signature: string }`. Since these are already `string` typed, hybrid values fit without type changes.

The real impact is on:

1. **Transport MTU**: A hybrid signature (3,374 bytes binary, 6,748 hex chars) exceeds a standard 1,500-byte Ethernet MTU. The transport layer must handle fragmentation.

2. **Storage**: Each signed record grows by ~5 KB. For a protocol with many small records, this is significant. Consider compression (hybrid signatures compress well — ML-DSA-65 signatures have ~30% redundancy).

3. **URIs**: Public keys should NOT be embedded in URIs as hybrid keys. Classical 32-byte Ed25519 keys (64 hex chars) fit in URIs. Hybrid 1,985-byte keys (3,970 hex chars) do not. Use key discovery or key servers for PQ keys.

---

## 4. Migration Strategy

### Phase 1: Prepare the Wire Format (v1.0)

**No hybrid signatures yet.** Changes to ship:

1. Update `verify()` to handle variable-length keys (dispatch on length).
2. Update `validateAuthMessage()` to support hybrid key matching.
3. Add `isHybridKey()` and `extractClassicalPublicKey()` helpers.
4. Add `PQCapability` type and version negotiation.
5. Ship `mldsa-wasm` as an optional dependency (not required).

**Effort:** Small. No breaking changes. All classical-only nodes continue to work.

**Why now:** Nodes running v1.0 can already VERIFY hybrid signatures if they encounter one. They cannot PRODUCE them yet, but they won't reject them. This ensures forward compatibility.

### Phase 2: Opt-in Hybrid Signing (v1.1)

1. Add `HybridIdentityKey` class.
2. Add `generateHybridKeypair()` and `upgradeToHybrid()`.
3. Nodes that opt in generate a hybrid keypair and advertise `hybridSign: true` in their capabilities.
4. Hybrid nodes produce dual signatures for messages to other hybrid nodes.
5. When sending to classical-only nodes, hybrid nodes produce classical-only signatures.
6. `mldsa-wasm` becomes a required dependency.

**Key migration UX:**
```
1. Node generates hybrid keypair (preserving existing Ed25519 identity)
2. Node publishes hybrid public key at /.well-known/capabilities
3. Node starts signing with hybrid for peers that support it
4. Existing ACLs continue to work (hybrid key matches via Ed25519 component)
```

### Phase 3: Mandatory Hybrid (v2.0)

1. `minSignatureVersion: HYBRID_V1` becomes the default.
2. Classical-only signatures are rejected by hybrid nodes.
3. Grace period: nodes that haven't upgraded get a deprecation warning for 6 months before enforcement.
4. Once browser WebCrypto ships ML-DSA (expected 2027), drop `mldsa-wasm` in favor of native.

---

## 5. Coexistence Protocol

### How classical-only and hybrid nodes interact

| Sender | Receiver | Behavior |
|---|---|---|
| Classical | Classical | Unchanged. Ed25519 only. |
| Classical | Hybrid | Hybrid node accepts classical signatures (version >= CLASSICAL). |
| Hybrid | Classical | Hybrid node sends classical-only signature (detects peer lacks hybrid support via capability check). |
| Hybrid | Hybrid | Both sides use hybrid signatures. |

### Mixed-network message flow

```
Alice (hybrid) -> Network -> Bob (classical)
  1. Alice checks Bob's capabilities: { hybridSign: false }
  2. Alice signs with classicalSign() only (Ed25519)
  3. Bob verifies normally

Alice (hybrid) -> Network -> Carol (hybrid)
  1. Alice checks Carol's capabilities: { hybridSign: true }
  2. Alice signs with hybridSign() (Ed25519 + ML-DSA-65)
  3. Carol verifies both signatures
```

### Broadcast / multi-recipient messages

For broadcast messages where recipients have mixed capabilities:

**Option A (recommended):** Include BOTH a classical and a hybrid auth entry:
```json
{
  "auth": [
    { "pubkey": "a1b2...64chars...", "signature": "c3d4...128chars..." },
    { "pubkey": "02a1b2...3970chars...", "signature": "02c3d4...6748chars..." }
  ],
  "payload": { ... }
}
```
Classical nodes verify the first entry. Hybrid nodes verify the second. The existing `validateAuthMessage()` logic already stops at the first valid entry.

**Option B:** Include only the hybrid entry. Classical nodes that have been updated to v1.0 (Phase 1) can extract the Ed25519 component and verify classically. Classical nodes that have NOT been updated reject the message.

**Recommendation:** Use Option A during the transition period (Phase 2). Switch to Option B in Phase 3 when classical-only nodes are deprecated.

### ACL compatibility

Existing access control lists store classical Ed25519 pubkeys (64 hex chars). When a hybrid node presents its hybrid public key (3,970 hex chars), the `validateHybridAuthMessage()` function extracts the Ed25519 component and checks it against the ACL. This means:

- **No ACL migration required.** Existing ACLs work immediately.
- **New ACLs can store hybrid keys** for nodes that want to enforce PQ verification.
- **Pubkey-based path access** (first path component = owner pubkey) continues to use classical 64-char pubkeys in URIs. The hybrid key is discoverable via `/.well-known/capabilities`.

---

## 6. Version Negotiation

### Capability Advertisement

Each node publishes its PQ capabilities at a well-known location:

```
b3nd://<classical-pubkey-hex>/.well-known/capabilities
```

Contents:
```json
{
  "pq": {
    "hybridSign": true,
    "hybridKex": false,
    "minSignatureVersion": 1
  }
}
```

`minSignatureVersion` values:
- `1` (CLASSICAL): accepts classical-only signatures
- `2` (HYBRID_V1): requires hybrid signatures (rejects classical-only)

### Negotiation Algorithm

```
function negotiate(local, remote):
  if local.minVersion == HYBRID and not remote.hybridSign:
    return INCOMPATIBLE
  if remote.minVersion == HYBRID and not local.hybridSign:
    return INCOMPATIBLE
  if local.hybridSign and remote.hybridSign:
    return HYBRID_V1
  return CLASSICAL
```

### Handshake Integration

The capability check happens BEFORE message exchange begins. In b3nd's protocol:

1. Node A reads Node B's capabilities from its well-known URI.
2. Node A determines the signature version to use.
3. Node A signs messages accordingly.

This is a **pull model** (read remote capabilities) rather than a push model (exchange capabilities in a handshake). It works because b3nd already has URI-based node discovery.

For real-time sessions (if b3nd adds WebSocket or similar), capabilities should be exchanged in the session handshake.

---

## 7. Security Analysis

### 7.1 No Downgrade Attacks

**Threat:** An attacker strips the PQ signature from a hybrid message, leaving only the Ed25519 signature, and presents it as a classical message.

**Mitigation:** The Ed25519 signature is computed over `message || pqSignature`, not just `message`. If the PQ signature is stripped, the Ed25519 signature no longer verifies against the raw message. A classical verifier checking just the Ed25519 component against the raw message will reject it.

**Caveat:** This means a classical-only node CANNOT verify a hybrid signature's Ed25519 component directly. This is intentional — it forces the coexistence protocol (dual auth entries) rather than allowing silent downgrades.

### 7.2 Signature Binding

The binding `Ed25519.sign(message || pqSig)` ensures:

1. **The PQ signature is committed to by the classical signature.** Replacing the PQ signature invalidates the Ed25519 signature.
2. **The classical signature is NOT committed to by the PQ signature.** This is acceptable because ML-DSA-65 is the stronger scheme (quantum-resistant). If an attacker can forge Ed25519 signatures (requires a quantum computer), they cannot forge the ML-DSA-65 signature.
3. **Neither signature can be reused across messages.** Both are bound to the message content.

Alternative binding strategies considered:

| Strategy | Pros | Cons |
|---|---|---|
| `Ed25519.sign(msg \|\| pqSig)` (chosen) | Simple, one-directional binding | PQ sig doesn't bind to classical sig |
| `Both sign(msg \|\| hash(otherSig))` | Mutual binding | Circular dependency; requires two passes |
| `Both sign(msg \|\| version \|\| lengths)` | Both sign the same augmented message | No cryptographic binding between sigs |
| `hash(classicalSig \|\| pqSig)` as nonce | Strong binding via combined hash | Requires hash computation, more complex |

The chosen strategy (`Ed25519.sign(msg || pqSig)`) matches the approach used in the IETF draft for composite signatures (draft-ietf-lamps-pq-composite-sigs) and is the simplest correct option.

### 7.3 Key Separation

The Ed25519 and ML-DSA-65 keys are generated independently. There is no shared seed or derivation relationship between them. This is important because:

- A compromise of one key type does not leak information about the other.
- The `upgradeToHybrid()` migration generates a fresh ML-DSA-65 key — it cannot be derived from the existing Ed25519 key.

### 7.4 Quantum Threat Model

| Attack | Classical Only | Hybrid |
|---|---|---|
| Classical computer forges Ed25519 | Infeasible (128-bit security) | Still infeasible |
| Quantum computer forges Ed25519 | **Feasible** (Shor's algorithm) | Blocked by ML-DSA-65 |
| Quantum computer forges ML-DSA-65 | N/A | Infeasible (Category 3 / 128-bit PQ) |
| Classical computer forges ML-DSA-65 | N/A | Infeasible (based on Module-LWE hardness) |

Hybrid provides security as long as **at least one** scheme remains unbroken. This is the standard rationale for hybrid post-quantum cryptography during the transition period.

### 7.5 Replay and Substitution

Replay protection is NOT the responsibility of the signature scheme — it is handled by the b3nd protocol's message sequencing / timestamps. The hybrid scheme does not weaken existing replay protections.

Substitution attacks (swapping a valid signature between messages) are prevented by both signatures covering the message content. The Ed25519 binding additionally covers the PQ signature bytes.

---

## 8. Recommendation

### Phased Rollout Plan for D7

| Phase | Version | Timeline | Changes | Risk |
|---|---|---|---|---|
| **0: Forward-compat prep** | v1.0 | Immediate | Update `verify()` for variable-length dispatch. Add `isHybridKey()`, `extractClassicalPublicKey()`. No new dependencies. | None. Purely additive. |
| **1: Opt-in hybrid** | v1.1 | Q3 2026 | Add `HybridIdentityKey`, `mldsa-wasm` dependency, capability advertisement. Hybrid signing for peers that support it. Dual auth entries for broadcast. | Low. Classical fallback always available. |
| **2: Hybrid preferred** | v1.2 | Q1 2027 | Default to hybrid signing. Classical-only as fallback for legacy nodes. Deprecation warnings for classical-only nodes. | Medium. Legacy nodes see warnings. |
| **3: Hybrid mandatory** | v2.0 | Q3 2027+ | Reject classical-only signatures. Drop `mldsa-wasm` when WebCrypto ships ML-DSA natively. | High. Breaks non-upgraded nodes. Requires ecosystem readiness. |

### Implementation Priority

1. **Phase 0 should ship with v1.0.** The changes are trivial (a length check in `verify()`, two helper functions) and cost nothing. They ensure that v1.0 nodes can already accept hybrid signatures from future v1.1 nodes.

2. **Phase 1 is the critical milestone.** It requires integrating `mldsa-wasm` (21 KB gzipped), implementing the `HybridIdentityKey` class, and updating the capability system. Estimated effort: 2-3 days for a developer familiar with the auth module.

3. **Phases 2 and 3 are policy decisions**, not engineering ones. The code is the same — only the defaults change.

### Open Questions for D7

1. **Should hybrid keys be stored in the same key storage as classical keys, or in a separate PQ keystore?** Recommendation: same storage, tagged with version.

2. **Should the wire format use hex encoding for hybrid signatures (6,748 chars) or switch to base64 (4,499 chars)?** Recommendation: base64 for hybrid entries, with a format indicator. This saves ~33% wire overhead.

3. **Should broadcast messages use dual auth entries (Option A) or hybrid-only (Option B)?** Recommendation: dual entries during Phase 1-2, hybrid-only in Phase 3.

4. **What is the maximum acceptable message size?** A hybrid-signed message with a small payload is ~5 KB binary. If the protocol has a message size limit, it may need to increase.

---

## Appendix A: Code Reference

The proof-of-concept implementation is in:

```
research/round-3/e8-hybrid-signature/poc.ts
```

Key sections:
- Lines 1-40: Constants and imports
- Lines 42-120: Type definitions
- Lines 122-180: PQ stub namespace (replace with mldsa-wasm in production)
- Lines 182-220: Key generation
- Lines 222-320: Wire format serialization/deserialization
- Lines 322-400: `hybridSign()` and `hybridVerify()`
- Lines 402-460: `unifiedVerify()` — drop-in replacement for existing `verify()`
- Lines 462-520: Migration helpers
- Lines 522-580: `HybridIdentityKey` class
- Lines 582-640: Version negotiation
- Lines 642-700: Compatibility wrappers for `signPayload()` / `verifyPayload()`

## Appendix B: Size Reference (from E1)

| Artifact | Size |
|---|---|
| Ed25519 public key | 32 bytes |
| Ed25519 signature | 64 bytes |
| ML-DSA-65 public key | 1,952 bytes |
| ML-DSA-65 private key | 4,032 bytes |
| ML-DSA-65 signature | 3,309 bytes |
| Hybrid public key (versioned) | 1,985 bytes |
| Hybrid signature (versioned) | 3,374 bytes |
| mldsa-wasm bundle (gzipped) | 21 KB |

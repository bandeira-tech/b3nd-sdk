# Firecat Wire Format Specification

**Round 4, Stream 5 — Wire Format**
**Date:** 2026-03-16
**Resolves:** Open item #4 from S1 (base64 vs hex encoding), open item #5 from Decision Brief

---

## 1. Encoding Decision: Base64url for Binary Data

### 1.1 Analysis

Three encoding schemes were evaluated for representing binary cryptographic material (keys, signatures, ciphertexts) in the firecat wire format.

| Property | Raw binary | Hex | Base64 | Base64url |
|----------|-----------|-----|--------|-----------|
| Size expansion | 1.0x | 2.0x | 1.33x | 1.33x |
| JSON compatible | No | Yes | Yes | Yes |
| URI safe | No | No | No (+ / =) | Yes |
| Human readable | No | Yes | Partially | Partially |
| Debuggable | Requires tooling | Copy-paste to CLI | Decode step needed | Decode step needed |
| Ecosystem support | Universal | Universal | Universal | Universal |

### 1.2 Size Impact on Hybrid PQ Signatures

The encoding choice has a material impact on hybrid messages. Per E8, a single hybrid signature is 3,374 bytes raw (1 version byte + 64 Ed25519 + 3,309 ML-DSA-65):

| Encoding | Signature (chars) | Public key (chars) | Auth entry total | Savings vs hex |
|----------|-------------------|--------------------|-----------------:|---------------:|
| Hex | 6,748 | 3,970 | 10,718 | — |
| Base64url | 4,500 | 2,648 | 7,148 | 33.3% |
| Raw binary | 3,374 | 1,985 | 5,359 | 50.0% |

For a committee confirmation with K=7 hybrid signatures (v1.1):

| Encoding | 7 signatures | Savings vs hex |
|----------|-------------:|---------------:|
| Hex | 47,236 chars | — |
| Base64url | 31,500 chars | 15,736 chars (33%) |

With FROST threshold signatures (recommended by S1), a single threshold hybrid signature:

| Encoding | 1 FROST signature | Savings vs hex |
|----------|------------------:|---------------:|
| Hex | 6,748 chars | — |
| Base64url | 4,500 chars | 2,248 chars (33%) |

### 1.3 Decision

**Protocol-wide encoding: base64url (RFC 4648 Section 5), no padding.**

Rationale:

1. **33% smaller than hex.** At 3,374 bytes per hybrid signature, the difference between hex (6,748 chars) and base64url (4,500 chars) is 2,248 characters per signature. Over a confirmation with K=7 individual signatures, that is 15,736 characters saved. This compounds with every attestation, confirmation, and slot manifest.

2. **URI safe.** Classical Ed25519 pubkeys are embedded in URIs (`mutable://accounts/{pubkey}/...`). Base64url uses only `[A-Za-z0-9_-]`, which are unreserved URI characters (RFC 3986). Hex is also URI-safe, but at 2x the length. No percent-encoding is ever needed with base64url.

3. **JSON native.** Base64url strings are valid JSON string values without escaping. Raw binary is not representable in JSON. The existing `AuthenticatedMessage<T>` type uses `{ pubkey: string, signature: string }`, and base64url strings slot directly into this schema.

4. **One encoding everywhere.** Using a single encoding for all binary data (keys, signatures, ciphertexts, nonces, hashes) eliminates the class of bugs where a hex value is accidentally treated as base64 or vice versa. Prior art: JOSE/JWT (RFC 7515) uses base64url exclusively for all binary fields.

5. **No padding characters.** Base64url without padding (`=`) avoids issues with URL parameter parsing and query string encoding. Padding is unnecessary when the decoder knows the expected output length (which it does for all fixed-size cryptographic artifacts).

6. **Developer experience.** Hex is more readable in log files and debugging sessions. This is a real cost. Mitigation: the SDK provides `hexEncode()` / `hexDecode()` helpers for debugging output, and log formatters that display both hex and base64url for key fields. The wire format itself uses base64url exclusively.

### 1.4 Migration from Hex

The existing codebase (libs/b3nd-auth, libs/b3nd-encrypt) uses hex encoding for all keys and signatures. The migration path:

1. **Internal functions remain hex-compatible.** `verify()` and `sign()` accept both hex and base64url, detected by character set (`[0-9a-f]` vs `[A-Za-z0-9_-]`).
2. **Wire format is base64url only.** All messages transmitted over the network use base64url.
3. **Storage format is base64url.** Records written to storage use base64url.
4. **SDK API accepts both, normalizes to base64url.** Input functions accept hex or base64url. Output functions always return base64url.

### 1.5 Encoding Helpers

```
encode(bytes: Uint8Array) -> string    // base64url, no padding
decode(str: string) -> Uint8Array      // auto-detect hex or base64url
isHex(str: string) -> boolean          // matches /^[0-9a-f]+$/i
isBase64url(str: string) -> boolean    // matches /^[A-Za-z0-9_-]+$/
```

---

## 2. Common Header Format

All firecat wire messages share a common header. The header is a fixed-size binary structure serialized as a JSON object on the wire.

### 2.1 Header Fields

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    Version    |     Type      |   CryptoSuite |   Reserved    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Timestamp                             |
|                         (8 bytes, ms since Unix epoch)        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Payload Length                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Fee (8 bytes, uint64 microUSD)         |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
Total header: 24 bytes
```

### 2.2 Field Definitions

| Field | Offset | Size | Type | Values |
|-------|--------|------|------|--------|
| Version | 0 | 1 byte | uint8 | `0x01` = v1.0 (classical + hybrid KE), `0x02` = v1.1 (hybrid sigs) |
| Type | 1 | 1 byte | uint8 | See Section 2.3 |
| CryptoSuite | 2 | 1 byte | uint8 | `0x01` = Classical (Ed25519/X25519), `0x02` = Hybrid-v1 (Ed25519+ML-DSA-65 / X25519+ML-KEM-768), `0x03` = reserved (future PQ-only) |
| Reserved | 3 | 1 byte | uint8 | Must be `0x00`. Ignored by parsers. Available for future use. |
| Timestamp | 4 | 8 bytes | uint64 BE | Milliseconds since Unix epoch (1970-01-01T00:00:00Z) |
| Payload Length | 12 | 4 bytes | uint32 BE | Length of the payload section in bytes (max ~4 GB) |
| Fee | 16 | 8 bytes | uint64 BE | Fee amount in microUSD (1 USD = 1,000,000 microUSD). 0 for messages with no fee (Tier 0/1, padding, consensus). |

### 2.3 Message Types

| Value | Type | Description |
|-------|------|-------------|
| `0x01` | USER_MESSAGE | User-submitted message (send) |
| `0x02` | ATTESTATION | Validator attestation of a pending message |
| `0x03` | COMMITTEE_VOTE | Individual committee member vote on confirmation |
| `0x04` | CONFIRMATION | Aggregated committee confirmation |
| `0x05` | SLOT_MANIFEST | Slot manifest listing confirmed messages |
| `0x06` | PADDING | Constant-rate padding message (structurally identical to USER_MESSAGE) |
| `0x07` | CAPABILITY | Capability advertisement (PQ support, node role) |
| `0x08`-`0xFF` | Reserved | Future message types |

### 2.4 JSON Wire Representation

On the HTTPS transport, the header is serialized as a JSON object embedded in the message envelope:

```json
{
  "header": {
    "v": 1,
    "type": 1,
    "crypto": 1,
    "ts": 1742134997000,
    "len": 530,
    "fee": 2000
  },
  ...
}
```

Short field names minimize JSON overhead. The `fee` field is in microUSD (integer), so `2000` = $0.002.

---

## 3. Message Wire Formats

### 3.1 User Message (Type 0x01) and Padding Message (Type 0x06)

User messages and padding messages share identical structure. Padding messages use type `0x06` and target `immutable://padding/{random_id}`. Storage nodes distinguish them by type field and URI prefix; external observers cannot differentiate them on the wire.

```
+--------------------------------------------------+
|  Header (24 bytes)                               |
+--------------------------------------------------+
|  URI (length-prefixed UTF-8 string)              |
|    2 bytes: URI length (uint16 BE)               |
|    N bytes: URI string                           |
+--------------------------------------------------+
|  Auth array                                      |
|    1 byte:  auth entry count                     |
|    For each entry:                               |
|      2 bytes: pubkey length (uint16 BE)          |
|      N bytes: pubkey (base64url)                 |
|      2 bytes: signature length (uint16 BE)       |
|      N bytes: signature (base64url)              |
+--------------------------------------------------+
|  Encrypted Payload                               |
|    Ephemeral public key:                         |
|      2 bytes: length (uint16 BE)                 |
|      N bytes: ephemeral X25519 pubkey (base64url)|
|    KEM ciphertext (present if hybrid KE):        |
|      2 bytes: length (uint16 BE, 0 if absent)    |
|      N bytes: ML-KEM-768 ciphertext (base64url)  |
|    Nonce:                                        |
|      1 byte: length (always 12)                  |
|      12 bytes: AES-GCM nonce (raw bytes)         |
|    Ciphertext:                                   |
|      4 bytes: length (uint32 BE)                 |
|      N bytes: AES-256-GCM ciphertext             |
+--------------------------------------------------+
```

#### JSON Wire Representation

```json
{
  "header": { "v": 1, "type": 1, "crypto": 1, "ts": 1742134997000, "len": 530, "fee": 2000 },
  "uri": "mutable://accounts/q7Hk9f...Ed25519pubkey.../a3Bc_obfuscated",
  "auth": [
    {
      "pubkey": "<base64url Ed25519 pubkey, 43 chars>",
      "signature": "<base64url Ed25519 signature, 86 chars>"
    }
  ],
  "payload": {
    "epk": "<base64url ephemeral X25519 pubkey, 43 chars>",
    "kem": "<base64url ML-KEM-768 ciphertext, 1451 chars, or null>",
    "nonce": "<base64url 12-byte nonce, 16 chars>",
    "data": "<base64url AES-256-GCM ciphertext>"
  }
}
```

### 3.2 Attestation (Type 0x02)

Validators produce attestations after independently verifying a pending message.

```
+--------------------------------------------------+
|  Header (24 bytes)                               |
|    type = 0x02, fee = 0                          |
+--------------------------------------------------+
|  Message hash (32 bytes SHA-256, base64url)      |
|    43 chars base64url                            |
+--------------------------------------------------+
|  Validator public key                            |
|    2 bytes: length (uint16 BE)                   |
|    N bytes: pubkey (base64url)                   |
+--------------------------------------------------+
|  Validator signature (over: msg_hash || slot)    |
|    2 bytes: length (uint16 BE)                   |
|    N bytes: signature (base64url)                |
+--------------------------------------------------+
|  Slot number                                     |
|    4 bytes: epoch (uint32 BE)                    |
|    2 bytes: slot within epoch (uint16 BE)        |
+--------------------------------------------------+
|  Vote                                            |
|    1 byte: 0x01 = ATTEST, 0x02 = REJECT          |
+--------------------------------------------------+
|  Rejection reason (present only if vote=REJECT)  |
|    2 bytes: reason code (uint16 BE)              |
|    2 bytes: detail length (uint16 BE)            |
|    N bytes: detail string (UTF-8)                |
+--------------------------------------------------+
```

#### JSON Wire Representation

```json
{
  "header": { "v": 1, "type": 2, "crypto": 1, "ts": 1742134998000, "len": 0, "fee": 0 },
  "msgHash": "<base64url SHA-256, 43 chars>",
  "validator": "<base64url pubkey>",
  "signature": "<base64url signature over msgHash||slot>",
  "slot": { "epoch": 1742, "slot": 157 },
  "vote": "attest"
}
```

### 3.3 Committee Vote (Type 0x03)

Individual committee member votes during the confirmation phase.

```
+--------------------------------------------------+
|  Header (24 bytes)                               |
|    type = 0x03, fee = 0                          |
+--------------------------------------------------+
|  Message hash (32 bytes SHA-256, base64url)      |
+--------------------------------------------------+
|  Committee member public key                     |
|    2 bytes: length (uint16 BE)                   |
|    N bytes: pubkey (base64url)                   |
+--------------------------------------------------+
|  Committee member signature                      |
|    2 bytes: length (uint16 BE)                   |
|    N bytes: signature (base64url)                |
+--------------------------------------------------+
|  Vote                                            |
|    1 byte: 0x01 = CONFIRM, 0x02 = REJECT         |
+--------------------------------------------------+
|  Attestation count                               |
|    1 byte: number of attestations observed       |
+--------------------------------------------------+
|  VRF proof (proves committee membership)         |
|    2 bytes: length (uint16 BE)                   |
|    N bytes: VRF proof (base64url)                |
+--------------------------------------------------+
```

#### JSON Wire Representation

```json
{
  "header": { "v": 1, "type": 3, "crypto": 1, "ts": 1742134999000, "len": 0, "fee": 0 },
  "msgHash": "<base64url SHA-256, 43 chars>",
  "member": "<base64url pubkey>",
  "signature": "<base64url signature>",
  "vote": "confirm",
  "attestCount": 5,
  "vrfProof": "<base64url VRF proof>"
}
```

### 3.4 Confirmation (Type 0x04)

The aggregated confirmation record, written after T-of-K committee members agree.

```
+--------------------------------------------------+
|  Header (24 bytes)                               |
|    type = 0x04, fee = 0                          |
+--------------------------------------------------+
|  Message hash (32 bytes SHA-256, base64url)      |
+--------------------------------------------------+
|  Slot assignment                                 |
|    4 bytes: epoch (uint32 BE)                    |
|    2 bytes: slot within epoch (uint16 BE)        |
+--------------------------------------------------+
|  Threshold signature (FROST)                     |
|    2 bytes: length (uint16 BE)                   |
|    N bytes: FROST threshold signature (base64url)|
+--------------------------------------------------+
|  Committee roster hash                           |
|    32 bytes: SHA-256 hash of committee pubkeys   |
+--------------------------------------------------+
|  Attestation summary                             |
|    1 byte: total attestation count               |
|    1 byte: confirm count                         |
|    1 byte: reject count                          |
+--------------------------------------------------+
```

#### JSON Wire Representation

```json
{
  "header": { "v": 1, "type": 4, "crypto": 1, "ts": 1742135000000, "len": 0, "fee": 0 },
  "msgHash": "<base64url SHA-256, 43 chars>",
  "slot": { "epoch": 1742, "slot": 157 },
  "thresholdSig": "<base64url FROST signature>",
  "committeeHash": "<base64url SHA-256, 43 chars>",
  "attestations": { "total": 7, "confirm": 6, "reject": 1 }
}
```

### 3.5 Slot Manifest (Type 0x05)

Written by the slot proposer, bundles all confirmed messages for a slot.

```
+--------------------------------------------------+
|  Header (24 bytes)                               |
|    type = 0x05, fee = 0                          |
+--------------------------------------------------+
|  Era                                             |
|    2 bytes: era number (uint16 BE)               |
+--------------------------------------------------+
|  Epoch                                           |
|    4 bytes: epoch number (uint32 BE)             |
+--------------------------------------------------+
|  Slot                                            |
|    2 bytes: slot number within epoch (uint16 BE) |
+--------------------------------------------------+
|  Previous slot hash                              |
|    32 bytes: SHA-256 hash of previous manifest   |
+--------------------------------------------------+
|  State root                                      |
|    32 bytes: Merkle root of confirmed state      |
+--------------------------------------------------+
|  Message list                                    |
|    2 bytes: message count (uint16 BE)            |
|    For each message:                             |
|      32 bytes: message hash (SHA-256)            |
+--------------------------------------------------+
|  Proposer public key                             |
|    2 bytes: length (uint16 BE)                   |
|    N bytes: pubkey (base64url)                   |
+--------------------------------------------------+
|  Proposer signature (over entire manifest)       |
|    2 bytes: length (uint16 BE)                   |
|    N bytes: signature (base64url)                |
+--------------------------------------------------+
|  Committee threshold signature                   |
|    2 bytes: length (uint16 BE)                   |
|    N bytes: FROST threshold signature (base64url)|
+--------------------------------------------------+
```

#### JSON Wire Representation

```json
{
  "header": { "v": 1, "type": 5, "crypto": 1, "ts": 1742135001000, "len": 0, "fee": 0 },
  "era": 0,
  "epoch": 1742,
  "slot": 157,
  "prevSlotHash": "<base64url SHA-256, 43 chars>",
  "stateRoot": "<base64url Merkle root, 43 chars>",
  "messages": [
    "<base64url SHA-256, 43 chars>",
    "<base64url SHA-256, 43 chars>"
  ],
  "proposer": "<base64url pubkey>",
  "proposerSig": "<base64url signature>",
  "committeeSig": "<base64url FROST threshold signature>"
}
```

---

## 4. Size Budget Analysis

### 4.1 Primitive Sizes Reference

From E1 and E8:

| Artifact | Raw (bytes) | Hex (chars) | Base64url (chars) |
|----------|------------:|------------:|------------------:|
| Ed25519 public key | 32 | 64 | 43 |
| Ed25519 signature | 64 | 128 | 86 |
| ML-DSA-65 public key | 1,952 | 3,904 | 2,603 |
| ML-DSA-65 signature | 3,309 | 6,618 | 4,412 |
| Hybrid public key (versioned) | 1,985 | 3,970 | 2,647 |
| Hybrid signature (versioned) | 3,374 | 6,748 | 4,499 |
| X25519 public key | 32 | 64 | 43 |
| ML-KEM-768 ciphertext | 1,088 | 2,176 | 1,451 |
| SHA-256 hash | 32 | 64 | 43 |
| AES-GCM nonce | 12 | 24 | 16 |
| FROST threshold sig (Ed25519) | 64 | 128 | 86 |
| FROST threshold sig (hybrid) | 3,374 | 6,748 | 4,499 |

### 4.2 User Message Size Budget

Assumes a 500-byte plaintext payload, single signer, JSON wire format with base64url encoding.

| Component | Classical | Hybrid PQ | Notes |
|-----------|----------:|----------:|-------|
| **Header (JSON)** | 85 | 85 | `{"header":{"v":1,"type":1,"crypto":1,"ts":1742134997000,"len":530,"fee":2000}}` |
| **URI** | 130 | 130 | `mutable://accounts/{43-char-pubkey}/{32-char-obfuscated}` |
| **Auth: pubkey** | 43 | 2,647 | Ed25519: 43 chars; Hybrid: 2,647 chars |
| **Auth: signature** | 86 | 4,499 | Ed25519: 86 chars; Hybrid: 4,499 chars |
| **Auth: JSON overhead** | 55 | 55 | `{"auth":[{"pubkey":"...","signature":"..."}]}` |
| **Payload: epk** | 43 | 43 | X25519 ephemeral (always classical size on wire) |
| **Payload: KEM ct** | 0 | 1,451 | ML-KEM-768 ciphertext (absent in classical-only) |
| **Payload: nonce** | 16 | 16 | 12-byte nonce base64url |
| **Payload: ciphertext** | ~710 | ~710 | 500B plaintext + AES-GCM tag + base64url expansion |
| **Payload: JSON overhead** | 65 | 80 | Field names and delimiters |
| **Fee metadata** | 30 | 30 | Already in header |
| **JSON envelope** | 20 | 20 | Outer braces and commas |
| **Total** | **~1,283** | **~9,766** | |

| Metric | Value |
|--------|------:|
| Classical total | ~1,283 bytes |
| Hybrid PQ total | ~9,766 bytes |
| Absolute overhead | +8,483 bytes |
| Percentage overhead | +661% |
| Primary cost | Auth entry (pubkey + sig): 7,017 of 8,483 byte increase (83%) |

### 4.3 Attestation Size Budget

| Component | Classical | Hybrid PQ | Notes |
|-----------|----------:|----------:|-------|
| Header (JSON) | 80 | 80 | |
| Message hash | 43 | 43 | SHA-256 base64url |
| Validator pubkey | 43 | 2,647 | |
| Validator signature | 86 | 4,499 | Over msgHash \|\| slot |
| Slot (epoch + slot) | 20 | 20 | JSON numbers |
| Vote | 8 | 8 | `"attest"` |
| JSON overhead | 70 | 70 | |
| **Total** | **~350** | **~7,367** | |

| Metric | Value |
|--------|------:|
| Absolute overhead | +7,017 bytes |
| Percentage overhead | +2,005% |

### 4.4 Committee Vote Size Budget

| Component | Classical | Hybrid PQ | Notes |
|-----------|----------:|----------:|-------|
| Header (JSON) | 80 | 80 | |
| Message hash | 43 | 43 | |
| Member pubkey | 43 | 2,647 | |
| Member signature | 86 | 4,499 | |
| Vote | 10 | 10 | `"confirm"` |
| Attestation count | 5 | 5 | |
| VRF proof | ~130 | ~130 | VRF proof is ~80 bytes raw |
| JSON overhead | 85 | 85 | |
| **Total** | **~482** | **~7,499** | |

| Metric | Value |
|--------|------:|
| Absolute overhead | +7,017 bytes |
| Percentage overhead | +1,456% |

### 4.5 Confirmation Size Budget

Using FROST threshold signatures (single signature regardless of K):

| Component | Classical | Hybrid PQ | Notes |
|-----------|----------:|----------:|-------|
| Header (JSON) | 80 | 80 | |
| Message hash | 43 | 43 | |
| Slot | 20 | 20 | |
| FROST threshold sig | 86 | 4,499 | Single signature for T-of-K |
| Committee roster hash | 43 | 43 | |
| Attestation summary | 30 | 30 | |
| JSON overhead | 80 | 80 | |
| **Total** | **~382** | **~4,795** | |

| Metric | Value |
|--------|------:|
| Absolute overhead | +4,413 bytes |
| Percentage overhead | +1,155% |

Without FROST (K=7 individual signatures):

| Component | Classical | Hybrid PQ |
|-----------|----------:|----------:|
| 7 individual signatures | 602 | 31,493 |
| 7 individual pubkeys | 301 | 18,529 |
| **Total (sigs+keys only)** | **903** | **50,022** |

FROST reduces the hybrid confirmation from ~50 KB to ~4.5 KB -- an 11x improvement. FROST is essential for hybrid PQ viability at the consensus layer.

### 4.6 Slot Manifest Size Budget

Assumes 10 confirmed messages per slot.

| Component | Classical | Hybrid PQ | Notes |
|-----------|----------:|----------:|-------|
| Header (JSON) | 80 | 80 | |
| Era/epoch/slot | 25 | 25 | |
| Prev slot hash | 43 | 43 | |
| State root | 43 | 43 | |
| 10 message hashes | 450 | 450 | 10 x 43-char base64url + JSON array |
| Proposer pubkey | 43 | 2,647 | |
| Proposer signature | 86 | 4,499 | |
| Committee FROST sig | 86 | 4,499 | |
| JSON overhead | 120 | 120 | |
| **Total** | **~976** | **~12,406** | |

| Metric | Value |
|--------|------:|
| Absolute overhead | +11,430 bytes |
| Percentage overhead | +1,171% |

### 4.7 Summary Table

| Message Type | Classical (bytes) | Hybrid PQ (bytes) | Overhead (bytes) | Overhead (%) |
|-------------|------------------:|------------------:|-----------------:|-------------:|
| User message (500B payload) | 1,283 | 9,766 | +8,483 | +661% |
| Attestation | 350 | 7,367 | +7,017 | +2,005% |
| Committee vote | 482 | 7,499 | +7,017 | +1,456% |
| Confirmation (FROST) | 382 | 4,795 | +4,413 | +1,155% |
| Confirmation (no FROST, K=7) | 1,283 | 50,402 | +49,119 | +3,828% |
| Slot manifest (10 msgs) | 976 | 12,406 | +11,430 | +1,171% |
| Padding | 1,283 | 9,766 | +8,483 | +661% |

### 4.8 Per-Slot Total Wire Cost

One slot processing 10 messages, full consensus pipeline (K=7, FROST):

| Component | Count | Classical total | Hybrid PQ total |
|-----------|------:|----------------:|----------------:|
| User messages | 10 | 12,830 | 97,660 |
| Attestations | 70 (10 msgs x 7 validators) | 24,500 | 515,690 |
| Committee votes | 7 | 3,374 | 52,493 |
| Confirmation | 10 | 3,820 | 47,950 |
| Slot manifest | 1 | 976 | 12,406 |
| **Slot total** | | **45,500** | **726,199** |
| **Per-message average** | | **4,550** | **72,620** |

At 150 slots/minute (2s slot time), sustained throughput:

| Metric | Classical | Hybrid PQ |
|--------|----------:|----------:|
| Wire bandwidth (150 slots/min) | ~6.8 MB/min | ~109 MB/min |
| Wire bandwidth (per hour) | ~410 MB/hr | ~6.5 GB/hr |

This confirms the S1 finding that hybrid PQ bandwidth is the primary constraint. The phased rollout (hybrid sigs opt-in in v1.1, not v1.0) is well-motivated.

---

## 5. Backward Compatibility

### 5.1 Classical Nodes Parsing Hybrid Messages

Classical-only nodes (v1.0 with CryptoSuite=0x01) encounter hybrid messages when the network has mixed node versions. The parsing strategy uses length-based dispatch, as designed in E8.

**Parsing rules for a classical node receiving a hybrid message:**

1. **Read the header.** The `crypto` field is `0x02` (Hybrid-v1). A classical node that implements Phase 0 forward-compatibility recognizes this value.

2. **Parse the auth array.** The pubkey and signature fields are length-prefixed. The classical node reads the length, reads the bytes, and treats them as opaque data.

3. **Extract the classical component.** The hybrid public key starts with version byte `0x02`, followed by the 32-byte Ed25519 component. The classical node reads bytes 1-32 (after base64url decoding) to extract the Ed25519 pubkey. Similarly, the hybrid signature starts with version byte `0x02`, followed by the 64-byte Ed25519 signature.

4. **Verify the classical component.** The node verifies the Ed25519 signature over the message. Note: due to the binding design from E8 (Ed25519 signs `message || pqSig`, not just `message`), a classical node CANNOT independently verify the Ed25519 component of a hybrid signature against the raw message. This is intentional -- it prevents silent downgrade.

5. **Handle the broadcast case.** During the transition period (Phase 2), broadcast messages include dual auth entries: one classical, one hybrid. A classical node verifies the classical entry and ignores the hybrid entry.

**Implementation in `verify()` (from E8):**

```
function verify(pubkeyB64, signatureB64, payload):
  pubBytes = decode(pubkeyB64)
  if pubBytes.length == 32:
    return classicalVerify(pubkeyB64, signatureB64, payload)
  if pubBytes.length == 1985 and pubBytes[0] == 0x02:
    // Hybrid key detected
    if HYBRID_CAPABLE:
      return hybridVerify(pubkeyB64, signatureB64, payload)
    else:
      // Phase 0 forward-compat: skip, look for classical auth entry
      return SKIP_TO_NEXT_AUTH_ENTRY
  return UNKNOWN_KEY_FORMAT
```

### 5.2 Hybrid Nodes Handling Classical Messages

Hybrid nodes (v1.1+, CryptoSuite=0x02) accept classical messages without restriction:

1. **Read the header.** The `crypto` field is `0x01` (Classical).
2. **Parse normally.** Classical pubkeys (43 chars base64url = 32 bytes) and signatures (86 chars base64url = 64 bytes) parse with the same length-prefixed format.
3. **Verify.** The hybrid node calls `verify()`, which dispatches to `classicalVerify()` based on key length.
4. **Accept.** The message is valid if the Ed25519 signature checks out. No PQ verification is required or expected.

### 5.3 Version Negotiation

Version negotiation occurs at two levels:

**Level 1: Capability advertisement (pull model).**

Each node publishes capabilities at `/.well-known/capabilities`:

```json
{
  "protocol": "firecat",
  "version": "1.1.0",
  "crypto": {
    "sign": ["classical", "hybrid-v1"],
    "kex": ["classical", "hybrid-v1"],
    "minAcceptedVersion": "classical"
  }
}
```

A sender reads the recipient's capabilities before constructing a message. If the recipient supports `hybrid-v1`, the sender uses hybrid signatures. If only `classical`, the sender uses Ed25519 only.

**Level 2: Message header (self-describing).**

Every message carries its crypto suite in the header (`crypto` field). A recipient can always determine how to parse and verify a message from the header alone, without prior capability negotiation.

**Negotiation matrix:**

| Sender crypto | Recipient supports | Action |
|---------------|-------------------|--------|
| Classical | Classical only | Send classical. Normal operation. |
| Classical | Hybrid | Send classical. Recipient accepts (backward compatible). |
| Hybrid | Classical only | Send classical (downgrade to peer's capability). |
| Hybrid | Hybrid | Send hybrid. Both sides verify both signature components. |

**Broadcast messages (mixed network):**

| Phase | Strategy |
|-------|----------|
| Phase 2 (v1.1) | Dual auth entries: one classical + one hybrid. Classical nodes verify entry 1; hybrid nodes verify entry 2. |
| Phase 3 (v2.0) | Hybrid-only auth entry. Classical nodes that upgraded to Phase 0 can extract the Ed25519 component for basic verification. Non-upgraded nodes reject the message. |

### 5.4 Header Version Compatibility

| Receiver version | Header v=1 | Header v=2 | Header v=unknown |
|------------------|-----------|-----------|-----------------|
| v1.0 | Parse normally | Parse if format is compatible; warn if unknown crypto suite | Reject with error code |
| v1.1 | Parse normally | Parse normally | Reject with error code |
| v2.0+ | Accept (legacy) | Parse normally | Forward-compat: parse header, skip unknown fields |

Rule: A node MUST accept messages with a version less than or equal to its own. A node SHOULD attempt to parse messages with a higher version, relying on length-prefixed fields to skip unknown data. A node MUST reject messages it cannot parse.

---

## 6. Compression Analysis

### 6.1 Compressibility by Data Type

| Data type | Compressibility | Rationale |
|-----------|----------------|-----------|
| Encrypted payloads (AES-GCM ciphertext) | **Near zero** | Ciphertext is indistinguishable from random data. Compression algorithms achieve 0-2% reduction. Attempting to compress encrypted data wastes CPU cycles. |
| Cryptographic signatures (Ed25519, ML-DSA-65) | **Near zero** | Signatures are pseudorandom. No exploitable structure. |
| Public keys (Ed25519) | **Near zero** | 32 random bytes. |
| Public keys (ML-DSA-65) | **Low (~10-15%)** | 1,952 bytes with some internal structure (polynomial coefficients). zstd achieves ~10% reduction. Not worth the CPU cost for a single key. |
| ML-DSA-65 signatures | **Low (~5-10%)** | 3,309 bytes. E8 notes ~30% redundancy, but this refers to the theoretical entropy gap, not practical compressibility. zstd achieves ~8% on individual signatures. |
| JSON structure / headers | **High (60-80%)** | Repeated field names, predictable structure. JSON compresses very well. |
| Message hashes (SHA-256) | **Near zero** | Pseudorandom. |
| Slot manifests (lists of hashes) | **Low (~5%)** | List of independent random hashes. Slight overhead from JSON array formatting compresses away. |

### 6.2 Recommendation: No Message-Level Compression

**Do not compress individual wire messages.** Rationale:

1. **Most bytes are incompressible.** In a hybrid PQ user message (~9.8 KB), the auth entry (pubkey + signature = ~7.1 KB) and encrypted payload (~710 bytes) account for ~80% of the message. Neither compresses.

2. **Transport-level compression is superior.** HTTP/2 and HTTP/3 support header compression (HPACK/QPACK) natively. Enabling gzip or brotli at the transport layer compresses the JSON structure and repeated header patterns across a connection, which is more effective than per-message compression.

3. **CPU cost is not free.** zstd compression at default level costs ~0.5-2ms for a 10KB message. For a protocol targeting 2-second slot times, this is measurable overhead with negligible benefit.

4. **Compression leaks information.** CRIME and BREACH attacks demonstrate that compression ratios can leak plaintext content in encrypted channels. While these attacks target TLS compression over HTTP, the principle applies: compressing messages that contain both predictable structure (headers) and encrypted content (payload) can leak information about the encrypted content.

### 6.3 Exception: Batch Compression for Sync

Merkle-based delta sync (E6) transfers batches of records between peers. In this context, compression is beneficial:

- Batches of hash values share the same 32-byte structure, and JSON array formatting compresses well.
- Multiple attestation records for the same slot share common fields (epoch, slot number, message hash prefix).
- zstd with a dictionary trained on firecat message structure could achieve 30-40% reduction on sync batches.

**Recommendation:** Enable zstd compression for Merkle sync batch transfers (the `Content-Encoding: zstd` HTTP header). Do not compress individual messages.

---

## 7. Concrete Format Tables

### 7.1 User Message / Padding Message (Type 0x01 / 0x06)

Classical (CryptoSuite=0x01, no hybrid KE):

```
Byte offset  Length     Field                              Example value
-----------  ---------  ---------------------------------  ---------------------------
0            1          Version                            0x01
1            1          Type                               0x01 (user) / 0x06 (padding)
2            1          CryptoSuite                        0x01 (classical)
3            1          Reserved                           0x00
4            8          Timestamp (ms epoch, uint64 BE)    0x00000194A3B1C2E8
12           4          Payload length (uint32 BE)         0x00000212 (530)
16           8          Fee (microUSD, uint64 BE)          0x00000000000007D0 (2000)
---header end: 24 bytes---
24           2          URI length (uint16 BE)             0x0082 (130)
26           130        URI (UTF-8)                        mutable://accounts/q7Hk.../a3Bc_obf
156          1          Auth entry count                   0x01
157          2          Pubkey length (uint16 BE)          0x002B (43)
159          43         Pubkey (base64url)                 q7Hk9f...43 chars (Ed25519)
202          2          Signature length (uint16 BE)       0x0056 (86)
204          86         Signature (base64url)              xP3q...86 chars (Ed25519)
290          2          Ephemeral pubkey length            0x002B (43)
292          43         Ephemeral X25519 pubkey            sK7m...43 chars
335          2          KEM ciphertext length              0x0000 (absent)
337          1          Nonce length                       0x0C (12)
338          12         AES-GCM nonce                      (raw bytes)
350          4          Ciphertext length (uint32 BE)      0x00000212 (530)
354          530        AES-256-GCM ciphertext             (encrypted payload)
---total: 884 bytes (binary), ~1,283 bytes (JSON)---
```

Hybrid PQ (CryptoSuite=0x02, with hybrid KE and hybrid signature):

```
Byte offset  Length     Field                              Notes
-----------  ---------  ---------------------------------  ---------------------------
0            24         Header                             crypto=0x02
24           2+130      URI                                Same as classical
156          1          Auth entry count                   0x01
157          2          Pubkey length                      0x07C1 (1985)
159          2647       Hybrid pubkey (base64url)          Version(1)+Ed25519(32)+ML-DSA(1952)
2806         2          Signature length                   0x0D2E (3374)
2808         4499       Hybrid signature (base64url)       Version(1)+Ed25519(64)+ML-DSA(3309)
7307         2+43       Ephemeral X25519 pubkey            Same as classical
7352         2          KEM ciphertext length              0x0440 (1088)
7354         1451       ML-KEM-768 ciphertext (base64url)  Hybrid key exchange
8805         1+12       Nonce                              Same as classical
8818         4+530      AES-256-GCM ciphertext             Same as classical
---total: 9,352 bytes (binary), ~9,766 bytes (JSON)---
```

### 7.2 Attestation (Type 0x02)

Classical:

```
Byte offset  Length     Field                              Example value
-----------  ---------  ---------------------------------  ---------------------------
0            24         Header                             type=0x02, fee=0
24           43         Message hash (base64url)           SHA-256 of original message
67           2+43       Validator pubkey                   Ed25519 (43 chars)
112          2+86       Validator signature                Ed25519 sig over H(M)||slot
200          4          Epoch (uint32 BE)                  0x000006CE (1742)
204          2          Slot (uint16 BE)                   0x009D (157)
206          1          Vote                               0x01 (ATTEST)
---total: 207 bytes (binary), ~350 bytes (JSON)---
```

Hybrid PQ:

```
Byte offset  Length     Field                              Notes
-----------  ---------  ---------------------------------  ---------------------------
0            24         Header                             crypto=0x02
24           43         Message hash                       Same
67           2+2647     Validator hybrid pubkey             1985 bytes raw
2716         2+4499     Validator hybrid signature          3374 bytes raw
7217         4+2        Epoch + slot                       Same
7223         1          Vote                               Same
---total: 7,224 bytes (binary), ~7,367 bytes (JSON)---
```

### 7.3 Confirmation (Type 0x04) — with FROST

Classical:

```
Byte offset  Length     Field                              Example value
-----------  ---------  ---------------------------------  ---------------------------
0            24         Header                             type=0x04, fee=0
24           43         Message hash (base64url)           SHA-256
67           4          Epoch (uint32 BE)                  1742
71           2          Slot (uint16 BE)                   157
73           2+86       FROST threshold sig (base64url)    64 bytes raw -> 86 chars
161          43         Committee roster hash              SHA-256 of committee pubkeys
204          1          Total attestations                 7
205          1          Confirm count                      6
206          1          Reject count                       1
---total: 207 bytes (binary), ~382 bytes (JSON)---
```

Hybrid PQ:

```
Byte offset  Length     Field                              Notes
-----------  ---------  ---------------------------------  ---------------------------
0            24         Header                             crypto=0x02
24           43         Message hash                       Same
67           4+2        Epoch + slot                       Same
73           2+4499     FROST hybrid threshold sig         3374 bytes raw -> 4499 chars
4574         43         Committee roster hash              Same
4617         3          Attestation summary                Same
---total: 4,620 bytes (binary), ~4,795 bytes (JSON)---
```

### 7.4 Slot Manifest (Type 0x05)

Classical, 10 messages:

```
Byte offset  Length     Field                              Example value
-----------  ---------  ---------------------------------  ---------------------------
0            24         Header                             type=0x05, fee=0
24           2          Era (uint16 BE)                    0x0000 (era 0)
26           4          Epoch (uint32 BE)                  1742
30           2          Slot (uint16 BE)                   157
32           32         Previous slot hash (raw SHA-256)   (32 bytes)
64           32         State root (raw SHA-256)           (32 bytes)
96           2          Message count (uint16 BE)          0x000A (10)
98           320        10 message hashes (32 bytes each)  (320 bytes)
418          2+43       Proposer pubkey (base64url)        Ed25519
463          2+86       Proposer signature (base64url)     Ed25519
551          2+86       Committee FROST sig (base64url)    Ed25519
---total: 639 bytes (binary), ~976 bytes (JSON)---
```

Hybrid PQ, 10 messages:

```
Byte offset  Length     Field                              Notes
-----------  ---------  ---------------------------------  ---------------------------
0            24         Header                             crypto=0x02
24           8          Era + epoch + slot                 Same
32           64         Prev hash + state root             Same
96           322        Message count + hashes             Same
418          2+2647     Proposer hybrid pubkey             1985 bytes raw
3067         2+4499     Proposer hybrid signature          3374 bytes raw
7568         2+4499     Committee FROST hybrid sig         3374 bytes raw
---total: 12,069 bytes (binary), ~12,406 bytes (JSON)---
```

---

## 8. Design Rationale and Trade-offs

### 8.1 Why JSON over Binary Wire Format

The wire format uses JSON for the HTTPS transport, not a binary serialization format (protobuf, MessagePack, CBOR). Rationale:

1. **Ecosystem compatibility.** The b3nd SDK already uses JSON for all `receive()` / `read()` / `list()` operations (R1 Front 3). Adding a binary wire format would require maintaining two serialization paths.

2. **Debuggability.** JSON messages can be inspected with `curl`, browser DevTools, and standard HTTP debugging proxies. Binary formats require custom tooling.

3. **HTTP/2 header compression.** HPACK compresses repeated JSON keys across requests on the same connection, partially mitigating JSON verbosity.

4. **Size cost is moderate.** JSON overhead adds ~15-20% to message sizes compared to a hypothetical binary format. For classical messages (~1.3 KB), this is ~200 bytes. For hybrid PQ messages (~9.8 KB), this is ~1.5 KB. The PQ signature data dominates either way.

5. **Future option.** A binary wire format (e.g., CBOR) can be added as a content-type negotiation option (`Content-Type: application/cbor`) without changing the message structure. The field names and types remain the same.

### 8.2 Why Length-Prefixed Fields

All variable-length fields (pubkeys, signatures, URIs, ciphertexts) are length-prefixed rather than delimited. This enables:

1. **Forward compatibility.** New signature schemes with different sizes parse correctly without hardcoded length assumptions.
2. **Zero-copy parsing.** A parser can skip fields it does not understand by reading the length and advancing the offset.
3. **No delimiter ambiguity.** Base64url characters do not conflict with any delimiter.

### 8.3 Why Base64url Without Padding

Base64url without padding characters (`=`) is used for all binary fields. RFC 4648 Section 3.2 specifies that padding can be omitted when the data length is known by other means. In firecat:

- All fixed-size cryptographic artifacts (keys, signatures, hashes, nonces) have known sizes determined by the crypto suite.
- Variable-size fields (ciphertext) use explicit length prefixes.
- Omitting padding saves 0-2 characters per field and avoids URI encoding issues (`=` must be percent-encoded in query strings).

### 8.4 Fee Encoding

Fees are encoded as uint64 microUSD (1 USD = 1,000,000 microUSD) rather than decimal strings. This avoids floating-point precision issues and enables integer arithmetic for fee splitting:

```
fee = 2000 microUSD ($0.002)
storage_share  = fee * 25 / 100 = 500 microUSD
validator_share = fee * 35 / 100 = 700 microUSD
confirmer_share = fee * 25 / 100 = 500 microUSD
treasury_share  = fee * 15 / 100 = 300 microUSD
sum = 2000 ✓ (no rounding error)
```

The D4 fee floor of $0.002 = 2,000 microUSD divides cleanly into the 25/35/25/15 split.

---

## 9. Appendix: Encoding Comparison for Key Sizes

The following table shows the wire cost of every cryptographic artifact under each candidate encoding, confirming that base64url provides the best JSON-compatible trade-off.

| Artifact | Raw (bytes) | Hex (chars) | Base64url (chars) | Hex overhead vs b64url |
|----------|------------:|------------:|------------------:|-----------------------:|
| Ed25519 pubkey | 32 | 64 | 43 | +49% |
| Ed25519 signature | 64 | 128 | 86 | +49% |
| Hybrid pubkey | 1,985 | 3,970 | 2,647 | +50% |
| Hybrid signature | 3,374 | 6,748 | 4,499 | +50% |
| ML-KEM-768 ciphertext | 1,088 | 2,176 | 1,451 | +50% |
| SHA-256 hash | 32 | 64 | 43 | +49% |
| FROST sig (classical) | 64 | 128 | 86 | +49% |
| FROST sig (hybrid) | 3,374 | 6,748 | 4,499 | +50% |

Hex encoding is consistently ~50% larger than base64url for all artifacts. For a full hybrid user message, switching from hex to base64url saves approximately 3,500 characters (~3.5 KB) per message. Over 10 messages per slot, 150 slots per minute, this is ~5.25 MB/min of bandwidth saved by the encoding choice alone.

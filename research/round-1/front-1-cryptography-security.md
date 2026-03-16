# Front 1: Cryptography & Security Research Report

**Round 1 -- b3nd Framework & Firecat Network**
**Date:** 2026-03-16

---

## Executive Summary

b3nd is a DePIN framework built on the primitive `[uri, data]`, where URIs encode access-control semantics and data payloads carry optionally signed and encrypted content. The cryptographic architecture relies on Ed25519 for signing, X25519+AES-GCM for asymmetric encryption, PBKDF2/HKDF for key derivation, and SHA-256 for content addressing. This report assesses the current implementation against industry standards, maps the attack surface, evaluates post-quantum readiness, and proposes contrarian perspectives and future experiments.

**Overall assessment:** The cryptographic primitive selection is sound and modern. The architecture makes deliberate, well-documented trade-offs between sovereignty and usability. The primary risks lie not in algorithm choice but in the operational boundaries -- metadata leakage, lack of forward secrecy in the messaging model, PBKDF2 as a password KDF, and the absence of post-quantum migration planning.

---

## A. Current Cryptographic Architecture Assessment

### A.1 Algorithm Selection: Ed25519 / X25519 / AES-GCM

**Ed25519 (Signing)**

The implementation uses the Web Crypto API's Ed25519 support for all signing operations (`crypto.subtle.sign("Ed25519", ...)` in `libs/b3nd-encrypt/mod.ts`, line 341). Ed25519 is a Schnorr signature scheme over Curve25519, specified in RFC 8032.

Strengths:
- Deterministic signatures -- no nonce reuse vulnerability (unlike ECDSA with poor RNG)
- 128-bit security level, fast verification (~71,000 verifications/sec on commodity hardware per Bernstein et al.)
- Compact: 32-byte public keys, 64-byte signatures
- Web Crypto API native in Deno and modern browsers -- no external dependencies

Observations:
- The signing function (`sign()`, line 334) serializes payloads via `JSON.stringify()` before signing. JSON serialization is not canonically ordered in JavaScript; `JSON.stringify()` preserves insertion order but this is implementation-dependent. The hash module uses RFC 8785 (JCS) canonicalization via the `canonicalize` library, but the signing path does not. **This is a potential interoperability risk**: two implementations producing different JSON key ordering for the same logical object would produce different signatures.
- Recommendation: Use JCS canonicalization (already available in the codebase via `canonicalize`) in the `sign()` function, or document that signing is over the exact byte representation of the payload.

**X25519 + AES-GCM (Encryption)**

The `encrypt()` function (line 410) implements an ECIES-like scheme:
1. Generate an ephemeral X25519 keypair
2. ECDH with recipient's static public key to derive a 256-bit shared secret
3. Use the raw ECDH output directly as an AES-256-GCM key
4. Encrypt with a 12-byte random nonce

This is a well-established pattern (similar to NaCl's `crypto_box`). The ephemeral keypair provides sender anonymity -- the recipient cannot determine who sent the message from the ciphertext alone (unless the message is also signed).

**Issue: Missing KDF step.** The raw ECDH output is used directly as the AES key (lines 441-449). Best practice (per NIST SP 800-56C and the HPKE standard RFC 9180) is to run the shared secret through a KDF (typically HKDF) before use as a symmetric key. The raw ECDH output has good entropy but is not uniformly distributed. While X25519's output is close enough to uniform that this is not a practical attack today, adding HKDF would:
- Provide domain separation (preventing cross-protocol attacks)
- Conform to NIST/IETF best practices
- Future-proof against potential biases in curve arithmetic

**AES-GCM specifics:**
- 12-byte nonce via `crypto.getRandomValues()` -- correct length for GCM
- AES-256-GCM provides authenticated encryption (confidentiality + integrity)
- The nonce space (96 bits) means collision probability exceeds the birthday bound after ~2^48 messages under the same key. Since each message uses an ephemeral key, the effective key+nonce pair is always unique. This is safe.

### A.2 PBKDF2 Key Derivation for Visibility Model

The `deriveKeyFromSeed()` function (line 600) uses PBKDF2-SHA256 with 100,000 iterations to derive symmetric encryption keys. This is used for the visibility model:

- **Private:** `PBKDF2(secret, "SALT:uri:ownerPubkey")` -- only the owner can derive the key
- **Protected:** `PBKDF2(secret, "SALT:uri:password")` -- anyone with the password can derive the key
- **Public:** `PBKDF2(secret, "SALT:uri:""")` -- deterministic, effectively unencrypted

The `SecretEncryptionKey` class (line 143) wraps this pattern cleanly.

**Assessment:**
- PBKDF2 with 100,000 iterations provides approximately 17 bits of additional computational cost (2^17 hash operations per guess). OWASP's 2023 guidance recommends 600,000 iterations for PBKDF2-SHA256. The 100,000 default is below current recommendations.
- PBKDF2 is not memory-hard. An attacker with GPUs or ASICs can parallelize brute-force attacks efficiently. See Section E.4 for a detailed comparison with Argon2.
- The salt construction is good: tying the salt to the URI prevents rainbow table attacks and ensures different URIs produce different keys even with the same password.

**Deterministic keypair derivation** uses HKDF (not PBKDF2) in `deriveSigningKeyPairFromSeed()` (line 863) and `deriveEncryptionKeyPairFromSeed()` (line 937). HKDF is appropriate here because the input (a PBKDF2-derived seed or HMAC secret) is already high-entropy. The salt and info parameters provide domain separation:
- Signing: `salt="b3nd-signing-key"`, `info="Ed25519"`
- Encryption: `salt="b3nd-encryption-key"`, `info="X25519"`

This is correct practice. Different keys are derived from the same seed for different purposes.

### A.3 Authenticated Message Structure

The `AuthenticatedMessage<T>` type (line 28) wraps a payload with an array of `{pubkey, signature}` pairs:

```typescript
{
  auth: [{ pubkey: string, signature: string }, ...],
  payload: T
}
```

**Design properties:**
- Multi-signer support: multiple parties can co-sign a message
- Signatures cover the payload only (not the auth array itself)
- The `createSignedEncryptedMessage()` function signs the encrypted payload, providing sign-then-encrypt semantics

**Analysis of sign-then-encrypt vs. encrypt-then-sign:**
The codebase uses **sign-then-encrypt** in some flows (the `respondTo()` pattern signs responses after encrypting) and **sign-over-ciphertext** in others (line 714: `signPayload({ payload, identity })` where payload is already an `EncryptedPayload`). The sign-over-ciphertext approach is safer because:
- The signature binds to the exact ciphertext, preventing ciphertext substitution
- A verifier can check authenticity without decrypting
- It avoids surreptitious forwarding attacks (an intermediary cannot strip the outer encryption and re-encrypt to a different recipient while preserving the signature)

**Concern: Signature malleability in multi-signer scenario.** The `validateAuthMessage()` function in `libs/b3nd-auth/mod.ts` (line 71) returns `true` if *any one* authorized signature is valid. This is intentional (cascading access control), but means:
- An attacker who obtains one valid signature can strip other signatures and the message is still valid
- There is no "threshold" requirement (e.g., "2 of 3 must sign")

This is a feature, not a bug, for the current access model -- but worth documenting as a design decision. Multi-sig threshold validation would be a natural extension.

### A.4 Hash-Addressed Content (hash://sha256)

The `libs/b3nd-hash/mod.ts` module implements content-addressed storage:

1. `computeSha256()` canonicalizes JSON via RFC 8785 (JCS) before hashing -- this is excellent practice, ensuring deterministic hashes regardless of JSON key ordering
2. `hashValidator()` enforces write-once semantics: content cannot be overwritten
3. `verifyHashContent()` confirms content matches its URI

**This is the strongest integrity primitive in b3nd.** Content-addressed data is self-verifying: anyone who reads `hash://sha256/abc123` can independently verify the content without trusting the storage node. Combined with write-once semantics, this provides immutability guarantees.

**Note on SHA-256:** SHA-256 provides 128-bit collision resistance. There are no known practical attacks. SHA-256 is considered quantum-safe against Grover's algorithm at the 128-bit level (Grover reduces to 2^128 operations, which remains infeasible). Content addressing is the most quantum-resilient part of b3nd's architecture.

---

## B. Security Threat Model

### B.1 Replay Attacks

**Vector:** An attacker captures a valid signed message `[uri, data]` and resubmits it.

**Current mitigations:**
- For `hash://` URIs: write-once semantics prevent replay (the content already exists)
- For `mutable://` URIs with `immutable://` inbox patterns: timestamped URIs (`immutable://inbox/{key}/topic/{timestamp}`) provide ordering
- For `mutable://accounts/{pubkey}/...` URIs: the same data written again is idempotent

**Gaps:**
- There is no message-level nonce or sequence number in the `AuthenticatedMessage` structure
- A signed message for a mutable URI could be replayed to overwrite a newer value with an older one
- The temporal consensus protocol uses write-once `immutable://` URIs for each stage, which prevents replay within the consensus flow

**Recommendation:** Add an optional `nonce` or `timestamp` field to the authenticated message structure. For mutable URIs, consider a monotonic sequence number verified by the node.

### B.2 Man-in-the-Middle (MITM) Attacks

**Transport layer:** b3nd does not implement its own transport security. It relies on the underlying transport (HTTPS for HTTP clients, WSS for WebSocket clients). The `DESIGN_EXCHANGE.md` makes this explicit: trust in the transport is a separate layer (`connect()` expresses transport trust).

**Crypto layer:** The X25519 ECDH scheme uses ephemeral keys, but the recipient's public key must be obtained out-of-band or from a trusted source. If an attacker substitutes the recipient's public key, they can perform a classic MITM on the encrypted channel. The `PublicEncryptionKey` class accepts any hex-encoded public key without verification.

**Mitigation paths:**
- The `mutable://accounts/{pubkey}/...` URI pattern binds identity to public key -- if you trust the URI, you trust the key
- Content-addressed hashes provide integrity for stored data
- For real-time communication, a TOFU (Trust On First Use) or certificate pinning model would strengthen MITM resistance

### B.3 Sybil Attacks

**Vector:** In the firecat network, an attacker creates many identities to influence consensus.

**Current state:** The temporal consensus protocol (per `TEMPORAL_CONSENSUS.md`) uses a `VALIDATOR_SET` for authorized validators, but acknowledges this is an open question: "Currently any pubkey can be a validator/confirmer/producer. This enables spam and lacks accountability."

**Risk assessment:** Without a stake mechanism or permissioned validator set, the attestation layer is vulnerable to Sybil attacks. An attacker who controls many validator keys can dominate the attestation pool, influencing which content gets confirmed.

**Recommendations:**
- Implement node registration with a stake/deposit mechanism
- Consider proof-of-stake or delegated proof-of-stake for validator selection
- Use economic penalties (slashing) for misbehaving validators

### B.4 Eclipse Attacks

**Vector:** An attacker isolates a node from the honest network, feeding it a false view of the consensus state.

**In b3nd's model:** Since nodes communicate through the message exchange (`[uri, data]`), an attacker who controls all of a node's connections could:
- Suppress attestations from honest validators
- Present a false confirmation with attacker-controlled attestation signatures
- Feed the node a divergent consensus history

**Mitigation:** The three-party consensus model (Trust Model 6 in `DESIGN_EXCHANGE.md`) addresses this by requiring multiple independent nodes to agree. The current single-node model is inherently vulnerable to eclipse attacks.

### B.5 Timing Side-Channels

**Assessment:** The cryptographic operations use the Web Crypto API (`crypto.subtle`), which delegates to platform-native implementations (BoringSSL in V8/Deno, OS crypto in browsers). These implementations are constant-time for Ed25519 and X25519 operations.

**Potential concerns:**
- `JSON.stringify()` before signing is not constant-time -- the serialization time depends on payload size and structure. This leaks payload characteristics to an observer who can measure operation timing.
- The `verify()` function (line 372) catches all errors and returns `false`, which prevents timing differences between "invalid key format" and "valid key, wrong signature" from being observed. This is good practice.
- The `deriveObfuscatedPath()` function in `utils.ts` uses HMAC-SHA256 with `substring(0, 32)` on the output -- truncating an HMAC is standard practice and does not introduce timing issues.

### B.6 Key Management Risks

**Seed-based derivation:**
- The `deriveSigningKeyPairFromSeed()` function derives deterministic keys from seeds. The security of all derived keys rests entirely on the seed's entropy.
- For password-based derivation: security = password entropy + PBKDF2 cost. With 100,000 iterations, a 6-character lowercase password (~28 bits) provides roughly 45 bits of total security. This is inadequate.
- For HMAC-based derivation (vault pattern): security = `nodeSecret` entropy. If `nodeSecret` is a strong random value (256 bits), this is excellent.

**Vault pattern risks:**
- The vault operator who knows `nodeSecret` can derive any user's secret given their OAuth `sub` value. This is documented honestly in `docs/design/auth-protocol.md`.
- A compromised vault produces a *targeted* breach (attacker must know specific `sub` values) rather than a *bulk* breach (attacker gets all keys at once, as in the custodial model).
- Recovery of `nodeSecret` from observed HMAC outputs requires breaking HMAC-SHA256, which is computationally infeasible.

**Private key handling:**
- Private keys are exported as hex strings and JWK in memory. The `IdentityKey` class stores the `CryptoKey` (non-extractable by default) but the `KeyPair` type includes `privateKeyHex` for convenience.
- In-memory private keys in JavaScript/Deno are not protected against memory inspection attacks (cold boot, heap dump, speculative execution). This is a fundamental limitation of the platform.

### B.7 Visibility Model: Information Leakage

The three-tier visibility model (Private/Protected/Public) derives symmetric keys deterministically from URI components and secrets. This creates a clean access model, but:

**Metadata leakage from URIs:**
- URIs like `mutable://accounts/{pubkey}/profile` reveal the account's public key and the fact that a profile exists
- `immutable://inbox/{key}/topic/{timestamp}` reveals communication patterns, timing, and parties
- The `list()` operation enumerates all children of a URI prefix, which reveals the existence and count of resources

**Structural leakage:**
- Encrypted payloads have observable sizes. An attacker can correlate message sizes with known content types.
- The `EncryptedPayload` structure includes `ephemeralPublicKey` (in cleartext), `nonce`, and `data` (ciphertext). The presence of `ephemeralPublicKey` distinguishes asymmetric from symmetric encryption, revealing the visibility tier.
- AES-GCM ciphertext length equals plaintext length + 16 bytes (auth tag). Exact plaintext length is recoverable.

**Recommendations:**
- Consider padding ciphertexts to fixed sizes or size buckets to resist traffic analysis
- The `deriveObfuscatedPath()` utility in `utils.ts` is a good step toward path obfuscation -- extend this to production URI patterns
- Consider adding dummy traffic or resource entries to obscure `list()` enumeration

---

## C. Comparison with Industry Standards

### C.1 Signal Protocol (Double Ratchet)

The Signal Protocol (Marlinspike & Perrin, 2016) provides:
- **Forward secrecy:** Compromise of long-term keys does not reveal past messages
- **Post-compromise security (self-healing):** After a compromise, security is restored after a few message exchanges
- **Double ratchet:** Combines a Diffie-Hellman ratchet (new ephemeral keys per exchange) with a symmetric ratchet (HKDF chain)

**b3nd comparison:**
- b3nd's ephemeral X25519 keypairs provide forward secrecy *per message* (a new ephemeral key per `encrypt()` call). This is stronger than no forward secrecy but weaker than Signal's continuous ratcheting.
- b3nd has no post-compromise security. If a long-term private key is compromised, all future messages encrypted to that key are readable. The key does not rotate.
- b3nd's model is fundamentally store-and-forward (messages are stored at URIs), not interactive. Signal's double ratchet requires bidirectional communication. The store-and-forward model is a deliberate design choice that enables asynchronous communication and the DePIN architecture.

**Applicability:** Signal's protocol is designed for interactive messaging between two parties. b3nd's model is designed for a message exchange medium where parties may be offline. A hybrid approach could implement a simplified ratchet for parties that frequently communicate, while falling back to the current ephemeral-ECDH model for asynchronous messages.

### C.2 Noise Framework

The Noise Protocol Framework (Perrin, 2018) defines handshake patterns for establishing secure channels. Key relevant patterns:

- **NK (known responder):** Sender knows responder's static key, ephemeral-static ECDH. This is closest to b3nd's `encrypt()` function.
- **XK (known responder, sender authenticates):** Adds sender authentication. This is closest to b3nd's `createSignedEncryptedMessage()`.
- **XX (mutual authentication):** Both parties authenticate during handshake. b3nd does not have a handshake protocol.

**b3nd comparison:**
- b3nd's encryption is essentially the NK pattern: sender uses an ephemeral key, recipient has a known static key
- Noise's handshake patterns provide channel binding and identity hiding properties that b3nd does not currently offer
- Noise's `CipherState` provides nonce-based rekeying -- b3nd uses fresh keys per message, which is simpler but less efficient for channels with many messages

**Recommendation:** For future real-time communication features (WebSocket subscriptions), consider implementing a Noise-based handshake to establish a session key, rather than per-message ECDH.

### C.3 TLS 1.3

TLS 1.3 (RFC 8446) provides transport security with:
- 1-RTT (or 0-RTT) handshake
- Forward secrecy via ephemeral ECDHE
- AEAD-only cipher suites (no CBC, no RC4)
- Certificate-based server authentication

**b3nd comparison:**
- b3nd relies on TLS (HTTPS/WSS) for transport security. This is correct -- b3nd is an application-layer protocol, not a transport protocol.
- b3nd's *application-layer* encryption provides end-to-end security that TLS cannot: even if the node operator is compromised (or the TLS connection is terminated at a CDN), the content remains encrypted.
- This is analogous to the relationship between HTTPS (transport) and end-to-end encryption in messaging apps.

### C.4 W3C DID / Verifiable Credentials

W3C Decentralized Identifiers (DIDs) and Verifiable Credentials (VCs) provide:
- **DID:** A URI-based identifier that resolves to a DID Document containing public keys, service endpoints, and verification methods
- **VC:** A cryptographically signed claim about a subject, verifiable by any party

**b3nd comparison:**
- b3nd's `{pubkey}` is effectively a DID (a self-resolving identifier). The URI pattern `mutable://accounts/{pubkey}/...` functions as a DID Document resolution mechanism.
- b3nd's `AuthenticatedMessage` is structurally similar to a Verifiable Presentation (signed data with the signer's public key).
- b3nd does not implement the DID Core specification (W3C Recommendation, 2022), but the data model is compatible. A `did:b3nd` method could map directly to the existing URI structure: `did:b3nd:{pubkey}` resolves to `mutable://accounts/{pubkey}/identity`.

**Recommendation:** Consider defining a `did:b3nd` method specification. This would provide interoperability with the broader W3C DID ecosystem without changing the underlying architecture.

### C.5 age Encryption

age (Actually Good Encryption, Filippo Valsorda, 2019) is a modern file encryption tool that provides:
- X25519 key agreement (same as b3nd)
- ChaCha20-Poly1305 symmetric encryption (vs. b3nd's AES-GCM)
- HKDF for key derivation (b3nd uses raw ECDH output)
- Scrypt for passphrase-based encryption (vs. b3nd's PBKDF2)

**b3nd comparison:**
- age uses HKDF to derive the file key from the ECDH shared secret -- b3nd should adopt this pattern (see Section A.1)
- age uses scrypt (memory-hard) for passphrase-based encryption -- b3nd should consider Argon2 for similar reasons (see Section E.4)
- age's file format is simpler (one recipient, one file) vs. b3nd's multi-recipient, URI-addressed model
- Both use X25519 + AEAD, confirming that b3nd's algorithm choices are mainstream

---

## D. Post-Quantum Readiness

### D.1 Vulnerability Assessment

Shor's algorithm (1994) can efficiently solve the discrete logarithm problem on elliptic curves, breaking both Ed25519 and X25519. A sufficiently large quantum computer (estimated 2,000-4,000 logical qubits for Curve25519, per Roetteler et al. 2017) would:

| Primitive | Quantum Attack | Impact |
|-----------|---------------|--------|
| Ed25519 signatures | Shor's algorithm on ECC | Forgery: attacker can sign as any identity |
| X25519 ECDH | Shor's algorithm on ECC | Decryption: attacker can derive shared secrets |
| AES-256-GCM | Grover's algorithm | Reduced to 128-bit security -- still safe |
| SHA-256 | Grover's algorithm | Reduced to 128-bit collision resistance -- still safe |
| PBKDF2/HKDF | Grover's algorithm | Reduced security, but combined with entropy is adequate |
| HMAC-SHA256 | Grover's algorithm | Reduced to 128-bit security -- still safe |

**Critical risk:** Ed25519 and X25519 are the most vulnerable. Signatures can be forged, and stored encrypted messages can be decrypted retroactively ("harvest now, decrypt later"). Content-addressing (SHA-256) and symmetric encryption (AES-256) remain safe.

### D.2 Migration Paths

**CRYSTALS-Kyber (ML-KEM, FIPS 203)**
- Lattice-based key encapsulation mechanism
- Selected by NIST for post-quantum key agreement
- Would replace X25519 for encryption key exchange
- Key sizes: 800-1568 bytes (vs. 32 bytes for X25519) -- significant size increase
- Performance: encapsulation ~10x slower than X25519 on modern hardware

**CRYSTALS-Dilithium (ML-DSA, FIPS 204)**
- Lattice-based digital signature
- Selected by NIST for post-quantum signatures
- Would replace Ed25519 for signing
- Signature sizes: 2420-4627 bytes (vs. 64 bytes for Ed25519) -- 38-72x larger
- Public key sizes: 1312-2592 bytes (vs. 32 bytes for Ed25519) -- 41-81x larger
- Impact: The `auth` array in `AuthenticatedMessage` would grow significantly; URI-embedded pubkeys would be impractical at these sizes

**SPHINCS+ (SLH-DSA, FIPS 205)**
- Hash-based digital signature (no lattice assumptions)
- Considered the most conservative choice (security relies only on hash function security)
- Signature sizes: 7856-49856 bytes -- very large
- Slow signing (hundreds of ms on commodity hardware)
- Not suitable for URI-embedded identities or high-throughput signing

### D.3 Hybrid Approach for Transition

The recommended transition strategy is hybrid cryptography -- combining classical and post-quantum algorithms:

**Phase 1: Hybrid encryption (protect stored data)**
- Replace `encrypt()` with a hybrid KEM: `sharedSecret = KDF(X25519_shared || ML-KEM_shared)`
- This provides security against both classical and quantum attackers
- Can be implemented as a new `EncryptedPayload` version with a `kem` field
- Priority: HIGH -- stored encrypted data is vulnerable to "harvest now, decrypt later"

**Phase 2: Hybrid signatures (protect authentication)**
- Replace Ed25519 signatures with a hybrid: `signature = {ed25519_sig, ml_dsa_sig}`
- Verify requires both to pass
- Public keys become `{ed25519_pub, ml_dsa_pub}` -- larger but backward-compatible
- Requires URI scheme changes (pubkeys no longer fit in path segments)
- Priority: MEDIUM -- signatures are only vulnerable if an attacker has a quantum computer *now*

**Phase 3: Post-quantum only (remove classical)**
- Once hybrid has been deployed and tested, optionally drop classical algorithms
- This reduces message sizes and simplifies verification
- Priority: LOW -- hybrid provides sufficient security

**Impact on b3nd's URI model:**
The largest challenge is that post-quantum public keys are 40-80x larger than Ed25519 keys. The current pattern `mutable://accounts/{pubkey}/...` with a 64-character hex pubkey would become impractical with a 2624+ character pubkey. Options:
1. Hash the public key: `mutable://accounts/{sha256(pubkey)}/...` and resolve the full key from a DID-like document
2. Use a registration URI: `mutable://accounts/{shortId}/...` where `shortId` is assigned at registration
3. Accept the size increase for a transition period

---

## E. Contrarian & Fringe Perspectives

### E.1 Is Client-Side Encryption Sufficient?

**The orthodox view:** Client-side encryption before data leaves the client is the gold standard. The node never sees plaintext. This is the core value proposition of b3nd.

**The contrarian challenge:**

Client-side encryption in JavaScript/browser environments has fundamental limitations:

1. **Supply chain attacks:** The encryption code itself is delivered by a web server. If the server is compromised, it can serve malicious JavaScript that exfiltrates keys before encryption. This is the "webmail problem" (Moxie Marlinspike, 2011). Unlike native apps, web apps cannot guarantee code integrity across sessions.

2. **Runtime environment:** JavaScript runtimes do not provide memory protection. Keys in V8 heap memory can be read by extensions, devtools, or speculative execution attacks (Spectre). The `CryptoKey` type in Web Crypto API is opaque (non-extractable by default), but b3nd exports keys as hex strings for persistence, defeating this protection.

3. **Key derivation on untrusted platforms:** If PBKDF2 runs in a compromised browser, the password is exposed before key derivation completes.

4. **Side-channel in the runtime:** V8's JIT compiler can introduce timing side-channels in JavaScript code that surrounds crypto operations (Oren et al., "The Spy in the Sandbox", 2015).

**Counterargument:** These are platform-level concerns, not protocol-level concerns. b3nd's architecture is correct *given* a trusted runtime. The defense is defense-in-depth: TLS for transport, Web Crypto API for crypto operations (which delegates to native code), Content Security Policy headers, Subresource Integrity, and eventually native clients (Deno CLI) for high-security use cases.

**Verdict:** Client-side encryption is necessary but not sufficient for a complete security model. b3nd should document the threat model boundary: "We assume a trusted client runtime. If the runtime is compromised, all bets are off."

### E.2 Homomorphic Encryption for Computation on Encrypted Data

**The question:** Could nodes compute on encrypted data (e.g., search, filter, aggregate) without decrypting?

**Fully Homomorphic Encryption (FHE):** Schemes like TFHE (Chillotti et al., 2020) and Concrete (Zama, 2022) allow arbitrary computation on ciphertexts. However:
- Performance: FHE operations are 10,000-1,000,000x slower than plaintext
- Ciphertext expansion: 100-10,000x larger than plaintext
- Incompatible with b3nd's `[uri, data]` model where the node does simple key-value storage

**Partial HE / Searchable Encryption:** More practical alternatives:
- **Order-preserving encryption (OPE):** Enables range queries on encrypted data. Leaks ordering information. Applicable to timestamped data.
- **Searchable symmetric encryption (SSE):** Enables keyword search on encrypted documents. Leaks search pattern and access pattern.
- **Property-preserving encryption:** Could enable the `list()` operation on encrypted URIs without revealing the full path.

**Application to b3nd:**
The most promising near-term application is **encrypted indexing** -- a node could maintain an encrypted index that allows authorized parties to search their own data without revealing the index structure to the node. This would enhance the `list()` operation for encrypted namespaces.

**Verdict:** Full HE is impractical for b3nd's use case. Searchable encryption and encrypted indexing are worth exploring for specific features (see Experiment E6).

### E.3 Zero-Knowledge Proofs for URI Access Control

**The question:** Could a client prove it has access to a URI without revealing its identity or the password?

**Current model:** The node knows who writes where (the `auth` field contains the pubkey in cleartext). For password-protected URIs, the node sees the symmetric ciphertext but not the key.

**ZK-based access control:**
- A ZK-SNARK or ZK-STARK could prove: "I know a preimage of this key that, when used with this URI pattern, produces a valid decryption key" without revealing the preimage.
- Groth16 (Groth, 2016) proofs are ~200 bytes and verify in ~5ms. Prover time is ~1 second.
- Plonk (Gabizon et al., 2019) allows universal trusted setup, more practical for a decentralized network.

**Application to b3nd:**
1. **Anonymous writes:** Prove authorization to write to a URI without revealing which pubkey holds authorization. This would break the correlation between writer identity and write location.
2. **Private set membership:** Prove "my pubkey is in the authorized set for this URI" without revealing which pubkey. Could use ZK set membership proofs.
3. **Threshold access:** Prove "I know k-of-n shares of the decryption key" without revealing which shares.

**Challenges:**
- ZK proof generation is computationally expensive (seconds, not milliseconds)
- Proof verification on-chain or at the node requires a verifier circuit
- The current access model is simple and fast; ZK would add significant complexity

**Verdict:** ZK proofs are a promising research direction for privacy-enhanced access control, particularly for the consensus layer where anonymous attestation would prevent validator collusion signaling.

### E.4 PBKDF2 vs. Argon2/scrypt

**The question:** Is PBKDF2 the right KDF for password-based key derivation?

**PBKDF2's weakness:** PBKDF2-SHA256 is computation-bound only. It does not consume significant memory. This makes it vulnerable to GPU/ASIC attacks:

| Hardware | PBKDF2-SHA256 (100k iter) | Argon2id (64MB, 3 iter) |
|----------|--------------------------|------------------------|
| CPU (single core) | ~300 hashes/sec | ~5 hashes/sec |
| GPU (RTX 4090) | ~300,000 hashes/sec | ~50 hashes/sec |
| ASIC (Hashcat cluster) | ~3,000,000 hashes/sec | Infeasible (memory-bound) |

Argon2 (winner of the 2015 Password Hashing Competition, RFC 9106) is memory-hard: each evaluation requires filling and reading a large block of memory, making GPU parallelism ineffective.

**Why b3nd uses PBKDF2:** The `docs/design/auth-protocol.md` states: "Web Crypto API native, well-understood, tunable iterations." This is pragmatically correct -- Argon2 is not available in the Web Crypto API as of 2026. Using Argon2 would require either:
1. A WebAssembly implementation (adds ~100KB bundle size, has been done: `argon2-browser`)
2. A native Deno module (available: `@noble/hashes` or `deno_argon2`)

**Recommendation:**
- For browser environments: Add an optional Argon2id implementation via WASM, defaulting to PBKDF2 if not available
- For Deno/Node environments: Use Argon2id natively
- Increase PBKDF2 iterations to 600,000 (OWASP 2023 recommendation) as the default
- Document the trade-off: PBKDF2 is the portable fallback; Argon2id is the preferred option when available

### E.5 The "Everything Is a Message" Assumption

**The contrarian challenge:** Is the `[uri, data]` primitive expressive enough for all trust models?

**Limitations:**
1. **No channel concept:** Every message is addressed to a URI, not a channel. There is no concept of a persistent bidirectional channel with state. This makes protocol-level constructs (handshakes, ratchets, sessions) awkward to express.
2. **No ordering guarantees:** URIs with timestamps provide soft ordering, but there is no causal ordering or vector clocks. Two messages to the same URI have no defined order (last-write-wins for mutable URIs).
3. **No transactional semantics:** The `inputs/outputs` model in temporal consensus approximates transactions, but there is no ACID guarantee at the message level.

**Counterargument:** These are features, not limitations. The minimal primitive enables maximum flexibility. Channels, ordering, and transactions can be built *on top of* `[uri, data]` as compose patterns. The temporal consensus protocol demonstrates this -- it builds multi-stage atomic operations from simple messages.

**Verdict:** The primitive is intentionally minimal. The trade-off is explicit: simplicity and composability over built-in complex semantics. This is a defensible architectural choice, but applications that need strong ordering or transactional guarantees must build or adopt higher-level protocols.

---

## F. Proposed Experiments

### Experiment F1: JSON Canonicalization Divergence Test
**Hypothesis:** `JSON.stringify()` in the signing path may produce different byte sequences than `canonicalize()` in the hashing path for the same logical object.
**Method:** Generate 1,000 objects with various key orderings, nested structures, Unicode, and special characters. Compare `JSON.stringify()` output with RFC 8785 canonicalization. Measure divergence rate. Sign with both and verify cross-compatibility.
**Expected outcome:** Divergence in key ordering for objects constructed differently. This would prove the need for canonicalization in the signing path.

### Experiment F2: PBKDF2 vs. Argon2 Performance and Security Benchmark
**Hypothesis:** Argon2id provides better security-per-millisecond than PBKDF2-SHA256 for password-derived keys.
**Method:** Benchmark both KDFs at equivalent wall-clock time (e.g., 250ms) across browser (WASM Argon2), Deno (native Argon2), and GPU (hashcat). Measure: passwords tested per second, memory per evaluation, resistance to parallelism.
**Expected outcome:** Argon2id provides 100-1000x better resistance to GPU attacks at equivalent latency.

### Experiment F3: HKDF vs. Raw ECDH Output for AES Key Derivation
**Hypothesis:** Using HKDF over the raw X25519 shared secret improves security without measurable performance impact.
**Method:** Implement HKDF-SHA256 extraction of the ECDH shared secret (per RFC 5869). Benchmark against raw output. Test for statistical bias in both key distributions using NIST SP 800-22 statistical test suite.
**Expected outcome:** No measurable performance difference. HKDF output passes all statistical tests. Raw output *also* passes, but HKDF provides defense-in-depth.

### Experiment F4: Metadata Leakage Quantification
**Hypothesis:** An observer with access to URI patterns and message sizes can infer user behavior without decrypting content.
**Method:** Simulate 100 users with known behavior profiles (messaging, file storage, social posting). Record all observable metadata (URIs, timestamps, sizes, access patterns). Train a classifier to infer behavior type from metadata alone.
**Expected outcome:** High classification accuracy (>80%), demonstrating that metadata leakage is a real privacy concern. Measure improvement when URI obfuscation (`deriveObfuscatedPath()`) is applied.

### Experiment F5: Replay Attack on Mutable URIs
**Hypothesis:** Captured signed messages for mutable URIs can be replayed to overwrite newer data.
**Method:** Create a mutable URI, write signed data V1, then V2. Replay the V1 message. Determine if the node accepts the replay. Test with and without timestamp validation.
**Expected outcome:** Without timestamp/nonce validation, replay succeeds. Quantify the window of vulnerability.

### Experiment F6: Encrypted Index for Private list() Operations
**Hypothesis:** A Bloom filter or encrypted inverted index can enable `list()` queries on encrypted namespaces without revealing the full URI set to the node.
**Method:** Implement a probabilistic encrypted index using a keyed Bloom filter. The client derives index keys from the same PBKDF2 seed as the encryption keys. The node stores the Bloom filter. The client queries by deriving the query key and testing membership. Measure false positive rates, index sizes, and query latency.
**Expected outcome:** A 1% false positive Bloom filter for 10,000 URIs requires ~12KB. Query time is sub-millisecond. This is practical for production use.

### Experiment F7: Post-Quantum Hybrid Encryption Prototype
**Hypothesis:** A hybrid X25519 + ML-KEM encryption scheme can be implemented in b3nd with acceptable performance and message size overhead.
**Method:** Using a WASM implementation of ML-KEM-768 (e.g., `pqcrypto-kem`), implement `encryptHybrid()` that produces `sharedSecret = HKDF(X25519_shared || ML-KEM_shared)`. Benchmark encapsulation/decapsulation time and measure ciphertext size increase. Test in Deno and Chrome.
**Expected outcome:** ~2-5ms overhead per encryption. ~1100 bytes additional per message (KEM ciphertext). Acceptable for most use cases.

### Experiment F8: Threshold Signature for Multi-Party Authorization
**Hypothesis:** Threshold signatures (t-of-n) can replace the current "any one of authorized set" model for high-value operations.
**Method:** Implement a Schnorr threshold signature scheme (FROST, Komlo & Goldberg, 2020) compatible with Ed25519. Test with 2-of-3 and 3-of-5 configurations. Measure round-trip latency for distributed signing.
**Expected outcome:** FROST provides Ed25519-compatible threshold signatures with 2 communication rounds. Latency is dominated by network RTT, not computation.

### Experiment F9: Side-Channel Timing Analysis of Signature Verification
**Hypothesis:** The `verify()` function's error handling may leak timing information about which validation step failed.
**Method:** Measure verification time for: (a) valid signature, (b) invalid signature with valid key format, (c) invalid key format, (d) malformed hex input. Run 10,000 trials per case. Statistical analysis (t-test) for timing differences.
**Expected outcome:** Categories (c) and (d) will be faster due to early error in key import. Categories (a) and (b) should be indistinguishable if the underlying crypto is constant-time.

### Experiment F10: Vault Secret Rotation Protocol
**Hypothesis:** A vault `nodeSecret` rotation can be performed without breaking existing user identities.
**Method:** Design and implement a rotation protocol where: (1) new secret is generated, (2) existing users' derived secrets are re-encrypted under the new secret, (3) a transition period allows both old and new secrets. Test that user identities remain stable across rotation.
**Expected outcome:** This requires storing `{sub -> encryptedOldSecret}` during transition, which introduces state to the vault. Quantify the minimal state needed and the security implications.

---

## References

1. Bernstein, D. J., et al. "Ed25519: high-speed high-security signatures." 2012.
2. RFC 8032: Edwards-Curve Digital Signature Algorithm (EdDSA). 2017.
3. RFC 7748: Elliptic Curves for Security (X25519). 2016.
4. RFC 5869: HMAC-based Extract-and-Expand Key Derivation Function (HKDF). 2010.
5. RFC 8785: JSON Canonicalization Scheme (JCS). 2020.
6. RFC 7636: Proof Key for Code Exchange by OAuth Public Clients (PKCE). 2015.
7. RFC 9106: Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications. 2021.
8. RFC 9180: Hybrid Public Key Encryption (HPKE). 2022.
9. RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3. 2018.
10. NIST SP 800-56C Rev. 2: Recommendation for Key-Derivation Methods in Key-Establishment Schemes. 2020.
11. NIST FIPS 203: Module-Lattice-Based Key-Encapsulation Mechanism Standard (ML-KEM). 2024.
12. NIST FIPS 204: Module-Lattice-Based Digital Signature Standard (ML-DSA). 2024.
13. NIST FIPS 205: Stateless Hash-Based Digital Signature Standard (SLH-DSA). 2024.
14. Marlinspike, M. & Perrin, T. "The Double Ratchet Algorithm." Signal Foundation. 2016.
15. Perrin, T. "The Noise Protocol Framework." 2018.
16. Groth, J. "On the Size of Pairing-Based Non-interactive Arguments." EUROCRYPT 2016.
17. Gabizon, A., Williamson, Z., & Ciobotaru, O. "PlonK: Permutations over Lagrange-bases for Oecumenical Noninteractive arguments of Knowledge." 2019.
18. Chillotti, I., et al. "TFHE: Fast Fully Homomorphic Encryption over the Torus." Journal of Cryptology 33, 2020.
19. Komlo, C. & Goldberg, I. "FROST: Flexible Round-Optimized Schnorr Threshold Signatures." SAC 2020.
20. Roetteler, M., et al. "Quantum resource estimates for computing elliptic curve discrete logarithms." ASIACRYPT 2017.
21. Oren, Y., et al. "The Spy in the Sandbox: Practical Cache Attacks in JavaScript and their Implications." ACM CCS 2015.
22. Valsorda, F. "age: a simple, modern, and secure file encryption tool." 2019.
23. OWASP Password Storage Cheat Sheet. 2023.
24. W3C Decentralized Identifiers (DIDs) v1.0. W3C Recommendation. 2022.

---

## Appendix: Source File Map

| File | Purpose | Key Functions |
|------|---------|---------------|
| `libs/b3nd-encrypt/mod.ts` | Core crypto: signing, encryption, key derivation | `sign()`, `verify()`, `encrypt()`, `decrypt()`, `deriveKeyFromSeed()`, `deriveSigningKeyPairFromSeed()`, `deriveEncryptionKeyPairFromSeed()`, `hmac()` |
| `libs/b3nd-encrypt/utils.ts` | Path obfuscation | `deriveObfuscatedPath()` |
| `libs/b3nd-auth/mod.ts` | Access control: signature validation, cascading auth | `authValidation()`, `createPubkeyBasedAccess()`, `createCombinedAccess()` |
| `libs/b3nd-hash/mod.ts` | Content addressing, integrity | `computeSha256()`, `hashValidator()`, `verifyHashContent()` |
| `libs/b3nd-wallet/client.ts` | Custodial wallet client | `WalletClient`, `generateSessionKeypair()` |
| `apps/vault-listener/vault.ts` | Non-custodial OAuth vault handler | `createVaultHandler()` |
| `docs/design/auth-protocol.md` | Auth protocol specification | PBKDF2 flow, PKCE+HMAC flow, trust boundaries |
| `skills/b3nd/DESIGN_EXCHANGE.md` | Trust models and exchange patterns | 6 trust models, party interactions, crypto guarantees |
| `libs/firecat-protocol/TEMPORAL_CONSENSUS.md` | Consensus protocol | Pending/Attestation/Confirmation/Slot stages |

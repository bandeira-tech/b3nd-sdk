/**
 * E8: Hybrid Ed25519 + ML-DSA-65 Dual Signature Proof-of-Concept
 *
 * This module defines the types, signing/verification functions, wire format,
 * key serialization, and migration helpers for integrating a hybrid
 * post-quantum signature scheme into b3nd's existing auth module.
 *
 * The ML-DSA-65 operations are stubbed (marked with `pq.*`) because the
 * actual WASM library (mldsa-wasm) cannot be installed in this environment.
 * Every stub is annotated with the real API call it would use.
 *
 * Design principles:
 *   1. Both signatures MUST verify for a hybrid message to be accepted.
 *   2. The classical Ed25519 signature binds the PQ signature to prevent
 *      stripping attacks: Ed25519 signs (message || pqSignature).
 *   3. Classical-only nodes can still verify the Ed25519 component, but
 *      hybrid-aware nodes MUST verify both.
 *   4. All hex encoding uses the existing b3nd-core/encoding helpers.
 */

// ---------------------------------------------------------------------------
// 0. Imports (real b3nd imports + PQ stub)
// ---------------------------------------------------------------------------

// In production these come from the actual modules:
// import { encodeHex, decodeHex } from "../../libs/b3nd-core/encoding.ts";
// import { sign, verify, IdentityKey } from "../../libs/b3nd-encrypt/mod.ts";
// import * as pq from "mldsa-wasm";                // ML-DSA-65 WASM

// Stubs so this file is self-contained and type-checks without dependencies:
function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function decodeHex(hex: string): Uint8Array {
  const buf = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) buf[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return buf;
}

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** ML-DSA-65 sizes per FIPS 204 */
export const ML_DSA_65 = {
  PUBLIC_KEY_BYTES: 1952,
  PRIVATE_KEY_BYTES: 4032,
  SIGNATURE_BYTES: 3309,
} as const;

/** Ed25519 sizes */
export const ED25519 = {
  PUBLIC_KEY_BYTES: 32,
  PRIVATE_KEY_BYTES: 64,   // PKCS#8 encoded is 48 bytes, raw seed is 32
  SIGNATURE_BYTES: 64,
} as const;

/** Hybrid combined sizes */
export const HYBRID = {
  PUBLIC_KEY_BYTES: ED25519.PUBLIC_KEY_BYTES + ML_DSA_65.PUBLIC_KEY_BYTES,  // 1984
  SIGNATURE_BYTES: ED25519.SIGNATURE_BYTES + ML_DSA_65.SIGNATURE_BYTES,    // 3373
} as const;

/**
 * Signature scheme version byte.
 * Placed as the first byte of serialized public keys and signatures
 * so parsers can distinguish classical from hybrid.
 */
export const enum SignatureVersion {
  /** Classical Ed25519 only (existing b3nd messages) */
  CLASSICAL = 0x01,
  /** Hybrid Ed25519 + ML-DSA-65 */
  HYBRID_V1 = 0x02,
}

// ---------------------------------------------------------------------------
// 2. Types
// ---------------------------------------------------------------------------

/** Raw key material for hybrid signing. */
export interface HybridKeypair {
  classical: {
    publicKey: Uint8Array;   // 32 bytes (Ed25519 raw)
    privateKey: CryptoKey;   // WebCrypto Ed25519 private key
  };
  pq: {
    publicKey: Uint8Array;   // 1952 bytes (ML-DSA-65)
    privateKey: Uint8Array;  // 4032 bytes (ML-DSA-65)
  };
}

/** Hex-encoded key material, matching b3nd's existing KeyPair.publicKeyHex pattern. */
export interface HybridKeypairHex {
  classical: {
    publicKeyHex: string;    // 64 hex chars
    privateKeyHex: string;   // 96 hex chars (PKCS#8)
  };
  pq: {
    publicKeyHex: string;    // 3904 hex chars
    privateKeyHex: string;   // 8064 hex chars
  };
  /** Combined public key in the versioned wire format (hex). */
  hybridPublicKeyHex: string;
}

/** A dual signature produced by hybridSign. */
export interface HybridSignature {
  classical: Uint8Array;     // 64 bytes (Ed25519)
  pq: Uint8Array;            // 3309 bytes (ML-DSA-65)
}

/** Hex-encoded dual signature, matching b3nd's { signature: string } pattern. */
export interface HybridSignatureHex {
  classicalHex: string;      // 128 hex chars
  pqHex: string;             // 6618 hex chars
  /** Combined signature in the versioned wire format (hex). */
  hybridSignatureHex: string;
}

/**
 * Extended auth entry for hybrid messages.
 * This is the on-wire representation inside AuthenticatedMessage.auth[].
 *
 * When `version` is absent or CLASSICAL, the entry is a standard b3nd auth
 * entry and only `pubkey` + `signature` are present.
 *
 * When `version` is HYBRID_V1, `pubkey` contains the versioned hybrid public
 * key and `signature` contains the versioned hybrid signature.
 */
export interface HybridAuthEntry {
  pubkey: string;            // hex-encoded (versioned if hybrid)
  signature: string;         // hex-encoded (versioned if hybrid)
  version?: SignatureVersion;
}

/**
 * Capability flags advertised during handshake / in node metadata.
 */
export interface PQCapability {
  /** Node supports hybrid Ed25519+ML-DSA-65 signatures */
  hybridSign: boolean;
  /** Node supports hybrid X25519+ML-KEM-768 key exchange */
  hybridKex: boolean;
  /** Minimum signature version the node will accept */
  minSignatureVersion: SignatureVersion;
}

// ---------------------------------------------------------------------------
// 3. PQ Stub Namespace
//    In production, replace with: import * as pq from "mldsa-wasm";
// ---------------------------------------------------------------------------

/**
 * Stub for mldsa-wasm. Each function documents the real API.
 *
 * Real mldsa-wasm API (from npm):
 *   - mldsa.keypair()                     -> { publicKey: Uint8Array, secretKey: Uint8Array }
 *   - mldsa.sign(message, secretKey)      -> Uint8Array (signature)
 *   - mldsa.verify(signature, message, publicKey) -> boolean
 */
namespace pq {
  export function keypair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
    // STUB: in production this calls mldsa.keypair()
    return {
      publicKey: new Uint8Array(ML_DSA_65.PUBLIC_KEY_BYTES),
      secretKey: new Uint8Array(ML_DSA_65.PRIVATE_KEY_BYTES),
    };
  }

  export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
    // STUB: in production this calls mldsa.sign(message, secretKey)
    void secretKey;
    void message;
    return new Uint8Array(ML_DSA_65.SIGNATURE_BYTES);
  }

  export function verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ): boolean {
    // STUB: in production this calls mldsa.verify(signature, message, publicKey)
    void signature;
    void message;
    void publicKey;
    return true;
  }
}

// ---------------------------------------------------------------------------
// 4. Key Generation
// ---------------------------------------------------------------------------

/**
 * Generate a fresh hybrid keypair.
 *
 * The classical Ed25519 key is generated via WebCrypto (same as existing
 * `generateSigningKeyPair` in b3nd-encrypt/mod.ts). The PQ key is generated
 * via the mldsa-wasm library.
 */
export async function generateHybridKeypair(): Promise<HybridKeypair> {
  // --- Classical (Ed25519) via WebCrypto ---
  const classicalPair = await crypto.subtle.generateKey(
    { name: "Ed25519", namedCurve: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const classicalPub = new Uint8Array(
    await crypto.subtle.exportKey("raw", classicalPair.publicKey),
  );

  // --- Post-Quantum (ML-DSA-65) via mldsa-wasm ---
  const pqPair = pq.keypair();

  return {
    classical: {
      publicKey: classicalPub,
      privateKey: classicalPair.privateKey,
    },
    pq: {
      publicKey: pqPair.publicKey,
      privateKey: pqPair.secretKey,
    },
  };
}

/**
 * Derive hex-encoded representations and the combined hybrid public key.
 */
export async function keypairToHex(kp: HybridKeypair): Promise<HybridKeypairHex> {
  const classicalPrivBytes = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", kp.classical.privateKey),
  );

  const classicalPubHex = encodeHex(kp.classical.publicKey);
  const classicalPrivHex = encodeHex(classicalPrivBytes);
  const pqPubHex = encodeHex(kp.pq.publicKey);
  const pqPrivHex = encodeHex(kp.pq.privateKey);

  // Versioned hybrid public key: [version(1) | ed25519_pub(32) | mldsa_pub(1952)]
  const hybridPub = serializeHybridPublicKey(kp.classical.publicKey, kp.pq.publicKey);

  return {
    classical: { publicKeyHex: classicalPubHex, privateKeyHex: classicalPrivHex },
    pq: { publicKeyHex: pqPubHex, privateKeyHex: pqPrivHex },
    hybridPublicKeyHex: encodeHex(hybridPub),
  };
}

// ---------------------------------------------------------------------------
// 5. Wire Format Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a hybrid public key into the versioned wire format.
 *
 * Layout (1985 bytes total):
 *   Byte 0:        Version tag (0x02 = HYBRID_V1)
 *   Bytes 1..32:   Ed25519 public key (32 bytes)
 *   Bytes 33..1984: ML-DSA-65 public key (1952 bytes)
 *
 * This layout is unambiguous: existing classical pubkeys are 32 bytes of
 * raw hex with no version prefix. Any pubkey longer than 32 bytes (or whose
 * first byte is 0x02 when decoded) is hybrid. Parsers that see a 64-char
 * hex string treat it as classical; parsers that see a 3970-char hex string
 * (1985 bytes) check the version byte.
 */
export function serializeHybridPublicKey(
  classicalPub: Uint8Array,
  pqPub: Uint8Array,
): Uint8Array {
  if (classicalPub.length !== ED25519.PUBLIC_KEY_BYTES) {
    throw new Error(`Ed25519 public key must be ${ED25519.PUBLIC_KEY_BYTES} bytes`);
  }
  if (pqPub.length !== ML_DSA_65.PUBLIC_KEY_BYTES) {
    throw new Error(`ML-DSA-65 public key must be ${ML_DSA_65.PUBLIC_KEY_BYTES} bytes`);
  }

  const buf = new Uint8Array(1 + ED25519.PUBLIC_KEY_BYTES + ML_DSA_65.PUBLIC_KEY_BYTES);
  buf[0] = SignatureVersion.HYBRID_V1;
  buf.set(classicalPub, 1);
  buf.set(pqPub, 1 + ED25519.PUBLIC_KEY_BYTES);
  return buf;
}

/**
 * Deserialize a versioned public key.
 * Returns the version and component keys.
 */
export function deserializePublicKey(
  data: Uint8Array,
): { version: SignatureVersion; classicalPub: Uint8Array; pqPub?: Uint8Array } {
  if (data.length === ED25519.PUBLIC_KEY_BYTES) {
    // Legacy classical key (no version prefix)
    return { version: SignatureVersion.CLASSICAL, classicalPub: data };
  }

  if (data.length === 1 + ED25519.PUBLIC_KEY_BYTES + ML_DSA_65.PUBLIC_KEY_BYTES) {
    const version = data[0];
    if (version !== SignatureVersion.HYBRID_V1) {
      throw new Error(`Unknown signature version: 0x${version.toString(16)}`);
    }
    return {
      version: SignatureVersion.HYBRID_V1,
      classicalPub: data.slice(1, 1 + ED25519.PUBLIC_KEY_BYTES),
      pqPub: data.slice(1 + ED25519.PUBLIC_KEY_BYTES),
    };
  }

  throw new Error(`Invalid public key length: ${data.length}`);
}

/**
 * Serialize a hybrid signature into the versioned wire format.
 *
 * Layout (3374 bytes total):
 *   Byte 0:          Version tag (0x02 = HYBRID_V1)
 *   Bytes 1..64:     Ed25519 signature (64 bytes)
 *   Bytes 65..3373:  ML-DSA-65 signature (3309 bytes)
 *
 * IMPORTANT: The Ed25519 signature covers (message || pqSignature).
 * This binds the two signatures together so an attacker cannot strip
 * the PQ signature and replace it with a different one.
 */
export function serializeHybridSignature(
  classicalSig: Uint8Array,
  pqSig: Uint8Array,
): Uint8Array {
  if (classicalSig.length !== ED25519.SIGNATURE_BYTES) {
    throw new Error(`Ed25519 signature must be ${ED25519.SIGNATURE_BYTES} bytes`);
  }
  if (pqSig.length !== ML_DSA_65.SIGNATURE_BYTES) {
    throw new Error(`ML-DSA-65 signature must be ${ML_DSA_65.SIGNATURE_BYTES} bytes`);
  }

  const buf = new Uint8Array(1 + ED25519.SIGNATURE_BYTES + ML_DSA_65.SIGNATURE_BYTES);
  buf[0] = SignatureVersion.HYBRID_V1;
  buf.set(classicalSig, 1);
  buf.set(pqSig, 1 + ED25519.SIGNATURE_BYTES);
  return buf;
}

/**
 * Deserialize a versioned signature.
 */
export function deserializeSignature(
  data: Uint8Array,
): { version: SignatureVersion; classicalSig: Uint8Array; pqSig?: Uint8Array } {
  if (data.length === ED25519.SIGNATURE_BYTES) {
    // Legacy classical signature (no version prefix)
    return { version: SignatureVersion.CLASSICAL, classicalSig: data };
  }

  if (data.length === 1 + ED25519.SIGNATURE_BYTES + ML_DSA_65.SIGNATURE_BYTES) {
    const version = data[0];
    if (version !== SignatureVersion.HYBRID_V1) {
      throw new Error(`Unknown signature version: 0x${version.toString(16)}`);
    }
    return {
      version: SignatureVersion.HYBRID_V1,
      classicalSig: data.slice(1, 1 + ED25519.SIGNATURE_BYTES),
      pqSig: data.slice(1 + ED25519.SIGNATURE_BYTES),
    };
  }

  throw new Error(`Invalid signature length: ${data.length}`);
}

// ---------------------------------------------------------------------------
// 6. Signing — hybridSign()
// ---------------------------------------------------------------------------

/**
 * Produce a hybrid dual signature over a message.
 *
 * Signature binding strategy (prevents stripping attacks):
 *   1. Compute pqSig = ML-DSA-65.sign(message, pqPrivateKey)
 *   2. Compute classicalSig = Ed25519.sign(message || pqSig, classicalPrivateKey)
 *   3. Return (classicalSig, pqSig)
 *
 * The Ed25519 signature commits to the PQ signature, so an attacker who
 * strips the PQ signature invalidates the Ed25519 signature too.
 *
 * Verification must reverse this:
 *   1. Parse classicalSig and pqSig from the wire format
 *   2. Verify pqSig against message (ML-DSA-65)
 *   3. Verify classicalSig against (message || pqSig) (Ed25519)
 *   4. BOTH must pass
 */
export async function hybridSign(
  message: Uint8Array,
  keypair: HybridKeypair,
): Promise<Uint8Array> {
  // Step 1: PQ signature over the raw message
  const pqSig = pq.sign(message, keypair.pq.privateKey);

  // Step 2: Classical signature over (message || pqSig) for binding
  const boundMessage = new Uint8Array(message.length + pqSig.length);
  boundMessage.set(message, 0);
  boundMessage.set(pqSig, message.length);

  const classicalSig = new Uint8Array(
    await crypto.subtle.sign("Ed25519", keypair.classical.privateKey, boundMessage),
  );

  // Step 3: Serialize into versioned wire format
  return serializeHybridSignature(classicalSig, pqSig);
}

/**
 * Convenience: sign a JSON payload (matching b3nd's existing sign() pattern).
 *
 * This mirrors the existing `sign<T>(privateKey, payload)` function in
 * b3nd-encrypt/mod.ts, but produces a hybrid signature.
 */
export async function hybridSignPayload<T>(
  payload: T,
  keypair: HybridKeypair,
): Promise<string> {
  const encoder = new TextEncoder();
  const message = encoder.encode(JSON.stringify(payload));
  const sig = await hybridSign(message, keypair);
  return encodeHex(sig);
}

// ---------------------------------------------------------------------------
// 7. Verification — hybridVerify()
// ---------------------------------------------------------------------------

/**
 * Verify a hybrid dual signature.
 *
 * BOTH the classical AND the PQ signature must verify. If either fails,
 * the entire verification fails. There is no "partial pass".
 *
 * @param message     - The original message bytes
 * @param signature   - Versioned hybrid signature (from hybridSign)
 * @param classicalPub - Ed25519 public key (32 bytes)
 * @param pqPub       - ML-DSA-65 public key (1952 bytes)
 * @returns true only if both signatures verify
 */
export async function hybridVerify(
  message: Uint8Array,
  signature: Uint8Array,
  classicalPub: Uint8Array,
  pqPub: Uint8Array,
): Promise<boolean> {
  const parsed = deserializeSignature(signature);

  if (parsed.version !== SignatureVersion.HYBRID_V1 || !parsed.pqSig) {
    return false; // Not a hybrid signature
  }

  // Step 1: Verify PQ signature against the raw message
  const pqValid = pq.verify(parsed.pqSig, message, pqPub);
  if (!pqValid) return false;

  // Step 2: Verify classical signature against (message || pqSig)
  const boundMessage = new Uint8Array(message.length + parsed.pqSig.length);
  boundMessage.set(message, 0);
  boundMessage.set(parsed.pqSig, message.length);

  const importedPub = await crypto.subtle.importKey(
    "raw",
    classicalPub,
    { name: "Ed25519", namedCurve: "Ed25519" },
    false,
    ["verify"],
  );

  const classicalValid = await crypto.subtle.verify(
    "Ed25519",
    importedPub,
    parsed.classicalSig,
    boundMessage,
  );

  return classicalValid;
}

/**
 * Convenience: verify a hex-encoded hybrid signature over a JSON payload.
 *
 * This mirrors the existing `verify<T>(pubkeyHex, signatureHex, payload)`
 * function in b3nd-encrypt/mod.ts.
 */
export async function hybridVerifyPayload<T>(
  hybridPublicKeyHex: string,
  signatureHex: string,
  payload: T,
): Promise<boolean> {
  try {
    const pubKeyData = decodeHex(hybridPublicKeyHex);
    const sigData = decodeHex(signatureHex);
    const parsed = deserializePublicKey(pubKeyData);

    if (parsed.version === SignatureVersion.CLASSICAL) {
      // Caller passed a classical key to a hybrid verifier — reject.
      // Use the classical verify() function instead.
      return false;
    }

    if (!parsed.pqPub) return false;

    const encoder = new TextEncoder();
    const message = encoder.encode(JSON.stringify(payload));
    return await hybridVerify(message, sigData, parsed.classicalPub, parsed.pqPub);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 8. Unified Verification (classical OR hybrid, auto-detected)
// ---------------------------------------------------------------------------

/**
 * Verify a signature that may be either classical or hybrid.
 *
 * This is the key integration point: it replaces the existing `verify()`
 * function in b3nd-encrypt/mod.ts with a version-aware dispatcher.
 *
 * Detection heuristic:
 *   - If pubkeyHex is 64 chars (32 bytes): classical Ed25519
 *   - If pubkeyHex is 3970 chars (1985 bytes) and starts with "02": hybrid
 *
 * For classical signatures, behavior is identical to the existing verify().
 * For hybrid signatures, BOTH components must verify.
 */
export async function unifiedVerify<T>(
  pubkeyHex: string,
  signatureHex: string,
  payload: T,
): Promise<boolean> {
  try {
    const pubBytes = decodeHex(pubkeyHex);
    const sigBytes = decodeHex(signatureHex);
    const encoder = new TextEncoder();
    const message = encoder.encode(JSON.stringify(payload));

    // Auto-detect based on key length
    if (pubBytes.length === ED25519.PUBLIC_KEY_BYTES) {
      // Classical Ed25519 verification (existing behavior)
      if (sigBytes.length !== ED25519.SIGNATURE_BYTES) return false;

      const importedPub = await crypto.subtle.importKey(
        "raw", pubBytes,
        { name: "Ed25519", namedCurve: "Ed25519" },
        false, ["verify"],
      );
      return await crypto.subtle.verify("Ed25519", importedPub, sigBytes, message);
    }

    // Hybrid verification
    const parsed = deserializePublicKey(pubBytes);
    if (parsed.version !== SignatureVersion.HYBRID_V1 || !parsed.pqPub) {
      return false;
    }

    return await hybridVerify(message, sigBytes, parsed.classicalPub, parsed.pqPub);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 9. Migration Helpers
// ---------------------------------------------------------------------------

/**
 * Upgrade a classical Ed25519 keypair to a hybrid keypair.
 *
 * This generates a fresh ML-DSA-65 keypair and pairs it with the existing
 * Ed25519 key. The Ed25519 identity (public key) is preserved, so the
 * node's identity does not change — it just gains PQ capability.
 *
 * The hybrid public key includes the original Ed25519 key, so existing
 * references to the node's classical pubkey remain valid when extracted
 * from the hybrid key.
 */
export async function upgradeToHybrid(
  classicalPrivateKey: CryptoKey,
  classicalPublicKeyBytes: Uint8Array,
): Promise<HybridKeypair> {
  // Generate fresh PQ keypair
  const pqPair = pq.keypair();

  return {
    classical: {
      publicKey: classicalPublicKeyBytes,
      privateKey: classicalPrivateKey,
    },
    pq: {
      publicKey: pqPair.publicKey,
      privateKey: pqPair.secretKey,
    },
  };
}

/**
 * Upgrade an IdentityKey (from b3nd-encrypt/mod.ts) to a hybrid identity.
 *
 * Usage:
 *   const identity = await IdentityKey.generate();
 *   const hybridKp = await upgradeIdentityKey(identity);
 *
 * In production, IdentityKey would be extended with a `toHybrid()` method.
 */
export async function upgradeIdentityKey(
  // In production: identity: IdentityKey
  identity: { publicKeyHex: string; _privateKey: CryptoKey },
): Promise<HybridKeypair> {
  const classicalPub = decodeHex(identity.publicKeyHex);
  return upgradeToHybrid(identity._privateKey, classicalPub);
}

/**
 * Extract the classical Ed25519 public key from a hybrid public key.
 *
 * This enables backward compatibility: given a hybrid pubkey, extract
 * just the Ed25519 component for use with classical-only nodes.
 */
export function extractClassicalPublicKey(hybridPublicKeyHex: string): string {
  const data = decodeHex(hybridPublicKeyHex);
  const parsed = deserializePublicKey(data);
  return encodeHex(parsed.classicalPub);
}

/**
 * Check whether a hex-encoded public key is hybrid or classical.
 */
export function isHybridKey(pubkeyHex: string): boolean {
  // Hybrid keys are 1985 bytes = 3970 hex chars
  // Classical keys are 32 bytes = 64 hex chars
  return pubkeyHex.length === (1 + ED25519.PUBLIC_KEY_BYTES + ML_DSA_65.PUBLIC_KEY_BYTES) * 2;
}

// ---------------------------------------------------------------------------
// 10. Integration with AuthenticatedMessage
// ---------------------------------------------------------------------------

/**
 * Create an AuthenticatedMessage with a hybrid signature.
 *
 * This mirrors `createAuthenticatedMessage()` from b3nd-encrypt/mod.ts
 * but uses hybrid signing.
 *
 * The `auth` array entry uses the versioned hybrid public key and signature,
 * so existing parsers that treat `pubkey` and `signature` as opaque hex
 * strings continue to work — they just pass larger strings around.
 */
export async function createHybridAuthenticatedMessage<T>(
  payload: T,
  keypair: HybridKeypair,
): Promise<{ auth: HybridAuthEntry[]; payload: T }> {
  const signatureHex = await hybridSignPayload(payload, keypair);
  const hybridPubKey = serializeHybridPublicKey(
    keypair.classical.publicKey,
    keypair.pq.publicKey,
  );

  return {
    auth: [{
      pubkey: encodeHex(hybridPubKey),
      signature: signatureHex,
      version: SignatureVersion.HYBRID_V1,
    }],
    payload,
  };
}

/**
 * Validate an AuthenticatedMessage that may contain classical or hybrid
 * auth entries. This is the hybrid-aware replacement for
 * `validateAuthMessage()` in b3nd-auth/mod.ts.
 *
 * Key behavior:
 *   - Classical auth entries (64-char pubkey) are verified with Ed25519.
 *   - Hybrid auth entries (3970-char pubkey) are verified with both
 *     Ed25519 and ML-DSA-65.
 *   - At least one valid signature from an authorized pubkey is required.
 *
 * Authorization matching:
 *   - The authorized pubkeys list may contain either classical or hybrid keys.
 *   - A hybrid key MATCHES a classical authorized pubkey if the Ed25519
 *     component is identical. This enables smooth migration: existing ACLs
 *     that reference classical keys still work after upgrade.
 */
export async function validateHybridAuthMessage<T>(
  write: {
    uri: string;
    value: {
      auth: Array<{ pubkey: string; signature: string }>;
      payload: T;
    };
  },
  getWriteAccess: (url: string) => Promise<string[]>,
): Promise<boolean> {
  // Build cascading paths (same as existing buildCascadingPaths)
  const parsed = new URL(write.uri);
  const pathParts = parsed.pathname.split("/").filter((p) => p.length > 0);
  const paths: string[] = [];
  for (let i = pathParts.length; i > 0; i--) {
    paths.push(`${parsed.protocol}//${parsed.host}/${pathParts.slice(0, i).join("/")}`);
  }

  const authorizedArrays = await Promise.all(paths.map((p) => getWriteAccess(p)));
  const authorizedPubkeys = new Set(authorizedArrays.flat());

  for (const auth of write.value.auth) {
    // Check authorization. For hybrid keys, also check if the classical
    // component matches any authorized classical key.
    let isAuthorized = authorizedPubkeys.has(auth.pubkey);

    if (!isAuthorized && isHybridKey(auth.pubkey)) {
      const classicalPub = extractClassicalPublicKey(auth.pubkey);
      isAuthorized = authorizedPubkeys.has(classicalPub);
    }

    if (!isAuthorized) continue;

    // Verify signature (auto-detect classical vs hybrid)
    const isValid = await unifiedVerify(auth.pubkey, auth.signature, write.value.payload);
    if (isValid) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// 11. HybridIdentityKey — Extended IdentityKey class
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for IdentityKey that supports hybrid signing.
 *
 * This class maintains API compatibility with the existing IdentityKey:
 *   - .publicKeyHex returns the CLASSICAL Ed25519 hex (for backward compat)
 *   - .hybridPublicKeyHex returns the full versioned hybrid key
 *   - .sign(payload) produces a hybrid signature
 *   - .signClassical(payload) produces a classical-only signature (fallback)
 */
export class HybridIdentityKey {
  private constructor(
    private readonly classicalPrivateKey: CryptoKey,
    private readonly pqPrivateKey: Uint8Array,
    private readonly pqPublicKey: Uint8Array,
    /** Classical Ed25519 public key hex (backward compatible identity) */
    readonly publicKeyHex: string,
    /** Full hybrid public key hex (versioned wire format) */
    readonly hybridPublicKeyHex: string,
  ) {}

  static async generate(): Promise<{
    key: HybridIdentityKey;
    classicalPublicKeyHex: string;
    hybridPublicKeyHex: string;
  }> {
    const kp = await generateHybridKeypair();
    const classicalPubHex = encodeHex(kp.classical.publicKey);
    const hybridPub = serializeHybridPublicKey(kp.classical.publicKey, kp.pq.publicKey);
    const hybridPubHex = encodeHex(hybridPub);

    const key = new HybridIdentityKey(
      kp.classical.privateKey,
      kp.pq.privateKey,
      kp.pq.publicKey,
      classicalPubHex,
      hybridPubHex,
    );

    return { key, classicalPublicKeyHex: classicalPubHex, hybridPublicKeyHex: hybridPubHex };
  }

  /** Produce a hybrid signature (default). */
  async sign(payload: unknown): Promise<string> {
    const encoder = new TextEncoder();
    const message = encoder.encode(JSON.stringify(payload));
    const kp: HybridKeypair = {
      classical: {
        publicKey: decodeHex(this.publicKeyHex),
        privateKey: this.classicalPrivateKey,
      },
      pq: {
        publicKey: this.pqPublicKey,
        privateKey: this.pqPrivateKey,
      },
    };
    const sig = await hybridSign(message, kp);
    return encodeHex(sig);
  }

  /** Produce a classical-only signature (for interop with classical nodes). */
  async signClassical(payload: unknown): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload));
    const sig = await crypto.subtle.sign("Ed25519", this.classicalPrivateKey, data);
    return encodeHex(new Uint8Array(sig));
  }

  /** Get the underlying hybrid keypair for low-level operations. */
  toKeypair(): HybridKeypair {
    return {
      classical: {
        publicKey: decodeHex(this.publicKeyHex),
        privateKey: this.classicalPrivateKey,
      },
      pq: {
        publicKey: this.pqPublicKey,
        privateKey: this.pqPrivateKey,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// 12. Version Negotiation
// ---------------------------------------------------------------------------

/**
 * Create a capability advertisement for inclusion in handshake messages
 * or node metadata.
 *
 * Wire format: a simple JSON object included in the handshake payload.
 * This is NOT a cryptographic commitment — it's a hint for peers to
 * decide which signature version to use.
 *
 * In the b3nd protocol, this would be included in the node's metadata
 * record at its well-known URI:
 *   b3nd://<pubkey>/.well-known/capabilities
 */
export function createCapabilityAdvertisement(
  options: {
    supportHybridSign?: boolean;
    supportHybridKex?: boolean;
    requireHybrid?: boolean;
  } = {},
): PQCapability {
  return {
    hybridSign: options.supportHybridSign ?? false,
    hybridKex: options.supportHybridKex ?? false,
    minSignatureVersion: options.requireHybrid
      ? SignatureVersion.HYBRID_V1
      : SignatureVersion.CLASSICAL,
  };
}

/**
 * Negotiate the signature version to use between two peers.
 *
 * Rules:
 *   1. If both peers support hybrid, use hybrid.
 *   2. If one peer requires hybrid but the other doesn't support it, fail.
 *   3. Otherwise, use classical.
 */
export function negotiateSignatureVersion(
  local: PQCapability,
  remote: PQCapability,
): { version: SignatureVersion; compatible: boolean } {
  // Check if either side REQUIRES hybrid
  if (local.minSignatureVersion === SignatureVersion.HYBRID_V1) {
    if (!remote.hybridSign) {
      return { version: SignatureVersion.CLASSICAL, compatible: false };
    }
    return { version: SignatureVersion.HYBRID_V1, compatible: true };
  }

  if (remote.minSignatureVersion === SignatureVersion.HYBRID_V1) {
    if (!local.hybridSign) {
      return { version: SignatureVersion.CLASSICAL, compatible: false };
    }
    return { version: SignatureVersion.HYBRID_V1, compatible: true };
  }

  // Neither requires hybrid — use hybrid if both support it, else classical
  if (local.hybridSign && remote.hybridSign) {
    return { version: SignatureVersion.HYBRID_V1, compatible: true };
  }

  return { version: SignatureVersion.CLASSICAL, compatible: true };
}

// ---------------------------------------------------------------------------
// 13. signPayload / verifyPayload replacements
// ---------------------------------------------------------------------------

/**
 * Hybrid-aware replacement for `signPayload()` from b3nd-encrypt/mod.ts.
 *
 * If the identity is a HybridIdentityKey, produces a hybrid auth entry.
 * If it's a classical IdentityKey, produces a classical auth entry.
 */
export async function hybridSignPayloadCompat(
  params: {
    payload: unknown;
    identity: HybridIdentityKey;
    mode?: "hybrid" | "classical";
  },
): Promise<Array<{ pubkey: string; signature: string }>> {
  const { payload, identity, mode = "hybrid" } = params;

  if (mode === "classical") {
    const signature = await identity.signClassical(payload);
    return [{ pubkey: identity.publicKeyHex, signature }];
  }

  const signature = await identity.sign(payload);
  return [{ pubkey: identity.hybridPublicKeyHex, signature }];
}

/**
 * Hybrid-aware replacement for `verifyPayload()` from b3nd-encrypt/mod.ts.
 *
 * Auto-detects classical vs hybrid signatures and verifies accordingly.
 */
export async function hybridVerifyPayloadCompat(
  params: {
    payload: unknown;
    auth: Array<{ pubkey: string; signature: string }>;
  },
): Promise<{ verified: boolean; signers: string[] }> {
  const { payload, auth } = params;
  const results = await Promise.all(auth.map(async (entry) => {
    const ok = await unifiedVerify(entry.pubkey, entry.signature, payload);
    return { pubkey: entry.pubkey, ok };
  }));

  const verified = results.every((r) => r.ok);
  const signers = results.filter((r) => r.ok).map((r) => r.pubkey);
  return { verified, signers };
}

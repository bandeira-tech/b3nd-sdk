/**
 * Path Obfuscation & Encryption Utilities
 *
 * Provides deterministic path derivation and transparent encryption/decryption
 * for all data stored in the public b3nd backend.
 *
 * All data written to the backend is:
 * 1. Encrypted with server's X25519 key
 * 2. Written to a deterministically obfuscated path
 *
 * The obfuscated path is derived from username/operationType/params,
 * ensuring same inputs always produce same path (deterministic),
 * but the path itself reveals nothing about the data.
 */

import { encodeHex } from "../shared/encoding.ts";
import {
  encrypt as encryptData,
  decrypt as decryptData,
  createSignedEncryptedMessage,
  verifyPayload,
  type EncryptedPayload,
  type SignedEncryptedMessage,
} from "../encrypt/mod.ts";

/**
 * Operation types for path obfuscation
 */
export type OperationType =
  | "password"
  | "account-key"
  | "encryption-key"
  | "profile"
  | "reset-tokens"
  | "google-profile";

/**
 * Derive obfuscated path deterministically using HMAC-SHA256
 *
 * Inputs:
 * - serverPublicKey: Server's Ed25519 public key (for context)
 * - username: Username to obfuscate
 * - operationType: Type of operation (password, keys, tokens, etc.)
 * - params: Additional parameters (e.g., token id)
 *
 * Output: Hex string that looks like random data
 *
 * Properties:
 * - Deterministic: Same inputs → same output
 * - Non-reversible: Can't guess username from hash
 * - Uniform: All paths look similar length/format
 * - Repeatable: Can reconstruct on write and read
 */
export async function deriveObfuscatedPath(
  serverPublicKey: string,
  username: string,
  operationType: OperationType,
  ...params: string[]
): Promise<string> {
  const encoder = new TextEncoder();

  // Build input string
  const parts = [username, operationType, serverPublicKey, ...params];
  const input = parts.join("|");

  // HMAC-SHA256 using server public key as secret
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(serverPublicKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(input)
  );

  // Return first 32 hex characters (128 bits) for reasonable path length
  return encodeHex(new Uint8Array(signature)).substring(0, 32);
}

/**
 * Convert PEM string to CryptoKey
 */
export async function pemToCryptoKey(
  pem: string,
  algorithm: "Ed25519" | "X25519" = "Ed25519"
): Promise<CryptoKey> {
  const base64 = pem
    .split("\n")
    .filter((line) => !line.startsWith("-----"))
    .join("");

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;

  if (algorithm === "Ed25519") {
    return await crypto.subtle.importKey(
      "pkcs8",
      buffer,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["sign"]
    );
  } else {
    return await crypto.subtle.importKey(
      "pkcs8",
      buffer,
      { name: "X25519", namedCurve: "X25519" },
      false,
      ["deriveBits"]
    );
  }
}

/**
 * Create a signed+encrypted payload for storage
 * Signs with server identity key, encrypts with server encryption key
 */
export async function createSignedEncryptedPayload(
  data: unknown,
  serverIdentityPrivateKeyPem: string,
  serverIdentityPublicKeyHex: string,
  serverEncryptionPublicKeyHex: string
): Promise<SignedEncryptedMessage> {
  const identityPrivateKey = await pemToCryptoKey(
    serverIdentityPrivateKeyPem,
    "Ed25519"
  );

  return await createSignedEncryptedMessage(
    data,
    [{ privateKey: identityPrivateKey, publicKeyHex: serverIdentityPublicKeyHex }],
    serverEncryptionPublicKeyHex
  );
}

/**
 * Decrypt and verify a signed+encrypted payload from storage
 */
export async function decryptSignedEncryptedPayload(
  signedMessage: SignedEncryptedMessage,
  serverEncryptionPrivateKeyPem: string
): Promise<{ data: unknown; verified: boolean; signers: string[] }> {
  const encryptionPrivateKey = await pemToCryptoKey(
    serverEncryptionPrivateKeyPem,
    "X25519"
  );

  // Verify the signature on the encrypted payload
  const { verified, signers } = await verifyPayload({
    payload: signedMessage.payload,
    auth: signedMessage.auth,
  });

  // Decrypt the payload
  const data = await decryptData(signedMessage.payload, encryptionPrivateKey);

  return { data, verified, signers };
}

/**
 * Encrypt data using server's X25519 public key
 * Returns the encrypted payload structure
 */
export async function encryptForBackend(
  data: unknown,
  serverEncryptionPublicKeyHex: string
): Promise<EncryptedPayload> {
  return await encryptData(data, serverEncryptionPublicKeyHex);
}

/**
 * Decrypt data using server's X25519 private key
 * Expects the encrypted payload structure
 */
export async function decryptFromBackend(
  encryptedPayload: EncryptedPayload,
  serverEncryptionPrivateKeyPem: string
): Promise<unknown> {
  const privateKey = await pemToCryptoKey(
    serverEncryptionPrivateKeyPem,
    "X25519"
  );
  return await decryptData(encryptedPayload, privateKey);
}

/**
 * Complete write operation: encrypt data and return with obfuscated path
 */
export async function encryptedWrite(
  serverPublicKey: string,
  serverEncryptionPublicKeyHex: string,
  username: string,
  operationType: OperationType,
  data: unknown,
  ...params: string[]
): Promise<{
  path: string;
  encryptedPayload: EncryptedPayload;
}> {
  const path = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    operationType,
    ...params
  );

  const encryptedPayload = await encryptForBackend(
    data,
    serverEncryptionPublicKeyHex
  );

  return { path, encryptedPayload };
}

/**
 * Complete read operation: get path and decrypt data
 */
export async function encryptedRead(
  serverPublicKey: string,
  serverEncryptionPrivateKeyPem: string,
  username: string,
  operationType: OperationType,
  encryptedPayload: EncryptedPayload,
  ...params: string[]
): Promise<unknown> {
  // Verify path matches (optional, but good for consistency)
  const _expectedPath = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    operationType,
    ...params
  );

  // Path verification happens externally, just decrypt here
  return await decryptFromBackend(encryptedPayload, serverEncryptionPrivateKeyPem);
}

// Re-export types from encrypt module
export type { EncryptedPayload, SignedEncryptedMessage };

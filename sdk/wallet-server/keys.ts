/**
 * User Key Management
 *
 * Generates and manages user Ed25519 (account/signing) and X25519 (encryption) keys.
 */

import { encodeHex } from "../shared/encoding.ts";
import type { NodeProtocolInterface } from "../src/types.ts";
import type { Logger } from "./interfaces.ts";
import type { UserKeys } from "./types.ts";
import {
  deriveObfuscatedPath,
  createSignedEncryptedPayload,
  decryptSignedEncryptedPayload,
} from "./obfuscation.ts";

/**
 * Convert Uint8Array to base64
 */
function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Generate Ed25519 key pair (for signing/account identity)
 */
async function generateAccountKeyPair(): Promise<{
  privateKeyPem: string;
  publicKeyHex: string;
}> {
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const privateKeyBuffer = await crypto.subtle.exportKey(
    "pkcs8",
    keyPair.privateKey
  );
  const publicKeyBuffer = await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey
  );

  const privateKeyBase64 = bytesToBase64(new Uint8Array(privateKeyBuffer));
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64
    .match(/.{1,64}/g)
    ?.join("\n")}\n-----END PRIVATE KEY-----`;

  const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));

  return { privateKeyPem, publicKeyHex };
}

/**
 * Generate X25519 key pair (for encryption/decryption)
 */
async function generateEncryptionKeyPair(): Promise<{
  privateKeyPem: string;
  publicKeyHex: string;
}> {
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: "X25519",
      namedCurve: "X25519",
    },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;

  const privateKeyBuffer = await crypto.subtle.exportKey(
    "pkcs8",
    keyPair.privateKey
  );
  const publicKeyBuffer = await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey
  );

  const privateKeyBase64 = bytesToBase64(new Uint8Array(privateKeyBuffer));
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64
    .match(/.{1,64}/g)
    ?.join("\n")}\n-----END PRIVATE KEY-----`;

  const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));

  return { privateKeyPem, publicKeyHex };
}

/**
 * Generate and store user keys
 * Stores signed+encrypted at obfuscated paths under: mutable://accounts/{serverPublicKey}/...
 */
export async function generateUserKeys(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  serverIdentityPrivateKeyPem: string,
  serverIdentityPublicKeyHex: string,
  serverEncryptionPublicKeyHex: string
): Promise<UserKeys> {
  // Generate both key pairs in parallel
  const [accountKey, encryptionKey] = await Promise.all([
    generateAccountKeyPair(),
    generateEncryptionKeyPair(),
  ]);

  // Store signed+encrypted at obfuscated paths
  await Promise.all([
    (async () => {
      const path = await deriveObfuscatedPath(
        serverPublicKey,
        username,
        "account-key"
      );
      const signed = await createSignedEncryptedPayload(
        accountKey,
        serverIdentityPrivateKeyPem,
        serverIdentityPublicKeyHex,
        serverEncryptionPublicKeyHex
      );
      await client.write(
        `mutable://accounts/${serverPublicKey}/${path}`,
        signed
      );
    })(),
    (async () => {
      const path = await deriveObfuscatedPath(
        serverPublicKey,
        username,
        "encryption-key"
      );
      const signed = await createSignedEncryptedPayload(
        encryptionKey,
        serverIdentityPrivateKeyPem,
        serverIdentityPublicKeyHex,
        serverEncryptionPublicKeyHex
      );
      await client.write(
        `mutable://accounts/${serverPublicKey}/${path}`,
        signed
      );
    })(),
  ]);

  return { accountKey, encryptionKey };
}

/**
 * Load user's account key (Ed25519)
 */
export async function loadUserAccountKey(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  serverEncryptionPrivateKeyPem: string,
  logger?: Logger
): Promise<{ privateKeyPem: string; publicKeyHex: string }> {
  // Derive obfuscated path
  const path = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "account-key"
  );

  // Read signed+encrypted account key
  const result = await client.read<unknown>(
    `mutable://accounts/${serverPublicKey}/${path}`
  );

  if (!result.success || !result.record?.data) {
    throw new Error("Account key not found");
  }

  // Decrypt and verify the signed payload
  const { data, verified } = await decryptSignedEncryptedPayload(
    result.record.data as Parameters<typeof decryptSignedEncryptedPayload>[0],
    serverEncryptionPrivateKeyPem
  );

  if (!verified) {
    logger?.warn(
      "Account key signature verification failed for user:",
      username
    );
  }

  return data as { privateKeyPem: string; publicKeyHex: string };
}

/**
 * Load user's encryption key (X25519)
 */
export async function loadUserEncryptionKey(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  serverEncryptionPrivateKeyPem: string,
  logger?: Logger
): Promise<{ privateKeyPem: string; publicKeyHex: string }> {
  // Derive obfuscated path
  const path = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "encryption-key"
  );

  // Read signed+encrypted encryption key
  const result = await client.read<unknown>(
    `mutable://accounts/${serverPublicKey}/${path}`
  );

  if (!result.success || !result.record?.data) {
    throw new Error("Encryption key not found");
  }

  // Decrypt and verify the signed payload
  const { data, verified } = await decryptSignedEncryptedPayload(
    result.record.data as Parameters<typeof decryptSignedEncryptedPayload>[0],
    serverEncryptionPrivateKeyPem
  );

  if (!verified) {
    logger?.warn(
      "Encryption key signature verification failed for user:",
      username
    );
  }

  return data as { privateKeyPem: string; publicKeyHex: string };
}

/**
 * Load both user keys
 */
export async function loadUserKeys(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  serverEncryptionPrivateKeyPem: string,
  logger?: Logger
): Promise<UserKeys> {
  const [accountKey, encryptionKey] = await Promise.all([
    loadUserAccountKey(
      client,
      serverPublicKey,
      username,
      serverEncryptionPrivateKeyPem,
      logger
    ),
    loadUserEncryptionKey(
      client,
      serverPublicKey,
      username,
      serverEncryptionPrivateKeyPem,
      logger
    ),
  ]);

  return { accountKey, encryptionKey };
}

/**
 * Get user's public keys (safe to share)
 */
export async function getUserPublicKeys(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  serverEncryptionPrivateKeyPem: string,
  logger?: Logger
): Promise<{ accountPublicKeyHex: string; encryptionPublicKeyHex: string }> {
  const { accountKey, encryptionKey } = await loadUserKeys(
    client,
    serverPublicKey,
    username,
    serverEncryptionPrivateKeyPem,
    logger
  );

  return {
    accountPublicKeyHex: accountKey.publicKeyHex,
    encryptionPublicKeyHex: encryptionKey.publicKeyHex,
  };
}

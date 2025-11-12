/**
 * Generate Server Keys for B3nd Wallet Server
 *
 * Generates Ed25519 (identity) and X25519 (encryption) key pairs
 * and outputs them in the format needed for .env file
 *
 * Run: deno run --allow-write scripts/generate-keys.ts
 */

import { encodeHex } from "@std/encoding/hex";

/**
 * Convert Uint8Array to base64
 */
function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Format private key as PEM
 */
function formatPrivateKeyPem(base64: string, keyType: string): string {
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

/**
 * Generate Ed25519 key pair for signing/identity
 */
async function generateIdentityKeyPair(): Promise<{
  privateKeyPem: string;
  publicKeyHex: string;
}> {
  console.log("Generating Ed25519 identity key pair...");

  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const privateKeyBuffer = await crypto.subtle.exportKey(
    "pkcs8",
    keyPair.privateKey
  );
  const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);

  const privateKeyBase64 = bytesToBase64(new Uint8Array(privateKeyBuffer));
  const privateKeyPem = formatPrivateKeyPem(privateKeyBase64, "Ed25519");
  const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));

  console.log(`✅ Generated Ed25519 key pair`);
  console.log(`   Public key length: ${publicKeyHex.length / 2} bytes`);

  return { privateKeyPem, publicKeyHex };
}

/**
 * Generate X25519 key pair for encryption
 */
async function generateEncryptionKeyPair(): Promise<{
  privateKeyPem: string;
  publicKeyHex: string;
}> {
  console.log("Generating X25519 encryption key pair...");

  const keyPair = (await crypto.subtle.generateKey(
    {
      name: "X25519",
    },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;

  const privateKeyBuffer = await crypto.subtle.exportKey(
    "pkcs8",
    keyPair.privateKey
  );
  const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);

  const privateKeyBase64 = bytesToBase64(new Uint8Array(privateKeyBuffer));
  const privateKeyPem = formatPrivateKeyPem(privateKeyBase64, "X25519");
  const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));

  console.log(`✅ Generated X25519 key pair`);
  console.log(`   Public key length: ${publicKeyHex.length / 2} bytes`);

  return { privateKeyPem, publicKeyHex };
}

/**
 * Main function
 */
async function main() {
  console.log("🔑 Generating B3nd Wallet Server Keys\n");
  console.log("=" .repeat(60));

  // Generate identity keys
  const identityKeys = await generateIdentityKeyPair();

  // Generate encryption keys
  const encryptionKeys = await generateEncryptionKeyPair();

  console.log("\n" + "=".repeat(60));
  console.log("\n📋 Copy these values to your .env file:\n");

  // Output in .env format
  const envContent = `# B3nd Wallet Server Keys
# Generated: ${new Date().toISOString()}

SERVER_IDENTITY_PRIVATE_KEY_PEM="${identityKeys.privateKeyPem.replace(/\n/g, "\\n")}"
SERVER_IDENTITY_PUBLIC_KEY_HEX="${identityKeys.publicKeyHex}"
SERVER_ENCRYPTION_PRIVATE_KEY_PEM="${encryptionKeys.privateKeyPem.replace(/\n/g, "\\n")}"
SERVER_ENCRYPTION_PUBLIC_KEY_HEX="${encryptionKeys.publicKeyHex}"
`;

  console.log(envContent);

  // Optionally write to file
  try {
    await Deno.writeTextFile(".env.keys", envContent);
    console.log("✅ Keys saved to .env.keys");
    console.log("\n⚠️  IMPORTANT: Next steps:");
    console.log("  1. Copy the key values from .env.keys to your .env file");
    console.log("  2. DELETE .env.keys immediately for security!");
    console.log("     rm .env.keys");
    console.log("\n  The .env.keys file contains sensitive private keys.");
    console.log("  It should NOT be committed to git or left on disk.");
  } catch (error) {
    console.log("\n⚠️  Could not write to .env.keys");
    console.log("   Please copy the values above manually to your .env file");
  }

  console.log("\n" + "=".repeat(60));
  console.log("✨ Key generation complete!\n");
}

// Run if this is the main module
if (import.meta.main) {
  main();
}

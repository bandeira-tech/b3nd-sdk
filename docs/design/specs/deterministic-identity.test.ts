/**
 * Deterministic Identity — Failing Spec
 *
 * Tests the proposed API for deriving Ed25519 signing and X25519 encryption
 * keypairs deterministically from credentials. These functions don't exist yet.
 *
 * Run: deno test docs/design/specs/deterministic-identity.test.ts
 * Expected: All tests fail (functions not implemented)
 */

import { assertEquals, assertNotEquals } from "@std/assert";

// Proposed API — these don't exist yet in b3nd-encrypt/mod.ts
import {
  deriveEncryptionKeyPairFromSeed,
  deriveSigningKeyPairFromSeed,
  hmac,
} from "../../../libs/b3nd-encrypt/mod.ts";

// Existing API — these already work
import {
  decrypt,
  deriveKeyFromSeed,
  encrypt,
  generateEncryptionKeyPair,
  sign,
  verify,
} from "../../../libs/b3nd-encrypt/mod.ts";

// --- Signing keypair derivation ---

Deno.test("deriveSigningKeyPairFromSeed: deterministic - same seed produces same keypair", async () => {
  const seed = "test-seed-for-deterministic-signing";

  const keypair1 = await deriveSigningKeyPairFromSeed(seed);
  const keypair2 = await deriveSigningKeyPairFromSeed(seed);

  assertEquals(keypair1.publicKeyHex, keypair2.publicKeyHex);
  assertEquals(keypair1.privateKeyHex, keypair2.privateKeyHex);
});

Deno.test("deriveSigningKeyPairFromSeed: different seeds produce different keypairs", async () => {
  const keypair1 = await deriveSigningKeyPairFromSeed("seed-alpha");
  const keypair2 = await deriveSigningKeyPairFromSeed("seed-beta");

  assertNotEquals(keypair1.publicKeyHex, keypair2.publicKeyHex);
  assertNotEquals(keypair1.privateKeyHex, keypair2.privateKeyHex);
});

Deno.test("deriveSigningKeyPairFromSeed: produces valid Ed25519 keys", async () => {
  const seed = "valid-ed25519-seed";
  const keypair = await deriveSigningKeyPairFromSeed(seed);

  // Should have hex-encoded keys
  assertEquals(typeof keypair.publicKeyHex, "string");
  assertEquals(typeof keypair.privateKeyHex, "string");
  assertEquals(keypair.publicKeyHex.length, 64); // 32 bytes = 64 hex chars

  // Should have CryptoKey objects
  assertEquals(keypair.publicKey instanceof CryptoKey, true);
  assertEquals(keypair.privateKey instanceof CryptoKey, true);
});

Deno.test("deriveSigningKeyPairFromSeed: sign and verify round-trip", async () => {
  const seed = "sign-verify-round-trip-seed";
  const keypair = await deriveSigningKeyPairFromSeed(seed);

  const payload = { message: "hello from deterministic identity", ts: 12345 };
  const signature = await sign(keypair.privateKey, payload);
  const valid = await verify(keypair.publicKeyHex, signature, payload);

  assertEquals(valid, true);
});

Deno.test("deriveSigningKeyPairFromSeed: signature from one seed fails verify with another", async () => {
  const keypair1 = await deriveSigningKeyPairFromSeed("seed-one");
  const keypair2 = await deriveSigningKeyPairFromSeed("seed-two");

  const payload = { data: "test" };
  const signature = await sign(keypair1.privateKey, payload);

  // Verify with wrong public key should fail
  const valid = await verify(keypair2.publicKeyHex, signature, payload);
  assertEquals(valid, false);
});

// --- Encryption keypair derivation ---

Deno.test("deriveEncryptionKeyPairFromSeed: deterministic - same seed produces same keypair", async () => {
  const seed = "test-seed-for-deterministic-encryption";

  const keypair1 = await deriveEncryptionKeyPairFromSeed(seed);
  const keypair2 = await deriveEncryptionKeyPairFromSeed(seed);

  assertEquals(keypair1.publicKeyHex, keypair2.publicKeyHex);
});

Deno.test("deriveEncryptionKeyPairFromSeed: different seeds produce different keypairs", async () => {
  const keypair1 = await deriveEncryptionKeyPairFromSeed("enc-seed-alpha");
  const keypair2 = await deriveEncryptionKeyPairFromSeed("enc-seed-beta");

  assertNotEquals(keypair1.publicKeyHex, keypair2.publicKeyHex);
});

Deno.test("deriveEncryptionKeyPairFromSeed: encrypt and decrypt round-trip", async () => {
  const seed = "encrypt-decrypt-round-trip-seed";
  const keypair = await deriveEncryptionKeyPairFromSeed(seed);

  const plaintext = { secret: "deterministic encryption works", count: 42 };
  const encoder = new TextEncoder();
  const encrypted = await encrypt(
    encoder.encode(JSON.stringify(plaintext)),
    keypair.publicKeyHex,
  );
  const decrypted = JSON.parse(
    new TextDecoder().decode(await decrypt(encrypted, keypair.privateKey)),
  );

  assertEquals(decrypted, plaintext);
});

// --- HMAC ---

Deno.test("hmac: deterministic - same inputs produce same output", async () => {
  const key = "hmac-secret-key";
  const data = "stable-user-identifier";

  const result1 = await hmac(key, data);
  const result2 = await hmac(key, data);

  assertEquals(result1, result2);
});

Deno.test("hmac: different keys produce different outputs", async () => {
  const data = "same-data";

  const result1 = await hmac("key-one", data);
  const result2 = await hmac("key-two", data);

  assertNotEquals(result1, result2);
});

Deno.test("hmac: different data produce different outputs", async () => {
  const key = "same-key";

  const result1 = await hmac(key, "data-one");
  const result2 = await hmac(key, "data-two");

  assertNotEquals(result1, result2);
});

Deno.test("hmac: returns hex-encoded string", async () => {
  const result = await hmac("key", "data");

  assertEquals(typeof result, "string");
  // HMAC-SHA256 = 32 bytes = 64 hex chars
  assertEquals(result.length, 64);
  // Valid hex
  assertEquals(/^[0-9a-f]+$/.test(result), true);
});

// --- Full password auth flow ---

Deno.test("full flow: password credentials → deterministic identity → sign → verify", async () => {
  const username = "alice";
  const password = "s3cret-passw0rd";
  const appSalt = "recipe-app-7f3a";

  // Step 1: Derive seed from password
  const salt = `${appSalt}-${username}`;
  const seed = await deriveKeyFromSeed(password, salt, 100000);

  // Step 2: Derive signing keypair from seed
  const signingKeypair = await deriveSigningKeyPairFromSeed(seed);

  // Step 3: Derive encryption keypair from seed
  const encryptionKeypair = await deriveEncryptionKeyPairFromSeed(seed);

  // Step 4: Sign a message
  const payload = { type: "recipe", title: "Pasta Carbonara" };
  const signature = await sign(signingKeypair.privateKey, payload);

  // Step 5: Anyone can verify with the public key
  const valid = await verify(signingKeypair.publicKeyHex, signature, payload);
  assertEquals(valid, true);

  // Step 6: Encrypt something to ourselves
  const secret = { ingredients: ["guanciale", "pecorino", "eggs"] };
  const encrypted = await encrypt(
    new TextEncoder().encode(JSON.stringify(secret)),
    encryptionKeypair.publicKeyHex,
  );
  const decrypted = JSON.parse(
    new TextDecoder().decode(
      await decrypt(encrypted, encryptionKeypair.privateKey),
    ),
  );
  assertEquals(decrypted, secret);

  // Step 7: Re-derive on "new device" — same identity
  const seed2 = await deriveKeyFromSeed(password, salt, 100000);
  const signingKeypair2 = await deriveSigningKeyPairFromSeed(seed2);
  const encryptionKeypair2 = await deriveEncryptionKeyPairFromSeed(seed2);

  assertEquals(signingKeypair.publicKeyHex, signingKeypair2.publicKeyHex);
  assertEquals(encryptionKeypair.publicKeyHex, encryptionKeypair2.publicKeyHex);

  // Step 8: New device can verify old signature
  const stillValid = await verify(
    signingKeypair2.publicKeyHex,
    signature,
    payload,
  );
  assertEquals(stillValid, true);
});

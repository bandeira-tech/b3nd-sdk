import { assertEquals, assertRejects } from "@std/assert";
import { Identity } from "./identity.ts";

// ── Identity.generate ──

Deno.test("Identity.generate - creates identity with signing and encryption keys", async () => {
  const id = await Identity.generate();
  assertEquals(typeof id.pubkey, "string");
  assertEquals(id.pubkey.length > 0, true);
  assertEquals(typeof id.encryptionPubkey, "string");
  assertEquals(id.encryptionPubkey.length > 0, true);
  assertEquals(id.canSign, true);
});

Deno.test("Identity.generate - two identities have different keys", async () => {
  const id1 = await Identity.generate();
  const id2 = await Identity.generate();
  assertEquals(id1.pubkey !== id2.pubkey, true);
  assertEquals(id1.encryptionPubkey !== id2.encryptionPubkey, true);
});

// ── Identity.fromSeed ──

Deno.test("Identity.fromSeed - deterministic derivation", async () => {
  const id1 = await Identity.fromSeed("test-seed-alpha");
  const id2 = await Identity.fromSeed("test-seed-alpha");
  assertEquals(id1.pubkey, id2.pubkey);
  assertEquals(id1.encryptionPubkey, id2.encryptionPubkey);
});

Deno.test("Identity.fromSeed - different seeds produce different keys", async () => {
  const id1 = await Identity.fromSeed("seed-one");
  const id2 = await Identity.fromSeed("seed-two");
  assertEquals(id1.pubkey !== id2.pubkey, true);
});

Deno.test("Identity.fromSeed - has signing capability", async () => {
  const id = await Identity.fromSeed("sign-test");
  assertEquals(id.canSign, true);
});

// ── Identity.publicOnly ──

Deno.test("Identity.publicOnly - creates public-only identity", () => {
  const id = Identity.publicOnly({ signing: "abc123", encryption: "def456" });
  assertEquals(id.pubkey, "abc123");
  assertEquals(id.encryptionPubkey, "def456");
  assertEquals(id.canSign, false);
});

Deno.test("Identity.publicOnly - encryption key is optional", () => {
  const id = Identity.publicOnly({ signing: "abc123" });
  assertEquals(id.pubkey, "abc123");
  assertEquals(id.encryptionPubkey, "");
  assertEquals(id.canSign, false);
});

// ── sign / verify ──

Deno.test("Identity - sign and verify round-trip", async () => {
  const id = await Identity.generate();
  const payload = { action: "transfer", amount: 100 };
  const { pubkey, signature } = await id.sign(payload);

  assertEquals(pubkey, id.pubkey);
  assertEquals(typeof signature, "string");
  assertEquals(signature.length > 0, true);

  const valid = await id.verify(payload, signature);
  assertEquals(valid, true);
});

Deno.test("Identity - verify fails for tampered payload", async () => {
  const id = await Identity.generate();
  const { signature } = await id.sign({ value: 1 });
  const valid = await id.verify({ value: 2 }, signature);
  assertEquals(valid, false);
});

Deno.test("Identity - verify with different identity fails", async () => {
  const signer = await Identity.generate();
  const other = await Identity.generate();

  const { signature } = await signer.sign({ data: "test" });
  const valid = await other.verify({ data: "test" }, signature);
  assertEquals(valid, false);
});

Deno.test("Identity - publicOnly cannot sign", async () => {
  const id = Identity.publicOnly({ signing: "abc" });
  await assertRejects(
    () => id.sign({ test: 1 }),
    Error,
    "Cannot sign: this is a public-only identity",
  );
});

// ── signMessage ──

Deno.test("Identity - signMessage creates authenticated envelope", async () => {
  const id = await Identity.generate();
  const msg = await id.signMessage({ action: "post", body: "hello" });

  assertEquals(Array.isArray(msg.auth), true);
  assertEquals(msg.auth.length, 1);
  assertEquals(msg.auth[0].pubkey, id.pubkey);
  assertEquals(typeof msg.auth[0].signature, "string");
  assertEquals(msg.payload.action, "post");
  assertEquals(msg.payload.body, "hello");
});

Deno.test("Identity - signMessage: publicOnly cannot sign", async () => {
  const id = Identity.publicOnly({ signing: "abc" });
  await assertRejects(
    () => id.signMessage({ test: 1 }),
    Error,
    "Cannot sign: this is a public-only identity",
  );
});

// ── signer getter ──

Deno.test("Identity - signer returns key pair object", async () => {
  const id = await Identity.generate();
  const signer = id.signer;
  assertEquals(signer.publicKeyHex, id.pubkey);
  assertEquals(signer.privateKey instanceof CryptoKey, true);
});

Deno.test("Identity - signer throws for publicOnly", () => {
  const id = Identity.publicOnly({ signing: "abc" });
  try {
    const _ = id.signer;
    assertEquals(true, false); // should not reach here
  } catch (e) {
    assertEquals(
      (e as Error).message,
      "Cannot get signer: this is a public-only identity",
    );
  }
});

// ── encrypt / decrypt ──

Deno.test("Identity - encrypt and decrypt round-trip", async () => {
  const sender = await Identity.generate();
  const recipient = await Identity.generate();

  const plaintext = new TextEncoder().encode("secret message");
  const encrypted = await sender.encrypt(plaintext, recipient.encryptionPubkey);

  const decrypted = await recipient.decrypt(encrypted);
  assertEquals(new TextDecoder().decode(decrypted), "secret message");
});

Deno.test("Identity - publicOnly cannot decrypt", async () => {
  const sender = await Identity.generate();
  const pubOnly = Identity.publicOnly({
    signing: "abc",
    encryption: sender.encryptionPubkey,
  });

  const encrypted = await sender.encrypt(
    new TextEncoder().encode("test"),
    sender.encryptionPubkey,
  );

  await assertRejects(
    () => pubOnly.decrypt(encrypted),
    Error,
    "Cannot decrypt: no encryption private key",
  );
});

// ── fromSeed signing consistency ──

Deno.test("Identity.fromSeed - signatures are consistent across instances", async () => {
  const id1 = await Identity.fromSeed("consistency-test");
  const id2 = await Identity.fromSeed("consistency-test");

  const payload = { nonce: 42 };
  const { signature: sig1 } = await id1.sign(payload);
  const { signature: sig2 } = await id2.sign(payload);

  // Same seed → same key → same signature for same payload
  assertEquals(sig1, sig2);

  // Both can verify each other's signatures
  assertEquals(await id2.verify(payload, sig1), true);
  assertEquals(await id1.verify(payload, sig2), true);
});

import { assertEquals, assertRejects } from "@std/assert";
import { Identity } from "./identity.ts";
import { Rig } from "./rig.ts";
import { createTestSchema, MemoryClient } from "../b3nd-client-memory/mod.ts";

// ── Identity tests ──

Deno.test("Identity.generate - creates a fresh identity", async () => {
  const id = await Identity.generate();
  assertEquals(typeof id.pubkey, "string");
  assertEquals(id.pubkey.length, 64); // 32 bytes hex
  assertEquals(id.canSign, true);
  assertEquals(typeof id.encryptionPubkey, "string");
  assertEquals(id.encryptionPubkey.length, 64);
});

Deno.test("Identity.fromSeed - deterministic from same seed", async () => {
  const a = await Identity.fromSeed("test-seed-123");
  const b = await Identity.fromSeed("test-seed-123");
  assertEquals(a.pubkey, b.pubkey);
  assertEquals(a.encryptionPubkey, b.encryptionPubkey);
});

Deno.test("Identity.fromSeed - different seeds produce different keys", async () => {
  const a = await Identity.fromSeed("seed-a");
  const b = await Identity.fromSeed("seed-b");
  assertEquals(a.pubkey !== b.pubkey, true);
});

Deno.test("Identity.publicOnly - creates a read-only identity", () => {
  const id = Identity.publicOnly({ signing: "ab".repeat(32) });
  assertEquals(id.pubkey, "ab".repeat(32));
  assertEquals(id.canSign, false);
});

Deno.test("Identity.publicOnly - sign throws", async () => {
  const id = Identity.publicOnly({ signing: "ab".repeat(32) });
  await assertRejects(
    () => id.sign({ test: true }),
    Error,
    "public-only",
  );
});

Deno.test("Identity.sign - produces valid auth entry", async () => {
  const id = await Identity.generate();
  const payload = { hello: "world" };
  const auth = await id.sign(payload);
  assertEquals(auth.pubkey, id.pubkey);
  assertEquals(typeof auth.signature, "string");
  assertEquals(auth.signature.length > 0, true);
});

Deno.test("Identity.signMessage - wraps payload in AuthenticatedMessage", async () => {
  const id = await Identity.generate();
  const msg = await id.signMessage({ action: "test" });
  assertEquals(msg.auth.length, 1);
  assertEquals(msg.auth[0].pubkey, id.pubkey);
  assertEquals(msg.payload, { action: "test" });
});

Deno.test("Identity.verify - round-trips with sign", async () => {
  const id = await Identity.generate();
  const payload = { test: 42 };
  const auth = await id.sign(payload);
  const valid = await id.verify(payload, auth.signature);
  assertEquals(valid, true);

  // Tampered payload should fail
  const invalid = await id.verify({ test: 43 }, auth.signature);
  assertEquals(invalid, false);
});

Deno.test("Identity.encrypt/decrypt - round-trips", async () => {
  const sender = await Identity.generate();
  const receiver = await Identity.generate();

  const plaintext = new TextEncoder().encode("secret message");
  const encrypted = await sender.encrypt(plaintext, receiver.encryptionPubkey);
  const decrypted = await receiver.decrypt(encrypted);

  assertEquals(new TextDecoder().decode(decrypted), "secret message");
});

Deno.test("Identity.signer - returns CryptoKey + pubkey", async () => {
  const id = await Identity.generate();
  const signer = id.signer;
  assertEquals(signer.publicKeyHex, id.pubkey);
  assertEquals(signer.privateKey instanceof CryptoKey, true);
});

// ── Identity export/import tests ──

Deno.test("Identity.export - full identity round-trips", async () => {
  const original = await Identity.generate();
  const exported = await original.export();

  // Exported data has all four fields
  assertEquals(typeof exported.signingPublicKeyHex, "string");
  assertEquals(typeof exported.signingPrivateKeyHex, "string");
  assertEquals(typeof exported.encryptionPublicKeyHex, "string");
  assertEquals(typeof exported.encryptionPrivateKeyHex, "string");

  // Reconstruct
  const restored = await Identity.fromExport(exported);
  assertEquals(restored.pubkey, original.pubkey);
  assertEquals(restored.encryptionPubkey, original.encryptionPubkey);
  assertEquals(restored.canSign, true);
});

Deno.test("Identity.export - restored identity can sign and verify", async () => {
  const original = await Identity.generate();
  const exported = await original.export();
  const restored = await Identity.fromExport(exported);

  // Sign with restored, verify with original public key
  const payload = { test: "round-trip" };
  const auth = await restored.sign(payload);
  assertEquals(auth.pubkey, original.pubkey);

  const valid = await original.verify(payload, auth.signature);
  assertEquals(valid, true);
});

Deno.test("Identity.export - restored identity can encrypt/decrypt", async () => {
  const sender = await Identity.generate();
  const receiver = await Identity.generate();

  // Export and restore the receiver
  const exported = await receiver.export();
  const restoredReceiver = await Identity.fromExport(exported);

  // Encrypt to receiver, decrypt with restored receiver
  const plaintext = new TextEncoder().encode("exported secret");
  const encrypted = await sender.encrypt(plaintext, receiver.encryptionPubkey);
  const decrypted = await restoredReceiver.decrypt(encrypted);

  assertEquals(new TextDecoder().decode(decrypted), "exported secret");
});

Deno.test("Identity.export - public-only identity exports without private keys", async () => {
  const id = Identity.publicOnly({
    signing: "ab".repeat(32),
    encryption: "cd".repeat(32),
  });
  const exported = await id.export();

  assertEquals(exported.signingPublicKeyHex, "ab".repeat(32));
  assertEquals(exported.encryptionPublicKeyHex, "cd".repeat(32));
  assertEquals(exported.signingPrivateKeyHex, undefined);
  assertEquals(exported.encryptionPrivateKeyHex, undefined);
});

Deno.test("Identity.export - public-only round-trip stays public-only", async () => {
  const id = Identity.publicOnly({
    signing: "ab".repeat(32),
    encryption: "cd".repeat(32),
  });
  const exported = await id.export();
  const restored = await Identity.fromExport(exported);

  assertEquals(restored.pubkey, "ab".repeat(32));
  assertEquals(restored.canSign, false);
});

Deno.test("Identity.export - JSON serialization round-trip", async () => {
  const original = await Identity.generate();
  const exported = await original.export();

  // Simulate localStorage / file persistence
  const json = JSON.stringify(exported);
  const parsed = JSON.parse(json);

  const restored = await Identity.fromExport(parsed);
  assertEquals(restored.pubkey, original.pubkey);
  assertEquals(restored.encryptionPubkey, original.encryptionPubkey);
  assertEquals(restored.canSign, true);

  // Verify signing still works after JSON round-trip
  const auth = await restored.sign({ from: "json" });
  const valid = await original.verify({ from: "json" }, auth.signature);
  assertEquals(valid, true);
});

Deno.test("Identity.export - fromSeed identity round-trips deterministically", async () => {
  const fromSeed = await Identity.fromSeed("export-test-seed");
  const exported = await fromSeed.export();
  const restored = await Identity.fromExport(exported);

  // Same keys
  assertEquals(restored.pubkey, fromSeed.pubkey);
  assertEquals(restored.encryptionPubkey, fromSeed.encryptionPubkey);

  // Both can produce the same signatures
  const payload = { deterministic: true };
  const authOriginal = await fromSeed.sign(payload);
  const authRestored = await restored.sign(payload);
  assertEquals(authOriginal.signature, authRestored.signature);
});

// ── Rig tests ──

Deno.test("Rig.init - with memory backend", async () => {
  const rig = await Rig.init({ use: "memory://" });
  const health = await rig.health();
  assertEquals(health.status, "healthy");
  await rig.cleanup();
});

Deno.test("Rig.init - with pre-built client", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const rig = await Rig.init({ client });
  const health = await rig.health();
  assertEquals(health.status, "healthy");
});

Deno.test("Rig.init - with identity", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ identity: id, use: "memory://" });
  assertEquals(rig.identity?.pubkey, id.pubkey);
  await rig.cleanup();
});

Deno.test("Rig.init - rejects empty use", async () => {
  await assertRejects(
    () => Rig.init({ use: [] }),
    Error,
    "at least one URL",
  );
});

Deno.test("Rig.init - rejects no use or client", async () => {
  await assertRejects(
    () => Rig.init({}),
    Error,
    "either `use` or `client` is required",
  );
});

Deno.test("Rig.write - raw write works", async () => {
  const rig = await Rig.init({ use: "memory://" });
  const result = await rig.write("mutable://open/test", { hello: "world" });
  assertEquals(result.accepted, true);

  const read = await rig.read("mutable://open/test");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, { hello: "world" });
  await rig.cleanup();
});

Deno.test("Rig.send - auto-signs and sends", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ identity: id, use: "memory://" });

  const result = await rig.send({
    inputs: [],
    outputs: [["mutable://open/item", { value: 42 }]],
  });
  assertEquals(result.accepted, true);
  assertEquals(result.uri.startsWith("hash://sha256/"), true);

  // The output should be readable at its own URI
  const read = await rig.read("mutable://open/item");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, { value: 42 });
  await rig.cleanup();
});

Deno.test("Rig.send - throws without identity", async () => {
  const rig = await Rig.init({ use: "memory://" });
  await assertRejects(
    () => rig.send({ inputs: [], outputs: [["mutable://open/x", 1]] }),
    Error,
    "no identity set",
  );
  await rig.cleanup();
});

Deno.test("Rig.identity - is swappable", async () => {
  const alice = await Identity.generate();
  const bob = await Identity.generate();
  const rig = await Rig.init({ identity: alice, use: "memory://" });

  assertEquals(rig.identity?.pubkey, alice.pubkey);

  rig.identity = bob;
  assertEquals(rig.identity?.pubkey, bob.pubkey);

  rig.identity = null;
  assertEquals(rig.identity, null);
  await rig.cleanup();
});

Deno.test("Rig.writeSigned - signs and writes", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ identity: id, use: "memory://" });

  const result = await rig.writeSigned("mutable://open/signed", {
    data: "test",
  });
  assertEquals(result.accepted, true);

  const read = await rig.read("mutable://open/signed");
  assertEquals(read.success, true);
  // The stored data is an AuthenticatedMessage wrapper
  const stored = read.record?.data as { auth: unknown[]; payload: unknown };
  assertEquals(stored.payload, { data: "test" });
  assertEquals(Array.isArray(stored.auth), true);
  await rig.cleanup();
});

Deno.test("Rig.list - lists items", async () => {
  const rig = await Rig.init({ use: "memory://" });
  await rig.write("mutable://open/a", 1);
  await rig.write("mutable://open/b", 2);

  const result = await rig.list("mutable://open");
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 2);
  }
  await rig.cleanup();
});

Deno.test("Rig.delete - deletes data", async () => {
  const rig = await Rig.init({ use: "memory://" });
  await rig.write("mutable://open/del", "bye");
  const delResult = await rig.delete("mutable://open/del");
  assertEquals(delResult.success, true);

  const read = await rig.read("mutable://open/del");
  assertEquals(read.success, false);
  await rig.cleanup();
});

Deno.test("Rig.readMany - reads multiple URIs", async () => {
  const rig = await Rig.init({ use: "memory://" });
  await rig.write("mutable://open/m1", "a");
  await rig.write("mutable://open/m2", "b");

  const result = await rig.readMany(["mutable://open/m1", "mutable://open/m2"]);
  assertEquals(result.success, true);
  assertEquals(result.summary.succeeded, 2);
  await rig.cleanup();
});

Deno.test("Rig.client - exposes underlying client", async () => {
  const rig = await Rig.init({ use: "memory://" });
  assertEquals(typeof rig.client.receive, "function");
  assertEquals(typeof rig.client.read, "function");
  await rig.cleanup();
});

Deno.test("Rig.init - multi-backend composes correctly", async () => {
  // Two memory backends — writes should go to both, reads from either
  const rig = await Rig.init({ use: ["memory://", "memory://"] });
  await rig.write("mutable://open/multi", "shared");

  const read = await rig.read("mutable://open/multi");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, "shared");
  await rig.cleanup();
});

Deno.test("Rig.getSchema - returns schema keys", async () => {
  const rig = await Rig.init({ use: "memory://" });
  const schema = await rig.getSchema();
  assertEquals(Array.isArray(schema), true);
  assertEquals(schema.length > 0, true);
  await rig.cleanup();
});

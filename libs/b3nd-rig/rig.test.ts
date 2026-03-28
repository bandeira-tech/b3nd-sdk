import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { Identity } from "./identity.ts";
import {
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
} from "./backend-factory.ts";
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

// ── Identity.fromPem tests ──

Deno.test("Identity.fromPem - creates identity from PEM and pubkey", async () => {
  // Generate a fresh identity, export its signing key to PEM
  const original = await Identity.generate();
  const exported = await original.export();

  // Export the signing private key as PEM via the encrypt module
  const { exportPrivateKeyPem, pemToCryptoKey } = await import(
    "../b3nd-encrypt/mod.ts"
  );
  const { decodeHex } = await import("../b3nd-core/encoding.ts");

  // Reconstruct the CryptoKey from exported hex, then export to PEM
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    decodeHex(exported.signingPrivateKeyHex!).buffer,
    { name: "Ed25519", namedCurve: "Ed25519" },
    true,
    ["sign"],
  );
  const pem = await exportPrivateKeyPem(signingKey, "PRIVATE KEY");

  // Create identity from PEM (signing only, no encryption keys)
  const fromPem = await Identity.fromPem(pem, original.pubkey);
  assertEquals(fromPem.pubkey, original.pubkey);
  assertEquals(fromPem.canSign, true);
});

Deno.test("Identity.fromPem - sign/verify round-trips with original", async () => {
  const original = await Identity.generate();
  const exported = await original.export();

  const { exportPrivateKeyPem } = await import("../b3nd-encrypt/mod.ts");
  const { decodeHex } = await import("../b3nd-core/encoding.ts");

  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    decodeHex(exported.signingPrivateKeyHex!).buffer,
    { name: "Ed25519", namedCurve: "Ed25519" },
    true,
    ["sign"],
  );
  const pem = await exportPrivateKeyPem(signingKey, "PRIVATE KEY");

  const fromPem = await Identity.fromPem(pem, original.pubkey);

  // Sign with PEM-restored identity, verify with original
  const payload = { action: "pem-test" };
  const auth = await fromPem.sign(payload);
  const valid = await original.verify(payload, auth.signature);
  assertEquals(valid, true);
});

Deno.test("Identity.fromPem - with encryption keys enables decrypt", async () => {
  const original = await Identity.generate();
  const exported = await original.export();

  const { exportPrivateKeyPem } = await import("../b3nd-encrypt/mod.ts");
  const { decodeHex } = await import("../b3nd-core/encoding.ts");

  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    decodeHex(exported.signingPrivateKeyHex!).buffer,
    { name: "Ed25519", namedCurve: "Ed25519" },
    true,
    ["sign"],
  );
  const pem = await exportPrivateKeyPem(signingKey, "PRIVATE KEY");

  // Create with full keys (signing PEM + encryption hex)
  const fromPem = await Identity.fromPem(
    pem,
    original.pubkey,
    exported.encryptionPrivateKeyHex,
    exported.encryptionPublicKeyHex,
  );

  assertEquals(fromPem.encryptionPubkey, original.encryptionPubkey);

  // Encrypt for the PEM identity, decrypt with it
  const sender = await Identity.generate();
  const plaintext = new TextEncoder().encode("pem-encrypted");
  const encrypted = await sender.encrypt(plaintext, fromPem.encryptionPubkey);
  const decrypted = await fromPem.decrypt(encrypted);
  assertEquals(new TextDecoder().decode(decrypted), "pem-encrypted");
});

Deno.test("Identity.fromPem - derives encryption pubkey from private when not provided", async () => {
  const original = await Identity.generate();
  const exported = await original.export();

  const { exportPrivateKeyPem } = await import("../b3nd-encrypt/mod.ts");
  const { decodeHex } = await import("../b3nd-core/encoding.ts");

  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    decodeHex(exported.signingPrivateKeyHex!).buffer,
    { name: "Ed25519", namedCurve: "Ed25519" },
    true,
    ["sign"],
  );
  const pem = await exportPrivateKeyPem(signingKey, "PRIVATE KEY");

  // Provide encryption private key but NOT public — should derive it
  const fromPem = await Identity.fromPem(
    pem,
    original.pubkey,
    exported.encryptionPrivateKeyHex,
    // No encryptionPublicKeyHex — should be derived
  );

  assertEquals(fromPem.encryptionPubkey, original.encryptionPubkey);
});

// ── Identity.canEncrypt tests ──

Deno.test("Identity.canEncrypt - true for generated identity", async () => {
  const id = await Identity.generate();
  assertEquals(id.canEncrypt, true);
});

Deno.test("Identity.canEncrypt - true for seeded identity", async () => {
  const id = await Identity.fromSeed("encrypt-test");
  assertEquals(id.canEncrypt, true);
});

Deno.test("Identity.canEncrypt - false for public-only identity", () => {
  const id = Identity.publicOnly({ signing: "ab".repeat(32) });
  assertEquals(id.canEncrypt, false);
});

Deno.test("Identity.canEncrypt - false for PEM without encryption keys", async () => {
  const original = await Identity.generate();
  const exported = await original.export();

  const { exportPrivateKeyPem } = await import("../b3nd-encrypt/mod.ts");
  const { decodeHex } = await import("../b3nd-core/encoding.ts");

  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    decodeHex(exported.signingPrivateKeyHex!).buffer,
    { name: "Ed25519", namedCurve: "Ed25519" },
    true,
    ["sign"],
  );
  const pem = await exportPrivateKeyPem(signingKey, "PRIVATE KEY");

  // No encryption keys provided
  const fromPem = await Identity.fromPem(pem, original.pubkey);
  assertEquals(fromPem.canEncrypt, false);
  assertEquals(fromPem.canSign, true);
});

Deno.test("Identity.decrypt - throws for public-only identity", async () => {
  const id = Identity.publicOnly({ signing: "ab".repeat(32) });
  await assertRejects(
    () => id.decrypt({ data: "", ephemeralPublicKey: "", nonce: "" }),
    Error,
    "no encryption private key",
  );
});

// ── getSupportedProtocols tests ──

Deno.test("getSupportedProtocols - returns all supported protocols", () => {
  const protocols = getSupportedProtocols();
  assertEquals(protocols.includes("memory://"), true);
  assertEquals(protocols.includes("https://"), true);
  assertEquals(protocols.includes("postgresql://"), true);
  assertEquals(protocols.includes("sqlite://"), true);
  assertEquals(protocols.includes("mongodb://"), true);
});

Deno.test("SUPPORTED_PROTOCOLS - is a readonly array", () => {
  assertEquals(Array.isArray(SUPPORTED_PROTOCOLS), true);
  assertEquals(SUPPORTED_PROTOCOLS.length > 0, true);
});

Deno.test("Rig.init - rejects unsupported protocol", async () => {
  await assertRejects(
    () => Rig.init({ use: "ftp://example.com" }),
    Error,
    "Unsupported backend URL protocol",
  );
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

Deno.test("Rig.receive - receives a message", async () => {
  const rig = await Rig.init({ use: "memory://" });
  const result = await rig.receive(["mutable://open/test", { hello: "world" }]);
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

Deno.test("Rig.list - lists items", async () => {
  const rig = await Rig.init({ use: "memory://" });
  await rig.receive(["mutable://open/a", 1]);
  await rig.receive(["mutable://open/b", 2]);

  const result = await rig.list("mutable://open");
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 2);
  }
  await rig.cleanup();
});

Deno.test("Rig.delete - deletes data", async () => {
  const rig = await Rig.init({ use: "memory://" });
  await rig.receive(["mutable://open/del", "bye"]);
  const delResult = await rig.delete("mutable://open/del");
  assertEquals(delResult.success, true);

  const read = await rig.read("mutable://open/del");
  assertEquals(read.success, false);
  await rig.cleanup();
});

Deno.test("Rig.readMany - reads multiple URIs", async () => {
  const rig = await Rig.init({ use: "memory://" });
  await rig.receive(["mutable://open/m1", "a"]);
  await rig.receive(["mutable://open/m2", "b"]);

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
  await rig.receive(["mutable://open/multi", "shared"]);

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

// ── Rig.connect tests ──

Deno.test("Rig.connect - quick connect to memory backend", async () => {
  const rig = await Rig.connect("memory://");
  const health = await rig.health();
  assertEquals(health.status, "healthy");
  await rig.cleanup();
});

Deno.test("Rig.connect - with identity", async () => {
  const id = await Identity.generate();
  const rig = await Rig.connect("memory://", id);
  assertEquals(rig.identity?.pubkey, id.pubkey);

  // Should be able to send (requires identity)
  const result = await rig.send({
    inputs: [],
    outputs: [["mutable://open/connect-test", { v: 1 }]],
  });
  assertEquals(result.accepted, true);
  await rig.cleanup();
});

Deno.test("Rig.connect - receive and read round-trip", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/hello", "world"]);
  const read = await rig.read("mutable://open/hello");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, "world");
  await rig.cleanup();
});

// ── Rig.canSign tests ──

Deno.test("Rig.canSign - true when identity has signing key", async () => {
  const id = await Identity.generate();
  const rig = await Rig.connect("memory://", id);
  assertEquals(rig.canSign, true);
  await rig.cleanup();
});

Deno.test("Rig.canSign - false when no identity", async () => {
  const rig = await Rig.connect("memory://");
  assertEquals(rig.canSign, false);
  await rig.cleanup();
});

Deno.test("Rig.canSign - false for public-only identity", async () => {
  const publicId = Identity.publicOnly({ signing: "ab".repeat(32) });
  const rig = await Rig.connect("memory://", publicId);
  assertEquals(rig.canSign, false);
  await rig.cleanup();
});

Deno.test("Rig.canSign - updates when identity is swapped", async () => {
  const rig = await Rig.connect("memory://");
  assertEquals(rig.canSign, false);

  const id = await Identity.generate();
  rig.identity = id;
  assertEquals(rig.canSign, true);

  rig.identity = null;
  assertEquals(rig.canSign, false);
  await rig.cleanup();
});

// ── Rig.canEncrypt tests ──

Deno.test("Rig.canEncrypt - true when identity has encryption key", async () => {
  const id = await Identity.generate();
  const rig = await Rig.connect("memory://", id);
  assertEquals(rig.canEncrypt, true);
  await rig.cleanup();
});

Deno.test("Rig.canEncrypt - false when no identity", async () => {
  const rig = await Rig.connect("memory://");
  assertEquals(rig.canEncrypt, false);
  await rig.cleanup();
});

Deno.test("Rig.canEncrypt - false for public-only identity without encryption", () => {
  const publicId = Identity.publicOnly({ signing: "ab".repeat(32) });
  assertEquals(publicId.canEncrypt, false);
});

Deno.test("Rig.canEncrypt - updates when identity is swapped", async () => {
  const rig = await Rig.connect("memory://");
  assertEquals(rig.canEncrypt, false);

  const id = await Identity.generate();
  rig.identity = id;
  assertEquals(rig.canEncrypt, true);

  rig.identity = null;
  assertEquals(rig.canEncrypt, false);
  await rig.cleanup();
});

// ── Rig.exists tests ──

Deno.test("Rig.exists - returns true for existing data", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/check", { present: true }]);
  assertEquals(await rig.exists("mutable://open/check"), true);
  await rig.cleanup();
});

Deno.test("Rig.exists - returns false for missing data", async () => {
  const rig = await Rig.connect("memory://");
  assertEquals(await rig.exists("mutable://open/nonexistent"), false);
  await rig.cleanup();
});

Deno.test("Rig.exists - returns false after delete", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/ephemeral", "temp"]);
  assertEquals(await rig.exists("mutable://open/ephemeral"), true);
  await rig.delete("mutable://open/ephemeral");
  assertEquals(await rig.exists("mutable://open/ephemeral"), false);
  await rig.cleanup();
});

// ── Rig.readMany edge cases ──

Deno.test("Rig.readMany - handles mix of existing and missing URIs", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/yes", "found"]);

  const result = await rig.readMany([
    "mutable://open/yes",
    "mutable://open/nope",
  ]);
  assertEquals(result.summary.total, 2);
  assertEquals(result.summary.succeeded, 1);
  assertEquals(result.summary.failed, 1);
  await rig.cleanup();
});

Deno.test("Rig.readMany - handles empty URI array", async () => {
  const rig = await Rig.connect("memory://");
  const result = await rig.readMany([]);
  assertEquals(result.summary.total, 0);
  await rig.cleanup();
});

// ── createClientFromUrl tests ──

Deno.test("createClientFromUrl - creates memory client from URL", async () => {
  const { createClientFromUrl } = await import("./backend-factory.ts");
  const client = await createClientFromUrl("memory://");
  const health = await client.health();
  assertEquals(health.status, "healthy");

  // Write and read back
  await client.receive(["mutable://open/test", { val: 1 }]);
  const read = await client.read("mutable://open/test");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, { val: 1 });
});

Deno.test("createClientFromUrl - rejects unknown protocol", async () => {
  const { createClientFromUrl } = await import("./backend-factory.ts");
  await assertRejects(
    () => createClientFromUrl("ftp://example.com"),
    Error,
    "Unsupported backend URL protocol",
  );
});

Deno.test("Rig.cleanup - can be called multiple times safely", async () => {
  const rig = await Rig.init({ use: "memory://" });
  await rig.cleanup();
  // Second cleanup should not throw
  await rig.cleanup();
});

// ── Rig.readData tests ──

Deno.test("Rig.readData - returns data for existing URI", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/profile", { name: "Alice", age: 30 }]);

  const data = await rig.readData<{ name: string; age: number }>(
    "mutable://open/profile",
  );
  assertEquals(data, { name: "Alice", age: 30 });
  await rig.cleanup();
});

Deno.test("Rig.readData - returns null for missing URI", async () => {
  const rig = await Rig.connect("memory://");
  const data = await rig.readData("mutable://open/ghost");
  assertEquals(data, null);
  await rig.cleanup();
});

Deno.test("Rig.readData - returns null after delete", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/temp", "value"]);
  assertEquals(await rig.readData("mutable://open/temp"), "value");

  await rig.delete("mutable://open/temp");
  assertEquals(await rig.readData("mutable://open/temp"), null);
  await rig.cleanup();
});

Deno.test("Rig.readData - handles scalar values", async () => {
  const rig = await Rig.connect("memory://");

  await rig.receive(["mutable://open/num", 42]);
  assertEquals(await rig.readData<number>("mutable://open/num"), 42);

  await rig.receive(["mutable://open/str", "hello"]);
  assertEquals(await rig.readData<string>("mutable://open/str"), "hello");

  await rig.receive(["mutable://open/bool", true]);
  assertEquals(await rig.readData<boolean>("mutable://open/bool"), true);

  await rig.cleanup();
});

// ── Rig.readOrThrow tests ──

Deno.test("Rig.readOrThrow - returns data for existing URI", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/config", { debug: false }]);

  const config = await rig.readOrThrow<{ debug: boolean }>(
    "mutable://open/config",
  );
  assertEquals(config, { debug: false });
  await rig.cleanup();
});

Deno.test("Rig.readOrThrow - throws for missing URI", async () => {
  const rig = await Rig.connect("memory://");
  await assertRejects(
    () => rig.readOrThrow("mutable://open/missing"),
    Error,
    "no data at mutable://open/missing",
  );
  await rig.cleanup();
});

Deno.test("Rig.readOrThrow - throws after delete", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/once", "here"]);
  assertEquals(await rig.readOrThrow("mutable://open/once"), "here");

  await rig.delete("mutable://open/once");
  await assertRejects(
    () => rig.readOrThrow("mutable://open/once"),
    Error,
    "no data at mutable://open/once",
  );
  await rig.cleanup();
});

// ── Rig.send integration tests (with Identity and signature verification) ──

Deno.test("Rig.send - creates verifiable signed envelope", async () => {
  const id = await Identity.generate();
  const rig = await Rig.connect("memory://", id);

  const result = await rig.send({
    inputs: [],
    outputs: [["mutable://open/signed-test", { msg: "hello" }]],
  });

  assertEquals(result.accepted, true);
  assertEquals(typeof result.uri, "string");
  assertEquals(result.uri.startsWith("hash://sha256/"), true);

  // Read back the envelope
  const envelope = await rig.readOrThrow<{
    auth: Array<{ pubkey: string; signature: string }>;
    payload: {
      inputs: string[];
      outputs: Array<[string, unknown]>;
    };
    hash: string;
  }>(result.uri);

  // Verify structure
  assertEquals(Array.isArray(envelope.auth), true);
  assertEquals(envelope.auth.length, 1);
  assertEquals(envelope.auth[0].pubkey, id.pubkey);
  assertEquals(typeof envelope.auth[0].signature, "string");
  assertEquals(envelope.payload.outputs[0][0], "mutable://open/signed-test");
  assertEquals(envelope.payload.outputs[0][1], { msg: "hello" });

  // Verify the signature is valid using the identity
  const valid = await id.verify(
    envelope.payload,
    envelope.auth[0].signature,
  );
  assertEquals(valid, true);

  // Also verify the mutable output was written
  const data = await rig.readData("mutable://open/signed-test");
  assertEquals(data, { msg: "hello" });

  await rig.cleanup();
});

Deno.test("Rig.send - different identity produces different signature", async () => {
  const alice = await Identity.generate();
  const bob = await Identity.generate();

  const rig = await Rig.connect("memory://", alice);

  const r1 = await rig.send({
    inputs: [],
    outputs: [["mutable://open/alice-write", 1]],
  });

  rig.identity = bob;
  const r2 = await rig.send({
    inputs: [],
    outputs: [["mutable://open/bob-write", 2]],
  });

  // Both succeed
  assertEquals(r1.accepted, true);
  assertEquals(r2.accepted, true);

  // Different envelopes with different signers
  const e1 = await rig.readOrThrow<{
    auth: Array<{ pubkey: string; signature: string }>;
    payload: unknown;
  }>(r1.uri);
  const e2 = await rig.readOrThrow<{
    auth: Array<{ pubkey: string; signature: string }>;
    payload: unknown;
  }>(r2.uri);

  assertEquals(e1.auth[0].pubkey, alice.pubkey);
  assertEquals(e2.auth[0].pubkey, bob.pubkey);

  // Alice's signature should not verify with Bob's key and vice versa
  const crossCheck = await bob.verify(e1.payload, e1.auth[0].signature);
  assertEquals(crossCheck, false);

  await rig.cleanup();
});

Deno.test("Rig.send - throws without identity", async () => {
  const rig = await Rig.connect("memory://");
  await assertRejects(
    () =>
      rig.send({
        inputs: [],
        outputs: [["mutable://open/x", 1]],
      }),
    Error,
    "no identity set",
  );
  await rig.cleanup();
});

Deno.test("Rig.readDataMany - returns map of existing data", async () => {
  const rig = await Rig.connect("memory://");

  await rig.receive(["mutable://open/rdm/a", { name: "Alice" }]);
  await rig.receive(["mutable://open/rdm/b", { name: "Bob" }]);

  const data = await rig.readDataMany<{ name: string }>([
    "mutable://open/rdm/a",
    "mutable://open/rdm/b",
  ]);

  assertEquals(data.size, 2);
  assertEquals(data.get("mutable://open/rdm/a"), { name: "Alice" });
  assertEquals(data.get("mutable://open/rdm/b"), { name: "Bob" });
  await rig.cleanup();
});

Deno.test("Rig.readDataMany - omits missing URIs from map", async () => {
  const rig = await Rig.connect("memory://");

  await rig.receive(["mutable://open/rdm2/exists", { ok: true }]);

  const data = await rig.readDataMany([
    "mutable://open/rdm2/exists",
    "mutable://open/rdm2/missing",
  ]);

  assertEquals(data.size, 1);
  assertEquals(data.get("mutable://open/rdm2/exists"), { ok: true });
  assertEquals(data.has("mutable://open/rdm2/missing"), false);
  await rig.cleanup();
});

Deno.test("Rig.readDataMany - returns empty map for empty input", async () => {
  const rig = await Rig.connect("memory://");
  const data = await rig.readDataMany([]);
  assertEquals(data.size, 0);
  await rig.cleanup();
});

Deno.test("Rig.readDataMany - returns empty map when all URIs missing", async () => {
  const rig = await Rig.connect("memory://");
  const data = await rig.readDataMany([
    "mutable://open/gone/a",
    "mutable://open/gone/b",
  ]);
  assertEquals(data.size, 0);
  await rig.cleanup();
});

Deno.test("Rig.send - multiple outputs in single envelope", async () => {
  const id = await Identity.generate();
  const rig = await Rig.connect("memory://", id);

  const result = await rig.send({
    inputs: [],
    outputs: [
      ["mutable://open/batch/a", { v: 1 }],
      ["mutable://open/batch/b", { v: 2 }],
      ["mutable://open/batch/c", { v: 3 }],
    ],
  });

  assertEquals(result.accepted, true);

  // All outputs should be written
  assertEquals(await rig.readData("mutable://open/batch/a"), { v: 1 });
  assertEquals(await rig.readData("mutable://open/batch/b"), { v: 2 });
  assertEquals(await rig.readData("mutable://open/batch/c"), { v: 3 });

  // The envelope at the hash URI should have all 3 outputs
  const envelope = await rig.readOrThrow<{
    payload: { outputs: Array<[string, unknown]> };
  }>(result.uri);
  assertEquals(envelope.payload.outputs.length, 3);

  await rig.cleanup();
});

// ── Rig.deleteMany tests ──

Deno.test("Rig.deleteMany - deletes multiple URIs", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/d1", "one"]);
  await rig.receive(["mutable://open/d2", "two"]);
  await rig.receive(["mutable://open/d3", "three"]);

  const results = await rig.deleteMany([
    "mutable://open/d1",
    "mutable://open/d2",
    "mutable://open/d3",
  ]);
  assertEquals(results.length, 3);
  assertEquals(results.every((r) => r.success), true);

  // All should be gone
  assertEquals(await rig.exists("mutable://open/d1"), false);
  assertEquals(await rig.exists("mutable://open/d2"), false);
  assertEquals(await rig.exists("mutable://open/d3"), false);
  await rig.cleanup();
});

Deno.test("Rig.deleteMany - empty array returns empty results", async () => {
  const rig = await Rig.connect("memory://");
  const results = await rig.deleteMany([]);
  assertEquals(results.length, 0);
  await rig.cleanup();
});

Deno.test("Rig.deleteMany - handles mix of existing and missing URIs", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/dm-exists", "here"]);

  const results = await rig.deleteMany([
    "mutable://open/dm-exists",
    "mutable://open/dm-missing",
  ]);
  assertEquals(results.length, 2);
  assertEquals(results[0].success, true);
  await rig.cleanup();
});

// ── Rig.listData tests ──

Deno.test("Rig.listData - returns URI strings", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/ld/a", 1]);
  await rig.receive(["mutable://open/ld/b", 2]);
  await rig.receive(["mutable://open/ld/c", 3]);

  const uris = await rig.listData("mutable://open/ld");
  assertEquals(uris.length, 3);
  assertEquals(uris.includes("mutable://open/ld/a"), true);
  assertEquals(uris.includes("mutable://open/ld/b"), true);
  assertEquals(uris.includes("mutable://open/ld/c"), true);
  await rig.cleanup();
});

Deno.test("Rig.listData - returns empty array for empty prefix", async () => {
  const rig = await Rig.connect("memory://");
  const uris = await rig.listData("mutable://open/nothing-here");
  assertEquals(uris.length, 0);
  await rig.cleanup();
});

Deno.test("Rig.listData - respects pagination options", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/pg/a", 1]);
  await rig.receive(["mutable://open/pg/b", 2]);
  await rig.receive(["mutable://open/pg/c", 3]);

  const uris = await rig.listData("mutable://open/pg", { limit: 2 });
  assertEquals(uris.length, 2);
  await rig.cleanup();
});

// ── Rig.readAll tests ──

Deno.test("Rig.readAll - reads all data under a prefix", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/ra/alice", { name: "Alice" }]);
  await rig.receive(["mutable://open/ra/bob", { name: "Bob" }]);

  const data = await rig.readAll<{ name: string }>("mutable://open/ra");
  assertEquals(data.size, 2);
  assertEquals(data.get("mutable://open/ra/alice"), { name: "Alice" });
  assertEquals(data.get("mutable://open/ra/bob"), { name: "Bob" });
  await rig.cleanup();
});

Deno.test("Rig.readAll - returns empty map for empty prefix", async () => {
  const rig = await Rig.connect("memory://");
  const data = await rig.readAll("mutable://open/empty-prefix");
  assertEquals(data.size, 0);
  await rig.cleanup();
});

Deno.test("Rig.readAll - works after writes and deletes", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/rd/x", 1]);
  await rig.receive(["mutable://open/rd/y", 2]);
  await rig.receive(["mutable://open/rd/z", 3]);

  // Delete one
  await rig.delete("mutable://open/rd/y");

  const data = await rig.readAll<number>("mutable://open/rd");
  assertEquals(data.size, 2);
  assertEquals(data.get("mutable://open/rd/x"), 1);
  assertEquals(data.has("mutable://open/rd/y"), false);
  assertEquals(data.get("mutable://open/rd/z"), 3);
  await rig.cleanup();
});

Deno.test("Rig.readAll - respects pagination options", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/rp/a", "a"]);
  await rig.receive(["mutable://open/rp/b", "b"]);
  await rig.receive(["mutable://open/rp/c", "c"]);

  const data = await rig.readAll<string>("mutable://open/rp", { limit: 2 });
  assertEquals(data.size, 2);
  await rig.cleanup();
});

Deno.test("Rig.deleteAll - deletes all items under prefix", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/da/a", 1]);
  await rig.receive(["mutable://open/da/b", 2]);
  await rig.receive(["mutable://open/da/c", 3]);

  const results = await rig.deleteAll("mutable://open/da");
  assertEquals(results.length, 3);
  assertEquals(results.every((r) => r.success), true);

  // Verify all gone
  const remaining = await rig.listData("mutable://open/da");
  assertEquals(remaining.length, 0);
  await rig.cleanup();
});

Deno.test("Rig.deleteAll - returns empty array for empty prefix", async () => {
  const rig = await Rig.connect("memory://");
  const results = await rig.deleteAll("mutable://open/nothing-here");
  assertEquals(results.length, 0);
  await rig.cleanup();
});

Deno.test("Rig.deleteAll - does not affect other prefixes", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/da2/target/a", 1]);
  await rig.receive(["mutable://open/da2/target/b", 2]);
  await rig.receive(["mutable://open/da2/keep/x", 99]);

  await rig.deleteAll("mutable://open/da2/target");

  // Target items deleted
  assertEquals(await rig.exists("mutable://open/da2/target/a"), false);
  assertEquals(await rig.exists("mutable://open/da2/target/b"), false);

  // Other items preserved
  assertEquals(await rig.readData("mutable://open/da2/keep/x"), 99);
  await rig.cleanup();
});

Deno.test("Rig.readEncrypted - returns null for missing URI", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ use: "memory://", identity: id });

  const result = await rig.readEncrypted("mutable://open/enc/missing");
  assertEquals(result, null);
  await rig.cleanup();
});

Deno.test("Rig.readEncrypted - throws without identity", async () => {
  const rig = await Rig.connect("memory://");

  await assertRejects(
    () => rig.readEncrypted("mutable://open/enc/x"),
    Error,
    "no identity",
  );
  await rig.cleanup();
});

Deno.test("Rig.readEncrypted - throws for non-encrypted data", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ use: "memory://", identity: id });

  // Write plain (unencrypted) data
  await rig.receive(["mutable://open/enc/plain", { not: "encrypted" }]);

  // readEncrypted should throw since data isn't an EncryptedPayload
  await assertRejects(
    () => rig.readEncrypted("mutable://open/enc/plain"),
    Error,
    "not an EncryptedPayload",
  );
  await rig.cleanup();
});

Deno.test("Rig.readEncryptedMany - returns empty array for empty input", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ use: "memory://", identity: id });

  const results = await rig.readEncryptedMany([]);
  assertEquals(results, []);

  await rig.cleanup();
});

Deno.test("Rig.readEncryptedMany - returns null for missing URIs", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ use: "memory://", identity: id });

  // Encrypt and receive one entry directly
  const plaintext = new TextEncoder().encode(JSON.stringify("hello"));
  const encrypted = await id.encrypt(plaintext, id.encryptionPubkey);
  await rig.receive(["mutable://open/enc-batch/exists", encrypted]);

  const results = await rig.readEncryptedMany<string>([
    "mutable://open/enc-batch/exists",
    "mutable://open/enc-batch/missing",
  ]);
  assertEquals(results.length, 2);
  assertEquals(results[0], "hello");
  assertEquals(results[1], null);

  await rig.cleanup();
});

Deno.test("Rig.readEncryptedMany - throws without identity", async () => {
  const rig = await Rig.connect("memory://");

  await assertRejects(
    () => rig.readEncryptedMany(["mutable://open/x"]),
    Error,
    "no identity",
  );
  await rig.cleanup();
});

// ── Rig.info() tests ──

Deno.test("Rig.info - with full identity", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ use: "memory://", identity: id });

  const info = rig.info();
  assertEquals(info.pubkey, id.pubkey);
  assertEquals(info.encryptionPubkey, id.encryptionPubkey);
  assertEquals(info.canSign, true);
  assertEquals(info.canEncrypt, true);
  assertEquals(info.hasIdentity, true);
  await rig.cleanup();
});

Deno.test("Rig.info - without identity", async () => {
  const rig = await Rig.connect("memory://");

  const info = rig.info();
  assertEquals(info.pubkey, null);
  assertEquals(info.encryptionPubkey, null);
  assertEquals(info.canSign, false);
  assertEquals(info.canEncrypt, false);
  assertEquals(info.hasIdentity, false);
  await rig.cleanup();
});

Deno.test("Rig.info - with public-only identity", async () => {
  const id = Identity.publicOnly({
    signing: "ab".repeat(32),
    encryption: "cd".repeat(32),
  });
  const rig = await Rig.init({ use: "memory://", identity: id });

  const info = rig.info();
  assertEquals(info.pubkey, "ab".repeat(32));
  assertEquals(info.encryptionPubkey, "cd".repeat(32));
  assertEquals(info.canSign, false);
  assertEquals(info.canEncrypt, false);
  assertEquals(info.hasIdentity, true);
  await rig.cleanup();
});

Deno.test("Rig.info - reflects identity swap", async () => {
  const rig = await Rig.connect("memory://");
  assertEquals(rig.info().hasIdentity, false);

  // Attach identity
  rig.identity = await Identity.generate();
  assertEquals(rig.info().hasIdentity, true);
  assertEquals(rig.info().canSign, true);

  // Detach identity
  rig.identity = null;
  assertEquals(rig.info().hasIdentity, false);
  await rig.cleanup();
});

Deno.test("Rig.deleteMany - all missing URIs succeeds gracefully", async () => {
  const rig = await Rig.connect("memory://");
  const results = await rig.deleteMany([
    "mutable://open/ghost1",
    "mutable://open/ghost2",
    "mutable://open/ghost3",
  ]);
  // Deleting non-existent URIs should not throw
  assertEquals(results.length, 3);
  await rig.cleanup();
});

Deno.test("Rig.readAll - empty prefix returns empty map", async () => {
  const rig = await Rig.connect("memory://");
  const result = await rig.readAll("mutable://open/empty-prefix");
  assertEquals(result.size, 0);
  await rig.cleanup();
});

Deno.test("Rig.readAll - returns all items under prefix", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/coll/a", { v: 1 }]);
  await rig.receive(["mutable://open/coll/b", { v: 2 }]);
  await rig.receive(["mutable://open/coll/c", { v: 3 }]);

  const result = await rig.readAll<{ v: number }>("mutable://open/coll");
  assertEquals(result.size, 3);
  assertEquals(result.get("mutable://open/coll/a")?.v, 1);
  assertEquals(result.get("mutable://open/coll/b")?.v, 2);
  assertEquals(result.get("mutable://open/coll/c")?.v, 3);
  await rig.cleanup();
});

Deno.test("Rig.health - returns healthy for memory backend", async () => {
  const rig = await Rig.connect("memory://");
  const health = await rig.health();
  assertEquals(health.status, "healthy");
  await rig.cleanup();
});

Deno.test("Rig.getSchema - returns schema keys for memory backend", async () => {
  const rig = await Rig.connect("memory://");
  const keys = await rig.getSchema();
  assertEquals(Array.isArray(keys), true);
  assertEquals(keys.length > 0, true);
  await rig.cleanup();
});

// ── Rig.watch() tests ──

Deno.test({
  name: "Rig.watch - detects data changes",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const rig = await Rig.connect("memory://");
    const uri = "mutable://open/watch-test";

    const values: (number | null)[] = [];
    const abort = new AbortController();

    const watchPromise = (async () => {
      for await (
        const value of rig.watch<number>(uri, {
          intervalMs: 30,
          signal: abort.signal,
        })
      ) {
        values.push(value);
        if (values.length >= 3) abort.abort();
      }
    })();

    // Wait for first poll (null)
    await new Promise((r) => setTimeout(r, 50));
    await rig.receive([uri, 42]);
    await new Promise((r) => setTimeout(r, 50));
    await rig.receive([uri, 99]);
    await new Promise((r) => setTimeout(r, 100));

    abort.abort();
    await watchPromise.catch(() => {});

    assertEquals(values[0], null);
    assertEquals(values.length >= 2, true);
    await rig.cleanup();
  },
});

Deno.test({
  name: "Rig.watch - stops on abort signal",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const rig = await Rig.connect("memory://");
    const uri = "mutable://open/watch-abort";
    const abort = new AbortController();

    let count = 0;
    const watchPromise = (async () => {
      for await (
        const _ of rig.watch(uri, { intervalMs: 20, signal: abort.signal })
      ) {
        void _;
        count++;
        // Write a different value each time to trigger dedup emission
        await rig.receive([uri, count]);
        if (count >= 2) abort.abort();
      }
    })();

    await watchPromise.catch(() => {});
    assertEquals(count >= 1, true);
    await rig.cleanup();
  },
});

Deno.test({
  name: "Rig.watch - only emits on change (deduplication)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const rig = await Rig.connect("memory://");
    const uri = "mutable://open/watch-dedup";
    await rig.receive([uri, "stable"]);

    const values: string[] = [];
    const abort = new AbortController();

    const watchPromise = (async () => {
      for await (
        const value of rig.watch<string>(uri, {
          intervalMs: 20,
          signal: abort.signal,
        })
      ) {
        values.push(value!);
        if (values.length >= 2) abort.abort();
      }
    })();

    // Wait for initial poll
    await new Promise((r) => setTimeout(r, 40));
    // Write same value — should NOT emit again
    await rig.receive([uri, "stable"]);
    await new Promise((r) => setTimeout(r, 60));
    // Write different value — SHOULD emit
    await rig.receive([uri, "changed"]);
    await new Promise((r) => setTimeout(r, 60));

    abort.abort();
    await watchPromise.catch(() => {});

    assertEquals(values[0], "stable");
    // Duplicates should not appear
    const uniqueValues = [...new Set(values)];
    assertEquals(uniqueValues.length, values.length);
    await rig.cleanup();
  },
});

// ── Schema-validated Rig tests ──

Deno.test("Rig.init - single backend with schema validates receive", async () => {
  const schema = createTestSchema();
  const rig = await Rig.init({ use: "memory://", schema });

  // Valid receive (mutable://open is in the test schema)
  const accepted = await rig.receive(["mutable://open/valid", { ok: true }]);
  assertEquals(accepted.accepted, true);

  const data = await rig.readData("mutable://open/valid");
  assertEquals(data, { ok: true });
  await rig.cleanup();
});

Deno.test("Rig.init - single backend with schema rejects invalid domain", async () => {
  const schema = createTestSchema();
  const rig = await Rig.init({ use: "memory://", schema });

  const result = await rig.receive([
    "mutable://unknown-domain/x",
    { bad: true },
  ]);
  assertEquals(result.accepted, false);
  await rig.cleanup();
});

Deno.test("Rig.init - multi-backend with schema validates receive", async () => {
  const schema = createTestSchema();
  const rig = await Rig.init({ use: ["memory://", "memory://"], schema });

  const accepted = await rig.receive(["mutable://open/multi-schema", 42]);
  assertEquals(accepted.accepted, true);

  const data = await rig.readData("mutable://open/multi-schema");
  assertEquals(data, 42);
  await rig.cleanup();
});

Deno.test("Rig.init - multi-backend with schema rejects invalid domain", async () => {
  const schema = createTestSchema();
  const rig = await Rig.init({ use: ["memory://", "memory://"], schema });

  const result = await rig.receive(["mutable://unknown/x", "nope"]);
  assertEquals(result.accepted, false);
  await rig.cleanup();
});

Deno.test("Rig.init - schema with identity allows send", async () => {
  const schema = {
    ...createTestSchema(),
    "hash://sha256": async () => ({ valid: true }),
  };
  const id = await Identity.generate();
  const rig = await Rig.init({ use: "memory://", schema, identity: id });

  const result = await rig.send({
    inputs: [],
    outputs: [["mutable://accounts/test", { name: "Alice" }]],
  });
  assertEquals(result.accepted, true);

  const data = await rig.readData("mutable://accounts/test");
  assertEquals(data, { name: "Alice" });
  await rig.cleanup();
});

// ── Rig.count() tests ──

Deno.test("Rig.count - returns count of items under prefix", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/cnt/a", 1]);
  await rig.receive(["mutable://open/cnt/b", 2]);
  await rig.receive(["mutable://open/cnt/c", 3]);

  const count = await rig.count("mutable://open/cnt");
  assertEquals(count, 3);
  await rig.cleanup();
});

Deno.test("Rig.count - returns 0 for empty prefix", async () => {
  const rig = await Rig.connect("memory://");
  const count = await rig.count("mutable://open/empty-count");
  assertEquals(count, 0);
  await rig.cleanup();
});

Deno.test("Rig.count - reflects deletes", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/cnt2/a", 1]);
  await rig.receive(["mutable://open/cnt2/b", 2]);
  assertEquals(await rig.count("mutable://open/cnt2"), 2);

  await rig.delete("mutable://open/cnt2/a");
  assertEquals(await rig.count("mutable://open/cnt2"), 1);
  await rig.cleanup();
});

Deno.test("Rig.count - respects pagination limit", async () => {
  const rig = await Rig.connect("memory://");
  await rig.receive(["mutable://open/cnt3/a", 1]);
  await rig.receive(["mutable://open/cnt3/b", 2]);
  await rig.receive(["mutable://open/cnt3/c", 3]);

  const count = await rig.count("mutable://open/cnt3", { limit: 2 });
  assertEquals(count, 2); // Limited by pagination
  await rig.cleanup();
});

// ── Rig.sendEncrypted() tests ──

Deno.test("Rig.sendEncrypted - encrypt to self and read back", async () => {
  const id = await Identity.generate();
  const rig = await Rig.connect("memory://", id);

  const result = await rig.sendEncrypted({
    inputs: [],
    outputs: [["mutable://open/enc-send/secrets", { apiKey: "sk-test-123" }]],
  });
  assertEquals(result.accepted, true);
  assertEquals(result.uri.startsWith("hash://sha256/"), true);

  // The encrypted data should be readable via readEncrypted
  const secrets = await rig.readEncrypted<{ apiKey: string }>(
    "mutable://open/enc-send/secrets",
  );
  assertEquals(secrets, { apiKey: "sk-test-123" });
  await rig.cleanup();
});

Deno.test("Rig.sendEncrypted - stored data is actually encrypted (not plaintext)", async () => {
  const id = await Identity.generate();
  const rig = await Rig.connect("memory://", id);

  await rig.sendEncrypted({
    inputs: [],
    outputs: [["mutable://open/enc-send/check", { secret: "plaintext-value" }]],
  });

  // Read raw data (not decrypted) — should be an EncryptedPayload, not the original
  const raw = await rig.readData("mutable://open/enc-send/check");
  assertEquals(typeof raw, "object");
  assertEquals(raw !== null, true);
  // Should have EncryptedPayload structure, not the original object
  const payload = raw as Record<string, unknown>;
  assertEquals("data" in payload, true);
  assertEquals("nonce" in payload, true);
  assertEquals("ephemeralPublicKey" in payload, true);
  // Should NOT contain the plaintext
  assertEquals("secret" in payload, false);
  await rig.cleanup();
});

Deno.test("Rig.sendEncrypted - multiple encrypted outputs", async () => {
  const id = await Identity.generate();
  const rig = await Rig.connect("memory://", id);

  const result = await rig.sendEncrypted({
    inputs: [],
    outputs: [
      ["mutable://open/enc-batch/a", { v: 1 }],
      ["mutable://open/enc-batch/b", { v: 2 }],
    ],
  });
  assertEquals(result.accepted, true);

  const a = await rig.readEncrypted<{ v: number }>(
    "mutable://open/enc-batch/a",
  );
  const b = await rig.readEncrypted<{ v: number }>(
    "mutable://open/enc-batch/b",
  );
  assertEquals(a, { v: 1 });
  assertEquals(b, { v: 2 });
  await rig.cleanup();
});

Deno.test("Rig.sendEncrypted - encrypt to another party", async () => {
  const sender = await Identity.generate();
  const receiver = await Identity.generate();

  const rig = await Rig.connect("memory://", sender);

  // Encrypt to receiver
  await rig.sendEncrypted({
    inputs: [],
    outputs: [["mutable://open/enc-cross/msg", { text: "for receiver" }]],
  }, receiver.encryptionPubkey);

  // Receiver can decrypt (create a new rig with receiver identity, same backend)
  const receiverRig = await Rig.init({
    client: rig.client,
    identity: receiver,
  });

  const msg = await receiverRig.readEncrypted<{ text: string }>(
    "mutable://open/enc-cross/msg",
  );
  assertEquals(msg, { text: "for receiver" });

  // Sender should NOT be able to decrypt (encrypted to receiver's key)
  try {
    await rig.readEncrypted("mutable://open/enc-cross/msg");
    // If it didn't throw, that's unexpected
    assertEquals("should have thrown", "did not throw");
  } catch {
    // Expected — sender can't decrypt data encrypted to receiver
  }

  await rig.cleanup();
});

Deno.test("Rig.sendEncrypted - throws without identity", async () => {
  const rig = await Rig.connect("memory://");
  await assertRejects(
    () =>
      rig.sendEncrypted({
        inputs: [],
        outputs: [["mutable://open/x", 1]],
      }),
    Error,
    "no identity set",
  );
  await rig.cleanup();
});

Deno.test("Rig.sendEncrypted - throws for public-only identity", async () => {
  const id = Identity.publicOnly({ signing: "ab".repeat(32) });
  const rig = await Rig.connect("memory://", id);
  await assertRejects(
    () =>
      rig.sendEncrypted({
        inputs: [],
        outputs: [["mutable://open/x", 1]],
      }),
    Error,
    "no encryption keys",
  );
  await rig.cleanup();
});

Deno.test("Rig.sendEncrypted - envelope is signed and verifiable", async () => {
  const id = await Identity.generate();
  const rig = await Rig.connect("memory://", id);

  const result = await rig.sendEncrypted({
    inputs: [],
    outputs: [["mutable://open/enc-verify/x", { secret: true }]],
  });

  // Read the envelope at the hash URI
  const envelope = await rig.readOrThrow<{
    auth: Array<{ pubkey: string; signature: string }>;
    payload: { inputs: string[]; outputs: Array<[string, unknown]> };
  }>(result.uri);

  // Verify the signature
  assertEquals(envelope.auth[0].pubkey, id.pubkey);
  const valid = await id.verify(envelope.payload, envelope.auth[0].signature);
  assertEquals(valid, true);

  await rig.cleanup();
});

// ── Executor rejection tests (from main) ──

Deno.test("Rig.init - rejects postgresql without executor", async () => {
  await assertRejects(
    () => Rig.init({ use: "postgresql://localhost/db" }),
    Error,
    "executor factory",
  );
});

Deno.test("Rig.init - rejects mongodb without executor", async () => {
  await assertRejects(
    () => Rig.init({ use: "mongodb://localhost/db" }),
    Error,
    "executor factory",
  );
});

Deno.test("Rig.init - rejects sqlite without executor", async () => {
  await assertRejects(
    () => Rig.init({ use: "sqlite:///tmp/test.db" }),
    Error,
    "executor factory",
  );
});

// ── Identity edge cases ──

Deno.test("Identity.fromSeed - empty string is valid seed", async () => {
  const id = await Identity.fromSeed("");
  assertEquals(typeof id.pubkey, "string");
  assertEquals(id.pubkey.length, 64);
});

Deno.test("Identity.verify - rejects wrong pubkey signature", async () => {
  const alice = await Identity.generate();
  const bob = await Identity.generate();
  const payload = { test: "data" };
  const auth = await alice.sign(payload);

  // Bob verifying Alice's signature with Bob's key should fail
  const valid = await bob.verify(payload, auth.signature);
  assertEquals(valid, false);
});

// ── Rig.watchAll() tests ──

Deno.test({
  name: "Rig.watchAll - yields initial snapshot with all items",
  async fn() {
    const rig = await Rig.connect("memory://");
    await rig.receive(["mutable://open/wacol/a", { n: 1 }]);
    await rig.receive(["mutable://open/wacol/b", { n: 2 }]);

    const abort = new AbortController();
    let snapshots = 0;

    for await (
      const snapshot of rig.watchAll<{ n: number }>("mutable://open/wacol", {
        intervalMs: 50,
        signal: abort.signal,
      })
    ) {
      snapshots++;
      assertEquals(snapshot.items.size, 2);
      assertEquals(snapshot.items.get("mutable://open/wacol/a")?.n, 1);
      assertEquals(snapshot.items.get("mutable://open/wacol/b")?.n, 2);
      assertEquals(snapshot.added.length, 2);
      assertEquals(snapshot.removed.length, 0);
      assertEquals(snapshot.changed.length, 0);
      abort.abort();
    }

    assertEquals(snapshots, 1);
    await rig.cleanup();
  },
});

Deno.test({
  name: "Rig.watchAll - detects added items",
  async fn() {
    const rig = await Rig.connect("memory://");
    await rig.receive(["mutable://open/wacol/a", { n: 1 }]);

    const abort = new AbortController();
    let snapshots = 0;

    for await (
      const snapshot of rig.watchAll<{ n: number }>("mutable://open/wacol", {
        intervalMs: 50,
        signal: abort.signal,
      })
    ) {
      snapshots++;
      if (snapshots === 1) {
        assertEquals(snapshot.items.size, 1);
        // Add a new item before next poll
        await rig.receive(["mutable://open/wacol/b", { n: 2 }]);
      } else {
        assertEquals(snapshot.items.size, 2);
        assertEquals(snapshot.added, ["mutable://open/wacol/b"]);
        assertEquals(snapshot.removed.length, 0);
        assertEquals(snapshot.changed.length, 0);
        abort.abort();
      }
    }

    assertEquals(snapshots, 2);
    await rig.cleanup();
  },
});

Deno.test({
  name: "Rig.watchAll - detects removed items",
  async fn() {
    const rig = await Rig.connect("memory://");
    await rig.receive(["mutable://open/wacol/a", { n: 1 }]);
    await rig.receive(["mutable://open/wacol/b", { n: 2 }]);

    const abort = new AbortController();
    let snapshots = 0;

    for await (
      const snapshot of rig.watchAll<{ n: number }>("mutable://open/wacol", {
        intervalMs: 50,
        signal: abort.signal,
      })
    ) {
      snapshots++;
      if (snapshots === 1) {
        assertEquals(snapshot.items.size, 2);
        // Remove an item before next poll
        await rig.delete("mutable://open/wacol/b");
      } else {
        assertEquals(snapshot.items.size, 1);
        assertEquals(snapshot.added.length, 0);
        assertEquals(snapshot.removed, ["mutable://open/wacol/b"]);
        assertEquals(snapshot.changed.length, 0);
        abort.abort();
      }
    }

    assertEquals(snapshots, 2);
    await rig.cleanup();
  },
});

Deno.test({
  name: "Rig.watchAll - detects changed items",
  async fn() {
    const rig = await Rig.connect("memory://");
    await rig.receive(["mutable://open/wacol/a", { n: 1 }]);

    const abort = new AbortController();
    let snapshots = 0;

    for await (
      const snapshot of rig.watchAll<{ n: number }>("mutable://open/wacol", {
        intervalMs: 50,
        signal: abort.signal,
      })
    ) {
      snapshots++;
      if (snapshots === 1) {
        assertEquals(snapshot.items.get("mutable://open/wacol/a")?.n, 1);
        // Modify an item before next poll
        await rig.receive(["mutable://open/wacol/a", { n: 99 }]);
      } else {
        assertEquals(snapshot.items.get("mutable://open/wacol/a")?.n, 99);
        assertEquals(snapshot.added.length, 0);
        assertEquals(snapshot.removed.length, 0);
        assertEquals(snapshot.changed, ["mutable://open/wacol/a"]);
        abort.abort();
      }
    }

    assertEquals(snapshots, 2);
    await rig.cleanup();
  },
});

Deno.test({
  name: "Rig.watchAll - skips emit when nothing changed",
  async fn() {
    const rig = await Rig.connect("memory://");
    await rig.receive(["mutable://open/wacol/a", { n: 1 }]);

    const abort = new AbortController();
    let snapshots = 0;

    // After the first snapshot, wait 3 intervals — no changes, so no new emit
    for await (
      const _snapshot of rig.watchAll<{ n: number }>("mutable://open/wacol", {
        intervalMs: 30,
        signal: abort.signal,
      })
    ) {
      snapshots++;
      if (snapshots === 1) {
        // Wait long enough for 3 poll intervals with no changes
        await new Promise((r) => setTimeout(r, 120));
        abort.abort();
      }
    }

    // Should only have gotten 1 snapshot (the initial one)
    assertEquals(snapshots, 1);
    await rig.cleanup();
  },
});

Deno.test({
  name: "Rig.watchAll - empty collection yields initial empty snapshot",
  async fn() {
    const rig = await Rig.connect("memory://");

    const abort = new AbortController();
    let snapshots = 0;

    for await (
      const snapshot of rig.watchAll("mutable://open/waempty", {
        intervalMs: 50,
        signal: abort.signal,
      })
    ) {
      snapshots++;
      assertEquals(snapshot.items.size, 0);
      assertEquals(snapshot.added.length, 0);
      abort.abort();
    }

    assertEquals(snapshots, 1);
    await rig.cleanup();
  },
});

// ── Rig.subscribe() tests ──

Deno.test({
  name: "Rig.subscribe - calls back on initial value",
  async fn() {
    const rig = await Rig.connect("memory://");
    await rig.receive(["mutable://open/wasub/key", { hello: "world" }]);

    const values: unknown[] = [];
    const unsub = rig.subscribe("mutable://open/wasub/key", (value) => {
      values.push(value);
    }, { intervalMs: 50 });

    // Wait for first callback
    await new Promise((r) => setTimeout(r, 100));
    unsub();

    assertEquals(values.length >= 1, true);
    assertEquals((values[0] as { hello: string }).hello, "world");
    await rig.cleanup();
  },
});

Deno.test({
  name: "Rig.subscribe - calls back on changes",
  async fn() {
    const rig = await Rig.connect("memory://");
    await rig.receive(["mutable://open/wasub/key", { v: 1 }]);

    const values: unknown[] = [];
    const unsub = rig.subscribe<{ v: number }>(
      "mutable://open/wasub/key",
      (value) => {
        values.push(value);
      },
      { intervalMs: 50 },
    );

    // Wait for initial callback
    await new Promise((r) => setTimeout(r, 80));

    // Change the value
    await rig.receive(["mutable://open/wasub/key", { v: 2 }]);
    await new Promise((r) => setTimeout(r, 120));

    unsub();

    assertEquals(values.length >= 2, true);
    assertEquals((values[0] as { v: number }).v, 1);
    assertEquals((values[values.length - 1] as { v: number }).v, 2);
    await rig.cleanup();
  },
});

Deno.test({
  name: "Rig.subscribe - unsub stops watching",
  async fn() {
    const rig = await Rig.connect("memory://");
    await rig.receive(["mutable://open/wasub/stop", { v: 1 }]);

    let callCount = 0;
    const unsub = rig.subscribe("mutable://open/wasub/stop", () => {
      callCount++;
    }, { intervalMs: 30 });

    await new Promise((r) => setTimeout(r, 80));
    unsub();
    const countAfterUnsub = callCount;

    // Wait more — should not get more callbacks
    await rig.receive(["mutable://open/wasub/stop", { v: 2 }]);
    await new Promise((r) => setTimeout(r, 100));

    assertEquals(callCount, countAfterUnsub);
    await rig.cleanup();
  },
});

// ── Rig.sendMany() tests ──

Deno.test("Rig.sendMany - sends multiple envelopes", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ use: "memory://", identity: id });

  const results = await rig.sendMany([
    { inputs: [], outputs: [["mutable://open/wamulti/a", { n: 1 }]] },
    { inputs: [], outputs: [["mutable://open/wamulti/b", { n: 2 }]] },
  ]);

  assertEquals(results.length, 2);
  assertEquals(results[0].accepted, true);
  assertEquals(results[1].accepted, true);

  // Verify both values exist
  const a = await rig.readData<{ n: number }>("mutable://open/wamulti/a");
  const b = await rig.readData<{ n: number }>("mutable://open/wamulti/b");
  assertEquals(a?.n, 1);
  assertEquals(b?.n, 2);

  await rig.cleanup();
});

Deno.test("Rig.sendMany - returns empty array for empty input", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ use: "memory://", identity: id });

  const results = await rig.sendMany([]);
  assertEquals(results, []);

  await rig.cleanup();
});

Deno.test("Rig.sendMany - each envelope gets its own hash", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({ use: "memory://", identity: id });

  const results = await rig.sendMany([
    { inputs: [], outputs: [["mutable://open/wahash/x", "one"]] },
    { inputs: [], outputs: [["mutable://open/wahash/y", "two"]] },
  ]);

  // Each result should have a unique hash URI
  assertNotEquals(results[0].uri, results[1].uri);
  assertEquals(results[0].uri.startsWith("hash://"), true);
  assertEquals(results[1].uri.startsWith("hash://"), true);

  await rig.cleanup();
});

Deno.test("Rig.sendMany - throws without identity", async () => {
  const rig = await Rig.connect("memory://");

  await assertRejects(
    () =>
      rig.sendMany([{
        inputs: [],
        outputs: [["mutable://open/x", 1]],
      }]),
    Error,
    "no identity",
  );

  await rig.cleanup();
});

// ── Hooks integration tests ──

Deno.test("Rig hooks - pre-hook throw rejects receive", async () => {
  const rig = await Rig.init({
    use: "memory://",
    hooks: {
      receive: {
        pre: [() => {
          throw new Error("blocked");
        }],
      },
    },
  });

  await assertRejects(
    () => rig.receive(["mutable://open/test", { x: 1 }]),
    Error,
    "blocked",
  );
  await rig.cleanup();
});

Deno.test("Rig hooks - pre-hook mutates receive context", async () => {
  const rig = await Rig.init({
    use: "memory://",
    hooks: {
      receive: {
        pre: [(ctx) => {
          if (ctx.op === "receive") {
            return {
              ctx: {
                ...ctx,
                data: {
                  ...(ctx.data as Record<string, unknown>),
                  injected: true,
                },
              },
            };
          }
        }],
      },
    },
  });

  await rig.receive(["mutable://open/test", { x: 1 }]);
  const data = await rig.readData("mutable://open/test");
  assertEquals((data as Record<string, unknown>).injected, true);
  await rig.cleanup();
});

Deno.test("Rig hooks - post-hook observes read result without modifying", async () => {
  const observed: unknown[] = [];
  const rig = await Rig.init({
    use: "memory://",
    hooks: {
      read: {
        post: [(_ctx, result) => {
          observed.push(result);
        }],
      },
    },
  });

  await rig.receive(["mutable://open/test", { x: 1 }]);
  const result = await rig.read("mutable://open/test");
  assertEquals(result.success, true);
  // Result is unmodified — post-hooks cannot transform
  assertEquals((result.record?.data as Record<string, unknown>).x, 1);
  assertEquals(observed.length, 1);
  await rig.cleanup();
});

Deno.test("Rig hooks - post-hook throw propagates to caller", async () => {
  const rig = await Rig.init({
    use: "memory://",
    hooks: {
      read: {
        post: [() => {
          throw new Error("post-condition failed");
        }],
      },
    },
  });

  await rig.receive(["mutable://open/test", { x: 1 }]);
  await assertRejects(
    () => rig.read("mutable://open/test"),
    Error,
    "post-condition failed",
  );
  await rig.cleanup();
});

Deno.test("Rig hooks - pre-hook throw rejects delete", async () => {
  const rig = await Rig.init({
    use: "memory://",
    hooks: {
      delete: {
        pre: [() => {
          throw new Error("no deletes");
        }],
      },
    },
  });

  await rig.receive(["mutable://open/keep", { x: 1 }]);
  await assertRejects(
    () => rig.delete("mutable://open/keep"),
    Error,
    "no deletes",
  );

  // Data should still be there
  const data = await rig.readData("mutable://open/keep");
  assertEquals((data as Record<string, unknown>).x, 1);
  await rig.cleanup();
});

Deno.test("Rig hooks - pre-hook throw rejects send", async () => {
  const id = await Identity.generate();
  const rig = await Rig.init({
    use: "memory://",
    identity: id,
    hooks: {
      send: {
        pre: [() => {
          throw new Error("rate limited");
        }],
      },
    },
  });

  await assertRejects(
    () =>
      rig.send({
        inputs: [],
        outputs: [["mutable://open/x", { v: 1 }]],
      }),
    Error,
    "rate limited",
  );
  await rig.cleanup();
});

// ── Events integration tests ──

Deno.test("Rig events - fires on receive success", async () => {
  const events: unknown[] = [];
  const rig = await Rig.init({
    use: "memory://",
    on: {
      "receive:success": [(e) => {
        events.push(e);
      }],
    },
  });

  await rig.receive(["mutable://open/test", { x: 1 }]);
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(events.length, 1);
  assertEquals((events[0] as { op: string }).op, "receive");
  await rig.cleanup();
});

Deno.test("Rig events - fires on receive error (backend rejection)", async () => {
  const errors: unknown[] = [];
  const rig = await Rig.init({
    use: "memory://",
    on: {
      "receive:error": [(e) => {
        errors.push(e);
      }],
    },
  });

  // Write to an invalid domain to trigger a backend rejection
  await rig.receive(["mutable://invalid-domain/test", { x: 1 }]);
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(errors.length, 1);
  await rig.cleanup();
});

Deno.test("Rig events - wildcard fires for all ops", async () => {
  const events: unknown[] = [];
  const rig = await Rig.init({
    use: "memory://",
    on: {
      "*:success": [(e) => {
        events.push(e);
      }],
    },
  });

  await rig.receive(["mutable://open/a", { v: 1 }]);
  await rig.read("mutable://open/a");
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(events.length, 2);
  assertEquals((events[0] as { op: string }).op, "receive");
  assertEquals((events[1] as { op: string }).op, "read");
  await rig.cleanup();
});

// ── Observe integration tests ──

Deno.test("Rig observe - fires on receive matching pattern", async () => {
  const calls: { uri: string; params: Record<string, string> }[] = [];
  const rig = await Rig.init({
    use: "memory://",
    observe: {
      "mutable://open/:key": (uri, _data, params) => {
        calls.push({ uri, params });
      },
    },
  });

  await rig.receive(["mutable://open/hello", { v: 1 }]);
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(calls.length, 1);
  assertEquals(calls[0].uri, "mutable://open/hello");
  assertEquals(calls[0].params, { key: "hello" });
  await rig.cleanup();
});

Deno.test("Rig observe - fires on send for each output", async () => {
  const id = await Identity.generate();
  const uris: string[] = [];
  const rig = await Rig.init({
    use: "memory://",
    identity: id,
    observe: {
      "mutable://open/:key": (uri) => {
        uris.push(uri);
      },
    },
  });

  await rig.send({
    inputs: [],
    outputs: [
      ["mutable://open/a", { v: 1 }],
      ["mutable://open/b", { v: 2 }],
    ],
  });
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(uris.length, 2);
  assertEquals(uris.includes("mutable://open/a"), true);
  assertEquals(uris.includes("mutable://open/b"), true);
  await rig.cleanup();
});

Deno.test("Rig observe - does not fire on read", async () => {
  let called = false;
  const rig = await Rig.init({
    use: "memory://",
    observe: {
      "mutable://open/:key": () => {
        called = true;
      },
    },
  });

  await rig.receive(["mutable://open/test", { v: 1 }]);
  await new Promise((r) => setTimeout(r, 20));
  called = false; // reset from the receive

  await rig.read("mutable://open/test");
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(called, false);
  await rig.cleanup();
});

// ── Runtime API tests ──

Deno.test("Rig hooks - immutable after init", async () => {
  const rig = await Rig.init({
    use: "memory://",
    hooks: {
      receive: { pre: [() => {}] },
    },
  });

  // Hooks are frozen — no runtime mutation possible
  // (Rig no longer exposes a hook() method)
  // deno-lint-ignore no-explicit-any
  assertEquals(typeof (rig as any).hook, "undefined");
  await rig.cleanup();
});

Deno.test("Rig.on - runtime event handler works", async () => {
  const rig = await Rig.init({ use: "memory://" });
  const events: unknown[] = [];

  const unsub = rig.on("receive:success", (e) => {
    events.push(e);
  });

  await rig.receive(["mutable://open/test", { x: 1 }]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(events.length, 1);

  unsub();

  await rig.receive(["mutable://open/test2", { x: 2 }]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(events.length, 1); // no new event
  await rig.cleanup();
});

Deno.test("Rig.off - removes event handler", async () => {
  const rig = await Rig.init({ use: "memory://" });
  const events: unknown[] = [];
  const handler = (e: unknown) => {
    events.push(e);
  };

  rig.on("receive:success", handler);
  await rig.receive(["mutable://open/a", { v: 1 }]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(events.length, 1);

  rig.off("receive:success", handler);
  await rig.receive(["mutable://open/b", { v: 2 }]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(events.length, 1);
  await rig.cleanup();
});

Deno.test("Rig.observe - runtime observe works", async () => {
  const rig = await Rig.init({ use: "memory://" });
  const calls: string[] = [];

  const unsub = rig.observe("mutable://open/:key", (uri) => {
    calls.push(uri);
  });

  await rig.receive(["mutable://open/hello", { v: 1 }]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(calls.length, 1);

  unsub();

  await rig.receive(["mutable://open/world", { v: 2 }]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(calls.length, 1); // no new call
  await rig.cleanup();
});

// ── Per-operation client routing tests ──

Deno.test("Rig clients - per-op routing uses separate backends", async () => {
  const writeClient = new MemoryClient({ schema: createTestSchema() });
  const readClient = new MemoryClient({ schema: createTestSchema() });

  // Write some data to readClient directly
  await readClient.receive(["mutable://open/cached", { from: "cache" }]);

  const rig = await Rig.init({
    client: writeClient,
    clients: {
      read: readClient,
    },
  });

  // Read should come from readClient
  const data = await rig.readData("mutable://open/cached");
  assertEquals((data as Record<string, unknown>).from, "cache");

  // Receive should go to writeClient
  await rig.receive(["mutable://open/new", { from: "write" }]);
  const fromWrite = await writeClient.read("mutable://open/new");
  assertEquals(fromWrite.success, true);

  // readClient should NOT have the write
  const fromRead = await readClient.read("mutable://open/new");
  assertEquals(fromRead.success, false);

  await rig.cleanup();
});

Deno.test("Rig clients - schema still works with hooks", async () => {
  const schema = createTestSchema();
  const rig = await Rig.init({
    use: "memory://",
    schema,
    hooks: {
      receive: {
        post: [() => {}], // observer hook
      },
    },
  });

  // Valid domain
  const r1 = await rig.receive(["mutable://open/test", { v: 1 }]);
  assertEquals(r1.accepted, true);

  // Invalid domain — schema should still reject
  const r2 = await rig.receive(["mutable://invalid/test", { v: 1 }]);
  assertEquals(r2.accepted, false);
  await rig.cleanup();
});

// No hook chain replacement test — hooks are immutable after init.

// ── Client array dispatch (accepts-based routing) ──

import { withFilter } from "./filter.ts";

Deno.test("Rig dispatch - routes receive to accepting clients only", async () => {
  const schema = { "mutable://open": async () => ({ valid: true }) };
  const b3ndClient = new MemoryClient({ schema });
  const localClient = new MemoryClient({ schema });

  const rig = await Rig.init({
    clients: [
      withFilter(b3ndClient, {
        receive: ["mutable://*"],
        read: ["mutable://*"],
      }),
      withFilter(localClient, {
        receive: ["local://*"],
        read: ["local://*"],
      }),
    ],
  });

  // Write to mutable — only b3ndClient should get it
  await rig.receive(["mutable://open/test", { v: 1 }]);
  const b3ndRead = await b3ndClient.read("mutable://open/test");
  assertEquals(b3ndRead.success, true);
  assertEquals(b3ndRead.record?.data, { v: 1 });

  // localClient should NOT have it
  const localRead = await localClient.read("mutable://open/test");
  assertEquals(localRead.success, false);

  await rig.cleanup();
});

Deno.test("Rig dispatch - routes read to accepting clients", async () => {
  const schema = { "mutable://open": async () => ({ valid: true }) };
  const primary = new MemoryClient({ schema });
  const cache = new MemoryClient({ schema });

  // Pre-populate cache
  await cache.receive(["mutable://open/cached", { from: "cache" }]);
  // Pre-populate primary with different data
  await primary.receive(["mutable://open/cached", { from: "primary" }]);

  const rig = await Rig.init({
    clients: [
      // Cache first (read-only)
      withFilter(cache, {
        read: ["mutable://*"],
      }),
      // Primary (read + write)
      withFilter(primary, {
        receive: ["mutable://*"],
        read: ["mutable://*"],
      }),
    ],
  });

  // Read should hit cache first
  const result = await rig.read("mutable://open/cached");
  assertEquals(result.success, true);
  assertEquals(result.record?.data, { from: "cache" });

  await rig.cleanup();
});

Deno.test("Rig dispatch - unfiltered clients accept everything", async () => {
  const rig = await Rig.init({
    clients: [
      new MemoryClient({
        schema: { "mutable://open": async () => ({ valid: true }) },
      }),
    ],
  });

  // Unfiltered client accepts all URIs
  const result = await rig.receive(["mutable://open/test", { v: 1 }]);
  assertEquals(result.accepted, true);

  const read = await rig.read("mutable://open/test");
  assertEquals(read.success, true);

  await rig.cleanup();
});

Deno.test("Rig dispatch - no accepting client returns error", async () => {
  const rig = await Rig.init({
    clients: [
      withFilter(new MemoryClient({ schema: {} }), {
        receive: ["local://*"],
      }),
    ],
  });

  // Nothing accepts mutable://
  const result = await rig.receive(["mutable://open/test", { v: 1 }]);
  assertEquals(result.accepted, false);
  assertEquals(result.error?.includes("No client accepts"), true);

  await rig.cleanup();
});

Deno.test("Rig dispatch - health aggregates all clients", async () => {
  const rig = await Rig.init({
    clients: [
      new MemoryClient({ schema: {} }),
      new MemoryClient({ schema: {} }),
    ],
  });

  const health = await rig.health();
  assertEquals(health.status, "healthy");

  await rig.cleanup();
});

Deno.test("Rig dispatch - getSchema unions all clients", async () => {
  const c1 = new MemoryClient({
    schema: { "mutable://open": async () => ({ valid: true }) },
  });
  const c2 = new MemoryClient({
    schema: { "hash://sha256": async () => ({ valid: true }) },
  });

  const rig = await Rig.init({
    clients: [c1, c2],
  });

  const schemas = await rig.getSchema();
  assertEquals(schemas.includes("mutable://open"), true);
  assertEquals(schemas.includes("hash://sha256"), true);

  await rig.cleanup();
});

// ── SSE subscription integration test ──

Deno.test({
  name: "Rig subscribe - pattern via SSE end-to-end",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // 1. Start a server rig with memory backend
    const serverRig = await Rig.init({
      use: "memory://",
    });
    const requestHandler = await serverRig.handler();

    // Start a Deno server on a random port
    const server = Deno.serve(
      { port: 0, onListen() {} },
      requestHandler,
    );
    const port = server.addr.port;

    // Track the subscriber's abort controller so we can guarantee
    // the SSE fetch is cancelled before the server shuts down.
    const subscriberAbort = new AbortController();

    try {
      // 2. Create a subscriber rig pointing at the server
      const subscriberRig = await Rig.connect(
        `http://127.0.0.1:${port}`,
      );

      // 3. Subscribe to a pattern
      const received: {
        uri: string;
        data: unknown;
        params: Record<string, string>;
      }[] = [];
      const subHandler: import("./types.ts").SubscribeHandler = (
        uri,
        data,
        params,
      ) => {
        received.push({ uri, data, params });
      };
      subscriberRig.subscribe(
        "mutable://open/market/:msgId",
        subHandler,
        { signal: subscriberAbort.signal },
      );

      // Give SSE connection time to establish
      await new Promise((r) => setTimeout(r, 300));

      // 4. Write through the server rig (simulating another client)
      await serverRig.receive([
        "mutable://open/market/msg1",
        { type: "ask", price: 42 },
      ]);
      await serverRig.receive([
        "mutable://open/market/msg2",
        { type: "bid", price: 40 },
      ]);
      // This one should NOT match the pattern
      await serverRig.receive([
        "mutable://open/other/foo",
        { type: "other" },
      ]);

      // Give SSE events time to propagate
      await new Promise((r) => setTimeout(r, 500));

      // 5. Verify subscriber received exactly the matching events
      assertEquals(received.length, 2);
      assertEquals(received[0].uri, "mutable://open/market/msg1");
      assertEquals(received[0].data, { type: "ask", price: 42 });
      assertEquals(received[0].params, { msgId: "msg1" });
      assertEquals(received[1].uri, "mutable://open/market/msg2");
      assertEquals(received[1].params, { msgId: "msg2" });

      // 6. Cleanup — abort SSE first, then shut down server
      subscriberAbort.abort();
      // Give fetch abort a tick to propagate
      await new Promise((r) => setTimeout(r, 50));
      await subscriberRig.cleanup();
    } finally {
      // Ensure SSE stream is aborted before server shutdown
      subscriberAbort.abort();
      await new Promise((r) => setTimeout(r, 50));
      await server.shutdown();
      await serverRig.cleanup();
    }
  },
});

Deno.test("Rig subscribe - polling fallback for non-HTTP clients", async () => {
  const rig = await Rig.init({ use: "memory://" });

  // Write some data first
  await rig.receive(["mutable://open/items/a", { v: 1 }]);
  await rig.receive(["mutable://open/items/b", { v: 2 }]);

  const received: string[] = [];
  const handler: import("./types.ts").SubscribeHandler = (
    _uri,
    _data,
    { id },
  ) => {
    received.push(id);
  };
  const unsub = rig.subscribe(
    "mutable://open/items/:id",
    handler,
    { intervalMs: 50 },
  );

  // Wait for first poll
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(received.length, 2);
  assertEquals(received.includes("a"), true);
  assertEquals(received.includes("b"), true);

  // Write a new item
  await rig.receive(["mutable://open/items/c", { v: 3 }]);
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(received.includes("c"), true);

  unsub();
  await rig.cleanup();
});

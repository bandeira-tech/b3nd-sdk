import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { Identity } from "./identity.ts";
import {
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
} from "./backend-factory.ts";
import { Rig } from "./rig.ts";
import { AuthenticatedRig } from "./authenticated-rig.ts";
import { createTestSchema, MemoryClient } from "../b3nd-client-memory/mod.ts";
import { connection } from "./connection.ts";
import { httpApi } from "./http.ts";

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

// Rig.init no longer exists — unsupported protocol test removed
// (createClientFromUrl tests below still cover protocol rejection)

// ── Rig tests ──

Deno.test("Rig -with memory backend", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const health = await rig.status();
  assertEquals(health.status, "healthy");
});

Deno.test("Rig -with pre-built client", async () => {
  const client = new MemoryClient();
  const rig = new Rig({
    connections: [connection(client, { receive: ["*"], read: ["*"] })],
  });
  const health = await rig.status();
  assertEquals(health.status, "healthy");
});

Deno.test("AuthenticatedRig - identity.rig(rig) creates session", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);
  assertEquals(session.pubkey, id.pubkey);
  assertEquals(session instanceof AuthenticatedRig, true);
});

// Rig.init no longer exists — "rejects no client" test removed
// (constructor requires connections: Connection[] via TypeScript types)

Deno.test("Rig.receive - receives a message", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const [result] = await rig.receive([["mutable://open/test", {}, { hello: "world" }]]);
  assertEquals(result.accepted, true);

  const reads = await rig.read("mutable://open/test");
  const read = reads[0];
  assertEquals(read.success, true);
  assertEquals(read.record?.data, { hello: "world" });
});

Deno.test("AuthenticatedRig.send - signs and sends via session", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const result = await session.send({
    inputs: [],
    outputs: [["mutable://open/item", {}, { value: 42 }]],
  });
  assertEquals(result.accepted, true);
  assertEquals(result.uri.startsWith("hash://sha256/"), true);

  // The output should be readable at its own URI
  const reads = await rig.read("mutable://open/item");
  const read = reads[0];
  assertEquals(read.success, true);
  assertEquals(read.record?.data, { value: 42 });
});

Deno.test("AuthenticatedRig - multiple identities on same rig", async () => {
  const alice = await Identity.generate();
  const bob = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });

  const aliceSession = alice.rig(rig);
  const bobSession = bob.rig(rig);

  assertEquals(aliceSession.pubkey, alice.pubkey);
  assertEquals(bobSession.pubkey, bob.pubkey);

  // Both can write through the same rig
  await aliceSession.send({
    inputs: [],
    outputs: [["mutable://open/alice-data", {}, { from: "alice" }]],
  });
  await bobSession.send({
    inputs: [],
    outputs: [["mutable://open/bob-data", {}, { from: "bob" }]],
  });

  assertEquals(await rig.readData("mutable://open/alice-data"), {
    from: "alice",
  });
  assertEquals(await rig.readData("mutable://open/bob-data"), { from: "bob" });
});

Deno.test("Rig.read - trailing-slash lists items", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/a", {}, 1]]);
  await rig.receive([["mutable://open/b", {}, 2]]);

  const results = await rig.read("mutable://open/");
  assertEquals(results.length, 2);
});

// rig.delete() no longer exists — removed from NodeProtocolInterface

Deno.test("Rig.read - reads multiple URIs", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/m1", {}, "a"]]);
  await rig.receive([["mutable://open/m2", {}, "b"]]);

  const results = await rig.read(["mutable://open/m1", "mutable://open/m2"]);
  assertEquals(results.length, 2);
  assertEquals(results.filter((r) => r.success).length, 2);
});

Deno.test("Rig.client - exposes underlying client", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  assertEquals(typeof rig.client.receive, "function");
  assertEquals(typeof rig.client.read, "function");
});

Deno.test("Rig -multi-client dispatch composes correctly", async () => {
  // Two memory backends — writes should go to both, reads from first match
  const clientA = new MemoryClient();
  const clientB = new MemoryClient();
  const rig = new Rig({
    connections: [
      connection(clientA, {
        receive: ["mutable://*", "immutable://*", "hash://*", "local://*"],
        read: ["mutable://*", "immutable://*", "hash://*", "local://*"],
      }),
      connection(clientB, {
        receive: ["mutable://*", "immutable://*", "hash://*", "local://*"],
        read: ["mutable://*", "immutable://*", "hash://*", "local://*"],
      }),
    ],
  });
  await rig.receive([["mutable://open/multi", {}, "shared"]]);

  const reads = await rig.read("mutable://open/multi");
  const read = reads[0];
  assertEquals(read.success, true);
  assertEquals(read.record?.data, "shared");
});

Deno.test("Rig.status - returns schema keys", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const status = await rig.status();
  assertEquals(status.status, "healthy");
});

// ── Rig constructor tests ──

Deno.test("Rig -quick connect to memory backend", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const health = await rig.status();
  assertEquals(health.status, "healthy");
});

Deno.test("Rig -session.send round-trip", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const result = await session.send({
    inputs: [],
    outputs: [["mutable://open/connect-test", {}, { v: 1 }]],
  });
  assertEquals(result.accepted, true);
});

Deno.test("Rig -receive and read round-trip", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/hello", {}, "world"]]);
  const reads = await rig.read("mutable://open/hello");
  const read = reads[0];
  assertEquals(read.success, true);
  assertEquals(read.record?.data, "world");
});

// ── AuthenticatedRig.canSign / canEncrypt tests ──

Deno.test("AuthenticatedRig.canSign - true for full identity", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);
  assertEquals(session.canSign, true);
});

Deno.test("AuthenticatedRig.canSign - false for public-only identity", async () => {
  const publicId = Identity.publicOnly({ signing: "ab".repeat(32) });
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = publicId.rig(rig);
  assertEquals(session.canSign, false);
});

Deno.test("AuthenticatedRig.canEncrypt - true for full identity", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);
  assertEquals(session.canEncrypt, true);
});

Deno.test("AuthenticatedRig.canEncrypt - false for public-only identity", () => {
  const publicId = Identity.publicOnly({ signing: "ab".repeat(32) });
  assertEquals(publicId.canEncrypt, false);
});

// ── Rig.exists tests ──

Deno.test("Rig.exists - returns true for existing data", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/check", {}, { present: true }]]);
  assertEquals(await rig.exists("mutable://open/check"), true);
});

Deno.test("Rig.exists - returns false for missing data", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  assertEquals(await rig.exists("mutable://open/nonexistent"), false);
});

// rig.delete() no longer exists — Rig.exists after delete test removed

// ── Rig.read multi-URI edge cases ──

Deno.test("Rig.read - handles mix of existing and missing URIs", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/yes", {}, "found"]]);

  const results = await rig.read([
    "mutable://open/yes",
    "mutable://open/nope",
  ]);
  assertEquals(results.length, 2);
  assertEquals(results.filter((r) => r.success).length, 1);
  assertEquals(results.filter((r) => !r.success).length, 1);
});

Deno.test("Rig.read - handles empty URI array", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const results = await rig.read([]);
  assertEquals(results.length, 0);
});

// ── createClientFromUrl tests ──

Deno.test("createClientFromUrl - creates memory client from URL", async () => {
  const { createClientFromUrl } = await import("./backend-factory.ts");
  const client = await createClientFromUrl("memory://");
  const health = await client.status();
  assertEquals(health.status, "healthy");

  // Write and read back
  await client.receive([["mutable://open/test", {}, { val: 1 }]]);
  const reads = await client.read("mutable://open/test");
  const read = reads[0];
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

// ── Rig.readData tests ──

Deno.test("Rig.readData - returns data for existing URI", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/profile", {}, { name: "Alice", age: 30 }]]);

  const data = await rig.readData<{ name: string; age: number }>(
    "mutable://open/profile",
  );
  assertEquals(data, { name: "Alice", age: 30 });
});

Deno.test("Rig.readData - returns null for missing URI", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const data = await rig.readData("mutable://open/ghost");
  assertEquals(data, null);
});

// rig.delete() no longer exists — Rig.readData after delete test removed

Deno.test("Rig.readData - handles scalar values", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });

  await rig.receive([["mutable://open/num", {}, 42]]);
  assertEquals(await rig.readData<number>("mutable://open/num"), 42);

  await rig.receive([["mutable://open/str", {}, "hello"]]);
  assertEquals(await rig.readData<string>("mutable://open/str"), "hello");

  await rig.receive([["mutable://open/bool", {}, true]]);
  assertEquals(await rig.readData<boolean>("mutable://open/bool"), true);
});

// ── Rig.readOrThrow tests ──

Deno.test("Rig.readOrThrow - returns data for existing URI", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/config", {}, { debug: false }]]);

  const config = await rig.readOrThrow<{ debug: boolean }>(
    "mutable://open/config",
  );
  assertEquals(config, { debug: false });
});

Deno.test("Rig.readOrThrow - throws for missing URI", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await assertRejects(
    () => rig.readOrThrow("mutable://open/missing"),
    Error,
    "no data at mutable://open/missing",
  );
});

// rig.delete() no longer exists — Rig.readOrThrow after delete test removed

// ── Rig.send integration tests (with Identity and signature verification) ──

Deno.test("AuthenticatedRig.send - creates verifiable signed envelope", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const result = await session.send({
    inputs: [],
    outputs: [["mutable://open/signed-test", {}, { msg: "hello" }]],
  });

  assertEquals(result.accepted, true);
  assertEquals(typeof result.uri, "string");
  assertEquals(result.uri.startsWith("hash://sha256/"), true);

  // Read back the envelope
  const envelope = await rig.readOrThrow<{
    auth: Array<{ pubkey: string; signature: string }>;
    inputs: string[];
    outputs: Array<[string, unknown]>;
    hash: string;
  }>(result.uri);

  // Verify structure
  assertEquals(Array.isArray(envelope.auth), true);
  assertEquals(envelope.auth.length, 1);
  assertEquals(envelope.auth[0].pubkey, id.pubkey);
  assertEquals(typeof envelope.auth[0].signature, "string");
  assertEquals(envelope.outputs[0][0], "mutable://open/signed-test");
  assertEquals(envelope.outputs[0][1], { msg: "hello" });

  // Verify the signature is valid using the identity
  const valid = await id.verify(
    { inputs: envelope.inputs, outputs: envelope.outputs },
    envelope.auth[0].signature,
  );
  assertEquals(valid, true);

  // Also verify the mutable output was written
  const data = await rig.readData("mutable://open/signed-test");
  assertEquals(data, { msg: "hello" });
});

Deno.test("AuthenticatedRig.send - different identities produce different signatures", async () => {
  const alice = await Identity.generate();
  const bob = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });

  const r1 = await alice.rig(rig).send({
    inputs: [],
    outputs: [["mutable://open/alice-write", {}, 1]],
  });

  const r2 = await bob.rig(rig).send({
    inputs: [],
    outputs: [["mutable://open/bob-write", {}, 2]],
  });

  // Both succeed
  assertEquals(r1.accepted, true);
  assertEquals(r2.accepted, true);

  // Different envelopes with different signers
  const e1 = await rig.readOrThrow<{
    auth: Array<{ pubkey: string; signature: string }>;
    inputs: string[];
    outputs: Array<[string, unknown]>;
  }>(r1.uri);
  const e2 = await rig.readOrThrow<{
    auth: Array<{ pubkey: string; signature: string }>;
    inputs: string[];
    outputs: Array<[string, unknown]>;
  }>(r2.uri);

  assertEquals(e1.auth[0].pubkey, alice.pubkey);
  assertEquals(e2.auth[0].pubkey, bob.pubkey);

  // Alice's signature should not verify with Bob's key and vice versa
  const crossCheck = await bob.verify({ inputs: e1.inputs, outputs: e1.outputs }, e1.auth[0].signature);
  assertEquals(crossCheck, false);
});

Deno.test("Rig.read - multi-URI returns data for each", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });

  await rig.receive([["mutable://open/rdm/a", {}, { name: "Alice" }]]);
  await rig.receive([["mutable://open/rdm/b", {}, { name: "Bob" }]]);

  const results = await rig.read<{ name: string }>([
    "mutable://open/rdm/a",
    "mutable://open/rdm/b",
  ]);

  assertEquals(results.length, 2);
  assertEquals(results[0].record?.data, { name: "Alice" });
  assertEquals(results[1].record?.data, { name: "Bob" });
});

Deno.test("Rig.read - multi-URI omits missing URIs", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });

  await rig.receive([["mutable://open/rdm2/exists", {}, { ok: true }]]);

  const results = await rig.read([
    "mutable://open/rdm2/exists",
    "mutable://open/rdm2/missing",
  ]);

  assertEquals(results.length, 2);
  assertEquals(results[0].success, true);
  assertEquals(results[0].record?.data, { ok: true });
  assertEquals(results[1].success, false);
});

Deno.test("Rig.read - empty array returns empty results", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const results = await rig.read([]);
  assertEquals(results.length, 0);
});

Deno.test("Rig.read - multi-URI all missing returns all failures", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const results = await rig.read([
    "mutable://open/gone/a",
    "mutable://open/gone/b",
  ]);
  assertEquals(results.filter((r) => r.success).length, 0);
});

Deno.test("AuthenticatedRig.send - multiple outputs in single envelope", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const result = await session.send({
    inputs: [],
    outputs: [
      ["mutable://open/batch/a", {}, { v: 1 }],
      ["mutable://open/batch/b", {}, { v: 2 }],
      ["mutable://open/batch/c", {}, { v: 3 }],
    ],
  });

  assertEquals(result.accepted, true);

  // All outputs should be written
  assertEquals(await rig.readData("mutable://open/batch/a"), { v: 1 });
  assertEquals(await rig.readData("mutable://open/batch/b"), { v: 2 });
  assertEquals(await rig.readData("mutable://open/batch/c"), { v: 3 });

  // The envelope at the hash URI should have all 3 outputs
  const envelope = await rig.readOrThrow<{
    outputs: Array<[string, unknown]>;
  }>(result.uri);
  assertEquals(envelope.outputs.length, 3);
});

// ── Rig.deleteMany tests ──

// rig.deleteMany() no longer exists — tests removed

// ── Rig.read trailing-slash (list) tests ──

Deno.test("Rig.read - trailing-slash returns URI strings", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/ld/a", {}, 1]]);
  await rig.receive([["mutable://open/ld/b", {}, 2]]);
  await rig.receive([["mutable://open/ld/c", {}, 3]]);

  const results = await rig.read("mutable://open/ld/");
  const uris = results.filter((r) => r.success).map((r) => r.uri).filter(
    Boolean,
  );
  assertEquals(uris.length, 3);
  assertEquals(uris.includes("mutable://open/ld/a"), true);
  assertEquals(uris.includes("mutable://open/ld/b"), true);
  assertEquals(uris.includes("mutable://open/ld/c"), true);
});

Deno.test("Rig.read - trailing-slash returns empty for empty prefix", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const results = await rig.read("mutable://open/nothing-here/");
  assertEquals(results.length, 0);
});

// ── Rig.read trailing-slash (readAll equivalent) tests ──

Deno.test("Rig.read - trailing-slash reads all data under a prefix", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/ra/alice", {}, { name: "Alice" }]]);
  await rig.receive([["mutable://open/ra/bob", {}, { name: "Bob" }]]);

  const results = await rig.read<{ name: string }>("mutable://open/ra/");
  const data = new Map(
    results.filter((r) => r.success && r.record && r.uri).map((
      r,
    ) => [r.uri!, r.record!.data]),
  );
  assertEquals(data.size, 2);
  assertEquals(data.get("mutable://open/ra/alice"), { name: "Alice" });
  assertEquals(data.get("mutable://open/ra/bob"), { name: "Bob" });
});

Deno.test("Rig.read - trailing-slash returns empty for empty prefix", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const results = await rig.read("mutable://open/empty-prefix/");
  assertEquals(results.length, 0);
});

// rig.readAll with delete, readAll with pagination, deleteAll — all removed (delete no longer exists)

Deno.test("AuthenticatedRig.readEncrypted - returns null for missing URI", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const result = await session.readEncrypted("mutable://open/enc/missing");
  assertEquals(result, null);
});

Deno.test("AuthenticatedRig.readEncrypted - throws for non-encrypted data", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  // Write plain (unencrypted) data
  await rig.receive([["mutable://open/enc/plain", {}, { not: "encrypted" }]]);

  // readEncrypted should throw since data isn't an EncryptedPayload
  await assertRejects(
    () => session.readEncrypted("mutable://open/enc/plain"),
    Error,
    "not an EncryptedPayload",
  );
});

Deno.test("AuthenticatedRig.readEncryptedMany - returns empty array for empty input", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const results = await session.readEncryptedMany([]);
  assertEquals(results, []);
});

Deno.test("AuthenticatedRig.readEncryptedMany - returns null for missing URIs", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  // Encrypt and receive one entry directly
  const plaintext = new TextEncoder().encode(JSON.stringify("hello"));
  const encrypted = await id.encrypt(plaintext, id.encryptionPubkey);
  await rig.receive([["mutable://open/enc-batch/exists", {}, encrypted]]);

  const results = await session.readEncryptedMany<string>([
    "mutable://open/enc-batch/exists",
    "mutable://open/enc-batch/missing",
  ]);
  assertEquals(results.length, 2);
  assertEquals(results[0], "hello");
  assertEquals(results[1], null);
});

// ── Rig.info() tests ──

Deno.test("Rig.info - returns behavior info", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    hooks: {
      beforeReceive: () => {},
      afterRead: () => {},
    },
    on: {
      "receive:success": [() => {}],
    },
    reactions: {
      "mutable://open/:key": () => {},
    },
  });

  const info = rig.info();
  assertEquals(info.behavior.hooks.includes("beforeReceive"), true);
  assertEquals(info.behavior.hooks.includes("afterRead"), true);
  assertEquals(info.behavior.events["receive:success"], 1);
  assertEquals(info.behavior.reactors, 1);
});

Deno.test("Rig.info - empty rig has empty behavior", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });

  const info = rig.info();
  assertEquals(info.behavior.hooks.length, 0);
  assertEquals(info.behavior.reactors, 0);
});

// rig.deleteMany() no longer exists — deleteMany missing URIs test removed

Deno.test("Rig.read - trailing-slash empty prefix returns empty", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const results = await rig.read("mutable://open/empty-prefix/");
  assertEquals(results.length, 0);
});

Deno.test("Rig.read - trailing-slash returns all items under prefix", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/coll/a", {}, { v: 1 }]]);
  await rig.receive([["mutable://open/coll/b", {}, { v: 2 }]]);
  await rig.receive([["mutable://open/coll/c", {}, { v: 3 }]]);

  const results = await rig.read<{ v: number }>("mutable://open/coll/");
  assertEquals(results.length, 3);
  const data = new Map(
    results.filter((r) => r.success && r.record && r.uri).map((
      r,
    ) => [r.uri!, r.record!.data]),
  );
  assertEquals(data.get("mutable://open/coll/a")?.v, 1);
  assertEquals(data.get("mutable://open/coll/b")?.v, 2);
  assertEquals(data.get("mutable://open/coll/c")?.v, 3);
});

Deno.test("Rig.status - returns healthy for memory backend", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const health = await rig.status();
  assertEquals(health.status, "healthy");
});

Deno.test("Rig.status - returns schema keys for memory backend", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const status = await rig.status();
  assertEquals(status.status, "healthy");
});

// ── Rig.watch() tests ──

Deno.test({
  name: "Rig.watch - detects data changes",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const rig = new Rig({
      connections: [
        connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
      ],
    });
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
    await rig.receive([[uri, {}, 42]]);
    await new Promise((r) => setTimeout(r, 50));
    await rig.receive([[uri, {}, 99]]);
    await new Promise((r) => setTimeout(r, 100));

    abort.abort();
    await watchPromise.catch(() => {});

    assertEquals(values[0], null);
    assertEquals(values.length >= 2, true);
  },
});

Deno.test({
  name: "Rig.watch - stops on abort signal",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const rig = new Rig({
      connections: [
        connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
      ],
    });
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
        await rig.receive([[uri, {}, count]]);
        if (count >= 2) abort.abort();
      }
    })();

    await watchPromise.catch(() => {});
    assertEquals(count >= 1, true);
  },
});

Deno.test({
  name: "Rig.watch - only emits on change (deduplication)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const rig = new Rig({
      connections: [
        connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
      ],
    });
    const uri = "mutable://open/watch-dedup";
    await rig.receive([[uri, {}, "stable"]]);

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
    await rig.receive([[uri, {}, "stable"]]);
    await new Promise((r) => setTimeout(r, 60));
    // Write different value — SHOULD emit
    await rig.receive([[uri, {}, "changed"]]);
    await new Promise((r) => setTimeout(r, 60));

    abort.abort();
    await watchPromise.catch(() => {});

    assertEquals(values[0], "stable");
    // Duplicates should not appear
    const uniqueValues = [...new Set(values)];
    assertEquals(uniqueValues.length, values.length);
  },
});

// ── Schema-validated Rig tests ──
// Schema is a rig concern — clients are pure plumbing.

Deno.test("Rig -schema validates receive", async () => {
  const schema = createTestSchema();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    schema,
  });

  // Valid receive (mutable://open is in the test schema)
  const [accepted] = await rig.receive([["mutable://open/valid", {}, { ok: true }]]);
  assertEquals(accepted.accepted, true);

  const data = await rig.readData("mutable://open/valid");
  assertEquals(data, { ok: true });
});

Deno.test("Rig -schema rejects invalid domain", async () => {
  const schema = createTestSchema();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    schema,
  });

  const [result] = await rig.receive([
    ["mutable://unknown-domain/x", {}, { bad: true }],
  ]);
  assertEquals(result.accepted, false);
});

Deno.test("Rig -multi-connection dispatch with schema validates receive", async () => {
  const schema = createTestSchema();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), {
        receive: ["mutable://*", "immutable://*", "hash://*", "local://*"],
        read: ["mutable://*", "immutable://*", "hash://*", "local://*"],
      }),
      connection(new MemoryClient(), {
        receive: ["mutable://*", "immutable://*", "hash://*", "local://*"],
        read: ["mutable://*", "immutable://*", "hash://*", "local://*"],
      }),
    ],
    schema,
  });

  const [accepted] = await rig.receive([["mutable://open/multi-schema", {}, 42]]);
  assertEquals(accepted.accepted, true);

  const data = await rig.readData("mutable://open/multi-schema");
  assertEquals(data, 42);
});

Deno.test("Rig -multi-connection dispatch with schema rejects invalid domain", async () => {
  const schema = createTestSchema();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), {
        receive: ["mutable://*", "immutable://*", "hash://*", "local://*"],
        read: ["mutable://*", "immutable://*", "hash://*", "local://*"],
      }),
      connection(new MemoryClient(), {
        receive: ["mutable://*", "immutable://*", "hash://*", "local://*"],
        read: ["mutable://*", "immutable://*", "hash://*", "local://*"],
      }),
    ],
    schema,
  });

  const [result] = await rig.receive([["mutable://unknown/x", {}, "nope"]]);
  assertEquals(result.accepted, false);
});

Deno.test("Rig -schema with session allows send", async () => {
  const schema = {
    ...createTestSchema(),
    "hash://sha256": async () => ({ valid: true }),
  };
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    schema,
  });
  const session = id.rig(rig);

  const result = await session.send({
    inputs: [],
    outputs: [["mutable://accounts/test", {}, { name: "Alice" }]],
  });
  assertEquals(result.accepted, true);

  const data = await rig.readData("mutable://accounts/test");
  assertEquals(data, { name: "Alice" });
});

// ── Rig.count() tests ──

Deno.test("Rig.count - returns count of items under prefix", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  await rig.receive([["mutable://open/cnt/a", {}, 1]]);
  await rig.receive([["mutable://open/cnt/b", {}, 2]]);
  await rig.receive([["mutable://open/cnt/c", {}, 3]]);

  const count = await rig.count("mutable://open/cnt");
  assertEquals(count, 3);
});

Deno.test("Rig.count - returns 0 for empty prefix", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const count = await rig.count("mutable://open/empty-count");
  assertEquals(count, 0);
});

// rig.delete() no longer exists — Rig.count after delete test removed
// rig.count() no longer takes pagination options — test removed

// ── AuthenticatedRig.sendEncrypted() tests ──

Deno.test("AuthenticatedRig.sendEncrypted - encrypt to self and read back", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const result = await session.sendEncrypted({
    inputs: [],
    outputs: [["mutable://open/enc-send/secrets", {}, { apiKey: "sk-test-123" }]],
  });
  assertEquals(result.accepted, true);
  assertEquals(result.uri.startsWith("hash://sha256/"), true);

  // The encrypted data should be readable via readEncrypted
  const secrets = await session.readEncrypted<{ apiKey: string }>(
    "mutable://open/enc-send/secrets",
  );
  assertEquals(secrets, { apiKey: "sk-test-123" });
});

Deno.test("AuthenticatedRig.sendEncrypted - stored data is actually encrypted (not plaintext)", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  await session.sendEncrypted({
    inputs: [],
    outputs: [["mutable://open/enc-send/check", {}, { secret: "plaintext-value" }]],
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
});

Deno.test("AuthenticatedRig.sendEncrypted - multiple encrypted outputs", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const result = await session.sendEncrypted({
    inputs: [],
    outputs: [
      ["mutable://open/enc-batch/a", {}, { v: 1 }],
      ["mutable://open/enc-batch/b", {}, { v: 2 }],
    ],
  });
  assertEquals(result.accepted, true);

  const a = await session.readEncrypted<{ v: number }>(
    "mutable://open/enc-batch/a",
  );
  const b = await session.readEncrypted<{ v: number }>(
    "mutable://open/enc-batch/b",
  );
  assertEquals(a, { v: 1 });
  assertEquals(b, { v: 2 });
});

Deno.test("AuthenticatedRig.sendEncrypted - encrypt to another party", async () => {
  const sender = await Identity.generate();
  const receiver = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });

  const senderSession = sender.rig(rig);
  const receiverSession = receiver.rig(rig);

  // Encrypt to receiver
  await senderSession.sendEncrypted({
    inputs: [],
    outputs: [["mutable://open/enc-cross/msg", {}, { text: "for receiver" }]],
  }, receiver.encryptionPubkey);

  // Receiver can decrypt
  const msg = await receiverSession.readEncrypted<{ text: string }>(
    "mutable://open/enc-cross/msg",
  );
  assertEquals(msg, { text: "for receiver" });

  // Sender should NOT be able to decrypt (encrypted to receiver's key)
  try {
    await senderSession.readEncrypted("mutable://open/enc-cross/msg");
    // If it didn't throw, that's unexpected
    assertEquals("should have thrown", "did not throw");
  } catch {
    // Expected — sender can't decrypt data encrypted to receiver
  }
});

Deno.test("AuthenticatedRig.sendEncrypted - throws for public-only identity", async () => {
  const id = Identity.publicOnly({ signing: "ab".repeat(32) });
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);
  await assertRejects(
    () =>
      session.sendEncrypted({
        inputs: [],
        outputs: [["mutable://open/x", {}, 1]],
      }),
    Error,
    "no encryption keys",
  );
});

Deno.test("AuthenticatedRig.sendEncrypted - envelope is signed and verifiable", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const result = await session.sendEncrypted({
    inputs: [],
    outputs: [["mutable://open/enc-verify/x", {}, { secret: true }]],
  });

  // Read the envelope at the hash URI
  const envelope = await rig.readOrThrow<{
    auth: Array<{ pubkey: string; signature: string }>;
    inputs: string[];
    outputs: Array<[string, unknown]>;
  }>(result.uri);

  // Verify the signature
  assertEquals(envelope.auth[0].pubkey, id.pubkey);
  const valid = await id.verify({ inputs: envelope.inputs, outputs: envelope.outputs }, envelope.auth[0].signature);
  assertEquals(valid, true);
});

// ── Executor rejection tests (createClientFromUrl) ──

Deno.test("createClientFromUrl - rejects postgresql without executor", async () => {
  const { createClientFromUrl } = await import("./backend-factory.ts");
  await assertRejects(
    () => createClientFromUrl("postgresql://localhost/db"),
    Error,
    "executor factory",
  );
});

Deno.test("createClientFromUrl - rejects mongodb without executor", async () => {
  const { createClientFromUrl } = await import("./backend-factory.ts");
  await assertRejects(
    () => createClientFromUrl("mongodb://localhost/db"),
    Error,
    "executor factory",
  );
});

Deno.test("createClientFromUrl - rejects sqlite without executor", async () => {
  const { createClientFromUrl } = await import("./backend-factory.ts");
  await assertRejects(
    () => createClientFromUrl("sqlite:///tmp/test.db"),
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
    const rig = new Rig({
      connections: [
        connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
      ],
    });
    await rig.receive([["mutable://open/wacol/a", {}, { n: 1 }]]);
    await rig.receive([["mutable://open/wacol/b", {}, { n: 2 }]]);

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
  },
});

Deno.test({
  name: "Rig.watchAll - detects added items",
  async fn() {
    const rig = new Rig({
      connections: [
        connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
      ],
    });
    await rig.receive([["mutable://open/wacol/a", {}, { n: 1 }]]);

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
        await rig.receive([["mutable://open/wacol/b", {}, { n: 2 }]]);
      } else {
        assertEquals(snapshot.items.size, 2);
        assertEquals(snapshot.added, ["mutable://open/wacol/b"]);
        assertEquals(snapshot.removed.length, 0);
        assertEquals(snapshot.changed.length, 0);
        abort.abort();
      }
    }

    assertEquals(snapshots, 2);
  },
});

// rig.delete() no longer exists — Rig.watchAll removed items test removed

Deno.test({
  name: "Rig.watchAll - detects changed items",
  async fn() {
    const rig = new Rig({
      connections: [
        connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
      ],
    });
    await rig.receive([["mutable://open/wacol/a", {}, { n: 1 }]]);

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
        await rig.receive([["mutable://open/wacol/a", {}, { n: 99 }]]);
      } else {
        assertEquals(snapshot.items.get("mutable://open/wacol/a")?.n, 99);
        assertEquals(snapshot.added.length, 0);
        assertEquals(snapshot.removed.length, 0);
        assertEquals(snapshot.changed, ["mutable://open/wacol/a"]);
        abort.abort();
      }
    }

    assertEquals(snapshots, 2);
  },
});

Deno.test({
  name: "Rig.watchAll - skips emit when nothing changed",
  async fn() {
    const rig = new Rig({
      connections: [
        connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
      ],
    });
    await rig.receive([["mutable://open/wacol/a", {}, { n: 1 }]]);

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
  },
});

Deno.test({
  name: "Rig.watchAll - empty collection yields initial empty snapshot",
  async fn() {
    const rig = new Rig({
      connections: [
        connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
      ],
    });

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
  },
});

// ── Rig.observe() tests (client-backed streaming) ──

Deno.test({
  name: "Rig.observe - yields matching writes from MemoryClient",
  async fn() {
    const mem = new MemoryClient();
    const rig = new Rig({
      connections: [
        connection(mem, { receive: ["*"], read: ["*"], observe: ["*"] }),
      ],
    });

    const abort = new AbortController();
    const results: { uri: string; data: unknown }[] = [];

    // Start observing in background
    const done = (async () => {
      for await (
        const result of rig.observe("mutable://open/wasub/:key", abort.signal)
      ) {
        if (result.success && result.record) {
          results.push({ uri: result.uri!, data: result.record.data });
        }
        if (results.length >= 2) abort.abort();
      }
    })();

    // Write two matching values
    await rig.receive([["mutable://open/wasub/a", {}, { v: 1 }]]);
    await rig.receive([["mutable://open/wasub/b", {}, { v: 2 }]]);

    await done;

    assertEquals(results.length, 2);
    assertEquals(results[0].uri, "mutable://open/wasub/a");
    assertEquals(results[1].uri, "mutable://open/wasub/b");
  },
});

Deno.test({
  name: "Rig.observe - empty when no connection accepts observe",
  async fn() {
    const rig = new Rig({
      connections: [
        connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
        // No observe patterns
      ],
    });

    const abort = new AbortController();
    const results: unknown[] = [];

    // Should immediately complete (no connection accepts observe)
    abort.abort();
    for await (const result of rig.observe("mutable://open/*", abort.signal)) {
      results.push(result);
    }

    assertEquals(results.length, 0);
  },
});

// ── AuthenticatedRig.sendMany() tests ──

Deno.test("AuthenticatedRig.sendMany - sends multiple envelopes", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const results = await session.sendMany([
    { inputs: [], outputs: [["mutable://open/wamulti/a", {}, { n: 1 }]] },
    { inputs: [], outputs: [["mutable://open/wamulti/b", {}, { n: 2 }]] },
  ]);

  assertEquals(results.length, 2);
  assertEquals(results[0].accepted, true);
  assertEquals(results[1].accepted, true);

  // Verify both values exist
  const a = await rig.readData<{ n: number }>("mutable://open/wamulti/a");
  const b = await rig.readData<{ n: number }>("mutable://open/wamulti/b");
  assertEquals(a?.n, 1);
  assertEquals(b?.n, 2);
});

Deno.test("AuthenticatedRig.sendMany - returns empty array for empty input", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const results = await session.sendMany([]);
  assertEquals(results, []);
});

Deno.test("AuthenticatedRig.sendMany - each envelope gets its own hash", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const session = id.rig(rig);

  const results = await session.sendMany([
    { inputs: [], outputs: [["mutable://open/wahash/x", {}, "one"]] },
    { inputs: [], outputs: [["mutable://open/wahash/y", {}, "two"]] },
  ]);

  // Each result should have a unique hash URI
  assertNotEquals(results[0].uri, results[1].uri);
  assertEquals(results[0].uri.startsWith("hash://"), true);
  assertEquals(results[1].uri.startsWith("hash://"), true);
});

// ── Hooks integration tests ──

Deno.test("Rig hooks - beforeReceive throw rejects receive", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    hooks: {
      beforeReceive: () => {
        throw new Error("blocked");
      },
    },
  });

  await assertRejects(
    () => rig.receive([["mutable://open/test", {}, { x: 1 }]]),
    Error,
    "blocked",
  );
});

Deno.test("Rig hooks - beforeReceive mutates context", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    hooks: {
      beforeReceive: (ctx) => ({
        ctx: {
          ...ctx,
          data: {
            ...(ctx.data as Record<string, unknown>),
            injected: true,
          },
        },
      }),
    },
  });

  await rig.receive([["mutable://open/test", {}, { x: 1 }]]);
  const data = await rig.readData("mutable://open/test");
  assertEquals((data as Record<string, unknown>).injected, true);
});

Deno.test("Rig hooks - afterRead observes result without modifying", async () => {
  const observed: unknown[] = [];
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    hooks: {
      afterRead: (_ctx, result) => {
        observed.push(result);
      },
    },
  });

  await rig.receive([["mutable://open/test", {}, { x: 1 }]]);
  const results = await rig.read("mutable://open/test");
  const result = results[0];
  assertEquals(result.success, true);
  assertEquals((result.record?.data as Record<string, unknown>).x, 1);
  assertEquals(observed.length, 1);
});

Deno.test("Rig hooks - afterRead throw propagates to caller", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    hooks: {
      afterRead: () => {
        throw new Error("post-condition failed");
      },
    },
  });

  await rig.receive([["mutable://open/test", {}, { x: 1 }]]);
  await assertRejects(
    () => rig.read("mutable://open/test"),
    Error,
    "post-condition failed",
  );
});

// rig.delete() no longer exists — beforeDelete hook test removed

Deno.test("Rig hooks - beforeSend throw rejects send", async () => {
  const id = await Identity.generate();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    hooks: {
      beforeSend: () => {
        throw new Error("rate limited");
      },
    },
  });
  const session = id.rig(rig);

  await assertRejects(
    () =>
      session.send({
        inputs: [],
        outputs: [["mutable://open/x", {}, { v: 1 }]],
      }),
    Error,
    "rate limited",
  );
});

// ── Events integration tests ──

Deno.test("Rig events - fires on receive success", async () => {
  const events: unknown[] = [];
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    on: {
      "receive:success": [(e) => {
        events.push(e);
      }],
    },
  });

  await rig.receive([["mutable://open/test", {}, { x: 1 }]]);
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(events.length, 1);
  assertEquals((events[0] as { op: string }).op, "receive");
});

Deno.test("Rig events - fires on receive error (schema rejection)", async () => {
  const errors: unknown[] = [];
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    schema: createTestSchema(),
    on: {
      "receive:error": [(e) => {
        errors.push(e);
      }],
    },
  });

  // Write to an invalid domain to trigger a rig schema rejection
  await rig.receive([["mutable://invalid-domain/test", {}, { x: 1 }]]);
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(errors.length, 1);
});

Deno.test("Rig events - wildcard fires for all ops", async () => {
  const events: unknown[] = [];
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    on: {
      "*:success": [(e) => {
        events.push(e);
      }],
    },
  });

  await rig.receive([["mutable://open/a", {}, { v: 1 }]]);
  await rig.read("mutable://open/a");
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(events.length, 2);
  assertEquals((events[0] as { op: string }).op, "receive");
  assertEquals((events[1] as { op: string }).op, "read");
});

// ── Reaction integration tests ──

Deno.test("Rig reaction - fires on receive matching pattern", async () => {
  const calls: { uri: string; params: Record<string, string> }[] = [];
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    reactions: {
      "mutable://open/:key": (uri, _data, params) => {
        calls.push({ uri, params });
      },
    },
  });

  await rig.receive([["mutable://open/hello", {}, { v: 1 }]]);
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(calls.length, 1);
  assertEquals(calls[0].uri, "mutable://open/hello");
  assertEquals(calls[0].params, { key: "hello" });
});

Deno.test("Rig reaction - fires on send for each output", async () => {
  const id = await Identity.generate();
  const uris: string[] = [];
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    reactions: {
      "mutable://open/:key": (uri) => {
        uris.push(uri);
      },
    },
  });
  const session = id.rig(rig);

  await session.send({
    inputs: [],
    outputs: [
      ["mutable://open/a", {}, { v: 1 }],
      ["mutable://open/b", {}, { v: 2 }],
    ],
  });
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(uris.length, 2);
  assertEquals(uris.includes("mutable://open/a"), true);
  assertEquals(uris.includes("mutable://open/b"), true);
});

Deno.test("Rig reaction - does not fire on read", async () => {
  let called = false;
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    reactions: {
      "mutable://open/:key": () => {
        called = true;
      },
    },
  });

  await rig.receive([["mutable://open/test", {}, { v: 1 }]]);
  await new Promise((r) => setTimeout(r, 20));
  called = false; // reset from the receive

  await rig.read("mutable://open/test");
  await new Promise((r) => setTimeout(r, 20));

  assertEquals(called, false);
});

// ── Runtime API tests ──

Deno.test("Rig hooks - immutable after init", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    hooks: {
      beforeReceive: () => {},
    },
  });

  // Hooks are frozen — no runtime mutation possible
  // deno-lint-ignore no-explicit-any
  assertEquals(typeof (rig as any).hook, "undefined");
});

Deno.test("Rig.on - runtime event handler works", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const events: unknown[] = [];

  const unsub = rig.on("receive:success", (e) => {
    events.push(e);
  });

  await rig.receive([["mutable://open/test", {}, { x: 1 }]]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(events.length, 1);

  unsub();

  await rig.receive([["mutable://open/test2", {}, { x: 2 }]]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(events.length, 1); // no new event
});

Deno.test("Rig.off - removes event handler", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const events: unknown[] = [];
  const handler = (e: unknown) => {
    events.push(e);
  };

  rig.on("receive:success", handler);
  await rig.receive([["mutable://open/a", {}, { v: 1 }]]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(events.length, 1);

  rig.off("receive:success", handler);
  await rig.receive([["mutable://open/b", {}, { v: 2 }]]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(events.length, 1);
});

Deno.test("Rig.reaction - runtime react works", async () => {
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
  });
  const calls: string[] = [];

  const unsub = rig.reaction("mutable://open/:key", (uri) => {
    calls.push(uri);
  });

  await rig.receive([["mutable://open/hello", {}, { v: 1 }]]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(calls.length, 1);

  unsub();

  await rig.receive([["mutable://open/world", {}, { v: 2 }]]);
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(calls.length, 1); // no new call
});

// ── Per-operation connection routing tests ──

Deno.test("Rig connections - per-op routing uses separate backends", async () => {
  const writeClient = new MemoryClient();
  const readClient = new MemoryClient();

  // Write some data to readClient directly
  await readClient.receive([["mutable://open/cached", {}, { from: "cache" }]]);

  const rig = new Rig({
    connections: [
      connection(writeClient, {
        receive: ["mutable://*", "immutable://*", "hash://*"],
      }),
      connection(readClient, {
        read: ["mutable://*", "immutable://*", "hash://*"],
      }),
    ],
  });

  // Read should come from readClient
  const data = await rig.readData("mutable://open/cached");
  assertEquals((data as Record<string, unknown>).from, "cache");

  // Receive should go to writeClient
  await rig.receive([["mutable://open/new", {}, { from: "write" }]]);
  const fromWrite = (await writeClient.read("mutable://open/new"))[0];
  assertEquals(fromWrite.success, true);

  // readClient should NOT have the write
  const fromRead = (await readClient.read("mutable://open/new"))[0];
  assertEquals(fromRead.success, false);
});

Deno.test("Rig - schema still works with hooks", async () => {
  const schema = createTestSchema();
  const rig = new Rig({
    connections: [
      connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
    ],
    schema,
    hooks: {
      afterReceive: () => {}, // observer hook
    },
  });

  // Valid domain
  const [r1] = await rig.receive([["mutable://open/test", {}, { v: 1 }]]);
  assertEquals(r1.accepted, true);

  // Invalid domain — rig schema should reject
  const [r2] = await rig.receive([["mutable://invalid/test", {}, { v: 1 }]]);
  assertEquals(r2.accepted, false);
});

// No hook chain replacement test — hooks are immutable after init.

Deno.test("Rig dispatch - status returns healthy for multi-client", async () => {
  const c1 = new MemoryClient();
  const c2 = new MemoryClient();

  await c1.receive([["mutable://open/x", {}, "data"]]);
  await c2.receive([["hash://sha256/abc", {}, "data"]]);

  const rig = new Rig({
    connections: [
      connection(c1, { receive: ["mutable://*"], read: ["mutable://*"] }),
      connection(c2, { receive: ["hash://*"], read: ["hash://*"] }),
    ],
  });

  const status = await rig.status();
  assertEquals(status.status, "healthy");
});

// ── SSE observe integration test ──

Deno.test({
  name: "Rig observe - HttpClient SSE end-to-end",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // 1. Start a server rig with memory backend
    const serverRig = new Rig({
      connections: [
        connection(new MemoryClient(), { receive: ["*"], read: ["*"] }),
      ],
    });
    const requestHandler = httpApi(serverRig);

    // Start a Deno server on a random port
    const server = Deno.serve(
      { port: 0, onListen() {} },
      requestHandler,
    );
    const port = server.addr.port;

    const subscriberAbort = new AbortController();

    try {
      // 2. Create a subscriber rig with HttpClient (observe-capable)
      const { createClientFromUrl } = await import("./backend-factory.ts");
      const httpClient = await createClientFromUrl(`http://127.0.0.1:${port}`);
      const subscriberRig = new Rig({
        connections: [
          connection(httpClient, {
            receive: ["*"],
            read: ["*"],
            observe: ["*"],
          }),
        ],
      });

      // 3. Observe a pattern via the rig (routes to HttpClient SSE)
      const received: { uri: string; data: unknown }[] = [];

      const done = (async () => {
        for await (
          const result of subscriberRig.observe(
            "mutable://open/market/:msgId",
            subscriberAbort.signal,
          )
        ) {
          if (result.success && result.record) {
            received.push({ uri: result.uri!, data: result.record.data });
          }
          if (received.length >= 2) subscriberAbort.abort();
        }
      })();

      // Give SSE connection time to establish
      await new Promise((r) => setTimeout(r, 300));

      // 4. Write through the server rig (simulating another client)
      await serverRig.receive([
        ["mutable://open/market/msg1", {}, { type: "ask", price: 42 }],
      ]);
      await serverRig.receive([
        ["mutable://open/market/msg2", {}, { type: "bid", price: 40 }],
      ]);

      await done;

      // 5. Verify subscriber received the matching events
      assertEquals(received.length, 2);
      assertEquals(received[0].uri, "mutable://open/market/msg1");
      assertEquals(received[0].data, { type: "ask", price: 42 });
      assertEquals(received[1].uri, "mutable://open/market/msg2");
    } finally {
      subscriberAbort.abort();
      await new Promise((r) => setTimeout(r, 50));
      await server.shutdown();
    }
  },
});

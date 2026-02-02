/**
 * Read-Multi Tests
 *
 * Tests the readMulti functionality across MemoryClient and wallet proxy.
 */

import { assertEquals, assertExists } from "@std/assert";
import { MemoryClient, createTestSchema } from "../clients/memory/mod.ts";
import { createTestEnvironment } from "../wallet/testing.ts";

Deno.test("MemoryClient.readMulti - reads multiple URIs successfully", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });

  // Write test data
  await client.receive(["mutable://data/item1", { v: 1 }]);
  await client.receive(["mutable://data/item2", { v: 2 }]);
  await client.receive(["mutable://data/item3", { v: 3 }]);

  const result = await client.readMulti([
    "mutable://data/item1",
    "mutable://data/item2",
    "mutable://data/item3",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.summary.total, 3);
  assertEquals(result.summary.succeeded, 3);
  assertEquals(result.summary.failed, 0);
  assertEquals(result.results.length, 3);

  // Check individual results
  assertEquals(result.results[0].success, true);
  if (result.results[0].success) {
    assertEquals(result.results[0].record.data, { v: 1 });
  }
  assertEquals(result.results[1].success, true);
  if (result.results[1].success) {
    assertEquals(result.results[1].record.data, { v: 2 });
  }
  assertEquals(result.results[2].success, true);
  if (result.results[2].success) {
    assertEquals(result.results[2].record.data, { v: 3 });
  }

  await client.cleanup();
});

Deno.test("MemoryClient.readMulti - partial success", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });

  // Write only some of the data
  await client.receive(["mutable://data/exists1", { ok: true }]);
  await client.receive(["mutable://data/exists2", { ok: true }]);

  const result = await client.readMulti([
    "mutable://data/exists1",
    "mutable://data/missing",
    "mutable://data/exists2",
  ]);

  assertEquals(result.success, true); // At least one succeeded
  assertEquals(result.summary.total, 3);
  assertEquals(result.summary.succeeded, 2);
  assertEquals(result.summary.failed, 1);

  assertEquals(result.results[0].success, true);
  assertEquals(result.results[1].success, false);
  assertEquals(result.results[2].success, true);

  await client.cleanup();
});

Deno.test("MemoryClient.readMulti - all fail", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });

  const result = await client.readMulti([
    "mutable://data/missing1",
    "mutable://data/missing2",
  ]);

  assertEquals(result.success, false);
  assertEquals(result.summary.total, 2);
  assertEquals(result.summary.succeeded, 0);
  assertEquals(result.summary.failed, 2);

  await client.cleanup();
});

Deno.test("MemoryClient.readMulti - exceeds batch limit", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });

  const uris = Array.from({ length: 51 }, (_, i) => `mutable://data/item${i}`);
  const result = await client.readMulti(uris);

  assertEquals(result.success, false);
  assertEquals(result.summary.total, 51);
  assertEquals(result.summary.failed, 51);
  assertEquals(result.results.length, 0);

  await client.cleanup();
});

Deno.test("MemoryClient.readMulti - empty array", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });

  const result = await client.readMulti([]);

  assertEquals(result.success, false);
  assertEquals(result.summary.total, 0);
  assertEquals(result.summary.succeeded, 0);
  assertEquals(result.summary.failed, 0);
  assertEquals(result.results.length, 0);

  await client.cleanup();
});

Deno.test("wallet.proxyReadMulti - reads multiple URIs with decryption", async () => {
  const { wallet, signupTestUser, cleanup } = await createTestEnvironment();

  await signupTestUser("test-app", "alice", "password123");

  // Write encrypted data
  const write1 = await wallet.proxyWrite({
    uri: "mutable://data/:key/item1",
    data: { v: 1, encrypted: true },
    encrypt: true,
  });
  const write2 = await wallet.proxyWrite({
    uri: "mutable://data/:key/item2",
    data: { v: 2, encrypted: true },
    encrypt: true,
  });

  assertEquals(write1.success, true);
  assertEquals(write2.success, true);

  // Read multiple
  const result = await wallet.proxyReadMulti({
    uris: ["mutable://data/:key/item1", "mutable://data/:key/item2"],
  });

  assertEquals(result.success, true);
  assertEquals(result.summary.total, 2);
  assertEquals(result.summary.succeeded, 2);

  // Check decryption
  assertExists(result.results[0].decrypted);
  assertEquals(result.results[0].decrypted, { v: 1, encrypted: true });
  assertExists(result.results[1].decrypted);
  assertEquals(result.results[1].decrypted, { v: 2, encrypted: true });

  await cleanup();
});

Deno.test("wallet.proxyReadMulti - partial success with missing items", async () => {
  const { wallet, signupTestUser, cleanup } = await createTestEnvironment();

  await signupTestUser("test-app", "bob", "password123");

  // Write only one item
  await wallet.proxyWrite({
    uri: "mutable://data/:key/exists",
    data: { found: true },
  });

  const result = await wallet.proxyReadMulti({
    uris: [
      "mutable://data/:key/exists",
      "mutable://data/:key/missing",
    ],
  });

  assertEquals(result.success, true); // At least one succeeded
  assertEquals(result.summary.succeeded, 1);
  assertEquals(result.summary.failed, 1);

  assertEquals(result.results[0].success, true);
  assertEquals(result.results[1].success, false);

  await cleanup();
});

Deno.test("wallet.proxyReadMulti - batch limit exceeded", async () => {
  const { wallet, signupTestUser, cleanup } = await createTestEnvironment();

  await signupTestUser("test-app", "charlie", "password123");

  const uris = Array.from({ length: 51 }, (_, i) => `mutable://data/:key/item${i}`);
  const result = await wallet.proxyReadMulti({ uris });

  assertEquals(result.success, false);
  assertExists(result.error);
  assertEquals(result.error, "Maximum 50 URIs per request");

  await cleanup();
});

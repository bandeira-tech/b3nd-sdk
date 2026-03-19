import { assertEquals, assertRejects } from "@std/assert";
import { createClientFromUrl } from "./backend-factory.ts";

// ── memory:// protocol ──

Deno.test("createClientFromUrl - memory:// creates MemoryClient", async () => {
  const client = await createClientFromUrl("memory://");
  const health = await client.health();
  assertEquals(health.status, "healthy");
});

Deno.test("createClientFromUrl - memory:// client supports CRUD", async () => {
  const client = await createClientFromUrl("memory://");

  // Write
  const writeResult = await client.receive([
    "mutable://open/test/doc",
    { name: "Alice" },
  ]);
  assertEquals(writeResult.accepted, true);

  // Read
  const readResult = await client.read("mutable://open/test/doc");
  assertEquals(readResult.success, true);
  assertEquals(readResult.record?.data, { name: "Alice" });

  // List
  const listResult = await client.list("mutable://open/test");
  assertEquals(listResult.success, true);
  assertEquals(listResult.data.length >= 1, true);

  // Delete
  const deleteResult = await client.delete("mutable://open/test/doc");
  assertEquals(deleteResult.success, true);

  // Verify deleted
  const readAfter = await client.read("mutable://open/test/doc");
  assertEquals(readAfter.success, false);
});

Deno.test("createClientFromUrl - memory:// accepts custom schema", async () => {
  const customSchema = {
    "mutable://custom": async () => ({ valid: true }),
  };
  const client = await createClientFromUrl("memory://", {
    schema: customSchema,
  });
  const schema = await client.getSchema();
  assertEquals(schema.includes("mutable://custom"), true);
});

// ── http:// and https:// protocols ──

Deno.test("createClientFromUrl - http:// creates HttpClient", async () => {
  const client = await createClientFromUrl("http://localhost:9999");
  // HttpClient is created but won't be healthy without a server
  assertEquals(typeof client.health, "function");
  assertEquals(typeof client.receive, "function");
  assertEquals(typeof client.read, "function");
});

Deno.test("createClientFromUrl - https:// creates HttpClient", async () => {
  const client = await createClientFromUrl("https://example.com");
  assertEquals(typeof client.health, "function");
});

// ── ws:// and wss:// protocols ──

Deno.test("createClientFromUrl - ws:// creates WebSocketClient", async () => {
  const client = await createClientFromUrl("ws://localhost:9999");
  assertEquals(typeof client.health, "function");
  assertEquals(typeof client.receive, "function");
});

Deno.test("createClientFromUrl - wss:// creates WebSocketClient", async () => {
  const client = await createClientFromUrl("wss://example.com");
  assertEquals(typeof client.health, "function");
});

// ── Unsupported protocols ──

Deno.test("createClientFromUrl - throws for unsupported protocol", async () => {
  await assertRejects(
    () => createClientFromUrl("ftp://example.com"),
    Error,
    "Unsupported backend URL protocol",
  );
});

Deno.test("createClientFromUrl - throws for unknown protocol", async () => {
  await assertRejects(
    () => createClientFromUrl("custom://data"),
    Error,
    "Unsupported backend URL protocol",
  );
});

// ── postgresql:// without executor ──

Deno.test("createClientFromUrl - postgresql:// throws without executor", async () => {
  await assertRejects(
    () => createClientFromUrl("postgresql://localhost/db"),
    Error,
    "PostgreSQL URL requires an executor factory",
  );
});

Deno.test("createClientFromUrl - postgresql:// throws without schema even with executor", async () => {
  const mockExecutor = async () => ({
    query: async () => ({ rows: [] }),
    transaction: async <T>(fn: (q: any) => Promise<T>) =>
      fn({ query: async () => ({ rows: [] }) }),
  });

  await assertRejects(
    () =>
      createClientFromUrl("postgresql://localhost/db", {
        executors: { postgres: mockExecutor as any },
      }),
    Error,
    "PostgreSQL backend requires a schema",
  );
});

// ── mongodb:// without executor ──

Deno.test("createClientFromUrl - mongodb:// throws without executor", async () => {
  await assertRejects(
    () => createClientFromUrl("mongodb://localhost/db"),
    Error,
    "MongoDB URL requires an executor factory",
  );
});

// ── memory:// cleanup ──

Deno.test("createClientFromUrl - memory:// cleanup does not throw", async () => {
  const client = await createClientFromUrl("memory://");
  await client.cleanup(); // should not throw
});

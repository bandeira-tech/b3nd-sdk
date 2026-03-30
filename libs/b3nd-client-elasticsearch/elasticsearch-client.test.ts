/**
 * ElasticsearchClient Tests
 *
 * Tests the Elasticsearch client implementation using an in-memory
 * mock executor that simulates Elasticsearch responses.
 */

/// <reference lib="deno.ns" />

import { assertEquals, assertExists } from "@std/assert";
import {
  ElasticsearchClient,
  type ElasticsearchExecutor,
} from "./mod.ts";
// ---------------------------------------------------------------------------
// Mock executor — in-memory Map simulating Elasticsearch
// ---------------------------------------------------------------------------

class MockElasticsearchExecutor implements ElasticsearchExecutor {
  /** index → (docId → document body) */
  readonly store = new Map<string, Map<string, Record<string, unknown>>>();
  private cleaned = false;

  index(
    index: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    let idx = this.store.get(index);
    if (!idx) {
      idx = new Map();
      this.store.set(index, idx);
    }
    idx.set(id, body);
    return Promise.resolve();
  }

  get(
    index: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const idx = this.store.get(index);
    if (!idx) return Promise.resolve(null);
    const doc = idx.get(id);
    return Promise.resolve(doc ?? null);
  }

  delete(index: string, id: string): Promise<void> {
    const idx = this.store.get(index);
    if (idx) idx.delete(id);
    return Promise.resolve();
  }

  search(
    index: string,
    body: Record<string, unknown>,
  ): Promise<{
    hits: Array<{ _id: string; _source: Record<string, unknown> }>;
  }> {
    const idx = this.store.get(index);
    if (!idx) return Promise.resolve({ hits: [] });

    const query = body.query as Record<string, unknown> | undefined;
    const hits: Array<{ _id: string; _source: Record<string, unknown> }> = [];

    if (query && "prefix" in query) {
      const prefixObj = query.prefix as Record<string, string>;
      const prefix = prefixObj._id;
      for (const [docId, doc] of idx) {
        if (docId.startsWith(prefix)) {
          hits.push({ _id: docId, _source: doc });
        }
      }
    } else {
      // match_all
      for (const [docId, doc] of idx) {
        hits.push({ _id: docId, _source: doc });
      }
    }

    return Promise.resolve({ hits });
  }

  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }

  cleanup(): Promise<void> {
    this.cleaned = true;
    this.store.clear();
    return Promise.resolve();
  }

  get wasCleaned(): boolean {
    return this.cleaned;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient(
  executor?: MockElasticsearchExecutor,
): { client: ElasticsearchClient; executor: MockElasticsearchExecutor } {
  const exec = executor ?? new MockElasticsearchExecutor();
  const client = new ElasticsearchClient(
    {
      indexPrefix: "b3nd",
    },
    exec,
  );
  return { client, executor: exec };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("receive + read round-trip", async () => {
  const { client } = createClient();

  const result = await client.receive([
    "mutable://accounts/alice/profile",
    { name: "Alice", age: 30 },
  ]);
  assertEquals(result.accepted, true);

  const read = await client.read("mutable://accounts/alice/profile");
  assertEquals(read.success, true);
  assertExists(read.record);
  assertEquals(read.record.data, { name: "Alice", age: 30 });
  assertEquals(typeof read.record.ts, "number");
});

Deno.test("read returns not found for missing URI", async () => {
  const { client } = createClient();

  const result = await client.read("mutable://accounts/bob/profile");
  assertEquals(result.success, false);
  assertExists(result.error);
  assertExists(result.errorDetail);
  assertEquals(result.errorDetail.code, "NOT_FOUND");
});

Deno.test("receive accepts valid data", async () => {
  const { client } = createClient();

  const result = await client.receive([
    "mutable://accounts/alice",
    { name: "Alice" },
  ]);
  assertEquals(result.accepted, true);
});

Deno.test("readMulti parallel reads", async () => {
  const { client } = createClient();

  await client.receive(["mutable://accounts/alice", { name: "Alice" }]);
  await client.receive(["mutable://accounts/bob", { name: "Bob" }]);

  const result = await client.readMulti([
    "mutable://accounts/alice",
    "mutable://accounts/bob",
    "mutable://accounts/charlie",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.summary.total, 3);
  assertEquals(result.summary.succeeded, 2);
  assertEquals(result.summary.failed, 1);

  // alice and bob found, charlie not found
  const alice = result.results.find((r) => r.uri === "mutable://accounts/alice");
  assertExists(alice);
  assertEquals(alice.success, true);

  const charlie = result.results.find(
    (r) => r.uri === "mutable://accounts/charlie",
  );
  assertExists(charlie);
  assertEquals(charlie.success, false);
});

Deno.test("readMulti empty array", async () => {
  const { client } = createClient();
  const result = await client.readMulti([]);
  assertEquals(result.success, false);
  assertEquals(result.summary.total, 0);
});

Deno.test("readMulti rejects > 50 URIs", async () => {
  const { client } = createClient();
  const uris = Array.from({ length: 51 }, (_, i) =>
    `mutable://accounts/user${i}`
  );
  const result = await client.readMulti(uris);
  assertEquals(result.success, false);
  assertEquals(result.summary.total, 51);
  assertEquals(result.summary.failed, 51);
});

Deno.test("list with prefix matching", async () => {
  const { client } = createClient();

  await client.receive(["mutable://accounts/alice/profile", { name: "Alice" }]);
  await client.receive(["mutable://accounts/alice/settings", { theme: "dark" }]);
  await client.receive(["mutable://accounts/bob/profile", { name: "Bob" }]);

  const result = await client.list("mutable://accounts/alice");
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 2);
    // Both should be alice's documents
    const uris = result.data.map((d) => d.uri).sort();
    assertEquals(uris, [
      "mutable://accounts/alice/profile",
      "mutable://accounts/alice/settings",
    ]);
  }
});

Deno.test("list with pagination", async () => {
  const { client } = createClient();

  // Create 5 items
  for (let i = 0; i < 5; i++) {
    await client.receive([
      `mutable://data/items/item${i}`,
      { value: i },
    ]);
  }

  const page1 = await client.list("mutable://data/items", {
    limit: 2,
    page: 1,
  });
  assertEquals(page1.success, true);
  if (page1.success) {
    assertEquals(page1.data.length, 2);
    assertEquals(page1.pagination.page, 1);
    assertEquals(page1.pagination.limit, 2);
    assertEquals(page1.pagination.total, 5);
  }

  const page2 = await client.list("mutable://data/items", {
    limit: 2,
    page: 2,
  });
  assertEquals(page2.success, true);
  if (page2.success) {
    assertEquals(page2.data.length, 2);
    assertEquals(page2.pagination.page, 2);
  }
});

Deno.test("list with pattern filter", async () => {
  const { client } = createClient();

  await client.receive(["mutable://accounts/alice/profile", { name: "Alice" }]);
  await client.receive(["mutable://accounts/bob/profile", { name: "Bob" }]);
  await client.receive(["mutable://accounts/alice/settings", { theme: "dark" }]);

  const result = await client.list("mutable://accounts", {
    pattern: "profile",
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 2);
    for (const item of result.data) {
      assertEquals(item.uri.includes("profile"), true);
    }
  }
});

Deno.test("delete existing document", async () => {
  const { client } = createClient();

  await client.receive(["mutable://accounts/alice", { name: "Alice" }]);
  const delResult = await client.delete("mutable://accounts/alice");
  assertEquals(delResult.success, true);

  // Verify deleted
  const read = await client.read("mutable://accounts/alice");
  assertEquals(read.success, false);
});

Deno.test("delete non-existent document returns not found", async () => {
  const { client } = createClient();

  const result = await client.delete("mutable://accounts/ghost");
  assertEquals(result.success, false);
  assertEquals(result.error, "Not found");
  assertExists(result.errorDetail);
  assertEquals(result.errorDetail.code, "NOT_FOUND");
});

Deno.test("health returns healthy when ping succeeds", async () => {
  const { client } = createClient();

  const status = await client.health();
  assertEquals(status.status, "healthy");
  assertExists(status.details);
  assertEquals(
    (status.details as Record<string, unknown>).indexPrefix,
    "b3nd",
  );
});

Deno.test("health returns unhealthy when ping fails", async () => {
  const executor = new MockElasticsearchExecutor();
  // Override ping to return false
  executor.ping = () => Promise.resolve(false);

  const { client } = createClient(executor);

  const status = await client.health();
  assertEquals(status.status, "unhealthy");
});

Deno.test("health returns unhealthy when ping throws", async () => {
  const executor = new MockElasticsearchExecutor();
  executor.ping = () => Promise.reject(new Error("Connection refused"));

  const { client } = createClient(executor);

  const status = await client.health();
  assertEquals(status.status, "unhealthy");
  assertExists(status.message);
  assertEquals(status.message.includes("Connection refused"), true);
});

Deno.test("getSchema returns schema keys", async () => {
  const { client } = createClient();

  const keys = await client.getSchema();
  assertEquals(keys, []);
});

Deno.test("cleanup delegates to executor", async () => {
  const executor = new MockElasticsearchExecutor();
  const { client } = createClient(executor);

  assertEquals(executor.wasCleaned, false);
  await client.cleanup();
  assertEquals(executor.wasCleaned, true);
});

Deno.test("indexPrefix mapping is correct", async () => {
  const executor = new MockElasticsearchExecutor();
  const { client } = createClient(executor);

  await client.receive([
    "mutable://accounts/alice/profile",
    { name: "Alice" },
  ]);

  // Verify the index name in the executor store
  const idx = executor.store.get("b3nd_mutable_accounts");
  assertExists(idx);
  const doc = idx.get("alice/profile");
  assertExists(doc);
  assertEquals((doc as Record<string, unknown>).data, { name: "Alice" });
});

Deno.test("binary encoding round-trip", async () => {
  const { client } = createClient();
  const binaryData = new Uint8Array([1, 2, 3, 4, 5]);

  const result = await client.receive([
    "mutable://data/binary-test",
    binaryData,
  ]);
  assertEquals(result.accepted, true);

  const read = await client.read<Uint8Array>("mutable://data/binary-test");
  assertEquals(read.success, true);
  assertExists(read.record);
  assertEquals(read.record.data instanceof Uint8Array, true);
  assertEquals(read.record.data, binaryData);
});

Deno.test("receive handles executor errors gracefully", async () => {
  const executor = new MockElasticsearchExecutor();
  executor.index = () => Promise.reject(new Error("ES index failed"));

  const { client } = createClient(executor);

  const result = await client.receive([
    "mutable://accounts/alice",
    { name: "Alice" },
  ]);
  assertEquals(result.accepted, false);
  assertExists(result.error);
  assertEquals(result.error.includes("ES index failed"), true);
  assertExists(result.errorDetail);
  assertEquals(result.errorDetail.code, "STORAGE_ERROR");
});

Deno.test("read handles executor errors gracefully", async () => {
  const executor = new MockElasticsearchExecutor();
  executor.get = () => Promise.reject(new Error("ES get failed"));

  const { client } = createClient(executor);

  const result = await client.read("mutable://accounts/alice");
  assertEquals(result.success, false);
  assertExists(result.error);
  assertEquals(result.error.includes("ES get failed"), true);
});

Deno.test("constructor requires executor", () => {
  let threw = false;
  try {
    new ElasticsearchClient(
      {
        indexPrefix: "b3nd",
      },
      // deno-lint-ignore no-explicit-any
      undefined as any,
    );
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, "executor is required");
  }
  assertEquals(threw, true);
});

Deno.test("receive overwrites existing document (upsert)", async () => {
  const { client } = createClient();

  await client.receive(["mutable://accounts/alice", { v: 1 }]);
  await client.receive(["mutable://accounts/alice", { v: 2 }]);

  const read = await client.read("mutable://accounts/alice");
  assertEquals(read.success, true);
  assertExists(read.record);
  assertEquals(read.record.data, { v: 2 });
});

Deno.test("list sort order desc", async () => {
  const { client } = createClient();

  await client.receive(["mutable://data/items/a", { v: 1 }]);
  await client.receive(["mutable://data/items/b", { v: 2 }]);
  await client.receive(["mutable://data/items/c", { v: 3 }]);

  const result = await client.list("mutable://data/items", {
    sortOrder: "desc",
  });
  assertEquals(result.success, true);
  if (result.success) {
    const uris = result.data.map((d) => d.uri);
    assertEquals(uris, [
      "mutable://data/items/c",
      "mutable://data/items/b",
      "mutable://data/items/a",
    ]);
  }
});

/**
 * ElasticsearchClient Tests
 *
 * Tests the Elasticsearch client implementation using an in-memory
 * mock executor that simulates Elasticsearch responses.
 */

/// <reference lib="deno.ns" />

import { assertEquals, assertExists } from "@std/assert";
import { ElasticsearchClient, type ElasticsearchExecutor } from "./mod.ts";
// ---------------------------------------------------------------------------
// Mock executor — in-memory Map simulating Elasticsearch
// ---------------------------------------------------------------------------

class MockElasticsearchExecutor implements ElasticsearchExecutor {
  /** index → (docId → document body) */
  readonly store = new Map<string, Map<string, Record<string, unknown>>>();

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
    ["mutable://accounts/alice/profile", {}, { name: "Alice", age: 30 }],
  ]);
  assertEquals(result[0].accepted, true);

  const results = await client.read("mutable://accounts/alice/profile");
  assertEquals(results.length, 1);
  assertEquals(results[0].success, true);
  assertExists(results[0].record);
  assertEquals(results[0].record.data, { name: "Alice", age: 30 });
  assertEquals(typeof results[0].record.values, "object");
});

Deno.test("read returns not found for missing URI", async () => {
  const { client } = createClient();

  const results = await client.read("mutable://accounts/bob/profile");
  assertEquals(results.length, 1);
  assertEquals(results[0].success, false);
  assertExists(results[0].error);
});

Deno.test("receive accepts valid data", async () => {
  const { client } = createClient();

  const result = await client.receive([
    ["mutable://accounts/alice", {}, { name: "Alice" }],
  ]);
  assertEquals(result[0].accepted, true);
});

Deno.test("read multiple URIs", async () => {
  const { client } = createClient();

  await client.receive([["mutable://accounts/alice", {}, { name: "Alice" }]]);
  await client.receive([["mutable://accounts/bob", {}, { name: "Bob" }]]);

  const results = await client.read([
    "mutable://accounts/alice",
    "mutable://accounts/bob",
    "mutable://accounts/charlie",
  ]);

  assertEquals(results.length, 3);

  // alice and bob found, charlie not found
  const alice = results.find((r) => r.uri === "mutable://accounts/alice");
  assertExists(alice);
  assertEquals(alice.success, true);

  const charlie = results.find(
    (r) => r.uri === "mutable://accounts/charlie",
  );
  assertExists(charlie);
  assertEquals(charlie.success, false);
});

Deno.test("read with trailing slash lists children", async () => {
  const { client } = createClient();

  await client.receive([["mutable://accounts/alice/profile", {}, { name: "Alice" }]]);
  await client.receive([["mutable://accounts/alice/settings", {}, {
    theme: "dark",
  }]]);
  await client.receive([["mutable://accounts/bob/profile", {}, { name: "Bob" }]]);

  const results = await client.read("mutable://accounts/alice/");
  assertEquals(results.length, 2);
  // Both should be alice's documents
  const uris = results.map((d) => d.uri).sort();
  assertEquals(uris, [
    "mutable://accounts/alice/profile",
    "mutable://accounts/alice/settings",
  ]);
});

Deno.test("status returns healthy when ping succeeds", async () => {
  const { client } = createClient();

  const result = await client.status();
  assertEquals(result.status, "healthy");
  assertExists(result.details);
  assertEquals(
    (result.details as Record<string, unknown>).indexPrefix,
    "b3nd",
  );
});

Deno.test("status returns unhealthy when ping fails", async () => {
  const executor = new MockElasticsearchExecutor();
  // Override ping to return false
  executor.ping = () => Promise.resolve(false);

  const { client } = createClient(executor);

  const result = await client.status();
  assertEquals(result.status, "unhealthy");
});

Deno.test("status returns unhealthy when ping throws", async () => {
  const executor = new MockElasticsearchExecutor();
  executor.ping = () => Promise.reject(new Error("Connection refused"));

  const { client } = createClient(executor);

  const result = await client.status();
  assertEquals(result.status, "unhealthy");
  assertExists(result.message);
  assertEquals(result.message!.includes("Connection refused"), true);
});

Deno.test("indexPrefix mapping is correct", async () => {
  const executor = new MockElasticsearchExecutor();
  const { client } = createClient(executor);

  await client.receive([
    ["mutable://accounts/alice/profile", {}, { name: "Alice" }],
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
    ["mutable://data/binary-test", {}, binaryData],
  ]);
  assertEquals(result[0].accepted, true);

  const results = await client.read<Uint8Array>("mutable://data/binary-test");
  assertEquals(results.length, 1);
  assertEquals(results[0].success, true);
  assertExists(results[0].record);
  assertEquals(results[0].record.data instanceof Uint8Array, true);
  assertEquals(results[0].record.data, binaryData);
});

Deno.test("receive handles executor errors gracefully", async () => {
  const executor = new MockElasticsearchExecutor();
  executor.index = () => Promise.reject(new Error("ES index failed"));

  const { client } = createClient(executor);

  const result = await client.receive([
    ["mutable://accounts/alice", {}, { name: "Alice" }],
  ]);
  assertEquals(result[0].accepted, false);
  assertExists(result[0].error);
  assertEquals(result[0].error!.includes("ES index failed"), true);
});

Deno.test("read handles executor errors gracefully", async () => {
  const executor = new MockElasticsearchExecutor();
  executor.get = () => Promise.reject(new Error("ES get failed"));

  const { client } = createClient(executor);

  const results = await client.read("mutable://accounts/alice");
  assertEquals(results.length, 1);
  assertEquals(results[0].success, false);
  assertExists(results[0].error);
  assertEquals(results[0].error!.includes("ES get failed"), true);
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

  await client.receive([["mutable://accounts/alice", {}, { v: 1 }]]);
  await client.receive([["mutable://accounts/alice", {}, { v: 2 }]]);

  const results = await client.read("mutable://accounts/alice");
  assertEquals(results.length, 1);
  assertEquals(results[0].success, true);
  assertExists(results[0].record);
  assertEquals(results[0].record.data, { v: 2 });
});

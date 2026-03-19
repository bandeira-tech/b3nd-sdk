/**
 * FunctionalClient test suite
 *
 * Tests that FunctionalClient correctly delegates to config functions
 * and returns sensible defaults when methods are not provided.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { FunctionalClient } from "./functional-client.ts";
import type { ListItem, Message, ReadResult } from "./types.ts";

// ── Default behavior (no config) ─────────────────────────────────────

Deno.test("FunctionalClient: receive returns not implemented by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.receive(["mutable://test", { hello: "world" }]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "not implemented");
});

Deno.test("FunctionalClient: read returns not implemented by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.read("mutable://test");
  assertEquals(result.success, false);
  assertEquals(result.error, "not implemented");
});

Deno.test("FunctionalClient: list returns empty by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.list("mutable://");
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data, []);
    assertEquals(result.pagination, { page: 1, limit: 50, total: 0 });
  }
});

Deno.test("FunctionalClient: delete returns not implemented by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.delete("mutable://test");
  assertEquals(result.success, false);
  assertEquals(result.error, "not implemented");
});

Deno.test("FunctionalClient: health returns healthy by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.health();
  assertEquals(result.status, "healthy");
});

Deno.test("FunctionalClient: getSchema returns empty array by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.getSchema();
  assertEquals(result, []);
});

Deno.test("FunctionalClient: cleanup is no-op by default", async () => {
  const client = new FunctionalClient({});
  await client.cleanup(); // should not throw
});

// ── Custom config delegation ─────────────────────────────────────────

Deno.test("FunctionalClient: receive delegates to config function", async () => {
  const received: Message[] = [];
  const client = new FunctionalClient({
    receive: async (msg) => {
      received.push(msg);
      return { accepted: true };
    },
  });

  const result = await client.receive(["mutable://test", { data: 1 }]);
  assertEquals(result.accepted, true);
  assertEquals(received.length, 1);
});

Deno.test("FunctionalClient: read delegates to config function", async () => {
  const store: Record<string, unknown> = {
    "mutable://users/alice": { name: "Alice" },
  };

  const client = new FunctionalClient({
    read: async <T>(uri: string): Promise<ReadResult<T>> => {
      if (uri in store) {
        return {
          success: true,
          record: { data: store[uri] as T, ts: Date.now() },
        };
      }
      return { success: false, error: "not found" };
    },
  });

  const found = await client.read("mutable://users/alice");
  assertEquals(found.success, true);
  assertEquals(found.record?.data, { name: "Alice" });

  const notFound = await client.read("mutable://users/bob");
  assertEquals(notFound.success, false);
});

Deno.test("FunctionalClient: list delegates to config function", async () => {
  const items: ListItem[] = [{ uri: "mutable://a" }, { uri: "mutable://b" }];
  const client = new FunctionalClient({
    list: async (_uri, options) => ({
      success: true as const,
      data: items,
      pagination: {
        page: options?.page ?? 1,
        limit: options?.limit ?? 50,
        total: 2,
      },
    }),
  });

  const result = await client.list("mutable://", { page: 1, limit: 10 });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 2);
    assertEquals(result.pagination.limit, 10);
  }
});

Deno.test("FunctionalClient: delete delegates to config function", async () => {
  let deletedUri = "";
  const client = new FunctionalClient({
    delete: async (uri) => {
      deletedUri = uri;
      return { success: true };
    },
  });

  const result = await client.delete("mutable://test/item");
  assertEquals(result.success, true);
  assertEquals(deletedUri, "mutable://test/item");
});

Deno.test("FunctionalClient: health delegates to config function", async () => {
  const client = new FunctionalClient({
    health: async () => ({ status: "degraded" as const }),
  });

  const result = await client.health();
  assertEquals(result.status, "degraded");
});

Deno.test("FunctionalClient: getSchema delegates to config function", async () => {
  const client = new FunctionalClient({
    getSchema: async () => ["mutable://", "immutable://"],
  });

  const result = await client.getSchema();
  assertEquals(result, ["mutable://", "immutable://"]);
});

Deno.test("FunctionalClient: cleanup delegates to config function", async () => {
  let cleaned = false;
  const client = new FunctionalClient({
    cleanup: async () => {
      cleaned = true;
    },
  });

  await client.cleanup();
  assertEquals(cleaned, true);
});

// ── readMulti ────────────────────────────────────────────────────────

Deno.test("FunctionalClient: readMulti with custom implementation", async () => {
  const client = new FunctionalClient({
    readMulti: async <T = unknown>(uris: string[]) => ({
      success: true,
      results: uris.map((uri) => ({
        uri,
        success: true as const,
        record: { data: `data-for-${uri}` as T, ts: Date.now() },
      })),
      summary: { total: uris.length, succeeded: uris.length, failed: 0 },
    }),
  });

  const result = await client.readMulti(["mutable://a", "mutable://b"]);
  assertEquals(result.success, true);
  assertEquals(result.results.length, 2);
  assertEquals(result.summary.succeeded, 2);
  assertEquals(result.summary.failed, 0);
});

Deno.test("FunctionalClient: readMulti auto-derives from read", async () => {
  const store: Record<string, string> = {
    "mutable://a": "alpha",
    "mutable://c": "charlie",
  };

  const client = new FunctionalClient({
    read: async <T>(uri: string): Promise<ReadResult<T>> => {
      if (uri in store) {
        return {
          success: true,
          record: { data: store[uri] as T, ts: Date.now() },
        };
      }
      return { success: false, error: "not found" };
    },
  });

  const result = await client.readMulti([
    "mutable://a",
    "mutable://b",
    "mutable://c",
  ]);
  assertEquals(result.success, true);
  assertEquals(result.summary.total, 3);
  assertEquals(result.summary.succeeded, 2);
  assertEquals(result.summary.failed, 1);
  assertEquals(result.results[0].success, true);
  assertEquals(result.results[1].success, false);
  assertEquals(result.results[2].success, true);
});

Deno.test("FunctionalClient: readMulti with empty array", async () => {
  const client = new FunctionalClient({});
  const result = await client.readMulti([]);
  assertEquals(result.success, false);
  assertEquals(result.results.length, 0);
  assertEquals(result.summary.total, 0);
});

Deno.test("FunctionalClient: readMulti with all failures", async () => {
  const client = new FunctionalClient({
    read: async <T>(_uri: string): Promise<ReadResult<T>> => ({
      success: false,
      error: "not found",
    }),
  });

  const result = await client.readMulti(["mutable://a", "mutable://b"]);
  assertEquals(result.success, false);
  assertEquals(result.summary.succeeded, 0);
  assertEquals(result.summary.failed, 2);
});

// ── Partial config ───────────────────────────────────────────────────

Deno.test("FunctionalClient: partial config - only receive and read", async () => {
  const data: Record<string, unknown> = {};

  const client = new FunctionalClient({
    receive: async (msg) => {
      const [uri, value] = msg as [string, unknown];
      data[uri] = value;
      return { accepted: true };
    },
    read: async <T>(uri: string): Promise<ReadResult<T>> => {
      if (uri in data) {
        return {
          success: true,
          record: { data: data[uri] as T, ts: Date.now() },
        };
      }
      return { success: false, error: "not found" };
    },
  });

  // receive works
  const writeResult = await client.receive(["mutable://test", { v: 1 }]);
  assertEquals(writeResult.accepted, true);

  // read works
  const readResult = await client.read("mutable://test");
  assertEquals(readResult.success, true);

  // delete falls back to default
  const deleteResult = await client.delete("mutable://test");
  assertEquals(deleteResult.success, false);
  assertEquals(deleteResult.error, "not implemented");

  // list falls back to default
  const listResult = await client.list("mutable://");
  assertEquals(listResult.success, true);
  if (listResult.success) {
    assertEquals(listResult.data, []);
  }
});

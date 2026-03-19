/**
 * FunctionalClient Test Suite
 *
 * Tests for the FunctionalClient class which delegates NPI methods
 * to config functions, with sensible defaults for missing methods.
 */

import { assertEquals } from "@std/assert";
import { FunctionalClient } from "./functional-client.ts";
import type {
  Message,
  ReadMultiResult,
  ReadResult,
  ReceiveResult,
} from "./types.ts";

// ============================================================================
// Default behavior (no config functions provided)
// ============================================================================

Deno.test("FunctionalClient - receive defaults to not-implemented", async () => {
  const client = new FunctionalClient({});
  const result = await client.receive(["mutable://test", { hello: "world" }]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "not implemented");
});

Deno.test("FunctionalClient - read defaults to not-implemented", async () => {
  const client = new FunctionalClient({});
  const result = await client.read("mutable://test");
  assertEquals(result.success, false);
  assertEquals(result.error, "not implemented");
});

Deno.test("FunctionalClient - list defaults to empty array", async () => {
  const client = new FunctionalClient({});
  const result = await client.list("mutable://test/");
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data, []);
    assertEquals(result.pagination.page, 1);
    assertEquals(result.pagination.limit, 50);
    assertEquals(result.pagination.total, 0);
  }
});

Deno.test("FunctionalClient - delete defaults to not-implemented", async () => {
  const client = new FunctionalClient({});
  const result = await client.delete("mutable://test");
  assertEquals(result.success, false);
  assertEquals(result.error, "not implemented");
});

Deno.test("FunctionalClient - health defaults to healthy", async () => {
  const client = new FunctionalClient({});
  const result = await client.health();
  assertEquals(result.status, "healthy");
});

Deno.test("FunctionalClient - getSchema defaults to empty array", async () => {
  const client = new FunctionalClient({});
  const result = await client.getSchema();
  assertEquals(result, []);
});

Deno.test("FunctionalClient - cleanup defaults to no-op", async () => {
  const client = new FunctionalClient({});
  // Should not throw
  await client.cleanup();
});

// ============================================================================
// Custom config functions
// ============================================================================

Deno.test("FunctionalClient - custom receive is called", async () => {
  const calls: Message[] = [];
  const client = new FunctionalClient({
    receive: async (msg) => {
      calls.push(msg);
      return { accepted: true };
    },
  });

  const msg: Message = ["mutable://users/alice", { name: "Alice" }];
  const result = await client.receive(msg);
  assertEquals(result.accepted, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0], msg);
});

Deno.test("FunctionalClient - custom read is called", async () => {
  const client = new FunctionalClient({
    read: async <T = unknown>(uri: string): Promise<ReadResult<T>> => ({
      success: true,
      record: { ts: 1000, data: { name: "Alice" } as T },
    }),
  });

  const result = await client.read("mutable://users/alice");
  assertEquals(result.success, true);
  assertEquals(result.record?.data, { name: "Alice" });
  assertEquals(result.record?.ts, 1000);
});

Deno.test("FunctionalClient - custom list is called with options", async () => {
  const client = new FunctionalClient({
    list: async (uri, options) => ({
      success: true,
      data: [{ uri: "mutable://items/1" }, { uri: "mutable://items/2" }],
      pagination: {
        page: options?.page ?? 1,
        limit: options?.limit ?? 10,
        total: 2,
      },
    }),
  });

  const result = await client.list("mutable://items/", { page: 1, limit: 10 });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 2);
  }
});

Deno.test("FunctionalClient - custom delete is called", async () => {
  let deletedUri = "";
  const client = new FunctionalClient({
    delete: async (uri) => {
      deletedUri = uri;
      return { success: true };
    },
  });

  const result = await client.delete("mutable://temp/file");
  assertEquals(result.success, true);
  assertEquals(deletedUri, "mutable://temp/file");
});

Deno.test("FunctionalClient - custom health is called", async () => {
  const client = new FunctionalClient({
    health: async () => ({
      status: "degraded",
      message: "high latency",
    }),
  });

  const result = await client.health();
  assertEquals(result.status, "degraded");
  assertEquals(result.message, "high latency");
});

Deno.test("FunctionalClient - custom getSchema is called", async () => {
  const client = new FunctionalClient({
    getSchema: async () => ["mutable://accounts", "immutable://open"],
  });

  const result = await client.getSchema();
  assertEquals(result, ["mutable://accounts", "immutable://open"]);
});

Deno.test("FunctionalClient - custom cleanup is called", async () => {
  let cleaned = false;
  const client = new FunctionalClient({
    cleanup: async () => {
      cleaned = true;
    },
  });

  await client.cleanup();
  assertEquals(cleaned, true);
});

// ============================================================================
// readMulti behavior
// ============================================================================

Deno.test("FunctionalClient - readMulti with custom implementation", async () => {
  const client = new FunctionalClient({
    readMulti: async <T = unknown>(
      uris: string[],
    ): Promise<ReadMultiResult<T>> => ({
      success: true,
      results: uris.map((uri) => ({
        uri,
        success: true as const,
        record: { ts: Date.now(), data: `data-for-${uri}` as T },
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

Deno.test("FunctionalClient - readMulti auto-derives from read", async () => {
  const store: Record<string, unknown> = {
    "mutable://a": "alpha",
    "mutable://b": "beta",
  };

  const client = new FunctionalClient({
    read: async <T = unknown>(uri: string): Promise<ReadResult<T>> => {
      if (uri in store) {
        return { success: true, record: { ts: 1, data: store[uri] as T } };
      }
      return { success: false, error: "not found" };
    },
  });

  const result = await client.readMulti([
    "mutable://a",
    "mutable://b",
    "mutable://missing",
  ]);

  assertEquals(result.success, true); // at least one succeeded
  assertEquals(result.summary.total, 3);
  assertEquals(result.summary.succeeded, 2);
  assertEquals(result.summary.failed, 1);

  // Check individual results
  assertEquals(result.results[0].success, true);
  assertEquals(result.results[1].success, true);
  assertEquals(result.results[2].success, false);
});

Deno.test("FunctionalClient - readMulti with empty array", async () => {
  const client = new FunctionalClient({});
  const result = await client.readMulti([]);
  assertEquals(result.success, false);
  assertEquals(result.results.length, 0);
  assertEquals(result.summary.total, 0);
});

Deno.test("FunctionalClient - readMulti with all failures", async () => {
  const client = new FunctionalClient({
    read: async <T = unknown>(): Promise<ReadResult<T>> => ({
      success: false,
      error: "not found",
    }),
  });

  const result = await client.readMulti(["mutable://x", "mutable://y"]);
  assertEquals(result.success, false); // no successes
  assertEquals(result.summary.succeeded, 0);
  assertEquals(result.summary.failed, 2);
});

// ============================================================================
// Integration: in-memory store via FunctionalClient
// ============================================================================

Deno.test("FunctionalClient - works as in-memory store", async () => {
  const store = new Map<string, { ts: number; data: unknown }>();

  const client = new FunctionalClient({
    receive: async (msg) => {
      const [uri, data] = msg;
      store.set(uri, { ts: Date.now(), data });
      return { accepted: true };
    },
    read: async <T = unknown>(uri: string): Promise<ReadResult<T>> => {
      const record = store.get(uri);
      if (!record) return { success: false, error: "not found" };
      return { success: true, record: record as { ts: number; data: T } };
    },
    delete: async (uri) => {
      const existed = store.delete(uri);
      return { success: existed };
    },
    list: async (prefix) => {
      const items = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((uri) => ({ uri }));
      return {
        success: true,
        data: items,
        pagination: { page: 1, limit: 50, total: items.length },
      };
    },
  });

  // Write
  const writeResult = await client.receive([
    "mutable://users/alice",
    { name: "Alice" },
  ]);
  assertEquals(writeResult.accepted, true);

  // Read
  const readResult = await client.read("mutable://users/alice");
  assertEquals(readResult.success, true);
  assertEquals(readResult.record?.data, { name: "Alice" });

  // List
  const listResult = await client.list("mutable://users/");
  assertEquals(listResult.success, true);
  if (listResult.success) {
    assertEquals(listResult.data.length, 1);
    assertEquals(listResult.data[0].uri, "mutable://users/alice");
  }

  // Delete
  const deleteResult = await client.delete("mutable://users/alice");
  assertEquals(deleteResult.success, true);

  // Read after delete
  const afterDelete = await client.read("mutable://users/alice");
  assertEquals(afterDelete.success, false);
});

/**
 * FunctionalClient Test Suite
 *
 * Tests for FunctionalClient — a delegate-style NodeProtocolInterface
 * that wires up custom behavior via config functions.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { FunctionalClient } from "./functional-client.ts";
import type {
  DeleteResult,
  HealthStatus,
  ListResult,
  Message,
  ReadMultiResult,
  ReadResult,
  ReceiveResult,
} from "./types.ts";

// ============================================================================
// Default Behavior (no config provided)
// ============================================================================

Deno.test("FunctionalClient — receive returns not-implemented by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.receive({ uri: "mutable://test", data: {} });
  assertEquals(result.accepted, false);
  assertEquals(result.error, "not implemented");
});

Deno.test("FunctionalClient — read returns not-implemented by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.read("mutable://test");
  assertEquals(result.success, false);
  assertEquals(result.error, "not implemented");
});

Deno.test("FunctionalClient — list returns empty by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.list("mutable://test/");
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data, []);
    assertEquals(result.pagination, { page: 1, limit: 50, total: 0 });
  }
});

Deno.test("FunctionalClient — delete returns not-implemented by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.delete("mutable://test");
  assertEquals(result.success, false);
  assertEquals(result.error, "not implemented");
});

Deno.test("FunctionalClient — health returns healthy by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.health();
  assertEquals(result.status, "healthy");
});

Deno.test("FunctionalClient — getSchema returns empty array by default", async () => {
  const client = new FunctionalClient({});
  const result = await client.getSchema();
  assertEquals(result, []);
});

Deno.test("FunctionalClient — cleanup is a no-op by default", async () => {
  const client = new FunctionalClient({});
  // Should not throw
  await client.cleanup();
});

// ============================================================================
// Custom Config Delegates
// ============================================================================

Deno.test("FunctionalClient — receive delegates to config function", async () => {
  const calls: Message[] = [];
  const client = new FunctionalClient({
    receive: async (msg) => {
      calls.push(msg as Message);
      return { accepted: true, uri: msg.uri };
    },
  });

  const msg: Message = {
    uri: "mutable://users/alice",
    data: { name: "Alice" },
  };
  const result = await client.receive(msg);

  assertEquals(result.accepted, true);
  assertEquals(result.uri, "mutable://users/alice");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].uri, "mutable://users/alice");
});

Deno.test("FunctionalClient — read delegates to config function", async () => {
  const client = new FunctionalClient({
    read: async (uri) => ({
      success: true,
      record: { ts: 1000, data: { name: "Alice" } },
    }),
  });

  const result = await client.read("mutable://users/alice");
  assertEquals(result.success, true);
  assertEquals(result.record?.data, { name: "Alice" });
  assertEquals(result.record?.ts, 1000);
});

Deno.test("FunctionalClient — list delegates to config function", async () => {
  const client = new FunctionalClient({
    list: async (uri, options) => ({
      success: true,
      data: [{ uri: "mutable://users/alice" }, { uri: "mutable://users/bob" }],
      pagination: {
        page: options?.page ?? 1,
        limit: options?.limit ?? 50,
        total: 2,
      },
    }),
  });

  const result = await client.list("mutable://users/", { page: 1, limit: 10 });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 2);
    assertEquals(result.pagination.limit, 10);
  }
});

Deno.test("FunctionalClient — delete delegates to config function", async () => {
  const deleted: string[] = [];
  const client = new FunctionalClient({
    delete: async (uri) => {
      deleted.push(uri);
      return { success: true };
    },
  });

  const result = await client.delete("mutable://users/alice");
  assertEquals(result.success, true);
  assertEquals(deleted, ["mutable://users/alice"]);
});

Deno.test("FunctionalClient — health delegates to config function", async () => {
  const client = new FunctionalClient({
    health: async () => ({ status: "degraded" as const }),
  });

  const result = await client.health();
  assertEquals(result.status, "degraded");
});

Deno.test("FunctionalClient — getSchema delegates to config function", async () => {
  const client = new FunctionalClient({
    getSchema: async () => ["mutable://", "content://"],
  });

  const result = await client.getSchema();
  assertEquals(result, ["mutable://", "content://"]);
});

Deno.test("FunctionalClient — cleanup delegates to config function", async () => {
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
// readMulti — Auto-derived from read
// ============================================================================

Deno.test("FunctionalClient — readMulti auto-derives from read when not provided", async () => {
  const store: Record<string, unknown> = {
    "mutable://users/alice": { name: "Alice" },
    "mutable://users/bob": { name: "Bob" },
  };

  const client = new FunctionalClient({
    read: async (uri) => {
      const data = store[uri];
      if (data) {
        return { success: true, record: { ts: Date.now(), data } };
      }
      return { success: false, error: "not found" };
    },
  });

  const result = await client.readMulti([
    "mutable://users/alice",
    "mutable://users/bob",
    "mutable://users/charlie",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.results.length, 3);
  assertEquals(result.summary.total, 3);
  assertEquals(result.summary.succeeded, 2);
  assertEquals(result.summary.failed, 1);

  // Check individual results
  assertEquals(result.results[0].success, true);
  assertEquals(result.results[1].success, true);
  assertEquals(result.results[2].success, false);
  if (result.results[2].success === false) {
    assertEquals(result.results[2].error, "not found");
  }
});

Deno.test("FunctionalClient — readMulti returns success:false for empty array", async () => {
  const client = new FunctionalClient({});
  const result = await client.readMulti([]);
  assertEquals(result.success, false);
  assertEquals(result.results, []);
  assertEquals(result.summary, { total: 0, succeeded: 0, failed: 0 });
});

Deno.test("FunctionalClient — readMulti uses custom implementation when provided", async () => {
  let customCalled = false;
  const client = new FunctionalClient({
    readMulti: async (uris) => {
      customCalled = true;
      return {
        success: true,
        results: uris.map((uri) => ({
          uri,
          success: true as const,
          record: { ts: 1, data: "batch" },
        })),
        summary: { total: uris.length, succeeded: uris.length, failed: 0 },
      };
    },
    read: async () => {
      throw new Error("should not be called");
    },
  });

  const result = await client.readMulti(["mutable://a", "mutable://b"]);
  assertEquals(customCalled, true);
  assertEquals(result.summary.succeeded, 2);
});

Deno.test("FunctionalClient — readMulti auto-derive with all failures returns success:false", async () => {
  const client = new FunctionalClient({
    read: async () => ({ success: false, error: "gone" }),
  });

  const result = await client.readMulti(["mutable://a", "mutable://b"]);
  assertEquals(result.success, false);
  assertEquals(result.summary.succeeded, 0);
  assertEquals(result.summary.failed, 2);
});

// ============================================================================
// Partial Config — Mix of provided and default methods
// ============================================================================

Deno.test("FunctionalClient — partial config: only receive and read", async () => {
  const client = new FunctionalClient({
    receive: async (msg) => ({ accepted: true, uri: msg.uri }),
    read: async (uri) => ({
      success: true,
      record: { ts: 1, data: uri },
    }),
  });

  // Configured methods work
  const receiveResult = await client.receive({
    uri: "mutable://x",
    data: null,
  });
  assertEquals(receiveResult.accepted, true);

  const readResult = await client.read("mutable://x");
  assertEquals(readResult.success, true);

  // Unconfigured methods return defaults
  const listResult = await client.list("mutable://");
  assertEquals(listResult.success, true);
  if (listResult.success) assertEquals(listResult.data, []);

  const deleteResult = await client.delete("mutable://x");
  assertEquals(deleteResult.success, false);

  const healthResult = await client.health();
  assertEquals(healthResult.status, "healthy");
});

// ============================================================================
// Interface Compliance
// ============================================================================

Deno.test("FunctionalClient — implements NodeProtocolInterface shape", () => {
  const client = new FunctionalClient({});
  // Verify all required methods exist
  assertEquals(typeof client.receive, "function");
  assertEquals(typeof client.read, "function");
  assertEquals(typeof client.readMulti, "function");
  assertEquals(typeof client.list, "function");
  assertEquals(typeof client.delete, "function");
  assertEquals(typeof client.health, "function");
  assertEquals(typeof client.getSchema, "function");
  assertEquals(typeof client.cleanup, "function");
});

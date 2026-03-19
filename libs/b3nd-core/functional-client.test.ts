import { assertEquals, assertRejects } from "@std/assert";
import { FunctionalClient } from "./functional-client.ts";
import type { Message, ReceiveResult } from "./types.ts";

// ── Constructor & defaults ──

Deno.test("FunctionalClient - empty config returns sensible defaults", async () => {
  const client = new FunctionalClient({});

  const health = await client.health();
  assertEquals(health.status, "healthy");

  const schema = await client.getSchema();
  assertEquals(schema, []);

  const read = await client.read("mutable://test/x");
  assertEquals(read.success, false);
  assertEquals(read.error, "not implemented");

  const receive = await client.receive(["mutable://test/x", { a: 1 }]);
  assertEquals(receive.accepted, false);
  assertEquals(receive.error, "not implemented");

  const del = await client.delete("mutable://test/x");
  assertEquals(del.success, false);
  assertEquals(del.error, "not implemented");

  const list = await client.list("mutable://test");
  assertEquals(list.success, true);
  assertEquals(list.data, []);
  assertEquals(list.pagination, { page: 1, limit: 50, total: 0 });
});

Deno.test("FunctionalClient - cleanup is no-op by default", async () => {
  const client = new FunctionalClient({});
  await client.cleanup(); // should not throw
});

// ── Custom implementations ──

Deno.test("FunctionalClient - receive delegates to config", async () => {
  const received: Message[] = [];
  const client = new FunctionalClient({
    receive: async (msg) => {
      received.push(msg);
      return { accepted: true, uri: msg[0] };
    },
  });

  const result = await client.receive(["mutable://test/doc", {
    name: "Alice",
  }]);
  assertEquals(result.accepted, true);
  assertEquals(result.uri, "mutable://test/doc");
  assertEquals(received.length, 1);
  assertEquals(received[0][1], { name: "Alice" });
});

Deno.test("FunctionalClient - read delegates to config", async () => {
  const client = new FunctionalClient({
    read: async (uri) => ({
      success: true,
      record: { ts: 1000, data: { uri, found: true } },
    }),
  });

  const result = await client.read("mutable://test/doc");
  assertEquals(result.success, true);
  assertEquals(result.record?.data, { uri: "mutable://test/doc", found: true });
  assertEquals(result.record?.ts, 1000);
});

Deno.test("FunctionalClient - list delegates to config", async () => {
  const client = new FunctionalClient({
    list: async (uri, opts) => ({
      success: true,
      data: [{ uri: uri + "/a" }, { uri: uri + "/b" }],
      pagination: { page: opts?.page || 1, limit: opts?.limit || 50, total: 2 },
    }),
  });

  const result = await client.list("mutable://test", { page: 2, limit: 10 });
  assertEquals(result.data.length, 2);
  assertEquals(result.pagination.page, 2);
  assertEquals(result.pagination.limit, 10);
});

Deno.test("FunctionalClient - delete delegates to config", async () => {
  const deleted: string[] = [];
  const client = new FunctionalClient({
    delete: async (uri) => {
      deleted.push(uri);
      return { success: true, uri };
    },
  });

  const result = await client.delete("mutable://test/doc");
  assertEquals(result.success, true);
  assertEquals(deleted, ["mutable://test/doc"]);
});

Deno.test("FunctionalClient - health delegates to config", async () => {
  const client = new FunctionalClient({
    health: async () => ({
      status: "unhealthy" as const,
      message: "db down",
    }),
  });

  const result = await client.health();
  assertEquals(result.status, "unhealthy");
});

Deno.test("FunctionalClient - getSchema delegates to config", async () => {
  const client = new FunctionalClient({
    getSchema: async () => ["mutable://users", "mutable://posts"],
  });

  const result = await client.getSchema();
  assertEquals(result, ["mutable://users", "mutable://posts"]);
});

Deno.test("FunctionalClient - cleanup delegates to config", async () => {
  let cleaned = false;
  const client = new FunctionalClient({
    cleanup: async () => {
      cleaned = true;
    },
  });

  await client.cleanup();
  assertEquals(cleaned, true);
});

// ── readMulti ──

Deno.test("FunctionalClient - readMulti delegates to config when provided", async () => {
  const client = new FunctionalClient({
    readMulti: async (uris) => ({
      success: true,
      results: uris.map((uri) => ({
        uri,
        success: true as const,
        record: { ts: 1000, data: { from: "multi" } },
      })),
      summary: { total: uris.length, succeeded: uris.length, failed: 0 },
    }),
  });

  const result = await client.readMulti(["mutable://a", "mutable://b"]);
  assertEquals(result.success, true);
  assertEquals(result.results.length, 2);
  assertEquals(result.summary.succeeded, 2);
});

Deno.test("FunctionalClient - readMulti auto-derives from read when not provided", async () => {
  const readCalls: string[] = [];
  const client = new FunctionalClient({
    read: async (uri) => {
      readCalls.push(uri);
      return {
        success: true,
        record: { ts: 1000, data: { uri } },
      };
    },
  });

  const result = await client.readMulti([
    "mutable://a",
    "mutable://b",
    "mutable://c",
  ]);
  assertEquals(result.success, true);
  assertEquals(result.results.length, 3);
  assertEquals(result.summary.total, 3);
  assertEquals(result.summary.succeeded, 3);
  assertEquals(result.summary.failed, 0);
  assertEquals(readCalls, ["mutable://a", "mutable://b", "mutable://c"]);
});

Deno.test("FunctionalClient - readMulti auto-derive handles partial failures", async () => {
  const client = new FunctionalClient({
    read: async (uri) => {
      if (uri === "mutable://fail") {
        return { success: false, error: "not found" };
      }
      return { success: true, record: { ts: 1000, data: {} } };
    },
  });

  const result = await client.readMulti(["mutable://ok", "mutable://fail"]);
  assertEquals(result.success, true); // at least one succeeded
  assertEquals(result.summary.succeeded, 1);
  assertEquals(result.summary.failed, 1);
});

Deno.test("FunctionalClient - readMulti auto-derive with empty array", async () => {
  const client = new FunctionalClient({});
  const result = await client.readMulti([]);
  assertEquals(result.success, false);
  assertEquals(result.results, []);
  assertEquals(result.summary, { total: 0, succeeded: 0, failed: 0 });
});

Deno.test("FunctionalClient - readMulti auto-derive all fail", async () => {
  const client = new FunctionalClient({
    read: async () => ({ success: false, error: "down" }),
  });

  const result = await client.readMulti(["mutable://a", "mutable://b"]);
  assertEquals(result.success, false); // no successes
  assertEquals(result.summary.succeeded, 0);
  assertEquals(result.summary.failed, 2);
});

/**
 * GraphQLClient Tests
 *
 * Tests the GraphQL client using a mock executor that simulates
 * GraphQL server responses with an in-memory Map store.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { GraphQLClient } from "./mod.ts";
import type { GraphQLExecutor, GraphQLExecutorResult } from "./mod.ts";
import type { Schema } from "../b3nd-core/types.ts";

/**
 * Create a mock GraphQL executor backed by an in-memory Map.
 * Simulates a GraphQL server that implements the b3nd operations.
 */
function createMockExecutor(): GraphQLExecutor {
  const store = new Map<string, { ts: number; data: unknown }>();
  let cleanupCalled = false;

  return {
    execute: (
      query: string,
      variables?: Record<string, unknown>,
    ): Promise<GraphQLExecutorResult> => {
      // Route based on query content
      if (query.includes("b3ndReceive")) {
        const uri = variables?.uri as string;
        const data = variables?.data;
        const ts = Date.now();
        store.set(uri, { ts, data });
        return Promise.resolve({
          data: {
            b3ndReceive: { accepted: true },
          },
        });
      }

      if (query.includes("b3ndReadMulti")) {
        const uris = variables?.uris as string[];
        const results = uris.map((uri) => {
          const record = store.get(uri);
          if (record) {
            return { uri, success: true, record, error: undefined };
          }
          return {
            uri,
            success: false,
            record: undefined,
            error: "Not found",
          };
        });
        const succeeded = results.filter((r) => r.success).length;
        return Promise.resolve({
          data: {
            b3ndReadMulti: {
              success: succeeded > 0,
              results,
              summary: {
                total: uris.length,
                succeeded,
                failed: uris.length - succeeded,
              },
            },
          },
        });
      }

      if (query.includes("b3ndRead")) {
        const uri = variables?.uri as string;
        const record = store.get(uri);
        if (record) {
          return Promise.resolve({
            data: {
              b3ndRead: { success: true, record },
            },
          });
        }
        return Promise.resolve({
          data: {
            b3ndRead: { success: false, error: "Not found" },
          },
        });
      }

      if (query.includes("b3ndList")) {
        const uri = variables?.uri as string;
        const items = Array.from(store.keys())
          .filter((key) => key.startsWith(uri))
          .map((key) => ({ uri: key }));
        return Promise.resolve({
          data: {
            b3ndList: {
              success: true,
              data: items,
              pagination: { page: 1, limit: 50, total: items.length },
            },
          },
        });
      }

      if (query.includes("b3ndDelete")) {
        const uri = variables?.uri as string;
        if (store.has(uri)) {
          store.delete(uri);
          return Promise.resolve({
            data: { b3ndDelete: { success: true } },
          });
        }
        return Promise.resolve({
          data: {
            b3ndDelete: { success: false, error: "Not found" },
          },
        });
      }

      if (query.includes("b3ndHealth")) {
        return Promise.resolve({
          data: {
            b3ndHealth: { status: "healthy", message: "All systems go" },
          },
        });
      }

      if (query.includes("b3ndSchema")) {
        return Promise.resolve({
          data: { b3ndSchema: ["store://users", "store://files"] },
        });
      }

      // Cleanup tracking
      if (cleanupCalled) {
        return Promise.resolve({
          errors: [{ message: "Executor already cleaned up" }],
        });
      }

      return Promise.resolve({
        errors: [{ message: "Unknown query" }],
      });
    },

    cleanup: (): Promise<void> => {
      cleanupCalled = true;
      store.clear();
      return Promise.resolve();
    },
  };
}

// -- receive --

Deno.test("GraphQLClient - receive: stores data", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.receive([
    "store://users/alice",
    { name: "Alice" },
  ]);

  assertEquals(result.accepted, true);
  assertEquals(result.error, undefined);
});

Deno.test("GraphQLClient - receive: rejects empty URI", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.receive(["", { name: "Alice" }]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "Message URI is required");
});

Deno.test("GraphQLClient - receive: rejects invalid URI format", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.receive(["not-a-uri", { name: "Alice" }]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "Invalid URI format");
});

// -- read --

Deno.test("GraphQLClient - read: returns stored data", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  await client.receive(["store://users/alice", { name: "Alice" }]);
  const result = await client.read("store://users/alice");

  assertEquals(result.success, true);
  assertEquals((result.record?.data as { name: string }).name, "Alice");
});

Deno.test("GraphQLClient - read: returns not found for missing data", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.read("store://users/missing");

  assertEquals(result.success, false);
  assertEquals(result.error, "Not found");
});

// -- readMulti --

Deno.test("GraphQLClient - readMulti: reads multiple URIs", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  await client.receive(["store://users/alice", { name: "Alice" }]);
  await client.receive(["store://users/bob", { name: "Bob" }]);

  const result = await client.readMulti([
    "store://users/alice",
    "store://users/bob",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.summary.total, 2);
  assertEquals(result.summary.succeeded, 2);
  assertEquals(result.summary.failed, 0);
});

Deno.test("GraphQLClient - readMulti: handles empty array", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.readMulti([]);

  assertEquals(result.success, false);
  assertEquals(result.summary.total, 0);
});

Deno.test("GraphQLClient - readMulti: rejects over 50 URIs", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const uris = Array.from({ length: 51 }, (_, i) => `store://users/user${i}`);
  const result = await client.readMulti(uris);

  assertEquals(result.success, false);
  assertEquals(result.summary.failed, 51);
});

// -- list --

Deno.test("GraphQLClient - list: returns matching items", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  await client.receive(["store://users/alice", { name: "Alice" }]);
  await client.receive(["store://users/bob", { name: "Bob" }]);

  const result = await client.list("store://users");

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 2);
  }
});

// -- delete --

Deno.test("GraphQLClient - delete: removes stored data", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  await client.receive(["store://users/alice", { name: "Alice" }]);
  const deleteResult = await client.delete("store://users/alice");

  assertEquals(deleteResult.success, true);

  const readResult = await client.read("store://users/alice");
  assertEquals(readResult.success, false);
});

Deno.test("GraphQLClient - delete: returns error for missing item", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.delete("store://users/missing");
  assertEquals(result.success, false);
});

// -- health --

Deno.test("GraphQLClient - health: returns healthy status", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.health();

  assertEquals(result.status, "healthy");
  assertEquals(result.message, "All systems go");
});

// -- getSchema --

Deno.test("GraphQLClient - getSchema: returns schema keys", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.getSchema();

  assertEquals(result, ["store://users", "store://files"]);
});

// -- cleanup --

Deno.test("GraphQLClient - cleanup: calls executor cleanup", async () => {
  let cleanedUp = false;
  const executor: GraphQLExecutor = {
    execute: (_query: string): Promise<GraphQLExecutorResult> => {
      return Promise.resolve({ data: { b3ndHealth: { status: "healthy" } } });
    },
    cleanup: (): Promise<void> => {
      cleanedUp = true;
      return Promise.resolve();
    },
  };
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  await client.cleanup();
  assertEquals(cleanedUp, true);
});

Deno.test("GraphQLClient - cleanup: no-op when executor has no cleanup", async () => {
  const executor: GraphQLExecutor = {
    execute: (_query: string): Promise<GraphQLExecutorResult> => {
      return Promise.resolve({ data: {} });
    },
  };
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  // Should not throw
  await client.cleanup();
});

// -- schema validation --

Deno.test("GraphQLClient - constructor: rejects invalid schema keys", () => {
  const schema: Schema = {
    "invalid-key": () => Promise.resolve({ valid: true }),
  };

  assertThrows(
    () => new GraphQLClient({ url: "http://test/graphql", schema }),
    Error,
    "Invalid schema key format",
  );
});

Deno.test("GraphQLClient - receive: validates against local schema", async () => {
  const schema: Schema = {
    "store://users": ({ value }) => {
      const data = value as Record<string, unknown>;
      if (!data.name) {
        return Promise.resolve({ valid: false, error: "Name is required" });
      }
      return Promise.resolve({ valid: true });
    },
  };

  const executor = createMockExecutor();
  const client = new GraphQLClient(
    { url: "http://test/graphql", schema },
    executor,
  );

  // Valid data
  const goodResult = await client.receive([
    "store://users/alice",
    { name: "Alice" },
  ]);
  assertEquals(goodResult.accepted, true);

  // Invalid data
  const badResult = await client.receive([
    "store://users/bob",
    { age: 30 },
  ]);
  assertEquals(badResult.accepted, false);
  assertEquals(badResult.error, "Name is required");
});

Deno.test("GraphQLClient - receive: rejects unknown program with schema", async () => {
  const schema: Schema = {
    "store://users": () => Promise.resolve({ valid: true }),
  };

  const executor = createMockExecutor();
  const client = new GraphQLClient(
    { url: "http://test/graphql", schema },
    executor,
  );

  const result = await client.receive([
    "other://data/key",
    { value: 1 },
  ]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "Program not found");
});

// -- executor errors --

Deno.test("GraphQLClient - receive: handles executor errors", async () => {
  const executor: GraphQLExecutor = {
    execute: (_query: string): Promise<GraphQLExecutorResult> => {
      return Promise.resolve({
        errors: [{ message: "Server error" }],
      });
    },
  };
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.receive([
    "store://users/alice",
    { name: "Alice" },
  ]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "Server error");
});

Deno.test("GraphQLClient - read: handles executor errors", async () => {
  const executor: GraphQLExecutor = {
    execute: (_query: string): Promise<GraphQLExecutorResult> => {
      return Promise.resolve({
        errors: [{ message: "Server error" }],
      });
    },
  };
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.read("store://users/alice");
  assertEquals(result.success, false);
  assertEquals(result.error, "Server error");
});

Deno.test("GraphQLClient - receive: handles executor exceptions", async () => {
  const executor: GraphQLExecutor = {
    execute: (): Promise<GraphQLExecutorResult> => {
      return Promise.reject(new Error("Connection refused"));
    },
  };
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.receive([
    "store://users/alice",
    { name: "Alice" },
  ]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "Connection refused");
});

Deno.test("GraphQLClient - health: handles executor errors gracefully", async () => {
  const executor: GraphQLExecutor = {
    execute: (): Promise<GraphQLExecutorResult> => {
      return Promise.reject(new Error("Network failure"));
    },
  };
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.health();
  assertEquals(result.status, "unhealthy");
  assertEquals(result.message, "Network failure");
});

Deno.test("GraphQLClient - getSchema: handles executor errors gracefully", async () => {
  const executor: GraphQLExecutor = {
    execute: (): Promise<GraphQLExecutorResult> => {
      return Promise.reject(new Error("Network failure"));
    },
  };
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.getSchema();
  assertEquals(result, []);
});

// -- default fetch executor path --

Deno.test("GraphQLClient - constructor: creates fetch executor when none provided", () => {
  // Just verify constructor doesn't throw — the fetch executor
  // will fail on actual calls since there's no server, but it should
  // be created successfully
  const client = new GraphQLClient({ url: "http://localhost:9999/graphql" });
  assertEquals(typeof client.health, "function");
});

// -- unexpected response format --

Deno.test("GraphQLClient - read: handles unexpected response format", async () => {
  const executor: GraphQLExecutor = {
    execute: (_query: string): Promise<GraphQLExecutorResult> => {
      return Promise.resolve({ data: { somethingElse: true } });
    },
  };
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.read("store://users/alice");
  assertEquals(result.success, false);
  assertEquals(result.error, "Unexpected response format");
});

Deno.test("GraphQLClient - delete: handles unexpected response format", async () => {
  const executor: GraphQLExecutor = {
    execute: (_query: string): Promise<GraphQLExecutorResult> => {
      return Promise.resolve({ data: { somethingElse: true } });
    },
  };
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.delete("store://users/alice");
  assertEquals(result.success, false);
  assertEquals(result.error, "Unexpected response format");
});

Deno.test("GraphQLClient - list: handles unexpected response format", async () => {
  const executor: GraphQLExecutor = {
    execute: (_query: string): Promise<GraphQLExecutorResult> => {
      return Promise.resolve({ data: { somethingElse: true } });
    },
  };
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  const result = await client.list("store://users");
  assertEquals(result.success, false);
});

Deno.test("GraphQLClient - readMulti: handles partial successes", async () => {
  const executor = createMockExecutor();
  const client = new GraphQLClient({ url: "http://test/graphql" }, executor);

  await client.receive(["store://users/alice", { name: "Alice" }]);

  const result = await client.readMulti([
    "store://users/alice",
    "store://users/missing",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.summary.succeeded, 1);
  assertEquals(result.summary.failed, 1);
});

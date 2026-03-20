/**
 * SqliteClient Tests
 *
 * Tests the SQLite client implementation using the shared test suite
 * plus SqliteClient-specific tests for schema generation, SQL injection
 * protection, and executor injection patterns.
 */

/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from "jsr:@std/assert";
import { Database } from "jsr:@db/sqlite";
import { SqliteClient } from "./mod.ts";
import type { SqliteExecutor, SqliteExecutorResult } from "./mod.ts";
import { generateSqliteSchema } from "./schema.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import { runNodeSuite } from "../b3nd-testing/node-suite.ts";

/** Create a SqliteExecutor backed by @db/sqlite in-memory database */
function createDenoSqliteExecutor(): {
  executor: SqliteExecutor;
  db: Database;
} {
  const db = new Database(":memory:");

  const executor: SqliteExecutor = {
    query(sql: string, args?: unknown[]): SqliteExecutorResult {
      const stmt = db.prepare(sql);

      // Detect if it's a SELECT/returning query
      if (
        sql.trimStart().toUpperCase().startsWith("SELECT") ||
        sql.trimStart().toUpperCase().startsWith("WITH") ||
        sql.includes("RETURNING")
      ) {
        const rows = args ? stmt.all(...(args as (string | number | boolean | null | Uint8Array)[])) : stmt.all();
        return {
          rows: rows as Record<string, unknown>[],
          rowCount: rows.length,
        };
      } else {
        // Non-query: INSERT, UPDATE, DELETE, CREATE, etc.
        if (args) {
          stmt.run(...(args as (string | number | boolean | null | Uint8Array)[]));
        } else {
          stmt.run();
        }
        return { rows: [], rowCount: db.changes };
      }
    },

    transaction<T>(fn: (tx: SqliteExecutor) => T): T {
      // @db/sqlite supports transactions via db.transaction()
      const txFn = db.transaction(() => {
        return fn(executor);
      });
      return txFn();
    },

    cleanup() {
      db.close();
    },
  };

  return { executor, db };
}

/** Create a fresh SqliteClient for testing */
function createTestClient() {
  const { executor } = createDenoSqliteExecutor();
  return new SqliteClient(
    {
      path: ":memory:",
      tablePrefix: "test",
      schema: {
        "store://users": async () => ({ valid: true }),
        "store://files": async () => ({ valid: true }),
        "store://pagination": async () => ({ valid: true }),
      },
    },
    executor,
  );
}

// ── Shared test suites ──────────────────────────────────────────────

runSharedSuite("SqliteClient", {
  happy: () => createTestClient(),

  validationError: () => {
    const { executor } = createDenoSqliteExecutor();
    return new SqliteClient(
      {
        path: ":memory:",
        tablePrefix: "valtest",
        schema: {
          "store://users": async ({ value }) => {
            const data = value as Record<string, unknown>;
            if (!data || typeof data !== "object" || !("name" in data)) {
              return { valid: false, error: "Name is required" };
            }
            return { valid: true };
          },
        },
      },
      executor,
    );
  },

  supportsBinary: true,
});

runNodeSuite("SqliteClient", {
  happy: () => createTestClient(),

  validationError: () => {
    const { executor } = createDenoSqliteExecutor();
    return new SqliteClient(
      {
        path: ":memory:",
        tablePrefix: "nodesuite",
        schema: {
          "store://users": async ({ value }) => {
            const data = value as Record<string, unknown>;
            if (!data || typeof data !== "object" || !("name" in data)) {
              return { valid: false, error: "Name is required" };
            }
            return { valid: true };
          },
        },
      },
      executor,
    );
  },
});

// ── Schema generation tests ─────────────────────────────────────────

Deno.test("generateSqliteSchema: creates valid DDL", () => {
  const ddl = generateSqliteSchema("myapp");
  assertEquals(ddl.includes("CREATE TABLE IF NOT EXISTS myapp_data"), true);
  assertEquals(ddl.includes("uri TEXT PRIMARY KEY"), true);
  assertEquals(ddl.includes("data TEXT NOT NULL"), true);
  assertEquals(ddl.includes("timestamp TEXT NOT NULL"), true);
  assertEquals(ddl.includes("idx_myapp_data_timestamp"), true);
});

Deno.test("generateSqliteSchema: rejects empty prefix", () => {
  assertThrows(() => generateSqliteSchema(""), Error, "required");
});

Deno.test("generateSqliteSchema: rejects invalid prefix (starts with number)", () => {
  assertThrows(
    () => generateSqliteSchema("123abc"),
    Error,
    "must start with a letter",
  );
});

Deno.test("generateSqliteSchema: rejects invalid prefix (special chars)", () => {
  assertThrows(
    () => generateSqliteSchema("my-app"),
    Error,
    "must start with a letter",
  );
});

Deno.test("generateSqliteSchema: accepts valid prefixes", () => {
  // Should not throw
  generateSqliteSchema("a");
  generateSqliteSchema("myApp123");
  generateSqliteSchema("my_table_prefix");
  generateSqliteSchema("B3ND");
});

// ── Constructor validation tests ────────────────────────────────────

Deno.test("SqliteClient: throws on missing config", () => {
  assertThrows(
    () => new SqliteClient(null as any),
    Error,
    "SqliteClientConfig is required",
  );
});

Deno.test("SqliteClient: throws on missing path", () => {
  assertThrows(
    () =>
      new SqliteClient(
        { path: "", tablePrefix: "test", schema: {} } as any,
        {} as any,
      ),
    Error,
    "path is required",
  );
});

Deno.test("SqliteClient: throws on missing tablePrefix", () => {
  assertThrows(
    () =>
      new SqliteClient(
        { path: ":memory:", tablePrefix: "", schema: {} } as any,
        {} as any,
      ),
    Error,
    "tablePrefix is required",
  );
});

Deno.test("SqliteClient: throws on missing schema", () => {
  assertThrows(
    () =>
      new SqliteClient(
        { path: ":memory:", tablePrefix: "test" } as any,
        {} as any,
      ),
    Error,
    "schema is required",
  );
});

Deno.test("SqliteClient: throws on missing executor", () => {
  assertThrows(
    () =>
      new SqliteClient({
        path: ":memory:",
        tablePrefix: "test",
        schema: { "store://x": async () => ({ valid: true }) },
      }),
    Error,
    "executor is required",
  );
});

// ── SqliteClient-specific behavior ──────────────────────────────────

Deno.test("SqliteClient: health returns healthy with details", async () => {
  const client = createTestClient();
  const health = await client.health();

  assertEquals(health.status, "healthy");
  assertEquals(health.message, "SQLite client is operational");
  assertEquals(health.details?.tablePrefix, "test");
  assertEquals(Array.isArray(health.details?.schemaKeys), true);

  await client.cleanup();
});

Deno.test("SqliteClient: health after cleanup returns unhealthy", async () => {
  const client = createTestClient();
  await client.cleanup();

  const health = await client.health();
  assertEquals(health.status, "unhealthy");
});

Deno.test("SqliteClient: getSchema returns schema keys", async () => {
  const client = createTestClient();
  const keys = await client.getSchema();

  assertEquals(keys.includes("store://users"), true);
  assertEquals(keys.includes("store://files"), true);
  assertEquals(keys.includes("store://pagination"), true);

  await client.cleanup();
});

Deno.test("SqliteClient: receive rejects empty URI", async () => {
  const client = createTestClient();

  const result = await client.receive(["", { data: "test" }]);
  assertEquals(result.accepted, false);
  assertEquals(typeof result.error, "string");
  assertEquals(result.errorDetail?.code, "INVALID_URI");

  await client.cleanup();
});

Deno.test("SqliteClient: receive rejects unknown schema", async () => {
  const client = createTestClient();

  const result = await client.receive([
    "unknown://path/data",
    { data: "test" },
  ]);
  assertEquals(result.accepted, false);
  assertEquals(result.error?.includes("No schema defined"), true);

  await client.cleanup();
});

Deno.test("SqliteClient: upsert overwrites existing data", async () => {
  const client = createTestClient();

  await client.receive(["store://users/alice/profile", { v: 1 }]);
  await client.receive(["store://users/alice/profile", { v: 2 }]);

  const result = await client.read("store://users/alice/profile");
  assertEquals(result.success, true);
  assertEquals(result.record?.data, { v: 2 });

  await client.cleanup();
});

Deno.test("SqliteClient: list with sort by timestamp", async () => {
  const client = createTestClient();

  const prefix = `store://users/sort-test-${Date.now()}`;
  await client.receive([`${prefix}/first`, { n: 1 }]);
  // Small delay to ensure different timestamps
  await new Promise((r) => setTimeout(r, 10));
  await client.receive([`${prefix}/second`, { n: 2 }]);
  await new Promise((r) => setTimeout(r, 10));
  await client.receive([`${prefix}/third`, { n: 3 }]);

  const result = await client.list(prefix, {
    sortBy: "timestamp",
    sortOrder: "desc",
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 3);
    assertEquals(result.data[0].uri, `${prefix}/third`);
    assertEquals(result.data[2].uri, `${prefix}/first`);
  }

  await client.cleanup();
});

Deno.test("SqliteClient: delete returns error for non-existent URI", async () => {
  const client = createTestClient();

  const result = await client.delete("store://users/ghost/data");
  assertEquals(result.success, false);
  assertEquals(result.errorDetail?.code, "NOT_FOUND");

  await client.cleanup();
});

Deno.test("SqliteClient: readMulti batch query (SQL IN)", async () => {
  const client = createTestClient();

  // Store 5 items
  for (let i = 0; i < 5; i++) {
    await client.receive([`store://users/batch${i}/data`, { index: i }]);
  }

  // Read 3 of them plus 1 non-existent
  const result = await client.readMulti([
    "store://users/batch0/data",
    "store://users/batch2/data",
    "store://users/batch4/data",
    "store://users/nonexistent/data",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.summary.total, 4);
  assertEquals(result.summary.succeeded, 3);
  assertEquals(result.summary.failed, 1);

  // Verify correct data returned in order
  assertEquals(result.results[0].success, true);
  if (result.results[0].success) {
    assertEquals(result.results[0].record.data, { index: 0 });
  }
  assertEquals(result.results[3].success, false);

  await client.cleanup();
});

Deno.test("SqliteClient: handles nested object data", async () => {
  const client = createTestClient();

  const complexData = {
    name: "Alice",
    preferences: {
      theme: "dark",
      notifications: { email: true, push: false },
    },
    tags: ["admin", "user"],
  };

  await client.receive(["store://users/alice/complex", complexData]);
  const result = await client.read("store://users/alice/complex");

  assertEquals(result.success, true);
  assertEquals(result.record?.data, complexData);

  await client.cleanup();
});

Deno.test("SqliteClient: handles array data at top level", async () => {
  const client = createTestClient();

  const arrayData = [1, "two", { three: 3 }, null, true];

  await client.receive(["store://users/alice/array", arrayData]);
  const result = await client.read("store://users/alice/array");

  assertEquals(result.success, true);
  assertEquals(result.record?.data, arrayData);

  await client.cleanup();
});

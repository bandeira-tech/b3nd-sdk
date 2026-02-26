/**
 * Tests for query evaluation utilities and MemoryClient.query()
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";
import { evaluateWhere, getField, applySelect } from "./query.ts";
import type { WhereClause } from "./types.ts";

// --- Unit tests for query helpers ---

Deno.test("getField - top-level field", () => {
  assertEquals(getField({ name: "Alice" }, "name"), "Alice");
});

Deno.test("getField - nested field", () => {
  assertEquals(
    getField({ address: { city: "NYC" } }, "address.city"),
    "NYC",
  );
});

Deno.test("getField - deeply nested field", () => {
  assertEquals(
    getField({ a: { b: { c: 42 } } }, "a.b.c"),
    42,
  );
});

Deno.test("getField - missing field returns undefined", () => {
  assertEquals(getField({ name: "Alice" }, "age"), undefined);
});

Deno.test("getField - missing nested path returns undefined", () => {
  assertEquals(getField({ a: {} }, "a.b.c"), undefined);
});

Deno.test("evaluateWhere - eq", () => {
  assertEquals(evaluateWhere({ age: 30 }, { field: "age", op: "eq", value: 30 }), true);
  assertEquals(evaluateWhere({ age: 25 }, { field: "age", op: "eq", value: 30 }), false);
});

Deno.test("evaluateWhere - neq", () => {
  assertEquals(evaluateWhere({ age: 25 }, { field: "age", op: "neq", value: 30 }), true);
  assertEquals(evaluateWhere({ age: 30 }, { field: "age", op: "neq", value: 30 }), false);
});

Deno.test("evaluateWhere - gt/gte/lt/lte", () => {
  assertEquals(evaluateWhere({ age: 31 }, { field: "age", op: "gt", value: 30 }), true);
  assertEquals(evaluateWhere({ age: 30 }, { field: "age", op: "gt", value: 30 }), false);
  assertEquals(evaluateWhere({ age: 30 }, { field: "age", op: "gte", value: 30 }), true);
  assertEquals(evaluateWhere({ age: 29 }, { field: "age", op: "lt", value: 30 }), true);
  assertEquals(evaluateWhere({ age: 30 }, { field: "age", op: "lt", value: 30 }), false);
  assertEquals(evaluateWhere({ age: 30 }, { field: "age", op: "lte", value: 30 }), true);
});

Deno.test("evaluateWhere - in", () => {
  assertEquals(
    evaluateWhere({ role: "admin" }, { field: "role", op: "in", value: ["admin", "moderator"] }),
    true,
  );
  assertEquals(
    evaluateWhere({ role: "user" }, { field: "role", op: "in", value: ["admin", "moderator"] }),
    false,
  );
});

Deno.test("evaluateWhere - contains/startsWith/endsWith", () => {
  assertEquals(
    evaluateWhere({ email: "alice@example.com" }, { field: "email", op: "contains", value: "example" }),
    true,
  );
  assertEquals(
    evaluateWhere({ email: "alice@example.com" }, { field: "email", op: "startsWith", value: "alice" }),
    true,
  );
  assertEquals(
    evaluateWhere({ email: "alice@example.com" }, { field: "email", op: "endsWith", value: ".com" }),
    true,
  );
  assertEquals(
    evaluateWhere({ email: "alice@example.com" }, { field: "email", op: "startsWith", value: "bob" }),
    false,
  );
});

Deno.test("evaluateWhere - exists", () => {
  assertEquals(
    evaluateWhere({ name: "Alice" }, { field: "name", op: "exists", value: true }),
    true,
  );
  assertEquals(
    evaluateWhere({ name: "Alice" }, { field: "age", op: "exists", value: true }),
    false,
  );
  assertEquals(
    evaluateWhere({ name: "Alice" }, { field: "age", op: "exists", value: false }),
    true,
  );
});

Deno.test("evaluateWhere - and", () => {
  const clause: WhereClause = {
    and: [
      { field: "age", op: "gte", value: 18 },
      { field: "active", op: "eq", value: true },
    ],
  };
  assertEquals(evaluateWhere({ age: 25, active: true }, clause), true);
  assertEquals(evaluateWhere({ age: 15, active: true }, clause), false);
  assertEquals(evaluateWhere({ age: 25, active: false }, clause), false);
});

Deno.test("evaluateWhere - or", () => {
  const clause: WhereClause = {
    or: [
      { field: "role", op: "eq", value: "admin" },
      { field: "role", op: "eq", value: "moderator" },
    ],
  };
  assertEquals(evaluateWhere({ role: "admin" }, clause), true);
  assertEquals(evaluateWhere({ role: "moderator" }, clause), true);
  assertEquals(evaluateWhere({ role: "user" }, clause), false);
});

Deno.test("evaluateWhere - not", () => {
  const clause: WhereClause = {
    not: { field: "banned", op: "eq", value: true },
  };
  assertEquals(evaluateWhere({ banned: false }, clause), true);
  assertEquals(evaluateWhere({ banned: true }, clause), false);
});

Deno.test("evaluateWhere - nested field", () => {
  assertEquals(
    evaluateWhere(
      { address: { city: "NYC" } },
      { field: "address.city", op: "eq", value: "NYC" },
    ),
    true,
  );
});

Deno.test("applySelect - picks specific fields", () => {
  const data = { name: "Alice", age: 30, email: "alice@example.com" };
  assertEquals(applySelect(data, ["name", "email"]), {
    name: "Alice",
    email: "alice@example.com",
  });
});

Deno.test("applySelect - handles nested fields", () => {
  const data = { user: { name: "Alice" }, score: 42 };
  assertEquals(applySelect(data, ["user.name", "score"]), {
    "user.name": "Alice",
    "score": 42,
  });
});

// --- Integration tests with MemoryClient.query() ---

function createTestClient() {
  return new MemoryClient({
    schema: {
      "store://users": async () => ({ valid: true }),
      "store://products": async () => ({ valid: true }),
    },
  });
}

async function seedUsers(client: MemoryClient) {
  await client.receive(["store://users/alice/profile", {
    name: "Alice",
    age: 30,
    role: "admin",
    active: true,
    address: { city: "NYC", country: "US" },
  }]);
  await client.receive(["store://users/bob/profile", {
    name: "Bob",
    age: 25,
    role: "user",
    active: true,
    address: { city: "London", country: "UK" },
  }]);
  await client.receive(["store://users/charlie/profile", {
    name: "Charlie",
    age: 35,
    role: "moderator",
    active: false,
    address: { city: "Paris", country: "FR" },
  }]);
  await client.receive(["store://users/diana/profile", {
    name: "Diana",
    age: 28,
    role: "user",
    active: true,
    address: { city: "Berlin", country: "DE" },
  }]);
  await client.receive(["store://users/eve/profile", {
    name: "Eve",
    age: 22,
    role: "admin",
    active: true,
    address: { city: "Tokyo", country: "JP" },
  }]);
}

Deno.test("MemoryClient.query - basic query returns all records under prefix", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({ prefix: "store://users" });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 5);
    assertEquals(result.total, 5);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - where eq filter", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: { field: "role", op: "eq", value: "admin" },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 2);
    const names = result.records.map((r) => (r.data as any).name).sort();
    assertEquals(names, ["Alice", "Eve"]);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - where range filter", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: { field: "age", op: "gte", value: 30 },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 2);
    const names = result.records.map((r) => (r.data as any).name).sort();
    assertEquals(names, ["Alice", "Charlie"]);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - where AND compound filter", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: {
      and: [
        { field: "active", op: "eq", value: true },
        { field: "age", op: "lt", value: 30 },
      ],
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 3);
    const names = result.records.map((r) => (r.data as any).name).sort();
    assertEquals(names, ["Bob", "Diana", "Eve"]);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - where OR filter", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: {
      or: [
        { field: "role", op: "eq", value: "admin" },
        { field: "role", op: "eq", value: "moderator" },
      ],
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 3);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - where NOT filter", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: {
      not: { field: "active", op: "eq", value: true },
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 1);
    assertEquals((result.records[0].data as any).name, "Charlie");
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - where IN filter", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: { field: "role", op: "in", value: ["admin", "moderator"] },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 3);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - where nested field filter", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: { field: "address.country", op: "eq", value: "US" },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 1);
    assertEquals((result.records[0].data as any).name, "Alice");
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - where contains string filter", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: { field: "name", op: "contains", value: "li" },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 2); // Alice, Charlie
    const names = result.records.map((r) => (r.data as any).name).sort();
    assertEquals(names, ["Alice", "Charlie"]);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - orderBy ascending", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    orderBy: [{ field: "age", direction: "asc" }],
  });

  assertEquals(result.success, true);
  if (result.success) {
    const ages = result.records.map((r) => (r.data as any).age);
    assertEquals(ages, [22, 25, 28, 30, 35]);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - orderBy descending", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    orderBy: [{ field: "age", direction: "desc" }],
  });

  assertEquals(result.success, true);
  if (result.success) {
    const ages = result.records.map((r) => (r.data as any).age);
    assertEquals(ages, [35, 30, 28, 25, 22]);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - orderBy string field", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    orderBy: [{ field: "name", direction: "asc" }],
  });

  assertEquals(result.success, true);
  if (result.success) {
    const names = result.records.map((r) => (r.data as any).name);
    assertEquals(names, ["Alice", "Bob", "Charlie", "Diana", "Eve"]);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - limit and offset", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    orderBy: [{ field: "name", direction: "asc" }],
    limit: 2,
    offset: 1,
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 2);
    assertEquals(result.total, 5); // Total before pagination
    const names = result.records.map((r) => (r.data as any).name);
    assertEquals(names, ["Bob", "Charlie"]);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - select projection", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: { field: "name", op: "eq", value: "Alice" },
    select: ["name", "age"],
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 1);
    assertEquals(result.records[0].data, { name: "Alice", age: 30 });
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - combined filter + sort + limit + select", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: { field: "active", op: "eq", value: true },
    orderBy: [{ field: "age", direction: "desc" }],
    limit: 2,
    select: ["name", "age"],
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 2);
    assertEquals(result.total, 4); // 4 active users
    assertEquals(result.records[0].data, { name: "Alice", age: 30 });
    assertEquals(result.records[1].data, { name: "Diana", age: 28 });
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - empty results", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({
    prefix: "store://users",
    where: { field: "age", op: "gt", value: 100 },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 0);
    assertEquals(result.total, 0);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - invalid prefix returns empty", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({ prefix: "store://nonexistent" });

  // Should return success: true with empty results (prefix exists in schema but no data)
  // or success: false if the program key doesn't match
  if (result.success) {
    assertEquals(result.records.length, 0);
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - each record has uri and ts", async () => {
  const client = createTestClient();
  await seedUsers(client);

  const result = await client.query({ prefix: "store://users" });

  assertEquals(result.success, true);
  if (result.success) {
    for (const record of result.records) {
      assertEquals(typeof record.uri, "string");
      assertEquals(record.uri.startsWith("store://users/"), true);
      assertEquals(typeof record.ts, "number");
      assertEquals(record.ts > 0, true);
    }
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - scoped to prefix only", async () => {
  const client = createTestClient();
  await seedUsers(client);
  // Also seed products to verify prefix scoping
  await client.receive(["store://products/widget/info", { name: "Widget", price: 10 }]);

  const result = await client.query({ prefix: "store://users" });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 5); // Only users, not products
    for (const record of result.records) {
      assertEquals(record.uri.startsWith("store://users/"), true);
    }
  }
  await client.cleanup();
});

Deno.test("MemoryClient.query - exists operator", async () => {
  const client = createTestClient();
  await client.receive(["store://users/with-bio/profile", { name: "WithBio", bio: "Hello" }]);
  await client.receive(["store://users/no-bio/profile", { name: "NoBio" }]);

  const result = await client.query({
    prefix: "store://users",
    where: { field: "bio", op: "exists", value: true },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.records.length, 1);
    assertEquals((result.records[0].data as any).name, "WithBio");
  }
  await client.cleanup();
});

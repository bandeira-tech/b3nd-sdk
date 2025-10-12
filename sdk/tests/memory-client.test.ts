/**
 * MemoryClient Tests
 *
 * Tests the in-memory client implementation using the shared test suite
 * plus MemoryClient-specific tests
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { MemoryClient } from "../clients/memory/mod.ts";
import { runSharedSuite, type TestClientFactories } from "./shared-suite.ts";

// Run shared suite with MemoryClient factory functions
runSharedSuite("MemoryClient", {
  happy: () =>
    new MemoryClient({
      schema: {
        "users://": async () => ({ valid: true }),
        "cache://": async () => ({ valid: true }),
      },
    }),

  validationError: () =>
    new MemoryClient({
      schema: {
        "users://": async ({ value }) => {
          const data = value as any;
          if (!data.name) {
            return { valid: false, error: "Name is required" };
          }
          return { valid: true };
        },
      },
    }),
});

// MemoryClient-specific tests
Deno.test("MemoryClient - write without schema definition", async () => {
  const client = new MemoryClient({
    schema: {
      "users://": async () => ({ valid: true }),
    },
  });

  // Try to write to a program without schema
  const writeResult = await client.write("posts://123/content", {
    title: "Hello",
  });

  assertEquals(writeResult.success, false);
  assertEquals(writeResult.error?.includes("No schema defined"), true);

  await client.cleanup();
});

Deno.test("MemoryClient - validation with custom error message", async () => {
  const client = new MemoryClient({
    schema: {
      "users://": async ({ value }) => {
        const data = value as any;
        if (!data.email) {
          return { valid: false, error: "Email is required for users" };
        }
        if (!data.email.includes("@")) {
          return { valid: false, error: "Invalid email format" };
        }
        return { valid: true };
      },
    },
  });

  // Missing email
  const result1 = await client.write("users://alice/profile", {
    name: "Alice",
  });
  assertEquals(result1.success, false);
  assertEquals(result1.error, "Email is required for users");

  // Invalid email
  const result2 = await client.write("users://bob/profile", {
    name: "Bob",
    email: "notanemail",
  });
  assertEquals(result2.success, false);
  assertEquals(result2.error, "Invalid email format");

  // Valid
  const result3 = await client.write("users://charlie/profile", {
    name: "Charlie",
    email: "charlie@example.com",
  });
  assertEquals(result3.success, true);

  await client.cleanup();
});

Deno.test("MemoryClient - list sorting by name", async () => {
  const client = new MemoryClient({
    schema: {
      "users://": async () => ({ valid: true }),
    },
  });

  await client.write("users://charlie/profile", { name: "Charlie" });
  await client.write("users://alice/profile", { name: "Alice" });
  await client.write("users://bob/profile", { name: "Bob" });

  // Ascending
  const ascResult = await client.list("users://", {
    sortBy: "name",
    sortOrder: "asc",
  });
  assertEquals(
    ascResult.data[0].uri.includes("alice"),
    true,
    "First item should be alice",
  );

  // Descending
  const descResult = await client.list("users://", {
    sortBy: "name",
    sortOrder: "desc",
  });
  assertEquals(
    descResult.data[0].uri.includes("charlie"),
    true,
    "First item should be charlie",
  );

  await client.cleanup();
});

Deno.test("MemoryClient - list sorting by timestamp", async () => {
  const client = new MemoryClient({
    schema: {
      "users://": async () => ({ valid: true }),
    },
  });

  await client.write("users://first/profile", { name: "First" });
  await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
  await client.write("users://second/profile", { name: "Second" });
  await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
  await client.write("users://third/profile", { name: "Third" });

  // Ascending (oldest first)
  const ascResult = await client.list("users://", {
    sortBy: "timestamp",
    sortOrder: "asc",
  });
  assertEquals(ascResult.data[0].uri.includes("first"), true);

  // Descending (newest first)
  const descResult = await client.list("users://", {
    sortBy: "timestamp",
    sortOrder: "desc",
  });
  assertEquals(descResult.data[0].uri.includes("third"), true);

  await client.cleanup();
});

Deno.test("MemoryClient - health includes detailed info", async () => {
  const client = new MemoryClient({
    schema: {
      "users://": async () => ({ valid: true }),
      "posts://": async () => ({ valid: true }),
      "cache://": async () => ({ valid: true }),
    },
  });

  await client.write("users://alice/profile", { name: "Alice" });
  await client.write("users://bob/profile", { name: "Bob" });

  const health = await client.health();

  assertEquals(health.status, "healthy");
  assertEquals(health.details?.itemCount, 2);
  assertEquals(health.details?.schemaKeys, ["users://", "posts://", "cache://"]);

  await client.cleanup();
});

Deno.test("MemoryClient - multiple schemas work independently", async () => {
  const client = new MemoryClient({
    schema: {
      "users://": async ({ value }) => {
        const data = value as any;
        return { valid: !!data.name };
      },
      "cache://": async () => ({ valid: true }), // No validation
    },
  });

  // users:// requires name
  const userInvalid = await client.write("users://test/data", { value: 123 });
  assertEquals(userInvalid.success, false);

  const userValid = await client.write("users://test/data", { name: "Test" });
  assertEquals(userValid.success, true);

  // cache:// accepts anything
  const cacheValid = await client.write("cache://anything", {
    random: "data",
  });
  assertEquals(cacheValid.success, true);

  await client.cleanup();
});

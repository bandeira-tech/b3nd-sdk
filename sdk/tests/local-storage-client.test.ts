/**
 * LocalStorageClient tests
 */

import { assertEquals } from "jsr:@std/assert";
import { LocalStorageClient } from "../src/local-storage-client.ts";
import { runSharedSuite, type TestClientFactories } from "./shared-suite.ts";

/**
 * Mock localStorage for testing environments where it's not available
 */
class MockLocalStorage {
  private storage = new Map<string, string>();

  getItem(key: string): string | null {
    return this.storage.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }

  removeItem(key: string): void {
    this.storage.delete(key);
  }

  clear(): void {
    this.storage.clear();
  }

  get length(): number {
    return this.storage.size;
  }

  key(index: number): string | null {
    const keys = Array.from(this.storage.keys());
    return keys[index] || null;
  }
}

// Replace global localStorage with mock if not available
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as any).localStorage = new MockLocalStorage();
}

Deno.test("LocalStorageClient - basic operations", async () => {
  const client = new LocalStorageClient({
    keyPrefix: "test:",
  });

  // Clear any existing data
  await client.cleanup();

  // Test write and read
  const writeResult = await client.write("test://item", { name: "test" });
  assertEquals(writeResult.success, true);
  assertEquals(writeResult.record?.data, { name: "test" });
  assertEquals(typeof writeResult.record?.ts, "number");

  const readResult = await client.read("test://item");
  assertEquals(readResult.success, true);
  assertEquals(readResult.record?.data, { name: "test" });

  // Test read non-existent
  const readNonExistent = await client.read("test://nonexistent");
  assertEquals(readNonExistent.success, false);
  assertEquals(readNonExistent.error, "Not found");

  await client.cleanup();
});

Deno.test("LocalStorageClient - schema validation", async () => {
  const client = new LocalStorageClient({
    keyPrefix: "test:",
    schema: {
      "users://": async ({ value }) => {
        if (typeof value === "object" && value !== null && "name" in value) {
          return { valid: true };
        }
        return { valid: false, error: "Users must have a name" };
      },
    },
  });

  await client.cleanup();

  // Valid write
  const validWrite = await client.write("users://alice", { name: "Alice" });
  assertEquals(validWrite.success, true);

  // Invalid write
  const invalidWrite = await client.write("users://bob", { age: 25 });
  assertEquals(invalidWrite.success, false);
  assertEquals(invalidWrite.error, "Users must have a name");

  // Write to non-schemad URI
  const nonSchemaWrite = await client.write("posts://1", { title: "Hello" });
  assertEquals(nonSchemaWrite.success, true);

  await client.cleanup();
});

Deno.test("LocalStorageClient - list operations", async () => {
  const client = new LocalStorageClient({
    keyPrefix: "test:",
  });

  await client.cleanup();

  // Create test data
  await client.write("test://users/alice", { name: "Alice" });
  await client.write("test://users/bob", { name: "Bob" });
  await client.write("test://posts/1", { title: "Post 1" });
  await client.write("test://posts/2", { title: "Post 2" });

  // List all items
  const listResult = await client.list("test://");
  assertEquals(listResult.data.length, 4);
  assertEquals(listResult.pagination.total, 4);

  // List with pattern
  const patternResult = await client.list("test://", { pattern: "users" });
  assertEquals(patternResult.data.length, 2);
  assertEquals(patternResult.data.every(item => item.uri.includes("users")), true);

  // List with pagination
  const pageResult = await client.list("test://", { page: 1, limit: 2 });
  assertEquals(pageResult.data.length, 2);
  assertEquals(pageResult.pagination.page, 1);
  assertEquals(pageResult.pagination.limit, 2);

  await client.cleanup();
});

Deno.test("LocalStorageClient - delete operations", async () => {
  const client = new LocalStorageClient({
    keyPrefix: "test:",
  });

  await client.cleanup();

  // Create test data
  await client.write("test://item", { data: "test" });

  // Delete existing item
  const deleteResult = await client.delete("test://item");
  assertEquals(deleteResult.success, true);

  // Verify deletion
  const readResult = await client.read("test://item");
  assertEquals(readResult.success, false);

  // Delete non-existent item
  const deleteNonExistent = await client.delete("test://nonexistent");
  assertEquals(deleteNonExistent.success, false);
  assertEquals(deleteNonExistent.error, "Not found");

  await client.cleanup();
});

Deno.test("LocalStorageClient - health check", async () => {
  const client = new LocalStorageClient({
    keyPrefix: "test:",
  });

  await client.cleanup();

  const health = await client.health();
  assertEquals(health.status, "healthy");
  assertEquals(health.message, "LocalStorage client is operational");
  assertEquals(typeof health.details?.totalKeys, "number");
  assertEquals(typeof health.details?.b3ndKeys, "number");
  assertEquals(typeof health.details?.totalSize, "number");

  await client.cleanup();
});

Deno.test("LocalStorageClient - getSchema", async () => {
  const client = new LocalStorageClient({
    keyPrefix: "test:",
    schema: {
      "users://": async () => ({ valid: true }),
      "posts://": async () => ({ valid: true }),
    },
  });

  const schema = await client.getSchema();
  assertEquals(schema.length, 2);
  assertEquals(schema.includes("users://"), true);
  assertEquals(schema.includes("posts://"), true);

  await client.cleanup();
});

Deno.test("LocalStorageClient - custom serializer", async () => {
  const client = new LocalStorageClient({
    keyPrefix: "test:",
    serializer: {
      serialize: (data) => JSON.stringify({ custom: true, data }),
      deserialize: (data) => {
        const parsed = JSON.parse(data);
        return parsed.custom ? parsed.data : parsed;
      },
    },
  });

  await client.cleanup();

  const writeResult = await client.write("test://item", { name: "test" });
  assertEquals(writeResult.success, true);

  const readResult = await client.read("test://item");
  assertEquals(readResult.success, true);
  assertEquals(readResult.record?.data, { name: "test" });

  await client.cleanup();
});

// Run the shared test suite
const testFactories: TestClientFactories = {
  happy: () => new LocalStorageClient({ keyPrefix: "shared-test:" }),
};

runSharedSuite("LocalStorageClient", testFactories);
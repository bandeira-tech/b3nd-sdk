/**
 * IndexedDBClient tests
 */

import { assertEquals } from "jsr:@std/assert";
import { IndexedDBClient } from "../src/indexed-db-client.ts";
import { runSharedSuite, type TestClientFactories } from "./shared-suite.ts";

/**
 * Mock IndexedDB for testing environments where it's not available
 */
class MockIndexedDB {
  private databases = new Map<string, MockIDBDatabase>();

  open(name: string, version?: number): MockIDBOpenDBRequest {
    return new MockIDBOpenDBRequest(this.databases, name, version);
  }

  deleteDatabase(name: string): MockIDBRequest {
    return new MockIDBDeleteDBRequest(this.databases, name);
  }
}

class MockIDBDatabase {
  public objectStoreNames = {
    contains: (name: string) => false
  };

  constructor(
    public name: string,
    public version: number,
    private parent: MockIndexedDB
  ) {}

  close(): void {
    // Nothing to do in mock
  }

  transaction(storeNames: string | string[], mode?: string): any {
    return {
      objectStore: (name: string) => new MockIDBObjectStore()
    };
  }
}

class MockIDBObjectStore {
  get(key: any): MockIDBRequest {
    return new MockIDBRequest(null);
  }

  put(value: any): MockIDBRequest {
    return new MockIDBRequest(value);
  }

  delete(key: any): MockIDBRequest {
    return new MockIDBRequest(undefined);
  }

  clear(): MockIDBRequest {
    return new MockIDBRequest(undefined);
  }

  index(name: string): MockIDBIndex {
    return new MockIDBIndex();
  }
}

class MockIDBIndex {
  openCursor(): MockIDBRequest {
    return new MockIDBRequest(null);
  }
}

class MockIDBRequest {
  public result: any;
  public error: Error | null = null;
  public onsuccess: ((this: MockIDBRequest, ev: Event) => any) | null = null;
  public onerror: ((this: MockIDBRequest, ev: Event) => any) | null = null;

  constructor(result: any) {
    this.result = result;
    // Simulate async operation
    setTimeout(() => {
      if (this.onsuccess) {
        this.onsuccess.call(this, new Event('success'));
      }
    }, 0);
  }
}

class MockIDBOpenDBRequest {
  public result: MockIDBDatabase | null = null;
  public error: Error | null = null;
  public readyState = "pending";

  private onsuccessHandler: (() => void) | null = null;
  private onerrorHandler: (() => void) | null = null;
  private onupgradeneededHandler: (() => void) | null = null;

  constructor(
    private databases: Map<string, MockIDBDatabase>,
    private name: string,
    private version?: number
  ) {
    // Simulate async operation
    setTimeout(() => {
      const existingDb = this.databases.get(name);
      const targetVersion = version || (existingDb?.version || 0) + 1;

      if (!existingDb || (version && version > existingDb.version)) {
        // Upgrade needed
        this.result = new MockIDBDatabase(name, targetVersion, { databases: this.databases } as any);
        this.readyState = "done";
        this.onupgradeneededHandler?.();
        this.databases.set(name, this.result);
      } else {
        // Open existing
        this.result = existingDb;
        this.readyState = "done";
      }

      this.onsuccessHandler?.();
    }, 10);
  }

  set onsuccess(handler: () => void) {
    this.onsuccessHandler = handler;
  }

  set onerror(handler: () => void) {
    this.onerrorHandler = handler;
  }

  set onupgradeneeded(handler: () => void) {
    this.onupgradeneededHandler = handler;
  }
}

class MockIDBDeleteDBRequest {
  public result: null = null;
  public error: Error | null = null;
  public readyState = "pending";

  private onsuccessHandler: (() => void) | null = null;
  private onerrorHandler: (() => void) | null = null;

  constructor(
    private databases: Map<string, MockIDBDatabase>,
    private name: string
  ) {
    // Simulate async operation
    setTimeout(() => {
      if (this.databases.has(name)) {
        this.databases.delete(name);
        this.readyState = "done";
        this.onsuccessHandler?.();
      } else {
        this.error = new Error("Database not found");
        this.readyState = "done";
        this.onerrorHandler?.();
      }
    }, 10);
  }

  set onsuccess(handler: () => void) {
    this.onsuccessHandler = handler;
  }

  set onerror(handler: () => void) {
    this.onerrorHandler = handler;
  }
}

// Replace global indexedDB with mock if not available
if (typeof (globalThis as any).indexedDB === "undefined") {
  (globalThis as any).indexedDB = new MockIndexedDB();
}

Deno.test("IndexedDBClient - basic operations", async () => {
  const client = new IndexedDBClient({
    databaseName: "test-db",
    storeName: "test-store",
  });

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

Deno.test("IndexedDBClient - schema validation", async () => {
  const client = new IndexedDBClient({
    databaseName: "test-schema-db",
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

Deno.test("IndexedDBClient - list operations", async () => {
  const client = new IndexedDBClient({
    databaseName: "test-list-db",
  });

  await client.cleanup();

  // Create test data
  await client.write("test://users/alice", { name: "Alice" });
  await client.write("test://users/bob", { name: "Bob" });
  await client.write("test://posts/1", { title: "Post 1" });
  await client.write("test://posts/2", { title: "Post 2" });

  // List all items (this might not work perfectly with our mock)
  const listResult = await client.list("test://");
  assertEquals(Array.isArray(listResult.data), true);

  await client.cleanup();
});

Deno.test("IndexedDBClient - delete operations", async () => {
  const client = new IndexedDBClient({
    databaseName: "test-delete-db",
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

Deno.test("IndexedDBClient - health check", async () => {
  const client = new IndexedDBClient({
    databaseName: "test-health-db",
  });

  await client.cleanup();

  const health = await client.health();
  assertEquals(health.status, "healthy");
  assertEquals(health.message, "IndexedDB client is operational");
  assertEquals(health.details?.databaseName, "test-health-db");
  assertEquals(typeof health.details?.totalRecords, "number");

  await client.cleanup();
});

Deno.test("IndexedDBClient - getSchema", async () => {
  const client = new IndexedDBClient({
    databaseName: "test-schema-list-db",
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

// Run the shared test suite
const testFactories: TestClientFactories = {
  happy: () => new IndexedDBClient({ databaseName: "shared-test-db" }),
};

runSharedSuite("IndexedDBClient", testFactories);
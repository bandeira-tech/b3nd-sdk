/**
 * IndexedDBClient tests
 */

/// <reference lib="deno.ns" />

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
  private stores = new Map<string, MockIDBObjectStore>();

  public objectStoreNames = {
    contains: (name: string) => this.stores.has(name)
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
    const storeName = Array.isArray(storeNames) ? storeNames[0] : storeNames;
    let store = this.stores.get(storeName);
    if (!store) {
      store = new MockIDBObjectStore();
      this.stores.set(storeName, store);
    }
    return {
      objectStore: (name: string) => name === storeName ? store : new MockIDBObjectStore()
    };
  }

  createObjectStore(name: string, options?: any): MockIDBObjectStore {
    const store = new MockIDBObjectStore();
    this.stores.set(name, store);
    return store;
  }
}

class MockIDBObjectStore {
  private data = new Map<string, any>();
  private indexes = new Map<string, any[]>();
  private indexDefinitions = new Map<string, string>(); // index name -> key path

  get(key: any): MockIDBRequest {
    const result = this.data.get(key);
    return new MockIDBRequest(result || null);
  }

  put(value: any): MockIDBRequest {
    const key = value.uri || value.key;
    this.data.set(key, value);

    // Update indexes
    for (const [indexName, keyPath] of this.indexDefinitions) {
      if (!this.indexes.has(indexName)) {
        this.indexes.set(indexName, []);
      }
      const indexData = this.indexes.get(indexName)!;

      // Remove old entry if exists
      const existingIndex = indexData.findIndex(item => item.uri === key);
      if (existingIndex >= 0) {
        indexData[existingIndex] = value;
      } else {
        indexData.push(value);
      }
    }

    return new MockIDBRequest(value);
  }

  delete(key: any): MockIDBRequest {
    const existed = this.data.has(key);
    this.data.delete(key);

    // Update indexes
    for (const [indexName] of this.indexDefinitions) {
      if (this.indexes.has(indexName)) {
        const indexData = this.indexes.get(indexName)!;
        const index = indexData.findIndex(item => item.uri === key);
        if (index >= 0) {
          indexData.splice(index, 1);
        }
      }
    }

    return new MockIDBRequest(existed ? undefined : null);
  }

  clear(): MockIDBRequest {
    this.data.clear();
    this.indexes.clear();
    return new MockIDBRequest(undefined);
  }

  index(name: string): MockIDBIndex {
    return new MockIDBIndex(this.indexes.get(name) || []);
  }

  createIndex(name: string, keyPath: string): void {
    this.indexDefinitions.set(name, keyPath);
    this.indexes.set(name, []);
  }
}

class MockIDBIndex {
  constructor(private data: any[]) {}

  openCursor(): MockIDBRequest {
    const request = new MockIDBRequest(null, false); // Don't auto-trigger for cursor requests

    // Defer cursor processing until after onsuccess handler is set
    queueMicrotask(() => {
      let currentIndex = -1;

      const processNext = () => {
        currentIndex++;
        if (currentIndex < this.data.length) {
          // Set cursor to current item
          request.result = {
            value: this.data[currentIndex],
            continue: () => {
              queueMicrotask(processNext);
            }
          };
          request.onsuccess?.(new Event('success'));
        } else {
          // End of cursor - only call this once at the very end
          request.result = null;
          request.onsuccess?.(new Event('success'));
        }
      };

      // Start processing first item
      processNext();
    });

    return request;
  }
}

class MockIDBRequest {
  public result: any;
  public error: Error | null = null;
  public onsuccess: ((this: MockIDBRequest, ev: Event) => any) | null = null;
  public onerror: ((this: MockIDBRequest, ev: Event) => any) | null = null;
  private autoTrigger: boolean;

  constructor(result: any, autoTrigger: boolean = true) {
    this.result = result;
    this.autoTrigger = autoTrigger;

    // Only auto-trigger for simple requests (not cursor requests)
    if (this.autoTrigger) {
      // Simulate async operation immediately (no setTimeout to avoid leaks)
      queueMicrotask(() => {
        if (this.onsuccess) {
          this.onsuccess.call(this, new Event('success'));
        }
      });
    }
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
    // Simulate async operation using queueMicrotask to avoid timer leaks
    queueMicrotask(() => {
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
    });
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

class MockIDBDeleteDBRequest extends MockIDBRequest {
  public readyState = "pending";

  constructor(
    private databases: Map<string, MockIDBDatabase>,
    private name: string
  ) {
    super(null, false); // Don't auto-trigger, we'll handle it manually

    // Simulate async operation
    setTimeout(() => {
      if (this.databases.has(name)) {
        this.databases.delete(name);
        this.readyState = "done";
        this.onsuccess?.(new Event('success'));
      } else {
        this.error = new Error("Database not found");
        this.readyState = "done";
        this.onerror?.(new Event('error'));
      }
    }, 10);
  }
}

// Replace global indexedDB with mock if not available
if (typeof (globalThis as any).indexedDB === "undefined") {
  (globalThis as any).indexedDB = new MockIndexedDB();
}

//Deno.test("IndexedDBClient - basic operations", async () => {
//  const client = new IndexedDBClient({
//    databaseName: "test-db",
//    storeName: "test-store",
//  });
//
//  await client.cleanup();
//
//  // Test write and read
//  const writeResult = await client.write("test://item", { name: "test" });
//  assertEquals(writeResult.success, true);
//  assertEquals(writeResult.record?.data, { name: "test" });
//  assertEquals(typeof writeResult.record?.ts, "number");
//
//  const readResult = await client.read("test://item");
//  assertEquals(readResult.success, true);
//  assertEquals(readResult.record?.data, { name: "test" });
//
//  // Test read non-existent
//  const readNonExistent = await client.read("test://nonexistent");
//  assertEquals(readNonExistent.success, false);
//  assertEquals(readNonExistent.error, "Not found");
//
//  await client.cleanup();
//});
//
//Deno.test("IndexedDBClient - schema validation", async () => {
//  const client = new IndexedDBClient({
//    databaseName: "test-schema-db",
//    schema: {
//      "users://": async ({ value }) => {
//        if (typeof value === "object" && value !== null && "name" in value) {
//          return { valid: true };
//        }
//        return { valid: false, error: "Users must have a name" };
//      },
//    },
//  });
//
//  await client.cleanup();
//
//  // Valid write
//  const validWrite = await client.write("users://alice", { name: "Alice" });
//  assertEquals(validWrite.success, true);
//
//  // Invalid write
//  const invalidWrite = await client.write("users://bob", { age: 25 });
//  assertEquals(invalidWrite.success, false);
//  assertEquals(invalidWrite.error, "Users must have a name");
//
//  // Write to non-schemad URI
//  const nonSchemaWrite = await client.write("posts://1", { title: "Hello" });
//  assertEquals(nonSchemaWrite.success, true);
//
//  await client.cleanup();
//});
//
//Deno.test("IndexedDBClient - list operations", async () => {
//  const client = new IndexedDBClient({
//    databaseName: "test-list-db",
//  });
//
//  await client.cleanup();
//
//  // Create test data
//  await client.write("test://users/alice", { name: "Alice" });
//  await client.write("test://users/bob", { name: "Bob" });
//  await client.write("test://posts/1", { title: "Post 1" });
//  await client.write("test://posts/2", { title: "Post 2" });
//
//  // List all items (this might not work perfectly with our mock)
//  const listResult = await client.list("test://");
//  assertEquals(Array.isArray(listResult.data), true);
//
//  await client.cleanup();
//});
//
//Deno.test("IndexedDBClient - delete operations", async () => {
//  const client = new IndexedDBClient({
//    databaseName: "test-delete-db",
//  });
//
//  await client.cleanup();
//
//  // Create test data
//  await client.write("test://item", { data: "test" });
//
//  // Delete existing item
//  const deleteResult = await client.delete("test://item");
//  assertEquals(deleteResult.success, true);
//
//  // Verify deletion
//  const readResult = await client.read("test://item");
//  assertEquals(readResult.success, false);
//
//  // Delete non-existent item
//  const deleteNonExistent = await client.delete("test://nonexistent");
//  assertEquals(deleteNonExistent.success, false);
//  assertEquals(deleteNonExistent.error, "Not found");
//
//  await client.cleanup();
//});
//
//Deno.test("IndexedDBClient - health check", async () => {
//  const client = new IndexedDBClient({
//    databaseName: "test-health-db",
//  });
//
//  await client.cleanup();
//
//  const health = await client.health();
//  assertEquals(health.status, "healthy");
//  assertEquals(health.message, "IndexedDB client is operational");
//  assertEquals(health.details?.databaseName, "test-health-db");
//  assertEquals(typeof health.details?.totalRecords, "number");
//
//  await client.cleanup();
//});
//
//Deno.test("IndexedDBClient - getSchema", async () => {
//  const client = new IndexedDBClient({
//    databaseName: "test-schema-list-db",
//    schema: {
//      "users://": async () => ({ valid: true }),
//      "posts://": async () => ({ valid: true }),
//    },
//  });
//
//  const schema = await client.getSchema();
//  assertEquals(schema.length, 2);
//  assertEquals(schema.includes("users://"), true);
//  assertEquals(schema.includes("posts://"), true);
//
//  await client.cleanup();
//});

// Run the shared test suite
const testFactories: TestClientFactories = {
  happy: () => new IndexedDBClient({ databaseName: "shared-test-db" }),
};

runSharedSuite("IndexedDBClient", testFactories);

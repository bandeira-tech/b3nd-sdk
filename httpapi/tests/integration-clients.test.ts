/**
 * Integration tests for different client types
 */

import { assert, assertEquals } from "jsr:@std/assert";
import {
  MemoryClient,
  HttpClient,
  LocalStorageClient,
  IndexedDBClient
} from "@bandeira-tech/b3nd-sdk";
import { getClientManager, resetClientManager } from "../src/clients.ts";
import { makeRequest, assertResponse, cleanupTestClients } from "./test-utils.ts";

/**
 * Test with MemoryClient
 */
Deno.test("Integration - MemoryClient basic operations", async () => {
  resetClientManager();
  const manager = getClientManager();

  const memoryClient = new MemoryClient({
    schema: {
      "memory://": async () => ({ valid: true }),
    },
  });

  manager.registerClient("memory", memoryClient, true);

  try {
    // Write
    const writeResponse = await makeRequest("POST", "/api/v1/write", {
      uri: "memory://test-item",
      value: { data: "memory test" },
    });
    const writeBody = await assertResponse(writeResponse, 201);
    assertEquals(writeBody.success, true);

    // Read
    const readResponse = await makeRequest("GET", "/api/v1/read/memory/memory/test-item");
    const readBody = await assertResponse(readResponse, 200);
    assertEquals(readBody.data, { data: "memory test" });

    // Health
    const healthResponse = await makeRequest("GET", "/api/v1/health");
    const healthBody = await assertResponse(healthResponse, 200);
    assertEquals(healthBody.instances.memory.status, "healthy");
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});

/**
 * Test with LocalStorageClient (browser environment)
 */
Deno.test("Integration - LocalStorageClient operations", async () => {
  resetClientManager();
  const manager = getClientManager();

  const localStorageClient = new LocalStorageClient({
    schema: {
      "local://": async () => ({ valid: true }),
    },
  });

  manager.registerClient("local", localStorageClient, true);

  try {
    // Write
    const writeResponse = await makeRequest("POST", "/api/v1/write", {
      uri: "local://settings",
      value: { theme: "dark", language: "en" },
    });
    const writeBody = await assertResponse(writeResponse, 201);
    assertEquals(writeBody.success, true);

    // Read
    const readResponse = await makeRequest("GET", "/api/v1/read/local/local/settings");
    const readBody = await assertResponse(readResponse, 200);
    assertEquals(readBody.data, { theme: "dark", language: "en" });

    // List
    const listResponse = await makeRequest("GET", "/api/v1/list/local/local");
    const listBody = await assertResponse(listResponse, 200);
    assert(Array.isArray(listBody.data));
    assert(listBody.data.some((item: any) => item.uri === "local://settings"));
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});

/**
 * Test with IndexedDBClient (browser environment)
 */
Deno.test("Integration - IndexedDBClient operations", async () => {
  // Skip in non-browser environments (IndexedDB not available in Deno)
  if (typeof indexedDB === "undefined") {
    console.log("Skipping IndexedDBClient test - not in browser environment");
    return;
  }

  resetClientManager();
  const manager = getClientManager();

  const indexedDBClient = new IndexedDBClient({
    databaseName: `test-httpapi-${Date.now()}`,
    schema: {
      "indexed://": async () => ({ valid: true }),
    },
  });

  manager.registerClient("indexed", indexedDBClient, true);

  try {
    // Write
    const writeResponse = await makeRequest("POST", "/api/v1/write", {
      uri: "indexed://document",
      value: { title: "Test Document", content: "Test content" },
    });
    const writeBody = await assertResponse(writeResponse, 201);
    assertEquals(writeBody.success, true);

    // Read
    const readResponse = await makeRequest("GET", "/api/v1/read/indexed/indexed/document");
    const readBody = await assertResponse(readResponse, 200);
    assertEquals(readBody.data, { title: "Test Document", content: "Test content" });

    // Delete
    const deleteResponse = await makeRequest("DELETE", "/api/v1/delete/indexed/indexed/document");
    const deleteBody = await assertResponse(deleteResponse, 200);
    assertEquals(deleteBody.success, true);

    // Verify deletion
    const verifyResponse = await makeRequest("GET", "/api/v1/read/indexed/indexed/document");
    await assertResponse(verifyResponse, 404);
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});

/**
 * Test with HttpClient (remote API)
 */
Deno.test("Integration - HttpClient with mock server", async () => {
  // This test would require a mock HTTP server
  // For now, we'll test the basic setup
  resetClientManager();
  const manager = getClientManager();

  const httpClient = new HttpClient({
    url: "http://localhost:9999", // Non-existent server
    timeout: 1000, // Short timeout for testing
  });

  manager.registerClient("http", httpClient, true);

  try {
    // Health check should show unhealthy status
    const healthResponse = await makeRequest("GET", "/api/v1/health");
    const healthBody = await assertResponse(healthResponse, 200);

    // The HTTP client should be unhealthy since the server doesn't exist
    assertEquals(healthBody.instances.http.status, "unhealthy");
    assert(healthBody.instances.http.message.includes("unhealthy"));
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});

/**
 * Test multiple client types working together
 */
Deno.test("Integration - multiple client types coexistence", async () => {
  // Skip in non-browser environments
  if (typeof indexedDB === "undefined") {
    console.log("Skipping multiple client types test - not in browser environment");
    return;
  }

  resetClientManager();
  const manager = getClientManager();

  // Set up different client types
  const memoryClient = new MemoryClient({ schema: { "memory://": async () => ({ valid: true }) } });
  const localStorageClient = new LocalStorageClient({ schema: { "local://": async () => ({ valid: true }) } });
  const indexedDBClient = new IndexedDBClient({
    databaseName: `integration-test-${Date.now()}`,
    schema: { "indexed://": async () => ({ valid: true }) }
  });

  manager.registerClient("memory", memoryClient);
  manager.registerClient("local", localStorageClient, true); // default
  manager.registerClient("indexed", indexedDBClient);

  try {
    // Write to each client type
    await makeRequest("POST", "/api/v1/write?instance=memory", {
      uri: "memory://item",
      value: { type: "memory" },
    });

    await makeRequest("POST", "/api/v1/write?instance=local", {
      uri: "local://item",
      value: { type: "local" },
    });

    await makeRequest("POST", "/api/v1/write?instance=indexed", {
      uri: "indexed://item",
      value: { type: "indexed" },
    });

    // Read from each client type
    const memoryRead = await makeRequest("GET", "/api/v1/read/memory/memory/item");
    const memoryBody = await assertResponse(memoryRead, 200);
    assertEquals(memoryBody.data.type, "memory");

    const localRead = await makeRequest("GET", "/api/v1/read/local/local/item");
    const localBody = await assertResponse(localRead, 200);
    assertEquals(localBody.data.type, "local");

    const indexedRead = await makeRequest("GET", "/api/v1/read/indexed/indexed/item");
    const indexedBody = await assertResponse(indexedRead, 200);
    assertEquals(indexedBody.data.type, "indexed");

    // Verify health of all clients
    const healthResponse = await makeRequest("GET", "/api/v1/health");
    const healthBody = await assertResponse(healthResponse, 200);

    assertEquals(healthBody.instances.memory.status, "healthy");
    assertEquals(healthBody.instances.local.status, "healthy");
    assertEquals(healthBody.instances.indexed.status, "healthy");
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});

/**
 * Test client isolation
 */
Deno.test("Integration - client isolation", async () => {
  resetClientManager();
  const manager = getClientManager();

  const client1 = new MemoryClient({ schema: { "test1://": async () => ({ valid: true }) } });
  const client2 = new MemoryClient({ schema: { "test2://": async () => ({ valid: true }) } });

  manager.registerClient("client1", client1);
  manager.registerClient("client2", client2, true);

  try {
    // Write to client1
    await makeRequest("POST", "/api/v1/write?instance=client1", {
      uri: "test1://data",
      value: { client: 1 },
    });

    // Write to client2
    await makeRequest("POST", "/api/v1/write?instance=client2", {
      uri: "test2://data",
      value: { client: 2 },
    });

    // Verify isolation - client1 shouldn't see client2's data
    const client1List = await makeRequest("GET", "/api/v1/list/client1/test1");
    const client1Body = await assertResponse(client1List, 200);
    const client1Uris = client1Body.data.map((item: any) => item.uri);
    assert(client1Uris.includes("test1://data"));
    assert(!client1Uris.includes("test2://data"));

    // Verify isolation - client2 shouldn't see client1's data
    const client2List = await makeRequest("GET", "/api/v1/list/client2/test2");
    const client2Body = await assertResponse(client2List, 200);
    const client2Uris = client2Body.data.map((item: any) => item.uri);
    assert(client2Uris.includes("test2://data"));
    assert(!client2Uris.includes("test1://data"));
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});

/**
 * Test client cleanup
 */
Deno.test("Integration - client cleanup", async () => {
  // Skip in non-browser environments
  if (typeof indexedDB === "undefined") {
    console.log("Skipping client cleanup test - not in browser environment");
    return;
  }

  resetClientManager();
  const manager = getClientManager();

  const memoryClient = new MemoryClient({ schema: { "cleanup://": async () => ({ valid: true }) } });
  const indexedClient = new IndexedDBClient({
    databaseName: `cleanup-test-${Date.now()}`,
    schema: { "cleanup://": async () => ({ valid: true }) }
  });

  manager.registerClient("memory", memoryClient);
  manager.registerClient("indexed", indexedClient, true);

  try {
    // Write some data
    await makeRequest("POST", "/api/v1/write?instance=memory", {
      uri: "cleanup://memory-data",
      value: { type: "memory" },
    });

    await makeRequest("POST", "/api/v1/write?instance=indexed", {
      uri: "cleanup://indexed-data",
      value: { type: "indexed" },
    });

    // Verify data exists
    const memoryRead = await makeRequest("GET", "/api/v1/read/memory/cleanup/memory-data");
    await assertResponse(memoryRead, 200);

    const indexedRead = await makeRequest("GET", "/api/v1/read/indexed/cleanup/indexed-data");
    await assertResponse(indexedRead, 200);

    // Cleanup
    await manager.cleanup();

    // Verify clients are removed
    assertEquals(manager.getInstanceNames().length, 0);
    assertEquals(manager.getDefaultInstance(), undefined);
  } finally {
    resetClientManager();
  }
});

/**
 * Test client schema validation
 */
Deno.test("Integration - client schema validation", async () => {
  resetClientManager();
  const manager = getClientManager();

  const validatedClient = new MemoryClient({
    schema: {
      "validated://": async ({ value }: { value: unknown }) => {
        if (typeof value === "object" && value !== null && "required" in value) {
          return { valid: true };
        }
        return { valid: false, error: "Missing required field" };
      },
    },
  });

  manager.registerClient("validated", validatedClient, true);

  try {
    // Valid data should succeed
    const validResponse = await makeRequest("POST", "/api/v1/write?instance=validated", {
      uri: "validated://item1",
      value: { required: "yes", extra: "data" },
    });
    const validBody = await assertResponse(validResponse, 201);
    assertEquals(validBody.success, true);

    // Invalid data should fail
    const invalidResponse = await makeRequest("POST", "/api/v1/write?instance=validated", {
      uri: "validated://item2",
      value: { missing: "required field" },
    });
    const invalidBody = await assertResponse(invalidResponse, 400);
    assertEquals(invalidBody.success, false);
    assert(invalidBody.error.includes("Missing required field"));
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});
/**
 * Tests for API CRUD operations (read, write, delete, list)
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { setupTestClients, cleanupTestClients, makeRequest, assertResponse, testData } from "./test-utils.ts";

Deno.test("API Operations - write valid data", async () => {
  await setupTestClients();

  try {
    const userData = testData.user("alice", 30);
    const response = await makeRequest("POST", "/api/v1/write", {
      uri: "users://alice",
      value: userData,
    });

    const body = await assertResponse(response, 201);

    assertEquals(body.success, true);
    assert(body.record);
    assertEquals(body.record.data, userData);
    assertEquals(typeof body.record.ts, "number");
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - write with instance parameter", async () => {
  await setupTestClients();

  try {
    const postData = testData.post("My Post", "Content here");
    const response = await makeRequest("POST", "/api/v1/write?instance=test", {
      uri: "posts://test-post",
      value: postData,
    });

    const body = await assertResponse(response, 201);

    assertEquals(body.success, true);
    assert(body.record);
    assertEquals(body.record.data, postData);
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - write with schema validation failure", async () => {
  await setupTestClients();

  try {
    // Invalid user data (no name)
    const invalidUser = { age: 25 };
    const response = await makeRequest("POST", "/api/v1/write", {
      uri: "users://invalid",
      value: invalidUser,
    });

    const body = await assertResponse(response, 400);

    assertEquals(body.success, false);
    assert(body.error);
    assert(body.error.includes("Users must have a name"));
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - write non-schemad URI", async () => {
  await setupTestClients();

  try {
    const data = { anything: "goes" };
    const response = await makeRequest("POST", "/api/v1/write", {
      uri: "random://data",
      value: data,
    });

    const body = await assertResponse(response, 201);

    assertEquals(body.success, true);
    assert(body.record);
    assertEquals(body.record.data, data);
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - write invalid request body", async () => {
  await setupTestClients();

  try {
    // Missing required fields
    const response = await makeRequest("POST", "/api/v1/write", {
      value: { data: "test" },
    });

    const body = await assertResponse(response, 400);

    assertEquals(body.error, "Validation failed");
    assert(Array.isArray(body.details));
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - read existing data", async () => {
  await setupTestClients();

  try {
    // First write some data
    const userData = testData.user("bob", 25);
    await makeRequest("POST", "/api/v1/write", {
      uri: "users://bob",
      value: userData,
    });

    // Then read it back
    const response = await makeRequest("GET", "/api/v1/read/default/users/bob");
    const body = await assertResponse(response, 200);

    assertEquals(body.data, userData);
    assertEquals(typeof body.ts, "number");
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - read non-existent data", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("GET", "/api/v1/read/default/users/nonexistent");
    const body = await assertResponse(response, 404);

    assertEquals(body.error, "Record not found");
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - read with different instance", async () => {
  await setupTestClients();

  try {
    // Write to test instance
    const data = { test: "data" };
    await makeRequest("POST", "/api/v1/write?instance=test", {
      uri: "test://item",
      value: data,
    });

    // Read from test instance
    const response = await makeRequest("GET", "/api/v1/read/test/test/item");
    const body = await assertResponse(response, 200);

    assertEquals(body.data, data);
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - delete existing data", async () => {
  await setupTestClients();

  try {
    // First write some data
    await makeRequest("POST", "/api/v1/write", {
      uri: "users://delete-me",
      value: testData.user("delete-me"),
    });

    // Delete it
    const response = await makeRequest("DELETE", "/api/v1/delete/users/delete-me");
    const body = await assertResponse(response, 200);

    assertEquals(body.success, true);

    // Verify it's gone
    const readResponse = await makeRequest("GET", "/api/v1/read/default/users/delete-me");
    await assertResponse(readResponse, 404);
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - delete non-existent data", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("DELETE", "/api/v1/delete/users/nonexistent");
    const body = await assertResponse(response, 400);

    assertEquals(body.success, false);
    assert(body.error);
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - delete with instance parameter", async () => {
  await setupTestClients();

  try {
    // Write to test instance
    await makeRequest("POST", "/api/v1/write?instance=test", {
      uri: "test://delete-me",
      value: { data: "test" },
    });

    // Delete from test instance
    const response = await makeRequest("DELETE", "/api/v1/delete/test/delete-me?instance=test");
    const body = await assertResponse(response, 200);

    assertEquals(body.success, true);
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - list root directory", async () => {
  await setupTestClients();

  try {
    // Create some test data
    await makeRequest("POST", "/api/v1/write", {
      uri: "users://alice",
      value: testData.user("alice"),
    });
    await makeRequest("POST", "/api/v1/write", {
      uri: "users://bob",
      value: testData.user("bob"),
    });

    // List users directory
    const response = await makeRequest("GET", "/api/v1/list/default/users");
    const body = await assertResponse(response, 200);

    assert(Array.isArray(body.data));
    assertEquals(typeof body.pagination, "object");
    assertEquals(body.pagination.page, 1);
    assertEquals(body.pagination.limit, 50);

    // Should contain alice and bob
    const uris = body.data.map((item: any) => item.uri);
    assert(uris.includes("users://alice"));
    assert(uris.includes("users://bob"));
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - list with pagination", async () => {
  await setupTestClients();

  try {
    // Create multiple items
    for (let i = 0; i < 10; i++) {
      await makeRequest("POST", "/api/v1/write", {
        uri: `posts://post-${i}`,
        value: testData.post(`Post ${i}`),
      });
    }

    // List with custom pagination
    const response = await makeRequest("GET", "/api/v1/list/default/posts?page=2&limit=3");
    const body = await assertResponse(response, 200);

    assertEquals(body.pagination.page, 2);
    assertEquals(body.pagination.limit, 3);
    assert(Array.isArray(body.data));
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - list with instance parameter", async () => {
  await setupTestClients();

  try {
    // Create data in test instance
    await makeRequest("POST", "/api/v1/write?instance=test", {
      uri: "test://item1",
      value: { name: "Item 1" },
    });
    await makeRequest("POST", "/api/v1/write?instance=test", {
      uri: "test://item2",
      value: { name: "Item 2" },
    });

    // List from test instance
    const response = await makeRequest("GET", "/api/v1/list/test/test");
    const body = await assertResponse(response, 200);

    assert(Array.isArray(body.data));
    const uris = body.data.map((item: any) => item.uri);
    assert(uris.includes("test://item1"));
    assert(uris.includes("test://item2"));
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - list empty directory", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("GET", "/api/v1/list/default/empty");
    const body = await assertResponse(response, 200);

    assert(Array.isArray(body.data));
    assertEquals(body.data.length, 0);
    assertEquals(body.pagination.page, 1);
    assertEquals(body.pagination.limit, 50);
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Operations - complex nested path operations", async () => {
  await setupTestClients();

  try {
    // Create nested structure
    await makeRequest("POST", "/api/v1/write", {
      uri: "users://alice/profile/settings",
      value: { theme: "dark" },
    });
    await makeRequest("POST", "/api/v1/write", {
      uri: "users://alice/posts/post1",
      value: testData.post("Alice's Post"),
    });

    // Read nested data
    const readResponse = await makeRequest("GET", "/api/v1/read/default/users/alice/profile/settings");
    const readBody = await assertResponse(readResponse, 200);
    assertEquals(readBody.data, { theme: "dark" });

    // List nested directory
    const listResponse = await makeRequest("GET", "/api/v1/list/default/users/alice");
    const listBody = await assertResponse(listResponse, 200);
    assert(Array.isArray(listBody.data));

    const uris = listBody.data.map((item: any) => item.uri);
    assert(uris.includes("users://alice/profile"));
    assert(uris.includes("users://alice/posts"));
  } finally {
    await cleanupTestClients();
  }
});
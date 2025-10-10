/**
 * Tests for API error handling and edge cases
 */

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { setupTestClients, cleanupTestClients, makeRequest, assertResponse, testData } from "./test-utils.ts";

Deno.test("API Errors - invalid JSON in request body", async () => {
  await setupTestClients();

  try {
    // Create a request with invalid JSON body
    const { app } = await import("../src/mod.ts");
    const request = new Request("http://localhost:8000/api/v1/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json",
    });

    const response = await app.fetch(request);
    const body = await assertResponse(response, 500);
    assertEquals(typeof body.error, "string");
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - non-existent instance", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("POST", "/api/v1/write?instance=nonexistent", {
      uri: "test://item",
      value: { data: "test" },
    });

    const body = await assertResponse(response, 404);
    assertEquals(body.error, "Instance not found");
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - invalid URI format", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("POST", "/api/v1/write", {
      uri: "invalid-uri-format",
      value: { data: "test" },
    });

    const body = await assertResponse(response, 400);
    assertEquals(body.error, "Validation failed");
    assert(Array.isArray(body.details));
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - invalid path parameters", async () => {
  await setupTestClients();

  try {
    // Empty path
    const response = await makeRequest("GET", "/api/v1/read/default/users/");
    const body = await assertResponse(response, 404);
    assertEquals(body.error, "Record not found");
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - invalid pagination parameters", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("GET", "/api/v1/list/default/users?page=0&limit=200");
    const body = await assertResponse(response, 400);
    assertEquals(body.error, "Validation failed");
    assert(Array.isArray(body.details));
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - malformed query parameters", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("GET", "/api/v1/list/default/users?page=abc&limit=xyz");
    const body = await assertResponse(response, 400);
    assertEquals(body.error, "Validation failed");
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - very large request body", async () => {
  await setupTestClients();

  try {
    // Create a very large object
    const largeData = Array(1000).fill(0).map((_, i) => ({
      id: i,
      data: "x".repeat(1000),
    }));

    const response = await makeRequest("POST", "/api/v1/write", {
      uri: "test://large",
      value: largeData,
    });

    // Should handle it gracefully
    const body = await assertResponse(response, 201);
    assertEquals(body.success, true);
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - special characters in URIs", async () => {
  await setupTestClients();

  try {
    // Test with special characters that need encoding
    const specialUri = "users://user with spaces/and/special@chars";
    const encodedUri = encodeURIComponent(specialUri).replace(/%3A/g, ":").replace(/%2F/g, "/");

    const response = await makeRequest("POST", "/api/v1/write", {
      uri: specialUri,
      value: { name: "Special User" },
    });

    const body = await assertResponse(response, 201);
    assertEquals(body.success, true);
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - concurrent operations", async () => {
  await setupTestClients();

  try {
    // Perform multiple concurrent writes
    const promises = Array(10).fill(0).map((_, i) =>
      makeRequest("POST", "/api/v1/write", {
        uri: `test://concurrent-${i}`,
        value: { index: i },
      })
    );

    const responses = await Promise.all(promises);

    // All should succeed
    for (const response of responses) {
      const body = await assertResponse(response, 201);
      assertEquals(body.success, true);
    }

    // Verify all data was written
    for (let i = 0; i < 10; i++) {
      const readResponse = await makeRequest("GET", `/api/v1/read/default/test/concurrent-${i}`);
      const readBody = await assertResponse(readResponse, 200);
      assertEquals(readBody.data.index, i);
    }
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - rapid sequential operations", async () => {
  await setupTestClients();

  try {
    const key = "rapid-test";

    // Rapid write/read/delete cycles
    for (let i = 0; i < 5; i++) {
      // Write
      const writeResponse = await makeRequest("POST", "/api/v1/write", {
        uri: `test://${key}-${i}`,
        value: { iteration: i },
      });
      await assertResponse(writeResponse, 201);

      // Read
      const readResponse = await makeRequest("GET", `/api/v1/read/default/test/${key}-${i}`);
      const readBody = await assertResponse(readResponse, 200);
      assertEquals(readBody.data.iteration, i);

      // Delete
      const deleteResponse = await makeRequest("DELETE", `/api/v1/delete/test/${key}-${i}`);
      await assertResponse(deleteResponse, 200);

      // Verify deletion
      const verifyResponse = await makeRequest("GET", `/api/v1/read/default/test/${key}-${i}`);
      await assertResponse(verifyResponse, 404);
    }
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - maximum URL length", async () => {
  await setupTestClients();

  try {
    // Create a very long path
    const longPath = "x".repeat(200);
    const response = await makeRequest("GET", `/api/v1/read/default/test/${longPath}`);

    // Should handle gracefully (either 404 or 414)
    assert([404, 414].includes(response.status));
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - empty request body", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("POST", "/api/v1/write", {});
    const body = await assertResponse(response, 400);
    assertEquals(body.error, "Validation failed");
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Errors - null and undefined values", async () => {
  await setupTestClients();

  try {
    // Test null value
    const nullResponse = await makeRequest("POST", "/api/v1/write", {
      uri: "test://null",
      value: null,
    });
    const nullBody = await assertResponse(nullResponse, 201);
    assertEquals(nullBody.success, true);

    // Test undefined (should be serialized as null)
    const undefinedResponse = await makeRequest("POST", "/api/v1/write", {
      uri: "test://undefined",
      value: undefined,
    });
    const undefinedBody = await assertResponse(undefinedResponse, 201);
    assertEquals(undefinedBody.success, true);
  } finally {
    await cleanupTestClients();
  }
});

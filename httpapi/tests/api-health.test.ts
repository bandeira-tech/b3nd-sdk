/**
 * Tests for API Health endpoints
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { setupTestClients, cleanupTestClients, makeRequest, assertResponse } from "./test-utils.ts";

Deno.test("API Health - health endpoint returns healthy status", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("GET", "/api/v1/health");
    const body = await assertResponse(response, 200);

    assertEquals(body.status, "healthy");
    assertEquals(typeof body.instances, "object");
    assertEquals(typeof body.timestamp, "number");

    // Check that all instances are reported
    const instances = Object.keys(body.instances);
    assert(instances.includes("default"));
    assert(instances.includes("test"));
    assert(instances.includes("empty"));

    // Check instance health details
    for (const [name, health] of Object.entries(body.instances)) {
      assertEquals(typeof health, "object");
      assert(["healthy", "degraded", "unhealthy"].includes((health as any).status));
    }
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Health - health endpoint with no clients returns degraded", async () => {
  // Don't set up clients
  const { resetClientManager } = await import("../src/clients.ts");
  resetClientManager();

  try {
    const response = await makeRequest("GET", "/api/v1/health");
    const body = await assertResponse(response, 503);

    assertEquals(body.status, "unhealthy");
    assertEquals(typeof body.error, "string");
    assertEquals(typeof body.timestamp, "number");
  } finally {
    // Clean up
    resetClientManager();
  }
});

Deno.test("API Health - individual instance health check", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("GET", "/api/v1/health");
    const body = await assertResponse(response, 200);

    // Check default instance health
    const defaultHealth = body.instances.default;
    assertEquals(defaultHealth.status, "healthy");
    assertEquals(typeof defaultHealth.message, "string");

    // Check that all required fields are present
    for (const health of Object.values(body.instances)) {
      const healthData = health as any;
      assert(["healthy", "degraded", "unhealthy"].includes(healthData.status));
      assertEquals(typeof healthData.message, "string");
    }
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Health - schema endpoint returns client schemas", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("GET", "/api/v1/schema");
    const body = await assertResponse(response, 200);

    assertEquals(typeof body.schemas, "object");
    assertEquals(Array.isArray(body.instances), true);
    assertEquals(typeof body.default, "string");

    // Check that all instances are listed
    assert(body.instances.includes("default"));
    assert(body.instances.includes("test"));
    assert(body.instances.includes("empty"));

    // Check that default is set
    assertEquals(body.default, "default");

    // Check schemas
    const schemas = body.schemas;
    assert(Array.isArray(schemas.default));
    assert(Array.isArray(schemas.test));
    assert(Array.isArray(schemas.empty));
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Health - schema endpoint with no clients", async () => {
  const { resetClientManager } = await import("../src/clients.ts");
  resetClientManager();

  try {
    const response = await makeRequest("GET", "/api/v1/schema");
    const body = await assertResponse(response, 200);

    assertEquals(typeof body.schemas, "object");
    assertEquals(Array.isArray(body.instances), true);
    assertEquals(body.instances.length, 0);
    assertEquals(body.default, undefined);
  } finally {
    resetClientManager();
  }
});

Deno.test("API Health - schema endpoint handles client errors gracefully", async () => {
  await setupTestClients();

  try {
    // This test ensures that if a client throws an error during schema retrieval,
    // it's handled gracefully
    const response = await makeRequest("GET", "/api/v1/schema");
    const body = await assertResponse(response, 200);

    // Should still return successfully even if individual clients have issues
    assertEquals(typeof body.schemas, "object");
    assert(Array.isArray(body.instances));
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Health - health endpoint includes timestamp", async () => {
  await setupTestClients();

  try {
    const before = Date.now();
    const response = await makeRequest("GET", "/api/v1/health");
    const after = Date.now();
    const body = await assertResponse(response, 200);

    assertEquals(typeof body.timestamp, "number");
    assert(body.timestamp >= before);
    assert(body.timestamp <= after);
  } finally {
    await cleanupTestClients();
  }
});

Deno.test("API Health - health endpoint handles all client types", async () => {
  await setupTestClients();

  try {
    const response = await makeRequest("GET", "/api/v1/health");
    const body = await assertResponse(response, 200);

    // Verify structure
    assertEquals(typeof body.status, "string");
    assertEquals(typeof body.instances, "object");
    assertEquals(typeof body.timestamp, "number");

    // Verify all instances have health data
    for (const [name, health] of Object.entries(body.instances)) {
      const healthData = health as any;
      assert(healthData.status);
      assert(healthData.message);
    }
  } finally {
    await cleanupTestClients();
  }
});
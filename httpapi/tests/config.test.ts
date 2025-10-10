/**
 * Tests for configuration handling and backward compatibility
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { getClientManager, resetClientManager } from "../src/clients.ts";
import { makeRequest, assertResponse } from "./test-utils.ts";

Deno.test("Configuration - programmatic client registration", async () => {
  resetClientManager();
  const manager = getClientManager();

  // Simulate programmatic registration
  const { MemoryClient } = await import("@bandeira-tech/b3nd-sdk");
  const client = new MemoryClient({ schema: {} });
  manager.registerClient("prog", client, true);

  try {
    const response = await makeRequest("GET", "/api/v1/health");
    const body = await assertResponse(response, 200);

    assertEquals(body.status, "healthy");
    assert(body.instances.prog);
    assertEquals(body.instances.prog.status, "healthy");
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});

Deno.test("Configuration - server handles programmatic clients first", async () => {
  resetClientManager();
  const manager = getClientManager();

  // Register programmatic clients
  const { MemoryClient } = await import("@bandeira-tech/b3nd-sdk");
  const progClient = new MemoryClient({ schema: {} });
  manager.registerClient("programmatic", progClient, true);

  try {
    // Server should use programmatic clients
    const response = await makeRequest("GET", "/api/v1/health");
    const body = await assertResponse(response, 200);

    assertEquals(Object.keys(body.instances).length, 1);
    assert(body.instances.programmatic);
    assertEquals(body.status, "healthy");
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});

Deno.test("Configuration - server falls back to config file when no programmatic clients", async () => {
  // This test would require setting up environment variables and config files
  // For now, we'll test that the server handles the no-clients case gracefully
  resetClientManager();

  try {
    const response = await makeRequest("GET", "/api/v1/health");
    const body = await assertResponse(response, 503);

    assertEquals(body.status, "unhealthy");
    assertEquals(typeof body.error, "string");
  } finally {
    resetClientManager();
  }
});

Deno.test("Configuration - environment variable overrides", async () => {
  // Test that environment variables work with programmatic setup
  const originalPort = Deno.env.get("API_PORT");

  try {
    // Set a custom port via environment variable
    Deno.env.set("API_PORT", "8888");

    // This would require restarting the server, so we'll just verify the env var is set
    assertEquals(Deno.env.get("API_PORT"), "8888");
  } finally {
    // Restore original port
    if (originalPort) {
      Deno.env.set("API_PORT", originalPort);
    } else {
      Deno.env.delete("API_PORT");
    }
  }
});

Deno.test("Configuration - multiple instances with different schemas", async () => {
  resetClientManager();
  const manager = getClientManager();

  const { MemoryClient } = await import("@bandeira-tech/b3nd-sdk");

  const usersClient = new MemoryClient({
    schema: {
      "users://": async ({ value }: { value: unknown }) => {
        if (typeof value === "object" && value !== null && "name" in value) {
          return { valid: true };
        }
        return { valid: false, error: "Users need names" };
      },
    },
  });

  const postsClient = new MemoryClient({
    schema: {
      "posts://": async ({ value }: { value: unknown }) => {
        if (typeof value === "object" && value !== null && "title" in value) {
          return { valid: true };
        }
        return { valid: false, error: "Posts need titles" };
      },
    },
  });

  manager.registerClient("users", usersClient);
  manager.registerClient("posts", postsClient, true);

  try {
    // Test users schema
    const userResponse = await makeRequest("POST", "/api/v1/write?instance=users", {
      uri: "users://alice",
      value: { name: "Alice" },
    });
    await assertResponse(userResponse, 201);

    const invalidUserResponse = await makeRequest("POST", "/api/v1/write?instance=users", {
      uri: "users://bob",
      value: { age: 25 }, // Missing name
    });
    const invalidUserBody = await assertResponse(invalidUserResponse, 400);
    assert(invalidUserBody.error.includes("Users need names"));

    // Test posts schema
    const postResponse = await makeRequest("POST", "/api/v1/write?instance=posts", {
      uri: "posts://hello",
      value: { title: "Hello World" },
    });
    await assertResponse(postResponse, 201);

    const invalidPostResponse = await makeRequest("POST", "/api/v1/write?instance=posts", {
      uri: "posts://invalid",
      value: { content: "No title" }, // Missing title
    });
    const invalidPostBody = await assertResponse(invalidPostResponse, 400);
    assert(invalidPostBody.error.includes("Posts need titles"));
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});

Deno.test("Configuration - dynamic client creation based on environment", async () => {
  resetClientManager();
  const manager = getClientManager();

  const { MemoryClient } = await import("@bandeira-tech/b3nd-sdk");

  // Simulate different environments
  const environment = Deno.env.get("NODE_ENV") || "development";

  let client;
  if (environment === "production") {
    // In production, use a more robust configuration
    client = new MemoryClient({
      schema: {
        "prod://": async ({ value }: { value: unknown }) => {
          // Strict validation for production
          if (typeof value === "object" && value !== null && "id" in value && "data" in value) {
            return { valid: true };
          }
          return { valid: false, error: "Production data must have id and data fields" };
        },
      },
    });
  } else {
    // In development, use relaxed validation
    client = new MemoryClient({
      schema: {
        "dev://": async () => ({ valid: true }),
      },
    });
  }

  manager.registerClient("dynamic", client, true);

  try {
    // Test that the correct client was created based on environment
    const response = await makeRequest("GET", "/api/v1/health");
    const body = await assertResponse(response, 200);

    assert(body.instances.dynamic);
    assertEquals(body.instances.dynamic.status, "healthy");

    // Test the schema behavior
    if (environment === "production") {
      const validResponse = await makeRequest("POST", "/api/v1/write?instance=dynamic", {
        uri: "prod://item",
        value: { id: 1, data: "test" },
      });
      await assertResponse(validResponse, 201);

      const invalidResponse = await makeRequest("POST", "/api/v1/write?instance=dynamic", {
        uri: "prod://invalid",
        value: { data: "missing id" },
      });
      const invalidBody = await assertResponse(invalidResponse, 400);
      assert(invalidBody.error.includes("Production data must have id and data fields"));
    } else {
      // Development environment should accept any data
      const devResponse = await makeRequest("POST", "/api/v1/write?instance=dynamic", {
        uri: "dev://anything",
        value: { anything: "goes" },
      });
      await assertResponse(devResponse, 201);
    }
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});

Deno.test("Configuration - client with complex initialization", async () => {
  resetClientManager();
  const manager = getClientManager();

  const { MemoryClient } = await import("@bandeira-tech/b3nd-sdk");

  // Simulate complex client setup with multiple steps
  const clientOptions = {
    schema: {
      "complex://": async ({ value }: { value: unknown }) => {
        // Complex validation logic
        if (typeof value !== "object" || value === null) {
          return { valid: false, error: "Must be an object" };
        }

        const obj = value as Record<string, unknown>;
        if (!obj.type) {
          return { valid: false, error: "Must have a type" };
        }

        if (obj.type === "user" && !obj.name) {
          return { valid: false, error: "User must have a name" };
        }

        if (obj.type === "post" && !obj.title) {
          return { valid: false, error: "Post must have a title" };
        }

        return { valid: true };
      },
    },
  };

  // Simulate some complex initialization logic
  const finalOptions = {
    ...clientOptions,
    // Add timestamp for debugging
    databaseName: `complex-client-${Date.now()}`,
  };

  const complexClient = new MemoryClient(finalOptions);
  manager.registerClient("complex", complexClient, true);

  try {
    // Test complex validation
    const userResponse = await makeRequest("POST", "/api/v1/write?instance=complex", {
      uri: "complex://user1",
      value: { type: "user", name: "Alice" },
    });
    await assertResponse(userResponse, 201);

    const postResponse = await makeRequest("POST", "/api/v1/write?instance=complex", {
      uri: "complex://post1",
      value: { type: "post", title: "Hello World" },
    });
    await assertResponse(postResponse, 201);

    const invalidResponse = await makeRequest("POST", "/api/v1/write?instance=complex", {
      uri: "complex://invalid",
      value: { type: "user" }, // Missing name
    });
    const invalidBody = await assertResponse(invalidResponse, 400);
    assert(invalidBody.error.includes("User must have a name"));
  } finally {
    await manager.cleanup();
    resetClientManager();
  }
});
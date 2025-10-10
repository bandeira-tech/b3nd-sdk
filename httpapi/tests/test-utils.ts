/**
 * Test utilities and helpers for httpapi testing
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { type NodeProtocolInterface, MemoryClient } from "@bandeira-tech/b3nd-sdk";
import { getClientManager, resetClientManager } from "../src/clients.ts";

/**
 * Test client factory - creates memory clients for testing
 */
export function createTestClient(name: string, schema?: Record<string, any>): NodeProtocolInterface {
  return new MemoryClient({
    schema: schema || {}
  });
}

/**
 * Setup test environment with clients
 */
export async function setupTestClients() {
  resetClientManager();
  const manager = getClientManager();

  // Create test clients
  const defaultClient = createTestClient("default", {
    "users://": async ({ value }: { value: unknown }) => {
      if (typeof value === "object" && value !== null && "name" in value) {
        return { valid: true };
      }
      return { valid: false, error: "Users must have a name" };
    },
    "posts://": async ({ value }: { value: unknown }) => {
      if (typeof value === "object" && value !== null && "title" in value) {
        return { valid: true };
      }
      return { valid: false, error: "Posts must have a title" };
    },
    // Test protocol for API error tests
    "test://": async () => ({ valid: true }),
    "random://": async () => ({ valid: true }),
    // Accept all other protocols without validation
    "*": async () => ({ valid: true }),
  });

  const testClient = createTestClient("test", {
    // Test client accepts all data
    "test://": async () => ({ valid: true }),
    "posts://": async () => ({ valid: true }),
    "indexed://": async () => ({ valid: true }),
    "cleanup://": async () => ({ valid: true }),
  });
  const emptyClient = createTestClient("empty", {
    "empty://": async () => ({ valid: true }),
  });

  // Register clients
  manager.registerClient("default", defaultClient, true);
  manager.registerClient("test", testClient);
  manager.registerClient("empty", emptyClient);

  return { manager, defaultClient, testClient, emptyClient };
}

/**
 * Cleanup test environment
 */
export async function cleanupTestClients() {
  const manager = getClientManager();
  await manager.cleanup();
  resetClientManager();
}

/**
 * Create a test request helper
 */
export async function makeRequest(
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<Response> {
  const url = `http://localhost:8000${path}`;
  const requestHeaders = {
    "Content-Type": "application/json",
    ...headers,
  };

  const request = new Request(url, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Import app dynamically to avoid circular dependencies
  const { app } = await import("../src/mod.ts");
  return await app.fetch(request);
}

/**
 * Parse JSON response
 */
export async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text}`);
  }
}

/**
 * Assert response status and optionally parse JSON
 */
export async function assertResponse(
  response: Response,
  expectedStatus: number,
  expectedBody?: any
): Promise<any> {
  assertEquals(response.status, expectedStatus,
    `Expected status ${expectedStatus}, got ${response.status}`);

  if (expectedBody !== undefined) {
    const body = await parseJsonResponse(response);
    assertEquals(body, expectedBody);
    return body;
  }

  if (response.headers.get("content-type")?.includes("application/json")) {
    return await parseJsonResponse(response);
  }

  return await response.text();
}

/**
 * Test data factories
 */
export const testData = {
  user: (name = "testuser", age = 25) => ({
    name,
    age,
    email: `${name}@example.com`,
  }),

  post: (title = "Test Post", content = "Test content") => ({
    title,
    content,
    published: true,
  }),

  comment: (text = "Great post!") => ({
    text,
    author: "Anonymous",
  }),
};

/**
 * Delay utility for timing tests
 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
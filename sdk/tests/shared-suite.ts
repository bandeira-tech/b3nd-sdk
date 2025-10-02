/**
 * Shared Test Suite for NodeProtocolInterface
 *
 * This suite tests that any implementation of NodeProtocolInterface
 * behaves correctly according to the protocol specification.
 *
 * Each client test file imports and runs this suite with factory functions
 * that create fresh client instances for each test.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import type { NodeProtocolInterface } from "../src/types.ts";

/**
 * Test client factory functions for different scenarios
 */
export interface TestClientFactories {
  /** Factory for working client (happy path tests) */
  happy: () => NodeProtocolInterface | Promise<NodeProtocolInterface>;

  /** Factory for client that simulates connection/network errors */
  connectionError?: () =>
    | NodeProtocolInterface
    | Promise<NodeProtocolInterface>;

  /** Factory for client that simulates validation errors */
  validationError?: () =>
    | NodeProtocolInterface
    | Promise<NodeProtocolInterface>;
}

/**
 * Run the complete shared test suite against provided client factories
 */
export function runSharedSuite(
  suiteName: string,
  factories: TestClientFactories,
) {
  // Happy path tests
  Deno.test({
    name: `${suiteName} - write and read`,
    sanitizeOps: false, // Mock servers run in background
    sanitizeResources: false,
    fn: async () => {
    const client = await Promise.resolve(factories.happy());

    const writeResult = await client.write("users://alice/profile", {
      name: "Alice",
      email: "alice@example.com",
    });

    assertEquals(writeResult.success, true);
    assertEquals(writeResult.record?.data, {
      name: "Alice",
      email: "alice@example.com",
    });

    const readResult = await client.read("users://alice/profile");

    assertEquals(readResult.success, true);
    assertEquals(readResult.record?.data, {
      name: "Alice",
      email: "alice@example.com",
    });

    await client.cleanup();
    },
  });

  Deno.test(`${suiteName} - write creates timestamp`, async () => {
    const client = await Promise.resolve(factories.happy());

    const before = Date.now();
    const writeResult = await client.write("users://bob/profile", {
      name: "Bob",
    });
    const after = Date.now();

    assertEquals(writeResult.success, true);
    assertEquals(typeof writeResult.record?.ts, "number");
    assertEquals(writeResult.record!.ts >= before, true);
    assertEquals(writeResult.record!.ts <= after, true);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - read non-existent returns error`, async () => {
    const client = await Promise.resolve(factories.happy());

    const readResult = await client.read("users://nobody/profile");

    assertEquals(readResult.success, false);
    assertEquals(typeof readResult.error, "string");

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list returns items`, async () => {
    const client = await Promise.resolve(factories.happy());

    // Write some items
    await client.write("users://alice/profile", { name: "Alice" });
    await client.write("users://bob/profile", { name: "Bob" });
    await client.write("users://charlie/profile", { name: "Charlie" });

    const listResult = await client.list("users://");

    assertEquals(listResult.data.length >= 3, true,
      `Expected at least 3 items but got ${listResult.data.length}`);
    assertEquals(Array.isArray(listResult.data), true);
    assertEquals(typeof listResult.pagination.page, "number");
    assertEquals(typeof listResult.pagination.limit, "number");

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list with pagination`, async () => {
    const client = await Promise.resolve(factories.happy());

    // Write multiple items
    for (let i = 0; i < 10; i++) {
      await client.write(`users://user${i}/profile`, { name: `User ${i}` });
    }

    const page1 = await client.list("users://", { page: 1, limit: 5 });
    assertEquals(page1.pagination.page, 1);
    assertEquals(page1.pagination.limit, 5);

    const page2 = await client.list("users://", { page: 2, limit: 5 });
    assertEquals(page2.pagination.page, 2);
    assertEquals(page2.pagination.limit, 5);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list with pattern filter`, async () => {
    const client = await Promise.resolve(factories.happy());

    await client.write("users://alice/profile", { name: "Alice" });
    await client.write("users://bob/profile", { name: "Bob" });
    await client.write("users://alice/settings", { theme: "dark" });

    const listResult = await client.list("users://", { pattern: "alice" });

    assertEquals(
      listResult.data.every((item) => item.uri.includes("alice")),
      true,
    );

    await client.cleanup();
  });

  Deno.test(`${suiteName} - delete removes item`, async () => {
    const client = await Promise.resolve(factories.happy());

    await client.write("users://temp/data", { value: 123 });

    const deleteResult = await client.delete("users://temp/data");
    assertEquals(deleteResult.success, true);

    const readResult = await client.read("users://temp/data");
    assertEquals(readResult.success, false);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - delete non-existent returns error`, async () => {
    const client = await Promise.resolve(factories.happy());

    const deleteResult = await client.delete("users://nonexistent/data");
    assertEquals(deleteResult.success, false);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - health returns status`, async () => {
    const client = await Promise.resolve(factories.happy());

    const health = await client.health();

    assertEquals(typeof health.status, "string");
    assertEquals(
      ["healthy", "degraded", "unhealthy"].includes(health.status),
      true,
    );

    await client.cleanup();
  });

  Deno.test(`${suiteName} - getSchema returns array`, async () => {
    const client = await Promise.resolve(factories.happy());

    const schema = await client.getSchema();

    assertEquals(Array.isArray(schema), true);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - cleanup does not throw`, async () => {
    const client = await Promise.resolve(factories.happy());

    await client.cleanup();
    assertEquals(true, true);
  });

  // Validation error tests (if validationError factory provided)
  if (factories.validationError) {
    Deno.test(`${suiteName} - validation error on write`, async () => {
      const client = await Promise.resolve(factories.validationError!());

      const writeResult = await client.write("users://invalid/data", {
        invalid: true,
      });

      assertEquals(writeResult.success, false);
      assertEquals(typeof writeResult.error, "string");

      await client.cleanup();
    });
  }

  // Connection error tests (if connectionError factory provided)
  if (factories.connectionError) {
    Deno.test(`${suiteName} - connection error handling`, async () => {
      const client = await Promise.resolve(factories.connectionError!());

      const writeResult = await client.write("users://test/data", {
        value: 123,
      });

      assertEquals(writeResult.success, false);
      assertEquals(typeof writeResult.error, "string");

      const readResult = await client.read("users://test/data");
      assertEquals(readResult.success, false);

      await client.cleanup();
    });
  }
}

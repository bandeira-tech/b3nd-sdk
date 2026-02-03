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

  /** Whether the client supports binary (Uint8Array) data. Defaults to true. */
  supportsBinary?: boolean;
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
    name: `${suiteName} - receive transaction and read`,
    sanitizeOps: false, // Mock servers run in background
    sanitizeResources: false,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const result = await client.receive(["store://users/alice/profile", {
        name: "Alice",
        email: "alice@example.com",
      }]);

      assertEquals(result.accepted, true);

      const readResult = await client.read("store://users/alice/profile");

      assertEquals(readResult.success, true);
      assertEquals(readResult.record?.data, {
        name: "Alice",
        email: "alice@example.com",
      });

      await client.cleanup();
    },
  });

  Deno.test(`${suiteName} - receive transaction creates timestamp`, async () => {
    const client = await Promise.resolve(factories.happy());

    const before = Date.now();
    const result = await client.receive(["store://users/bob/profile", {
      name: "Bob",
    }]);
    const after = Date.now();

    assertEquals(result.accepted, true);

    // Verify timestamp via read
    const readResult = await client.read("store://users/bob/profile");
    assertEquals(readResult.success, true);
    assertEquals(typeof readResult.record?.ts, "number");
    assertEquals(readResult.record!.ts >= before, true);
    assertEquals(readResult.record!.ts <= after, true);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - read non-existent returns error`, async () => {
    const client = await Promise.resolve(factories.happy());

    const readResult = await client.read("store://users/nobody/profile");

    assertEquals(readResult.success, false);
    assertEquals(typeof readResult.error, "string");

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list returns items`, async () => {
    const client = await Promise.resolve(factories.happy());

    // Receive some transactions
    await client.receive(["store://users/alice/profile", { name: "Alice" }]);
    await client.receive(["store://users/bob/profile", { name: "Bob" }]);
    await client.receive(["store://users/charlie/profile", { name: "Charlie" }]);

    const listResult = await client.list("store://users");

    assertEquals(listResult.success, true);
    if (listResult.success) {
      assertEquals(
        listResult.data.length >= 3,
        true,
        `Expected at least 3 items but got ${listResult.data.length}`,
      );
      assertEquals(Array.isArray(listResult.data), true);
      assertEquals(typeof listResult.pagination.page, "number");
      assertEquals(typeof listResult.pagination.limit, "number");

      // Verify actual URIs reference the expected users
      const uris = listResult.data.map((item: { uri: string }) => item.uri);
      assertEquals(uris.some((u: string) => u.includes("alice")), true, "Should include alice");
      assertEquals(uris.some((u: string) => u.includes("bob")), true, "Should include bob");
      assertEquals(uris.some((u: string) => u.includes("charlie")), true, "Should include charlie");

      // Verify each item has correct structure
      for (const item of listResult.data) {
        assertEquals(typeof item.uri, "string", "Each item should have a URI");
        assertEquals(
          ["file", "directory"].includes(item.type),
          true,
          `Item type should be 'file' or 'directory', got '${item.type}'`,
        );
      }
    }

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list with pagination`, async () => {
    const client = await Promise.resolve(factories.happy());

    // Receive multiple transactions
    for (let i = 0; i < 10; i++) {
      await client.receive([`store://users/user${i}/profile`, {
        name: `User ${i}`,
      }]);
    }

    const page1 = await client.list("store://users", { page: 1, limit: 5 });
    assertEquals(page1.success, true);
    if (page1.success) {
      assertEquals(page1.pagination.page, 1);
      assertEquals(page1.pagination.limit, 5);
      assertEquals(page1.data.length, 5, "Page 1 should have exactly 5 items");
    }

    const page2 = await client.list("store://users", { page: 2, limit: 5 });
    assertEquals(page2.success, true);
    if (page2.success) {
      assertEquals(page2.pagination.page, 2);
      assertEquals(page2.pagination.limit, 5);
      assertEquals(page2.data.length >= 5, true, "Page 2 should have at least 5 items");

      // Verify pages contain different items (no overlap)
      const page1Uris = new Set(page1.data.map((item: { uri: string }) => item.uri));
      const page2Uris = page2.data.map((item: { uri: string }) => item.uri);
      for (const uri of page2Uris) {
        assertEquals(page1Uris.has(uri), false, `URI ${uri} should not appear on both pages`);
      }
    }

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list with pattern filter`, async () => {
    const client = await Promise.resolve(factories.happy());

    await client.receive(["store://users/alice/profile", { name: "Alice" }]);
    await client.receive(["store://users/bob/profile", { name: "Bob" }]);
    await client.receive(["store://users/alice/settings", { theme: "dark" }]);

    const listResult = await client.list("store://users", { pattern: "alice" });

    assertEquals(listResult.success, true);
    if (listResult.success) {
      // Pattern "alice" filters at the current list level
      assertEquals(
        listResult.data.every((item: { uri: string }) =>
          item.uri.includes("alice")
        ),
        true,
        "All items should contain 'alice'",
      );
      assertEquals(listResult.data.length >= 1, true, "Should return at least 1 alice item");

      // Verify alice entry is present and bob is excluded
      const uris = listResult.data.map((item: { uri: string }) => item.uri);
      assertEquals(uris.some((u: string) => u.includes("alice")), true, "Should include alice");
      assertEquals(
        uris.every((u: string) => !u.includes("bob")),
        true,
        "Should not include bob",
      );
    }

    await client.cleanup();
  });

  Deno.test(`${suiteName} - delete removes item`, async () => {
    const client = await Promise.resolve(factories.happy());

    await client.receive(["store://users/temp/data", { value: 123 }]);

    const deleteResult = await client.delete("store://users/temp/data");
    assertEquals(deleteResult.success, true);

    const readResult = await client.read("store://users/temp/data");
    assertEquals(readResult.success, false);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - delete non-existent returns error`, async () => {
    const client = await Promise.resolve(factories.happy());

    const deleteResult = await client.delete("store://users/nonexistent/data");
    assertEquals(deleteResult.success, false);

    await client.cleanup();
  });

  Deno.test({
    name: `${suiteName} - health returns status`,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const health = await client.health();

      assertEquals(typeof health.status, "string");
      assertEquals(
        ["healthy", "degraded", "unhealthy"].includes(health.status),
        true,
      );

      await client.cleanup();
    },
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

  // Binary data tests (only if client supports binary)
  // Default to true for backwards compatibility
  const supportsBinary = factories.supportsBinary !== false;

  if (supportsBinary) {
    Deno.test({
      name: `${suiteName} - receive and read binary data`,
      sanitizeOps: false,
      sanitizeResources: false,
      fn: async () => {
        const client = await Promise.resolve(factories.happy());

        // Create binary test data (simulating a small PNG header)
        const binaryData = new Uint8Array([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
          0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        ]);

        const result = await client.receive([
          "store://files/test-image.png",
          binaryData,
        ]);

        assertEquals(result.accepted, true, "Binary transaction should be accepted");

        const readResult = await client.read<Uint8Array>(
          "store://files/test-image.png",
        );

        assertEquals(readResult.success, true, "Binary read should succeed");
        assertEquals(
          readResult.record?.data instanceof Uint8Array,
          true,
          "Read data should be Uint8Array",
        );

        // Verify binary data integrity
        const readData = readResult.record?.data as Uint8Array;
        assertEquals(
          readData.length,
          binaryData.length,
          "Binary data length should match",
        );

        for (let i = 0; i < binaryData.length; i++) {
          assertEquals(
            readData[i],
            binaryData[i],
            `Byte at position ${i} should match`,
          );
        }

        await client.cleanup();
      },
    });

    Deno.test({
      name: `${suiteName} - receive and read large binary data`,
      sanitizeOps: false,
      sanitizeResources: false,
      fn: async () => {
        const client = await Promise.resolve(factories.happy());

        // Create larger binary data (1KB of random-ish bytes)
        const size = 1024;
        const binaryData = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
          binaryData[i] = i % 256;
        }

        const result = await client.receive([
          "store://files/large-file.bin",
          binaryData,
        ]);

        assertEquals(result.accepted, true, "Large binary transaction should be accepted");

        const readResult = await client.read<Uint8Array>(
          "store://files/large-file.bin",
        );

        assertEquals(readResult.success, true, "Large binary read should succeed");

        const readData = readResult.record?.data as Uint8Array;
        assertEquals(
          readData.length,
          binaryData.length,
          "Large binary data length should match",
        );

        // Verify data integrity
        let matches = true;
        for (let i = 0; i < binaryData.length && matches; i++) {
          if (readData[i] !== binaryData[i]) {
            matches = false;
          }
        }
        assertEquals(matches, true, "All bytes should match");

        await client.cleanup();
      },
    });

    Deno.test({
      name: `${suiteName} - delete binary data`,
      sanitizeOps: false,
      sanitizeResources: false,
      fn: async () => {
        const client = await Promise.resolve(factories.happy());

        const binaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

        await client.receive(["store://files/temp.bin", binaryData]);

        const deleteResult = await client.delete("store://files/temp.bin");
        assertEquals(deleteResult.success, true, "Binary delete should succeed");

        const readResult = await client.read("store://files/temp.bin");
        assertEquals(readResult.success, false, "Read after delete should fail");

        await client.cleanup();
      },
    });
  }

  // Validation error tests (if validationError factory provided)
  if (factories.validationError) {
    Deno.test(`${suiteName} - validation error on transaction`, async () => {
      const client = await Promise.resolve(factories.validationError!());

      const result = await client.receive(["store://users/invalid/data", {
        invalid: true,
      }]);

      assertEquals(result.accepted, false);
      assertEquals(typeof result.error, "string");

      await client.cleanup();
    });
  }

  // Connection error tests (if connectionError factory provided)
  if (factories.connectionError) {
    Deno.test(`${suiteName} - connection error handling`, async () => {
      const client = await Promise.resolve(factories.connectionError!());

      const result = await client.receive(["store://users/test/data", {
        value: 123,
      }]);

      assertEquals(result.accepted, false);
      assertEquals(typeof result.error, "string");

      const readResult = await client.read("store://users/test/data");
      assertEquals(readResult.success, false);

      await client.cleanup();
    });
  }
}

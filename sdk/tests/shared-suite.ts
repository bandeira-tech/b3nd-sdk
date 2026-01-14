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
    name: `${suiteName} - write and read`,
    sanitizeOps: false, // Mock servers run in background
    sanitizeResources: false,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const writeResult = await client.write("store://users/alice/profile", {
        name: "Alice",
        email: "alice@example.com",
      });

      assertEquals(writeResult.success, true);
      assertEquals(writeResult.record?.data, {
        name: "Alice",
        email: "alice@example.com",
      });

      const readResult = await client.read("store://users/alice/profile");

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
    const writeResult = await client.write("store://users/bob/profile", {
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

    const readResult = await client.read("store://users/nobody/profile");

    assertEquals(readResult.success, false);
    assertEquals(typeof readResult.error, "string");

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list returns items`, async () => {
    const client = await Promise.resolve(factories.happy());

    // Write some items
    await client.write("store://users/alice/profile", { name: "Alice" });
    await client.write("store://users/bob/profile", { name: "Bob" });
    await client.write("store://users/charlie/profile", { name: "Charlie" });

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
    }

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list with pagination`, async () => {
    const client = await Promise.resolve(factories.happy());

    // Write multiple items
    for (let i = 0; i < 10; i++) {
      await client.write(`store://users/user${i}/profile`, {
        name: `User ${i}`,
      });
    }

    const page1 = await client.list("store://users", { page: 1, limit: 5 });
    assertEquals(page1.success, true);
    if (page1.success) {
      assertEquals(page1.pagination.page, 1);
      assertEquals(page1.pagination.limit, 5);
    }

    const page2 = await client.list("store://users", { page: 2, limit: 5 });
    assertEquals(page2.success, true);
    if (page2.success) {
      assertEquals(page2.pagination.page, 2);
      assertEquals(page2.pagination.limit, 5);
    }

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list with pattern filter`, async () => {
    const client = await Promise.resolve(factories.happy());

    await client.write("store://users/alice/profile", { name: "Alice" });
    await client.write("store://users/bob/profile", { name: "Bob" });
    await client.write("store://users/alice/settings", { theme: "dark" });

    const listResult = await client.list("store://users", { pattern: "alice" });

    assertEquals(listResult.success, true);
    if (listResult.success) {
      assertEquals(
        listResult.data.every((item: { uri: string }) =>
          item.uri.includes("alice")
        ),
        true,
      );
    }

    await client.cleanup();
  });

  Deno.test(`${suiteName} - delete removes item`, async () => {
    const client = await Promise.resolve(factories.happy());

    await client.write("store://users/temp/data", { value: 123 });

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
      name: `${suiteName} - write and read binary data`,
      sanitizeOps: false,
      sanitizeResources: false,
      fn: async () => {
        const client = await Promise.resolve(factories.happy());

        // Create binary test data (simulating a small PNG header)
        const binaryData = new Uint8Array([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
          0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        ]);

        const writeResult = await client.write(
          "store://files/test-image.png",
          binaryData,
        );

        assertEquals(writeResult.success, true, "Binary write should succeed");

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
      name: `${suiteName} - write and read large binary data`,
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

        const writeResult = await client.write(
          "store://files/large-file.bin",
          binaryData,
        );

        assertEquals(writeResult.success, true, "Large binary write should succeed");

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

        await client.write("store://files/temp.bin", binaryData);

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
    Deno.test(`${suiteName} - validation error on write`, async () => {
      const client = await Promise.resolve(factories.validationError!());

      const writeResult = await client.write("store://users/invalid/data", {
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

      const writeResult = await client.write("store://users/test/data", {
        value: 123,
      });

      assertEquals(writeResult.success, false);
      assertEquals(typeof writeResult.error, "string");

      const readResult = await client.read("store://users/test/data");
      assertEquals(readResult.success, false);

      await client.cleanup();
    });
  }
}

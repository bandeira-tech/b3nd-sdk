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
import type { NodeProtocolInterface } from "../b3nd-core/types.ts";

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
  // Disable sanitizers — clients like Postgres open TCP connections that
  // outlive individual tests (no cleanup() in NodeProtocolInterface).
  const noSanitize = { sanitizeOps: false, sanitizeResources: false };

  // Happy path tests
  Deno.test({
    name: `${suiteName} - receive message and read`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const result = await client.receive(["store://users/alice/profile", {
        name: "Alice",
        email: "alice@example.com",
      }]);

      assertEquals(result.accepted, true);

      const readResults = await client.read("store://users/alice/profile");

      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.data, {
        name: "Alice",
        email: "alice@example.com",
      });
    },
  });

  Deno.test({
    name: `${suiteName} - receive message creates timestamp`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const before = Date.now();
      const result = await client.receive(["store://users/bob/profile", {
        name: "Bob",
      }]);
      const after = Date.now();

      assertEquals(result.accepted, true);

      // Verify timestamp via read
      const readResults = await client.read("store://users/bob/profile");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(typeof readResults[0].record?.ts, "number");
      assertEquals(readResults[0].record!.ts >= before, true);
      assertEquals(readResults[0].record!.ts <= after, true);
    },
  });

  Deno.test({
    name: `${suiteName} - read non-existent returns error`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const readResults = await client.read("store://users/nobody/profile");

      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, false);
      assertEquals(typeof readResults[0].error, "string");
    },
  });

  // --- Scalar value tests ---

  Deno.test({
    name: `${suiteName} - receive and read string value`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const result = await client.receive([
        "store://users/scalar-string/data",
        "hello world",
      ]);
      assertEquals(result.accepted, true);

      const readResults = await client.read("store://users/scalar-string/data");
      assertEquals(readResults.length, 1);
      assertEquals(
        readResults[0].success,
        true,
        "String value read should succeed",
      );
      assertEquals(readResults[0].record?.data, "hello world");
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read number value`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const result = await client.receive([
        "store://users/scalar-number/data",
        42,
      ]);
      assertEquals(result.accepted, true);

      const readResults = await client.read("store://users/scalar-number/data");
      assertEquals(readResults.length, 1);
      assertEquals(
        readResults[0].success,
        true,
        "Number value read should succeed",
      );
      assertEquals(readResults[0].record?.data, 42);
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read boolean value`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const result = await client.receive([
        "store://users/scalar-bool/data",
        true,
      ]);
      assertEquals(result.accepted, true);

      const readResults = await client.read("store://users/scalar-bool/data");
      assertEquals(readResults.length, 1);
      assertEquals(
        readResults[0].success,
        true,
        "Boolean value read should succeed",
      );
      assertEquals(readResults[0].record?.data, true);
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read null value`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const result = await client.receive([
        "store://users/scalar-null/data",
        null,
      ]);
      assertEquals(result.accepted, true);

      const readResults = await client.read("store://users/scalar-null/data");
      assertEquals(readResults.length, 1);
      assertEquals(
        readResults[0].success,
        true,
        "Null value read should succeed",
      );
      assertEquals(readResults[0].record?.data, null);
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read empty string value`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const result = await client.receive([
        "store://users/scalar-empty/data",
        "",
      ]);
      assertEquals(result.accepted, true);

      const readResults = await client.read("store://users/scalar-empty/data");
      assertEquals(readResults.length, 1);
      assertEquals(
        readResults[0].success,
        true,
        "Empty string value read should succeed",
      );
      assertEquals(readResults[0].record?.data, "");
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read zero value`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const result = await client.receive([
        "store://users/scalar-zero/data",
        0,
      ]);
      assertEquals(result.accepted, true);

      const readResults = await client.read("store://users/scalar-zero/data");
      assertEquals(readResults.length, 1);
      assertEquals(
        readResults[0].success,
        true,
        "Zero value read should succeed",
      );
      assertEquals(readResults[0].record?.data, 0);
    },
  });

  Deno.test({
    name: `${suiteName} - read multiple URIs`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive(["store://users/multi-a/profile", { v: 1 }]);
      await client.receive(["store://users/multi-b/profile", { v: 2 }]);
      await client.receive(["store://users/multi-c/profile", { v: 3 }]);

      const results = await client.read([
        "store://users/multi-a/profile",
        "store://users/multi-b/profile",
        "store://users/multi-c/profile",
      ]);

      assertEquals(results.length, 3);
      assertEquals(results[0].success, true);
      if (results[0].success) {
        assertEquals(results[0].record?.data, { v: 1 });
      }
      assertEquals(results[1].success, true);
      if (results[1].success) {
        assertEquals(results[1].record?.data, { v: 2 });
      }
      assertEquals(results[2].success, true);
      if (results[2].success) {
        assertEquals(results[2].record?.data, { v: 3 });
      }
    },
  });

  Deno.test({
    name: `${suiteName} - read with partial failures`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive(["store://users/partial-a/profile", { ok: true }]);

      const results = await client.read([
        "store://users/partial-a/profile",
        "store://users/partial-missing/profile",
      ]);

      assertEquals(results.length, 2);
      assertEquals(results[0].success, true);
      assertEquals(results[1].success, false);
    },
  });

  Deno.test({
    name: `${suiteName} - read with trailing slash lists children`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const prefix = `store://users/list-test-${Date.now()}`;
      await client.receive([`${prefix}/alice/profile`, { name: "Alice" }]);
      await client.receive([`${prefix}/bob/profile`, { name: "Bob" }]);
      await client.receive([`${prefix}/charlie/profile`, { name: "Charlie" }]);

      const results = await client.read(`${prefix}/`);

      assertEquals(
        results.length >= 3,
        true,
        `Should return at least 3 items, got ${results.length}`,
      );
      const successResults = results.filter((r) => r.success);
      assertEquals(
        successResults.length >= 3,
        true,
        "Should have at least 3 successful reads",
      );
    },
  });

  Deno.test({
    name: `${suiteName} - status returns healthy`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const status = await client.status();

      assertEquals(typeof status.status, "string");
      assertEquals(
        ["healthy", "unhealthy"].includes(status.status),
        true,
      );
      assertEquals(Array.isArray(status.schema), true);
    },
  });

  // Binary data tests (only if client supports binary)
  // Default to true for backwards compatibility
  const supportsBinary = factories.supportsBinary !== false;

  if (supportsBinary) {
    Deno.test({
      name: `${suiteName} - receive and read binary data`,
      ...noSanitize,
      fn: async () => {
        const client = await Promise.resolve(factories.happy());

        // Create binary test data (simulating a small PNG header)
        const binaryData = new Uint8Array([
          0x89,
          0x50,
          0x4E,
          0x47,
          0x0D,
          0x0A,
          0x1A,
          0x0A, // PNG signature
          0x00,
          0x00,
          0x00,
          0x0D,
          0x49,
          0x48,
          0x44,
          0x52, // IHDR chunk
        ]);

        const result = await client.receive([
          "store://files/test-image.png",
          binaryData,
        ]);

        assertEquals(
          result.accepted,
          true,
          "Binary message should be accepted",
        );

        const readResults = await client.read<Uint8Array>(
          "store://files/test-image.png",
        );

        assertEquals(readResults.length, 1);
        assertEquals(
          readResults[0].success,
          true,
          "Binary read should succeed",
        );
        assertEquals(
          readResults[0].record?.data instanceof Uint8Array,
          true,
          "Read data should be Uint8Array",
        );

        // Verify binary data integrity
        const readData = readResults[0].record?.data as Uint8Array;
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
      },
    });

    Deno.test({
      name: `${suiteName} - receive and read large binary data`,
      ...noSanitize,
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

        assertEquals(
          result.accepted,
          true,
          "Large binary message should be accepted",
        );

        const readResults = await client.read<Uint8Array>(
          "store://files/large-file.bin",
        );

        assertEquals(readResults.length, 1);
        assertEquals(
          readResults[0].success,
          true,
          "Large binary read should succeed",
        );

        const readData = readResults[0].record?.data as Uint8Array;
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
      },
    });
  }

  // Validation error tests (if validationError factory provided)
  if (factories.validationError) {
    Deno.test({
      name: `${suiteName} - validation error on receive`,
      ...noSanitize,
      fn: async () => {
        const client = await Promise.resolve(factories.validationError!());

        const result = await client.receive(["store://users/invalid/data", {
          invalid: true,
        }]);

        assertEquals(result.accepted, false);
        assertEquals(typeof result.error, "string");
      },
    });
  }

  // Connection error tests (if connectionError factory provided)
  if (factories.connectionError) {
    Deno.test({
      name: `${suiteName} - connection error handling`,
      ...noSanitize,
      fn: async () => {
        const client = await Promise.resolve(factories.connectionError!());

        const result = await client.receive(["store://users/test/data", {
          value: 123,
        }]);

        assertEquals(result.accepted, false);
        assertEquals(typeof result.error, "string");

        const readResults = await client.read("store://users/test/data");
        assertEquals(readResults.length, 1);
        assertEquals(readResults[0].success, false);
      },
    });
  }
}

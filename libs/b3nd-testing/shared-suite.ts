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
import { computeSha256, generateHashUri } from "../b3nd-hash/mod.ts";
import type { MessageData } from "../b3nd-msg/data/types.ts";

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

  /**
   * Factory for atomicity tests. Must return a client with schema:
   *  - "store://ok" accepts anything
   *  - "store://fail" rejects everything
   *  - "hash://sha256" accepts (content-addressed envelopes)
   */
  atomicity?: () => NodeProtocolInterface | Promise<NodeProtocolInterface>;

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

  // --- Scalar value tests ---

  Deno.test(`${suiteName} - receive and read string value`, async () => {
    const client = await Promise.resolve(factories.happy());

    const result = await client.receive([
      "store://users/scalar-string/data",
      "hello world",
    ]);
    assertEquals(result.accepted, true);

    const readResult = await client.read("store://users/scalar-string/data");
    assertEquals(readResult.success, true, "String value read should succeed");
    assertEquals(readResult.record?.data, "hello world");

    await client.cleanup();
  });

  Deno.test(`${suiteName} - receive and read number value`, async () => {
    const client = await Promise.resolve(factories.happy());

    const result = await client.receive([
      "store://users/scalar-number/data",
      42,
    ]);
    assertEquals(result.accepted, true);

    const readResult = await client.read("store://users/scalar-number/data");
    assertEquals(readResult.success, true, "Number value read should succeed");
    assertEquals(readResult.record?.data, 42);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - receive and read boolean value`, async () => {
    const client = await Promise.resolve(factories.happy());

    const result = await client.receive([
      "store://users/scalar-bool/data",
      true,
    ]);
    assertEquals(result.accepted, true);

    const readResult = await client.read("store://users/scalar-bool/data");
    assertEquals(readResult.success, true, "Boolean value read should succeed");
    assertEquals(readResult.record?.data, true);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - receive and read null value`, async () => {
    const client = await Promise.resolve(factories.happy());

    const result = await client.receive([
      "store://users/scalar-null/data",
      null,
    ]);
    assertEquals(result.accepted, true);

    const readResult = await client.read("store://users/scalar-null/data");
    assertEquals(readResult.success, true, "Null value read should succeed");
    assertEquals(readResult.record?.data, null);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - receive and read empty string value`, async () => {
    const client = await Promise.resolve(factories.happy());

    const result = await client.receive([
      "store://users/scalar-empty/data",
      "",
    ]);
    assertEquals(result.accepted, true);

    const readResult = await client.read("store://users/scalar-empty/data");
    assertEquals(readResult.success, true, "Empty string value read should succeed");
    assertEquals(readResult.record?.data, "");

    await client.cleanup();
  });

  Deno.test(`${suiteName} - receive and read zero value`, async () => {
    const client = await Promise.resolve(factories.happy());

    const result = await client.receive([
      "store://users/scalar-zero/data",
      0,
    ]);
    assertEquals(result.accepted, true);

    const readResult = await client.read("store://users/scalar-zero/data");
    assertEquals(readResult.success, true, "Zero value read should succeed");
    assertEquals(readResult.record?.data, 0);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list returns items`, async () => {
    const client = await Promise.resolve(factories.happy());

    // Use unique prefix to avoid stale data from persistent backends
    const prefix = `store://users/list-test-${Date.now()}`;
    await client.receive([`${prefix}/alice/profile`, { name: "Alice" }]);
    await client.receive([`${prefix}/bob/profile`, { name: "Bob" }]);
    await client.receive([`${prefix}/charlie/profile`, { name: "Charlie" }]);

    const listResult = await client.list(prefix);

    assertEquals(listResult.success, true);
    if (listResult.success) {
      assertEquals(listResult.data.length, 3, "Should return exactly 3 items");
      assertEquals(typeof listResult.pagination.page, "number");
      assertEquals(typeof listResult.pagination.limit, "number");

      // Verify exact URIs — full stored URIs
      const uris = listResult.data.map((item) => item.uri).sort();
      assertEquals(uris, [
        `${prefix}/alice/profile`,
        `${prefix}/bob/profile`,
        `${prefix}/charlie/profile`,
      ]);
    }

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list with pagination`, async () => {
    const client = await Promise.resolve(factories.happy());

    // Use unique prefix to avoid cross-test pollution
    for (let i = 0; i < 10; i++) {
      await client.receive([`store://pagination/user${i}/profile`, {
        name: `User ${i}`,
      }]);
    }

    const page1 = await client.list("store://pagination", {
      page: 1,
      limit: 5,
    });
    assertEquals(page1.success, true);
    if (page1.success) {
      assertEquals(page1.pagination.page, 1);
      assertEquals(page1.pagination.limit, 5);
      assertEquals(page1.data.length, 5, "Page 1 should have exactly 5 items");

      for (const item of page1.data) {
        assertEquals(
          item.uri.startsWith("store://pagination/user"),
          true,
          `URI should be full: ${item.uri}`,
        );
        assertEquals(
          item.uri.endsWith("/profile"),
          true,
          `URI should end with /profile: ${item.uri}`,
        );
      }

      const page2 = await client.list("store://pagination", {
        page: 2,
        limit: 5,
      });
      assertEquals(page2.success, true);
      if (page2.success) {
        assertEquals(page2.pagination.page, 2);
        assertEquals(page2.pagination.limit, 5);
        assertEquals(
          page2.data.length,
          5,
          "Page 2 should have exactly 5 items",
        );

        // Verify pages contain different items (no overlap)
        const page1Uris = new Set(page1.data.map((item) => item.uri));
        const page2Uris = page2.data.map((item) => item.uri);
        for (const uri of page2Uris) {
          assertEquals(
            page1Uris.has(uri),
            false,
            `URI ${uri} should not appear on both pages`,
          );
        }

        // All 10 items across both pages
        const allUris = [...page1.data, ...page2.data].map((item) => item.uri)
          .sort();
        assertEquals(allUris.length, 10);
        for (let i = 0; i < 10; i++) {
          assertEquals(
            allUris.includes(`store://pagination/user${i}/profile`),
            true,
            `Should contain user${i}`,
          );
        }
      }
    }

    await client.cleanup();
  });

  Deno.test(`${suiteName} - list with pattern filter`, async () => {
    const client = await Promise.resolve(factories.happy());

    const prefix = `store://users/filter-test-${Date.now()}`;
    await client.receive([`${prefix}/alice/profile`, { name: "Alice" }]);
    await client.receive([`${prefix}/bob/profile`, { name: "Bob" }]);
    await client.receive([`${prefix}/alice/settings`, { theme: "dark" }]);

    const listResult = await client.list(prefix, { pattern: "alice" });

    assertEquals(listResult.success, true);
    if (listResult.success) {
      assertEquals(
        listResult.data.length,
        2,
        "Should return exactly 2 alice items",
      );

      const uris = listResult.data.map((item) => item.uri).sort();
      assertEquals(uris, [
        `${prefix}/alice/profile`,
        `${prefix}/alice/settings`,
      ]);

      for (const item of listResult.data) {
        assertEquals(item.uri.includes("alice"), true);
        assertEquals(item.uri.includes("bob"), false, "Should not include bob");
      }
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
          "Binary transaction should be accepted",
        );

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

        assertEquals(
          result.accepted,
          true,
          "Large binary transaction should be accepted",
        );

        const readResult = await client.read<Uint8Array>(
          "store://files/large-file.bin",
        );

        assertEquals(
          readResult.success,
          true,
          "Large binary read should succeed",
        );

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
        assertEquals(
          deleteResult.success,
          true,
          "Binary delete should succeed",
        );

        const readResult = await client.read("store://files/temp.bin");
        assertEquals(
          readResult.success,
          false,
          "Read after delete should fail",
        );

        await client.cleanup();
      },
    });
  }

  // --- readMulti tests ---

  Deno.test({
    name: `${suiteName} - readMulti reads multiple URIs successfully`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive(["store://users/multi-a/profile", { v: 1 }]);
      await client.receive(["store://users/multi-b/profile", { v: 2 }]);
      await client.receive(["store://users/multi-c/profile", { v: 3 }]);

      const result = await client.readMulti([
        "store://users/multi-a/profile",
        "store://users/multi-b/profile",
        "store://users/multi-c/profile",
      ]);

      assertEquals(result.success, true);
      assertEquals(result.summary.total, 3);
      assertEquals(result.summary.succeeded, 3);
      assertEquals(result.summary.failed, 0);
      assertEquals(result.results.length, 3);

      assertEquals(result.results[0].success, true);
      if (result.results[0].success) {
        assertEquals(result.results[0].record.data, { v: 1 });
      }
      assertEquals(result.results[1].success, true);
      if (result.results[1].success) {
        assertEquals(result.results[1].record.data, { v: 2 });
      }
      assertEquals(result.results[2].success, true);
      if (result.results[2].success) {
        assertEquals(result.results[2].record.data, { v: 3 });
      }

      await client.cleanup();
    },
  });

  Deno.test({
    name: `${suiteName} - readMulti partial success`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive(["store://users/partial-a/profile", { ok: true }]);
      await client.receive(["store://users/partial-b/profile", { ok: true }]);

      const result = await client.readMulti([
        "store://users/partial-a/profile",
        "store://users/partial-missing/profile",
        "store://users/partial-b/profile",
      ]);

      assertEquals(result.success, true);
      assertEquals(result.summary.total, 3);
      assertEquals(result.summary.succeeded, 2);
      assertEquals(result.summary.failed, 1);

      assertEquals(result.results[0].success, true);
      assertEquals(result.results[1].success, false);
      assertEquals(result.results[2].success, true);

      await client.cleanup();
    },
  });

  Deno.test({
    name: `${suiteName} - readMulti all fail`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const result = await client.readMulti([
        "store://users/ghost-a/profile",
        "store://users/ghost-b/profile",
      ]);

      assertEquals(result.success, false);
      assertEquals(result.summary.total, 2);
      assertEquals(result.summary.succeeded, 0);
      assertEquals(result.summary.failed, 2);

      await client.cleanup();
    },
  });

  Deno.test(`${suiteName} - readMulti exceeds batch limit`, async () => {
    const client = await Promise.resolve(factories.happy());

    const uris = Array.from(
      { length: 51 },
      (_, i) => `store://users/limit${i}/profile`,
    );
    const result = await client.readMulti(uris);

    assertEquals(result.success, false);
    assertEquals(result.summary.total, 51);
    assertEquals(result.summary.failed, 51);
    assertEquals(result.results.length, 0);

    await client.cleanup();
  });

  Deno.test(`${suiteName} - readMulti empty array`, async () => {
    const client = await Promise.resolve(factories.happy());

    const result = await client.readMulti([]);

    assertEquals(result.success, false);
    assertEquals(result.summary.total, 0);
    assertEquals(result.summary.succeeded, 0);
    assertEquals(result.summary.failed, 0);
    assertEquals(result.results.length, 0);

    await client.cleanup();
  });

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

  // --- Atomicity tests (if atomicity factory provided) ---
  // Tests that when a message envelope has multiple outputs and one fails
  // validation, NO outputs from that envelope are readable.
  if (factories.atomicity) {
    Deno.test(
      `${suiteName} - envelope with failed output leaves no readable outputs`,
      async () => {
        const client = await Promise.resolve(factories.atomicity!());

        // Envelope: output 1 passes, output 2 passes, output 3 FAILS
        const envelope: MessageData = {
          payload: {
            inputs: [],
            outputs: [
              ["store://ok/first", { value: 1 }],
              ["store://ok/second", { value: 2 }],
              ["store://fail/third", { value: 3 }],
            ],
          },
        };

        const hash = await computeSha256(envelope);
        const envelopeUri = generateHashUri(hash);

        const result = await client.receive([envelopeUri, envelope]);
        assertEquals(result.accepted, false, "Envelope should be rejected");

        // Outputs 1 and 2 must NOT be readable
        const read1 = await client.read("store://ok/first");
        assertEquals(
          read1.success,
          false,
          "Output 1 should NOT be readable after failed envelope",
        );

        const read2 = await client.read("store://ok/second");
        assertEquals(
          read2.success,
          false,
          "Output 2 should NOT be readable after failed envelope",
        );

        // The envelope itself should not be readable
        const readEnvelope = await client.read(envelopeUri);
        assertEquals(
          readEnvelope.success,
          false,
          "Envelope should NOT be readable after failed output",
        );

        await client.cleanup();
      },
    );

    Deno.test(
      `${suiteName} - successful envelope stores all outputs`,
      async () => {
        const client = await Promise.resolve(factories.atomicity!());

        const envelope: MessageData = {
          payload: {
            inputs: [],
            outputs: [
              ["store://ok/alpha", { value: "a" }],
              ["store://ok/beta", { value: "b" }],
            ],
          },
        };

        const hash = await computeSha256(envelope);
        const envelopeUri = generateHashUri(hash);

        const result = await client.receive([envelopeUri, envelope]);
        assertEquals(result.accepted, true, `Should succeed: ${result.error}`);

        const read1 = await client.read("store://ok/alpha");
        assertEquals(read1.success, true, "Output 1 should be readable");

        const read2 = await client.read("store://ok/beta");
        assertEquals(read2.success, true, "Output 2 should be readable");

        await client.cleanup();
      },
    );

    Deno.test(
      `${suiteName} - failure at second output rolls back first`,
      async () => {
        const client = await Promise.resolve(factories.atomicity!());

        const envelope: MessageData = {
          payload: {
            inputs: [],
            outputs: [
              ["store://ok/survives-not", { value: "should be rolled back" }],
              ["store://fail/blocks-all", { value: "fails" }],
            ],
          },
        };

        const hash = await computeSha256(envelope);
        const envelopeUri = generateHashUri(hash);

        const result = await client.receive([envelopeUri, envelope]);
        assertEquals(result.accepted, false, "Envelope should be rejected");

        const read1 = await client.read("store://ok/survives-not");
        assertEquals(
          read1.success,
          false,
          "First output should NOT survive when second output fails",
        );

        await client.cleanup();
      },
    );
  }
}

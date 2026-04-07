/**
 * Node Test Suite
 *
 * Tests for the unified Node interface (receive pattern).
 * This suite tests that any implementation of Node & ReadInterface
 * behaves correctly according to the protocol specification.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import type { NodeProtocolInterface } from "../b3nd-core/types.ts";

/**
 * Test client factory for Node interface tests
 */
export interface NodeTestFactory {
  /** Factory for working node (happy path tests) */
  happy: () => NodeProtocolInterface | Promise<NodeProtocolInterface>;

  /** Factory for node that rejects validation */
  validationError?: () =>
    | NodeProtocolInterface
    | Promise<NodeProtocolInterface>;
}

/**
 * Run the node test suite against provided factory
 */
export function runNodeSuite(
  suiteName: string,
  factory: NodeTestFactory,
) {
  const noSanitize = { sanitizeOps: false, sanitizeResources: false };

  Deno.test({
    name: `${suiteName} [Node] - receive and read`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      const result = await node.receive([
        "store://users/alice/profile",
        { name: "Alice", email: "alice@example.com" },
      ]);

      assertEquals(result.accepted, true);
      assertEquals(result.error, undefined);

      const readResults = await node.read("store://users/alice/profile");

      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.data, {
        name: "Alice",
        email: "alice@example.com",
      });
    },
  });

  Deno.test({
    name: `${suiteName} [Node] - receive multiple messages`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      // Receive multiple messages
      const result1 = await node.receive([
        "store://users/alice/profile",
        { name: "Alice" },
      ]);
      const result2 = await node.receive([
        "store://users/bob/profile",
        { name: "Bob" },
      ]);

      assertEquals(result1.accepted, true);
      assertEquals(result2.accepted, true);

      // Verify both were stored
      const read1 = await node.read("store://users/alice/profile");
      const read2 = await node.read("store://users/bob/profile");

      assertEquals(read1.length, 1);
      assertEquals(read2.length, 1);
      assertEquals(read1[0].success, true);
      assertEquals(read2[0].success, true);
      assertEquals(read1[0].record?.data, { name: "Alice" });
      assertEquals(read2[0].record?.data, { name: "Bob" });
    },
  });

  Deno.test({
    name: `${suiteName} [Node] - receive overwrites existing data`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      // Write initial data
      await node.receive([
        "store://users/alice/profile",
        { name: "Alice", version: 1 },
      ]);

      // Overwrite with new data
      const result = await node.receive([
        "store://users/alice/profile",
        { name: "Alice Updated", version: 2 },
      ]);

      assertEquals(result.accepted, true);

      // Verify data was updated
      const readResults = await node.read("store://users/alice/profile");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.data, {
        name: "Alice Updated",
        version: 2,
      });
    },
  });

  Deno.test({
    name: `${suiteName} [Node] - receive with empty URI returns error`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      const result = await node.receive(["", { data: "test" }]);

      assertEquals(result.accepted, false);
      assertEquals(typeof result.error, "string");
    },
  });

  Deno.test({
    name: `${suiteName} [Node] - receive with null data`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      const result = await node.receive(["store://users/test/null", null]);

      // Should still accept null data (storage-dependent)
      assertEquals(typeof result.accepted, "boolean");
    },
  });

  Deno.test({
    name: `${suiteName} [Node] - read with trailing slash lists children`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      const prefix = `store://users/node-list-${Date.now()}`;
      await node.receive([`${prefix}/alice/profile`, { name: "Alice" }]);
      await node.receive([`${prefix}/bob/profile`, { name: "Bob" }]);
      await node.receive([`${prefix}/charlie/profile`, { name: "Charlie" }]);

      const results = await node.read(`${prefix}/`);

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
    name: `${suiteName} [Node] - read multiple URIs`,
    ...noSanitize,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      // Receive messages
      await node.receive(["store://users/alice/profile", { name: "Alice" }]);
      await node.receive(["store://users/bob/profile", { name: "Bob" }]);

      // Read multiple
      const results = await node.read([
        "store://users/alice/profile",
        "store://users/bob/profile",
        "store://users/nonexistent/profile",
      ]);

      assertEquals(results.length, 3);

      assertEquals(results[0].success, true);
      if (results[0].success) {
        assertEquals(results[0].record?.data, { name: "Alice" });
      }
      assertEquals(results[1].success, true);
      if (results[1].success) {
        assertEquals(results[1].record?.data, { name: "Bob" });
      }
      assertEquals(
        results[2].success,
        false,
        "Nonexistent URI should fail",
      );
    },
  });

  // Validation error tests (if factory provided)
  if (factory.validationError) {
    Deno.test({
      name: `${suiteName} [Node] - receive validation error`,
      ...noSanitize,
      fn: async () => {
        const node = await Promise.resolve(factory.validationError!());

        const result = await node.receive([
          "store://users/invalid/data",
          { invalid: true },
        ]);

        assertEquals(result.accepted, false);
        assertEquals(typeof result.error, "string");
      },
    });
  }
}

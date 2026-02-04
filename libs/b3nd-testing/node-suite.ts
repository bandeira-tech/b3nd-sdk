/**
 * Node Test Suite
 *
 * Tests for the unified Node interface (receive pattern).
 * This suite tests that any implementation of Node & ReadInterface
 * behaves correctly according to the protocol specification.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import type { Node, ReadInterface } from "../b3nd-compose/types.ts";

/**
 * Test client factory for Node interface tests
 */
export interface NodeTestFactory {
  /** Factory for working node (happy path tests) */
  happy: () => (Node & ReadInterface) | Promise<Node & ReadInterface>;

  /** Factory for node that rejects validation */
  validationError?: () =>
    | (Node & ReadInterface)
    | Promise<Node & ReadInterface>;
}

/**
 * Run the node test suite against provided factory
 */
export function runNodeSuite(
  suiteName: string,
  factory: NodeTestFactory,
) {
  Deno.test({
    name: `${suiteName} [Node] - receive and read`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const node = await Promise.resolve(factory.happy());

      const result = await node.receive([
        "store://users/alice/profile",
        { name: "Alice", email: "alice@example.com" },
      ]);

      assertEquals(result.accepted, true);
      assertEquals(result.error, undefined);

      const readResult = await node.read("store://users/alice/profile");

      assertEquals(readResult.success, true);
      assertEquals(readResult.record?.data, {
        name: "Alice",
        email: "alice@example.com",
      });

      await node.cleanup();
    },
  });

  Deno.test(`${suiteName} [Node] - receive multiple transactions`, async () => {
    const node = await Promise.resolve(factory.happy());

    // Receive multiple transactions
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

    assertEquals(read1.success, true);
    assertEquals(read2.success, true);
    assertEquals(read1.record?.data, { name: "Alice" });
    assertEquals(read2.record?.data, { name: "Bob" });

    await node.cleanup();
  });

  Deno.test(`${suiteName} [Node] - receive overwrites existing data`, async () => {
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
    const readResult = await node.read("store://users/alice/profile");
    assertEquals(readResult.success, true);
    assertEquals(readResult.record?.data, {
      name: "Alice Updated",
      version: 2,
    });

    await node.cleanup();
  });

  Deno.test(`${suiteName} [Node] - receive with empty URI returns error`, async () => {
    const node = await Promise.resolve(factory.happy());

    const result = await node.receive(["", { data: "test" }]);

    assertEquals(result.accepted, false);
    assertEquals(typeof result.error, "string");

    await node.cleanup();
  });

  Deno.test(`${suiteName} [Node] - receive with null data`, async () => {
    const node = await Promise.resolve(factory.happy());

    const result = await node.receive(["store://users/test/null", null]);

    // Should still accept null data (storage-dependent)
    assertEquals(typeof result.accepted, "boolean");

    await node.cleanup();
  });

  Deno.test(`${suiteName} [Node] - list after receive`, async () => {
    const node = await Promise.resolve(factory.happy());

    const prefix = `store://users/node-list-${Date.now()}`;
    await node.receive([`${prefix}/alice/profile`, { name: "Alice" }]);
    await node.receive([`${prefix}/bob/profile`, { name: "Bob" }]);
    await node.receive([`${prefix}/charlie/profile`, { name: "Charlie" }]);

    const listResult = await node.list(prefix);

    assertEquals(listResult.success, true);
    if (listResult.success) {
      assertEquals(listResult.data.length, 3, "Should return exactly 3 items");

      // Verify exact full URIs
      const uris = listResult.data.map((item) => item.uri).sort();
      assertEquals(uris, [
        `${prefix}/alice/profile`,
        `${prefix}/bob/profile`,
        `${prefix}/charlie/profile`,
      ]);
    }

    await node.cleanup();
  });

  Deno.test(`${suiteName} [Node] - readMulti after receive`, async () => {
    const node = await Promise.resolve(factory.happy());

    // Receive transactions
    await node.receive(["store://users/alice/profile", { name: "Alice" }]);
    await node.receive(["store://users/bob/profile", { name: "Bob" }]);

    // Read multiple
    const result = await node.readMulti([
      "store://users/alice/profile",
      "store://users/bob/profile",
      "store://users/nonexistent/profile",
    ]);

    assertEquals(result.success, true);
    assertEquals(result.summary.total, 3);
    assertEquals(result.summary.succeeded, 2);
    assertEquals(result.summary.failed, 1);

    // Verify actual data values
    assertEquals(result.results[0].success, true);
    if (result.results[0].success) {
      assertEquals(result.results[0].record.data, { name: "Alice" });
    }
    assertEquals(result.results[1].success, true);
    if (result.results[1].success) {
      assertEquals(result.results[1].record.data, { name: "Bob" });
    }
    assertEquals(
      result.results[2].success,
      false,
      "Nonexistent URI should fail",
    );

    await node.cleanup();
  });

  // Validation error tests (if factory provided)
  if (factory.validationError) {
    Deno.test(`${suiteName} [Node] - receive validation error`, async () => {
      const node = await Promise.resolve(factory.validationError!());

      const result = await node.receive([
        "store://users/invalid/data",
        { invalid: true },
      ]);

      assertEquals(result.accepted, false);
      assertEquals(typeof result.error, "string");

      await node.cleanup();
    });
  }
}

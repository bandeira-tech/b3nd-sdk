/**
 * Shared Test Suite for NodeProtocolInterface
 *
 * This suite tests that any implementation of NodeProtocolInterface
 * behaves correctly according to the protocol specification.
 *
 * Message primitive: [uri, values, data] where:
 * - uri: string — identity/address
 * - values: Record<string, number> — conserved quantities ({} for none)
 * - data: { inputs: string[], outputs: Output[] } — always structured
 *
 * receive() takes Message[] (batch, each independently processed).
 * read() returns Output shape: record has { values, data }.
 *
 * Each client test file imports and runs this suite with factory functions
 * that create fresh client instances for each test.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import type { NodeProtocolInterface } from "../b3nd-core/types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

let _seq = 0;

/** Build a Message wrapping outputs into an envelope. No inputs. */
function msg(
  outputs: [string, Record<string, number>, unknown][],
  inputs: string[] = [],
): [string, Record<string, number>, { inputs: string[]; outputs: [string, Record<string, number>, unknown][] }] {
  return [`envelope://test/${++_seq}`, {}, { inputs, outputs }];
}

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

  // ── Basic receive/read ─────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} - receive message and read`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg([["store://users/alice/profile", {}, {
          name: "Alice",
          email: "alice@example.com",
        }]]),
      ]);

      assertEquals(results[0].accepted, true);

      const readResults = await client.read("store://users/alice/profile");

      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.data, {
        name: "Alice",
        email: "alice@example.com",
      });
      assertEquals(readResults[0].record?.values, {});
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

  // ── Scalar data types ──────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} - receive and read string data`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg([["store://users/scalar-string/data", {}, "hello world"]]),
      ]);
      assertEquals(results[0].accepted, true);

      const readResults = await client.read("store://users/scalar-string/data");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true, "String data read should succeed");
      assertEquals(readResults[0].record?.data, "hello world");
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read number data`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg([["store://users/scalar-number/data", {}, 42]]),
      ]);
      assertEquals(results[0].accepted, true);

      const readResults = await client.read("store://users/scalar-number/data");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true, "Number data read should succeed");
      assertEquals(readResults[0].record?.data, 42);
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read boolean data`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg([["store://users/scalar-bool/data", {}, true]]),
      ]);
      assertEquals(results[0].accepted, true);

      const readResults = await client.read("store://users/scalar-bool/data");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true, "Boolean data read should succeed");
      assertEquals(readResults[0].record?.data, true);
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read null data`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg([["store://users/scalar-null/data", {}, null]]),
      ]);
      assertEquals(results[0].accepted, true);

      const readResults = await client.read("store://users/scalar-null/data");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true, "Null data read should succeed");
      assertEquals(readResults[0].record?.data, null);
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read empty string data`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg([["store://users/scalar-empty/data", {}, ""]]),
      ]);
      assertEquals(results[0].accepted, true);

      const readResults = await client.read("store://users/scalar-empty/data");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true, "Empty string data read should succeed");
      assertEquals(readResults[0].record?.data, "");
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read zero data`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg([["store://users/scalar-zero/data", {}, 0]]),
      ]);
      assertEquals(results[0].accepted, true);

      const readResults = await client.read("store://users/scalar-zero/data");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true, "Zero data read should succeed");
      assertEquals(readResults[0].record?.data, 0);
    },
  });

  // ── Values on outputs ──────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} - receive and read output with single asset value`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg([["store://balance/alice/utxo-1", { fire: 100 }, null]]),
      ]);
      assertEquals(results[0].accepted, true);

      const readResults = await client.read("store://balance/alice/utxo-1");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.values, { fire: 100 });
      assertEquals(readResults[0].record?.data, null);
    },
  });

  Deno.test({
    name: `${suiteName} - receive and read output with multi-asset value`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg([["store://balance/alice/utxo-2", { fire: 50, usd: 200 }, { memo: "deposit" }]]),
      ]);
      assertEquals(results[0].accepted, true);

      const readResults = await client.read("store://balance/alice/utxo-2");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.values, { fire: 50, usd: 200 });
      assertEquals(readResults[0].record?.data, { memo: "deposit" });
    },
  });

  // ── Batch receive ──────────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} - receive batch of independent messages`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg([["store://users/batch-a/profile", {}, { name: "Alice" }]]),
        msg([["store://users/batch-b/profile", {}, { name: "Bob" }]]),
        msg([["store://users/batch-c/profile", {}, { name: "Charlie" }]]),
      ]);

      assertEquals(results.length, 3);
      assertEquals(results[0].accepted, true);
      assertEquals(results[1].accepted, true);
      assertEquals(results[2].accepted, true);

      // All outputs readable
      const readResults = await client.read([
        "store://users/batch-a/profile",
        "store://users/batch-b/profile",
        "store://users/batch-c/profile",
      ]);

      assertEquals(readResults.length, 3);
      assertEquals(readResults[0].record?.data, { name: "Alice" });
      assertEquals(readResults[1].record?.data, { name: "Bob" });
      assertEquals(readResults[2].record?.data, { name: "Charlie" });
    },
  });

  // ── Read: multiple URIs, partial failures, trailing slash ──────────

  Deno.test({
    name: `${suiteName} - read multiple URIs`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://users/multi-a/profile", {}, { v: 1 }]]),
        msg([["store://users/multi-b/profile", {}, { v: 2 }]]),
        msg([["store://users/multi-c/profile", {}, { v: 3 }]]),
      ]);

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

      await client.receive([
        msg([["store://users/partial-a/profile", {}, { ok: true }]]),
      ]);

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
      await client.receive([
        msg([[`${prefix}/alice/profile`, {}, { name: "Alice" }]]),
        msg([[`${prefix}/bob/profile`, {}, { name: "Bob" }]]),
        msg([[`${prefix}/charlie/profile`, {}, { name: "Charlie" }]]),
      ]);

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
    },
  });

  // ── Binary data tests ──────────────────────────────────────────────

  const supportsBinary = factories.supportsBinary !== false;

  if (supportsBinary) {
    Deno.test({
      name: `${suiteName} - receive and read binary data`,
      ...noSanitize,
      fn: async () => {
        const client = await Promise.resolve(factories.happy());

        const binaryData = new Uint8Array([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
          0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        ]);

        const results = await client.receive([
          msg([["store://files/test-image.png", {}, binaryData]]),
        ]);

        assertEquals(results[0].accepted, true, "Binary message should be accepted");

        const readResults = await client.read<Uint8Array>(
          "store://files/test-image.png",
        );

        assertEquals(readResults.length, 1);
        assertEquals(readResults[0].success, true, "Binary read should succeed");
        assertEquals(
          readResults[0].record?.data instanceof Uint8Array,
          true,
          "Read data should be Uint8Array",
        );

        const readData = readResults[0].record?.data as Uint8Array;
        assertEquals(readData.length, binaryData.length, "Binary data length should match");

        for (let i = 0; i < binaryData.length; i++) {
          assertEquals(readData[i], binaryData[i], `Byte at position ${i} should match`);
        }
      },
    });

    Deno.test({
      name: `${suiteName} - receive and read large binary data`,
      ...noSanitize,
      fn: async () => {
        const client = await Promise.resolve(factories.happy());

        const size = 1024;
        const binaryData = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
          binaryData[i] = i % 256;
        }

        const results = await client.receive([
          msg([["store://files/large-file.bin", {}, binaryData]]),
        ]);

        assertEquals(results[0].accepted, true, "Large binary message should be accepted");

        const readResults = await client.read<Uint8Array>(
          "store://files/large-file.bin",
        );

        assertEquals(readResults.length, 1);
        assertEquals(readResults[0].success, true, "Large binary read should succeed");

        const readData = readResults[0].record?.data as Uint8Array;
        assertEquals(readData.length, binaryData.length, "Large binary data length should match");

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

  // ── Conservation ───────────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} - conservation: valid transfer (exact)`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      // Seed
      await client.receive([
        msg([["store://balance/alice/seed-exact", { fire: 100 }, null]]),
      ]);

      // 100 in → 60 + 40 out
      const results = await client.receive([
        msg(
          [
            ["store://balance/bob/from-exact", { fire: 60 }, null],
            ["store://balance/alice/change-exact", { fire: 40 }, null],
          ],
          ["store://balance/alice/seed-exact"],
        ),
      ]);

      assertEquals(results[0].accepted, true);

      const bob = await client.read("store://balance/bob/from-exact");
      assertEquals(bob[0].success, true);
      assertEquals(bob[0].record?.values, { fire: 60 });

      const change = await client.read("store://balance/alice/change-exact");
      assertEquals(change[0].success, true);
      assertEquals(change[0].record?.values, { fire: 40 });
    },
  });

  Deno.test({
    name: `${suiteName} - conservation: surplus allowed (fee/burn)`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/seed-surplus", { fire: 100 }, null]]),
      ]);

      // 100 in → 90 out (10 burned)
      const results = await client.receive([
        msg(
          [["store://balance/bob/from-surplus", { fire: 90 }, null]],
          ["store://balance/alice/seed-surplus"],
        ),
      ]);

      assertEquals(results[0].accepted, true);
    },
  });

  Deno.test({
    name: `${suiteName} - conservation: rejected when outputs exceed inputs`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/seed-inflate", { fire: 50 }, null]]),
      ]);

      // 50 in → 200 out — rejected
      const results = await client.receive([
        msg(
          [["store://balance/bob/inflated", { fire: 200 }, null]],
          ["store://balance/alice/seed-inflate"],
        ),
      ]);

      assertEquals(results[0].accepted, false);
      assertEquals(typeof results[0].error, "string");
    },
  });

  Deno.test({
    name: `${suiteName} - conservation: multi-asset must conserve each key`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/seed-multi", { fire: 100, usd: 50 }, null]]),
      ]);

      const results = await client.receive([
        msg(
          [
            ["store://balance/bob/multi-a", { fire: 60, usd: 30 }, null],
            ["store://balance/alice/multi-b", { fire: 40, usd: 20 }, null],
          ],
          ["store://balance/alice/seed-multi"],
        ),
      ]);

      assertEquals(results[0].accepted, true);
    },
  });

  Deno.test({
    name: `${suiteName} - conservation: reject if any asset key overflows`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/seed-overflow", { fire: 100, usd: 50 }, null]]),
      ]);

      // fire conserved (100→100), usd overflows (50→80)
      const results = await client.receive([
        msg(
          [["store://balance/bob/overflowed", { fire: 100, usd: 80 }, null]],
          ["store://balance/alice/seed-overflow"],
        ),
      ]);

      assertEquals(results[0].accepted, false);
    },
  });

  Deno.test({
    name: `${suiteName} - conservation: multiple inputs summed`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/seed-sum-a", { fire: 30 }, null]]),
        msg([["store://balance/alice/seed-sum-b", { fire: 70 }, null]]),
      ]);

      // 30 + 70 = 100 in → 100 out
      const results = await client.receive([
        msg(
          [["store://balance/alice/combined", { fire: 100 }, null]],
          [
            "store://balance/alice/seed-sum-a",
            "store://balance/alice/seed-sum-b",
          ],
        ),
      ]);

      assertEquals(results[0].accepted, true);
    },
  });

  Deno.test({
    name: `${suiteName} - conservation: reject nonexistent input`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      const results = await client.receive([
        msg(
          [["store://balance/bob/phantom", { fire: 50 }, null]],
          ["store://balance/ghost/does-not-exist"],
        ),
      ]);

      assertEquals(results[0].accepted, false);
    },
  });

  Deno.test({
    name: `${suiteName} - conservation: reject negative output values`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/seed-neg", { fire: 100 }, null]]),
      ]);

      const results = await client.receive([
        msg(
          [["store://balance/bob/negative", { fire: -50 }, null]],
          ["store://balance/alice/seed-neg"],
        ),
      ]);

      assertEquals(results[0].accepted, false);
    },
  });

  Deno.test({
    name: `${suiteName} - conservation: new asset key in outputs rejected`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      // Seed with only 'fire'
      await client.receive([
        msg([["store://balance/alice/seed-new-asset", { fire: 100 }, null]]),
      ]);

      // Try to output 'usd' which doesn't exist in inputs
      const results = await client.receive([
        msg(
          [["store://balance/alice/with-new-asset", { fire: 100, usd: 50 }, null]],
          ["store://balance/alice/seed-new-asset"],
        ),
      ]);

      assertEquals(results[0].accepted, false);
    },
  });

  Deno.test({
    name: `${suiteName} - conservation: zero-value envelope (pure data) accepted`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      // No inputs, outputs carry no value — pure data
      const results = await client.receive([
        msg([
          ["store://data/note-1", {}, { text: "hello" }],
          ["store://data/note-2", {}, { text: "world" }],
        ]),
      ]);

      assertEquals(results[0].accepted, true);

      const n1 = await client.read("store://data/note-1");
      assertEquals(n1[0].record?.data, { text: "hello" });
      const n2 = await client.read("store://data/note-2");
      assertEquals(n2[0].record?.data, { text: "world" });
    },
  });

  Deno.test({
    name: `${suiteName} - conservation: reject value from nothing without issuance`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      // No inputs, but outputs carry value — rejected
      const results = await client.receive([
        msg([["store://balance/alice/free", { fire: 1000 }, null]]),
      ]);

      assertEquals(results[0].accepted, false);
    },
  });

  // ── Consumption (inputs are deleted) ───────────────────────────────

  Deno.test({
    name: `${suiteName} - consumption: input deleted after acceptance`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/consume-1", { fire: 100 }, null]]),
      ]);

      // Verify it exists
      const before = await client.read("store://balance/alice/consume-1");
      assertEquals(before[0].success, true);

      // Spend it
      await client.receive([
        msg(
          [["store://balance/bob/from-consume", { fire: 100 }, null]],
          ["store://balance/alice/consume-1"],
        ),
      ]);

      // Input is gone
      const after = await client.read("store://balance/alice/consume-1");
      assertEquals(after[0].success, false, "Spent input should no longer exist");
    },
  });

  Deno.test({
    name: `${suiteName} - consumption: double-spend rejected (input gone)`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/double-1", { fire: 100 }, null]]),
      ]);

      // First spend
      const first = await client.receive([
        msg(
          [["store://balance/bob/ds-1", { fire: 100 }, null]],
          ["store://balance/alice/double-1"],
        ),
      ]);
      assertEquals(first[0].accepted, true);

      // Second spend — fails
      const second = await client.receive([
        msg(
          [["store://balance/charlie/ds-2", { fire: 100 }, null]],
          ["store://balance/alice/double-1"],
        ),
      ]);
      assertEquals(second[0].accepted, false);
    },
  });

  Deno.test({
    name: `${suiteName} - consumption: all inputs deleted, all outputs created`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/mi-a", { fire: 40 }, null]]),
        msg([["store://balance/alice/mi-b", { fire: 60 }, null]]),
      ]);

      const results = await client.receive([
        msg(
          [
            ["store://balance/bob/mi-out-1", { fire: 70 }, null],
            ["store://balance/alice/mi-out-2", { fire: 30 }, null],
          ],
          ["store://balance/alice/mi-a", "store://balance/alice/mi-b"],
        ),
      ]);

      assertEquals(results[0].accepted, true);

      // Inputs gone
      assertEquals((await client.read("store://balance/alice/mi-a"))[0].success, false);
      assertEquals((await client.read("store://balance/alice/mi-b"))[0].success, false);

      // Outputs exist
      const out1 = await client.read("store://balance/bob/mi-out-1");
      assertEquals(out1[0].success, true);
      assertEquals(out1[0].record?.values, { fire: 70 });
      const out2 = await client.read("store://balance/alice/mi-out-2");
      assertEquals(out2[0].success, true);
      assertEquals(out2[0].record?.values, { fire: 30 });
    },
  });

  Deno.test({
    name: `${suiteName} - consumption: chained transfers`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/chain-0", { fire: 100 }, null]]),
      ]);

      // Alice → Bob
      await client.receive([
        msg(
          [["store://balance/bob/chain-1", { fire: 100 }, null]],
          ["store://balance/alice/chain-0"],
        ),
      ]);

      // Bob → Charlie
      await client.receive([
        msg(
          [["store://balance/charlie/chain-2", { fire: 100 }, null]],
          ["store://balance/bob/chain-1"],
        ),
      ]);

      // Only charlie's UTXO exists
      assertEquals((await client.read("store://balance/alice/chain-0"))[0].success, false);
      assertEquals((await client.read("store://balance/bob/chain-1"))[0].success, false);
      const charlie = await client.read("store://balance/charlie/chain-2");
      assertEquals(charlie[0].success, true);
      assertEquals(charlie[0].record?.values, { fire: 100 });
    },
  });

  Deno.test({
    name: `${suiteName} - consumption: failed conservation does not delete inputs`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://balance/alice/safe-1", { fire: 50 }, null]]),
      ]);

      // Inflate attempt — should fail
      const results = await client.receive([
        msg(
          [["store://balance/bob/inflated", { fire: 500 }, null]],
          ["store://balance/alice/safe-1"],
        ),
      ]);

      assertEquals(results[0].accepted, false);

      // Input survives
      const still = await client.read("store://balance/alice/safe-1");
      assertEquals(still[0].success, true, "Input must survive failed transaction");
      assertEquals(still[0].record?.values, { fire: 50 });
    },
  });

  Deno.test({
    name: `${suiteName} - consumption: zero-value input can be consumed`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factories.happy());

      await client.receive([
        msg([["store://data/temp-note", {}, { text: "temporary" }]]),
      ]);

      // Consume it — zero in, zero out
      const results = await client.receive([
        msg(
          [["store://data/replacement", {}, { text: "replacement" }]],
          ["store://data/temp-note"],
        ),
      ]);

      assertEquals(results[0].accepted, true);
      assertEquals((await client.read("store://data/temp-note"))[0].success, false);
      assertEquals((await client.read("store://data/replacement"))[0].record?.data, { text: "replacement" });
    },
  });

  // ── Error handling ─────────────────────────────────────────────────

  if (factories.validationError) {
    Deno.test({
      name: `${suiteName} - validation error on receive`,
      ...noSanitize,
      fn: async () => {
        const client = await Promise.resolve(factories.validationError!());

        const results = await client.receive([
          msg([["store://users/invalid/data", {}, { invalid: true }]]),
        ]);

        assertEquals(results[0].accepted, false);
        assertEquals(typeof results[0].error, "string");
      },
    });
  }

  if (factories.connectionError) {
    Deno.test({
      name: `${suiteName} - connection error handling`,
      ...noSanitize,
      fn: async () => {
        const client = await Promise.resolve(factories.connectionError!());

        const results = await client.receive([
          msg([["store://users/test/data", {}, { value: 123 }]]),
        ]);

        assertEquals(results[0].accepted, false);
        assertEquals(typeof results[0].error, "string");

        const readResults = await client.read("store://users/test/data");
        assertEquals(readResults.length, 1);
        assertEquals(readResults[0].success, false);
      },
    });
  }
}

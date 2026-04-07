/**
 * Values Test Suite
 *
 * Tests for the [uri, values, data] message primitive with
 * framework-level conservation and consumption semantics.
 *
 * These tests verify that any NodeProtocolInterface implementation
 * correctly handles:
 *
 * 1. The 3-tuple message shape: [uri, values, data]
 *    - values is always Record<string, number>
 *    - {} means no value carried
 *
 * 2. Conservation: for messages with inputs, sum(input values) >= sum(output values)
 *    per asset key. Excess value (fees, burns) is allowed. Deficit is rejected.
 *
 * 3. Consumption: inputs listed in a message are deleted on acceptance.
 *    Spent URIs return not-found on subsequent reads. Double-spend is
 *    impossible because the input no longer exists.
 *
 * 4. Issuance: value cannot appear from nothing unless an issuance
 *    policy explicitly allows it.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import type { NodeProtocolInterface } from "../b3nd-core/types.ts";

/**
 * Factory for values test suite.
 *
 * `happy` must return a client that enforces conservation and consumption
 * semantics (i.e., wrapped with the canonical processing function).
 *
 * `withIssuance` returns a client that allows value creation from nothing
 * for specific issuance patterns (e.g., genesis).
 */
export interface ValuesTestFactory {
  happy: () => NodeProtocolInterface | Promise<NodeProtocolInterface>;
  withIssuance?: () => NodeProtocolInterface | Promise<NodeProtocolInterface>;
}

/**
 * Run the values test suite.
 */
export function runValuesSuite(
  suiteName: string,
  factory: ValuesTestFactory,
) {
  const noSanitize = { sanitizeOps: false, sanitizeResources: false };

  // ── 3-tuple shape ──────────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} [Values] - receive and read 3-tuple with empty values`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      const result = await client.receive([
        "store://data/config",
        {},
        { theme: "dark" },
      ]);

      assertEquals(result.accepted, true);

      const readResults = await client.read("store://data/config");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.data, { theme: "dark" });
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - receive and read 3-tuple with single asset`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      const result = await client.receive([
        "store://balance/alice/utxo-1",
        { fire: 100 },
        null,
      ]);

      assertEquals(result.accepted, true);

      const readResults = await client.read("store://balance/alice/utxo-1");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.values, { fire: 100 });
      assertEquals(readResults[0].record?.data, null);
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - receive and read 3-tuple with multi-asset`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      const result = await client.receive([
        "store://balance/alice/utxo-2",
        { fire: 50, usd: 200 },
        { memo: "initial deposit" },
      ]);

      assertEquals(result.accepted, true);

      const readResults = await client.read("store://balance/alice/utxo-2");
      assertEquals(readResults.length, 1);
      assertEquals(readResults[0].success, true);
      assertEquals(readResults[0].record?.values, { fire: 50, usd: 200 });
      assertEquals(readResults[0].record?.data, { memo: "initial deposit" });
    },
  });

  // ── Conservation ───────────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} [Values] - conservation: valid transfer (exact)`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed an input UTXO
      await client.receive([
        "store://balance/alice/utxo-seed-1",
        { fire: 100 },
        null,
      ]);

      // Transfer: 100 in → 60 + 40 out (exact conservation)
      const result = await client.receive([
        "hash://sha256/transfer-exact",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-seed-1"],
            outputs: [
              ["store://balance/bob/utxo-1", { fire: 60 }, null],
              ["store://balance/alice/utxo-change-1", { fire: 40 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, true);

      // Outputs exist
      const bob = await client.read("store://balance/bob/utxo-1");
      assertEquals(bob[0].success, true);
      assertEquals(bob[0].record?.values, { fire: 60 });

      const aliceChange = await client.read(
        "store://balance/alice/utxo-change-1",
      );
      assertEquals(aliceChange[0].success, true);
      assertEquals(aliceChange[0].record?.values, { fire: 40 });
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - conservation: valid transfer with fee (surplus)`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed
      await client.receive([
        "store://balance/alice/utxo-seed-2",
        { fire: 100 },
        null,
      ]);

      // Transfer: 100 in → 90 out (10 burned/fee — surplus is allowed)
      const result = await client.receive([
        "hash://sha256/transfer-surplus",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-seed-2"],
            outputs: [
              ["store://balance/bob/utxo-2", { fire: 90 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, true);
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - conservation: rejected when outputs exceed inputs`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed
      await client.receive([
        "store://balance/alice/utxo-seed-3",
        { fire: 50 },
        null,
      ]);

      // Try to create more value than exists: 50 in → 200 out
      const result = await client.receive([
        "hash://sha256/transfer-inflate",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-seed-3"],
            outputs: [
              ["store://balance/bob/utxo-3", { fire: 200 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, false);
      assertEquals(typeof result.error, "string");
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - conservation: multi-asset must conserve each key`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed with two assets
      await client.receive([
        "store://balance/alice/utxo-seed-4",
        { fire: 100, usd: 50 },
        null,
      ]);

      // Valid: both assets conserved
      const valid = await client.receive([
        "hash://sha256/multi-asset-valid",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-seed-4"],
            outputs: [
              ["store://balance/bob/utxo-4a", { fire: 60, usd: 30 }, null],
              ["store://balance/alice/utxo-4b", { fire: 40, usd: 20 }, null],
            ],
          },
        },
      ]);

      assertEquals(valid.accepted, true);
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - conservation: reject if any asset key overflows`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed
      await client.receive([
        "store://balance/alice/utxo-seed-5",
        { fire: 100, usd: 50 },
        null,
      ]);

      // fire is conserved (100 → 100), but usd overflows (50 → 80)
      const result = await client.receive([
        "hash://sha256/multi-asset-overflow",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-seed-5"],
            outputs: [
              ["store://balance/bob/utxo-5", { fire: 100, usd: 80 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, false);
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - conservation: multiple inputs summed`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed two UTXOs
      await client.receive([
        "store://balance/alice/utxo-seed-6a",
        { fire: 30 },
        null,
      ]);
      await client.receive([
        "store://balance/alice/utxo-seed-6b",
        { fire: 70 },
        null,
      ]);

      // Combine: 30 + 70 = 100 in → 100 out
      const result = await client.receive([
        "hash://sha256/combine-inputs",
        {},
        {
          payload: {
            inputs: [
              "store://balance/alice/utxo-seed-6a",
              "store://balance/alice/utxo-seed-6b",
            ],
            outputs: [
              ["store://balance/alice/utxo-combined", { fire: 100 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, true);
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - conservation: reject nonexistent input`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      const result = await client.receive([
        "hash://sha256/phantom-input",
        {},
        {
          payload: {
            inputs: ["store://balance/ghost/does-not-exist"],
            outputs: [
              ["store://balance/bob/utxo-phantom", { fire: 50 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, false);
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - conservation: outputs with empty values skip conservation`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // A message with no inputs and no values on outputs — pure data write
      const result = await client.receive([
        "hash://sha256/pure-data-envelope",
        {},
        {
          payload: {
            inputs: [],
            outputs: [
              ["store://data/some-key", {}, { info: "just data" }],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, true);
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - conservation: reject negative output values`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      await client.receive([
        "store://balance/alice/utxo-seed-neg",
        { fire: 100 },
        null,
      ]);

      const result = await client.receive([
        "hash://sha256/negative-output",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-seed-neg"],
            outputs: [
              ["store://balance/bob/utxo-neg", { fire: -50 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, false);
    },
  });

  // ── Consumption (inputs are deleted) ───────────────────────────────

  Deno.test({
    name: `${suiteName} [Values] - consumption: input is deleted after acceptance`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed
      await client.receive([
        "store://balance/alice/utxo-consume-1",
        { fire: 100 },
        null,
      ]);

      // Verify it exists
      const before = await client.read("store://balance/alice/utxo-consume-1");
      assertEquals(before[0].success, true);

      // Spend it
      await client.receive([
        "hash://sha256/consume-test-1",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-consume-1"],
            outputs: [
              ["store://balance/bob/utxo-from-consume", { fire: 100 }, null],
            ],
          },
        },
      ]);

      // Input is gone
      const after = await client.read("store://balance/alice/utxo-consume-1");
      assertEquals(after[0].success, false, "Spent input should no longer exist");
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - consumption: double-spend rejected (input gone)`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed
      await client.receive([
        "store://balance/alice/utxo-double-1",
        { fire: 100 },
        null,
      ]);

      // First spend — succeeds
      const first = await client.receive([
        "hash://sha256/double-spend-1",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-double-1"],
            outputs: [
              ["store://balance/bob/utxo-ds-1", { fire: 100 }, null],
            ],
          },
        },
      ]);
      assertEquals(first.accepted, true);

      // Second spend — fails (input no longer exists)
      const second = await client.receive([
        "hash://sha256/double-spend-2",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-double-1"],
            outputs: [
              ["store://balance/charlie/utxo-ds-2", { fire: 100 }, null],
            ],
          },
        },
      ]);
      assertEquals(second.accepted, false);
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - consumption: all inputs deleted, all outputs created`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed two inputs
      await client.receive([
        "store://balance/alice/utxo-multi-in-a",
        { fire: 40 },
        null,
      ]);
      await client.receive([
        "store://balance/alice/utxo-multi-in-b",
        { fire: 60 },
        null,
      ]);

      // Spend both → two outputs
      const result = await client.receive([
        "hash://sha256/multi-consume",
        {},
        {
          payload: {
            inputs: [
              "store://balance/alice/utxo-multi-in-a",
              "store://balance/alice/utxo-multi-in-b",
            ],
            outputs: [
              ["store://balance/bob/utxo-mc-1", { fire: 70 }, null],
              ["store://balance/alice/utxo-mc-2", { fire: 30 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, true);

      // Both inputs gone
      const inA = await client.read("store://balance/alice/utxo-multi-in-a");
      assertEquals(inA[0].success, false);
      const inB = await client.read("store://balance/alice/utxo-multi-in-b");
      assertEquals(inB[0].success, false);

      // Both outputs exist
      const outA = await client.read("store://balance/bob/utxo-mc-1");
      assertEquals(outA[0].success, true);
      assertEquals(outA[0].record?.values, { fire: 70 });
      const outB = await client.read("store://balance/alice/utxo-mc-2");
      assertEquals(outB[0].success, true);
      assertEquals(outB[0].record?.values, { fire: 30 });
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - consumption: chained transfers`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed
      await client.receive([
        "store://balance/alice/utxo-chain-0",
        { fire: 100 },
        null,
      ]);

      // Alice → Bob
      await client.receive([
        "hash://sha256/chain-1",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-chain-0"],
            outputs: [
              ["store://balance/bob/utxo-chain-1", { fire: 100 }, null],
            ],
          },
        },
      ]);

      // Bob → Charlie
      await client.receive([
        "hash://sha256/chain-2",
        {},
        {
          payload: {
            inputs: ["store://balance/bob/utxo-chain-1"],
            outputs: [
              ["store://balance/charlie/utxo-chain-2", { fire: 100 }, null],
            ],
          },
        },
      ]);

      // Only charlie's UTXO exists
      const alice = await client.read("store://balance/alice/utxo-chain-0");
      assertEquals(alice[0].success, false);
      const bob = await client.read("store://balance/bob/utxo-chain-1");
      assertEquals(bob[0].success, false);
      const charlie = await client.read("store://balance/charlie/utxo-chain-2");
      assertEquals(charlie[0].success, true);
      assertEquals(charlie[0].record?.values, { fire: 100 });
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - consumption: failed conservation does not delete inputs`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed
      await client.receive([
        "store://balance/alice/utxo-safe-1",
        { fire: 50 },
        null,
      ]);

      // Try to inflate — should fail
      const result = await client.receive([
        "hash://sha256/inflate-attempt",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-safe-1"],
            outputs: [
              ["store://balance/bob/utxo-inflated", { fire: 500 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, false);

      // Input is still there (transaction rolled back)
      const still = await client.read("store://balance/alice/utxo-safe-1");
      assertEquals(still[0].success, true, "Input must survive failed transaction");
      assertEquals(still[0].record?.values, { fire: 50 });
    },
  });

  // ── Issuance ───────────────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} [Values] - issuance: reject value from nothing without policy`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // No inputs, but outputs carry value — rejected without issuance policy
      const result = await client.receive([
        "hash://sha256/free-money",
        {},
        {
          payload: {
            inputs: [],
            outputs: [
              ["store://balance/alice/utxo-free", { fire: 1000 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, false);
    },
  });

  if (factory.withIssuance) {
    Deno.test({
      name: `${suiteName} [Values] - issuance: allowed with issuance policy`,
      ...noSanitize,
      fn: async () => {
        const client = await Promise.resolve(factory.withIssuance!());

        // With issuance policy, value from nothing is accepted
        const result = await client.receive([
          "hash://sha256/genesis-mint",
          {},
          {
            payload: {
              inputs: [],
              outputs: [
                ["store://balance/alice/utxo-genesis", { fire: 1000 }, null],
              ],
            },
          },
        ]);

        assertEquals(result.accepted, true);

        const readResults = await client.read(
          "store://balance/alice/utxo-genesis",
        );
        assertEquals(readResults[0].success, true);
        assertEquals(readResults[0].record?.values, { fire: 1000 });
      },
    });
  }

  // ── Edge cases ─────────────────────────────────────────────────────

  Deno.test({
    name: `${suiteName} [Values] - envelope with empty inputs and zero-value outputs`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // No inputs, outputs carry no value — pure data envelope
      const result = await client.receive([
        "hash://sha256/zero-value-envelope",
        {},
        {
          payload: {
            inputs: [],
            outputs: [
              ["store://data/note-1", {}, { text: "hello" }],
              ["store://data/note-2", {}, { text: "world" }],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, true);

      const note1 = await client.read("store://data/note-1");
      assertEquals(note1[0].success, true);
      assertEquals(note1[0].record?.data, { text: "hello" });

      const note2 = await client.read("store://data/note-2");
      assertEquals(note2[0].success, true);
      assertEquals(note2[0].record?.data, { text: "world" });
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - input with zero values can be consumed freely`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed a zero-value record
      await client.receive(["store://data/note-to-consume", {}, { text: "temporary" }]);

      // Consume it — no conservation needed (zero in, zero out)
      const result = await client.receive([
        "hash://sha256/consume-zero",
        {},
        {
          payload: {
            inputs: ["store://data/note-to-consume"],
            outputs: [
              ["store://data/note-replacement", {}, { text: "replacement" }],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, true);

      // Input gone
      const old = await client.read("store://data/note-to-consume");
      assertEquals(old[0].success, false);

      // Output exists
      const replacement = await client.read("store://data/note-replacement");
      assertEquals(replacement[0].success, true);
    },
  });

  Deno.test({
    name: `${suiteName} [Values] - new asset key in outputs that doesn't exist in inputs is rejected`,
    ...noSanitize,
    fn: async () => {
      const client = await Promise.resolve(factory.happy());

      // Seed with only 'fire'
      await client.receive([
        "store://balance/alice/utxo-seed-new-asset",
        { fire: 100 },
        null,
      ]);

      // Try to output 'usd' which doesn't exist in inputs
      const result = await client.receive([
        "hash://sha256/new-asset-inject",
        {},
        {
          payload: {
            inputs: ["store://balance/alice/utxo-seed-new-asset"],
            outputs: [
              ["store://balance/alice/utxo-with-new", { fire: 100, usd: 50 }, null],
            ],
          },
        },
      ]);

      assertEquals(result.accepted, false);
    },
  });
}

/**
 * Transaction Envelope Unpack Tests
 *
 * Tests for isTransactionData detection, txnSchema validator,
 * client-level TransactionData unpacking, and integration with
 * the unified node system.
 */

import { assertEquals } from "@std/assert";
import { isTransactionData } from "./detect.ts";
import type { TransactionData } from "./types.ts";
import type { Schema } from "../src/types.ts";
import { MemoryClient } from "../clients/memory/mod.ts";
import {
  createNode,
  firstMatch,
  parallel,
  txnSchema,
} from "../src/node/mod.ts";

// =============================================================================
// isTransactionData detection
// =============================================================================

Deno.test("isTransactionData - detects valid TransactionData", () => {
  const valid: TransactionData = {
    inputs: ["utxo://alice/1"],
    outputs: [
      ["mutable://open/x", { value: 1 }],
      ["mutable://open/y", { value: 2 }],
    ],
  };
  assertEquals(isTransactionData(valid), true);
});

Deno.test("isTransactionData - detects valid with empty inputs/outputs", () => {
  assertEquals(isTransactionData({ inputs: [], outputs: [] }), true);
});

Deno.test("isTransactionData - rejects null", () => {
  assertEquals(isTransactionData(null), false);
});

Deno.test("isTransactionData - rejects primitives", () => {
  assertEquals(isTransactionData("string"), false);
  assertEquals(isTransactionData(42), false);
  assertEquals(isTransactionData(undefined), false);
});

Deno.test("isTransactionData - rejects missing inputs", () => {
  assertEquals(isTransactionData({ outputs: [] }), false);
});

Deno.test("isTransactionData - rejects missing outputs", () => {
  assertEquals(isTransactionData({ inputs: [] }), false);
});

Deno.test("isTransactionData - rejects malformed outputs", () => {
  assertEquals(
    isTransactionData({ inputs: [], outputs: [["only-one-element"]] }),
    false,
  );
  assertEquals(
    isTransactionData({ inputs: [], outputs: [[123, "value"]] }),
    false,
  );
});

Deno.test("isTransactionData - rejects plain objects (not TransactionData)", () => {
  assertEquals(isTransactionData({ name: "Alice", age: 30 }), false);
  assertEquals(isTransactionData({ data: "hello" }), false);
});

// =============================================================================
// Client-level TransactionData unpacking (MemoryClient)
// =============================================================================

Deno.test("MemoryClient - unpacks TransactionData outputs on receive", async () => {
  const client = new MemoryClient({
    schema: {
      "mutable://open": async () => ({ valid: true }),
      "txn://open": async () => ({ valid: true }),
    },
  });

  const txData: TransactionData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", { value: 1 }],
      ["mutable://open/y", { value: 2 }],
    ],
  };

  const result = await client.receive(["txn://open/test", txData]);
  assertEquals(result.accepted, true);

  // Verify envelope was stored
  const envelope = await client.read("txn://open/test");
  assertEquals(envelope.success, true);

  // Verify each output was stored
  const readX = await client.read("mutable://open/x");
  assertEquals(readX.success, true);
  assertEquals(readX.record?.data, { value: 1 });

  const readY = await client.read("mutable://open/y");
  assertEquals(readY.success, true);
  assertEquals(readY.record?.data, { value: 2 });
});

Deno.test("MemoryClient - plain data stored normally (no unpacking)", async () => {
  const client = new MemoryClient({
    schema: {
      "mutable://open": async () => ({ valid: true }),
    },
  });

  const result = await client.receive(["mutable://open/z", { name: "Alice" }]);
  assertEquals(result.accepted, true);

  const read = await client.read("mutable://open/z");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, { name: "Alice" });
});

Deno.test("MemoryClient - fails if any output in TransactionData fails", async () => {
  const client = new MemoryClient({
    schema: {
      "mutable://open": async () => ({ valid: true }),
      "txn://open": async () => ({ valid: true }),
      // No schema for "unknown://program"
    },
  });

  const txData: TransactionData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", { value: 1 }],
      ["unknown://program/y", { value: 2 }], // Will fail
    ],
  };

  const result = await client.receive(["txn://open/test", txData]);
  assertEquals(result.accepted, false);
});

// =============================================================================
// txnSchema validator
// =============================================================================

Deno.test("txnSchema - validates each output against schema", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "txn://open": async () => ({ valid: true }),
  };

  const validator = txnSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const txData: TransactionData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", { value: 1 }],
      ["mutable://open/y", { value: 2 }],
    ],
  };

  const result = await validator(["txn://open/test", txData], read);
  assertEquals(result.valid, true);
});

Deno.test("txnSchema - rejects if output program unknown", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "txn://open": async () => ({ valid: true }),
  };

  const validator = txnSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const txData: TransactionData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", { value: 1 }],
      ["unknown://program/y", { value: 2 }],
    ],
  };

  const result = await validator(["txn://open/test", txData], read);
  assertEquals(result.valid, false);
  assertEquals(result.error, "Unknown program: unknown://program");
});

Deno.test("txnSchema - delegates non-TransactionData to plain schema validation", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
  };

  const validator = txnSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const result = await validator(["mutable://open/x", { name: "Alice" }], read);
  assertEquals(result.valid, true);
});

Deno.test("txnSchema - rejects non-TransactionData with unknown program", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
  };

  const validator = txnSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const result = await validator(
    ["unknown://program/x", { name: "Alice" }],
    read,
  );
  assertEquals(result.valid, false);
  assertEquals(result.error, "Unknown program: unknown://program");
});

// =============================================================================
// Integration tests (node + client)
// =============================================================================

Deno.test("integration - receive TransactionData through node → client unpacks outputs", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "txn://open": async () => ({ valid: true }),
  };

  const client = new MemoryClient({ schema: testSchema });

  const node = createNode({
    read: firstMatch(client),
    validate: txnSchema(testSchema),
    process: parallel(client),
  });

  const txData: TransactionData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", { value: 1 }],
      ["mutable://open/y", { value: 2 }],
    ],
  };

  const result = await node.receive(["txn://open/test-1", txData]);
  assertEquals(result.accepted, true);

  // Envelope stored
  const storedTxn = await client.read("txn://open/test-1");
  assertEquals(storedTxn.success, true);
  assertEquals(storedTxn.record?.data, txData);

  // Outputs stored by client
  const readX = await client.read("mutable://open/x");
  assertEquals(readX.success, true);
  assertEquals(readX.record?.data, { value: 1 });

  const readY = await client.read("mutable://open/y");
  assertEquals(readY.success, true);
  assertEquals(readY.record?.data, { value: 2 });
});

Deno.test("integration - plain transactions still work alongside TransactionData", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "txn://open": async () => ({ valid: true }),
  };

  const client = new MemoryClient({ schema: testSchema });

  const node = createNode({
    read: firstMatch(client),
    validate: txnSchema(testSchema),
    process: parallel(client),
  });

  // Plain transaction
  const plainResult = await node.receive(["mutable://open/plain", {
    name: "Alice",
  }]);
  assertEquals(plainResult.accepted, true);

  const readPlain = await client.read("mutable://open/plain");
  assertEquals(readPlain.success, true);
  assertEquals(readPlain.record?.data, { name: "Alice" });

  // TransactionData
  const txData: TransactionData = {
    inputs: [],
    outputs: [["mutable://open/from-txn", { value: 42 }]],
  };
  const txnResult = await node.receive(["txn://open/test-2", txData]);
  assertEquals(txnResult.accepted, true);

  const readFromTxn = await client.read("mutable://open/from-txn");
  assertEquals(readFromTxn.success, true);
  assertEquals(readFromTxn.record?.data, { value: 42 });
});

Deno.test("integration - TransactionData with mixed programs (mutable + immutable)", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "immutable://open": async ({ uri, read }) => {
      const existing = await read(uri);
      return { valid: !existing.success };
    },
    "txn://open": async () => ({ valid: true }),
  };

  const client = new MemoryClient({ schema: testSchema });

  const node = createNode({
    read: firstMatch(client),
    validate: txnSchema(testSchema),
    process: parallel(client),
  });

  const txData: TransactionData = {
    inputs: [],
    outputs: [
      ["mutable://open/a", { mutable: true }],
      ["immutable://open/b", { immutable: true }],
    ],
  };

  const result = await node.receive(["txn://open/mixed-1", txData]);
  assertEquals(result.accepted, true);

  const readA = await client.read("mutable://open/a");
  assertEquals(readA.success, true);
  assertEquals(readA.record?.data, { mutable: true });

  const readB = await client.read("immutable://open/b");
  assertEquals(readB.success, true);
  assertEquals(readB.record?.data, { immutable: true });
});

Deno.test("integration - txnSchema rejects invalid outputs before client sees them", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "mutable://restricted": async () => ({
      valid: false,
      error: "access denied",
    }),
    "txn://open": async () => ({ valid: true }),
  };

  const client = new MemoryClient({ schema: testSchema });

  const node = createNode({
    read: firstMatch(client),
    validate: txnSchema(testSchema),
    process: parallel(client),
  });

  const txData: TransactionData = {
    inputs: [],
    outputs: [
      ["mutable://open/ok", { value: 1 }],
      ["mutable://restricted/nope", { value: 2 }],
    ],
  };

  // txnSchema rejects because mutable://restricted fails
  const result = await node.receive(["txn://open/fail-1", txData]);
  assertEquals(result.accepted, false);

  // Nothing stored — validation rejected before processing
  const readOk = await client.read("mutable://open/ok");
  assertEquals(readOk.success, false);

  const readNope = await client.read("mutable://restricted/nope");
  assertEquals(readNope.success, false);
});

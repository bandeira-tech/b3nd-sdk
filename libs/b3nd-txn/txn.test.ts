/**
 * Transaction Layer Tests
 *
 * Tests for the txn module (Level 1) and txn-data module (Level 2)
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  createTransactionNode,
  type Transaction,
  type TransactionValidator,
} from "./mod.ts";
import {
  combineValidators,
  createOutputValidator,
  extractProgram,
  type StateTransaction,
  type TransactionData,
} from "./data/mod.ts";
import { createTestSchema, MemoryClient } from "../b3nd-client-memory/mod.ts";

// =============================================================================
// Level 1: Transaction Node Tests
// =============================================================================

Deno.test("createTransactionNode - accepts valid transaction", async () => {
  const validator: TransactionValidator = async () => ({ valid: true });

  const storage = new MemoryClient({
    schema: { "txn://alice": async () => ({ valid: true }) },
  });

  const node = createTransactionNode({
    validate: validator,
    read: storage,
    peers: [storage],
  });

  const result = await node.receive([
    "txn://alice/transfer/42",
    { amount: 100 },
  ]);

  assertEquals(result.accepted, true);
  assertEquals(result.error, undefined);

  // Verify transaction was stored
  const stored = await storage.read("txn://alice/transfer/42");
  assertEquals(stored.success, true);
  assertEquals(stored.record?.data, { amount: 100 });

  await node.cleanup();
});

Deno.test("createTransactionNode - rejects invalid transaction", async () => {
  const validator: TransactionValidator = async () => ({
    valid: false,
    error: "insufficient_balance",
  });

  const storage = new MemoryClient({
    schema: { "txn://alice": async () => ({ valid: true }) },
  });

  const node = createTransactionNode({
    validate: validator,
    read: storage,
    peers: [storage],
  });

  const result = await node.receive([
    "txn://alice/transfer/42",
    { amount: 100 },
  ]);

  assertEquals(result.accepted, false);
  assertEquals(result.error, "insufficient_balance");

  // Verify transaction was NOT stored
  const stored = await storage.read("txn://alice/transfer/42");
  assertEquals(stored.success, false);

  await node.cleanup();
});

Deno.test("createTransactionNode - validator can read state", async () => {
  const storage = new MemoryClient({
    schema: {
      "txn://alice": async () => ({ valid: true }),
      "accounts://balances": async () => ({ valid: true }),
    },
  });

  // Pre-populate balance
  await storage.receive(["accounts://balances/alice", { balance: 50 }]);

  const validator: TransactionValidator<{ amount: number }> = async (
    tx,
    read,
  ) => {
    const [, data] = tx;
    const balance = await read<{ balance: number }>(
      "accounts://balances/alice",
    );

    if (!balance.success || balance.record!.data.balance < data.amount) {
      return { valid: false, error: "insufficient_balance" };
    }
    return { valid: true };
  };

  const node = createTransactionNode({
    validate: validator,
    read: storage,
    peers: [storage],
  });

  // Try to transfer more than balance
  const result1 = await node.receive([
    "txn://alice/transfer/1",
    { amount: 100 },
  ]);
  assertEquals(result1.accepted, false);
  assertEquals(result1.error, "insufficient_balance");

  // Transfer within balance
  const result2 = await node.receive([
    "txn://alice/transfer/2",
    { amount: 25 },
  ]);
  assertEquals(result2.accepted, true);

  await node.cleanup();
});

Deno.test("createTransactionNode - propagates to multiple peers", async () => {
  const peer1 = new MemoryClient({
    schema: { "txn://alice": async () => ({ valid: true }) },
  });
  const peer2 = new MemoryClient({
    schema: { "txn://alice": async () => ({ valid: true }) },
  });

  const node = createTransactionNode({
    validate: async () => ({ valid: true }),
    read: peer1,
    peers: [peer1, peer2],
  });

  const result = await node.receive([
    "txn://alice/transfer/42",
    { amount: 100 },
  ]);

  assertEquals(result.accepted, true);

  // Verify both peers received the transaction
  const stored1 = await peer1.read("txn://alice/transfer/42");
  const stored2 = await peer2.read("txn://alice/transfer/42");

  assertEquals(stored1.success, true);
  assertEquals(stored2.success, true);
  assertEquals(stored1.record?.data, { amount: 100 });
  assertEquals(stored2.record?.data, { amount: 100 });

  await node.cleanup();
});

Deno.test("createTransactionNode - rejects transaction without URI", async () => {
  const storage = new MemoryClient({
    schema: { "txn://alice": async () => ({ valid: true }) },
  });

  const node = createTransactionNode({
    validate: async () => ({ valid: true }),
    read: storage,
    peers: [storage],
  });

  const result = await node.receive(["", { amount: 100 }]);

  assertEquals(result.accepted, false);
  assertEquals(result.error, "Transaction URI is required");

  await node.cleanup();
});

// =============================================================================
// Level 2: Transaction Data Convention Tests
// =============================================================================

Deno.test("extractProgram - extracts protocol://hostname", () => {
  assertEquals(extractProgram("immutable://blob/abc123"), "immutable://blob");
  assertEquals(
    extractProgram("mutable://accounts/alice/profile"),
    "mutable://accounts",
  );
  assertEquals(extractProgram("txn://firecat/block/1000"), "txn://firecat");
  assertEquals(extractProgram("utxo://alice/1"), "utxo://alice");
  assertEquals(extractProgram("fees://pool"), "fees://pool");
});

Deno.test("extractProgram - returns null for invalid URIs", () => {
  assertEquals(extractProgram("not-a-uri"), null);
  assertEquals(extractProgram(""), null);
});

Deno.test("createOutputValidator - validates outputs against schema", async () => {
  const validator = createOutputValidator({
    schema: {
      "utxo://bob": async () => ({ valid: true }),
      "utxo://alice": async () => ({ valid: true }),
      "fees://pool": async (ctx) => {
        if (typeof ctx.value !== "number" || ctx.value < 1) {
          return { valid: false, error: "fee must be at least 1" };
        }
        return { valid: true };
      },
    },
  });

  // Valid transaction
  const validTx: StateTransaction<number> = [
    "txn://alice/transfer/42",
    {
      inputs: ["utxo://alice/1"],
      outputs: [
        ["utxo://bob/99", 50],
        ["utxo://alice/2", 30],
        ["fees://pool", 1],
      ],
    },
  ];

  const read = async () => ({ success: false, error: "not found" });
  const result1 = await validator(validTx, read);
  assertEquals(result1.valid, true);

  // Invalid transaction (fee too low)
  const invalidTx: StateTransaction<number> = [
    "txn://alice/transfer/43",
    {
      inputs: ["utxo://alice/1"],
      outputs: [
        ["utxo://bob/99", 50],
        ["fees://pool", 0], // Invalid: fee is 0
      ],
    },
  ];

  const result2 = await validator(invalidTx, read);
  assertEquals(result2.valid, false);
  assertEquals(result2.error, "fees://pool: fee must be at least 1");
});

Deno.test("createOutputValidator - provides cross-output access", async () => {
  // Fee validator that requires fee based on blob size
  const validator = createOutputValidator<unknown>({
    schema: {
      "immutable://blob": async (ctx) => {
        // Check for fee output in the same transaction
        const feeOutput = ctx.outputs.find(([uri]) =>
          uri.startsWith("fees://")
        );
        if (!feeOutput) {
          return { valid: false, error: "fee_required" };
        }

        const blobSize = JSON.stringify(ctx.value).length;
        const requiredFee = Math.ceil(blobSize / 100); // 1 per 100 bytes

        if ((feeOutput[1] as number) < requiredFee) {
          return {
            valid: false,
            error: `insufficient_fee: need ${requiredFee}`,
          };
        }

        return { valid: true };
      },
      "fees://pool": async () => ({ valid: true }),
    },
  });

  const read = async () => ({ success: false, error: "not found" });

  // Valid: blob with sufficient fee
  const validTx: StateTransaction<unknown> = [
    "txn://alice/store/1",
    {
      inputs: [],
      outputs: [
        ["immutable://blob/abc123", { data: "hello world" }], // ~30 bytes
        ["fees://pool", 1],
      ],
    },
  ];
  const result1 = await validator(validTx, read);
  assertEquals(result1.valid, true);

  // Invalid: blob without fee
  const noFeeTx: StateTransaction<unknown> = [
    "txn://alice/store/2",
    {
      inputs: [],
      outputs: [["immutable://blob/def456", { data: "hello" }]],
    },
  ];
  const result2 = await validator(noFeeTx, read);
  assertEquals(result2.valid, false);
  assertEquals(result2.error, "immutable://blob: fee_required");
});

Deno.test("createOutputValidator - with preValidate", async () => {
  const validator = createOutputValidator({
    schema: {
      "utxo://test": async () => ({ valid: true }),
    },
    preValidate: async (tx) => {
      const [, data] = tx;
      if (!("sig" in data)) {
        return { valid: false, error: "signature_required" };
      }
      return { valid: true };
    },
  });

  const read = async () => ({ success: false, error: "not found" });

  // Missing signature
  const noSigTx: StateTransaction & { sig?: string } = [
    "txn://alice/1",
    {
      inputs: [],
      outputs: [["utxo://test/1", 100]],
    },
  ];
  const result1 = await validator(noSigTx as any, read);
  assertEquals(result1.valid, false);
  assertEquals(result1.error, "signature_required");

  // With signature
  const withSigTx = [
    "txn://alice/2",
    {
      sig: "abc123",
      inputs: [],
      outputs: [["utxo://test/2", 100]],
    },
  ] as const;
  const result2 = await validator(withSigTx as any, read);
  assertEquals(result2.valid, true);
});

Deno.test("combineValidators - all must pass", async () => {
  const v1: TransactionValidator = async () => ({ valid: true });
  const v2: TransactionValidator = async () => ({ valid: true });
  const v3: TransactionValidator = async () => ({
    valid: false,
    error: "v3_failed",
  });

  const read = async () => ({ success: false, error: "not found" });

  // All pass
  const combined1 = combineValidators(v1, v2);
  const result1 = await combined1(["txn://test/1", {}], read);
  assertEquals(result1.valid, true);

  // One fails
  const combined2 = combineValidators(v1, v3, v2);
  const result2 = await combined2(["txn://test/2", {}], read);
  assertEquals(result2.valid, false);
  assertEquals(result2.error, "v3_failed");
});

// =============================================================================
// Integration: Level 1 + Level 2
// =============================================================================

Deno.test("integration - transaction node with output validator", async () => {
  const storage = new MemoryClient({
    schema: {
      "txn://transfers": async () => ({ valid: true }),
      "utxo://alice": async () => ({ valid: true }),
      "utxo://bob": async () => ({ valid: true }),
    },
  });

  // Pre-populate UTXOs
  await storage.receive(["utxo://alice/1", { amount: 100 }]);

  const validator = createOutputValidator<number>({
    schema: {
      "utxo://alice": async (ctx) => {
        // Check that we're not creating money out of thin air
        if (ctx.value < 0) {
          return { valid: false, error: "negative_amount" };
        }
        return { valid: true };
      },
      "utxo://bob": async (ctx) => {
        if (ctx.value < 0) {
          return { valid: false, error: "negative_amount" };
        }
        return { valid: true };
      },
    },
    preValidate: async (tx, read) => {
      const [, data] = tx;

      // Sum inputs
      let inputSum = 0;
      for (const inputUri of data.inputs) {
        const input = await read<{ amount: number }>(inputUri);
        if (input.success && input.record) {
          inputSum += input.record.data.amount;
        }
      }

      // Sum outputs
      const outputSum = data.outputs.reduce(
        (sum, [, value]) => sum + (value as number),
        0,
      );

      // Inputs must cover outputs (conservation)
      if (outputSum > inputSum) {
        return { valid: false, error: "outputs_exceed_inputs" };
      }

      return { valid: true };
    },
  });

  const node = createTransactionNode({
    validate: validator,
    read: storage,
    peers: [storage],
  });

  // Valid transfer: 100 in, 50 + 50 out
  const validTx: StateTransaction<number> = [
    "txn://transfers/1",
    {
      inputs: ["utxo://alice/1"],
      outputs: [
        ["utxo://bob/1", 50],
        ["utxo://alice/2", 50],
      ],
    },
  ];

  const result1 = await node.receive(validTx);
  assertEquals(result1.accepted, true);

  // Invalid transfer: trying to create money
  const invalidTx: StateTransaction<number> = [
    "txn://transfers/2",
    {
      inputs: ["utxo://alice/2"], // Only 50 available
      outputs: [
        ["utxo://bob/2", 100], // Trying to send 100
      ],
    },
  ];

  // First, store alice/2 with value 50
  await storage.receive(["utxo://alice/2", { amount: 50 }]);

  const result2 = await node.receive(invalidTx);
  assertEquals(result2.accepted, false);
  assertEquals(result2.error, "outputs_exceed_inputs");

  await node.cleanup();
});

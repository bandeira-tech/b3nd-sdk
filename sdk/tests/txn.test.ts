/**
 * Transaction Node Tests
 *
 * Tests the transaction layer including:
 * - Transaction submission and validation
 * - Peer propagation
 * - Subscription to transaction streams
 * - Data node materialization
 */

import { assertEquals, assertExists } from "@std/assert";
import { MemoryClient } from "../clients/memory/mod.ts";
import {
  acceptAllValidator,
  combineValidators,
  createSignatureValidator,
  createTransactionNode,
  type Transaction,
  type TransactionValidator,
} from "../txn/mod.ts";
import {
  buildTransaction,
  createConservationValidator,
  createFeeValidator,
  createStateValidator,
  createUTXOValidator,
  parseLifecycleUri,
  type StateTransaction,
  validatedUri,
  includedUri,
  confirmedUri,
} from "../txn-data/mod.ts";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function createTestMemoryClient() {
  return new MemoryClient({
    schema: {
      "txn://": async () => ({ valid: true }),
      "utxo://": async () => ({ valid: true }),
      "store://": async () => ({ valid: true }),
      "fees://": async () => ({ valid: true }),
    },
  });
}

// =============================================================================
// TRANSACTION NODE TESTS
// =============================================================================

Deno.test("TransactionNode - accept valid transaction", async () => {
  const readClient = createTestMemoryClient();

  const node = createTransactionNode({
    validate: acceptAllValidator,
    read: readClient,
    peers: [],
  });

  const tx: Transaction = ["txn://alice/1", { value: "hello" }];
  const result = await node.receive(tx);

  assertEquals(result.accepted, true);
  assertEquals(result.uri, "txn://alice/1");
  assertExists(result.ts);

  await node.cleanup();
});

Deno.test("TransactionNode - reject invalid transaction", async () => {
  const readClient = createTestMemoryClient();

  const rejectValidator: TransactionValidator = async () => ({
    valid: false,
    error: "always_reject",
  });

  const node = createTransactionNode({
    validate: rejectValidator,
    read: readClient,
    peers: [],
  });

  const tx: Transaction = ["txn://alice/1", { value: "hello" }];
  const result = await node.receive(tx);

  assertEquals(result.accepted, false);
  assertEquals(result.error, "always_reject");

  await node.cleanup();
});

Deno.test("TransactionNode - submit alias for receive", async () => {
  const readClient = createTestMemoryClient();

  const node = createTransactionNode({
    validate: acceptAllValidator,
    read: readClient,
    peers: [],
  });

  const tx: Transaction = ["txn://alice/2", { value: "test" }];
  const result = await node.submit(tx);

  assertEquals(result.accepted, true);
  assertEquals(result.uri, "txn://alice/2");

  await node.cleanup();
});

Deno.test("TransactionNode - propagate to peers", async () => {
  const readClient = createTestMemoryClient();
  const peerClient = createTestMemoryClient();

  const node = createTransactionNode({
    validate: acceptAllValidator,
    read: readClient,
    peers: [peerClient],
    awaitPropagation: true,
  });

  const tx: Transaction = ["txn://alice/3", { value: "propagated" }];
  const result = await node.submit(tx);

  assertEquals(result.accepted, true);
  assertExists(result.propagation);
  assertEquals(result.propagation?.total, 1);
  assertEquals(result.propagation?.succeeded, 1);
  assertEquals(result.propagation?.failed, 0);

  // Verify data was written to peer
  const peerRead = await peerClient.read("txn://alice/3");
  assertEquals(peerRead.success, true);
  assertEquals(peerRead.record?.data, { value: "propagated" });

  await node.cleanup();
});

Deno.test("TransactionNode - async propagation (default)", async () => {
  const readClient = createTestMemoryClient();
  const peerClient = createTestMemoryClient();

  const node = createTransactionNode({
    validate: acceptAllValidator,
    read: readClient,
    peers: [peerClient],
    // awaitPropagation: false (default)
  });

  const tx: Transaction = ["txn://alice/4", { value: "async" }];
  const result = await node.submit(tx);

  assertEquals(result.accepted, true);
  // Propagation result not available in async mode
  assertEquals(result.propagation, undefined);

  // Wait a bit for async propagation
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Verify data was written to peer
  const peerRead = await peerClient.read("txn://alice/4");
  assertEquals(peerRead.success, true);

  await node.cleanup();
});

Deno.test("TransactionNode - validator can read state", async () => {
  const readClient = createTestMemoryClient();

  // Pre-populate some state
  await readClient.write("store://accounts/alice", { balance: 100 });

  const balanceValidator: TransactionValidator = async (tx, ctx) => {
    const [, data] = tx;
    const account = await ctx.read<{ balance: number }>("store://accounts/alice");

    if (!account.success || !account.record) {
      return { valid: false, error: "account_not_found" };
    }

    if (account.record.data.balance < (data as { amount: number }).amount) {
      return { valid: false, error: "insufficient_balance" };
    }

    return { valid: true };
  };

  const node = createTransactionNode({
    validate: balanceValidator,
    read: readClient,
    peers: [],
  });

  // Valid transaction (amount <= balance)
  const validTx: Transaction = ["txn://alice/transfer/1", { amount: 50 }];
  const validResult = await node.submit(validTx);
  assertEquals(validResult.accepted, true);

  // Invalid transaction (amount > balance)
  const invalidTx: Transaction = ["txn://alice/transfer/2", { amount: 150 }];
  const invalidResult = await node.submit(invalidTx);
  assertEquals(invalidResult.accepted, false);
  assertEquals(invalidResult.error, "insufficient_balance");

  await node.cleanup();
});

Deno.test("TransactionNode - health check", async () => {
  const readClient = createTestMemoryClient();
  const peerClient = createTestMemoryClient();

  const node = createTransactionNode({
    validate: acceptAllValidator,
    read: readClient,
    peers: [peerClient],
  });

  const health = await node.health();

  assertEquals(health.status, "healthy");
  assertExists(health.read);
  assertEquals(health.read?.status, "healthy");
  assertExists(health.peers);
  assertEquals(health.peers?.length, 1);
  assertExists(health.stats);

  await node.cleanup();
});

Deno.test("TransactionNode - subscription", async () => {
  const readClient = createTestMemoryClient();

  const node = createTransactionNode({
    validate: acceptAllValidator,
    read: readClient,
    peers: [],
  });

  const received: Transaction[] = [];

  // Start subscription in background
  const subscriptionPromise = (async () => {
    for await (const tx of node.subscribe()) {
      received.push(tx);
      if (received.length >= 3) break;
    }
  })();

  // Submit transactions
  await node.submit(["txn://alice/1", { n: 1 }]);
  await node.submit(["txn://alice/2", { n: 2 }]);
  await node.submit(["txn://alice/3", { n: 3 }]);

  // Wait for subscription to collect
  await Promise.race([
    subscriptionPromise,
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);

  assertEquals(received.length, 3);
  assertEquals(received[0][0], "txn://alice/1");
  assertEquals(received[1][0], "txn://alice/2");
  assertEquals(received[2][0], "txn://alice/3");

  await node.cleanup();
});

Deno.test("TransactionNode - subscription with filter", async () => {
  const readClient = createTestMemoryClient();

  const node = createTransactionNode({
    validate: acceptAllValidator,
    read: readClient,
    peers: [],
  });

  const received: Transaction[] = [];

  // Subscribe only to alice's transactions
  const subscriptionPromise = (async () => {
    for await (const tx of node.subscribe({ prefix: "txn://alice/" })) {
      received.push(tx);
      if (received.length >= 2) break;
    }
  })();

  // Submit mixed transactions
  await node.submit(["txn://alice/1", { n: 1 }]);
  await node.submit(["txn://bob/1", { n: 2 }]); // Should be filtered out
  await node.submit(["txn://alice/2", { n: 3 }]);

  await Promise.race([
    subscriptionPromise,
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);

  assertEquals(received.length, 2);
  assertEquals(received[0][0], "txn://alice/1");
  assertEquals(received[1][0], "txn://alice/2");

  await node.cleanup();
});

Deno.test("TransactionNode - combineValidators", async () => {
  const readClient = createTestMemoryClient();

  const hasName: TransactionValidator = async ([, data]) => {
    if (!(data as { name?: string }).name) {
      return { valid: false, error: "missing_name" };
    }
    return { valid: true };
  };

  const hasEmail: TransactionValidator = async ([, data]) => {
    if (!(data as { email?: string }).email) {
      return { valid: false, error: "missing_email" };
    }
    return { valid: true };
  };

  const node = createTransactionNode({
    validate: combineValidators(hasName, hasEmail),
    read: readClient,
    peers: [],
  });

  // Missing name
  const r1 = await node.submit(["txn://1", { email: "a@b.com" }]);
  assertEquals(r1.accepted, false);
  assertEquals(r1.error, "missing_name");

  // Missing email
  const r2 = await node.submit(["txn://2", { name: "Alice" }]);
  assertEquals(r2.accepted, false);
  assertEquals(r2.error, "missing_email");

  // Both present
  const r3 = await node.submit(["txn://3", { name: "Alice", email: "a@b.com" }]);
  assertEquals(r3.accepted, true);

  await node.cleanup();
});

// =============================================================================
// STATE VALIDATOR TESTS (txn-data)
// =============================================================================

Deno.test("StateValidator - validates inputs/outputs structure", async () => {
  const readClient = createTestMemoryClient();

  const validator = createStateValidator();

  const node = createTransactionNode({
    validate: validator,
    read: readClient,
    peers: [],
  });

  // Invalid structure (no inputs/outputs)
  const r1 = await node.submit(["txn://1", { value: "hello" }]);
  assertEquals(r1.accepted, false);
  assertEquals(r1.error, "invalid_transaction_data");

  // Valid structure
  const r2 = await node.submit([
    "txn://2",
    { inputs: [], outputs: [["store://test", "value"]] },
  ]);
  assertEquals(r2.accepted, true);

  await node.cleanup();
});

Deno.test("StateValidator - checks input existence when required", async () => {
  const readClient = createTestMemoryClient();

  // Pre-populate an input
  await readClient.write("utxo://alice/1", { value: 100 });

  const validator = createStateValidator({
    requireInputsExist: true,
  });

  const node = createTransactionNode({
    validate: validator,
    read: readClient,
    peers: [],
  });

  // Input exists
  const r1 = await node.submit([
    "txn://1",
    { inputs: ["utxo://alice/1"], outputs: [] },
  ]);
  assertEquals(r1.accepted, true);

  // Input doesn't exist
  const r2 = await node.submit([
    "txn://2",
    { inputs: ["utxo://alice/nonexistent"], outputs: [] },
  ]);
  assertEquals(r2.accepted, false);
  assertEquals(r2.error, "input_not_found");

  await node.cleanup();
});

Deno.test("StateValidator - runs program validators on outputs", async () => {
  const readClient = createTestMemoryClient();

  const validator = createStateValidator({
    schema: {
      "utxo://": async ({ value }) => {
        if (typeof value !== "number" || value <= 0) {
          return { valid: false, error: "invalid_amount" };
        }
        return { valid: true };
      },
    },
  });

  const node = createTransactionNode({
    validate: validator,
    read: readClient,
    peers: [],
  });

  // Valid output
  const r1 = await node.submit([
    "txn://1",
    { inputs: [], outputs: [["utxo://bob/1", 50]] },
  ]);
  assertEquals(r1.accepted, true);

  // Invalid output (negative amount)
  const r2 = await node.submit([
    "txn://2",
    { inputs: [], outputs: [["utxo://bob/2", -10]] },
  ]);
  assertEquals(r2.accepted, false);
  assertEquals(r2.error, "invalid_amount");

  await node.cleanup();
});

// =============================================================================
// UTXO VALIDATOR TESTS
// =============================================================================

Deno.test("UTXOValidator - checks ownership and spent status", async () => {
  const readClient = createTestMemoryClient();

  // Pre-populate UTXOs
  await readClient.write("utxo://alice/1", {
    value: 100,
    owner: "alice",
    createdBy: "txn://genesis",
    spent: false,
  });
  await readClient.write("utxo://alice/2", {
    value: 50,
    owner: "alice",
    createdBy: "txn://genesis",
    spent: true,
    spentBy: "txn://old",
  });

  const utxoValidator = createUTXOValidator({
    extractOwner: (uri) => uri.match(/utxo:\/\/([^/]+)/)?.[1] || "",
    extractSigner: (tx) => (tx[1] as { origin: string }).origin,
  });

  const stateValidator = createStateValidator();

  const node = createTransactionNode({
    validate: combineValidators(stateValidator, utxoValidator),
    read: readClient,
    peers: [],
  });

  // Valid: alice spending her own unspent UTXO
  const r1 = await node.submit([
    "txn://alice/transfer/1",
    {
      origin: "alice",
      sig: "fake",
      inputs: ["utxo://alice/1"],
      outputs: [["utxo://bob/1", 100]],
    },
  ]);
  assertEquals(r1.accepted, true);

  // Invalid: bob trying to spend alice's UTXO
  const r2 = await node.submit([
    "txn://bob/steal/1",
    {
      origin: "bob",
      sig: "fake",
      inputs: ["utxo://alice/1"],
      outputs: [["utxo://bob/2", 100]],
    },
  ]);
  assertEquals(r2.accepted, false);
  assertEquals(r2.error, "not_owner");

  // Invalid: spending already spent UTXO
  const r3 = await node.submit([
    "txn://alice/doublespend/1",
    {
      origin: "alice",
      sig: "fake",
      inputs: ["utxo://alice/2"],
      outputs: [["utxo://bob/3", 50]],
    },
  ]);
  assertEquals(r3.accepted, false);
  assertEquals(r3.error, "input_already_spent");

  await node.cleanup();
});

// =============================================================================
// CONSERVATION VALIDATOR TESTS
// =============================================================================

Deno.test("ConservationValidator - ensures value conservation", async () => {
  const readClient = createTestMemoryClient();

  // Pre-populate input
  await readClient.write("utxo://alice/1", { value: 100 });

  const conservationValidator = createConservationValidator(
    (record) => (record as { value: number }).value,
    (value) => value as number,
  );

  const stateValidator = createStateValidator();

  const node = createTransactionNode({
    validate: combineValidators(stateValidator, conservationValidator),
    read: readClient,
    peers: [],
  });

  // Valid: 100 = 50 + 30 + 20
  const r1 = await node.submit([
    "txn://1",
    {
      inputs: ["utxo://alice/1"],
      outputs: [
        ["utxo://bob/1", 50],
        ["utxo://alice/2", 30],
        ["fees://pool", 20],
      ],
    },
  ]);
  assertEquals(r1.accepted, true);

  // Invalid: 100 != 50 + 60 (creating value)
  const r2 = await node.submit([
    "txn://2",
    {
      inputs: ["utxo://alice/1"],
      outputs: [
        ["utxo://bob/2", 50],
        ["utxo://alice/3", 60],
      ],
    },
  ]);
  assertEquals(r2.accepted, false);
  assertEquals(r2.error, "conservation_violated");

  await node.cleanup();
});

// =============================================================================
// FEE VALIDATOR TESTS
// =============================================================================

Deno.test("FeeValidator - ensures sufficient fee", async () => {
  const readClient = createTestMemoryClient();

  const feeValidator = createFeeValidator("fees://", (uri, value, outputs) => {
    // 1 token per output
    return outputs.length;
  });

  const stateValidator = createStateValidator();

  const node = createTransactionNode({
    validate: combineValidators(stateValidator, feeValidator),
    read: readClient,
    peers: [],
  });

  // Valid: 2 outputs, 2 fee
  const r1 = await node.submit([
    "txn://1",
    {
      inputs: [],
      outputs: [
        ["utxo://bob/1", 50],
        ["utxo://alice/1", 30],
        ["fees://pool", 2],
      ],
    },
  ]);
  assertEquals(r1.accepted, true);

  // Invalid: 2 outputs, 1 fee
  const r2 = await node.submit([
    "txn://2",
    {
      inputs: [],
      outputs: [
        ["utxo://bob/2", 50],
        ["utxo://alice/2", 30],
        ["fees://pool", 1],
      ],
    },
  ]);
  assertEquals(r2.accepted, false);
  assertEquals(r2.error, "insufficient_fee");

  // Invalid: no fee output
  const r3 = await node.submit([
    "txn://3",
    {
      inputs: [],
      outputs: [["utxo://bob/3", 50]],
    },
  ]);
  assertEquals(r3.accepted, false);
  assertEquals(r3.error, "no_fee_output");

  await node.cleanup();
});

// =============================================================================
// TRANSACTION BUILDER TESTS
// =============================================================================

Deno.test("buildTransaction - creates proper structure", () => {
  const tx = buildTransaction({
    uri: "txn://alice/transfer/42",
    inputs: ["utxo://alice/1"],
    outputs: [
      ["utxo://bob/99", 50],
      ["utxo://alice/2", 30],
    ],
  });

  assertEquals(tx[0], "txn://alice/transfer/42");
  assertEquals(tx[1].inputs, ["utxo://alice/1"]);
  assertEquals(tx[1].outputs.length, 2);
  assertEquals(tx[1].outputs[0], ["utxo://bob/99", 50]);
  assertEquals(tx[1].outputs[1], ["utxo://alice/2", 30]);
});

// =============================================================================
// LIFECYCLE URI TESTS
// =============================================================================

Deno.test("validatedUri - generates correct URI", () => {
  const uri = validatedUri("node-a", "txn://alice/42");
  assertEquals(uri, "validated://node-a/txn/alice/42");
});

Deno.test("includedUri - generates correct URI", () => {
  const uri = includedUri("txn://firecat/block/1000", "txn://alice/42");
  assertEquals(uri, "included://firecat/block/1000/txn/alice/42");
});

Deno.test("confirmedUri - generates correct URI", () => {
  const uri = confirmedUri("firecat", "txn://alice/42");
  assertEquals(uri, "confirmed://firecat/txn/alice/42");
});

Deno.test("parseLifecycleUri - parses txn URI", () => {
  const result = parseLifecycleUri("txn://alice/42");
  assertEquals(result?.stage, "txn");
  assertEquals(result?.txnUri, "txn://alice/42");
});

Deno.test("parseLifecycleUri - parses validated URI", () => {
  const result = parseLifecycleUri("validated://node-a/txn/alice/42");
  assertEquals(result?.stage, "validated");
  assertEquals(result?.nodeId, "node-a");
  assertEquals(result?.txnUri, "txn://alice/42");
});

Deno.test("parseLifecycleUri - parses included URI", () => {
  const result = parseLifecycleUri("included://firecat/block/1000/txn/alice/42");
  assertEquals(result?.stage, "included");
  assertEquals(result?.blockUri, "txn://firecat/block/1000");
  assertEquals(result?.txnUri, "txn://alice/42");
});

Deno.test("parseLifecycleUri - parses confirmed URI", () => {
  const result = parseLifecycleUri("confirmed://firecat/txn/alice/42");
  assertEquals(result?.stage, "confirmed");
  assertEquals(result?.chainId, "firecat");
  assertEquals(result?.txnUri, "txn://alice/42");
});

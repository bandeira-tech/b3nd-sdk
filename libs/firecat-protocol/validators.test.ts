/**
 * Tests for Firecat protocol validators:
 *   balanceValidator, consumedValidator, genesisValidator, consensusRecordValidator
 *
 * These validators enforce the economic rules of the Firecat consensus protocol:
 *   - Write-once immutability
 *   - Balance conservation (inputs >= outputs)
 *   - Auth verification on spending
 *   - Double-spend prevention
 *   - Fee enforcement for consensus records
 */

import { assertEquals } from "@std/assert";
import {
  balanceValidator,
  consumedValidator,
  genesisValidator,
  consensusRecordValidator,
} from "./validators.ts";
import { ROOT_KEY, CONSENSUS_FEE } from "./constants.ts";
import type { ReadResult } from "@bandeira-tech/b3nd-sdk/types";

// ── Mock helpers ──

/** Create a mock read function backed by a Record store */
function mockRead(
  store: Record<string, unknown> = {},
): (uri: string) => Promise<ReadResult<any>> {
  return (uri: string) => {
    if (uri in store) {
      return Promise.resolve({
        success: true,
        record: { ts: Date.now(), data: store[uri] },
      });
    }
    return Promise.resolve({ success: false, error: "Not found" });
  };
}

// ── balanceValidator ──

Deno.test("balanceValidator - accepts valid positive balance", async () => {
  const result = await balanceValidator({
    uri: "immutable://balance/abc123/utxo1",
    value: 100,
    read: mockRead(),
  });
  assertEquals(result.valid, true);
});

Deno.test("balanceValidator - rejects zero value", async () => {
  const result = await balanceValidator({
    uri: "immutable://balance/abc123/utxo1",
    value: 0,
    read: mockRead(),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Balance value must be a number > 0");
});

Deno.test("balanceValidator - rejects negative value", async () => {
  const result = await balanceValidator({
    uri: "immutable://balance/abc123/utxo1",
    value: -5,
    read: mockRead(),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Balance value must be a number > 0");
});

Deno.test("balanceValidator - rejects non-number value", async () => {
  const result = await balanceValidator({
    uri: "immutable://balance/abc123/utxo1",
    value: "100",
    read: mockRead(),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Balance value must be a number > 0");
});

Deno.test("balanceValidator - rejects null value", async () => {
  const result = await balanceValidator({
    uri: "immutable://balance/abc123/utxo1",
    value: null,
    read: mockRead(),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Balance value must be a number > 0");
});

Deno.test("balanceValidator - rejects duplicate (write-once)", async () => {
  const store = { "immutable://balance/abc123/utxo1": 50 };
  const result = await balanceValidator({
    uri: "immutable://balance/abc123/utxo1",
    value: 100,
    read: mockRead(store),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Balance already exists (immutable)");
});

Deno.test("balanceValidator - accepts genesis envelope (skip conservation)", async () => {
  const message = {
    payload: {
      inputs: [],
      outputs: [
        ["immutable://genesis/pubkey1", true],
        ["immutable://balance/pubkey1/utxo1", 1000],
      ],
    },
  };
  const result = await balanceValidator({
    uri: "immutable://balance/pubkey1/utxo1",
    value: 1000,
    read: mockRead(),
    message,
  });
  assertEquals(result.valid, true);
});

Deno.test("balanceValidator - rejects when inputs < outputs (conservation)", async () => {
  const store = {
    "immutable://balance/alice/utxo-in": 50,
  };
  const message = {
    auth: [],
    payload: {
      inputs: ["immutable://balance/alice/utxo-in"],
      outputs: [
        ["immutable://balance/bob/utxo-out", 100], // 100 > 50
      ],
    },
  };
  const result = await balanceValidator({
    uri: "immutable://balance/bob/utxo-out",
    value: 100,
    read: mockRead(store),
    message,
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    "Conservation violated: inputs (50) < outputs (100)",
  );
});

Deno.test("balanceValidator - accepts when inputs >= outputs (conservation)", async () => {
  const store = {
    "immutable://balance/alice/utxo-in": 100,
  };
  // Genesis envelope to skip auth (simplified test for conservation)
  const message = {
    payload: {
      inputs: ["immutable://balance/alice/utxo-in"],
      outputs: [
        ["immutable://genesis/someone", true], // make it a genesis to skip auth
        ["immutable://balance/bob/utxo-out", 80],
      ],
    },
  };
  const result = await balanceValidator({
    uri: "immutable://balance/bob/utxo-out",
    value: 80,
    read: mockRead(store),
    message,
  });
  assertEquals(result.valid, true);
});

Deno.test("balanceValidator - rejects when input balance not found", async () => {
  const message = {
    payload: {
      inputs: ["immutable://balance/alice/nonexistent"],
      outputs: [
        ["immutable://balance/bob/utxo-out", 50],
      ],
    },
  };
  const result = await balanceValidator({
    uri: "immutable://balance/bob/utxo-out",
    value: 50,
    read: mockRead(), // empty store
    message,
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    "Input balance not found: immutable://balance/alice/nonexistent",
  );
});

Deno.test("balanceValidator - rejects non-genesis with inputs but no auth", async () => {
  const store = {
    "immutable://balance/alice/utxo-in": 100,
  };
  const message = {
    payload: {
      inputs: ["immutable://balance/alice/utxo-in"],
      outputs: [
        ["immutable://balance/bob/utxo-out", 50],
      ],
    },
  };
  const result = await balanceValidator({
    uri: "immutable://balance/bob/utxo-out",
    value: 50,
    read: mockRead(store),
    message,
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    "Signed envelope required when spending inputs",
  );
});

Deno.test("balanceValidator - accepts fractional amounts", async () => {
  const result = await balanceValidator({
    uri: "immutable://balance/abc/utxo1",
    value: 0.001,
    read: mockRead(),
  });
  assertEquals(result.valid, true);
});

// ── consumedValidator ──

Deno.test("consumedValidator - accepts valid consumed marker", async () => {
  const store = {
    "immutable://balance/alice/utxo1": 100,
  };
  const message = {
    payload: {
      inputs: ["immutable://balance/alice/utxo1"],
      outputs: [],
    },
  };
  const result = await consumedValidator({
    uri: "immutable://consumed/alice/utxo1",
    value: "immutable://balance/alice/utxo1",
    read: mockRead(store),
    message,
  });
  assertEquals(result.valid, true);
});

Deno.test("consumedValidator - rejects double-spend (write-once)", async () => {
  const store = {
    "immutable://consumed/alice/utxo1": "immutable://balance/alice/utxo1",
    "immutable://balance/alice/utxo1": 100,
  };
  const result = await consumedValidator({
    uri: "immutable://consumed/alice/utxo1",
    value: "immutable://balance/alice/utxo1",
    read: mockRead(store),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Already consumed (double-spend)");
});

Deno.test("consumedValidator - rejects non-string value", async () => {
  const result = await consumedValidator({
    uri: "immutable://consumed/alice/utxo1",
    value: 123,
    read: mockRead(),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Consumed value must be a balance URI reference");
});

Deno.test("consumedValidator - rejects invalid balance URI format", async () => {
  const result = await consumedValidator({
    uri: "immutable://consumed/alice/utxo1",
    value: "mutable://wrong/format",
    read: mockRead(),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Consumed value must be a balance URI reference");
});

Deno.test("consumedValidator - rejects when referenced balance not found", async () => {
  const result = await consumedValidator({
    uri: "immutable://consumed/alice/utxo1",
    value: "immutable://balance/alice/utxo1",
    read: mockRead(), // empty store
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    "Referenced balance not found or empty: immutable://balance/alice/utxo1",
  );
});

Deno.test("consumedValidator - rejects when balance is zero", async () => {
  const store = {
    "immutable://balance/alice/utxo1": 0,
  };
  const result = await consumedValidator({
    uri: "immutable://consumed/alice/utxo1",
    value: "immutable://balance/alice/utxo1",
    read: mockRead(store),
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    "Referenced balance not found or empty: immutable://balance/alice/utxo1",
  );
});

Deno.test("consumedValidator - rejects when balance not in inputs", async () => {
  const store = {
    "immutable://balance/alice/utxo1": 100,
  };
  const message = {
    payload: {
      inputs: ["immutable://balance/alice/utxo-other"], // different utxo
      outputs: [],
    },
  };
  const result = await consumedValidator({
    uri: "immutable://consumed/alice/utxo1",
    value: "immutable://balance/alice/utxo1",
    read: mockRead(store),
    message,
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    "Consumed balance must appear in inputs: immutable://balance/alice/utxo1",
  );
});

// ── genesisValidator ──

Deno.test("genesisValidator - accepts first genesis claim", async () => {
  const result = await genesisValidator({
    uri: "immutable://genesis/pubkey1",
    value: true,
    read: mockRead(),
  });
  assertEquals(result.valid, true);
});

Deno.test("genesisValidator - rejects non-true value", async () => {
  const result = await genesisValidator({
    uri: "immutable://genesis/pubkey1",
    value: false,
    read: mockRead(),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Genesis value must be true");
});

Deno.test("genesisValidator - rejects string value", async () => {
  const result = await genesisValidator({
    uri: "immutable://genesis/pubkey1",
    value: "true",
    read: mockRead(),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Genesis value must be true");
});

Deno.test("genesisValidator - rejects null value", async () => {
  const result = await genesisValidator({
    uri: "immutable://genesis/pubkey1",
    value: null,
    read: mockRead(),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Genesis value must be true");
});

Deno.test("genesisValidator - rejects duplicate genesis (write-once)", async () => {
  const store = {
    "immutable://genesis/pubkey1": true,
  };
  const result = await genesisValidator({
    uri: "immutable://genesis/pubkey1",
    value: true,
    read: mockRead(store),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Genesis already claimed for this pubkey");
});

// ── consensusRecordValidator ──

const CONTENT_HASH = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const CONTENT_URI = `hash://sha256/${CONTENT_HASH}`;
const CONSENSUS_URI = `consensus://record/${CONTENT_HASH}`;
const FEE_URI = `immutable://balance/${ROOT_KEY}/${CONTENT_HASH}`;

Deno.test("consensusRecordValidator - accepts valid consensus record", async () => {
  const store: Record<string, unknown> = {
    [CONTENT_URI]: { title: "Hello World" }, // content exists
    [FEE_URI]: CONSENSUS_FEE, // fee paid
  };
  const result = await consensusRecordValidator({
    uri: CONSENSUS_URI,
    value: CONTENT_URI,
    read: mockRead(store),
  });
  assertEquals(result.valid, true);
});

Deno.test("consensusRecordValidator - rejects wrong value format", async () => {
  const store: Record<string, unknown> = {
    [CONTENT_URI]: { title: "Hello" },
    [FEE_URI]: CONSENSUS_FEE,
  };
  const result = await consensusRecordValidator({
    uri: CONSENSUS_URI,
    value: "wrong://format",
    read: mockRead(store),
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    "Consensus record value must be the content hash URI",
  );
});

Deno.test("consensusRecordValidator - rejects non-string value", async () => {
  const result = await consensusRecordValidator({
    uri: CONSENSUS_URI,
    value: 42,
    read: mockRead(),
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    "Consensus record value must be the content hash URI",
  );
});

Deno.test("consensusRecordValidator - rejects when content not found", async () => {
  const store: Record<string, unknown> = {
    [FEE_URI]: CONSENSUS_FEE,
    // no content stored
  };
  const result = await consensusRecordValidator({
    uri: CONSENSUS_URI,
    value: CONTENT_URI,
    read: mockRead(store),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Referenced content hash does not exist");
});

Deno.test("consensusRecordValidator - rejects duplicate (write-once)", async () => {
  const store: Record<string, unknown> = {
    [CONTENT_URI]: { title: "Hello" },
    [CONSENSUS_URI]: CONTENT_URI, // already exists
    [FEE_URI]: CONSENSUS_FEE,
  };
  const result = await consensusRecordValidator({
    uri: CONSENSUS_URI,
    value: CONTENT_URI,
    read: mockRead(store),
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Consensus record already exists (immutable)");
});

Deno.test("consensusRecordValidator - rejects when fee not paid", async () => {
  const store: Record<string, unknown> = {
    [CONTENT_URI]: { title: "Hello" },
    // no fee balance
  };
  const result = await consensusRecordValidator({
    uri: CONSENSUS_URI,
    value: CONTENT_URI,
    read: mockRead(store),
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    `Gas fee not paid: expected ${CONSENSUS_FEE} at ${FEE_URI}`,
  );
});

Deno.test("consensusRecordValidator - rejects when fee too low", async () => {
  const store: Record<string, unknown> = {
    [CONTENT_URI]: { title: "Hello" },
    [FEE_URI]: CONSENSUS_FEE - 0.5, // not enough
  };
  const result = await consensusRecordValidator({
    uri: CONSENSUS_URI,
    value: CONTENT_URI,
    read: mockRead(store),
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    `Gas fee not paid: expected ${CONSENSUS_FEE} at ${FEE_URI}`,
  );
});

Deno.test("consensusRecordValidator - accepts when fee exceeds minimum", async () => {
  const store: Record<string, unknown> = {
    [CONTENT_URI]: { title: "Hello" },
    [FEE_URI]: CONSENSUS_FEE + 100, // overpaid is fine
  };
  const result = await consensusRecordValidator({
    uri: CONSENSUS_URI,
    value: CONTENT_URI,
    read: mockRead(store),
  });
  assertEquals(result.valid, true);
});

Deno.test("consensusRecordValidator - rejects mismatched content hash in value", async () => {
  const otherHash = "1111111111111111111111111111111111111111111111111111111111111111";
  const store: Record<string, unknown> = {
    [`hash://sha256/${otherHash}`]: { title: "Wrong" },
    [FEE_URI]: CONSENSUS_FEE,
  };
  const result = await consensusRecordValidator({
    uri: CONSENSUS_URI,
    value: `hash://sha256/${otherHash}`, // hash doesn't match URI
    read: mockRead(store),
  });
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    "Consensus record value must be the content hash URI",
  );
});

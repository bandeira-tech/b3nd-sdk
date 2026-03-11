/// <reference lib="deno.ns" />
/**
 * Tests for immutable balance UTXO consensus validators.
 */

import { assertEquals } from "@std/assert";
import { MemoryClient } from "@bandeira-tech/b3nd-sdk";
import { send } from "@bandeira-tech/b3nd-sdk";
import { generateSigningKeyPair, createAuthenticatedMessageWithHex } from "@bandeira-tech/b3nd-sdk/encrypt";
import schema from "./mod.ts";
import {
  ROOT_KEY,
  CONSENSUS_FEE,
  GENESIS_AMOUNT,
} from "./constants.ts";
import {
  generateUtxoId,
  buildGenesisEnvelope,
  buildConsensusEnvelope,
} from "./helpers.ts";

function createClient() {
  return new MemoryClient({ schema });
}

/** Claim genesis tokens, returns the balance UTXO URI */
async function claimGenesis(
  client: MemoryClient,
  pubkey: string,
): Promise<{ utxoUri: string }> {
  const envelope = buildGenesisEnvelope(pubkey, GENESIS_AMOUNT);
  const utxoOutput = envelope.payload.outputs.find(([uri]) =>
    uri.startsWith(`immutable://balance/${pubkey}/`)
  );
  const utxoUri = utxoOutput![0];

  const result = await send(envelope, client);
  assertEquals(result.accepted, true, `Genesis claim failed: ${result.error}`);
  return { utxoUri };
}

/** Store content via send() and return the content hash */
async function storeContent(
  client: MemoryClient,
  content: unknown,
): Promise<string> {
  const envelope = {
    payload: {
      inputs: [] as string[],
      outputs: [
        ["mutable://open/temp", content],
      ] as [string, unknown][],
    },
  };
  const result = await send(envelope, client);
  assertEquals(result.accepted, true, `Content store failed: ${result.error}`);
  return result.uri.replace("hash://sha256/", "");
}

// ── Genesis ──────────────────────────────────────────────────────────

Deno.test("genesis: claim tokens creates balance", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  const result = await client.read<number>(utxoUri);
  assertEquals(result.success, true);
  assertEquals(result.record?.data, GENESIS_AMOUNT);
});

Deno.test("genesis: double-claim rejected", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  await claimGenesis(client, keys.publicKeyHex);

  const envelope2 = buildGenesisEnvelope(keys.publicKeyHex, GENESIS_AMOUNT);
  const result2 = await send(envelope2, client);
  assertEquals(result2.accepted, false);
});

// ── Balance ──────────────────────────────────────────────────────────

Deno.test("balance: read returns number", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  const result = await client.read<number>(utxoUri);
  assertEquals(result.success, true);
  assertEquals(typeof result.record?.data, "number");
  assertEquals(result.record?.data, GENESIS_AMOUNT);
});

// ── Consensus record with gas ────────────────────────────────────────

Deno.test("consensus: create record with gas payment", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);
  const contentHash = await storeContent(client, { title: "My Post", body: "Hello world" });

  const signed = await buildConsensusEnvelope({
    contentHash,
    userPubKey: keys.publicKeyHex,
    userPrivKeyHex: keys.privateKeyHex,
    inputUtxoUri: utxoUri,
    inputAmount: GENESIS_AMOUNT,
  });

  const result = await send(signed, client);
  assertEquals(result.accepted, true, `Consensus send failed: ${result.error}`);

  // Consensus record exists with hash URI value
  const recordResult = await client.read<string>(`consensus://record/${contentHash}`);
  assertEquals(recordResult.success, true);
  assertEquals(recordResult.record?.data, `hash://sha256/${contentHash}`);

  // Consumed marker exists referencing the input balance
  const consumedUri = `immutable://consumed/${utxoUri.replace("immutable://balance/", "")}`;
  const consumedResult = await client.read<string>(consumedUri);
  assertEquals(consumedResult.success, true);
  assertEquals(consumedResult.record?.data, utxoUri);

  // Fee balance at ROOT_KEY keyed by content hash
  const feeResult = await client.read<number>(`immutable://balance/${ROOT_KEY}/${contentHash}`);
  assertEquals(feeResult.success, true);
  assertEquals(feeResult.record?.data, CONSENSUS_FEE);
});

// ── Double-spend ─────────────────────────────────────────────────────

Deno.test("double-spend: reject already-consumed balance", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  // First spend
  const contentHash1 = await storeContent(client, { data: "first" });
  const signed1 = await buildConsensusEnvelope({
    contentHash: contentHash1,
    userPubKey: keys.publicKeyHex,
    userPrivKeyHex: keys.privateKeyHex,
    inputUtxoUri: utxoUri,
    inputAmount: GENESIS_AMOUNT,
  });
  const result1 = await send(signed1, client);
  assertEquals(result1.accepted, true, `First spend failed: ${result1.error}`);

  // Find the change UTXO from first spend — use it as input for second spend
  // But try to double-spend the original utxoUri instead
  const contentHash2 = await storeContent(client, { data: "second" });
  const signed2 = await buildConsensusEnvelope({
    contentHash: contentHash2,
    userPubKey: keys.publicKeyHex,
    userPrivKeyHex: keys.privateKeyHex,
    inputUtxoUri: utxoUri,
    inputAmount: GENESIS_AMOUNT,
  });
  const result2 = await send(signed2, client);
  assertEquals(result2.accepted, false);
});

// ── Missing fee ──────────────────────────────────────────────────────

Deno.test("missing fee: reject consensus record without fee", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);
  const contentHash = await storeContent(client, { data: "no-fee" });

  // Build envelope with no fee output
  const changeId = generateUtxoId();
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [`immutable://consumed/${utxoUri.replace("immutable://balance/", "")}`, utxoUri],
      [`immutable://balance/${keys.publicKeyHex}/${changeId}`, GENESIS_AMOUNT], // keeps all, no fee
      [`consensus://record/${contentHash}`, `hash://sha256/${contentHash}`],
    ] as [string, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(payload, keys.publicKeyHex, keys.privateKeyHex);
  const result = await send(signed as any, client);
  assertEquals(result.accepted, false);
});

// ── Wrong fee key ────────────────────────────────────────────────────

Deno.test("wrong fee key: reject fee with random ID instead of content hash", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);
  const contentHash = await storeContent(client, { data: "wrong-key" });

  const randomFeeId = generateUtxoId();
  const changeId = generateUtxoId();
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [`immutable://consumed/${utxoUri.replace("immutable://balance/", "")}`, utxoUri],
      [`immutable://balance/${keys.publicKeyHex}/${changeId}`, GENESIS_AMOUNT - CONSENSUS_FEE],
      [`immutable://balance/${ROOT_KEY}/${randomFeeId}`, CONSENSUS_FEE], // wrong key!
      [`consensus://record/${contentHash}`, `hash://sha256/${contentHash}`],
    ] as [string, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(payload, keys.publicKeyHex, keys.privateKeyHex);
  const result = await send(signed as any, client);
  assertEquals(result.accepted, false);
});

// ── Conservation ─────────────────────────────────────────────────────

Deno.test("conservation: reject output sum > input sum", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  // Try to create more value than input
  const changeId = generateUtxoId();
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [`immutable://consumed/${utxoUri.replace("immutable://balance/", "")}`, utxoUri],
      [`immutable://balance/${keys.publicKeyHex}/${changeId}`, GENESIS_AMOUNT + 100], // more than input!
    ] as [string, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(payload, keys.publicKeyHex, keys.privateKeyHex);
  const result = await send(signed as any, client);
  assertEquals(result.accepted, false);
});

// ── Auth ─────────────────────────────────────────────────────────────

Deno.test("auth: reject wrong signer", async () => {
  const client = createClient();
  const ownerKeys = await generateSigningKeyPair();
  const attackerKeys = await generateSigningKeyPair();

  const { utxoUri } = await claimGenesis(client, ownerKeys.publicKeyHex);
  const contentHash = await storeContent(client, { data: "stolen" });

  // Attacker signs envelope spending owner's UTXO
  const changeId = generateUtxoId();
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [`immutable://consumed/${utxoUri.replace("immutable://balance/", "")}`, utxoUri],
      [`immutable://balance/${attackerKeys.publicKeyHex}/${changeId}`, GENESIS_AMOUNT - CONSENSUS_FEE],
      [`immutable://balance/${ROOT_KEY}/${contentHash}`, CONSENSUS_FEE],
      [`consensus://record/${contentHash}`, `hash://sha256/${contentHash}`],
    ] as [string, unknown][],
  };

  // Signed by attacker, not the owner
  const signed = await createAuthenticatedMessageWithHex(payload, attackerKeys.publicKeyHex, attackerKeys.privateKeyHex);
  const result = await send(signed as any, client);
  assertEquals(result.accepted, false);
});

// ── Regular Firecat writes ───────────────────────────────────────────

Deno.test("regular firecat: mutable://open writes work without gas", async () => {
  const client = createClient();

  const result = await client.receive([
    "mutable://open/my-app/hello",
    { message: "works" },
  ]);
  assertEquals(result.accepted, true);

  const readResult = await client.read("mutable://open/my-app/hello");
  assertEquals(readResult.success, true);
  if (readResult.success) {
    assertEquals((readResult.record?.data as any).message, "works");
  }
});

// ── Genesis bypass ───────────────────────────────────────────────────

Deno.test("genesis: envelopes mint tokens without conservation", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  const envelope = buildGenesisEnvelope(keys.publicKeyHex, GENESIS_AMOUNT);
  const result = await send(envelope, client);
  assertEquals(result.accepted, true, `Genesis should work without gas: ${result.error}`);

  const utxoOutput = envelope.payload.outputs.find(([uri]) =>
    uri.startsWith(`immutable://balance/${keys.publicKeyHex}/`)
  );
  const utxoResult = await client.read<number>(utxoOutput![0]);
  assertEquals(utxoResult.success, true);
  assertEquals(utxoResult.record?.data, GENESIS_AMOUNT);
});

// ── Pending validator ─────────────────────────────────────────────────

Deno.test("pending: accepts valid pending write", async () => {
  const client = createClient();

  // Store content to create the envelope at hash://sha256/{hash}
  const contentHash = await storeContent(client, { data: "test content" });
  const hashUri = `hash://sha256/${contentHash}`;
  const nodeKey = "node_abc123";

  const result = await client.receive([
    `immutable://pending/${contentHash}/${nodeKey}`,
    hashUri,
  ]);
  assertEquals(result.accepted, true, `Pending write failed: ${result.error}`);

  // Verify the value was stored
  const readResult = await client.read<string>(`immutable://pending/${contentHash}/${nodeKey}`);
  assertEquals(readResult.success, true);
  assertEquals(readResult.record?.data, hashUri);
});

Deno.test("pending: rejects duplicate (write-once)", async () => {
  const client = createClient();
  const contentHash = await storeContent(client, { data: "dup test" });
  const hashUri = `hash://sha256/${contentHash}`;
  const nodeKey = "node_abc123";

  // First write succeeds
  const result1 = await client.receive([
    `immutable://pending/${contentHash}/${nodeKey}`,
    hashUri,
  ]);
  assertEquals(result1.accepted, true, `First pending write failed: ${result1.error}`);

  // Duplicate write rejected
  const result2 = await client.receive([
    `immutable://pending/${contentHash}/${nodeKey}`,
    hashUri,
  ]);
  assertEquals(result2.accepted, false);
});

Deno.test("pending: rejects wrong value type", async () => {
  const client = createClient();
  const contentHash = await storeContent(client, { data: "wrong type" });

  // Value is a number, not a hash URI string
  const result1 = await client.receive([
    `immutable://pending/${contentHash}/node1`,
    42,
  ]);
  assertEquals(result1.accepted, false);

  // Value is a string but doesn't start with hash://sha256/
  const result2 = await client.receive([
    `immutable://pending/${contentHash}/node2`,
    "not-a-hash-uri",
  ]);
  assertEquals(result2.accepted, false);
});

Deno.test("pending: rejects missing referenced envelope", async () => {
  const client = createClient();
  const fakeHash = "0000000000000000000000000000000000000000000000000000000000000000";

  const result = await client.receive([
    `immutable://pending/${fakeHash}/node1`,
    `hash://sha256/${fakeHash}`,
  ]);
  assertEquals(result.accepted, false);
});

// ── Attestation validator ─────────────────────────────────────────────

Deno.test("attestation: accepts valid attestation write", async () => {
  const client = createClient();
  const contentHash = await storeContent(client, { data: "attest test" });
  const nodeKey = "validator_001";

  const result = await client.receive([
    `immutable://attestation/${contentHash}/${nodeKey}`,
    true,
  ]);
  assertEquals(result.accepted, true, `Attestation write failed: ${result.error}`);

  // Verify the value was stored
  const readResult = await client.read<boolean>(`immutable://attestation/${contentHash}/${nodeKey}`);
  assertEquals(readResult.success, true);
  assertEquals(readResult.record?.data, true);
});

Deno.test("attestation: rejects duplicate (write-once / equivocation)", async () => {
  const client = createClient();
  const contentHash = await storeContent(client, { data: "equivocate test" });
  const nodeKey = "validator_001";

  // First write succeeds
  const result1 = await client.receive([
    `immutable://attestation/${contentHash}/${nodeKey}`,
    true,
  ]);
  assertEquals(result1.accepted, true, `First attestation failed: ${result1.error}`);

  // Duplicate rejected (equivocation prevention)
  const result2 = await client.receive([
    `immutable://attestation/${contentHash}/${nodeKey}`,
    true,
  ]);
  assertEquals(result2.accepted, false);
});

Deno.test("attestation: rejects non-true value", async () => {
  const client = createClient();
  const contentHash = await storeContent(client, { data: "bad value" });

  // Value is false
  const result1 = await client.receive([
    `immutable://attestation/${contentHash}/val1`,
    false,
  ]);
  assertEquals(result1.accepted, false);

  // Value is a string
  const result2 = await client.receive([
    `immutable://attestation/${contentHash}/val2`,
    "true",
  ]);
  assertEquals(result2.accepted, false);

  // Value is a number
  const result3 = await client.receive([
    `immutable://attestation/${contentHash}/val3`,
    1,
  ]);
  assertEquals(result3.accepted, false);
});

Deno.test("attestation: rejects missing referenced envelope", async () => {
  const client = createClient();
  const fakeHash = "0000000000000000000000000000000000000000000000000000000000000000";

  const result = await client.receive([
    `immutable://attestation/${fakeHash}/validator1`,
    true,
  ]);
  assertEquals(result.accepted, false);
});

// ── Rejection validator ───────────────────────────────────────────────

Deno.test("rejection: accepts valid rejection write", async () => {
  const client = createClient();
  const contentHash = await storeContent(client, { data: "reject test" });
  const nodeKey = "validator_001";
  const reason = "Invalid balance conservation";

  const result = await client.receive([
    `immutable://rejection/${contentHash}/${nodeKey}`,
    reason,
  ]);
  assertEquals(result.accepted, true, `Rejection write failed: ${result.error}`);

  // Verify the value was stored
  const readResult = await client.read<string>(`immutable://rejection/${contentHash}/${nodeKey}`);
  assertEquals(readResult.success, true);
  assertEquals(readResult.record?.data, reason);
});

Deno.test("rejection: rejects duplicate (write-once)", async () => {
  const client = createClient();
  const contentHash = await storeContent(client, { data: "dup reject test" });
  const nodeKey = "validator_001";

  // First write succeeds
  const result1 = await client.receive([
    `immutable://rejection/${contentHash}/${nodeKey}`,
    "First reason",
  ]);
  assertEquals(result1.accepted, true, `First rejection failed: ${result1.error}`);

  // Duplicate rejected
  const result2 = await client.receive([
    `immutable://rejection/${contentHash}/${nodeKey}`,
    "Second reason",
  ]);
  assertEquals(result2.accepted, false);
});

Deno.test("rejection: rejects empty string value", async () => {
  const client = createClient();
  const contentHash = await storeContent(client, { data: "empty reject" });

  const result = await client.receive([
    `immutable://rejection/${contentHash}/val1`,
    "",
  ]);
  assertEquals(result.accepted, false);
});

Deno.test("rejection: rejects non-string value", async () => {
  const client = createClient();
  const contentHash = await storeContent(client, { data: "wrong type reject" });

  // Value is a boolean
  const result1 = await client.receive([
    `immutable://rejection/${contentHash}/val1`,
    true,
  ]);
  assertEquals(result1.accepted, false);

  // Value is a number
  const result2 = await client.receive([
    `immutable://rejection/${contentHash}/val2`,
    42,
  ]);
  assertEquals(result2.accepted, false);
});

Deno.test("rejection: rejects missing referenced envelope", async () => {
  const client = createClient();
  const fakeHash = "0000000000000000000000000000000000000000000000000000000000000000";

  const result = await client.receive([
    `immutable://rejection/${fakeHash}/validator1`,
    "Bad content",
  ]);
  assertEquals(result.accepted, false);
});

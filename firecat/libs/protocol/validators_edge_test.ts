/// <reference lib="deno.ns" />
/**
 * Edge case tests for immutable balance UTXO consensus validators.
 *
 * Tests boundary conditions, invalid inputs, and negative cases
 * not covered by the main validators_test.ts.
 */

import { assertEquals } from "@std/assert";
import { MemoryStore } from "@bandeira-tech/b3nd-sdk";
import { FirecatDataClient } from "./firecat-client.ts";
import { send } from "@bandeira-tech/b3nd-sdk";
import {
  createAuthenticatedMessageWithHex,
  generateSigningKeyPair,
} from "@bandeira-tech/b3nd-sdk/encrypt";
import {
  createValidatedClient,
  msgSchema,
} from "@bandeira-tech/b3nd-sdk";
import schema from "./mod.ts";
import { CONSENSUS_FEE, GENESIS_AMOUNT, ROOT_KEY } from "./constants.ts";
import {
  buildConsensusEnvelope,
  buildGenesisEnvelope,
  generateUtxoId,
} from "./helpers.ts";

type Client = {
  receive: (msgs: any[]) => Promise<any[]>;
  read: <T>(uri: string) => Promise<any>;
};

function createClient() {
  const mem = new FirecatDataClient(new MemoryStore());
  return createValidatedClient({
    write: mem,
    read: mem,
    validate: msgSchema(schema),
  });
}

async function claimGenesis(
  client: Client,
  pubkey: string,
): Promise<{ utxoUri: string }> {
  const envelope = buildGenesisEnvelope(pubkey, GENESIS_AMOUNT);
  const utxoOutput = envelope.outputs.find(([uri]) =>
    uri.startsWith(`immutable://balance/${pubkey}/`)
  );
  const utxoUri = utxoOutput![0];
  const result = await send(envelope, client);
  assertEquals(result.accepted, true, `Genesis claim failed: ${result.error}`);
  return { utxoUri };
}

// ── Balance validator edge cases ─────────────────────────────────────

Deno.test("balance: reject zero value", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const utxoId = generateUtxoId();

  const envelope = {
    inputs: [],
    outputs: [
      [`immutable://genesis/${keys.publicKeyHex}`, {}, true],
      [`immutable://balance/${keys.publicKeyHex}/${utxoId}`, {}, 0],
    ] as [string, Record<string, number>, unknown][],
  };
  const result = await send(envelope, client);
  assertEquals(result.accepted, false);
});

Deno.test("balance: reject negative value", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const utxoId = generateUtxoId();

  const envelope = {
    inputs: [],
    outputs: [
      [`immutable://genesis/${keys.publicKeyHex}`, {}, true],
      [`immutable://balance/${keys.publicKeyHex}/${utxoId}`, {}, -100],
    ] as [string, Record<string, number>, unknown][],
  };
  const result = await send(envelope, client);
  assertEquals(result.accepted, false);
});

Deno.test("balance: reject string value", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const utxoId = generateUtxoId();

  const envelope = {
    inputs: [],
    outputs: [
      [`immutable://genesis/${keys.publicKeyHex}`, {}, true],
      [`immutable://balance/${keys.publicKeyHex}/${utxoId}`, {}, "100"],
    ] as [string, Record<string, number>, unknown][],
  };
  const result = await send(envelope, client);
  assertEquals(result.accepted, false);
});

Deno.test("balance: reject boolean value", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const utxoId = generateUtxoId();

  const envelope = {
    inputs: [],
    outputs: [
      [`immutable://genesis/${keys.publicKeyHex}`, {}, true],
      [`immutable://balance/${keys.publicKeyHex}/${utxoId}`, {}, true],
    ] as [string, Record<string, number>, unknown][],
  };
  const result = await send(envelope, client);
  assertEquals(result.accepted, false);
});

// ── Genesis validator edge cases ─────────────────────────────────────

Deno.test("genesis: reject non-true values", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  // Test with false
  const envelope1 = {
    inputs: [],
    outputs: [[`immutable://genesis/${keys.publicKeyHex}`, {}, false]] as [
      string,
      Record<string, number>,
      unknown,
    ][],
  };
  const result1 = await send(envelope1, client);
  assertEquals(result1.accepted, false);

  // Test with number
  const envelope2 = {
    inputs: [],
    outputs: [[`immutable://genesis/${keys.publicKeyHex}`, {}, 1]] as [
      string,
      Record<string, number>,
      unknown,
    ][],
  };
  const result2 = await send(envelope2, client);
  assertEquals(result2.accepted, false);

  // Test with string "true"
  const envelope3 = {
    inputs: [],
    outputs: [[`immutable://genesis/${keys.publicKeyHex}`, {}, "true"]] as [
      string,
      Record<string, number>,
      unknown,
    ][],
  };
  const result3 = await send(envelope3, client);
  assertEquals(result3.accepted, false);
});

// ── Consumed validator edge cases ────────────────────────────────────

Deno.test("consumed: reject non-URI string value", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  const payload = {
    inputs: [utxoUri],
    outputs: [
      [`immutable://consumed/${keys.publicKeyHex}/some-id`, {}, "not-a-valid-uri"],
    ] as [string, Record<string, number>, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(
    payload,
    keys.publicKeyHex,
    keys.privateKeyHex,
  );
  const result = await send(signed as any, client);
  assertEquals(result.accepted, false);
});

Deno.test("consumed: reject numeric value", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  const payload = {
    inputs: [utxoUri],
    outputs: [
      [`immutable://consumed/${keys.publicKeyHex}/some-id`, {}, 42],
    ] as [string, Record<string, number>, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(
    payload,
    keys.publicKeyHex,
    keys.privateKeyHex,
  );
  const result = await send(signed as any, client);
  assertEquals(result.accepted, false);
});

// ── Consensus record edge cases ──────────────────────────────────────

Deno.test("consensus: reject when content does not exist", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  const fakeContentHash =
    "0000000000000000000000000000000000000000000000000000000000000000";
  const changeId = generateUtxoId();
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [
        `immutable://consumed/${utxoUri.replace("immutable://balance/", "")}`,
        {},
        utxoUri,
      ],
      [
        `immutable://balance/${keys.publicKeyHex}/${changeId}`,
        {},
        GENESIS_AMOUNT - CONSENSUS_FEE,
      ],
      [`immutable://balance/${ROOT_KEY}/${fakeContentHash}`, {}, CONSENSUS_FEE],
      [
        `consensus://record/${fakeContentHash}`,
        {},
        `hash://sha256/${fakeContentHash}`,
      ],
    ] as [string, Record<string, number>, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(
    payload,
    keys.publicKeyHex,
    keys.privateKeyHex,
  );
  const result = await send(signed as any, client);
  assertEquals(result.accepted, false);
});

Deno.test("consensus: reject wrong value format", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  // Store content first to get a valid hash
  const content = { title: "test" };
  const storeResult = await send({
    inputs: [] as string[],
    outputs: [["mutable://open/temp", {}, content]] as [string, Record<string, number>, unknown][],
  }, client);
  assertEquals(storeResult.accepted, true);
  const contentHash = storeResult.uri.replace("hash://sha256/", "");

  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  // Try consensus record with wrong value (number instead of hash URI)
  const changeId = generateUtxoId();
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [
        `immutable://consumed/${utxoUri.replace("immutable://balance/", "")}`,
        {},
        utxoUri,
      ],
      [
        `immutable://balance/${keys.publicKeyHex}/${changeId}`,
        {},
        GENESIS_AMOUNT - CONSENSUS_FEE,
      ],
      [`immutable://balance/${ROOT_KEY}/${contentHash}`, {}, CONSENSUS_FEE],
      [`consensus://record/${contentHash}`, {}, 42], // wrong: should be hash URI string
    ] as [string, Record<string, number>, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(
    payload,
    keys.publicKeyHex,
    keys.privateKeyHex,
  );
  const result = await send(signed as any, client);
  assertEquals(result.accepted, false);
});

// ── Multi-output conservation ────────────────────────────────────────

Deno.test("conservation: accept exact conservation (no change)", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  // Claim genesis with exactly CONSENSUS_FEE amount
  const envelope = buildGenesisEnvelope(keys.publicKeyHex, CONSENSUS_FEE);
  const utxoOutput = envelope.outputs.find(([uri]) =>
    uri.startsWith(`immutable://balance/${keys.publicKeyHex}/`)
  );
  const utxoUri = utxoOutput![0];
  const genResult = await send(envelope, client);
  assertEquals(genResult.accepted, true, `Genesis failed: ${genResult.error}`);

  // Store content
  const content = { title: "exact-fee" };
  const storeResult = await send({
    inputs: [] as string[],
    outputs: [["mutable://open/temp2", {}, content]] as [string, Record<string, number>, unknown][],
  }, client);
  const contentHash = storeResult.uri.replace("hash://sha256/", "");

  // Spend entire balance as fee — no change output
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [
        `immutable://consumed/${utxoUri.replace("immutable://balance/", "")}`,
        {},
        utxoUri,
      ],
      [`immutable://balance/${ROOT_KEY}/${contentHash}`, {}, CONSENSUS_FEE],
      [`consensus://record/${contentHash}`, {}, `hash://sha256/${contentHash}`],
    ] as [string, Record<string, number>, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(
    payload,
    keys.publicKeyHex,
    keys.privateKeyHex,
  );
  const result = await send(signed as any, client);
  assertEquals(
    result.accepted,
    true,
    `Exact-fee spend failed: ${result.error}`,
  );
});

Deno.test("conservation: accept when output sum < input sum (surplus burned)", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  // Store content
  const content = { title: "surplus" };
  const storeResult = await send({
    inputs: [] as string[],
    outputs: [["mutable://open/temp3", {}, content]] as [string, Record<string, number>, unknown][],
  }, client);
  const contentHash = storeResult.uri.replace("hash://sha256/", "");

  // Only output fee + small change (intentionally under-spending)
  const changeId = generateUtxoId();
  const smallChange = 10; // much less than GENESIS_AMOUNT - CONSENSUS_FEE
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [
        `immutable://consumed/${utxoUri.replace("immutable://balance/", "")}`,
        {},
        utxoUri,
      ],
      [`immutable://balance/${keys.publicKeyHex}/${changeId}`, {}, smallChange],
      [`immutable://balance/${ROOT_KEY}/${contentHash}`, {}, CONSENSUS_FEE],
      [`consensus://record/${contentHash}`, {}, `hash://sha256/${contentHash}`],
    ] as [string, Record<string, number>, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(
    payload,
    keys.publicKeyHex,
    keys.privateKeyHex,
  );
  const result = await send(signed as any, client);
  // Should pass — conservation allows surplus to be burned (inputSum >= outputSum)
  assertEquals(result.accepted, true, `Surplus burn failed: ${result.error}`);
});

// ── Unsigned envelope with inputs ────────────────────────────────────

Deno.test("auth: reject unsigned envelope with inputs", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  // Build envelope with inputs but no auth signatures
  const changeId = generateUtxoId();
  const envelope = {
    inputs: [utxoUri],
    outputs: [
      [
        `immutable://consumed/${utxoUri.replace("immutable://balance/", "")}`,
        {},
        utxoUri,
      ],
      [
        `immutable://balance/${keys.publicKeyHex}/${changeId}`,
        {},
        GENESIS_AMOUNT,
      ],
    ] as [string, Record<string, number>, unknown][],
    // No auth field — unsigned
  };

  const result = await send(envelope, client);
  assertEquals(result.accepted, false);
});

// ── Immutable write-once enforcement ─────────────────────────────────

Deno.test("immutable: cannot overwrite existing balance", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  // Claim genesis — creates balance UTXO
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  // Try to write a new balance at the same URI
  const overwriteEnvelope = {
    inputs: [],
    outputs: [
      [`immutable://genesis/${keys.publicKeyHex}2`, {}, true], // different genesis to pass that check
      [utxoUri, {}, 999], // try to overwrite existing balance
    ] as [string, Record<string, number>, unknown][],
  };

  const result = await send(overwriteEnvelope, client);
  assertEquals(result.accepted, false);
});

// ── Consensus record immutability ────────────────────────────────────

Deno.test("consensus: cannot create duplicate record", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();
  const { utxoUri } = await claimGenesis(client, keys.publicKeyHex);

  // Store content
  const content = { title: "duplicate-test" };
  const storeResult = await send({
    inputs: [] as string[],
    outputs: [["mutable://open/temp4", {}, content]] as [string, Record<string, number>, unknown][],
  }, client);
  const contentHash = storeResult.uri.replace("hash://sha256/", "");

  // First consensus record — should succeed
  const signed1 = await buildConsensusEnvelope({
    contentHash,
    userPubKey: keys.publicKeyHex,
    userPrivKeyHex: keys.privateKeyHex,
    inputUtxoUri: utxoUri,
    inputAmount: GENESIS_AMOUNT,
  });
  const result1 = await send(signed1, client);
  assertEquals(result1.accepted, true, `First record failed: ${result1.error}`);

  // Find change UTXO from first spend
  const changeUri = signed1.outputs.find(([uri]) =>
    uri.startsWith(`immutable://balance/${keys.publicKeyHex}/`) &&
    uri !== utxoUri
  )?.[0];

  if (changeUri) {
    // Try duplicate consensus record with new inputs
    const signed2 = await buildConsensusEnvelope({
      contentHash, // same content hash!
      userPubKey: keys.publicKeyHex,
      userPrivKeyHex: keys.privateKeyHex,
      inputUtxoUri: changeUri,
      inputAmount: GENESIS_AMOUNT - CONSENSUS_FEE,
    });
    const result2 = await send(signed2, client);
    // Should fail — consensus record already exists (write-once)
    assertEquals(result2.accepted, false);
  }
});

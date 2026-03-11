/// <reference lib="deno.ns" />
/**
 * Tests for gas UTXO consensus validators.
 */

import { assertEquals } from "@std/assert";
import { MemoryClient } from "@bandeira-tech/b3nd-sdk";
import { send } from "@bandeira-tech/b3nd-sdk";
import { generateSigningKeyPair, createAuthenticatedMessageWithHex } from "@bandeira-tech/b3nd-sdk/encrypt";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";
import type { Schema } from "@bandeira-tech/b3nd-sdk/types";
import {
  gasUtxoValidator,
  gasConsumedValidator,
  gasGenesisValidator,
} from "./gas-validators.ts";
import {
  GAS_GENESIS_AMOUNT,
} from "./gas-constants.ts";
import {
  generateGasUtxoId,
  buildGasGenesisEnvelope,
} from "./gas-helpers.ts";

/** Minimal schema with gas validators + hash for send() envelope support */
const gasSchema: Schema = {
  "hash://sha256": hashValidator(),
  "gas://utxo": gasUtxoValidator,
  "gas://consumed": gasConsumedValidator,
  "gas://genesis": gasGenesisValidator,
};

function createClient() {
  return new MemoryClient({ schema: gasSchema });
}

/** Claim gas genesis tokens, returns the gas UTXO URI */
async function claimGasGenesis(
  client: MemoryClient,
  pubkey: string,
): Promise<{ utxoUri: string }> {
  const envelope = buildGasGenesisEnvelope(pubkey, GAS_GENESIS_AMOUNT);
  const utxoOutput = envelope.payload.outputs.find(([uri]) =>
    uri.startsWith(`gas://utxo/${pubkey}/`)
  );
  const utxoUri = utxoOutput![0];

  const result = await send(envelope, client);
  assertEquals(result.accepted, true, `Gas genesis claim failed: ${result.error}`);
  return { utxoUri };
}

// -- Genesis -----------------------------------------------------------------

Deno.test("gas genesis: claim creates gas UTXO", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  const { utxoUri } = await claimGasGenesis(client, keys.publicKeyHex);

  const result = await client.read<number>(utxoUri);
  assertEquals(result.success, true);
  assertEquals(result.record?.data, GAS_GENESIS_AMOUNT);
});

Deno.test("gas genesis: double-claim rejected", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  await claimGasGenesis(client, keys.publicKeyHex);

  const envelope2 = buildGasGenesisEnvelope(keys.publicKeyHex, GAS_GENESIS_AMOUNT);
  const result2 = await send(envelope2, client);
  assertEquals(result2.accepted, false);
});

// -- Gas UTXO read -----------------------------------------------------------

Deno.test("gas utxo: read returns number", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  const { utxoUri } = await claimGasGenesis(client, keys.publicKeyHex);

  const result = await client.read<number>(utxoUri);
  assertEquals(result.success, true);
  assertEquals(typeof result.record?.data, "number");
  assertEquals(result.record?.data, GAS_GENESIS_AMOUNT);
});

// -- Gas spend (transfer) ----------------------------------------------------

Deno.test("gas spend: valid spend with change", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  const { utxoUri } = await claimGasGenesis(client, keys.publicKeyHex);

  const changeId = generateGasUtxoId();
  const spendAmount = 100;
  const changeAmount = GAS_GENESIS_AMOUNT - spendAmount;

  const recipientId = generateGasUtxoId();
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [`gas://consumed/${utxoUri.replace("gas://utxo/", "")}`, utxoUri],
      [`gas://utxo/${keys.publicKeyHex}/${changeId}`, changeAmount],
      [`gas://utxo/${keys.publicKeyHex}/${recipientId}`, spendAmount],
    ] as [string, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(payload, keys.publicKeyHex, keys.privateKeyHex);
  const result = await send(signed as any, client);
  assertEquals(result.accepted, true, `Gas spend failed: ${result.error}`);

  // Verify change UTXO
  const changeResult = await client.read<number>(`gas://utxo/${keys.publicKeyHex}/${changeId}`);
  assertEquals(changeResult.success, true);
  assertEquals(changeResult.record?.data, changeAmount);
});

// -- Double-spend ------------------------------------------------------------

Deno.test("gas double-spend: rejected", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  const { utxoUri } = await claimGasGenesis(client, keys.publicKeyHex);

  // First spend
  const changeId1 = generateGasUtxoId();
  const payload1 = {
    inputs: [utxoUri],
    outputs: [
      [`gas://consumed/${utxoUri.replace("gas://utxo/", "")}`, utxoUri],
      [`gas://utxo/${keys.publicKeyHex}/${changeId1}`, GAS_GENESIS_AMOUNT],
    ] as [string, unknown][],
  };
  const signed1 = await createAuthenticatedMessageWithHex(payload1, keys.publicKeyHex, keys.privateKeyHex);
  const result1 = await send(signed1 as any, client);
  assertEquals(result1.accepted, true, `First gas spend failed: ${result1.error}`);

  // Second spend of same UTXO (double-spend)
  const changeId2 = generateGasUtxoId();
  const payload2 = {
    inputs: [utxoUri],
    outputs: [
      [`gas://consumed/${utxoUri.replace("gas://utxo/", "")}`, utxoUri],
      [`gas://utxo/${keys.publicKeyHex}/${changeId2}`, GAS_GENESIS_AMOUNT],
    ] as [string, unknown][],
  };
  const signed2 = await createAuthenticatedMessageWithHex(payload2, keys.publicKeyHex, keys.privateKeyHex);
  const result2 = await send(signed2 as any, client);
  assertEquals(result2.accepted, false);
});

// -- Conservation ------------------------------------------------------------

Deno.test("gas conservation: reject output sum > input sum", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  const { utxoUri } = await claimGasGenesis(client, keys.publicKeyHex);

  // Try to create more gas than input
  const changeId = generateGasUtxoId();
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [`gas://consumed/${utxoUri.replace("gas://utxo/", "")}`, utxoUri],
      [`gas://utxo/${keys.publicKeyHex}/${changeId}`, GAS_GENESIS_AMOUNT + 100],
    ] as [string, unknown][],
  };

  const signed = await createAuthenticatedMessageWithHex(payload, keys.publicKeyHex, keys.privateKeyHex);
  const result = await send(signed as any, client);
  assertEquals(result.accepted, false);
});

// -- Auth (wrong signer) -----------------------------------------------------

Deno.test("gas auth: reject wrong signer", async () => {
  const client = createClient();
  const ownerKeys = await generateSigningKeyPair();
  const attackerKeys = await generateSigningKeyPair();

  const { utxoUri } = await claimGasGenesis(client, ownerKeys.publicKeyHex);

  // Attacker signs envelope spending owner's gas UTXO
  const changeId = generateGasUtxoId();
  const payload = {
    inputs: [utxoUri],
    outputs: [
      [`gas://consumed/${utxoUri.replace("gas://utxo/", "")}`, utxoUri],
      [`gas://utxo/${attackerKeys.publicKeyHex}/${changeId}`, GAS_GENESIS_AMOUNT],
    ] as [string, unknown][],
  };

  // Signed by attacker, not the owner
  const signed = await createAuthenticatedMessageWithHex(payload, attackerKeys.publicKeyHex, attackerKeys.privateKeyHex);
  const result = await send(signed as any, client);
  assertEquals(result.accepted, false);
});

// -- Genesis bypass ----------------------------------------------------------

Deno.test("gas genesis: envelopes mint gas without conservation", async () => {
  const client = createClient();
  const keys = await generateSigningKeyPair();

  const envelope = buildGasGenesisEnvelope(keys.publicKeyHex, GAS_GENESIS_AMOUNT);
  const result = await send(envelope, client);
  assertEquals(result.accepted, true, `Gas genesis should work without conservation: ${result.error}`);

  const utxoOutput = envelope.payload.outputs.find(([uri]) =>
    uri.startsWith(`gas://utxo/${keys.publicKeyHex}/`)
  );
  const utxoResult = await client.read<number>(utxoOutput![0]);
  assertEquals(utxoResult.success, true);
  assertEquals(utxoResult.record?.data, GAS_GENESIS_AMOUNT);
});

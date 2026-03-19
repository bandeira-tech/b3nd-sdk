/**
 * Tests for Firecat protocol helpers:
 *   generateUtxoId, buildGenesisEnvelope, buildConsensusEnvelope
 *
 * These helpers construct the message envelopes used in Firecat consensus.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  generateUtxoId,
  buildGenesisEnvelope,
  buildConsensusEnvelope,
} from "./helpers.ts";
import { ROOT_KEY, CONSENSUS_FEE, GENESIS_AMOUNT } from "./constants.ts";

// ── generateUtxoId ──

Deno.test("generateUtxoId - returns 32 char hex string", () => {
  const id = generateUtxoId();
  assertEquals(id.length, 32);
  assertEquals(/^[0-9a-f]{32}$/.test(id), true);
});

Deno.test("generateUtxoId - produces unique IDs", () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateUtxoId()));
  assertEquals(ids.size, 100);
});

// ── buildGenesisEnvelope ──

Deno.test("buildGenesisEnvelope - has empty inputs", () => {
  const env = buildGenesisEnvelope("pubkey1");
  assertEquals(env.payload.inputs, []);
});

Deno.test("buildGenesisEnvelope - has genesis marker output", () => {
  const env = buildGenesisEnvelope("pubkey1");
  const genesisOutput = env.payload.outputs.find(([uri]) =>
    uri.startsWith("immutable://genesis/")
  );
  assertEquals(genesisOutput !== undefined, true);
  assertEquals(genesisOutput![0], "immutable://genesis/pubkey1");
  assertEquals(genesisOutput![1], true);
});

Deno.test("buildGenesisEnvelope - has balance output with default amount", () => {
  const env = buildGenesisEnvelope("pubkey1");
  const balanceOutput = env.payload.outputs.find(([uri]) =>
    uri.startsWith("immutable://balance/")
  );
  assertEquals(balanceOutput !== undefined, true);
  assertEquals(balanceOutput![0].startsWith("immutable://balance/pubkey1/"), true);
  assertEquals(balanceOutput![1], GENESIS_AMOUNT);
});

Deno.test("buildGenesisEnvelope - accepts custom amount", () => {
  const env = buildGenesisEnvelope("pubkey1", 500);
  const balanceOutput = env.payload.outputs.find(([uri]) =>
    uri.startsWith("immutable://balance/")
  );
  assertEquals(balanceOutput![1], 500);
});

Deno.test("buildGenesisEnvelope - has exactly 2 outputs", () => {
  const env = buildGenesisEnvelope("pubkey1");
  assertEquals(env.payload.outputs.length, 2);
});

Deno.test("buildGenesisEnvelope - uses unique UTXO IDs", () => {
  const env1 = buildGenesisEnvelope("pubkey1");
  const env2 = buildGenesisEnvelope("pubkey1");
  const uri1 = env1.payload.outputs.find(([uri]) =>
    uri.startsWith("immutable://balance/")
  )![0];
  const uri2 = env2.payload.outputs.find(([uri]) =>
    uri.startsWith("immutable://balance/")
  )![0];
  assertNotEquals(uri1, uri2);
});

// ── buildConsensusEnvelope ──

Deno.test("buildConsensusEnvelope - produces signed envelope", async () => {
  // Generate a real keypair for signing
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;

  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privRaw = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const pubHex = Array.from(new Uint8Array(pubRaw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const privHex = Array.from(new Uint8Array(privRaw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const contentHash = "deadbeef".repeat(8);
  const env = await buildConsensusEnvelope({
    contentHash,
    userPubKey: pubHex,
    userPrivKeyHex: privHex,
    inputUtxoUri: `immutable://balance/${pubHex}/utxo1`,
    inputAmount: 100,
  });

  // Should have auth array (signed)
  assertEquals(Array.isArray(env.auth), true);
  assertEquals(env.auth!.length > 0, true);

  // Should have payload with inputs
  assertEquals(env.payload.inputs.length, 1);
  assertEquals(
    env.payload.inputs[0],
    `immutable://balance/${pubHex}/utxo1`,
  );

  // Should have consumed, change, fee, consensus outputs
  const outputs = env.payload.outputs;
  assertEquals(outputs.length >= 3, true); // consumed + fee + consensus (+ optional change)

  // Check consumed marker
  const consumed = outputs.find(([uri]) =>
    uri.startsWith("immutable://consumed/")
  );
  assertEquals(consumed !== undefined, true);

  // Check fee output
  const fee = outputs.find(([uri]) =>
    uri.startsWith(`immutable://balance/${ROOT_KEY}/`)
  );
  assertEquals(fee !== undefined, true);
  assertEquals(fee![1], CONSENSUS_FEE);

  // Check consensus record
  const consensus = outputs.find(([uri]) =>
    uri.startsWith("consensus://record/")
  );
  assertEquals(consensus !== undefined, true);
  assertEquals(consensus![0], `consensus://record/${contentHash}`);
  assertEquals(consensus![1], `hash://sha256/${contentHash}`);
});

Deno.test("buildConsensusEnvelope - includes change when amount > fee", async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;

  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privRaw = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const pubHex = Array.from(new Uint8Array(pubRaw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const privHex = Array.from(new Uint8Array(privRaw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const contentHash = "cafebabe".repeat(8);
  const env = await buildConsensusEnvelope({
    contentHash,
    userPubKey: pubHex,
    userPrivKeyHex: privHex,
    inputUtxoUri: `immutable://balance/${pubHex}/utxo1`,
    inputAmount: 100,
  });

  // Should have change output back to user
  const change = env.payload.outputs.find(([uri]) =>
    uri.startsWith(`immutable://balance/${pubHex}/`) &&
    !uri.includes(ROOT_KEY)
  );
  assertEquals(change !== undefined, true);
  assertEquals(change![1], 100 - CONSENSUS_FEE);
});

Deno.test("buildConsensusEnvelope - no change when amount equals fee", async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;

  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privRaw = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const pubHex = Array.from(new Uint8Array(pubRaw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const privHex = Array.from(new Uint8Array(privRaw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const contentHash = "f00dface".repeat(8);
  const env = await buildConsensusEnvelope({
    contentHash,
    userPubKey: pubHex,
    userPrivKeyHex: privHex,
    inputUtxoUri: `immutable://balance/${pubHex}/utxo1`,
    inputAmount: CONSENSUS_FEE, // exact fee, no change
  });

  // Should NOT have change output
  const userBalances = env.payload.outputs.filter(([uri]) =>
    uri.startsWith(`immutable://balance/${pubHex}/`)
  );
  assertEquals(userBalances.length, 0);

  // Should have consumed + fee + consensus = 3 outputs
  assertEquals(env.payload.outputs.length, 3);
});

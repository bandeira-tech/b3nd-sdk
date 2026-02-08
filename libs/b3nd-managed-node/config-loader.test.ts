import { assertEquals, assertRejects } from "@std/assert";
import {
  createAuthenticatedMessage,
  generateSigningKeyPair,
} from "../b3nd-encrypt/mod.ts";
import { loadConfig } from "./config-loader.ts";
import {
  createPermissiveClient,
  createTestConfig,
  signConfig,
} from "./test-helpers.ts";
import { nodeConfigUri } from "./types.ts";

Deno.test("loadConfig: happy path returns config and timestamp", async () => {
  const config = createTestConfig();
  const { signed, keypair } = await signConfig(config);

  const client = createPermissiveClient();
  const uri = nodeConfigUri(keypair.publicKeyHex, config.nodeId);
  await client.receive([uri, signed]);

  const loaded = await loadConfig(client, keypair.publicKeyHex, config.nodeId);
  assertEquals(loaded.config.nodeId, config.nodeId);
  assertEquals(loaded.config.name, config.name);
  assertEquals(loaded.config.configVersion, 1);
  assertEquals(typeof loaded.timestamp, "number");
  assertEquals(loaded.timestamp > 0, true);
});

Deno.test("loadConfig: throws when config not found", async () => {
  const client = createPermissiveClient();
  const keypair = await generateSigningKeyPair();

  await assertRejects(
    () => loadConfig(client, keypair.publicKeyHex, "nonexistent"),
    Error,
    "Config not found",
  );
});

Deno.test("loadConfig: throws when data is not an AuthenticatedMessage", async () => {
  const client = createPermissiveClient();
  const keypair = await generateSigningKeyPair();
  const config = createTestConfig();
  const uri = nodeConfigUri(keypair.publicKeyHex, config.nodeId);

  // Store raw config without auth envelope
  await client.receive([uri, config]);

  await assertRejects(
    () => loadConfig(client, keypair.publicKeyHex, config.nodeId),
    Error,
    "not a signed AuthenticatedMessage",
  );
});

Deno.test("loadConfig: throws when signed by wrong key", async () => {
  const config = createTestConfig();
  const operatorKeypair = await generateSigningKeyPair();
  const wrongKeypair = await generateSigningKeyPair();

  // Sign with wrong key
  const signed = await createAuthenticatedMessage(config, [
    { privateKey: wrongKeypair.privateKey, publicKeyHex: wrongKeypair.publicKeyHex },
  ]);

  const client = createPermissiveClient();
  const uri = nodeConfigUri(operatorKeypair.publicKeyHex, config.nodeId);
  await client.receive([uri, signed]);

  await assertRejects(
    () => loadConfig(client, operatorKeypair.publicKeyHex, config.nodeId),
    Error,
    "no valid signature from operator",
  );
});

Deno.test("loadConfig: throws when signature is corrupted", async () => {
  const config = createTestConfig();
  const keypair = await generateSigningKeyPair();

  const signed = await createAuthenticatedMessage(config, [
    { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex },
  ]);

  // Corrupt the signature
  signed.auth[0].signature = "0000" + signed.auth[0].signature.slice(4);

  const client = createPermissiveClient();
  const uri = nodeConfigUri(keypair.publicKeyHex, config.nodeId);
  await client.receive([uri, signed]);

  await assertRejects(
    () => loadConfig(client, keypair.publicKeyHex, config.nodeId),
    Error,
    "no valid signature from operator",
  );
});

Deno.test("loadConfig: accepts config with multiple signers including operator", async () => {
  const config = createTestConfig();
  const operatorKeypair = await generateSigningKeyPair();
  const otherKeypair = await generateSigningKeyPair();

  const signed = await createAuthenticatedMessage(config, [
    { privateKey: otherKeypair.privateKey, publicKeyHex: otherKeypair.publicKeyHex },
    { privateKey: operatorKeypair.privateKey, publicKeyHex: operatorKeypair.publicKeyHex },
  ]);

  const client = createPermissiveClient();
  const uri = nodeConfigUri(operatorKeypair.publicKeyHex, config.nodeId);
  await client.receive([uri, signed]);

  const loaded = await loadConfig(client, operatorKeypair.publicKeyHex, config.nodeId);
  assertEquals(loaded.config.nodeId, config.nodeId);
});

import { assertEquals } from "@std/assert";
import { createAuthenticatedMessage, generateSigningKeyPair } from "../b3nd-encrypt/mod.ts";
import { createConfigWatcher } from "./config-watcher.ts";
import {
  createPermissiveClient,
  createTestConfig,
  signConfig,
} from "./test-helpers.ts";
import type { ManagedNodeConfig } from "./types.ts";
import { nodeConfigUri } from "./types.ts";

Deno.test("config-watcher: detects config change", async () => {
  const config = createTestConfig();
  const { signed, keypair } = await signConfig(config);

  const client = createPermissiveClient();
  const uri = nodeConfigUri(keypair.publicKeyHex, config.nodeId);
  await client.receive([uri, signed]);

  let receivedConfig: ManagedNodeConfig | null = null;

  const watcher = createConfigWatcher({
    configClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: config.nodeId,
    intervalMs: 50,
    onConfigChange: async (newConfig) => {
      receivedConfig = newConfig;
    },
  });

  watcher.start();
  await new Promise((r) => setTimeout(r, 200));
  watcher.stop();

  assertEquals(receivedConfig !== null, true);
  assertEquals(receivedConfig!.nodeId, config.nodeId);
  assertEquals(receivedConfig!.name, config.name);
});

Deno.test("config-watcher: does not fire callback for same timestamp", async () => {
  const config = createTestConfig();
  const { signed, keypair } = await signConfig(config);

  const client = createPermissiveClient();
  const uri = nodeConfigUri(keypair.publicKeyHex, config.nodeId);
  await client.receive([uri, signed]);

  let callCount = 0;

  const watcher = createConfigWatcher({
    configClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: config.nodeId,
    intervalMs: 50,
    onConfigChange: async () => {
      callCount++;
    },
  });

  watcher.start();
  // Wait for multiple poll cycles
  await new Promise((r) => setTimeout(r, 300));
  watcher.stop();

  // Should only fire once for the initial config (same timestamp each time)
  assertEquals(callCount, 1);
});

Deno.test("config-watcher: fires again when config updated with new timestamp", async () => {
  const config = createTestConfig();
  const keypair = await generateSigningKeyPair();
  const signer = { privateKey: keypair.privateKey, publicKeyHex: keypair.publicKeyHex };

  const signed = await createAuthenticatedMessage(config, [signer]);

  const client = createPermissiveClient();
  const uri = nodeConfigUri(keypair.publicKeyHex, config.nodeId);
  await client.receive([uri, signed]);

  let callCount = 0;

  const watcher = createConfigWatcher({
    configClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: config.nodeId,
    intervalMs: 50,
    onConfigChange: async () => {
      callCount++;
    },
  });

  watcher.start();
  // Wait for first poll to detect initial config
  await new Promise((r) => setTimeout(r, 200));
  assertEquals(callCount, 1);

  // Wait enough time so Date.now() produces a different timestamp
  await new Promise((r) => setTimeout(r, 50));

  // Write updated config signed with the SAME keypair
  const updatedConfig = createTestConfig({ name: "Updated Node" });
  const signed2 = await createAuthenticatedMessage(updatedConfig, [signer]);
  await client.receive([uri, signed2]);

  // Wait for watcher to detect the change
  await new Promise((r) => setTimeout(r, 200));
  watcher.stop();

  assertEquals(callCount >= 2, true);
});

Deno.test("config-watcher: calls onError when config read fails", async () => {
  const keypair = await generateSigningKeyPair();
  const client = createPermissiveClient();

  // No config stored — loadConfig will throw "Config not found"
  let errorReceived: Error | null = null;

  const watcher = createConfigWatcher({
    configClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: "missing-node",
    intervalMs: 50,
    onConfigChange: async () => {},
    onError: (err) => {
      errorReceived = err;
    },
  });

  watcher.start();
  await new Promise((r) => setTimeout(r, 150));
  watcher.stop();

  assertEquals(errorReceived !== null, true);
  assertEquals(errorReceived!.message.includes("Config not found"), true);
});

Deno.test("config-watcher: stop cancels polling", async () => {
  const config = createTestConfig();
  const { signed, keypair } = await signConfig(config);

  const client = createPermissiveClient();
  const uri = nodeConfigUri(keypair.publicKeyHex, config.nodeId);
  await client.receive([uri, signed]);

  let callCount = 0;

  const watcher = createConfigWatcher({
    configClient: client,
    operatorPubKeyHex: keypair.publicKeyHex,
    nodeId: config.nodeId,
    intervalMs: 30,
    onConfigChange: async () => {
      callCount++;
    },
  });

  watcher.start();
  await new Promise((r) => setTimeout(r, 100));
  watcher.stop();

  const countAfterStop = callCount;
  await new Promise((r) => setTimeout(r, 200));

  // No additional calls after stop
  assertEquals(callCount, countAfterStop);
});

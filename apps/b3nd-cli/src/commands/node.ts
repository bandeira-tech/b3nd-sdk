/**
 * CLI commands for managing B3nd nodes.
 *
 * Commands:
 *   bnd node keygen [path]          - Generate Ed25519 + X25519 keypair for a new node
 *   bnd node env <keyfile>          - Output Phase 2 env vars from a node key file
 *   bnd node config push <file>     - Sign and write config to B3nd
 *   bnd node config get <nodeId>    - Read current config for a node
 *   bnd node status <nodeKey>       - Read node status (by node's public key)
 */

import { closeClient, getClient } from "../client.ts";
import { loadConfig } from "../config.ts";
import { createLogger } from "../logger.ts";
import {
  loadAccountKey,
  loadEncryptionKey,
  loadKeyFile,
  signAsAuthenticatedMessage,
} from "../keys.ts";
import { encodeHex } from "@std/encoding/hex";
import {
  exportPrivateKeyPem,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
} from "@b3nd/sdk/encrypt";

/**
 * Generate Ed25519 + X25519 keypair for a new managed node
 */
export async function nodeKeygen(outputPath?: string): Promise<void> {
  const signingPair = await generateSigningKeyPair();
  const privateKeyPem = await exportPrivateKeyPem(
    signingPair.privateKey,
    "PRIVATE KEY",
  );

  const encryptionPair = await generateEncryptionKeyPair();
  const encryptionPrivateKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", encryptionPair.privateKey),
  );
  const encryptionPrivateKeyHex = encodeHex(encryptionPrivateKeyBytes);

  const keyPath = outputPath ??
    `${Deno.env.get("HOME")}/.bnd/nodes/${signingPair.publicKeyHex.slice(0, 12)}.key`;

  const dir = keyPath.split("/").slice(0, -1).join("/");
  await Deno.mkdir(dir, { recursive: true });

  const content = [
    privateKeyPem,
    `PUBLIC_KEY_HEX=${signingPair.publicKeyHex}`,
    `ENCRYPTION_PRIVATE_KEY_HEX=${encryptionPrivateKeyHex}`,
    `ENCRYPTION_PUBLIC_KEY_HEX=${encryptionPair.publicKeyHex}`,
  ].join("\n");

  await Deno.writeTextFile(keyPath, content);
  await Deno.chmod(keyPath, 0o600);

  console.log(`Node keypair generated`);
  console.log(`  Node ID: ${signingPair.publicKeyHex}`);
  console.log(`  Encryption: ${encryptionPair.publicKeyHex}`);
  console.log(`  Key file: ${keyPath}`);
}

/**
 * Output Phase 2 env vars from a node key file + operator config
 */
export async function nodeEnv(keyFilePath: string): Promise<void> {
  const nodeKey = await loadKeyFile(keyFilePath);

  if (!nodeKey.encryptionPrivateKeyHex) {
    throw new Error(
      "Key file missing ENCRYPTION_PRIVATE_KEY_HEX. Regenerate with: bnd node keygen",
    );
  }

  const config = await loadConfig();
  const accountKey = await loadAccountKey();

  let operatorEncryptionPubHex = "";
  if (config.encrypt) {
    const encryptionKey = await loadEncryptionKey();
    operatorEncryptionPubHex = encryptionKey.publicKeyHex;
  }

  console.log(`NODE_ID=${nodeKey.publicKeyHex}`);
  console.log(
    `NODE_PRIVATE_KEY_PEM="${nodeKey.privateKeyPem.replace(/\n/g, "\\n")}"`,
  );
  console.log(
    `NODE_ENCRYPTION_PRIVATE_KEY_HEX=${nodeKey.encryptionPrivateKeyHex}`,
  );
  console.log(`OPERATOR_KEY=${accountKey.publicKeyHex}`);
  if (operatorEncryptionPubHex) {
    console.log(
      `OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX=${operatorEncryptionPubHex}`,
    );
  }
  if (config.node) {
    console.log(`CONFIG_URL=${config.node}`);
  }
}

/**
 * Push a node config file to B3nd (sign and write)
 */
export async function nodeConfigPush(
  configFilePath: string,
  verbose = false,
): Promise<void> {
  const logger = createLogger(verbose);

  const content = await Deno.readTextFile(configFilePath);
  let config: unknown;
  try {
    config = JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse config file as JSON: ${configFilePath}`);
  }

  const accountKey = await loadAccountKey();
  const signedMessage = await signAsAuthenticatedMessage(config, accountKey);

  const cfg = config as { nodeId?: string };
  if (!cfg.nodeId) throw new Error("Config must contain nodeId field");

  const uri =
    `mutable://accounts/${accountKey.publicKeyHex}/nodes/${cfg.nodeId}/config`;
  logger?.info(`Writing config to ${uri}`);

  try {
    const client = await getClient(logger);
    const result = await client.receive([uri, signedMessage]);

    if (result.accepted) {
      console.log(`Config pushed successfully`);
      console.log(`  URI: ${uri}`);
      console.log(`  Node: ${cfg.nodeId}`);
    } else {
      throw new Error(result.error || "Push failed");
    }
  } finally {
    await closeClient(logger);
  }
}

/**
 * Get current config for a node
 */
export async function nodeConfigGet(
  nodeId: string,
  verbose = false,
): Promise<void> {
  const logger = createLogger(verbose);

  const accountKey = await loadAccountKey();
  const uri =
    `mutable://accounts/${accountKey.publicKeyHex}/nodes/${nodeId}/config`;
  logger?.info(`Reading config from ${uri}`);

  try {
    const client = await getClient(logger);
    const result = await client.read(uri);

    if (result.success && result.record) {
      console.log(`Node config for ${nodeId}:`);
      console.log(JSON.stringify(result.record.data, null, 2));
    } else {
      console.log(`No config found for node ${nodeId}`);
    }
  } finally {
    await closeClient(logger);
  }
}

/**
 * Read node status (by node's public key)
 */
export async function nodeStatus(
  nodeKey: string,
  verbose = false,
): Promise<void> {
  const logger = createLogger(verbose);

  const uri = `mutable://accounts/${nodeKey}/status`;
  logger?.info(`Reading status from ${uri}`);

  try {
    const client = await getClient(logger);
    const result = await client.read(uri);

    if (result.success && result.record) {
      const data = result.record.data as any;
      const status = data.payload ?? data;
      console.log(`Node status for ${nodeKey}:`);
      console.log(`  Name: ${status.name}`);
      console.log(`  Status: ${status.status}`);
      console.log(`  Port: ${status.server?.port}`);
      console.log(`  Uptime: ${formatUptime(status.uptime)}`);
      console.log(
        `  Last heartbeat: ${new Date(status.lastHeartbeat).toISOString()}`,
      );
      if (status.backends) {
        console.log(`  Backends:`);
        for (const b of status.backends) {
          console.log(`    - ${b.type}: ${b.status}`);
        }
      }
    } else {
      console.log(`No status found for node ${nodeKey}`);
    }
  } finally {
    await closeClient(logger);
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

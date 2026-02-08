/**
 * CLI commands for managing B3nd nodes.
 *
 * Commands:
 *   bnd node keygen [path]          - Generate Ed25519 keypair for a new node
 *   bnd node config push <file>     - Sign and write config to B3nd
 *   bnd node config get <nodeId>    - Read current config for a node
 *   bnd node status <nodeId>        - Read node status
 */

import { getClient, closeClient } from "../client.ts";
import { loadConfig } from "../config.ts";
import { createLogger } from "../logger.ts";
import { encodeHex } from "@std/encoding/hex";

/**
 * Generate Ed25519 keypair for a new managed node
 */
export async function nodeKeygen(outputPath?: string): Promise<void> {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  );

  const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);

  const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyBuffer)));
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${
    privateKeyBase64.match(/.{1,64}/g)?.join("\n")
  }\n-----END PRIVATE KEY-----`;
  const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));

  const keyPath = outputPath ?? `${Deno.env.get("HOME")}/.bnd/nodes/${publicKeyHex.slice(0, 12)}.key`;

  // Create directory if needed
  const dir = keyPath.split("/").slice(0, -1).join("/");
  await Deno.mkdir(dir, { recursive: true });

  const content = `${privateKeyPem}\nPUBLIC_KEY_HEX=${publicKeyHex}`;
  await Deno.writeTextFile(keyPath, content);
  await Deno.chmod(keyPath, 0o600);

  console.log(`Node keypair generated`);
  console.log(`  Node ID (public key): ${publicKeyHex}`);
  console.log(`  Key file: ${keyPath}`);
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

  const appConfig = await loadConfig();
  if (!appConfig.account) {
    throw new Error("No account configured. Run: bnd account create");
  }

  // Load account key for signing
  const accountContent = await Deno.readTextFile(appConfig.account);
  const lines = accountContent.trim().split("\n");
  let publicKeyHex = "";
  const pemLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("PUBLIC_KEY_HEX=")) {
      publicKeyHex = line.substring("PUBLIC_KEY_HEX=".length);
    } else {
      pemLines.push(line);
    }
  }
  const privateKeyPem = pemLines.join("\n");

  // Import key and sign
  const base64 = privateKeyPem
    .split("\n")
    .filter((l) => !l.startsWith("-----"))
    .join("");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "Ed25519", namedCurve: "Ed25519" },
    false,
    ["sign"],
  );

  const encoder = new TextEncoder();
  const signatureBytes = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    encoder.encode(JSON.stringify(config)),
  );
  const signatureHex = encodeHex(new Uint8Array(signatureBytes));

  const signedMessage = {
    auth: [{ pubkey: publicKeyHex, signature: signatureHex }],
    payload: config,
  };

  // Determine URI from config
  const cfg = config as { nodeId?: string };
  if (!cfg.nodeId) throw new Error("Config must contain nodeId field");

  const uri = `mutable://nodes/${publicKeyHex}/${cfg.nodeId}/config`;
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

  const appConfig = await loadConfig();
  if (!appConfig.account) {
    throw new Error("No account configured. Run: bnd account create");
  }

  const accountContent = await Deno.readTextFile(appConfig.account);
  const pubkeyLine = accountContent.split("\n").find((l) => l.startsWith("PUBLIC_KEY_HEX="));
  const publicKeyHex = pubkeyLine?.substring("PUBLIC_KEY_HEX=".length) ?? "";

  const uri = `mutable://nodes/${publicKeyHex}/${nodeId}/config`;
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
 * Read node status
 */
export async function nodeStatus(
  nodeId: string,
  verbose = false,
): Promise<void> {
  const logger = createLogger(verbose);

  const appConfig = await loadConfig();
  if (!appConfig.account) {
    throw new Error("No account configured. Run: bnd account create");
  }

  const accountContent = await Deno.readTextFile(appConfig.account);
  const pubkeyLine = accountContent.split("\n").find((l) => l.startsWith("PUBLIC_KEY_HEX="));
  const publicKeyHex = pubkeyLine?.substring("PUBLIC_KEY_HEX=".length) ?? "";

  const uri = `mutable://nodes/${publicKeyHex}/${nodeId}/status`;
  logger?.info(`Reading status from ${uri}`);

  try {
    const client = await getClient(logger);
    const result = await client.read(uri);

    if (result.success && result.record) {
      const data = result.record.data as any;
      const status = data.payload ?? data;
      console.log(`Node status for ${nodeId}:`);
      console.log(`  Name: ${status.name}`);
      console.log(`  Status: ${status.status}`);
      console.log(`  Port: ${status.server?.port}`);
      console.log(`  Uptime: ${formatUptime(status.uptime)}`);
      console.log(`  Last heartbeat: ${new Date(status.lastHeartbeat).toISOString()}`);
      if (status.backends) {
        console.log(`  Backends:`);
        for (const b of status.backends) {
          console.log(`    - ${b.type}: ${b.status}`);
        }
      }
    } else {
      console.log(`No status found for node ${nodeId}`);
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

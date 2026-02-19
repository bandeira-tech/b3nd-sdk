/**
 * CLI commands for managing B3nd networks.
 *
 * Commands:
 *   bnd network create <name>       - Create a network manifest
 *   bnd network up <manifest>       - Spin up local network
 *   bnd network status <networkId>  - Read all node statuses in a network
 */

import { closeClient, getClient } from "../client.ts";
import { loadConfig } from "../config.ts";
import { createLogger } from "../logger.ts";
import { loadAccountKey, signAsAuthenticatedMessage } from "../keys.ts";

interface NetworkManifest {
  networkId: string;
  name: string;
  description?: string;
  nodes: Array<{
    nodeId: string;
    name: string;
    role: string;
    publicKey: string;
    encryptionPublicKey?: string;
    config: unknown;
  }>;
}

/**
 * Create a network manifest file
 */
export async function networkCreate(
  name: string,
  outputPath?: string,
): Promise<void> {
  const networkId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  const manifest: NetworkManifest = {
    networkId,
    name,
    nodes: [],
  };

  const filePath = outputPath ?? `./network-${networkId.slice(0, 8)}.json`;
  await Deno.writeTextFile(filePath, JSON.stringify(manifest, null, 2));

  console.log(`Network manifest created`);
  console.log(`  Network ID: ${networkId}`);
  console.log(`  Name: ${name}`);
  console.log(`  File: ${filePath}`);
  console.log(`\nAdd nodes by editing the manifest file, then run:`);
  console.log(`  bnd network up ${filePath}`);
}

/**
 * Spin up a local network from a manifest file.
 */
export async function networkUp(
  manifestPath: string,
  verbose = false,
): Promise<void> {
  const logger = createLogger(verbose);

  const content = await Deno.readTextFile(manifestPath);
  let manifest: NetworkManifest;
  try {
    manifest = JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse manifest: ${manifestPath}`);
  }

  if (!manifest.nodes || manifest.nodes.length === 0) {
    throw new Error("Network manifest has no nodes. Add nodes first.");
  }

  console.log(
    `Starting network: ${manifest.name} (${manifest.nodes.length} nodes)`,
  );
  console.log("");

  const appConfig = await loadConfig();
  if (!appConfig.node) {
    throw new Error("No node URL configured. Run: bnd conf node <url>");
  }

  const accountKey = await loadAccountKey();

  try {
    const client = await getClient(logger);

    for (const node of manifest.nodes) {
      const uri =
        `mutable://accounts/${accountKey.publicKeyHex}/nodes/${node.nodeId}/config`;
      logger?.info(`Pushing config for ${node.name} to ${uri}`);

      const signedConfig = await signAsAuthenticatedMessage(
        node.config,
        accountKey,
      );
      const result = await client.receive([uri, signedConfig]);

      if (result.accepted) {
        console.log(`  Pushed config for ${node.name}`);
      } else {
        console.log(
          `  Failed to push config for ${node.name}: ${result.error}`,
        );
      }
    }

    // Push network manifest
    const networkUri =
      `mutable://accounts/${accountKey.publicKeyHex}/networks/${manifest.networkId}`;
    const signedManifest = await signAsAuthenticatedMessage(
      manifest,
      accountKey,
    );
    await client.receive([networkUri, signedManifest]);
    console.log(`\nNetwork manifest pushed to ${networkUri}`);
  } finally {
    await closeClient(logger);
  }

  console.log(`\nConfigs pushed. To start each managed node:`);
  console.log(`  bnd node env <keyfile>   # outputs all Phase 2 env vars`);
}

/**
 * Read all node statuses in a network
 */
export async function networkStatus(
  networkIdOrPath: string,
  verbose = false,
): Promise<void> {
  const logger = createLogger(verbose);

  const accountKey = await loadAccountKey();

  let manifest: NetworkManifest;
  try {
    const content = await Deno.readTextFile(networkIdOrPath);
    manifest = JSON.parse(content);
  } catch {
    try {
      const client = await getClient(logger);
      const uri =
        `mutable://accounts/${accountKey.publicKeyHex}/networks/${networkIdOrPath}`;
      const result = await client.read(uri);
      if (result.success && result.record) {
        const data = result.record.data as any;
        manifest = data.payload ?? data;
      } else {
        throw new Error("Not found");
      }
      await closeClient(logger);
    } catch {
      throw new Error(
        `Cannot find network: ${networkIdOrPath} (not a file or known network ID)`,
      );
    }
  }

  console.log(`Network: ${manifest.name} (${manifest.networkId})`);
  console.log(`Nodes: ${manifest.nodes.length}`);
  console.log("");

  try {
    const client = await getClient(logger);

    for (const node of manifest.nodes) {
      const nodeKey = node.publicKey;
      const statusUri = `mutable://accounts/${nodeKey}/status`;
      const result = await client.read(statusUri);

      if (result.success && result.record) {
        const data = result.record.data as any;
        const status = data.payload ?? data;
        const statusIcon = status.status === "online"
          ? "+"
          : status.status === "degraded"
          ? "~"
          : "x";
        console.log(
          `  [${statusIcon}] ${node.name} (${nodeKey.slice(0, 12)}...)`,
        );
        console.log(
          `      Status: ${status.status}, Port: ${status.server?.port}, Uptime: ${
            formatUptime(status.uptime)
          }`,
        );
      } else {
        console.log(
          `  [?] ${node.name} (${nodeKey.slice(0, 12)}...) - no status`,
        );
      }
    }
  } finally {
    await closeClient(logger);
  }
}

function formatUptime(ms: number): string {
  if (!ms) return "unknown";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

import { Identity, Rig } from "@b3nd/rig";
import { loadConfig } from "./config.ts";
import { loadAccountKey, loadEncryptionKey } from "./keys.ts";
import { Logger } from "./logger.ts";

let cachedRig: Rig | null = null;

/**
 * Initialize and get a Rig instance from the CLI config.
 *
 * Lazily loads identity from the configured account key file.
 * The rig connects to the configured node URL.
 */
export async function getRig(
  logger?: Logger,
): Promise<Rig> {
  if (cachedRig) return cachedRig;

  const config = await loadConfig();

  if (!config.node) {
    throw new Error(
      "No node configured. Run: bnd conf node <url>\n" +
        "Example: bnd conf node https://testnet-evergreen.fire.cat",
    );
  }

  try {
    logger?.info(`Connecting to ${config.node}`);

    // Build identity from account key if configured
    let identity: Identity | undefined;
    if (config.account) {
      try {
        const accountKey = await loadAccountKey();
        const encKey = config.encrypt ? await loadEncryptionKey() : undefined;

        identity = await Identity.fromPem(
          accountKey.privateKeyPem,
          accountKey.publicKeyHex,
          encKey?.encryptionPrivateKeyHex || encKey?.privateKeyPem,
          encKey?.encryptionPublicKeyHex || encKey?.publicKeyHex,
        );
        logger?.info(`Identity loaded: ${identity.pubkey.substring(0, 16)}...`);
      } catch (err) {
        logger?.info(`No identity loaded: ${(err as Error).message}`);
      }
    }

    cachedRig = await Rig.init({
      identity,
      use: config.node,
    });

    // Test connection
    logger?.http("GET", `${config.node}/api/v1/health`);
    const health = await cachedRig.health();

    if (health.status === "unhealthy") {
      console.warn("⚠ Warning: Node health is unhealthy");
      console.warn(`  Status: ${health.message}`);
    } else {
      logger?.info(`✓ Connected (${health.status})`);
    }

    return cachedRig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error(`Failed to connect to ${config.node}: ${message}`);
    throw new Error(
      `Failed to connect to node at ${config.node}: ${message}\n` +
        `Check your node URL: bnd conf node <url>`,
    );
  }
}

/**
 * Close the cached rig connection
 */
export async function closeRig(logger?: Logger): Promise<void> {
  if (cachedRig) {
    await cachedRig.cleanup();
    cachedRig = null;
  }
}

/**
 * Get the underlying NodeProtocolInterface client.
 * Use this for commands that need raw receive/read/list.
 */
export async function getClient(logger?: Logger) {
  const rig = await getRig(logger);
  return rig.client;
}

/**
 * Close the cached client connection (alias for closeRig)
 */
export const closeClient = closeRig;

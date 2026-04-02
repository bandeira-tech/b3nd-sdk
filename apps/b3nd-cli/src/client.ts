import {
  AuthenticatedRig,
  connection,
  createClientFromUrl,
  Identity,
  Rig,
} from "@b3nd/rig";
import { loadConfig } from "./config.ts";
import { loadAccountKey, loadEncryptionKey } from "./keys.ts";
import { Logger } from "./logger.ts";

let cachedRig: Rig | null = null;
let cachedIdentity: Identity | null = null;

/**
 * Initialize and get a Rig instance from the CLI config.
 *
 * The rig is identity-free — pure orchestration. Use `getIdentity()`
 * or `getSession()` for authenticated operations.
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
    if (config.account) {
      try {
        const accountKey = await loadAccountKey();
        const encKey = config.encrypt ? await loadEncryptionKey() : undefined;

        cachedIdentity = await Identity.fromPem(
          accountKey.privateKeyPem,
          accountKey.publicKeyHex,
          encKey?.encryptionPrivateKeyHex || encKey?.privateKeyPem,
          encKey?.encryptionPublicKeyHex || encKey?.publicKeyHex,
        );
        logger?.info(
          `Identity loaded: ${cachedIdentity.pubkey.substring(0, 16)}...`,
        );
      } catch (err) {
        logger?.info(`No identity loaded: ${(err as Error).message}`);
      }
    }

    const client = await createClientFromUrl(config.node);
    const isHttp = config.node.startsWith("http://") ||
      config.node.startsWith("https://");
    cachedRig = new Rig({
      connections: [connection(client, { receive: ["*"], read: ["*"] })],
      ...(isHttp ? { sseBaseUrl: config.node.replace(/\/$/, "") } : {}),
    });

    // Wire verbose logging through rig events
    if (logger) {
      cachedRig.on("receive:success", (e) => {
        logger.info(`✓ receive accepted: ${e.uri}`);
      });
      cachedRig.on("receive:error", (e) => {
        logger.error(`✗ receive rejected: ${e.uri ?? "unknown"} — ${e.error}`);
      });
      cachedRig.on("read:success", (e) => {
        logger.info(`✓ read ok: ${e.uri}`);
      });
      cachedRig.on("read:error", (e) => {
        logger.error(`✗ read failed: ${e.uri ?? "unknown"} — ${e.error}`);
      });
    }

    // Test connection
    logger?.http("GET", `${config.node}/api/v1/status`);
    const st = await cachedRig.status();

    if (st.status === "unhealthy") {
      console.warn("⚠ Warning: Node status is unhealthy");
      console.warn(`  Status: ${st.message}`);
    } else {
      logger?.info(`✓ Connected (${st.status})`);
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

/** Get the loaded Identity (null if no account key configured). */
export function getIdentity(): Identity | null {
  return cachedIdentity;
}

/**
 * Get an authenticated session (identity + rig).
 *
 * Returns null if no identity is loaded. Requires getRig() to have been called first.
 */
export function getSession(): AuthenticatedRig | null {
  if (!cachedRig || !cachedIdentity) return null;
  return cachedIdentity.rig(cachedRig);
}

/**
 * Close the cached rig connection
 */
export async function closeRig(logger?: Logger): Promise<void> {
  if (cachedRig) {
    cachedRig = null;
    cachedIdentity = null;
  }
}

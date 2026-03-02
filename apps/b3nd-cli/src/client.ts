import { HttpClient } from "@b3nd/sdk/http";
import type { NodeProtocolInterface } from "@b3nd/sdk/types";
import { BluetoothClient } from "../../../libs/b3nd-client-bluetooth/mod.ts";
import { createBluetoothTransport } from "../../../libs/b3nd-client-bluetooth/connect.ts";
import { loadConfig } from "./config.ts";
import { Logger } from "./logger.ts";

let cachedClient: NodeProtocolInterface | null = null;

/**
 * Create a client from a node URL.
 * Supports http://, https://, ws://, wss://, and bluetooth:// schemes.
 */
async function createClientFromUrl(
  url: string,
  timeout: number,
): Promise<NodeProtocolInterface> {
  if (url.startsWith("bluetooth://")) {
    const transport = await createBluetoothTransport(url);
    return new BluetoothClient({ transport, timeout });
  }

  // Default: HTTP client (handles http:// and https://)
  return new HttpClient({ url, timeout });
}

/**
 * Initialize and get the client for the configured node
 */
export async function getClient(
  logger?: Logger,
): Promise<NodeProtocolInterface> {
  if (cachedClient) return cachedClient;

  const config = await loadConfig();

  if (!config.node) {
    throw new Error(
      "No node configured. Run: bnd conf node <url>\n" +
        "Example: bnd conf node https://testnet-evergreen.fire.cat\n" +
        "         bnd conf node bluetooth://mock",
    );
  }

  try {
    logger?.info(`Connecting to ${config.node}`);

    cachedClient = await createClientFromUrl(config.node, 30000);

    // Test connection
    const health = await cachedClient!.health();

    if (health.status === "unhealthy") {
      console.warn("Warning: Node health is unhealthy");
      console.warn(`  Status: ${health.message}`);
    } else {
      logger?.info(`Connected (${health.status})`);
    }

    return cachedClient!;
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
 * Close the cached client connection
 */
export async function closeClient(logger?: Logger): Promise<void> {
  if (cachedClient) {
    await cachedClient.cleanup();
    cachedClient = null;
  }
}

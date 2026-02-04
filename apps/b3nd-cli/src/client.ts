import { HttpClient } from "@b3nd/sdk/http";
import type { NodeProtocolInterface } from "@b3nd/sdk/types";
import { loadConfig } from "./config.ts";
import { Logger } from "./logger.ts";

let cachedClient: NodeProtocolInterface | null = null;

/**
 * Initialize and get the HTTP client for the configured node
 */
export async function getClient(
  logger?: Logger,
): Promise<NodeProtocolInterface> {
  if (cachedClient) return cachedClient;

  const config = await loadConfig();

  if (!config.node) {
    throw new Error(
      "No node configured. Run: bnd conf node <url>\n" +
        "Example: bnd conf node https://testnet-evergreen.fire.cat",
    );
  }

  try {
    logger?.info(`Connecting to ${config.node}`);

    cachedClient = new HttpClient({
      url: config.node,
      timeout: 30000,
    });

    // Test connection
    logger?.http("GET", `${config.node}/api/v1/health`);
    const health = await cachedClient!.health();

    if (health.status === "unhealthy") {
      console.warn("⚠ Warning: Node health is unhealthy");
      console.warn(`  Status: ${health.message}`);
    } else {
      logger?.info(`✓ Connected (${health.status})`);
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

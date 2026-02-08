/**
 * Config loader for managed nodes.
 *
 * Reads and verifies a signed ManagedNodeConfig from a B3nd URI.
 */

import type { NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk";
import { verify } from "@b3nd/encrypt";
import type { ManagedNodeConfig } from "./types.ts";
import { nodeConfigUri } from "./types.ts";

export interface LoadedConfig {
  config: ManagedNodeConfig;
  timestamp: number;
}

/**
 * Load a managed node config from B3nd, verifying the operator's signature.
 *
 * The config is stored as an AuthenticatedMessage<ManagedNodeConfig> at:
 *   mutable://nodes/{operatorPubKeyHex}/{nodeId}/config
 */
export async function loadConfig(
  configClient: NodeProtocolInterface,
  operatorPubKeyHex: string,
  nodeId: string,
): Promise<LoadedConfig> {
  const uri = nodeConfigUri(operatorPubKeyHex, nodeId);
  const result = await configClient.read(uri);

  if (!result.success || !result.record) {
    throw new Error(`Config not found at ${uri}`);
  }

  const data = result.record.data;
  if (!data || typeof data !== "object") {
    throw new Error(`Invalid config data at ${uri}`);
  }

  // Verify AuthenticatedMessage envelope
  const message = data as { auth?: Array<{ pubkey: string; signature: string }>; payload?: unknown };
  if (!message.auth || !Array.isArray(message.auth) || !message.payload) {
    throw new Error(`Config at ${uri} is not a signed AuthenticatedMessage`);
  }

  // Verify at least one signature from the operator's key
  let verified = false;
  for (const entry of message.auth) {
    if (entry.pubkey === operatorPubKeyHex) {
      const ok = await verify(entry.pubkey, entry.signature, message.payload);
      if (ok) {
        verified = true;
        break;
      }
    }
  }

  if (!verified) {
    throw new Error(`Config at ${uri} has no valid signature from operator ${operatorPubKeyHex}`);
  }

  return {
    config: message.payload as ManagedNodeConfig,
    timestamp: result.record.ts,
  };
}

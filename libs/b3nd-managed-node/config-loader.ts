/**
 * Config loader for managed nodes.
 *
 * Reads a signed+encrypted ManagedNodeConfig from:
 *   mutable://accounts/{operatorPubKeyHex}/nodes/{nodeId}/config
 *
 * The config is a SignedEncryptedMessage: operator signs with Ed25519,
 * encrypts to the node's X25519 key. The node decrypts and verifies.
 */

import type { NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk";
import { verify } from "@b3nd/encrypt";
import type { EncryptedPayload, SignedEncryptedMessage } from "@b3nd/encrypt";
import type { ManagedNodeConfig } from "./types.ts";
import { nodeConfigUri } from "./types.ts";
import { validateConfig } from "./validators.ts";

export interface LoadedConfig {
  config: ManagedNodeConfig;
  timestamp: number;
}

export interface ConfigLoaderOptions {
  nodeEncryptionPrivateKey?: CryptoKey;
}

/**
 * Load a managed node config from B3nd, verifying the operator's signature.
 *
 * Supports two message formats:
 * - SignedEncryptedMessage (payload is EncryptedPayload) — decrypts then verifies
 * - AuthenticatedMessage (payload is plaintext) — verifies only (legacy / tests)
 */
export async function loadConfig(
  configClient: NodeProtocolInterface,
  operatorPubKeyHex: string,
  nodeId: string,
  options?: ConfigLoaderOptions,
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

  // Verify AuthenticatedMessage / SignedEncryptedMessage envelope
  const message = data as {
    auth?: Array<{ pubkey: string; signature: string }>;
    payload?: unknown;
  };
  if (!message.auth || !Array.isArray(message.auth) || !message.payload) {
    throw new Error(`Config at ${uri} is not a signed AuthenticatedMessage`);
  }

  // Determine if payload is encrypted (EncryptedPayload has data + nonce fields)
  const payloadObj = message.payload as Record<string, unknown>;
  const isEncrypted = typeof payloadObj.data === "string" &&
    typeof payloadObj.nonce === "string";

  let config: ManagedNodeConfig;

  if (isEncrypted) {
    if (!options?.nodeEncryptionPrivateKey) {
      throw new Error(
        `Config at ${uri} is encrypted but no decryption key provided`,
      );
    }

    // For encrypted messages, verify signature over the encrypted payload first
    let verified = false;
    for (const entry of message.auth) {
      if (entry.pubkey === operatorPubKeyHex) {
        const ok = await verify(
          entry.pubkey,
          entry.signature,
          message.payload,
        );
        if (ok) {
          verified = true;
          break;
        }
      }
    }
    if (!verified) {
      throw new Error(
        `Config at ${uri} has no valid signature from operator ${operatorPubKeyHex}`,
      );
    }

    // Decrypt
    const { decrypt } = await import("@b3nd/encrypt");
    config = (await decrypt(
      message.payload as EncryptedPayload,
      options.nodeEncryptionPrivateKey,
    )) as ManagedNodeConfig;
  } else {
    // Legacy plaintext AuthenticatedMessage — verify signature over payload
    let verified = false;
    for (const entry of message.auth) {
      if (entry.pubkey === operatorPubKeyHex) {
        const ok = await verify(
          entry.pubkey,
          entry.signature,
          message.payload,
        );
        if (ok) {
          verified = true;
          break;
        }
      }
    }
    if (!verified) {
      throw new Error(
        `Config at ${uri} has no valid signature from operator ${operatorPubKeyHex}`,
      );
    }
    config = message.payload as ManagedNodeConfig;
  }

  // Validate data structure
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid config data at ${uri}: ${validation.error}`);
  }

  return {
    config,
    timestamp: result.record.ts,
  };
}

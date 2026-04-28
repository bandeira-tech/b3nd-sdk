import {
  connection,
  createClientFromUrl,
  Identity,
  Rig,
} from "@b3nd/rig";
import type { Output, ReceiveResult } from "@b3nd/rig";
import { message } from "../../../libs/b3nd-msg/data/message.ts";
import type { EncryptedPayload } from "@b3nd/sdk/encrypt";
import { loadConfig } from "./config.ts";
import { loadAccountKey, loadEncryptionKey } from "./keys.ts";
import { Logger } from "./logger.ts";

let cachedRig: Rig | null = null;
let cachedIdentity: Identity | null = null;

/** Result of a signed send — envelope URI plus receive result. */
export interface SignAndSendResult extends ReceiveResult {
  uri: string;
}

/**
 * Initialize and get a Rig instance from the CLI config.
 *
 * The rig is identity-free — pure orchestration. Use `getIdentity()`
 * for authenticated operations, and `signAndSend()` / `signEncryptAndSend()`
 * helpers for signed writes.
 */
export async function getRig(
  logger?: Logger,
): Promise<Rig> {
  if (cachedRig) return cachedRig;

  const config = await loadConfig();

  if (!config.node) {
    throw new Error(
      "No node configured. Run: bnd conf node <url>\n" +
        "Example: bnd conf node https://your-node.example.com",
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
    cachedRig = new Rig({
      connections: [connection(client, { receive: ["*"], read: ["*"] })],
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
 * Sign and send a message envelope through the rig.
 *
 * Uses Identity.sign() + message() + rig.send() — the direct pattern
 * that replaces the deprecated AuthenticatedRig.send().
 */
export async function signAndSend<V = unknown>(
  identity: Identity,
  rig: Rig,
  data: { inputs: string[]; outputs: Output<V>[] },
): Promise<SignAndSendResult> {
  const auth = [
    await identity.sign({ inputs: data.inputs, outputs: data.outputs }),
  ];
  const envelope = await message({
    auth,
    inputs: data.inputs,
    outputs: data.outputs as Output[],
  });

  // Pre-decompose: envelope + outputs + input deletions
  const inputDeletions: Output[] = data.inputs.map(
    (uri) => [uri, null] as Output,
  );
  const batch: Output[] = [
    envelope,
    ...(data.outputs as Output[]),
    ...inputDeletions,
  ];
  const results = await rig.send(batch);
  return { ...results[0], uri: envelope[0] };
}

/**
 * Sign, encrypt, and send a message envelope through the rig.
 *
 * Replaces the deprecated AuthenticatedRig.sendEncrypted().
 */
export async function signEncryptAndSend<V = unknown>(
  identity: Identity,
  rig: Rig,
  data: { inputs: string[]; outputs: Output<V>[] },
  recipientEncPubkeyHex?: string,
): Promise<SignAndSendResult> {
  if (!identity.canEncrypt) {
    throw new Error("signEncryptAndSend: identity has no encryption keys.");
  }

  const recipient = recipientEncPubkeyHex || identity.encryptionPubkey;

  const encryptedOutputs: Output[] = await Promise.all(
    data.outputs.map(async ([uri, value]) => {
      const plaintext = new TextEncoder().encode(JSON.stringify(value));
      const encrypted = await identity.encrypt(plaintext, recipient);
      return [uri, encrypted] as Output;
    }),
  );

  return signAndSend(identity, rig, {
    inputs: data.inputs,
    outputs: encryptedOutputs,
  });
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

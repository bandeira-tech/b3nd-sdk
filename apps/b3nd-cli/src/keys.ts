/**
 * Shared key file utilities for the bnd CLI.
 *
 * Key file format (PEM + key=value metadata):
 *   -----BEGIN PRIVATE KEY-----
 *   <PKCS8 base64>
 *   -----END PRIVATE KEY-----
 *   PUBLIC_KEY_HEX=<hex>
 *   ENCRYPTION_PRIVATE_KEY_HEX=<hex>   (node key files)
 *   ENCRYPTION_PUBLIC_KEY_HEX=<hex>    (node key files)
 */

import { loadConfig } from "./config.ts";
import {
  type AuthenticatedMessage,
  IdentityKey,
} from "@b3nd/sdk/encrypt";

export interface KeyFile {
  privateKeyPem: string;
  publicKeyHex: string;
  encryptionPrivateKeyHex?: string;
  encryptionPublicKeyHex?: string;
}

export function parseKeyFile(content: string): KeyFile {
  const lines = content.trim().split("\n");
  let publicKeyHex = "";
  let encryptionPrivateKeyHex: string | undefined;
  let encryptionPublicKeyHex: string | undefined;
  const pemLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("PUBLIC_KEY_HEX=")) {
      publicKeyHex = line.substring("PUBLIC_KEY_HEX=".length);
    } else if (line.startsWith("ENCRYPTION_PRIVATE_KEY_HEX=")) {
      encryptionPrivateKeyHex = line.substring(
        "ENCRYPTION_PRIVATE_KEY_HEX=".length,
      );
    } else if (line.startsWith("ENCRYPTION_PUBLIC_KEY_HEX=")) {
      encryptionPublicKeyHex = line.substring(
        "ENCRYPTION_PUBLIC_KEY_HEX=".length,
      );
    } else {
      pemLines.push(line);
    }
  }

  if (!publicKeyHex) {
    throw new Error("PUBLIC_KEY_HEX not found in key file");
  }

  return {
    privateKeyPem: pemLines.join("\n"),
    publicKeyHex,
    ...(encryptionPrivateKeyHex && { encryptionPrivateKeyHex }),
    ...(encryptionPublicKeyHex && { encryptionPublicKeyHex }),
  };
}

export async function loadKeyFile(path: string): Promise<KeyFile> {
  const content = await Deno.readTextFile(path);
  return parseKeyFile(content);
}

export async function loadAccountKey(): Promise<KeyFile> {
  const config = await loadConfig();
  if (!config.account) {
    throw new Error("No account configured. Run: bnd account create");
  }
  try {
    return await loadKeyFile(config.account);
  } catch (error) {
    throw new Error(
      `Failed to load account key from ${config.account}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function loadEncryptionKey(): Promise<KeyFile> {
  const config = await loadConfig();
  if (!config.encrypt) {
    throw new Error(
      "No encryption key configured. Run: bnd encrypt create",
    );
  }
  try {
    return await loadKeyFile(config.encrypt);
  } catch (error) {
    throw new Error(
      `Failed to load encryption key from ${config.encrypt}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function signAsAuthenticatedMessage<T>(
  payload: T,
  keyFile: KeyFile,
): Promise<AuthenticatedMessage<T>> {
  const identity = await IdentityKey.fromPem(
    keyFile.privateKeyPem,
    keyFile.publicKeyHex,
  );
  const signature = await identity.sign(payload);
  return {
    auth: [{ pubkey: keyFile.publicKeyHex, signature }],
    payload,
  };
}

import type { NodeProtocolInterface } from "@b3nd/sdk/types";
import { createSignedEncryptedPayload } from "../../wallet-server/src/obfuscation.ts";
import { deriveObfuscatedPath } from "../../wallet-server/src/obfuscation.ts";
import { decodeHex, encodeHex } from "@std/encoding/hex";
import { createAuthenticatedMessage, createSignedEncryptedMessage } from "@b3nd/sdk/encrypt";

export interface AppActionDef {
  action: string;
  validation?: { stringValue?: { format?: "email" } };
  write: { encrypted?: string; plain?: string };
}

export interface AppRegistration {
  appKey: string; // account public key hex (Ed25519)
  accountPrivateKeyPem: string; // private key PEM (Ed25519)
  encryptionPublicKeyHex?: string; // X25519 public key hex (optional, used for encrypted writes)
  allowedOrigins: string[];
  actions: AppActionDef[];
  tokens?: string[]; // internal token ids (not full tokens)
}

export interface StoredAppConfig {
  appKey: string;
  allowedOrigins: string[];
  actions: AppActionDef[];
  // secrets stored encrypted in the record payload
}

export async function registerApp(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  serverIdentityPrivateKeyPem: string,
  serverIdentityPublicKeyHex: string,
  serverEncryptionPublicKeyHex: string,
  reg: AppRegistration,
) {
  const payload = {
    appKey: reg.appKey,
    allowedOrigins: reg.allowedOrigins,
    actions: reg.actions,
    secrets: {
      accountPrivateKeyPem: reg.accountPrivateKeyPem,
      encryptionPublicKeyHex: reg.encryptionPublicKeyHex || null,
      tokens: reg.tokens || [],
    },
  };

  const path = `apps/${reg.appKey}`;
  const signed = await createSignedEncryptedPayload(
    payload,
    serverIdentityPrivateKeyPem,
    serverIdentityPublicKeyHex,
    serverEncryptionPublicKeyHex,
  );
  const uri = `mutable://accounts/${serverPublicKey}/${path}`;
  const result = await client.write(uri, signed);
  return result;
}

export async function loadAppConfig(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  serverEncryptionPrivateKeyPem: string,
  appKey: string,
): Promise<{
  config: StoredAppConfig;
  accountPrivateKeyPem: string;
  encryptionPublicKeyHex: string | null;
  tokens: string[];
}> {
  const path = `apps/${appKey}`;
  const uri = `mutable://accounts/${serverPublicKey}/${path}`;
  const result = await client.read<any>(uri);
  if (!result.success || !result.record?.data) throw new Error("app config not found");

  // decrypt using the same helper as wallet-server
  const { decryptSignedEncryptedPayload } = await import("../../wallet-server/src/obfuscation.ts");
  const { data } = await decryptSignedEncryptedPayload(result.record.data, serverEncryptionPrivateKeyPem);
  const obj = data as any;
  return {
    config: {
      appKey: obj.appKey,
      allowedOrigins: obj.allowedOrigins,
      actions: obj.actions,
    },
    accountPrivateKeyPem: obj.secrets.accountPrivateKeyPem,
    encryptionPublicKeyHex: obj.secrets.encryptionPublicKeyHex,
    tokens: Array.isArray(obj.secrets.tokens) ? obj.secrets.tokens : [],
  };
}

export function validateString(val: string, rule?: { format?: "email" }): boolean {
  if (typeof val !== "string") return false;
  if (!rule) return true;
  if (rule.format === "email") {
    // very simple email check
    return /.+@.+\..+/.test(val);
  }
  return true;
}

export async function performActionWrite(
  proxyClient: NodeProtocolInterface,
  action: AppActionDef,
  appKey: string,
  accountPrivateKeyPem: string,
  encryptionPublicKeyHex: string | null,
  payload: string,
) {
  const writePath = action.write.encrypted || action.write.plain;
  if (!writePath) throw new Error("action write path not configured");

  // Build :signature placeholder deterministically from payload
  const enc = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const digestHex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

  const uri = writePath
    .replace(/:key/g, appKey)
    .replace(/:signature/g, digestHex.substring(0, 32));

  // Build signed message; encrypt if asked and key available
  const signerKey = await pemToCryptoKey(accountPrivateKeyPem, "Ed25519");
  const signer = { privateKey: signerKey, publicKeyHex: appKey } as const;

  let message: unknown;
  if (action.write.encrypted) {
    if (!encryptionPublicKeyHex) throw new Error("encryption public key not configured for encrypted write");
    message = await createSignedEncryptedMessage(payload, [signer], encryptionPublicKeyHex);
  } else {
    message = await createAuthenticatedMessage(payload, [signer]);
  }

  const result = await proxyClient.write(uri, message);
  return { uri, result };
}

async function pemToCryptoKey(
  pem: string,
  algorithm: "Ed25519" | "X25519" = "Ed25519"
): Promise<CryptoKey> {
  const base64 = pem
    .split("\n")
    .filter((line) => !line.startsWith("-----"))
    .join("");

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  if (algorithm === "Ed25519") {
    return await crypto.subtle.importKey(
      "pkcs8",
      buffer,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["sign"]
    );
  } else {
    return await crypto.subtle.importKey(
      "pkcs8",
      buffer,
      { name: "X25519", namedCurve: "X25519" },
      false,
      ["deriveBits"]
    );
  }
}
async function pemToCryptoKey(
  pem: string,
  algorithm: "Ed25519" | "X25519" = "Ed25519"
): Promise<CryptoKey> {
  const base64 = pem
    .split("\n")
    .filter((line) => !line.startsWith("-----"))
    .join("");

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  if (algorithm === "Ed25519") {
    return await crypto.subtle.importKey(
      "pkcs8",
      buffer,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["sign"]
    );
  } else {
    return await crypto.subtle.importKey(
      "pkcs8",
      buffer,
      { name: "X25519", namedCurve: "X25519" },
      false,
      ["deriveBits"]
    );
  }
}

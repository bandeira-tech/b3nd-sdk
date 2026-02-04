import type { NodeProtocolInterface } from "@b3nd/sdk/types";
import {
  type AuthenticatedMessage,
  createSignedEncryptedMessage,
  decrypt,
  verify,
} from "@b3nd/sdk/encrypt";
import { pemToCryptoKey } from "@b3nd/sdk";

export interface AppActionDef {
  action: string;
  validation?: { stringValue?: { format?: "email" } };
  write: { encrypted?: string; plain?: string };
}

export interface StoredAppConfig {
  appKey: string;
  allowedOrigins: string[];
  actions: AppActionDef[];
  encryptionPublicKeyHex: string | null;
  googleClientId?: string | null;
}

export async function saveAppConfig(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  serverIdentityPrivateKeyPem: string,
  serverIdentityPublicKeyHex: string,
  serverEncryptionPublicKeyHex: string,
  config: StoredAppConfig,
) {
  const payload = {
    appKey: config.appKey,
    allowedOrigins: config.allowedOrigins,
    actions: config.actions,
    encryptionPublicKeyHex: config.encryptionPublicKeyHex || null,
    googleClientId: config.googleClientId || null,
  };

  const path = `apps/${config.appKey}`;
  const signed = await createSignedEncryptedMessage(
    payload,
    [{
      privateKey: await pemToCryptoKey(serverIdentityPrivateKeyPem, "Ed25519"),
      publicKeyHex: serverIdentityPublicKeyHex,
    }],
    serverEncryptionPublicKeyHex,
  );
  const uri = `mutable://accounts/${serverPublicKey}/${path}`;
  const result = await client.receive([uri, signed]);
  return { success: result.accepted, error: result.error };
}

export async function loadAppConfig(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  serverEncryptionPrivateKeyPem: string,
  appKey: string,
): Promise<StoredAppConfig> {
  const path = `apps/${appKey}`;
  const uri = `mutable://accounts/${serverPublicKey}/${path}`;
  const result = await client.read<any>(uri);
  if (!result.success || !result.record?.data) {
    return {
      appKey,
      allowedOrigins: ["*"],
      actions: [],
      encryptionPublicKeyHex: null,
    };
  }

  const data = await decrypt(
    result.record.data.payload,
    await pemToCryptoKey(serverEncryptionPrivateKeyPem, "X25519"),
  );
  const obj = data as any;
  return {
    appKey: obj.appKey,
    allowedOrigins: obj.allowedOrigins || ["*"],
    actions: Array.isArray(obj.actions) ? obj.actions : [],
    encryptionPublicKeyHex: obj.encryptionPublicKeyHex || null,
    googleClientId: obj.googleClientId || null,
  };
}

export function validateString(
  val: string,
  rule?: { format?: "email" },
): boolean {
  if (typeof val !== "string") return false;
  if (!rule) return true;
  if (rule.format === "email") {
    // very simple email check
    return /.+@.+\..+/.test(val);
  }
  return true;
}

export interface SignedRequest<T = unknown> extends AuthenticatedMessage<T> {}

export async function verifySignedRequest<T>(
  appKey: string,
  message: SignedRequest<T>,
): Promise<boolean> {
  if (
    !message?.auth || !Array.isArray(message.auth) || message.auth.length === 0
  ) return false;
  const signer = message.auth.find((a) => a.pubkey === appKey);
  if (!signer?.signature) return false;
  return await verify(appKey, signer.signature, message.payload);
}

export async function performActionWrite(
  proxyClient: NodeProtocolInterface,
  action: AppActionDef,
  appKey: string,
  signedPayload: SignedRequest<any>,
) {
  const writePath = action.write.encrypted || action.write.plain;
  if (!writePath) throw new Error("action write path not configured");

  const payloadForHash = typeof signedPayload.payload === "string"
    ? signedPayload.payload
    : JSON.stringify(signedPayload.payload);
  const enc = new TextEncoder().encode(payloadForHash);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const digestHex = Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

  const uri = writePath
    .replace(/:key/g, appKey)
    .replace(/:signature/g, digestHex.substring(0, 32));

  const result = await proxyClient.receive([uri, signedPayload]);
  return { uri, result: { success: result.accepted, error: result.error } };
}

/**
 * Write Proxy
 *
 * Handles proxying user write requests to the target b3nd backend.
 * Automatically signs writes with the server's identity key and encrypts with server's encryption key.
 */

import { encodeHex, decodeHex } from "@std/encoding/hex";
import type { NodeProtocolInterface } from "@b3nd/sdk/types";
import {
  createAuthenticatedMessage,
  createSignedEncryptedMessage,
  type AuthenticatedMessage,
  type SignedEncryptedMessage,
  decrypt,
  encrypt,
  type EncryptedPayload,
} from "@b3nd/sdk/encrypt";
import {
  loadUserAccountKey,
  loadUserEncryptionKey,
} from "./keys.ts";

interface ProxyWriteRequest {
  uri: string;
  data: unknown;
  encrypt?: boolean; // whether to encrypt the payload
}

interface ProxyWriteResponse {
  success: boolean;
  resolvedUri?: string;
  error?: string;
  record?: {
    data: unknown;
    ts: number;
  };
}

/**
 * Base64url encode
 */
function base64urlEncode(data: string): string {
  const base64 = btoa(data);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Base64url decode
 */
function base64urlDecode(encoded: string): string {
  const padded = encoded
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "=");
  return atob(padded);
}

/**
 * Convert PEM string to CryptoKey
 */
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

/**
 * Proxy a write request with server signing
 * The server acts as the signer for the write operation.
 */
export async function proxyWrite(
  proxyClient: NodeProtocolInterface,
  credentialClient: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  serverEncryptionPrivateKeyPem: string,
  request: ProxyWriteRequest,
): Promise<ProxyWriteResponse> {
  try {
    // Load user's keys (server-managed)
    const [accountKey, encryptionKey] = await Promise.all([
      loadUserAccountKey(
        credentialClient,
        serverPublicKey,
        username,
        serverEncryptionPrivateKeyPem,
      ),
      loadUserEncryptionKey(
        credentialClient,
        serverPublicKey,
        username,
        serverEncryptionPrivateKeyPem,
      ),
    ]);

    // Resolve :key placeholder with the user's account public key
    const resolvedUri = request.uri.replace(/:key/g, accountKey.publicKeyHex);

    // Convert user's account private key PEM to CryptoKey for signing
    const userPrivateKey = await pemToCryptoKey(accountKey.privateKeyPem, "Ed25519");

    const signer = {
      privateKey: userPrivateKey,
      publicKeyHex: accountKey.publicKeyHex,
    };

    // Create signed message (with or without encryption)
    let signedMessage: AuthenticatedMessage<unknown> | SignedEncryptedMessage;

    if (request.encrypt) {
      // Sign and encrypt
      signedMessage = await createSignedEncryptedMessage(
        request.data,
        [signer],
        encryptionKey.publicKeyHex
      );
    } else {
      // Sign only (no encryption)
      signedMessage = await createAuthenticatedMessage(
        request.data,
        [signer]
      );
    }

    // Write to proxy client
    const result = await proxyClient.write(resolvedUri, signedMessage);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Write failed",
      };
    }

    return {
      success: true,
      resolvedUri,
      record: result.record,
    };
  } catch (error) {
    return {
      success: false,
      error: `Proxy write failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Proxy a read request (minimal processing)
 */
export async function proxyRead(
  proxyClient: NodeProtocolInterface,
  uri: string,
  serverEncryptionPrivateKeyPem?: string
): Promise<{
  success: boolean;
  error?: string;
  record?: { data: unknown; ts: number };
  decrypted?: unknown;
}> {
  try {
    const result = await proxyClient.read(uri);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Read failed",
      };
    }

    const response = {
      success: true,
      record: result.record,
    };

    // If private key is provided and data looks encrypted, try to decrypt
    if (serverEncryptionPrivateKeyPem && result.record?.data) {
      try {
        const data = result.record.data as any;

        // Check if this is an encrypted payload structure
        if (
          typeof data === "object" &&
          data.payload &&
          data.payload.data &&
          data.payload.nonce &&
          data.payload.ephemeralPublicKey
        ) {
          const privateKey = await pemToCryptoKey(
            serverEncryptionPrivateKeyPem,
            "X25519"
          );
          const decrypted = await decrypt(data.payload, privateKey);
          return {
            ...response,
            decrypted,
          };
        }
      } catch (error) {
        // Silently fail decryption - return original data
      }
    }

    return response;
  } catch (error) {
    return {
      success: false,
      error: `Proxy read failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

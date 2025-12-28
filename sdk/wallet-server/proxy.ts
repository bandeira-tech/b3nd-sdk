/**
 * Write Proxy
 *
 * Handles proxying user write requests to the target b3nd backend.
 * Automatically signs writes with the user's identity key and encrypts with user's encryption key.
 */

import type { NodeProtocolInterface } from "../src/types.ts";
import {
  createAuthenticatedMessage,
  createSignedEncryptedMessage,
  decrypt,
  type AuthenticatedMessage,
  type SignedEncryptedMessage,
  type EncryptedPayload,
} from "../encrypt/mod.ts";
import { loadUserAccountKey, loadUserEncryptionKey } from "./keys.ts";
import { pemToCryptoKey } from "./obfuscation.ts";
import type { ProxyWriteRequest, ProxyWriteResponse, ProxyReadResponse } from "./types.ts";

/**
 * Proxy a write request with user signing
 * The server acts as the key custodian for the write operation.
 */
export async function proxyWrite(
  proxyClient: NodeProtocolInterface,
  credentialClient: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  serverEncryptionPrivateKeyPem: string,
  request: ProxyWriteRequest
): Promise<ProxyWriteResponse> {
  try {
    // Load user's keys (server-managed)
    const [accountKey, encryptionKey] = await Promise.all([
      loadUserAccountKey(
        credentialClient,
        serverPublicKey,
        username,
        serverEncryptionPrivateKeyPem
      ),
      loadUserEncryptionKey(
        credentialClient,
        serverPublicKey,
        username,
        serverEncryptionPrivateKeyPem
      ),
    ]);

    // Resolve :key placeholder with the user's account public key
    const resolvedUri = request.uri.replace(/:key/g, accountKey.publicKeyHex);

    // Convert user's account private key PEM to CryptoKey for signing
    const userPrivateKey = await pemToCryptoKey(
      accountKey.privateKeyPem,
      "Ed25519"
    );

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
      signedMessage = await createAuthenticatedMessage(request.data, [signer]);
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
 * Proxy a read request (with optional decryption)
 */
export async function proxyRead(
  proxyClient: NodeProtocolInterface,
  uri: string,
  serverEncryptionPrivateKeyPem?: string
): Promise<ProxyReadResponse> {
  try {
    const result = await proxyClient.read(uri);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Read failed",
      };
    }

    const response: ProxyReadResponse = {
      success: true,
      record: result.record,
    };

    // If private key is provided and data looks encrypted, try to decrypt
    if (serverEncryptionPrivateKeyPem && result.record?.data) {
      try {
        const data = result.record.data as Record<string, unknown>;

        // Check if this is an encrypted payload structure
        if (
          typeof data === "object" &&
          data.payload &&
          typeof data.payload === "object"
        ) {
          const payload = data.payload as Record<string, unknown>;
          if (payload.data && payload.nonce && payload.ephemeralPublicKey) {
            const privateKey = await pemToCryptoKey(
              serverEncryptionPrivateKeyPem,
              "X25519"
            );
            const encryptedPayload: EncryptedPayload = {
              data: payload.data as string,
              nonce: payload.nonce as string,
              ephemeralPublicKey: payload.ephemeralPublicKey as string,
            };
            const decrypted = await decrypt(
              encryptedPayload,
              privateKey
            );
            return {
              ...response,
              decrypted,
            };
          }
        }
      } catch {
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

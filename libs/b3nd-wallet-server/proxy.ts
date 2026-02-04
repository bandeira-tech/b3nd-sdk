/**
 * Write Proxy
 *
 * Handles proxying user write requests to the target b3nd backend.
 * Automatically signs writes with the user's identity key and encrypts with user's encryption key.
 */

import type { NodeProtocolInterface } from "../b3nd-core/types.ts";
import {
  type AuthenticatedMessage,
  createAuthenticatedMessage,
  createSignedEncryptedMessage,
  decrypt,
  type EncryptedPayload,
  type SignedEncryptedMessage,
} from "../b3nd-encrypt/mod.ts";
import { loadUserAccountKey, loadUserEncryptionKey } from "./keys.ts";
import { pemToCryptoKey } from "./obfuscation.ts";
import type {
  ProxyReadMultiResponse,
  ProxyReadMultiResultItem,
  ProxyReadResponse,
  ProxyWriteRequest,
  ProxyWriteResponse,
} from "./types.ts";

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
    const userPrivateKey = await pemToCryptoKey(
      accountKey.privateKeyPem,
      "Ed25519",
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
        encryptionKey.publicKeyHex,
      );
    } else {
      // Sign only (no encryption)
      signedMessage = await createAuthenticatedMessage(request.data, [signer]);
    }

    // Write to proxy client using receive()
    const result = await proxyClient.receive([resolvedUri, signedMessage]);

    if (!result.accepted) {
      return {
        success: false,
        error: result.error || "Write failed",
      };
    }

    return {
      success: true,
      resolvedUri,
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
 *
 * Data encrypted with proxyWrite is encrypted with the user's encryption key,
 * so we need to load the user's encryption key to decrypt it.
 */
export async function proxyRead(
  proxyClient: NodeProtocolInterface,
  credentialClient: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  serverEncryptionPrivateKeyPem: string,
  uri: string,
): Promise<ProxyReadResponse> {
  try {
    // Resolve :key placeholder with the user's account public key
    const accountKey = await loadUserAccountKey(
      credentialClient,
      serverPublicKey,
      username,
      serverEncryptionPrivateKeyPem,
    );
    const resolvedUri = uri.replace(/:key/g, accountKey.publicKeyHex);

    const result = await proxyClient.read(resolvedUri);

    if (!result.success) {
      return {
        success: false,
        uri: resolvedUri,
        error: result.error || "Read failed",
      };
    }

    const response: ProxyReadResponse = {
      success: true,
      uri: resolvedUri,
      record: result.record,
    };

    // Try to decrypt if data looks encrypted
    if (result.record?.data) {
      try {
        const data = result.record.data as Record<string, unknown>;

        // Check if this is a signed+encrypted payload structure
        if (
          typeof data === "object" &&
          data.payload &&
          typeof data.payload === "object"
        ) {
          const payload = data.payload as Record<string, unknown>;
          if (payload.data && payload.nonce && payload.ephemeralPublicKey) {
            // Load user's encryption key to decrypt (data was encrypted with user's public key)
            const userEncryptionKey = await loadUserEncryptionKey(
              credentialClient,
              serverPublicKey,
              username,
              serverEncryptionPrivateKeyPem,
            );

            const privateKey = await pemToCryptoKey(
              userEncryptionKey.privateKeyPem,
              "X25519",
            );
            const encryptedPayload: EncryptedPayload = {
              data: payload.data as string,
              nonce: payload.nonce as string,
              ephemeralPublicKey: payload.ephemeralPublicKey as string,
            };
            const decrypted = await decrypt(
              encryptedPayload,
              privateKey,
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
      uri,
      error: `Proxy read failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Proxy multiple read requests (with optional decryption)
 *
 * Batch version of proxyRead that reads multiple URIs efficiently.
 * Max 50 URIs per request.
 */
export async function proxyReadMulti(
  proxyClient: NodeProtocolInterface,
  credentialClient: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  serverEncryptionPrivateKeyPem: string,
  uris: string[],
): Promise<ProxyReadMultiResponse> {
  // Enforce batch size limit
  if (uris.length > 50) {
    return {
      success: false,
      results: [],
      summary: { total: uris.length, succeeded: 0, failed: uris.length },
      error: "Maximum 50 URIs per request",
    };
  }

  try {
    // Load user's keys once for all reads
    const [accountKey, userEncryptionKey] = await Promise.all([
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

    // Resolve all URIs with :key placeholder
    const resolvedUris = uris.map((uri) =>
      uri.replace(/:key/g, accountKey.publicKeyHex)
    );

    // Batch read from backend
    const multiResult = await proxyClient.readMulti(resolvedUris);

    // Prepare user's private key for decryption (once)
    const privateKey = await pemToCryptoKey(
      userEncryptionKey.privateKeyPem,
      "X25519",
    );

    // Process each result with decryption
    const results: ProxyReadMultiResultItem[] = await Promise.all(
      multiResult.results.map(
        async (item, i): Promise<ProxyReadMultiResultItem> => {
          const originalUri = uris[i];

          if (!item.success) {
            return {
              uri: originalUri,
              success: false,
              error: "error" in item ? item.error : "Read failed",
            };
          }

          const result: ProxyReadMultiResultItem = {
            uri: originalUri,
            success: true,
            record: "record" in item ? item.record : undefined,
          };

          // Try to decrypt if data looks encrypted
          if (result.record?.data) {
            try {
              const data = result.record.data as Record<string, unknown>;

              // Check if this is a signed+encrypted payload structure
              if (
                typeof data === "object" &&
                data.payload &&
                typeof data.payload === "object"
              ) {
                const payload = data.payload as Record<string, unknown>;
                if (
                  payload.data && payload.nonce && payload.ephemeralPublicKey
                ) {
                  const encryptedPayload: EncryptedPayload = {
                    data: payload.data as string,
                    nonce: payload.nonce as string,
                    ephemeralPublicKey: payload.ephemeralPublicKey as string,
                  };
                  const decrypted = await decrypt(encryptedPayload, privateKey);
                  return { ...result, decrypted };
                }
              }
            } catch {
              // Silently fail decryption - return original data
            }
          }

          return result;
        },
      ),
    );

    const succeeded = results.filter((r) => r.success).length;
    return {
      success: succeeded > 0,
      results,
      summary: {
        total: uris.length,
        succeeded,
        failed: uris.length - succeeded,
      },
    };
  } catch (error) {
    return {
      success: false,
      results: [],
      summary: { total: uris.length, succeeded: 0, failed: uris.length },
      error: `Proxy read-multi failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

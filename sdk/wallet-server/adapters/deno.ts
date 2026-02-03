/**
 * Deno Adapter for Wallet Server
 *
 * Provides Deno-specific implementations of the DI interfaces.
 */

import type { Environment, FileStorage } from "../interfaces.ts";
import type { ServerKeys, WalletServerConfig } from "../types.ts";

/**
 * Deno file storage implementation
 */
export class DenoFileStorage implements FileStorage {
  async readTextFile(path: string): Promise<string> {
    return await Deno.readTextFile(path);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await Deno.writeTextFile(path, content);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return false;
      throw e;
    }
  }
}

/**
 * Deno environment implementation
 */
export class DenoEnvironment implements Environment {
  get(key: string): string | undefined {
    return Deno.env.get(key);
  }
}

/**
 * Load server keys from Deno environment variables
 */
export function loadServerKeysFromEnv(
  env: Environment = new DenoEnvironment(),
): ServerKeys {
  const identityPrivateKeyPem = env.get("SERVER_IDENTITY_PRIVATE_KEY_PEM");
  const identityPublicKeyHex = env.get("SERVER_IDENTITY_PUBLIC_KEY_HEX");
  const encryptionPrivateKeyPem = env.get("SERVER_ENCRYPTION_PRIVATE_KEY_PEM");
  const encryptionPublicKeyHex = env.get("SERVER_ENCRYPTION_PUBLIC_KEY_HEX");

  if (!identityPrivateKeyPem) {
    throw new Error(
      "SERVER_IDENTITY_PRIVATE_KEY_PEM environment variable is required",
    );
  }
  if (!identityPublicKeyHex || identityPublicKeyHex.length !== 64) {
    throw new Error(
      "SERVER_IDENTITY_PUBLIC_KEY_HEX must be exactly 64 hex characters",
    );
  }
  if (!encryptionPrivateKeyPem) {
    throw new Error(
      "SERVER_ENCRYPTION_PRIVATE_KEY_PEM environment variable is required",
    );
  }
  if (!encryptionPublicKeyHex || encryptionPublicKeyHex.length !== 64) {
    throw new Error(
      "SERVER_ENCRYPTION_PUBLIC_KEY_HEX must be exactly 64 hex characters",
    );
  }

  return {
    identityKey: {
      privateKeyPem: identityPrivateKeyPem,
      publicKeyHex: identityPublicKeyHex,
    },
    encryptionKey: {
      privateKeyPem: encryptionPrivateKeyPem,
      publicKeyHex: encryptionPublicKeyHex,
    },
  };
}

/**
 * Load wallet server config from Deno environment variables
 */
export function loadConfigFromEnv(
  env: Environment = new DenoEnvironment(),
): WalletServerConfig {
  const jwtSecret = env.get("JWT_SECRET");
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }

  return {
    serverKeys: loadServerKeysFromEnv(env),
    jwtSecret,
    jwtExpirationSeconds: Number(env.get("JWT_EXPIRATION_SECONDS") || "86400"),
    credentialNodeUrl: env.get("CREDENTIAL_NODE_URL") ||
      "http://localhost:8842",
    proxyNodeUrl: env.get("PROXY_NODE_URL") || "http://localhost:8842",
    allowedOrigins: (env.get("ALLOWED_ORIGINS") || "*").split(","),
    passwordResetTokenTtlSeconds: Number(
      env.get("PASSWORD_RESET_TOKEN_TTL_SECONDS") || "3600",
    ),
    googleClientId: env.get("GOOGLE_CLIENT_ID") || undefined,
    bootstrapStatePath: env.get("BOOTSTRAP_APP_STATE_PATH") ||
      "./wallet-app-bootstrap.json",
    appBackend: env.get("APP_BACKEND_URL")
      ? {
        url: env.get("APP_BACKEND_URL")!,
        apiBasePath: env.get("APP_BACKEND_API_BASE_PATH") || "/api/v1",
      }
      : undefined,
    deps: {
      storage: new DenoFileStorage(),
      logger: console,
    },
  };
}

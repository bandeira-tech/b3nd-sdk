/**
 * Node.js Adapter for Wallet Server
 *
 * Provides Node.js-specific implementations of the DI interfaces.
 */

import type { FileStorage, Environment } from "../interfaces.ts";

/**
 * Node.js file storage implementation
 * Uses dynamic import to avoid bundling issues in browsers
 */
export class NodeFileStorage implements FileStorage {
  private fs: typeof import("node:fs/promises") | null = null;

  private async getFs() {
    if (!this.fs) {
      this.fs = await import("node:fs/promises");
    }
    return this.fs;
  }

  async readTextFile(path: string): Promise<string> {
    const fs = await this.getFs();
    return await fs.readFile(path, "utf-8");
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const fs = await this.getFs();
    await fs.writeFile(path, content, "utf-8");
  }

  async exists(path: string): Promise<boolean> {
    const fs = await this.getFs();
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Node.js environment implementation
 */
export class NodeEnvironment implements Environment {
  get(key: string): string | undefined {
    return process.env[key];
  }
}

/**
 * Load server keys from Node.js environment variables
 */
export function loadServerKeysFromEnv(env: Environment = new NodeEnvironment()) {
  const identityPrivateKeyPem = env.get("SERVER_IDENTITY_PRIVATE_KEY_PEM");
  const identityPublicKeyHex = env.get("SERVER_IDENTITY_PUBLIC_KEY_HEX");
  const encryptionPrivateKeyPem = env.get("SERVER_ENCRYPTION_PRIVATE_KEY_PEM");
  const encryptionPublicKeyHex = env.get("SERVER_ENCRYPTION_PUBLIC_KEY_HEX");

  if (!identityPrivateKeyPem) {
    throw new Error("SERVER_IDENTITY_PRIVATE_KEY_PEM environment variable is required");
  }
  if (!identityPublicKeyHex || identityPublicKeyHex.length !== 64) {
    throw new Error("SERVER_IDENTITY_PUBLIC_KEY_HEX must be exactly 64 hex characters");
  }
  if (!encryptionPrivateKeyPem) {
    throw new Error("SERVER_ENCRYPTION_PRIVATE_KEY_PEM environment variable is required");
  }
  if (!encryptionPublicKeyHex || encryptionPublicKeyHex.length !== 64) {
    throw new Error("SERVER_ENCRYPTION_PUBLIC_KEY_HEX must be exactly 64 hex characters");
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
 * Load wallet server config from Node.js environment variables
 */
export function loadConfigFromEnv(env: Environment = new NodeEnvironment()) {
  const jwtSecret = env.get("JWT_SECRET");
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }

  return {
    serverKeys: loadServerKeysFromEnv(env),
    jwtSecret,
    jwtExpirationSeconds: Number(env.get("JWT_EXPIRATION_SECONDS") || "86400"),
    credentialNodeUrl: env.get("CREDENTIAL_NODE_URL") || "http://localhost:8842",
    proxyNodeUrl: env.get("PROXY_NODE_URL") || "http://localhost:8842",
    allowedOrigins: (env.get("ALLOWED_ORIGINS") || "*").split(","),
    passwordResetTokenTtlSeconds: Number(env.get("PASSWORD_RESET_TOKEN_TTL_SECONDS") || "3600"),
    googleClientId: env.get("GOOGLE_CLIENT_ID") || undefined,
    bootstrapStatePath: env.get("BOOTSTRAP_APP_STATE_PATH") || "./wallet-app-bootstrap.json",
    appBackend: env.get("APP_BACKEND_URL")
      ? {
          url: env.get("APP_BACKEND_URL")!,
          apiBasePath: env.get("APP_BACKEND_API_BASE_PATH") || "/api/v1",
        }
      : undefined,
    deps: {
      storage: new NodeFileStorage(),
      logger: console,
    },
  };
}

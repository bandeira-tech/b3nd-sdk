/**
 * Browser Adapter for Wallet Server
 *
 * Provides browser-compatible implementations for running a wallet server
 * in simulation/demo mode using in-memory or localStorage storage.
 */

import type { Environment, FileStorage } from "../interfaces.ts";
import { ConfigEnvironment, MemoryFileStorage } from "../interfaces.ts";
import { LocalStorageClient } from "../../clients/local-storage/mod.ts";
import type { ServerKeys, WalletServerConfig } from "../types.ts";
import { WalletServerCore } from "../core.ts";

/**
 * Browser localStorage-backed file storage
 */
export class BrowserLocalStorageFileStorage implements FileStorage {
  constructor(private keyPrefix: string = "b3nd-wallet-files:") {}

  async readTextFile(path: string): Promise<string> {
    const content = localStorage.getItem(this.keyPrefix + path);
    if (content === null) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    localStorage.setItem(this.keyPrefix + path, content);
  }

  async exists(path: string): Promise<boolean> {
    return localStorage.getItem(this.keyPrefix + path) !== null;
  }
}

/**
 * Re-export memory-based implementations for convenience
 */
export { MemoryFileStorage as BrowserMemoryStorage } from "../interfaces.ts";
export { ConfigEnvironment as BrowserEnvironment } from "../interfaces.ts";

/**
 * Options for creating a browser wallet server
 */
export interface BrowserWalletServerOptions {
  /** Server keys (required) */
  serverKeys: ServerKeys;

  /** JWT secret (required, must be 32+ chars) */
  jwtSecret: string;

  /** Use localStorage for persistence (default: false = in-memory) */
  useLocalStorage?: boolean;

  /** Key prefix for localStorage (default: "b3nd-wallet-") */
  localStoragePrefix?: string;

  /** JWT expiration in seconds (default: 86400) */
  jwtExpirationSeconds?: number;

  /** Allowed origins (default: ["*"]) */
  allowedOrigins?: string[];

  /** Google OAuth client ID (optional) */
  googleClientId?: string;
}

/**
 * Create a browser-compatible wallet server for simulation/testing
 *
 * This creates a fully functional wallet server that runs in the browser
 * using LocalStorageClient as the backend. Useful for:
 * - Demo applications
 * - Testing without a real backend
 * - Offline-first applications
 *
 * @example
 * ```typescript
 * import { createBrowserWalletServer, generateBrowserServerKeys } from "@b3nd/sdk/wallet-server/adapters/browser";
 *
 * const serverKeys = await generateBrowserServerKeys();
 * const server = createBrowserWalletServer({
 *   serverKeys,
 *   jwtSecret: "your-32-character-minimum-secret!!",
 *   useLocalStorage: true,
 * });
 *
 * // Use with fetch API
 * const response = await server.getFetchHandler()(new Request("/api/v1/health"));
 * ```
 */
export function createBrowserWalletServer(
  options: BrowserWalletServerOptions,
): WalletServerCore {
  const prefix = options.localStoragePrefix ?? "b3nd-wallet-";

  // Create storage based on preference
  const storage = options.useLocalStorage
    ? new BrowserLocalStorageFileStorage(prefix + "files:")
    : new MemoryFileStorage();

  // Create LocalStorageClient as the credential and proxy backend
  const client = new LocalStorageClient({
    keyPrefix: prefix + "data:",
  });

  const config: WalletServerConfig = {
    serverKeys: options.serverKeys,
    jwtSecret: options.jwtSecret,
    jwtExpirationSeconds: options.jwtExpirationSeconds ?? 86400,
    allowedOrigins: options.allowedOrigins ?? ["*"],
    googleClientId: options.googleClientId,
    deps: {
      storage,
      logger: console,
      credentialClient: client,
      proxyClient: client,
    },
  };

  return new WalletServerCore(config);
}

/**
 * Generate server keys in the browser
 *
 * Creates Ed25519 (identity) and X25519 (encryption) key pairs
 * using the Web Crypto API.
 */
export async function generateBrowserServerKeys(): Promise<ServerKeys> {
  // Generate Ed25519 identity key pair
  const identityKeyPair = (await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  // Generate X25519 encryption key pair
  const encryptionKeyPair = (await crypto.subtle.generateKey(
    { name: "X25519", namedCurve: "X25519" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;

  // Export keys
  const identityPrivateKeyBuffer = await crypto.subtle.exportKey(
    "pkcs8",
    identityKeyPair.privateKey,
  );
  const identityPublicKeyBuffer = await crypto.subtle.exportKey(
    "raw",
    identityKeyPair.publicKey,
  );

  const encryptionPrivateKeyBuffer = await crypto.subtle.exportKey(
    "pkcs8",
    encryptionKeyPair.privateKey,
  );
  const encryptionPublicKeyBuffer = await crypto.subtle.exportKey(
    "raw",
    encryptionKeyPair.publicKey,
  );

  // Convert to PEM and hex
  const bytesToBase64 = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes));

  const bytesToHex = (bytes: Uint8Array): string =>
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const toPem = (buffer: ArrayBuffer): string => {
    const base64 = bytesToBase64(new Uint8Array(buffer));
    return `-----BEGIN PRIVATE KEY-----\n${
      base64.match(/.{1,64}/g)?.join("\n")
    }\n-----END PRIVATE KEY-----`;
  };

  return {
    identityKey: {
      privateKeyPem: toPem(identityPrivateKeyBuffer),
      publicKeyHex: bytesToHex(new Uint8Array(identityPublicKeyBuffer)),
    },
    encryptionKey: {
      privateKeyPem: toPem(encryptionPrivateKeyBuffer),
      publicKeyHex: bytesToHex(new Uint8Array(encryptionPublicKeyBuffer)),
    },
  };
}

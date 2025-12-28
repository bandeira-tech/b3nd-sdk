/**
 * Wallet Server Types
 *
 * Type definitions for the universal wallet server SDK.
 */

import type { NodeProtocolInterface } from "../src/types.ts";
import type { FileStorage, Logger, HttpFetch } from "./interfaces.ts";

/**
 * Server key pair configuration
 */
export interface ServerKeyPair {
  privateKeyPem: string;
  publicKeyHex: string;
}

/**
 * Server keys configuration (identity + encryption)
 */
export interface ServerKeys {
  identityKey: ServerKeyPair;
  encryptionKey: ServerKeyPair;
}

/**
 * App backend configuration for bootstrap
 */
export interface AppBackendConfig {
  url: string;
  apiBasePath?: string;
}

/**
 * Dependency injection configuration
 */
export interface WalletServerDeps {
  /** File storage for bootstrap state persistence */
  storage?: FileStorage;
  /** Logger for output */
  logger?: Logger;
  /** Custom fetch implementation */
  fetch?: HttpFetch;
  /** Pre-configured credential client (alternative to credentialNodeUrl) */
  credentialClient?: NodeProtocolInterface;
  /** Pre-configured proxy client (alternative to proxyNodeUrl) */
  proxyClient?: NodeProtocolInterface;
}

/**
 * Wallet server configuration
 */
export interface WalletServerConfig {
  /** Server identity and encryption keys */
  serverKeys: ServerKeys;

  /** JWT secret for token signing (must be 32+ characters) */
  jwtSecret: string;

  /** JWT expiration in seconds (default: 86400 = 24 hours) */
  jwtExpirationSeconds?: number;

  /** URL of the credential backend node */
  credentialNodeUrl?: string;

  /** URL of the proxy backend node */
  proxyNodeUrl?: string;

  /** CORS allowed origins (default: ["*"]) */
  allowedOrigins?: string[];

  /** App backend for bootstrap (optional) */
  appBackend?: AppBackendConfig;

  /** Password reset token TTL in seconds (default: 3600 = 1 hour) */
  passwordResetTokenTtlSeconds?: number;

  /** Google OAuth client ID (optional, enables Google auth) */
  googleClientId?: string;

  /** Path for bootstrap state file (optional) */
  bootstrapStatePath?: string;

  /** Dependency injection */
  deps?: WalletServerDeps;
}

/**
 * Resolved configuration with defaults applied
 */
export interface ResolvedWalletServerConfig {
  serverKeys: ServerKeys;
  jwtSecret: string;
  jwtExpirationSeconds: number;
  allowedOrigins: string[];
  passwordResetTokenTtlSeconds: number;
  googleClientId: string | null;
  bootstrapStatePath: string | null;
  appBackend: AppBackendConfig | null;
}

/**
 * User keys structure
 */
export interface UserKeys {
  accountKey: ServerKeyPair;
  encryptionKey: ServerKeyPair;
}

/**
 * Proxy write request
 */
export interface ProxyWriteRequest {
  uri: string;
  data: unknown;
  encrypt?: boolean;
}

/**
 * Proxy write response
 */
export interface ProxyWriteResponse {
  success: boolean;
  resolvedUri?: string;
  error?: string;
  record?: {
    data: unknown;
    ts: number;
  };
}

/**
 * Proxy read response
 */
export interface ProxyReadResponse {
  success: boolean;
  error?: string;
  record?: {
    data: unknown;
    ts: number;
  };
  decrypted?: unknown;
}

/**
 * Auth session response
 */
export interface AuthSessionResponse {
  success: boolean;
  username: string;
  token: string;
  expiresIn: number;
  error?: string;
  // Google OAuth metadata
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * Public keys response
 */
export interface PublicKeysResponse {
  success: boolean;
  accountPublicKeyHex?: string;
  encryptionPublicKeyHex?: string;
  error?: string;
}

/**
 * Health response
 */
export interface HealthResponse {
  success: boolean;
  status: string;
  server: string;
  timestamp: string;
}

/**
 * Server keys response
 */
export interface ServerKeysResponse {
  success: boolean;
  identityPublicKeyHex: string;
  encryptionPublicKeyHex: string;
}

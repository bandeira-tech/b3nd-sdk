/**
 * @b3nd/sdk/wallet-server
 *
 * Universal wallet server that works in Deno, Node.js, and browsers.
 * Provides authentication, key management, and write proxying with encryption.
 *
 * @example Deno
 * ```typescript
 * import { WalletServerCore } from "@b3nd/sdk/wallet-server";
 * import { loadConfigFromEnv, DenoFileStorage } from "@b3nd/sdk/wallet-server/adapters/deno";
 *
 * const config = loadConfigFromEnv();
 * const server = new WalletServerCore(config);
 *
 * Deno.serve({ port: 8843, handler: server.getFetchHandler() });
 * ```
 *
 * @example Node.js
 * ```typescript
 * import { WalletServerCore } from "@b3nd/sdk/wallet-server";
 * import { loadConfigFromEnv } from "@b3nd/sdk/wallet-server/adapters/node";
 * import { serve } from "@hono/node-server";
 *
 * const config = loadConfigFromEnv();
 * const server = new WalletServerCore(config);
 *
 * serve({ fetch: server.getFetchHandler(), port: 8843 });
 * ```
 *
 * @example Browser (simulation)
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

// Main export
export { WalletServerCore } from "./core.ts";

// Types
export type {
  WalletServerConfig,
  WalletServerDeps,
  ResolvedWalletServerConfig,
  ServerKeys,
  ServerKeyPair,
  AppBackendConfig,
  UserKeys,
  ProxyWriteRequest,
  ProxyWriteResponse,
  ProxyReadResponse,
  AuthSessionResponse,
  PublicKeysResponse,
  HealthResponse,
  ServerKeysResponse,
} from "./types.ts";

// Interfaces for dependency injection
export type {
  FileStorage,
  Environment,
  Logger,
  HttpFetch,
} from "./interfaces.ts";

export {
  defaultLogger,
  MemoryFileStorage,
  ConfigEnvironment,
} from "./interfaces.ts";

// JWT utilities
export { createJwt, verifyJwt, extractUsernameFromJwt } from "./jwt.ts";
export type { JwtPayload } from "./jwt.ts";

// Proxy utilities
export { proxyWrite, proxyRead } from "./proxy.ts";

// Key management
export {
  generateUserKeys,
  loadUserKeys,
  loadUserAccountKey,
  loadUserEncryptionKey,
  getUserPublicKeys,
} from "./keys.ts";

// Authentication
export {
  createUser,
  authenticateUser,
  changePassword,
  createPasswordResetToken,
  resetPasswordWithToken,
  userExists,
  createGoogleUser,
  authenticateGoogleUser,
  googleUserExists,
} from "./auth.ts";

// Credentials system
export {
  getCredentialHandler,
  registerCredentialHandler,
  getSupportedCredentialTypes,
} from "./credentials.ts";

export type {
  CredentialHandler,
  CredentialContext,
  CredentialResult,
  CredentialPayload,
  BaseCredentialPayload,
  PasswordCredentialPayload,
  GoogleCredentialPayload,
} from "./credentials.ts";

// Google OAuth
export {
  verifyGoogleIdToken,
  generateGoogleUsername,
  clearGooglePublicKeyCache,
} from "./google-oauth.ts";

export type { GoogleTokenPayload } from "./google-oauth.ts";

// Obfuscation utilities
export {
  deriveObfuscatedPath,
  createSignedEncryptedPayload,
  decryptSignedEncryptedPayload,
  encryptForBackend,
  decryptFromBackend,
  pemToCryptoKey,
} from "./obfuscation.ts";

export type { OperationType } from "./obfuscation.ts";

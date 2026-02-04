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
  AppBackendConfig,
  AuthSessionResponse,
  HealthResponse,
  ProxyReadResponse,
  ProxyWriteRequest,
  ProxyWriteResponse,
  PublicKeysResponse,
  ResolvedWalletServerConfig,
  ServerKeyPair,
  ServerKeys,
  ServerKeysResponse,
  UserKeys,
  WalletServerConfig,
  WalletServerDeps,
} from "./types.ts";

// Interfaces for dependency injection
export type {
  Environment,
  FileStorage,
  HttpFetch,
  Logger,
} from "./interfaces.ts";

export {
  ConfigEnvironment,
  defaultLogger,
  MemoryFileStorage,
} from "./interfaces.ts";

// JWT utilities
export { createJwt, extractUsernameFromJwt, verifyJwt } from "./jwt.ts";
export type { JwtPayload } from "./jwt.ts";

// Proxy utilities
export { proxyRead, proxyWrite } from "./proxy.ts";

// Key management
export {
  generateUserKeys,
  getUserPublicKeys,
  loadUserAccountKey,
  loadUserEncryptionKey,
  loadUserKeys,
} from "./keys.ts";

// Authentication
export {
  authenticateGoogleUser,
  authenticateUser,
  changePassword,
  createGoogleUser,
  createPasswordResetToken,
  createUser,
  googleUserExists,
  resetPasswordWithToken,
  userExists,
} from "./auth.ts";

// Credentials system
export {
  getCredentialHandler,
  getSupportedCredentialTypes,
  registerCredentialHandler,
} from "./credentials.ts";

export type {
  BaseCredentialPayload,
  CredentialContext,
  CredentialHandler,
  CredentialPayload,
  CredentialResult,
  GoogleCredentialPayload,
  PasswordCredentialPayload,
} from "./credentials.ts";

// Google OAuth
export {
  clearGooglePublicKeyCache,
  generateGoogleUsername,
  verifyGoogleIdToken,
} from "./google-oauth.ts";

export type { GoogleTokenPayload } from "./google-oauth.ts";

// Obfuscation utilities
export {
  createSignedEncryptedPayload,
  decryptFromBackend,
  decryptSignedEncryptedPayload,
  deriveObfuscatedPath,
  encryptForBackend,
  pemToCryptoKey,
} from "./obfuscation.ts";

export type { OperationType } from "./obfuscation.ts";

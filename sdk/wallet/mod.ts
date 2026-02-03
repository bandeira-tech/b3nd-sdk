/**
 * @b3nd/sdk/wallet
 *
 * Wallet client for interacting with B3nd wallet servers.
 * Provides authentication, key management, and write proxying functionality.
 *
 * @example
 * ```typescript
 * import { WalletClient } from "@b3nd/sdk/wallet";
 *
 * const wallet = new WalletClient({
 *   walletServerUrl: "http://localhost:3001",
 *   apiBasePath: "/api/v1",
 * });
 *
 * // App-scoped signup/login (requires approved session keypair)
 * // const session = await wallet.signup(appKey, sessionKeypair, { username, password });
 * // const session = await wallet.login(appKey, sessionKeypair, { username, password });
 *
 * // Activate session
 * wallet.setSession(session);
 *
 * // Write data (with optional encryption)
 * await wallet.proxyWrite({
 *   uri: "mutable://data/my-app/profile",
 *   data: { name: "Alice" },
 *   encrypt: true
 * });
 *
 * // Read data (with automatic decryption)
 * const result = await wallet.proxyRead({
 *   uri: "mutable://data/my-app/profile"
 * });
 * console.log(result.decrypted); // Decrypted data
 * ```
 */

// Export main client
export { generateSessionKeypair, WalletClient } from "./client.ts";

// Export in-memory client for testing
export { generateTestServerKeys, MemoryWalletClient } from "./memory-client.ts";
export type { MemoryWalletClientConfig } from "./memory-client.ts";

// Export test utilities
export { createTestEnvironment } from "./testing.ts";
export type { TestEnvironment, TestEnvironmentConfig } from "./testing.ts";

// Export all types
export type {
  ApiResponse,
  AuthSession,
  ChangePasswordResponse,
  GoogleAuthSession,
  GoogleLoginResponse,
  GoogleSignupResponse,
  HealthResponse,
  LoginResponse,
  PasswordResetToken,
  ProxyReadMultiRequest,
  ProxyReadMultiResponse,
  ProxyReadMultiResultItem,
  ProxyReadRequest,
  ProxyReadResponse,
  ProxyWriteRequest,
  ProxyWriteResponse,
  PublicKeysResponse,
  RequestPasswordResetResponse,
  ResetPasswordResponse,
  SessionKeypair,
  SignupResponse,
  UserCredentials,
  UserPublicKeys,
  WalletClientConfig,
  WalletClientInterface,
} from "./types.ts";

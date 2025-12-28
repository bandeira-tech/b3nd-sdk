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
 * // App-scoped signup/login (requires app token and session)
 * // const session = await wallet.signupWithToken(appKey, { username, password });
 * // const session = await wallet.loginWithTokenSession(appKey, sessionKey, { username, password });
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
export { WalletClient } from "./client.ts";

// Export in-memory client for testing
export { MemoryWalletClient, generateTestServerKeys } from "./memory-client.ts";
export type { MemoryWalletClientConfig } from "./memory-client.ts";

// Export all types
export type {
  WalletClientConfig,
  UserCredentials,
  AuthSession,
  UserPublicKeys,
  PasswordResetToken,
  ProxyWriteRequest,
  ProxyWriteResponse,
  ProxyReadRequest,
  ProxyReadResponse,
  ApiResponse,
  SignupResponse,
  LoginResponse,
  PublicKeysResponse,
  ChangePasswordResponse,
  RequestPasswordResetResponse,
  ResetPasswordResponse,
  HealthResponse,
  GoogleAuthSession,
  GoogleSignupResponse,
  GoogleLoginResponse,
} from "./types.ts";

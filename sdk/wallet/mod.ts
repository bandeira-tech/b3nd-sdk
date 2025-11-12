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
 * // Sign up
 * const session = await wallet.signup({
 *   username: "alice",
 *   password: "secure-password"
 * });
 *
 * // Activate session
 * wallet.setSession(session);
 *
 * // Write data
 * await wallet.proxyWrite({
 *   uri: "mutable://data/my-app/profile",
 *   data: { name: "Alice" }
 * });
 * ```
 */

// Export main client
export { WalletClient } from "./client.ts";

// Export all types
export type {
  WalletClientConfig,
  UserCredentials,
  AuthSession,
  UserPublicKeys,
  PasswordResetToken,
  ProxyWriteRequest,
  ProxyWriteResponse,
  ApiResponse,
  SignupResponse,
  LoginResponse,
  PublicKeysResponse,
  ChangePasswordResponse,
  RequestPasswordResetResponse,
  ResetPasswordResponse,
  HealthResponse,
} from "./types.ts";

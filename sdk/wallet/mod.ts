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
 * // const session = await wallet.signupWithToken(appKey, token, { username, password });
 * // const session = await wallet.loginWithTokenSession(appKey, token, sessionKey, { username, password });
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
  GoogleAuthSession,
  GoogleSignupResponse,
  GoogleLoginResponse,
} from "./types.ts";

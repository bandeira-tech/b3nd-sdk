/**
 * Wallet Client Types
 *
 * Type definitions for the B3nd Wallet Client that interacts with wallet servers.
 */

/**
 * Common interface for wallet clients (WalletClient and MemoryWalletClient)
 *
 * Implement this interface to create custom wallet clients or use
 * for dependency injection in tests.
 *
 * @example
 * ```typescript
 * function setupApp(wallet: WalletClientInterface) {
 *   // Works with both WalletClient and MemoryWalletClient
 *   await wallet.proxyWrite({ uri: "...", data: {...} });
 * }
 *
 * // Production
 * setupApp(new WalletClient({ walletServerUrl: "...", apiBasePath: "/api/v1" }));
 *
 * // Tests
 * setupApp(await MemoryWalletClient.create());
 * ```
 */
export interface WalletClientInterface {
  // Session management
  getSession(): AuthSession | null;
  setSession(session: AuthSession | null): void;
  isAuthenticated(): boolean;
  getUsername(): string | null;
  getToken(): string | null;
  logout(): void;

  // Health & server info
  health(): Promise<HealthResponse>;
  getServerKeys(): Promise<
    { identityPublicKeyHex: string; encryptionPublicKeyHex: string }
  >;

  // Authentication
  /**
   * Signup with session keypair.
   * Session must be approved by app at mutable://accounts/{appKey}/sessions/{sessionPubkey} = 1
   */
  signup(
    appKey: string,
    session: SessionKeypair,
    credentials: UserCredentials,
  ): Promise<AuthSession>;
  /**
   * Login with session keypair.
   * Session must be approved by app at mutable://accounts/{appKey}/sessions/{sessionPubkey} = 1
   */
  login(
    appKey: string,
    session: SessionKeypair,
    credentials: UserCredentials,
  ): Promise<AuthSession>;

  // Password management
  changePassword(
    appKey: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void>;
  requestPasswordResetWithToken(
    appKey: string,
    tokenOrUsername: string,
    maybeUsername?: string,
  ): Promise<PasswordResetToken>;
  resetPasswordWithToken(
    appKey: string,
    tokenOrUsername: string,
    usernameOrReset: string,
    resetToken?: string,
    newPassword?: string,
  ): Promise<AuthSession>;

  // Public keys
  getPublicKeys(appKey: string): Promise<UserPublicKeys>;
  getMyPublicKeys(appKey: string): Promise<UserPublicKeys>;

  // Proxy operations
  proxyWrite(request: ProxyWriteRequest): Promise<ProxyWriteResponse>;
  proxyRead(request: ProxyReadRequest): Promise<ProxyReadResponse>;
  proxyReadMulti(
    request: ProxyReadMultiRequest,
  ): Promise<ProxyReadMultiResponse>;
}

/**
 * Configuration for wallet client
 */
export interface WalletClientConfig {
  /**
   * Wallet server URL (e.g., "http://localhost:3001")
   */
  walletServerUrl: string;

  /**
   * API base path prefix (e.g., "/api/v1"). Must be provided explicitly.
   */
  apiBasePath: string;

  /**
   * Optional fetch implementation (for custom HTTP handling)
   */
  fetch?: typeof fetch;
}

/**
 * Password-based credentials
 */
export interface PasswordCredentials {
  type: "password";
  username: string;
  password: string;
}

/**
 * Google OAuth credentials
 */
export interface GoogleCredentials {
  type: "google";
  googleIdToken: string;
}

/**
 * User credentials for authentication (discriminated union)
 * Use `type` field to distinguish between authentication methods.
 */
export type UserCredentials = PasswordCredentials | GoogleCredentials;

/**
 * Session keypair for authentication
 * Sessions are Ed25519 keypairs. The client creates the session, requests
 * approval from the app, then uses the private key to sign login requests.
 */
export interface SessionKeypair {
  /** Session public key (hex encoded) - used as session identifier */
  publicKeyHex: string;
  /** Session private key (hex encoded) - used to sign login requests */
  privateKeyHex: string;
}

export interface SignupWithTokenRequest {
  appKey: string;
  session: SessionKeypair;
  credentials: UserCredentials;
}

export interface LoginWithTokenRequest {
  appKey: string;
  session: SessionKeypair;
  credentials: UserCredentials;
}

/**
 * Authenticated session with JWT token
 * For Google auth, includes optional profile fields.
 */
export interface AuthSession {
  username: string;
  token: string;
  expiresIn: number;
  /** Present when auth type is 'google' */
  email?: string;
  /** Present when auth type is 'google' */
  name?: string;
  /** Present when auth type is 'google' */
  picture?: string;
}

/**
 * User's public keys
 */
export interface UserPublicKeys {
  accountPublicKeyHex: string;
  encryptionPublicKeyHex: string;
}

/**
 * Password reset token
 */
export interface PasswordResetToken {
  resetToken: string;
  expiresIn: number;
}

/**
 * Write proxy request
 */
export interface ProxyWriteRequest {
  uri: string;
  data: unknown;
  encrypt?: boolean;
}

/**
 * Write proxy response
 */
export interface ProxyWriteResponse {
  success: boolean;
  uri: string; // The original URI as sent by the client
  resolvedUri?: string; // The actual URI after :key resolution
  data: unknown;
  record?: {
    data: unknown;
    ts: number;
  };
}

/**
 * Read proxy request
 */
export interface ProxyReadRequest {
  uri: string;
}

/**
 * Read proxy response
 */
export interface ProxyReadResponse {
  success: boolean;
  uri: string;
  record?: {
    data: unknown;
    ts: number;
  };
  decrypted?: unknown; // Decrypted data if encryption was detected
  error?: string;
}

/**
 * Read-multi proxy request
 */
export interface ProxyReadMultiRequest {
  uris: string[];
}

/**
 * Read-multi proxy result item
 */
export interface ProxyReadMultiResultItem {
  uri: string;
  success: boolean;
  record?: {
    data: unknown;
    ts: number;
  };
  decrypted?: unknown;
  error?: string;
}

/**
 * Read-multi proxy response
 */
export interface ProxyReadMultiResponse {
  success: boolean;
  results: ProxyReadMultiResultItem[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
  error?: string;
}

/**
 * API response wrapper
 */
export interface ApiResponse {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Signup response
 */
export interface SignupResponse extends ApiResponse {
  username: string;
  token: string;
  expiresIn: number;
}

/**
 * Login response
 */
export interface LoginResponse extends ApiResponse {
  username: string;
  token: string;
  expiresIn: number;
}

/**
 * Public keys response
 */
export interface PublicKeysResponse extends ApiResponse {
  accountPublicKeyHex: string;
  encryptionPublicKeyHex: string;
}

/**
 * Change password response
 */
export interface ChangePasswordResponse extends ApiResponse {
  message: string;
}

/**
 * Request password reset response
 */
export interface RequestPasswordResetResponse extends ApiResponse {
  message: string;
  resetToken: string;
  expiresIn: number;
}

/**
 * Reset password response
 */
export interface ResetPasswordResponse extends ApiResponse {
  message: string;
  username: string;
  token: string;
  expiresIn: number;
}

/**
 * Health check response
 */
export interface HealthResponse extends ApiResponse {
  status: string;
  server: string;
  timestamp: string;
}

/**
 * Server keys response
 */
export interface ServerKeysResponse extends ApiResponse {
  identityPublicKeyHex: string;
  encryptionPublicKeyHex: string;
}

/**
 * Google OAuth session
 * @deprecated Use AuthSession directly - Google profile fields are now optional on AuthSession
 */
export type GoogleAuthSession = AuthSession;

/**
 * Google signup response
 */
export interface GoogleSignupResponse extends ApiResponse {
  username: string;
  email: string;
  name?: string;
  picture?: string;
  token: string;
  expiresIn: number;
}

/**
 * Google login response
 */
export interface GoogleLoginResponse extends ApiResponse {
  username: string;
  email: string;
  name?: string;
  picture?: string;
  token: string;
  expiresIn: number;
}

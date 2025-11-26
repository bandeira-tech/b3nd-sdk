/**
 * Wallet Client Types
 *
 * Type definitions for the B3nd Wallet Client that interacts with wallet servers.
 */

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
 * User credentials for authentication
 */
export interface UserCredentials {
  username: string;
  password: string;
}

export interface SignupWithTokenRequest {
  appKey: string;
  credentials: UserCredentials;
}

export interface LoginWithTokenRequest {
  appKey: string;
  session: string;
  credentials: UserCredentials;
}

/**
 * Authenticated session with JWT token
 */
export interface AuthSession {
  username: string;
  token: string;
  expiresIn: number;
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
 * API response wrapper
 */
export interface ApiResponse<T = unknown> {
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
 * Google OAuth session (extended AuthSession with Google profile info)
 */
export interface GoogleAuthSession extends AuthSession {
  email: string;
  name?: string;
  picture?: string;
}

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

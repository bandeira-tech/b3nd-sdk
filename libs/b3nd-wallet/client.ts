/**
 * B3nd Wallet Client
 *
 * Client library for interacting with B3nd wallet servers.
 * Provides authentication, key management, and write proxying functionality.
 *
 * Works in both Deno and browser environments.
 */

import type {
  AuthSession,
  ChangePasswordResponse,
  HealthResponse,
  PasswordResetToken,
  ProxyReadMultiRequest,
  ProxyReadMultiResponse,
  ProxyReadRequest,
  ProxyReadResponse,
  ProxyWriteRequest,
  ProxyWriteResponse,
  PublicKeysResponse,
  RequestPasswordResetResponse,
  ResetPasswordResponse,
  ServerKeysResponse,
  SessionKeypair,
  UserCredentials,
  UserPublicKeys,
  WalletClientConfig,
} from "./types.ts";
import {
  createAuthenticatedMessageWithHex,
  generateSigningKeyPair,
} from "../b3nd-encrypt/mod.ts";

/**
 * B3nd Wallet Client
 *
 * Manages authentication with a wallet server and provides methods
 * for user management, key retrieval, and proxied writes.
 *
 * @example
 * ```typescript
 * const wallet = new WalletClient({
 *   walletServerUrl: "http://localhost:3001",
 *   apiBasePath: "/api/v1",
 * });
 *
 * // Sign up a new user
 * const session = await wallet.signup({
 *   username: "alice",
 *   password: "secure-password-123"
 * });
 *
 * // Activate the session
 * wallet.setSession(session);
 *
 * // Write data through proxy
 * await wallet.proxyWrite({
 *   uri: "mutable://data/my-app/profile",
 *   data: { name: "Alice" },
 *   encrypt: true
 * });
 * ```
 */
export class WalletClient {
  private walletServerUrl: string;
  private apiBasePath: string;
  private fetchImpl: typeof fetch;
  private currentSession: AuthSession | null = null;

  constructor(config: WalletClientConfig) {
    this.walletServerUrl = config.walletServerUrl.replace(/\/$/, ""); // Remove trailing slash
    // Require explicit API base path (e.g., "/api/v1"). Do not default.
    if (!config.apiBasePath || typeof config.apiBasePath !== "string") {
      throw new Error("apiBasePath is required (e.g., '/api/v1')");
    }
    // Normalize apiBasePath to start with "/" and have no trailing slash
    const normalized =
      (config.apiBasePath.startsWith("/")
        ? config.apiBasePath
        : `/${config.apiBasePath}`).replace(/\/$/, "");
    this.apiBasePath = normalized;
    if (config.fetch) {
      this.fetchImpl = config.fetch;
    } else if (
      typeof window !== "undefined" && typeof window.fetch === "function"
    ) {
      // Bind to window to avoid Safari "Can only call Window.fetch on instances of Window"
      this.fetchImpl = window.fetch.bind(window);
    } else {
      this.fetchImpl = fetch;
    }
  }

  private buildUrl(path: string): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${this.walletServerUrl}${this.apiBasePath}${normalized}`;
  }

  private buildAppKeyUrl(path: string, appKey: string): string {
    if (!appKey || typeof appKey !== "string") {
      throw new Error("appKey is required");
    }
    return `${this.buildUrl(path)}/${appKey}`;
  }

  /**
   * Get the current authenticated session
   */
  getSession(): AuthSession | null {
    return this.currentSession;
  }

  /**
   * Set the current session (useful for restoring from storage)
   */
  setSession(session: AuthSession | null): void {
    this.currentSession = session;
  }

  /**
   * Check if user is currently authenticated
   */
  isAuthenticated(): boolean {
    return this.currentSession !== null;
  }

  /**
   * Get current username (if authenticated)
   */
  getUsername(): string | null {
    return this.currentSession?.username || null;
  }

  /**
   * Get current JWT token (if authenticated)
   */
  getToken(): string | null {
    return this.currentSession?.token || null;
  }

  /**
   * Clear current session (logout)
   */
  logout(): void {
    this.currentSession = null;
  }

  /**
   * Check wallet server health
   */
  async health(): Promise<HealthResponse> {
    const response = await this.fetchImpl(
      `${this.walletServerUrl}${this.apiBasePath}/health`,
    );

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Change password for current user
   * Requires active authentication session
   */
  async changePassword(
    appKey: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!this.currentSession) {
      throw new Error("Not authenticated. Please login first.");
    }

    const response = await this.fetchImpl(
      this.buildAppKeyUrl("/auth/credentials/change-password", appKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.currentSession.token}`,
        },
        body: JSON.stringify({
          oldPassword,
          newPassword,
        }),
      },
    );

    const data: ChangePasswordResponse = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.error || `Change password failed: ${response.statusText}`,
      );
    }
  }

  /**
   * Request a password reset token
   * Does not require authentication
   */
  async requestPasswordReset(_username: string): Promise<PasswordResetToken> {
    throw new Error("Use requestPasswordResetWithToken(appKey, username)");
  }

  /**
   * Reset password using a reset token
   * Returns session data - call setSession() to activate it
   */
  async resetPassword(
    _username: string,
    _resetToken: string,
    _newPassword: string,
  ): Promise<AuthSession> {
    throw new Error(
      "Use resetPasswordWithToken(appKey, username, resetToken, newPassword)",
    );
  }

  /**
   * Sign up with session keypair (scoped to an app)
   *
   * The session must be approved by the app beforehand:
   * 1. Client writes request to: immutable://inbox/{appKey}/sessions/{sessionPubkey} = 1
   * 2. App approves by writing: mutable://accounts/{appKey}/sessions/{sessionPubkey} = 1
   * 3. Client calls this method with the session keypair
   *
   * @param appKey - The app's public key
   * @param session - Session keypair (generated via generateSessionKeypair)
   * @param credentials - User credentials (password or Google)
   */
  async signup(
    appKey: string,
    session: SessionKeypair,
    credentials: UserCredentials,
  ): Promise<AuthSession> {
    if (!session?.publicKeyHex || !session?.privateKeyHex) {
      throw new Error("session keypair is required");
    }

    // Build the authenticated message using standard SDK format
    const message = await createAuthenticatedMessageWithHex(
      credentials,
      session.publicKeyHex,
      session.privateKeyHex,
    );

    const response = await this.fetchImpl(
      this.buildAppKeyUrl("/auth/signup", appKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Signup failed: ${response.statusText}`);
    }

    // Build response - include Google fields if present
    const result: AuthSession = {
      username: data.username,
      token: data.token,
      expiresIn: data.expiresIn,
    };

    if (data.email) result.email = data.email;
    if (data.name) result.name = data.name;
    if (data.picture) result.picture = data.picture;

    return result;
  }

  /**
   * Login with session keypair (scoped to an app)
   *
   * The session must be approved by the app beforehand:
   * 1. Client writes request to: immutable://inbox/{appKey}/sessions/{sessionPubkey} = 1
   * 2. App approves by writing: mutable://accounts/{appKey}/sessions/{sessionPubkey} = 1
   * 3. Client calls this method with the session keypair
   *
   * @param appKey - The app's public key
   * @param session - Session keypair (generated via generateSessionKeypair)
   * @param credentials - User credentials (password or Google)
   */
  async login(
    appKey: string,
    session: SessionKeypair,
    credentials: UserCredentials,
  ): Promise<AuthSession> {
    if (!session?.publicKeyHex || !session?.privateKeyHex) {
      throw new Error("session keypair is required");
    }

    // Build the authenticated message using standard SDK format
    const message = await createAuthenticatedMessageWithHex(
      credentials,
      session.publicKeyHex,
      session.privateKeyHex,
    );

    const response = await this.fetchImpl(
      this.buildAppKeyUrl("/auth/login", appKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Login failed: ${response.statusText}`);
    }

    // Build response - include Google fields if present
    const result: AuthSession = {
      username: data.username,
      token: data.token,
      expiresIn: data.expiresIn,
    };

    if (data.email) result.email = data.email;
    if (data.name) result.name = data.name;
    if (data.picture) result.picture = data.picture;

    return result;
  }

  /**
   * Request password reset scoped to app token
   */
  async requestPasswordResetWithToken(
    appKey: string,
    tokenOrUsername: string,
    maybeUsername?: string,
  ): Promise<PasswordResetToken> {
    const username = maybeUsername || tokenOrUsername;
    const response = await this.fetchImpl(
      this.buildAppKeyUrl("/auth/credentials/request-password-reset", appKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      },
    );
    const data: RequestPasswordResetResponse = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(
        data.error || `Request password reset failed: ${response.statusText}`,
      );
    }
    return { resetToken: data.resetToken, expiresIn: data.expiresIn };
  }

  /**
   * Reset password scoped to an app
   */
  async resetPasswordWithToken(
    appKey: string,
    _tokenOrUsername: string,
    usernameOrReset: string,
    resetToken?: string,
    newPassword?: string,
  ): Promise<AuthSession> {
    const username = usernameOrReset;
    if (!resetToken || !newPassword) {
      throw new Error("resetToken and newPassword are required");
    }
    const response = await this.fetchImpl(
      this.buildAppKeyUrl("/auth/credentials/reset-password", appKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, resetToken, newPassword }),
      },
    );
    const data: ResetPasswordResponse = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(
        data.error || `Reset password failed: ${response.statusText}`,
      );
    }
    return {
      username: data.username,
      token: data.token,
      expiresIn: data.expiresIn,
    };
  }

  /**
   * Get public keys for the current authenticated user.
   * Requires an active authentication session.
   */
  async getPublicKeys(appKey: string): Promise<UserPublicKeys> {
    if (!this.currentSession) {
      throw new Error("Not authenticated. Please login first.");
    }

    if (!appKey || typeof appKey !== "string") {
      throw new Error("appKey is required");
    }

    const response = await this.fetchImpl(
      this.buildAppKeyUrl("/auth/public-keys", appKey),
      {
        headers: {
          Authorization: `Bearer ${this.currentSession.token}`,
        },
      },
    );

    const data: PublicKeysResponse = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.error || `Get public keys failed: ${response.statusText}`,
      );
    }

    return {
      accountPublicKeyHex: data.accountPublicKeyHex,
      encryptionPublicKeyHex: data.encryptionPublicKeyHex,
    };
  }

  /**
   * Proxy a write request through the wallet server
   * The server signs the write with its identity key
   * Requires active authentication session
   *
   * @returns ProxyWriteResponse - check `success` field for result
   */
  async proxyWrite(request: ProxyWriteRequest): Promise<ProxyWriteResponse> {
    if (!this.currentSession) {
      throw new Error("Not authenticated. Please login first.");
    }

    const response = await this.fetchImpl(
      `${this.walletServerUrl}${this.apiBasePath}/proxy/write`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.currentSession.token}`,
        },
        body: JSON.stringify({
          uri: request.uri,
          data: request.data,
          encrypt: request.encrypt,
        }),
      },
    );

    const data: ProxyWriteResponse = await response.json();

    // Return the response directly - let caller check success
    // This enables error checking without try/catch
    return data;
  }

  /**
   * Proxy a read request through the wallet server
   * The server decrypts encrypted data using user's encryption key
   * Requires active authentication session
   *
   * @returns ProxyReadResponse - check `success` field for result, `decrypted` for decrypted data
   */
  async proxyRead(request: ProxyReadRequest): Promise<ProxyReadResponse> {
    if (!this.currentSession) {
      throw new Error("Not authenticated. Please login first.");
    }

    const url = new URL(
      `${this.walletServerUrl}${this.apiBasePath}/proxy/read`,
    );
    url.searchParams.set("uri", request.uri);

    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.currentSession.token}`,
      },
    });

    const data: ProxyReadResponse = await response.json();

    // Return the response directly - let caller check success
    // This enables error checking without try/catch
    return data;
  }

  /**
   * Proxy multiple read requests through the wallet server
   * Reads multiple URIs in a single request (max 50 URIs)
   * The server decrypts encrypted data using user's encryption key
   * Requires active authentication session
   *
   * @returns ProxyReadMultiResponse - check `success` for overall result, `results` for per-URI results
   */
  async proxyReadMulti(
    request: ProxyReadMultiRequest,
  ): Promise<ProxyReadMultiResponse> {
    if (!this.currentSession) {
      throw new Error("Not authenticated. Please login first.");
    }

    const response = await this.fetchImpl(
      `${this.walletServerUrl}${this.apiBasePath}/proxy/read-multi`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.currentSession.token}`,
        },
        body: JSON.stringify({ uris: request.uris }),
      },
    );

    return await response.json();
  }

  /**
   * Convenience method: Get current user's public keys
   * Requires active authentication session
   */
  async getMyPublicKeys(appKey: string): Promise<UserPublicKeys> {
    return this.getPublicKeys(appKey);
  }

  /**
   * Get server's public keys
   *
   * @returns Server's identity and encryption public keys
   * @throws Error if request fails
   */
  async getServerKeys(): Promise<{
    identityPublicKeyHex: string;
    encryptionPublicKeyHex: string;
  }> {
    const response = await this.fetchImpl(
      `${this.walletServerUrl}${this.apiBasePath}/server-keys`,
    );

    if (!response.ok) {
      throw new Error(`Failed to get server keys: ${response.statusText}`);
    }

    const data = (await response.json()) as ServerKeysResponse;

    if (!data.success) {
      throw new Error(data.error || "Failed to get server keys");
    }

    return {
      identityPublicKeyHex: data.identityPublicKeyHex,
      encryptionPublicKeyHex: data.encryptionPublicKeyHex,
    };
  }
}

/**
 * Generate a new session keypair for authentication
 * The public key should be registered with the app before login.
 *
 * Uses SDK crypto for consistent key generation across the codebase.
 *
 * @returns SessionKeypair with publicKeyHex and privateKeyHex
 */
export async function generateSessionKeypair(): Promise<SessionKeypair> {
  // Use SDK's generateSigningKeyPair for consistent crypto implementation
  const keyPair = await generateSigningKeyPair();

  return {
    publicKeyHex: keyPair.publicKeyHex,
    privateKeyHex: keyPair.privateKeyHex,
  };
}

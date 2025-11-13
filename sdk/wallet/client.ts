/**
 * B3nd Wallet Client
 *
 * Client library for interacting with B3nd wallet servers.
 * Provides authentication, key management, and write proxying functionality.
 *
 * Works in both Deno and browser environments.
 */

import type {
  WalletClientConfig,
  UserCredentials,
  AuthSession,
  UserPublicKeys,
  PasswordResetToken,
  ProxyWriteRequest,
  ProxyWriteResponse,
  SignupResponse,
  LoginResponse,
  PublicKeysResponse,
  ChangePasswordResponse,
  RequestPasswordResetResponse,
  ResetPasswordResponse,
  HealthResponse,
  ServerKeysResponse,
} from "./types.ts";

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
    const normalized = (config.apiBasePath.startsWith("/") ? config.apiBasePath : `/${config.apiBasePath}`).replace(/\/$/, "");
    this.apiBasePath = normalized;
    this.fetchImpl = config.fetch || fetch;
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
    const response = await this.fetchImpl(`${this.walletServerUrl}${this.apiBasePath}/health`);

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Sign up a new user
   * Returns session data - call setSession() to activate it
   */
  // Tokenless signup is not supported. Use signup(token,...)
  async signup(_credentials: UserCredentials): Promise<AuthSession> {
    throw new Error("Use signup(token, credentials) — app token required");
  }

  /**
   * Login existing user
   * Returns session data - call setSession() to activate it
   */
  // Tokenless login is not supported. Use login(token, session, credentials)
  async login(_credentials: UserCredentials): Promise<AuthSession> {
    throw new Error("Use login(token, session, credentials) — app token + session required");
  }

  /**
   * Change password for current user
   * Requires active authentication session
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (!this.currentSession) {
      throw new Error("Not authenticated. Please login first.");
    }

    const response = await this.fetchImpl(
      `${this.walletServerUrl}${this.apiBasePath}/auth/change-password`,
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
      }
    );

    const data: ChangePasswordResponse = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || `Change password failed: ${response.statusText}`);
    }
  }

  /**
   * Request a password reset token
   * Does not require authentication
   */
  async requestPasswordReset(_username: string): Promise<PasswordResetToken> {
    throw new Error("Use requestPasswordResetWithToken(token, username)");
  }

  /**
   * Reset password using a reset token
   * Returns session data - call setSession() to activate it
   */
  async resetPassword(_username: string, _resetToken: string, _newPassword: string): Promise<AuthSession> {
    throw new Error("Use resetPasswordWithToken(token, username, resetToken, newPassword)");
  }

  /**
   * Sign up with app token (scoped to an app)
   */
  async signupWithToken(token: string, credentials: UserCredentials): Promise<AuthSession> {
    if (!token) throw new Error("token is required");
    const response = await this.fetchImpl(`${this.walletServerUrl}${this.apiBasePath}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, username: credentials.username, password: credentials.password }),
    });
    const data: SignupResponse = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Signup failed: ${response.statusText}`);
    }
    return { username: data.username, token: data.token, expiresIn: data.expiresIn };
  }

  /**
   * Login with app token and session (scoped to an app)
   */
  async loginWithTokenSession(token: string, session: string, credentials: UserCredentials): Promise<AuthSession> {
    if (!token) throw new Error("token is required");
    if (!session) throw new Error("session is required");
    const response = await this.fetchImpl(`${this.walletServerUrl}${this.apiBasePath}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, session, username: credentials.username, password: credentials.password }),
    });
    const data: LoginResponse = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Login failed: ${response.statusText}`);
    }
    return { username: data.username, token: data.token, expiresIn: data.expiresIn };
  }

  /**
   * Request password reset scoped to app token
   */
  async requestPasswordResetWithToken(token: string, username: string): Promise<PasswordResetToken> {
    if (!token) throw new Error("token is required");
    const response = await this.fetchImpl(`${this.walletServerUrl}${this.apiBasePath}/auth/request-password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, username }),
    });
    const data: RequestPasswordResetResponse = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Request password reset failed: ${response.statusText}`);
    }
    return { resetToken: data.resetToken, expiresIn: data.expiresIn };
  }

  /**
   * Reset password scoped to app token
   */
  async resetPasswordWithToken(token: string, username: string, resetToken: string, newPassword: string): Promise<AuthSession> {
    if (!token) throw new Error("token is required");
    const response = await this.fetchImpl(`${this.walletServerUrl}${this.apiBasePath}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, username, resetToken, newPassword }),
    });
    const data: ResetPasswordResponse = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Reset password failed: ${response.statusText}`);
    }
    return { username: data.username, token: data.token, expiresIn: data.expiresIn };
  }

  /**
   * Get public keys for the current authenticated user.
   * Requires an active authentication session.
   */
  async getPublicKeys(): Promise<UserPublicKeys> {
    if (!this.currentSession) {
      throw new Error("Not authenticated. Please login first.");
    }

    const response = await this.fetchImpl(
      `${this.walletServerUrl}${this.apiBasePath}/public-keys`,
      {
        headers: {
          Authorization: `Bearer ${this.currentSession.token}`,
        },
      }
    );

    const data: PublicKeysResponse = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || `Get public keys failed: ${response.statusText}`);
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
   */
  async proxyWrite(request: ProxyWriteRequest): Promise<ProxyWriteResponse> {
    if (!this.currentSession) {
      throw new Error("Not authenticated. Please login first.");
    }

    const response = await this.fetchImpl(`${this.walletServerUrl}${this.apiBasePath}/proxy/write`, {
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
    });

    const data: ProxyWriteResponse = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        (data as any).error || `Proxy write failed: ${response.statusText}`
      );
    }

    return data;
  }

  /**
   * Convenience method: Get current user's public keys
   * Requires active authentication session
   */
  async getMyPublicKeys(): Promise<UserPublicKeys> {
    return this.getPublicKeys();
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
    const response = await this.fetchImpl(`${this.walletServerUrl}${this.apiBasePath}/server-keys`);

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

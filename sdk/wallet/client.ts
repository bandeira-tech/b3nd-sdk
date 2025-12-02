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
  GoogleAuthSession,
  GoogleSignupResponse,
  GoogleLoginResponse,
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
    if (config.fetch) {
      this.fetchImpl = config.fetch;
    } else if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
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
  async changePassword(appKey: string, oldPassword: string, newPassword: string): Promise<void> {
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
    throw new Error("Use requestPasswordResetWithToken(appKey, username)");
  }

  /**
   * Reset password using a reset token
   * Returns session data - call setSession() to activate it
   */
  async resetPassword(_username: string, _resetToken: string, _newPassword: string): Promise<AuthSession> {
    throw new Error("Use resetPasswordWithToken(appKey, username, resetToken, newPassword)");
  }

  /**
   * Sign up with app token (scoped to an app)
   */
  async signupWithToken(
    appKey: string,
    tokenOrCredentials: string | UserCredentials,
    maybeCredentials?: UserCredentials,
  ): Promise<AuthSession> {
    const credentials = (typeof tokenOrCredentials === "string" ? maybeCredentials : tokenOrCredentials) as
      | UserCredentials
      | undefined;
    if (!credentials) throw new Error("credentials are required");
    const response = await this.fetchImpl(this.buildAppKeyUrl("/auth/signup", appKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: typeof tokenOrCredentials === "string" ? tokenOrCredentials : undefined,
        type: "password",
        username: credentials.username,
        password: credentials.password,
      }),
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
  async loginWithTokenSession(
    appKey: string,
    tokenOrSession: string,
    sessionOrCredentials: string | UserCredentials,
    maybeCredentials?: UserCredentials,
  ): Promise<AuthSession> {
    const session = typeof sessionOrCredentials === "string" && maybeCredentials ? sessionOrCredentials : tokenOrSession;
    const credentials = (maybeCredentials || sessionOrCredentials) as UserCredentials;
    if (!session || typeof session !== "string") throw new Error("session is required");
    const response = await this.fetchImpl(this.buildAppKeyUrl("/auth/login", appKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: typeof tokenOrSession === "string" && maybeCredentials ? tokenOrSession : undefined,
        session,
        type: "password",
        username: credentials.username,
        password: credentials.password,
      }),
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
  async requestPasswordResetWithToken(appKey: string, tokenOrUsername: string, maybeUsername?: string): Promise<PasswordResetToken> {
    const username = maybeUsername || tokenOrUsername;
    const response = await this.fetchImpl(this.buildAppKeyUrl("/auth/credentials/request-password-reset", appKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data: RequestPasswordResetResponse = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Request password reset failed: ${response.statusText}`);
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
    const response = await this.fetchImpl(this.buildAppKeyUrl("/auth/credentials/reset-password", appKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, resetToken, newPassword }),
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

  /**
   * Sign up with Google OAuth (scoped to app token)
   * Returns session data with Google profile info - call setSession() to activate it
   *
   * @param token - App token from app server
   * @param googleIdToken - Google ID token from Google Sign-In
   * @returns GoogleAuthSession with username, JWT token, and Google profile info
   */
  async signupWithGoogle(appKey: string, token: string, googleIdToken: string): Promise<GoogleAuthSession> {
    if (!token) throw new Error("token is required");
    if (!googleIdToken) throw new Error("googleIdToken is required");

    const response = await this.fetchImpl(this.buildAppKeyUrl("/auth/signup", appKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, type: "google", googleIdToken }),
    });

    const data: GoogleSignupResponse = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Google signup failed: ${response.statusText}`);
    }

    return {
      username: data.username,
      token: data.token,
      expiresIn: data.expiresIn,
      email: data.email,
      name: data.name,
      picture: data.picture,
    };
  }

  /**
   * Login with Google OAuth (scoped to app token and session)
   * Returns session data with Google profile info - call setSession() to activate it
   *
   * @param token - App token from app server
   * @param session - Session key from app server
   * @param googleIdToken - Google ID token from Google Sign-In
   * @returns GoogleAuthSession with username, JWT token, and Google profile info
   */
  async loginWithGoogle(appKey: string, token: string, session: string, googleIdToken: string): Promise<GoogleAuthSession> {
    if (!token) throw new Error("token is required");
    if (!session) throw new Error("session is required");
    if (!googleIdToken) throw new Error("googleIdToken is required");

    const response = await this.fetchImpl(this.buildAppKeyUrl("/auth/login", appKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, session, type: "google", googleIdToken }),
    });

    const data: GoogleLoginResponse = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Google login failed: ${response.statusText}`);
    }

    return {
      username: data.username,
      token: data.token,
      expiresIn: data.expiresIn,
      email: data.email,
      name: data.name,
      picture: data.picture,
    };
  }
}

/**
 * Memory Wallet Client
 *
 * In-memory implementation of the wallet client for testing.
 * Embeds WalletServerCore with MemoryClient storage - no HTTP required.
 *
 * Same interface as WalletClient, so you can swap between them:
 *
 * @example
 * ```typescript
 * // Production
 * const backend = new HttpClient({ baseUrl: "http://localhost:8842" });
 * const wallet = new WalletClient({
 *   walletServerUrl: "http://localhost:8843",
 *   apiBasePath: "/api/v1"
 * });
 *
 * // Tests - share same backend between wallet and direct operations
 * const backend = new MemoryClient({ schema: { "mutable://accounts": ... } });
 * const wallet = await MemoryWalletClient.create({ backend });
 *
 * // Same API works for both
 * await wallet.signupWithToken(appKey, { username: "alice", password: "secret" });
 * await wallet.proxyWrite({ uri: "mutable://data/test", data: { foo: "bar" } });
 *
 * // Direct backend access in tests
 * const result = await backend.read("mutable://accounts/...");
 * ```
 */

import type {
  AuthSession,
  UserCredentials,
  SessionKeypair,
  UserPublicKeys,
  PasswordResetToken,
  ProxyWriteRequest,
  ProxyWriteResponse,
  ProxyReadRequest,
  ProxyReadResponse,
  ProxyReadMultiRequest,
  ProxyReadMultiResponse,
  HealthResponse,
} from "./types.ts";

import type { NodeProtocolInterface } from "../src/types.ts";
import { WalletServerCore } from "../wallet-server/core.ts";
import type { WalletServerConfig, ServerKeys } from "../wallet-server/types.ts";
import { MemoryClient } from "../clients/memory/mod.ts";
import {
  generateSigningKeyPair,
  generateEncryptionKeyPair,
  exportPrivateKeyPem,
  signWithHex,
} from "../encrypt/mod.ts";

export interface MemoryWalletClientConfig {
  /**
   * Optional server keys. If not provided, keys are auto-generated.
   */
  serverKeys?: ServerKeys;

  /**
   * Optional JWT secret. Defaults to a test secret.
   */
  jwtSecret?: string;

  /**
   * Optional JWT expiration in seconds. Defaults to 3600 (1 hour).
   */
  jwtExpirationSeconds?: number;

  /**
   * Shared backend storage (e.g., MemoryClient).
   * Use this to share the same storage between wallet and direct operations.
   * If not provided, a new MemoryClient is created.
   *
   * @example
   * ```typescript
   * const backend = new MemoryClient({ schema: { ... } });
   * const wallet = await MemoryWalletClient.create({ backend });
   *
   * // Both use the same storage
   * await backend.write("mutable://accounts/...", data);
   * await wallet.proxyWrite({ uri: "mutable://...", data });
   * ```
   */
  backend?: NodeProtocolInterface;
}

/**
 * Generate server keys for testing
 */
export async function generateTestServerKeys(): Promise<ServerKeys> {
  const identityKeyPair = await generateSigningKeyPair();
  const encryptionKeyPair = await generateEncryptionKeyPair();

  const identityPrivateKeyPem = await exportPrivateKeyPem(
    identityKeyPair.privateKey,
    "PRIVATE KEY"
  );

  // Export encryption private key
  const encryptionPrivateKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", encryptionKeyPair.privateKey)
  );
  const encryptionBase64 = btoa(
    String.fromCharCode(...encryptionPrivateKeyBytes)
  );
  const encryptionPrivateKeyPem = `-----BEGIN PRIVATE KEY-----\n${encryptionBase64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----`;

  return {
    identityKey: {
      privateKeyPem: identityPrivateKeyPem,
      publicKeyHex: identityKeyPair.publicKeyHex,
    },
    encryptionKey: {
      privateKeyPem: encryptionPrivateKeyPem,
      publicKeyHex: encryptionKeyPair.publicKeyHex,
    },
  };
}

/**
 * Create a MemoryClient configured for wallet server use
 */
function createWalletMemoryClient(): MemoryClient {
  return new MemoryClient({
    schema: {
      "immutable://accounts": async () => ({ valid: true }),
      "mutable://accounts": async () => ({ valid: true }),
    },
  });
}

/**
 * Memory Wallet Client
 *
 * In-memory implementation that embeds WalletServerCore.
 * Use for testing without running a real server.
 */
export class MemoryWalletClient {
  private server: WalletServerCore;
  private handler: (request: Request) => Response | Promise<Response>;
  private currentSession: AuthSession | null = null;
  private apiBasePath = "/api/v1";

  private constructor(server: WalletServerCore) {
    this.server = server;
    this.handler = server.getFetchHandler();
  }

  /**
   * Create a new MemoryWalletClient
   * Use this factory method instead of constructor (async key generation)
   */
  static async create(config: MemoryWalletClientConfig = {}): Promise<MemoryWalletClient> {
    const serverKeys = config.serverKeys || (await generateTestServerKeys());
    const backend = config.backend || createWalletMemoryClient();

    const serverConfig: WalletServerConfig = {
      serverKeys,
      jwtSecret: config.jwtSecret || "test-jwt-secret-for-memory-wallet-client!!",
      jwtExpirationSeconds: config.jwtExpirationSeconds || 3600,
      deps: {
        credentialClient: backend,
        proxyClient: backend,
        logger: {
          log: () => {},
          warn: () => {},
          error: () => {},
        },
      },
    };

    const server = new WalletServerCore(serverConfig);
    return new MemoryWalletClient(server);
  }

  /**
   * Make a request to the embedded server
   */
  private async request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<Response> {
    const url = `http://memory-wallet${this.apiBasePath}${path}`;
    const requestHeaders: Record<string, string> = {
      ...headers,
    };

    if (body) {
      requestHeaders["Content-Type"] = "application/json";
    }

    const request = new Request(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    return await this.handler(request);
  }

  /**
   * Make an authenticated request
   */
  private async authRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    if (!this.currentSession) {
      throw new Error("Not authenticated. Please login first.");
    }
    return this.request(method, path, body, {
      Authorization: `Bearer ${this.currentSession.token}`,
    });
  }

  // ============================================================
  // Session Management (same as WalletClient)
  // ============================================================

  getSession(): AuthSession | null {
    return this.currentSession;
  }

  setSession(session: AuthSession | null): void {
    this.currentSession = session;
  }

  isAuthenticated(): boolean {
    return this.currentSession !== null;
  }

  getUsername(): string | null {
    return this.currentSession?.username || null;
  }

  getToken(): string | null {
    return this.currentSession?.token || null;
  }

  logout(): void {
    this.currentSession = null;
  }

  // ============================================================
  // Health & Server Info
  // ============================================================

  async health(): Promise<HealthResponse> {
    const response = await this.request("GET", "/health");
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }
    return await response.json();
  }

  async getServerKeys(): Promise<{
    identityPublicKeyHex: string;
    encryptionPublicKeyHex: string;
  }> {
    const response = await this.request("GET", "/server-keys");
    if (!response.ok) {
      throw new Error(`Failed to get server keys: ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "Failed to get server keys");
    }
    return {
      identityPublicKeyHex: data.identityPublicKeyHex,
      encryptionPublicKeyHex: data.encryptionPublicKeyHex,
    };
  }

  // ============================================================
  // Authentication
  // ============================================================

  /**
   * Sign up with session keypair (scoped to an app)
   *
   * The session must be approved by the app beforehand:
   * 1. Client writes request to: immutable://inbox/{appKey}/sessions/{sessionPubkey}
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

    // Build the payload based on credential type
    let payloadToSign: Record<string, unknown>;

    if (credentials.type === 'password') {
      payloadToSign = {
        sessionPubkey: session.publicKeyHex,
        type: 'password',
        username: credentials.username,
        password: credentials.password,
      };
    } else if (credentials.type === 'google') {
      payloadToSign = {
        sessionPubkey: session.publicKeyHex,
        type: 'google',
        googleIdToken: credentials.googleIdToken,
      };
    } else {
      throw new Error(`Unknown credential type: ${(credentials as { type: string }).type}`);
    }

    // Sign the payload with session private key using SDK crypto
    const sessionSignature = await signWithHex(session.privateKeyHex, payloadToSign);

    const response = await this.request("POST", `/auth/signup/${appKey}`, {
      ...payloadToSign,
      sessionSignature,
    });

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

    // Build the payload based on credential type
    let payloadToSign: Record<string, unknown>;

    if (credentials.type === 'password') {
      payloadToSign = {
        sessionPubkey: session.publicKeyHex,
        type: 'password',
        username: credentials.username,
        password: credentials.password,
      };
    } else if (credentials.type === 'google') {
      payloadToSign = {
        sessionPubkey: session.publicKeyHex,
        type: 'google',
        googleIdToken: credentials.googleIdToken,
      };
    } else {
      throw new Error(`Unknown credential type: ${(credentials as { type: string }).type}`);
    }

    // Sign the payload with session private key using SDK crypto
    const sessionSignature = await signWithHex(session.privateKeyHex, payloadToSign);

    const response = await this.request("POST", `/auth/login/${appKey}`, {
      ...payloadToSign,
      sessionSignature,
    });

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

  // ============================================================
  // Password Management
  // ============================================================

  async changePassword(appKey: string, oldPassword: string, newPassword: string): Promise<void> {
    const response = await this.authRequest(
      "POST",
      `/auth/credentials/change-password/${appKey}`,
      { oldPassword, newPassword }
    );

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Change password failed: ${response.statusText}`);
    }
  }

  async requestPasswordReset(_username: string): Promise<PasswordResetToken> {
    throw new Error("Use requestPasswordResetWithToken(appKey, username)");
  }

  async resetPassword(
    _username: string,
    _resetToken: string,
    _newPassword: string
  ): Promise<AuthSession> {
    throw new Error("Use resetPasswordWithToken(appKey, username, resetToken, newPassword)");
  }

  async requestPasswordResetWithToken(
    appKey: string,
    tokenOrUsername: string,
    maybeUsername?: string
  ): Promise<PasswordResetToken> {
    const username = maybeUsername || tokenOrUsername;
    const response = await this.request(
      "POST",
      `/auth/credentials/request-password-reset/${appKey}`,
      { username }
    );

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Request password reset failed: ${response.statusText}`);
    }

    return {
      resetToken: data.resetToken,
      expiresIn: data.expiresIn,
    };
  }

  async resetPasswordWithToken(
    appKey: string,
    _tokenOrUsername: string,
    usernameOrReset: string,
    resetToken?: string,
    newPassword?: string
  ): Promise<AuthSession> {
    const username = usernameOrReset;
    if (!resetToken || !newPassword) {
      throw new Error("resetToken and newPassword are required");
    }

    const response = await this.request(
      "POST",
      `/auth/credentials/reset-password/${appKey}`,
      { username, resetToken, newPassword }
    );

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Reset password failed: ${response.statusText}`);
    }

    return {
      username: data.username,
      token: data.token,
      expiresIn: data.expiresIn,
    };
  }

  // ============================================================
  // Public Keys
  // ============================================================

  async getPublicKeys(appKey: string): Promise<UserPublicKeys> {
    if (!appKey || typeof appKey !== "string") {
      throw new Error("appKey is required");
    }

    const response = await this.authRequest("GET", `/auth/public-keys/${appKey}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || `Get public keys failed: ${response.statusText}`);
    }

    return {
      accountPublicKeyHex: data.accountPublicKeyHex,
      encryptionPublicKeyHex: data.encryptionPublicKeyHex,
    };
  }

  async getMyPublicKeys(appKey: string): Promise<UserPublicKeys> {
    return this.getPublicKeys(appKey);
  }

  // ============================================================
  // Proxy Operations
  // ============================================================

  async proxyWrite(request: ProxyWriteRequest): Promise<ProxyWriteResponse> {
    const response = await this.authRequest("POST", "/proxy/write", {
      uri: request.uri,
      data: request.data,
      encrypt: request.encrypt,
    });

    const data = await response.json() as ProxyWriteResponse;

    // Return the response directly - let caller check success
    // This matches the type signature and enables error checking without try/catch
    return data;
  }

  async proxyRead(request: ProxyReadRequest): Promise<ProxyReadResponse> {
    const url = `/proxy/read?uri=${encodeURIComponent(request.uri)}`;
    const response = await this.authRequest("GET", url);

    const data = await response.json() as ProxyReadResponse;

    // Return the response directly - let caller check success
    // This matches the type signature and enables error checking without try/catch
    return data;
  }

  async proxyReadMulti(request: ProxyReadMultiRequest): Promise<ProxyReadMultiResponse> {
    const response = await this.authRequest("POST", "/proxy/read-multi", {
      uris: request.uris,
    });

    return await response.json() as ProxyReadMultiResponse;
  }

  // ============================================================
  // Testing Utilities
  // ============================================================

  /**
   * Get the underlying WalletServerCore (for testing/inspection)
   */
  getServer(): WalletServerCore {
    return this.server;
  }

  /**
   * Get server's public keys directly (convenience method)
   */
  getServerPublicKeys(): { identityPublicKeyHex: string; encryptionPublicKeyHex: string } {
    return this.server.getServerKeys();
  }
}

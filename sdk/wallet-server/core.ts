/**
 * Wallet Server Core
 *
 * Universal wallet server that works in Deno, Node.js, and browsers.
 * Uses dependency injection for all runtime-specific operations.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";

import { HttpClient } from "../clients/http/mod.ts";
import type { NodeProtocolInterface } from "../src/types.ts";
import { createAuthenticatedMessage } from "../encrypt/mod.ts";

import type {
  FileStorage,
  Logger,
  HttpFetch,
} from "./interfaces.ts";
import { defaultLogger, MemoryFileStorage } from "./interfaces.ts";
import type {
  WalletServerConfig,
  ResolvedWalletServerConfig,
  ServerKeys,
} from "./types.ts";

import { createJwt, verifyJwt } from "./jwt.ts";
import { getUserPublicKeys } from "./keys.ts";
import { proxyWrite, proxyRead, proxyReadMulti } from "./proxy.ts";
import { pemToCryptoKey } from "./obfuscation.ts";
import { verify as verifySignature } from "../encrypt/mod.ts";
import {
  changePassword,
  createPasswordResetToken,
  resetPasswordWithToken,
} from "./auth.ts";
import {
  type CredentialContext,
  type CredentialPayload,
  getCredentialHandler,
  getSupportedCredentialTypes,
} from "./credentials.ts";

interface BootstrapState {
  appKey: string;
  createdAt: string;
  appServerUrl: string;
  apiBasePath: string;
}

/**
 * Wallet Server Core
 *
 * Creates a portable Hono application that can be served by any runtime.
 */
export class WalletServerCore {
  private config: ResolvedWalletServerConfig;
  private serverKeys: ServerKeys;
  private credentialClient: NodeProtocolInterface;
  private proxyClient: NodeProtocolInterface;
  private app: Hono;
  private logger: Logger;
  private storage: FileStorage;
  private fetchImpl: HttpFetch;

  constructor(userConfig: WalletServerConfig) {
    // Validate required fields
    this.validateConfig(userConfig);

    // Store server keys
    this.serverKeys = userConfig.serverKeys;

    // Apply defaults
    this.config = this.applyDefaults(userConfig);

    // Resolve dependencies
    this.logger = userConfig.deps?.logger ?? defaultLogger;
    this.storage = userConfig.deps?.storage ?? new MemoryFileStorage();
    this.fetchImpl = userConfig.deps?.fetch ?? fetch;

    // Initialize clients
    this.credentialClient =
      userConfig.deps?.credentialClient ??
      new HttpClient({ url: userConfig.credentialNodeUrl! });
    this.proxyClient =
      userConfig.deps?.proxyClient ??
      new HttpClient({ url: userConfig.proxyNodeUrl! });

    // Create Hono app
    this.app = this.createApp();
  }

  private validateConfig(config: WalletServerConfig): void {
    if (!config.serverKeys?.identityKey?.privateKeyPem) {
      throw new Error("serverKeys.identityKey.privateKeyPem is required");
    }
    if (!config.serverKeys?.identityKey?.publicKeyHex) {
      throw new Error("serverKeys.identityKey.publicKeyHex is required");
    }
    if (!config.serverKeys?.encryptionKey?.privateKeyPem) {
      throw new Error("serverKeys.encryptionKey.privateKeyPem is required");
    }
    if (!config.serverKeys?.encryptionKey?.publicKeyHex) {
      throw new Error("serverKeys.encryptionKey.publicKeyHex is required");
    }
    if (!config.jwtSecret || config.jwtSecret.length < 32) {
      throw new Error("jwtSecret is required and must be at least 32 characters");
    }
    if (
      !config.credentialNodeUrl &&
      !config.deps?.credentialClient
    ) {
      throw new Error(
        "Either credentialNodeUrl or deps.credentialClient is required"
      );
    }
    if (!config.proxyNodeUrl && !config.deps?.proxyClient) {
      throw new Error("Either proxyNodeUrl or deps.proxyClient is required");
    }
  }

  private applyDefaults(
    config: WalletServerConfig
  ): ResolvedWalletServerConfig {
    return {
      serverKeys: config.serverKeys,
      jwtSecret: config.jwtSecret,
      jwtExpirationSeconds: config.jwtExpirationSeconds ?? 86400,
      allowedOrigins: config.allowedOrigins ?? ["*"],
      passwordResetTokenTtlSeconds: config.passwordResetTokenTtlSeconds ?? 3600,
      googleClientId: config.googleClientId ?? null,
      bootstrapStatePath: config.bootstrapStatePath ?? null,
      appBackend: config.appBackend ?? null,
    };
  }

  /**
   * Get the Hono app instance
   */
  getApp(): Hono {
    return this.app;
  }

  /**
   * Get the fetch handler for use with various runtimes
   */
  getFetchHandler(): (request: Request) => Response | Promise<Response> {
    return this.app.fetch.bind(this.app);
  }

  /**
   * Get server public keys
   */
  getServerKeys(): {
    identityPublicKeyHex: string;
    encryptionPublicKeyHex: string;
  } {
    return {
      identityPublicKeyHex: this.serverKeys.identityKey.publicKeyHex,
      encryptionPublicKeyHex: this.serverKeys.encryptionKey.publicKeyHex,
    };
  }

  /**
   * Bootstrap wallet app registration (optional)
   */
  async bootstrap(): Promise<BootstrapState | null> {
    if (!this.config.appBackend) {
      this.logger.warn(
        "App backend not configured; skipping wallet app bootstrap"
      );
      return null;
    }

    const appKey = this.serverKeys.identityKey.publicKeyHex;
    const apiBasePath = this.normalizeApiBasePath(
      this.config.appBackend.apiBasePath ?? "/api/v1"
    );
    const appServerUrl = this.config.appBackend.url.replace(/\/$/, "");

    // Check for existing bootstrap state
    if (this.config.bootstrapStatePath) {
      try {
        const existingState = await this.readBootstrapState(
          this.config.bootstrapStatePath
        );
        if (existingState) {
          if (existingState.appKey !== appKey) {
            throw new Error(
              `Bootstrap state belongs to ${existingState.appKey}, expected ${appKey}`
            );
          }
          return existingState;
        }
      } catch {
        // No existing state, continue with registration
      }
    }

    // Register with app backend
    const bootstrapJwt = await createJwt(
      "__wallet_bootstrap__",
      this.config.jwtSecret,
      this.config.jwtExpirationSeconds
    );

    const signMessage = async (payload: unknown) => {
      const privateKey = await pemToCryptoKey(
        this.serverKeys.identityKey.privateKeyPem,
        "Ed25519"
      );
      return await createAuthenticatedMessage(payload, [
        { privateKey, publicKeyHex: appKey },
      ]);
    };

    // Register origins
    const originsMessage = await signMessage({
      allowedOrigins: this.config.allowedOrigins,
      encryptionPublicKeyHex: this.serverKeys.encryptionKey.publicKeyHex,
    });

    const originsRes = await this.fetchImpl(
      `${appServerUrl}${apiBasePath}/apps/origins/${appKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bootstrapJwt}`,
        },
        body: JSON.stringify(originsMessage),
      }
    );

    const originsBody = await originsRes.json().catch(() => ({}));
    if (!originsRes.ok || !(originsBody as Record<string, unknown>)?.success) {
      throw new Error(
        `Wallet app origins bootstrap failed: ${
          (originsBody as Record<string, unknown>)?.error || originsRes.statusText
        }`
      );
    }

    // Register schema
    const schemaMessage = await signMessage({
      actions: [],
      encryptionPublicKeyHex: this.serverKeys.encryptionKey.publicKeyHex,
    });

    const schemaRes = await this.fetchImpl(
      `${appServerUrl}${apiBasePath}/apps/schema/${appKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bootstrapJwt}`,
        },
        body: JSON.stringify(schemaMessage),
      }
    );

    const schemaBody = await schemaRes.json().catch(() => ({}));
    if (!schemaRes.ok || !(schemaBody as Record<string, unknown>)?.success) {
      throw new Error(
        `Wallet app schema bootstrap failed: ${
          (schemaBody as Record<string, unknown>)?.error || schemaRes.statusText
        }`
      );
    }

    const state: BootstrapState = {
      appKey,
      createdAt: new Date().toISOString(),
      appServerUrl,
      apiBasePath,
    };

    if (this.config.bootstrapStatePath) {
      await this.writeBootstrapState(this.config.bootstrapStatePath, state);
    }

    return state;
  }

  private normalizeApiBasePath(path: string): string {
    if (!path || typeof path !== "string") {
      return "/api/v1";
    }
    const base = path.startsWith("/") ? path : `/${path}`;
    return base.replace(/\/$/, "");
  }

  private async readBootstrapState(path: string): Promise<BootstrapState | null> {
    try {
      const text = await this.storage.readTextFile(path);
      const parsed = JSON.parse(text) as Partial<BootstrapState>;
      if (
        !parsed.appKey ||
        !parsed.createdAt ||
        !parsed.appServerUrl ||
        !parsed.apiBasePath
      ) {
        throw new Error(`Invalid bootstrap state file at ${path}`);
      }
      return parsed as BootstrapState;
    } catch {
      return null;
    }
  }

  private async writeBootstrapState(
    path: string,
    state: BootstrapState
  ): Promise<void> {
    await this.storage.writeTextFile(path, JSON.stringify(state, null, 2));
  }

  /**
   * Validate that a session is approved by the app.
   * Sessions are keypairs - the sessionPubkey is used directly as the identifier.
   * App approves sessions by writing 1 to mutable://accounts/{appKey}/sessions/{sessionPubkey}
   *
   * @param appKey - The app's public key
   * @param sessionPubkey - The session's public key (hex encoded)
   * @returns { valid: true } if approved, { valid: false, reason } if not
   */
  private async sessionExists(
    appKey: string,
    sessionPubkey: string
  ): Promise<{ valid: boolean; reason?: string }> {
    const uri = `mutable://accounts/${appKey}/sessions/${sessionPubkey}`;
    const res = await this.proxyClient.read(uri);

    if (!res.success) {
      return { valid: false, reason: "session_not_approved" };
    }

    // Session status is stored as 1 (approved) or 0 (revoked)
    if (res.record?.data === 1) {
      return { valid: true };
    }

    if (res.record?.data === 0) {
      return { valid: false, reason: "session_revoked" };
    }

    return { valid: false, reason: "invalid_session_status" };
  }

  /**
   * Verify that a login request signature is valid for the given session pubkey.
   * The signature should be over the stringified login payload (without the signature field).
   * Uses SDK crypto for consistent verification across the codebase.
   */
  private async verifySessionSignature(
    sessionPubkey: string,
    signature: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    try {
      // Reconstruct the payload that was signed (without signature and sessionSignature)
      const { sessionSignature: _, ...signedPayload } = payload;

      // Use SDK's verify function for consistent crypto implementation
      return await verifySignature(sessionPubkey, signature, signedPayload);
    } catch (error) {
      this.logger.error("Session signature verification failed:", error);
      return false;
    }
  }

  private createApp(): Hono {
    const app = new Hono();
    const serverPublicKey = this.serverKeys.identityKey.publicKeyHex;
    const serverIdentityPrivateKeyPem = this.serverKeys.identityKey.privateKeyPem;
    const serverIdentityPublicKeyHex = this.serverKeys.identityKey.publicKeyHex;
    const serverEncryptionPublicKeyHex = this.serverKeys.encryptionKey.publicKeyHex;
    const serverEncryptionPrivateKeyPem = this.serverKeys.encryptionKey.privateKeyPem;

    // CORS middleware
    app.use(
      "/*",
      cors({
        origin: (origin) =>
          this.config.allowedOrigins[0] === "*"
            ? origin
            : this.config.allowedOrigins.join(","),
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      })
    );

    // Request logging middleware
    app.use(async (c: Context, next: () => Promise<void>) => {
      const start = Date.now();
      await next();
      const duration = Date.now() - start;
      this.logger.log(
        `[${new Date().toISOString()}] ${c.req.method} ${c.req.path} ${c.res.status} - ${duration}ms`
      );
    });

    // Health check
    app.get("/api/v1/health", (c: Context) => {
      return c.json({
        success: true,
        status: "ok",
        server: "b3nd-wallet-server",
        timestamp: new Date().toISOString(),
      });
    });

    // Server keys
    app.get("/api/v1/server-keys", (c: Context) => {
      return c.json({
        success: true,
        identityPublicKeyHex: serverIdentityPublicKeyHex,
        encryptionPublicKeyHex: serverEncryptionPublicKeyHex,
      });
    });

    // Get user's public keys
    app.get("/api/v1/auth/public-keys/:appKey", async (c: Context) => {
      try {
        const appKey = c.req.param("appKey");
        const authHeader = c.req.header("Authorization");

        if (!appKey) {
          return c.json({ success: false, error: "appKey is required" }, 400);
        }
        if (!authHeader?.startsWith("Bearer ")) {
          return c.json({ success: false, error: "Authorization required" }, 401);
        }

        const token = authHeader.substring(7);
        const payload = await verifyJwt(token, this.config.jwtSecret);

        const keys = await getUserPublicKeys(
          this.credentialClient,
          serverPublicKey,
          payload.username,
          serverEncryptionPrivateKeyPem,
          this.logger
        );

        return c.json({
          success: true,
          accountPublicKeyHex: keys.accountPublicKeyHex,
          encryptionPublicKeyHex: keys.encryptionPublicKeyHex,
        });
      } catch (error) {
        return c.json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }, 400);
      }
    });

    // Verify token
    app.get("/api/v1/auth/verify/:appKey", async (c: Context) => {
      try {
        const appKey = c.req.param("appKey");
        const authHeader = c.req.header("Authorization");

        if (!appKey) {
          return c.json({ success: false, error: "appKey is required" }, 400);
        }
        if (!authHeader?.startsWith("Bearer ")) {
          return c.json({ success: false, error: "Authorization required" }, 401);
        }

        const token = authHeader.substring(7);
        const payload = await verifyJwt(token, this.config.jwtSecret);

        return c.json({
          success: true,
          username: payload.username,
          exp: payload.exp,
        });
      } catch (error) {
        return c.json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }, 401);
      }
    });

    // Signup
    app.post("/api/v1/auth/signup/:appKey", async (c: Context) => {
      try {
        const appKey = c.req.param("appKey");
        const payload = (await c.req.json()) as CredentialPayload & {
          sessionPubkey?: string;
          sessionSignature?: string;
        };

        if (!appKey) {
          return c.json({ success: false, error: "appKey is required" }, 400);
        }
        if (!payload.sessionPubkey) {
          return c.json({ success: false, error: "sessionPubkey is required" }, 400);
        }
        if (!payload.sessionSignature) {
          return c.json({ success: false, error: "sessionSignature is required" }, 400);
        }
        if (!payload.type) {
          return c.json({
            success: false,
            error: `type is required. Supported: ${getSupportedCredentialTypes().join(", ")}`,
          }, 400);
        }

        // Verify session signature (proves client has the session private key)
        const signatureValid = await this.verifySessionSignature(
          payload.sessionPubkey,
          payload.sessionSignature,
          payload as unknown as Record<string, unknown>
        );
        if (!signatureValid) {
          return c.json({ success: false, error: "Invalid session signature" }, 401);
        }

        // Verify session is approved by app (status === 1)
        const sessionResult = await this.sessionExists(appKey, payload.sessionPubkey);
        if (!sessionResult.valid) {
          return c.json({
            success: false,
            error: sessionResult.reason === "session_revoked"
              ? "Session has been revoked"
              : sessionResult.reason === "session_not_approved"
              ? "Session not approved by app"
              : "Invalid session",
          }, 401);
        }

        const handler = getCredentialHandler(payload.type);

        // For Google auth, read app profile
        let googleClientId: string | undefined;
        if (payload.type === "google") {
          const appProfileUri = `mutable://accounts/${appKey}/app-profile`;
          const appProfileResult = await this.credentialClient.read(appProfileUri);
          if (appProfileResult.success && appProfileResult.record?.data) {
            const appProfile = appProfileResult.record.data as Record<string, unknown>;
            if (appProfile.payload && typeof appProfile.payload === "object") {
              googleClientId = (appProfile.payload as Record<string, unknown>).googleClientId as string;
            } else {
              googleClientId = appProfile.googleClientId as string;
            }
          }
          if (!googleClientId) {
            throw new Error("Google Client ID not configured for this app");
          }
        }

        const context: CredentialContext = {
          client: this.credentialClient,
          serverPublicKey,
          serverIdentityPrivateKeyPem,
          serverIdentityPublicKeyHex,
          serverEncryptionPublicKeyHex,
          serverEncryptionPrivateKeyPem,
          appKey,
          googleClientId,
          logger: this.logger,
          fetch: this.fetchImpl,
        };

        const result = await handler.signup(payload, context);

        const jwt = await createJwt(
          result.username,
          this.config.jwtSecret,
          this.config.jwtExpirationSeconds
        );

        return c.json({
          success: true,
          username: result.username,
          token: jwt,
          expiresIn: this.config.jwtExpirationSeconds,
          ...result.metadata,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("already exists") || message.includes("already registered")) {
          return c.json({ success: false, error: message }, 409);
        }
        if (message.includes("Unknown credential type")) {
          return c.json({ success: false, error: message }, 400);
        }
        this.logger.error("Signup error:", error);
        return c.json({ success: false, error: message }, 500);
      }
    });

    // Login
    app.post("/api/v1/auth/login/:appKey", async (c: Context) => {
      try {
        const appKey = c.req.param("appKey");
        const payload = (await c.req.json()) as CredentialPayload & {
          sessionPubkey?: string;
          sessionSignature?: string;
          session?: string; // Legacy field - will be removed
        };

        if (!appKey) {
          return c.json({ success: false, error: "appKey is required" }, 400);
        }
        if (!payload.sessionPubkey) {
          return c.json({ success: false, error: "sessionPubkey is required" }, 400);
        }
        if (!payload.sessionSignature) {
          return c.json({ success: false, error: "sessionSignature is required" }, 400);
        }
        if (!payload.type) {
          return c.json({
            success: false,
            error: `type is required. Supported: ${getSupportedCredentialTypes().join(", ")}`,
          }, 400);
        }

        // Verify session signature (proves client has the session private key)
        const signatureValid = await this.verifySessionSignature(
          payload.sessionPubkey,
          payload.sessionSignature,
          payload as unknown as Record<string, unknown>
        );
        if (!signatureValid) {
          return c.json({ success: false, error: "Invalid session signature" }, 401);
        }

        // Verify session is approved by app (status === 1)
        const sessionResult = await this.sessionExists(appKey, payload.sessionPubkey);
        if (!sessionResult.valid) {
          return c.json({
            success: false,
            error: sessionResult.reason === "session_revoked"
              ? "Session has been revoked"
              : sessionResult.reason === "session_not_approved"
              ? "Session not approved by app"
              : "Invalid session",
          }, 401);
        }

        const handler = getCredentialHandler(payload.type);

        // For Google auth, read app profile
        let googleClientId: string | undefined;
        if (payload.type === "google") {
          const appProfileUri = `mutable://accounts/${appKey}/app-profile`;
          const appProfileResult = await this.credentialClient.read(appProfileUri);
          if (appProfileResult.success && appProfileResult.record?.data) {
            const appProfile = appProfileResult.record.data as Record<string, unknown>;
            if (appProfile.payload && typeof appProfile.payload === "object") {
              googleClientId = (appProfile.payload as Record<string, unknown>).googleClientId as string;
            } else {
              googleClientId = appProfile.googleClientId as string;
            }
          }
          if (!googleClientId) {
            throw new Error("Google Client ID not configured for this app");
          }
        }

        const context: CredentialContext = {
          client: this.credentialClient,
          serverPublicKey,
          serverIdentityPrivateKeyPem,
          serverIdentityPublicKeyHex,
          serverEncryptionPublicKeyHex,
          serverEncryptionPrivateKeyPem,
          appKey,
          googleClientId,
          logger: this.logger,
          fetch: this.fetchImpl,
        };

        const result = await handler.login(payload, context);

        const jwt = await createJwt(
          result.username,
          this.config.jwtSecret,
          this.config.jwtExpirationSeconds
        );

        return c.json({
          success: true,
          username: result.username,
          token: jwt,
          expiresIn: this.config.jwtExpirationSeconds,
          ...result.metadata,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Unknown credential type")) {
          return c.json({ success: false, error: message }, 400);
        }
        this.logger.error("Login error:", error);
        return c.json({ success: false, error: message }, 500);
      }
    });

    // Change password
    app.post("/api/v1/auth/credentials/change-password/:appKey", async (c: Context) => {
      try {
        const appKey = c.req.param("appKey");
        const authHeader = c.req.header("Authorization");

        if (!appKey) {
          return c.json({ success: false, error: "appKey is required" }, 400);
        }
        if (!authHeader?.startsWith("Bearer ")) {
          return c.json({ success: false, error: "Authorization required" }, 401);
        }

        const token = authHeader.substring(7);
        const jwtPayload = await verifyJwt(token, this.config.jwtSecret);

        const { oldPassword, newPassword } = (await c.req.json()) as {
          oldPassword: string;
          newPassword: string;
        };

        if (!oldPassword || !newPassword) {
          return c.json({ success: false, error: "oldPassword and newPassword are required" }, 400);
        }
        if (newPassword.length < 8) {
          return c.json({ success: false, error: "newPassword must be at least 8 characters" }, 400);
        }

        await changePassword(
          this.credentialClient,
          serverPublicKey,
          jwtPayload.username,
          oldPassword,
          newPassword,
          serverIdentityPrivateKeyPem,
          serverIdentityPublicKeyHex,
          serverEncryptionPublicKeyHex,
          serverEncryptionPrivateKeyPem,
          appKey
        );

        return c.json({ success: true, message: "Password changed successfully" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("expired") || message.includes("incorrect")) {
          return c.json({ success: false, error: message }, 401);
        }
        this.logger.error("Change password error:", error);
        return c.json({ success: false, error: message }, 500);
      }
    });

    // Request password reset
    app.post("/api/v1/auth/credentials/request-password-reset/:appKey", async (c: Context) => {
      try {
        const appKey = c.req.param("appKey");
        const { username } = (await c.req.json()) as { username: string };

        if (!appKey) {
          return c.json({ success: false, error: "appKey is required" }, 400);
        }
        if (!username) {
          return c.json({ success: false, error: "username is required" }, 400);
        }

        const resetToken = await createPasswordResetToken(
          this.credentialClient,
          serverPublicKey,
          username,
          this.config.passwordResetTokenTtlSeconds,
          serverIdentityPrivateKeyPem,
          serverIdentityPublicKeyHex,
          serverEncryptionPublicKeyHex,
          appKey
        );

        return c.json({
          success: true,
          message: "Password reset token created",
          resetToken,
          expiresIn: this.config.passwordResetTokenTtlSeconds,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("not found")) {
          return c.json({ success: false, error: "User not found" }, 404);
        }
        this.logger.error("Request password reset error:", error);
        return c.json({ success: false, error: message }, 500);
      }
    });

    // Reset password
    app.post("/api/v1/auth/credentials/reset-password/:appKey", async (c: Context) => {
      try {
        const appKey = c.req.param("appKey");
        const { username, resetToken, newPassword } = (await c.req.json()) as {
          username: string;
          resetToken: string;
          newPassword: string;
        };

        if (!appKey) {
          return c.json({ success: false, error: "appKey is required" }, 400);
        }
        if (!username || !resetToken || !newPassword) {
          return c.json({ success: false, error: "username, resetToken and newPassword are required" }, 400);
        }
        if (newPassword.length < 8) {
          return c.json({ success: false, error: "newPassword must be at least 8 characters" }, 400);
        }

        const resetUsername = await resetPasswordWithToken(
          this.credentialClient,
          serverPublicKey,
          resetToken,
          newPassword,
          serverIdentityPrivateKeyPem,
          serverIdentityPublicKeyHex,
          serverEncryptionPublicKeyHex,
          serverEncryptionPrivateKeyPem,
          username,
          appKey,
          this.logger
        );

        const newToken = await createJwt(
          resetUsername,
          this.config.jwtSecret,
          this.config.jwtExpirationSeconds
        );

        return c.json({
          success: true,
          message: "Password reset successful",
          username: resetUsername,
          token: newToken,
          expiresIn: this.config.jwtExpirationSeconds,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("invalid") || message.includes("expired")) {
          return c.json({ success: false, error: message }, 400);
        }
        this.logger.error("Reset password error:", error);
        return c.json({ success: false, error: message }, 500);
      }
    });

    // Proxy write
    app.post("/api/v1/proxy/write", async (c: Context) => {
      try {
        const authHeader = c.req.header("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return c.json({ success: false, error: "Authorization required" }, 401);
        }

        const token = authHeader.substring(7);
        const payload = await verifyJwt(token, this.config.jwtSecret);

        const { uri, data, encrypt } = (await c.req.json()) as {
          uri: string;
          data: unknown;
          encrypt?: boolean;
        };

        if (!uri) {
          return c.json({ success: false, error: "uri is required" }, 400);
        }
        if (data === undefined) {
          return c.json({ success: false, error: "data is required" }, 400);
        }

        const result = await proxyWrite(
          this.proxyClient,
          this.credentialClient,
          serverPublicKey,
          payload.username,
          serverEncryptionPrivateKeyPem,
          { uri, data, encrypt: encrypt === true }
        );

        if (!result.success) {
          return c.json({ success: false, error: result.error }, 400);
        }

        return c.json({
          success: true,
          uri,
          resolvedUri: result.resolvedUri,
          data,
          record: result.record,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("expired")) {
          return c.json({ success: false, error: message }, 401);
        }
        this.logger.error("Proxy write error:", error);
        return c.json({ success: false, error: message }, 500);
      }
    });

    // Proxy read
    app.get("/api/v1/proxy/read", async (c: Context) => {
      try {
        const authHeader = c.req.header("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return c.json({ success: false, error: "Authorization required" }, 401);
        }

        const token = authHeader.substring(7);
        const payload = await verifyJwt(token, this.config.jwtSecret);

        const uri = c.req.query("uri");
        if (!uri) {
          return c.json({ success: false, error: "uri query parameter is required" }, 400);
        }

        const result = await proxyRead(
          this.proxyClient,
          this.credentialClient,
          serverPublicKey,
          payload.username,
          serverEncryptionPrivateKeyPem,
          uri
        );

        if (!result.success) {
          return c.json({ success: false, error: result.error }, 400);
        }

        return c.json({
          success: true,
          uri: result.uri,
          record: result.record,
          decrypted: result.decrypted,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("expired")) {
          return c.json({ success: false, error: message }, 401);
        }
        this.logger.error("Proxy read error:", error);
        return c.json({ success: false, error: message }, 500);
      }
    });

    // Proxy read-multi (batch read)
    app.post("/api/v1/proxy/read-multi", async (c: Context) => {
      try {
        const authHeader = c.req.header("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return c.json({ success: false, error: "Authorization required" }, 401);
        }

        const token = authHeader.substring(7);
        const payload = await verifyJwt(token, this.config.jwtSecret);

        const body = (await c.req.json()) as { uris?: string[] };

        if (!Array.isArray(body.uris)) {
          return c.json({ success: false, error: "uris must be an array" }, 400);
        }

        const result = await proxyReadMulti(
          this.proxyClient,
          this.credentialClient,
          serverPublicKey,
          payload.username,
          serverEncryptionPrivateKeyPem,
          body.uris
        );

        return c.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("expired")) {
          return c.json({ success: false, error: message }, 401);
        }
        this.logger.error("Proxy read-multi error:", error);
        return c.json({ success: false, error: message }, 500);
      }
    });

    return app;
  }
}

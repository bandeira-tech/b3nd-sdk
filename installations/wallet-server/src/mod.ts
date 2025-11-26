/**
 * B3nd Wallet Server
 *
 * Acts as a key custodian and middleware between web applications and b3nd backends.
 * Users authenticate with username/password and the server manages their keys,
 * signing and encrypting data on their behalf.
 *
 * All data is stored using standard b3nd protocols:
 * - immutable://accounts/{serverPublicKey}/keys/...
 * - mutable://accounts/{serverPublicKey}/users/...
 * - mutable://accounts/{serverPublicKey}/reset-tokens/...
 */

/// <reference lib="deno.ns" />

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HttpClient } from "@b3nd/sdk";
import type { Context } from "hono";
import { createAuthenticatedMessage } from "@b3nd/sdk/encrypt";

import { loadConfig } from "./config.ts";
import { loadServerKeys, signWithServerKey } from "./server-keys.ts";
import {
  changePassword,
  createPasswordResetToken,
  resetPasswordWithToken,
  userExists,
} from "./auth.ts";
import { createJwt, verifyJwt } from "./jwt.ts";
import { getUserPublicKeys } from "./keys.ts";
import { proxyWrite } from "./proxy.ts";
import {
  getCredentialHandler,
  getSupportedCredentialTypes,
  type CredentialPayload,
  type CredentialContext,
} from "./credentials.ts";

interface BootstrapState {
  appKey: string;
  createdAt: string;
  appServerUrl: string;
  apiBasePath: string;
}

function normalizeApiBasePath(path: string): string {
  if (!path || typeof path !== "string") {
    throw new Error("APP_BACKEND_API_BASE_PATH is required");
  }
  const base = path.startsWith("/") ? path : `/${path}`;
  return base.replace(/\/$/, "");
}

async function readBootstrapState(path: string): Promise<BootstrapState | null> {
  try {
    const text = await Deno.readTextFile(path);
    const parsed = JSON.parse(text) as Partial<BootstrapState>;
    if (!parsed.appKey || !parsed.createdAt || !parsed.appServerUrl || !parsed.apiBasePath) {
      throw new Error(`Invalid bootstrap state file at ${path}`);
    }
    return parsed as BootstrapState;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

async function writeBootstrapState(path: string, state: BootstrapState): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(state, null, 2));
}

async function ensureWalletAppRegistered(
  config: ReturnType<typeof loadConfig>,
  serverKeys: ReturnType<typeof loadServerKeys>,
): Promise<BootstrapState | null> {
  if (!config.appBackendUrl) {
    console.warn("⚠️  APP_BACKEND_URL not set; skipping wallet app bootstrap registration");
    return null;
  }

  const normalizedApiBase = normalizeApiBasePath(config.appBackendApiBasePath);
  const appServerUrl = config.appBackendUrl.replace(/\/$/, "");
  const appKey = serverKeys.identityKey.publicKeyHex;

  const existingState = await readBootstrapState(config.bootstrapStatePath);
  if (existingState) {
    if (existingState.appKey !== appKey) {
      throw new Error(
        `Bootstrap state at ${config.bootstrapStatePath} belongs to ${existingState.appKey}, expected ${appKey}`,
      );
    }
    return existingState;
  }

  const bootstrapJwt = await createJwt(
    "__wallet_bootstrap__",
    config.jwtSecret,
    config.jwtExpirationSeconds,
  );

  const signMessage = async (payload: unknown) =>
    await createAuthenticatedMessage(payload, [{
      privateKey: await pemToCryptoKey(serverKeys.identityKey.privateKeyPem, "Ed25519"),
      publicKeyHex: appKey,
    }]);

  const originsMessage = await signMessage({
    allowedOrigins: config.allowedOrigins,
    encryptionPublicKeyHex: serverKeys.encryptionKey.publicKeyHex,
  });
  const originsRes = await fetch(`${appServerUrl}${normalizedApiBase}/apps/origins/${appKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bootstrapJwt}`,
    },
    body: JSON.stringify(originsMessage),
  });
  const originsBody = await originsRes.json().catch(() => ({}));
  if (!originsRes.ok || !originsBody?.success) {
    throw new Error(
      `Wallet app origins bootstrap failed: ${originsBody?.error || originsRes.statusText}`,
    );
  }

  const schemaMessage = await signMessage({
    actions: [] as any[],
    encryptionPublicKeyHex: serverKeys.encryptionKey.publicKeyHex,
  });
  const schemaRes = await fetch(`${appServerUrl}${normalizedApiBase}/apps/schema/${appKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bootstrapJwt}`,
    },
    body: JSON.stringify(schemaMessage),
  });
  const schemaBody = await schemaRes.json().catch(() => ({}));
  if (!schemaRes.ok || !schemaBody?.success) {
    throw new Error(
      `Wallet app schema bootstrap failed: ${schemaBody?.error || schemaRes.statusText}`,
    );
  }

  const state: BootstrapState = {
    appKey,
    createdAt: new Date().toISOString(),
    appServerUrl,
    apiBasePath: normalizedApiBase,
  };
  await writeBootstrapState(config.bootstrapStatePath, state);
  return state;
}

async function pemToCryptoKey(
  pem: string,
  algorithm: "Ed25519" | "X25519" = "Ed25519",
): Promise<CryptoKey> {
  const base64 = pem.split("\n").filter((l) => !l.startsWith("-----")).join("");
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (algorithm === "Ed25519") {
    return await crypto.subtle.importKey("pkcs8", buffer, { name: "Ed25519", namedCurve: "Ed25519" }, false, ["sign"]);
  } else {
    return await crypto.subtle.importKey("pkcs8", buffer, { name: "X25519", namedCurve: "X25519" }, false, ["deriveBits"]);
  }
}

/**
 * Initialize HTTP clients for credential and proxy backends
 */
async function initializeClients(config: ReturnType<typeof loadConfig>) {
  // Credential client - stores user keys and passwords
  const credentialClient = new HttpClient({
    url: config.credentialNodeUrl,
  });

  // Proxy client - where user writes are proxied to
  const proxyClient = new HttpClient({
    url: config.proxyNodeUrl,
  });

  return { credentialClient, proxyClient };
}

/**
 * Create Hono app with auth and proxy routes
 */
function createApp(
  config: ReturnType<typeof loadConfig>,
  credentialClient: any,
  proxyClient: any,
  serverKeys: any,
) {
  const app = new Hono();
  const serverPublicKey = serverKeys.identityKey.publicKeyHex;
  const serverIdentityPrivateKeyPem = serverKeys.identityKey.privateKeyPem;
  const serverIdentityPublicKeyHex = serverKeys.identityKey.publicKeyHex;
  const serverEncryptionPublicKeyHex = serverKeys.encryptionKey.publicKeyHex;
  const serverEncryptionPrivateKeyPem = serverKeys.encryptionKey.privateKeyPem;

  // CORS middleware
  app.use(
    "/*",
    cors({
      origin: (origin) =>
        config.allowedOrigins[0] === "*"
          ? origin
          : config.allowedOrigins.join(","),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // Request logging middleware
  app.use(async (c: Context, next: () => Promise<void>) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(
      `[${
        new Date().toISOString()
      }] ${c.req.method} ${c.req.path} ${c.res.status} - ${duration}ms`,
    );
  });

  /**
   * GET /api/v1/health - Health check
   */
  app.get("/api/v1/health", (c: Context) => {
    return c.json({
      status: "ok",
      server: "b3nd-wallet-server",
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/v1/server-keys - Get server's public keys
   */
  app.get("/api/v1/server-keys", (c: Context) => {
    return c.json({
      success: true,
      identityPublicKeyHex: serverIdentityPublicKeyHex,
      encryptionPublicKeyHex: serverEncryptionPublicKeyHex,
    });
  });

  /**
   * GET /api/v1/auth/public-keys/:appKey - Get current user's public keys (requires auth)
   */
  app.get("/api/v1/auth/public-keys/:appKey", async (c: Context) => {
    try {
      const appKey = c.req.param("appKey");
      const authHeader = c.req.header("Authorization");

      if (!appKey || typeof appKey !== "string") {
        return c.json({ success: false, error: "appKey is required in URL" }, 400);
      }
      if (!authHeader?.startsWith("Bearer ")) {
        return c.json(
          { success: false, error: "Authorization header required" },
          401,
        );
      }

      const token = authHeader.substring(7);
      const payload = await verifyJwt(token, config.jwtSecret);
      const username = payload.username;

      const keys = await getUserPublicKeys(
        credentialClient,
        serverPublicKey,
        username,
        serverEncryptionPrivateKeyPem,
      );

      return c.json({
        success: true,
        accountPublicKeyHex: keys.accountPublicKeyHex,
        encryptionPublicKeyHex: keys.encryptionPublicKeyHex,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });

  /**
   * GET /api/v1/auth/verify/:appKey - Verify JWT and return identity
   * Headers: Authorization: Bearer <jwt>
   */
  app.get("/api/v1/auth/verify/:appKey", async (c: Context) => {
    try {
      const appKey = c.req.param("appKey");
      const authHeader = c.req.header("Authorization");

      if (!appKey || typeof appKey !== "string") {
        return c.json({ success: false, error: "appKey is required in URL" }, 400);
      }

      if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ success: false, error: "Authorization header required" }, 401);
      }
      const token = authHeader.substring(7);
      const payload = await verifyJwt(token, config.jwtSecret);
      return c.json({ success: true, username: payload.username, exp: payload.exp });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 401);
    }
  });

  async function sessionExists(
    appKey: string,
    sessionKey: string,
  ): Promise<boolean> {
    const input = new TextEncoder().encode(sessionKey);
    const digest = await crypto.subtle.digest("SHA-256", input);
    const sigHex = Array.from(new Uint8Array(digest)).map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("").substring(0, 32);
    const uri = `mutable://accounts/${appKey}/sessions/${sigHex}`;
    const res = await proxyClient.read(uri);
    return res.success;
  }

  /**
   * POST /api/v1/auth/signup/:appKey - Create new user account with any credential type
   * Body: { type: "password" | "google", ...type-specific fields }
   */
  app.post("/api/v1/auth/signup/:appKey", async (c: Context) => {
    try {
      const appKey = c.req.param("appKey");
      const payload = await c.req.json() as CredentialPayload;

      if (!appKey || typeof appKey !== "string") {
        return c.json({ success: false, error: "appKey is required in URL" }, 400);
      }

      if (!payload.type || typeof payload.type !== "string") {
        return c.json(
          {
            success: false,
            error: `type is required. Supported types: ${getSupportedCredentialTypes().join(", ")}`,
          },
          400,
        );
      }

      // Get the appropriate credential handler
      const handler = getCredentialHandler(payload.type);

      // For Google auth, read the app's profile from the standard location
      let googleClientId: string | undefined = undefined;
      if (payload.type === "google") {
        const appProfileUri = `mutable://accounts/${appKey}/app-profile`;
        const appProfileResult = await credentialClient.read(appProfileUri);
        if (appProfileResult.success && appProfileResult.record?.data) {
          // App profile is a signed message, so it has { auth, payload } structure
          const appProfile = appProfileResult.record.data as any;
          if (appProfile.payload) {
            googleClientId = appProfile.payload.googleClientId || undefined;
          } else {
            // Fallback: might be direct data (for backwards compatibility)
            googleClientId = appProfile.googleClientId || undefined;
          }
        }

        if (!googleClientId) {
          throw new Error("Google Client ID not configured for this app. Please set it in the app profile at mutable://accounts/{appKey}/app-profile");
        }
      }

      // Build credential context
      const context: CredentialContext = {
        client: credentialClient,
        serverPublicKey,
        serverIdentityPrivateKeyPem,
        serverIdentityPublicKeyHex,
        serverEncryptionPublicKeyHex,
        serverEncryptionPrivateKeyPem: serverKeys.encryptionKey.privateKeyPem,
        appKey,
        googleClientId: googleClientId || config.googleClientId,
      };

      // Execute signup via handler
      const result = await handler.signup(payload, context);

      // Create JWT token
      const jwt = await createJwt(
        result.username,
        config.jwtSecret,
        config.jwtExpirationSeconds,
      );

      return c.json({
        success: true,
        username: result.username,
        token: jwt,
        expiresIn: config.jwtExpirationSeconds,
        ...result.metadata,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("already exists") || message.includes("already registered")) {
        return c.json(
          { success: false, error: message },
          409,
        );
      }

      if (message.includes("Unknown credential type")) {
        return c.json(
          { success: false, error: message },
          400,
        );
      }

      if (message.includes("not configured") || message.includes("Google") || message.includes("token")) {
        return c.json(
          { success: false, error: message },
          401,
        );
      }

      console.error("Credential signup error:", error);
      return c.json(
        { success: false, error: message },
        500,
      );
    }
  });

  /**
   * POST /api/v1/auth/login/:appKey - Authenticate user with any credential type
   * Body: { type: "password" | "google", session: string, ...type-specific fields }
   */
  app.post("/api/v1/auth/login/:appKey", async (c: Context) => {
    try {
      const appKey = c.req.param("appKey");
      const payload = await c.req.json() as CredentialPayload;

      if (!appKey || typeof appKey !== "string") {
        return c.json({ success: false, error: "appKey is required in URL" }, 400);
      }

      if (!payload.session || typeof payload.session !== "string") {
        return c.json({ success: false, error: "session is required" }, 400);
      }

      if (!payload.type || typeof payload.type !== "string") {
        return c.json(
          {
            success: false,
            error: `type is required. Supported types: ${getSupportedCredentialTypes().join(", ")}`,
          },
          400,
        );
      }

      // Verify session exists
      const hasSession = await sessionExists(appKey, payload.session);
      if (!hasSession) {
        return c.json({ success: false, error: "Invalid session" }, 401);
      }

      // Get the appropriate credential handler
      const handler = getCredentialHandler(payload.type);

      // For Google auth, read the app's profile from the standard location
      let googleClientId: string | undefined = undefined;
      if (payload.type === "google") {
        const appProfileUri = `mutable://accounts/${appKey}/app-profile`;
        const appProfileResult = await credentialClient.read(appProfileUri);
        if (appProfileResult.success && appProfileResult.record?.data) {
          // App profile is a signed message, so it has { auth, payload } structure
          const appProfile = appProfileResult.record.data as any;
          if (appProfile.payload) {
            googleClientId = appProfile.payload.googleClientId || undefined;
          } else {
            // Fallback: might be direct data (for backwards compatibility)
            googleClientId = appProfile.googleClientId || undefined;
          }
        }

        if (!googleClientId) {
          throw new Error("Google Client ID not configured for this app. Please set it in the app profile at mutable://accounts/{appKey}/app-profile");
        }
      }

      // Build credential context
      const context: CredentialContext = {
        client: credentialClient,
        serverPublicKey,
        serverIdentityPrivateKeyPem,
        serverIdentityPublicKeyHex,
        serverEncryptionPublicKeyHex,
        serverEncryptionPrivateKeyPem: serverKeys.encryptionKey.privateKeyPem,
        appKey,
        googleClientId: googleClientId || config.googleClientId,
      };

      // Execute login via handler
      const result = await handler.login(payload, context);

      // Create JWT token
      const jwt = await createJwt(
        result.username,
        config.jwtSecret,
        config.jwtExpirationSeconds,
      );

      return c.json({
        success: true,
        username: result.username,
        token: jwt,
        expiresIn: config.jwtExpirationSeconds,
        ...result.metadata,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("Unknown credential type")) {
        return c.json(
          { success: false, error: message },
          400,
        );
      }

      if (message.includes("not configured") || message.includes("Google") || message.includes("token")) {
        return c.json(
          { success: false, error: message },
          401,
        );
      }

      console.error("Credential login error:", error);
      return c.json(
        { success: false, error: message },
        500,
      );
    }
  });

  /**
   * POST /api/v1/auth/credentials/change-password/:appKey - Change user password
   * Headers: Authorization: Bearer <jwt>
   * Body: { oldPassword: string, newPassword: string }
   */
  app.post("/api/v1/auth/credentials/change-password/:appKey", async (c: Context) => {
    try {
      const appKey = c.req.param("appKey");
      const authHeader = c.req.header("Authorization");

      if (!appKey || typeof appKey !== "string") {
        return c.json({ success: false, error: "appKey is required in URL" }, 400);
      }

      if (!authHeader?.startsWith("Bearer ")) {
        return c.json(
          { success: false, error: "Authorization header required" },
          401,
        );
      }

      const token = authHeader.substring(7);

      // Verify JWT
      const payload = await verifyJwt(token, config.jwtSecret);
      const username = payload.username;

      const { oldPassword, newPassword } = await c.req.json() as any;

      if (!oldPassword || !newPassword) {
        return c.json(
          { success: false, error: "oldPassword and newPassword are required" },
          400,
        );
      }

      if (newPassword.length < 8) {
        return c.json(
          {
            success: false,
            error: "newPassword must be at least 8 characters",
          },
          400,
        );
      }

      // Change password
      await changePassword(
        credentialClient,
        serverPublicKey,
        username,
        oldPassword,
        newPassword,
        serverIdentityPrivateKeyPem,
        serverIdentityPublicKeyHex,
        serverEncryptionPublicKeyHex,
        serverEncryptionPrivateKeyPem,
        appKey,
      );

      return c.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("expired")) {
        return c.json({ success: false, error: message }, 401);
      }

      if (message.includes("incorrect")) {
        return c.json({ success: false, error: message }, 401);
      }

      console.error("Change password error:", error);
      return c.json(
        { success: false, error: message },
        500,
      );
    }
  });

  /**
   * POST /api/v1/auth/credentials/request-password-reset/:appKey - Request password reset token
   * Body: { username: string }
   */
  app.post("/api/v1/auth/credentials/request-password-reset/:appKey", async (c: Context) => {
    try {
      const appKey = c.req.param("appKey");
      const { username } = await c.req.json() as any;

      if (!appKey || typeof appKey !== "string") {
        return c.json({ success: false, error: "appKey is required in URL" }, 400);
      }
      if (!username) {
        return c.json(
          { success: false, error: "username is required" },
          400,
        );
      }

      // Create reset token
      const resetToken = await createPasswordResetToken(
        credentialClient,
        serverPublicKey,
        username,
        config.passwordResetTokenTtlSeconds,
        serverIdentityPrivateKeyPem,
        serverIdentityPublicKeyHex,
        serverEncryptionPublicKeyHex,
        appKey,
      );

      return c.json({
        success: true,
        message: "Password reset token created",
        resetToken,
        expiresIn: config.passwordResetTokenTtlSeconds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("not found")) {
        return c.json(
          { success: false, error: "User not found" },
          404,
        );
      }

      console.error("Request password reset error:", error);
      return c.json(
        { success: false, error: message },
        500,
      );
    }
  });

  /**
   * POST /api/v1/auth/credentials/reset-password/:appKey - Reset password with token
   * Body: { username: string, resetToken: string, newPassword: string }
   */
  app.post("/api/v1/auth/credentials/reset-password/:appKey", async (c: Context) => {
    try {
      const appKey = c.req.param("appKey");
      const { username, resetToken, newPassword } = await c.req
        .json() as any;

      if (!appKey || typeof appKey !== "string") {
        return c.json({ success: false, error: "appKey is required in URL" }, 400);
      }
      if (!username || !resetToken || !newPassword) {
        return c.json(
          {
            success: false,
            error: "username, resetToken and newPassword are required",
          },
          400,
        );
      }

      if (newPassword.length < 8) {
        return c.json(
          {
            success: false,
            error: "newPassword must be at least 8 characters",
          },
          400,
        );
      }

      // Reset password
      const resetUsername = await resetPasswordWithToken(
        credentialClient,
        serverPublicKey,
        resetToken,
        newPassword,
        serverIdentityPrivateKeyPem,
        serverIdentityPublicKeyHex,
        serverEncryptionPublicKeyHex,
        serverEncryptionPrivateKeyPem,
        username,
        appKey,
      );

      // Issue new JWT
      const newToken = await createJwt(
        resetUsername,
        config.jwtSecret,
        config.jwtExpirationSeconds,
      );

      return c.json({
        success: true,
        message: "Password reset successful",
        username: resetUsername,
        token: newToken,
        expiresIn: config.jwtExpirationSeconds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("invalid") || message.includes("expired")) {
        return c.json({ success: false, error: message }, 400);
      }

      console.error("Reset password error:", error);
      return c.json(
        { success: false, error: message },
        500,
      );
    }
  });

  /**
   * POST /api/v1/proxy/write - Proxy a write request with server signing
   * Headers: Authorization: Bearer <jwt>
   * Body: { uri: string, data: unknown, encrypt?: boolean }
   */
  app.post("/api/v1/proxy/write", async (c: Context) => {
    try {
      const authHeader = c.req.header("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return c.json(
          { success: false, error: "Authorization header required" },
          401,
        );
      }

      const token = authHeader.substring(7);

      // Verify JWT
      const payload = await verifyJwt(token, config.jwtSecret);
      const username = payload.username;

      const { uri, data, encrypt } = (await c.req.json()) as any;

      if (!uri) {
        return c.json(
          { success: false, error: "uri is required" },
          400,
        );
      }

      if (data === undefined) {
        return c.json(
          { success: false, error: "data is required" },
          400,
        );
      }

      // Proxy the write request
      const result = await proxyWrite(
        proxyClient,
        credentialClient,
        serverPublicKey,
        username,
        serverEncryptionPrivateKeyPem,
        { uri, data, encrypt: encrypt === true },
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

      console.error("Proxy write error:", error);
      return c.json(
        { success: false, error: message },
        500,
      );
    }
  });

  return app;
}

/**
 * Main entry point
 */
async function main() {
  const config = loadConfig();

  console.log("🚀 B3nd Wallet Server starting...");
  console.log(`   Port: ${config.port}`);
  console.log(`   Credential Node: ${config.credentialNodeUrl}`);
  console.log(`   Proxy Node: ${config.proxyNodeUrl}`);
  if (config.appBackendUrl) {
    console.log(
      `   App Backend: ${config.appBackendUrl}${
        normalizeApiBasePath(config.appBackendApiBasePath)
      }`,
    );
  } else {
    console.log("   App Backend: (not configured)");
  }

  // Load server keys from environment variables
  console.log("🔑 Loading server keys from environment variables...");
  const serverKeys = loadServerKeys();
  const serverPublicKey = serverKeys.identityKey.publicKeyHex;
  console.log(`   ✓ Server Identity: ${serverPublicKey.slice(0, 16)}...`);
  console.log(
    `   ✓ Server Encryption: ${
      serverKeys.encryptionKey.publicKeyHex.slice(
        0,
        16,
      )
    }...`,
  );

  // Initialize b3nd clients
  console.log("📡 Initializing b3nd clients...");
  const { credentialClient, proxyClient } = await initializeClients(config);

  const bootstrapState = await ensureWalletAppRegistered(config, serverKeys);
  if (bootstrapState) {
    console.log("\n🧭 Wallet app bootstrap");
    console.log(`   App Key: ${bootstrapState.appKey}`);
    console.log(`   Stored at: ${config.bootstrapStatePath}`);
    console.log(
      `   App Backend: ${bootstrapState.appServerUrl}${bootstrapState.apiBasePath}`,
    );
  }

  // Create Hono app
  console.log("🌐 Setting up HTTP server...");
  const app = createApp(config, credentialClient, proxyClient, serverKeys);

  // Start server
  const server = Deno.serve({
    port: config.port,
    onListen: (addr) => {
      console.log(`\n✅ Server running at http://localhost:${config.port}`);
      console.log("\n📚 Available endpoints:");
      console.log("   POST   /api/v1/auth/signup/:appKey - Register with any credential type");
      console.log("   POST   /api/v1/auth/login/:appKey - Login with any credential type");
      console.log("   POST   /api/v1/auth/credentials/change-password/:appKey - Change password");
      console.log(
        "   POST   /api/v1/auth/credentials/request-password-reset/:appKey - Request reset token",
      );
      console.log("   POST   /api/v1/auth/credentials/reset-password/:appKey - Reset with token");
      console.log("   POST   /api/v1/proxy/write - Proxy write request");
      console.log(
        "   GET    /api/v1/auth/public-keys/:appKey - Get current user's public keys",
      );
      console.log("   GET    /api/v1/server-keys - Get server public keys");
      console.log("   GET    /api/v1/auth/verify/:appKey - Verify JWT token");
      console.log("   GET    /api/v1/health - Health check");
      const supportedTypes = getSupportedCredentialTypes();
      console.log(`\n🔑 Supported credential types: ${supportedTypes.join(", ")}`);
      if (config.googleClientId) {
        console.log(`   Google OAuth enabled (Client ID: ${config.googleClientId.slice(0, 20)}...)`);
      } else {
        console.log("   Google OAuth not configured (set GOOGLE_CLIENT_ID to enable)");
      }
      console.log("");
    },
    handler: app.fetch,
  });

  await server;
}

main().catch((error) => {
  console.error("Fatal error:", error);
  Deno.exit(1);
});

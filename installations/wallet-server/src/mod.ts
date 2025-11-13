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

import { loadConfig } from "./config.ts";
import {
  loadServerKeys,
  signWithServerKey,
} from "./server-keys.ts";
import {
  userExists,
  createUser,
  authenticateUser,
  changePassword,
  createPasswordResetToken,
  resetPasswordWithToken,
} from "./auth.ts";
import {
  createJwt,
  verifyJwt,
} from "./jwt.ts";
import {
  generateUserKeys,
  getUserPublicKeys,
} from "./keys.ts";
import { proxyWrite } from "./proxy.ts";

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
  serverKeys: any
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
      origin: config.allowedOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Request logging middleware
  app.use(async (c: Context, next: () => Promise<void>) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${c.req.method} ${c.req.path} ${
        c.res.status
      } - ${duration}ms`
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
   * GET /api/v1/public-keys - Get current user's public keys (requires auth)
   */
  app.get("/api/v1/public-keys", async (c: Context) => {
    try {
      const authHeader = c.req.header("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return c.json(
          { success: false, error: "Authorization header required" },
          401
        );
      }

      const token = authHeader.substring(7);
      const payload = await verifyJwt(token, config.jwtSecret);
      const username = payload.username;

      const keys = await getUserPublicKeys(
        credentialClient,
        serverPublicKey,
        username,
        serverEncryptionPrivateKeyPem
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
        400
      );
    }
  });

  function parseAppToken(token: string): { appKey: string; tokenId: string } {
    const [appKey, tokenId] = token.split(".");
    if (!appKey || !tokenId) throw new Error("invalid token format");
    return { appKey, tokenId };
  }

  async function sessionExists(appKey: string, tokenId: string, sessionKey: string): Promise<boolean> {
    const input = new TextEncoder().encode(`${tokenId}.${sessionKey}`);
    const digest = await crypto.subtle.digest("SHA-256", input);
    const sigHex = Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("").substring(0,32);
    const uri = `mutable://accounts/${appKey}/sessions/${sigHex}`;
    const res = await proxyClient.read(uri);
    return res.success;
  }

  /**
   * POST /api/v1/auth/signup - Create new user account (scoped to app token)
   * Body: { username: string, password: string }
   */
  app.post("/api/v1/auth/signup", async (c: Context) => {
    try {
      const { token, username, password } = await c.req.json() as any;

      if (!token || typeof token !== "string") {
        return c.json({ success: false, error: "token is required" }, 400);
      }
      const { appKey } = parseAppToken(token);
      if (!username || typeof username !== "string") {
        return c.json(
          { success: false, error: "username is required" },
          400
        );
      }

      if (!password || typeof password !== "string" || password.length < 8) {
        return c.json(
          {
            success: false,
            error: "password is required and must be at least 8 characters",
          },
          400
        );
      }

      // Create user with password
      console.log(`Creating user: ${username}`);
      await createUser(
        credentialClient,
        serverPublicKey,
        username,
        password,
        serverIdentityPrivateKeyPem,
        serverIdentityPublicKeyHex,
        serverEncryptionPublicKeyHex,
        appKey
      );
      console.log(`✅ User created: ${username}`);

      // Generate user keys
      console.log(`Generating keys for user: ${username}`);
      await generateUserKeys(
        credentialClient,
        serverPublicKey,
        username,
        serverIdentityPrivateKeyPem,
        serverIdentityPublicKeyHex,
        serverEncryptionPublicKeyHex
      );
      console.log(`✅ Keys generated for user: ${username}`);

      // Create JWT token
      const token = await createJwt(
        username,
        config.jwtSecret,
        config.jwtExpirationSeconds
      );

      return c.json({
        success: true,
        username,
        token,
        expiresIn: config.jwtExpirationSeconds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("already exists")) {
        return c.json(
          { success: false, error: "User already exists" },
          409
        );
      }

      console.error("Signup error:", error);
      return c.json(
        { success: false, error: message },
        500
      );
    }
  });

  /**
   * POST /api/v1/auth/login - Authenticate user and get JWT (requires app token and session)
   * Body: { username: string, password: string }
   */
  app.post("/api/v1/auth/login", async (c: Context) => {
    try {
      const { token, session, username, password } = await c.req.json() as any;

      if (!token || typeof token !== "string") {
        return c.json({ success: false, error: "token is required" }, 400);
      }
      if (!session || typeof session !== "string") {
        return c.json({ success: false, error: "session is required" }, 400);
      }
      const { appKey, tokenId } = parseAppToken(token);

      if (!username || !password) {
        return c.json(
          { success: false, error: "username and password are required" },
          400
        );
      }

      // Verify session exists
      const hasSession = await sessionExists(appKey, tokenId, session);
      if (!hasSession) {
        return c.json({ success: false, error: "Invalid session" }, 401);
      }

      // Verify credentials
      const isValid = await authenticateUser(
        credentialClient,
        serverPublicKey,
        username,
        password,
        serverIdentityPublicKeyHex,
        serverEncryptionPrivateKeyPem,
        appKey
      );

      if (!isValid) {
        return c.json(
          { success: false, error: "Invalid username or password" },
          401
        );
      }

      // Create JWT token
      const token = await createJwt(
        username,
        config.jwtSecret,
        config.jwtExpirationSeconds
      );

      return c.json({
        success: true,
        username,
        token,
        expiresIn: config.jwtExpirationSeconds,
      });
    } catch (error) {
      console.error("Login error:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  });

  /**
   * POST /api/v1/auth/change-password - Change user password
   * Headers: Authorization: Bearer <jwt>
   * Body: { oldPassword: string, newPassword: string }
   */
  app.post("/api/v1/auth/change-password", async (c: Context) => {
    try {
      const authHeader = c.req.header("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return c.json(
          { success: false, error: "Authorization header required" },
          401
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
          400
        );
      }

      if (newPassword.length < 8) {
        return c.json(
          { success: false, error: "newPassword must be at least 8 characters" },
          400
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
        serverEncryptionPrivateKeyPem
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
        500
      );
    }
  });

  /**
   * POST /api/v1/auth/request-password-reset - Request password reset token
   * Body: { username: string }
   */
  app.post("/api/v1/auth/request-password-reset", async (c: Context) => {
    try {
      const { token, username } = await c.req.json() as any;

      if (!token || typeof token !== "string") {
        return c.json({ success: false, error: "token is required" }, 400);
      }
      const { appKey } = parseAppToken(token);
      if (!username) {
        return c.json(
          { success: false, error: "username is required" },
          400
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
        appKey
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
          404
        );
      }

      console.error("Request password reset error:", error);
      return c.json(
        { success: false, error: message },
        500
      );
    }
  });

  /**
   * POST /api/v1/auth/reset-password - Reset password with token
   * Body: { username: string, resetToken: string, newPassword: string }
   */
  app.post("/api/v1/auth/reset-password", async (c: Context) => {
    try {
      const { token, username, resetToken, newPassword } = await c.req.json() as any;

      if (!token || typeof token !== "string") {
        return c.json({ success: false, error: "token is required" }, 400);
      }
      const { appKey } = parseAppToken(token);
      if (!username || !resetToken || !newPassword) {
        return c.json(
          { success: false, error: "username, resetToken and newPassword are required" },
          400
        );
      }

      if (newPassword.length < 8) {
        return c.json(
          { success: false, error: "newPassword must be at least 8 characters" },
          400
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
        appKey
      );

      // Issue new JWT
      const newToken = await createJwt(
        resetUsername,
        config.jwtSecret,
        config.jwtExpirationSeconds
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
        500
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
          401
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
          400
        );
      }

      if (data === undefined) {
        return c.json(
          { success: false, error: "data is required" },
          400
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
        500
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

  // Load server keys from environment variables
  console.log("🔑 Loading server keys from environment variables...");
  const serverKeys = loadServerKeys();
  const serverPublicKey = serverKeys.identityKey.publicKeyHex;
  console.log(`   ✓ Server Identity: ${serverPublicKey.slice(0, 16)}...`);
  console.log(`   ✓ Server Encryption: ${serverKeys.encryptionKey.publicKeyHex.slice(
    0,
    16
  )}...`);

  // Initialize b3nd clients
  console.log("📡 Initializing b3nd clients...");
  const { credentialClient, proxyClient } = await initializeClients(config);

  // Create Hono app
  console.log("🌐 Setting up HTTP server...");
  const app = createApp(config, credentialClient, proxyClient, serverKeys);

  // Start server
  const server = Deno.serve({
    port: config.port,
    onListen: (addr) => {
      console.log(`\n✅ Server running at http://localhost:${config.port}`);
      console.log("\n📚 Available endpoints:");
      console.log("   POST   /api/v1/auth/signup - Register new user");
      console.log("   POST   /api/v1/auth/login - Authenticate user");
      console.log("   POST   /api/v1/auth/change-password - Change password");
      console.log("   POST   /api/v1/auth/request-password-reset - Request reset token");
      console.log("   POST   /api/v1/auth/reset-password - Reset with token");
      console.log("   POST   /api/v1/proxy/write - Proxy write request");
      console.log("   GET    /api/v1/public-keys - Get current user's public keys");
      console.log("   GET    /api/v1/server-keys - Get server public keys");
      console.log("   GET    /api/v1/health - Health check\n");
    },
    handler: app.fetch,
  });

  await server;
}

main().catch((error) => {
  console.error("Fatal error:", error);
  Deno.exit(1);
});

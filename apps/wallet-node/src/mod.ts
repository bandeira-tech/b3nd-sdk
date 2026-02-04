/**
 * B3nd Wallet Server - Deno Wrapper
 *
 * Thin Deno wrapper around the universal wallet-server SDK.
 * All core functionality is provided by @b3nd/sdk/wallet-server.
 */

/// <reference lib="deno.ns" />

import { WalletServerCore, getSupportedCredentialTypes } from "@b3nd/sdk/wallet-server";
import {
  loadConfigFromEnv,
  DenoFileStorage,
  DenoEnvironment,
} from "@b3nd/sdk/wallet-server/adapters/deno";

/**
 * Main entry point
 */
async function main() {
  const env = new DenoEnvironment();
  const port = Number(env.get("PORT") || "8843");

  console.log("🚀 B3nd Wallet Server starting...");
  console.log(`   Port: ${port}`);
  console.log(`   Credential Node: ${env.get("CREDENTIAL_NODE_URL") || "http://localhost:8842"}`);
  console.log(`   Proxy Node: ${env.get("PROXY_NODE_URL") || "http://localhost:8842"}`);

  const appBackendUrl = env.get("APP_BACKEND_URL");
  if (appBackendUrl) {
    console.log(`   App Backend: ${appBackendUrl}${env.get("APP_BACKEND_API_BASE_PATH") || "/api/v1"}`);
  } else {
    console.log("   App Backend: (not configured)");
  }

  // Load config from environment
  console.log("🔑 Loading server keys from environment variables...");
  const config = loadConfigFromEnv(env);

  console.log(`   ✓ Server Identity: ${config.serverKeys.identityKey.publicKeyHex.slice(0, 16)}...`);
  console.log(`   ✓ Server Encryption: ${config.serverKeys.encryptionKey.publicKeyHex.slice(0, 16)}...`);

  // Create wallet server
  console.log("📡 Initializing wallet server...");
  const server = new WalletServerCore(config);

  // Bootstrap if app backend is configured
  if (config.appBackend) {
    console.log("🧭 Bootstrapping wallet app...");
    try {
      const bootstrapState = await server.bootstrap();
      if (bootstrapState) {
        console.log(`   App Key: ${bootstrapState.appKey}`);
        console.log(`   App Backend: ${bootstrapState.appServerUrl}${bootstrapState.apiBasePath}`);
      }
    } catch (error) {
      console.warn("   ⚠️ Bootstrap failed:", error instanceof Error ? error.message : String(error));
    }
  }

  // Start server
  console.log("🌐 Starting HTTP server...");
  Deno.serve({
    port,
    onListen: () => {
      console.log(`\n✅ Server running at http://localhost:${port}`);
      console.log("\n📚 Available endpoints:");
      console.log("   POST   /api/v1/auth/signup/:appKey - Register with any credential type");
      console.log("   POST   /api/v1/auth/login/:appKey - Login with any credential type");
      console.log("   POST   /api/v1/auth/credentials/change-password/:appKey - Change password");
      console.log("   POST   /api/v1/auth/credentials/request-password-reset/:appKey - Request reset token");
      console.log("   POST   /api/v1/auth/credentials/reset-password/:appKey - Reset with token");
      console.log("   POST   /api/v1/proxy/write - Proxy write request");
      console.log("   GET    /api/v1/proxy/read - Proxy read request (with decryption)");
      console.log("   GET    /api/v1/auth/public-keys/:appKey - Get current user's public keys");
      console.log("   GET    /api/v1/server-keys - Get server public keys");
      console.log("   GET    /api/v1/auth/verify/:appKey - Verify JWT token");
      console.log("   GET    /api/v1/health - Health check");
      const supportedTypes = getSupportedCredentialTypes();
      console.log(`\n🔑 Supported credential types: ${supportedTypes.join(", ")}`);
      console.log("");
    },
    handler: server.getFetchHandler(),
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  Deno.exit(1);
});

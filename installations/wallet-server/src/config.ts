/**
 * Wallet Server Configuration
 *
 * Loads configuration for:
 * - Credential client: b3nd backend for storing user keys/passwords
 * - Proxy client: b3nd backend for proxying user writes
 * - Server identity keys
 */

interface WalletConfig {
  port: number;
  credentialNodeUrl: string; // b3nd backend for storing credentials
  proxyNodeUrl: string; // b3nd backend for proxying writes
  jwtSecret: string;
  jwtExpirationSeconds: number;
  serverKeysPath: string;
  allowedOrigins: string[];
  passwordResetTokenTtlSeconds: number;
}

export function loadConfig(): WalletConfig {
  const port = Number(Deno.env.get("WALLET_PORT") || "3001");
  const credentialNodeUrl = Deno.env.get("CREDENTIAL_NODE_URL") ||
    "http://localhost:8080";
  const proxyNodeUrl = Deno.env.get("PROXY_NODE_URL") ||
    "http://localhost:8080";
  const jwtSecret = Deno.env.get("JWT_SECRET");
  const jwtExpirationSeconds = Number(
    Deno.env.get("JWT_EXPIRATION_SECONDS") || "86400",
  ); // 24 hours
  const serverKeysPath = Deno.env.get("SERVER_KEYS_PATH") ||
    "./server-keys.json";
  const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "*").split(",");
  const passwordResetTokenTtlSeconds = Number(
    Deno.env.get("PASSWORD_RESET_TOKEN_TTL_SECONDS") || "3600",
  ); // 1 hour

  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      "JWT_SECRET environment variable is required and must be at least 32 characters long",
    );
  }

  return {
    port,
    credentialNodeUrl,
    proxyNodeUrl,
    jwtSecret,
    jwtExpirationSeconds,
    serverKeysPath,
    allowedOrigins,
    passwordResetTokenTtlSeconds,
  };
}

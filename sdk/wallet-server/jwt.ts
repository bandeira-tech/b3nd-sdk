/**
 * JWT Token Management
 *
 * Creates and validates JWT tokens for authenticated sessions.
 */

export interface JwtPayload {
  username: string;
  iat: number; // issued at
  exp: number; // expiration
  type: "access"; // token type
  fingerprint?: string; // Optional device/session fingerprint for binding
}

interface JwtHeader {
  alg: string;
  typ: string;
}

/**
 * Base64url encode
 */
function base64urlEncode(data: string): string {
  const base64 = btoa(data);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Base64url decode
 */
function base64urlDecode(encoded: string): string {
  const padded = encoded
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "=");
  return atob(padded);
}

/**
 * Generate a device fingerprint from request context
 * This creates a simple hash of device-identifying characteristics
 *
 * @param context - Object containing device identifiers (IP, User-Agent, etc.)
 * @returns A fingerprint hash string
 */
export async function generateDeviceFingerprint(context: {
  ip?: string;
  userAgent?: string;
  acceptLanguage?: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  // Combine available identifiers
  const data = [
    context.ip || "",
    context.userAgent || "",
    context.acceptLanguage || "",
  ].join("|");

  // Hash the combined data
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(data)
  );

  // Return first 16 hex characters for a compact fingerprint
  return Array.from(new Uint8Array(hashBuffer))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Create JWT token using HMAC-SHA256
 *
 * @param username - The username to embed in the token
 * @param secret - The HMAC secret key
 * @param expirationSeconds - Token lifetime in seconds
 * @param fingerprint - Optional device fingerprint for session binding
 */
export async function createJwt(
  username: string,
  secret: string,
  expirationSeconds: number,
  fingerprint?: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header: JwtHeader = {
    alg: "HS256",
    typ: "JWT",
  };

  const payload: JwtPayload = {
    username,
    iat: now,
    exp: now + expirationSeconds,
    type: "access",
    ...(fingerprint && { fingerprint }),
  };

  // Create signature
  const headerEncoded = base64urlEncode(JSON.stringify(header));
  const payloadEncoded = base64urlEncode(JSON.stringify(payload));
  const message = `${headerEncoded}.${payloadEncoded}`;

  // HMAC-SHA256 signature
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );
  const signatureEncoded = base64urlEncode(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return `${message}.${signatureEncoded}`;
}

/**
 * Verify and decode JWT token
 *
 * @param token - The JWT token to verify
 * @param secret - The HMAC secret key
 * @param expectedFingerprint - Optional fingerprint to verify against token's fingerprint
 *                              If the token has a fingerprint but this is not provided,
 *                              verification still passes (for backwards compatibility).
 *                              If both are provided, they must match.
 */
export async function verifyJwt(
  token: string,
  secret: string,
  expectedFingerprint?: string
): Promise<JwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;

  // Verify signature
  const message = `${headerEncoded}.${payloadEncoded}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  // Convert base64url signature back to bytes
  const signaturePadded = signatureEncoded
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(signatureEncoded.length + ((4 - (signatureEncoded.length % 4)) % 4), "=");
  const signatureBytes = new Uint8Array(
    atob(signaturePadded)
      .split("")
      .map((c) => c.charCodeAt(0))
  );

  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(message)
  );

  if (!isValid) {
    throw new Error("Invalid JWT signature");
  }

  // Decode payload
  const payloadJson = base64urlDecode(payloadEncoded);
  const payload = JSON.parse(payloadJson) as JwtPayload;

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error("JWT token has expired");
  }

  // Check token type
  if (payload.type !== "access") {
    throw new Error("Invalid token type");
  }

  // SECURITY FIX: Verify device fingerprint if both token and request have one
  // This prevents stolen tokens from being used on different devices
  if (expectedFingerprint && payload.fingerprint) {
    if (payload.fingerprint !== expectedFingerprint) {
      throw new Error("Token fingerprint mismatch - possible session hijacking");
    }
  }

  return payload;
}

/**
 * Extract username from JWT token (without verification)
 * Use only for logging/debugging
 */
export function extractUsernameFromJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payloadJson = base64urlDecode(parts[1]);
    const payload = JSON.parse(payloadJson) as JwtPayload;
    return payload.username;
  } catch {
    return null;
  }
}

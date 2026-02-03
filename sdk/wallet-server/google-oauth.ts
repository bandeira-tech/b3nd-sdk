/**
 * Google OAuth Module
 *
 * Handles verification of Google ID tokens using Google's public keys.
 * Supports both signup and login flows with Google OAuth2.
 */

import { encodeHex } from "../shared/encoding.ts";
import type { HttpFetch } from "./interfaces.ts";

export interface GoogleTokenPayload {
  iss: string; // Issuer (accounts.google.com or https://accounts.google.com)
  azp: string; // Authorized party
  aud: string; // Audience (your Google Client ID)
  sub: string; // Subject - unique Google user ID
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  iat: number; // Issued at
  exp: number; // Expiration
}

interface GooglePublicKey {
  kid: string;
  n: string;
  e: string;
  alg: string;
  kty: string;
  use: string;
}

interface GoogleKeysResponse {
  keys: GooglePublicKey[];
}

// Cache Google's public keys with expiration
let cachedKeys: GooglePublicKey[] = [];
let cacheExpiry = 0;

/**
 * Fetch Google's public keys for JWT verification
 */
async function getGooglePublicKeys(
  fetchImpl: HttpFetch = fetch,
): Promise<GooglePublicKey[]> {
  const now = Date.now();
  if (cachedKeys.length > 0 && now < cacheExpiry) {
    return cachedKeys;
  }

  const response = await fetchImpl(
    "https://www.googleapis.com/oauth2/v3/certs",
  );

  if (!response.ok) {
    throw new Error("Failed to fetch Google public keys");
  }

  // Parse cache-control header for expiry
  const cacheControl = response.headers.get("cache-control");
  let maxAge = 3600; // Default 1 hour
  if (cacheControl) {
    const match = cacheControl.match(/max-age=(\d+)/);
    if (match) {
      maxAge = parseInt(match[1], 10);
    }
  }

  const data: GoogleKeysResponse = await response.json();
  cachedKeys = data.keys;
  cacheExpiry = now + maxAge * 1000;

  return cachedKeys;
}

/**
 * Clear the cached Google public keys
 */
export function clearGooglePublicKeyCache(): void {
  cachedKeys = [];
  cacheExpiry = 0;
}

/**
 * Base64URL decode (handles both standard base64 and base64url)
 */
function base64UrlDecode(str: string): Uint8Array {
  // Convert base64url to standard base64
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Pad if necessary
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Import RSA public key from JWK
 */
async function importRsaPublicKey(key: GooglePublicKey): Promise<CryptoKey> {
  const jwk = {
    kty: key.kty,
    n: key.n,
    e: key.e,
    alg: key.alg,
    use: key.use,
  };

  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-256" },
    },
    false,
    ["verify"],
  );
}

/**
 * Verify a Google ID token and extract the payload
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  fetchImpl: HttpFetch = fetch,
): Promise<GoogleTokenPayload> {
  // Split the JWT into parts
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid Google ID token format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header to get key ID
  const headerJson = new TextDecoder().decode(base64UrlDecode(headerB64));
  const header = JSON.parse(headerJson);
  const kid = header.kid;

  if (!kid) {
    throw new Error("Google ID token missing key ID");
  }

  // Get Google's public keys
  let keys = await getGooglePublicKeys(fetchImpl);
  let key = keys.find((k) => k.kid === kid);

  if (!key) {
    // Refresh keys and try again
    clearGooglePublicKeyCache();
    keys = await getGooglePublicKeys(fetchImpl);
    key = keys.find((k) => k.kid === kid);
    if (!key) {
      throw new Error("Google public key not found for token");
    }
  }

  const publicKey = await importRsaPublicKey(key);

  // Verify signature
  const signatureData = base64UrlDecode(signatureB64);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const isValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signatureData.buffer as ArrayBuffer,
    signedData,
  );

  if (!isValid) {
    throw new Error("Google ID token signature verification failed");
  }

  // Decode and validate payload
  const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
  const payload: GoogleTokenPayload = JSON.parse(payloadJson);

  // Verify issuer
  if (
    payload.iss !== "accounts.google.com" &&
    payload.iss !== "https://accounts.google.com"
  ) {
    throw new Error("Invalid Google ID token issuer");
  }

  // Verify audience (your client ID)
  if (payload.aud !== clientId) {
    throw new Error("Google ID token audience mismatch");
  }

  // Verify expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error("Google ID token has expired");
  }

  // Verify email is verified (optional but recommended)
  if (!payload.email_verified) {
    throw new Error("Google email not verified");
  }

  return payload;
}

/**
 * Generate a deterministic username from Google user info
 * Uses the Google sub (unique user ID) to create a consistent username
 */
export async function generateGoogleUsername(
  googleSub: string,
): Promise<string> {
  // Create a hash of the Google sub to use as username suffix
  const encoder = new TextEncoder();
  const data = encoder.encode(`google:${googleSub}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashHex = encodeHex(new Uint8Array(hashBuffer));

  // Use first 12 chars of hash for uniqueness
  return `g_${hashHex.substring(0, 12)}`;
}

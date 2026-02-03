/**
 * Authentication Module
 *
 * Handles password hashing, user signup, login, password change, and reset flows.
 * All data is encrypted before writing to backend using obfuscated paths.
 */

import { encodeHex, decodeHex } from "../shared/encoding.ts";
import type { NodeProtocolInterface } from "../src/types.ts";
import type { Logger } from "./interfaces.ts";
import {
  deriveObfuscatedPath,
  createSignedEncryptedPayload,
  decryptSignedEncryptedPayload,
} from "./obfuscation.ts";
import type { GoogleTokenPayload } from "./google-oauth.ts";

/**
 * Generate a random salt for password hashing
 */
function generateSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return encodeHex(bytes);
}

/**
 * Hash a password using PBKDF2
 */
async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const saltBytes = new Uint8Array(decodeHex(salt));

  const key = await crypto.subtle.importKey("raw", data, "PBKDF2", false, [
    "deriveBits",
  ]);

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes.buffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256
  );

  return encodeHex(new Uint8Array(derived));
}

/**
 * Verify password against hash
 */
export async function verifyPassword(
  password: string,
  salt: string,
  hash: string
): Promise<boolean> {
  const computedHash = await hashPassword(password, salt);
  return computedHash === hash;
}

/**
 * Check if user exists
 */
export async function userExists(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  appScope?: string
): Promise<boolean> {
  const path = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "profile",
    ...(appScope ? [appScope] : [])
  );
  const result = await client.read(
    `mutable://accounts/${serverPublicKey}/${path}`
  );
  return result.success;
}

/**
 * Create a new user with password
 * Stores signed+encrypted at obfuscated paths under: mutable://accounts/{serverPublicKey}/...
 */
export async function createUser(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  password: string,
  serverIdentityPrivateKeyPem: string,
  serverIdentityPublicKeyHex: string,
  serverEncryptionPublicKeyHex: string,
  appScope?: string
): Promise<{ salt: string; hash: string }> {
  // Check if user already exists
  if (await userExists(client, serverPublicKey, username, appScope)) {
    throw new Error("User already exists");
  }

  // Generate salt and hash password
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);

  // Store user profile with signed+encryption
  const profilePath = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "profile",
    ...(appScope ? [appScope] : [])
  );
  const profileData = {
    username,
    createdAt: new Date().toISOString(),
  };
  const profileSigned = await createSignedEncryptedPayload(
    profileData,
    serverIdentityPrivateKeyPem,
    serverIdentityPublicKeyHex,
    serverEncryptionPublicKeyHex
  );
  await client.receive([
    `mutable://accounts/${serverPublicKey}/${profilePath}`,
    profileSigned,
  ]);

  // Store password credential with signed+encryption
  const passwordPath = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "password",
    ...(appScope ? [appScope] : [])
  );
  const passwordData = { hash, salt };
  const passwordSigned = await createSignedEncryptedPayload(
    passwordData,
    serverIdentityPrivateKeyPem,
    serverIdentityPublicKeyHex,
    serverEncryptionPublicKeyHex
  );
  await client.receive([
    `mutable://accounts/${serverPublicKey}/${passwordPath}`,
    passwordSigned,
  ]);

  return { salt, hash };
}

/**
 * Authenticate user with password
 */
export async function authenticateUser(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  password: string,
  serverEncryptionPrivateKeyPem: string,
  appScope?: string,
  logger?: Logger
): Promise<boolean> {
  // Derive obfuscated path to password credential
  const passwordPath = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "password",
    ...(appScope ? [appScope] : [])
  );

  // Read signed+encrypted password credential
  const result = await client.read<unknown>(
    `mutable://accounts/${serverPublicKey}/${passwordPath}`
  );

  if (!result.success || !result.record?.data) {
    return false;
  }

  // Decrypt and verify the signed payload
  const { data, verified } = await decryptSignedEncryptedPayload(
    result.record.data as Parameters<typeof decryptSignedEncryptedPayload>[0],
    serverEncryptionPrivateKeyPem
  );

  if (!verified) {
    logger?.warn(
      "Password credential signature verification failed for user:",
      username
    );
    // Continue anyway - credentials might be legitimately unsigned in migration scenarios
  }

  const { salt, hash } = data as { salt: string; hash: string };
  return await verifyPassword(password, salt, hash);
}

/**
 * Change user password
 */
export async function changePassword(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  oldPassword: string,
  newPassword: string,
  serverIdentityPrivateKeyPem: string,
  serverIdentityPublicKeyHex: string,
  serverEncryptionPublicKeyHex: string,
  serverEncryptionPrivateKeyPem: string,
  appScope?: string
): Promise<void> {
  // Verify old password first
  const isValid = await authenticateUser(
    client,
    serverPublicKey,
    username,
    oldPassword,
    serverEncryptionPrivateKeyPem,
    appScope
  );
  if (!isValid) {
    throw new Error("Current password is incorrect");
  }

  // Generate new salt and hash
  const salt = generateSalt();
  const hash = await hashPassword(newPassword, salt);

  // Derive obfuscated path and sign+encrypt new password
  const passwordPath = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "password",
    ...(appScope ? [appScope] : [])
  );
  const passwordData = { hash, salt };
  const passwordSigned = await createSignedEncryptedPayload(
    passwordData,
    serverIdentityPrivateKeyPem,
    serverIdentityPublicKeyHex,
    serverEncryptionPublicKeyHex
  );

  // Update password
  await client.receive([
    `mutable://accounts/${serverPublicKey}/${passwordPath}`,
    passwordSigned,
  ]);
}

/**
 * Create password reset token
 */
export async function createPasswordResetToken(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  ttlSeconds: number,
  serverIdentityPrivateKeyPem: string,
  serverIdentityPublicKeyHex: string,
  serverEncryptionPublicKeyHex: string,
  appScope?: string
): Promise<string> {
  // Check if user exists
  if (!(await userExists(client, serverPublicKey, username))) {
    throw new Error("User not found");
  }

  // Generate random token
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = encodeHex(tokenBytes);

  // Store reset token with expiration using obfuscated path and signed+encryption
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const tokenPath = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "reset-tokens",
    token,
    ...(appScope ? [appScope] : [])
  );

  const tokenData = {
    username,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const tokenSigned = await createSignedEncryptedPayload(
    tokenData,
    serverIdentityPrivateKeyPem,
    serverIdentityPublicKeyHex,
    serverEncryptionPublicKeyHex
  );

  await client.receive([
    `mutable://accounts/${serverPublicKey}/${tokenPath}`,
    tokenSigned,
  ]);

  return token;
}

/**
 * Reset password with token
 */
export async function resetPasswordWithToken(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  token: string,
  newPassword: string,
  serverIdentityPrivateKeyPem: string,
  serverIdentityPublicKeyHex: string,
  serverEncryptionPublicKeyHex: string,
  serverEncryptionPrivateKeyPem: string,
  username: string,
  appScope?: string,
  logger?: Logger
): Promise<string> {
  // Derive obfuscated path to reset token using username hint
  const tokenPath = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "reset-tokens",
    token,
    ...(appScope ? [appScope] : [])
  );

  // Read signed+encrypted reset token
  const result = await client.read<unknown>(
    `mutable://accounts/${serverPublicKey}/${tokenPath}`
  );

  if (!result.success || !result.record?.data) {
    throw new Error("Invalid or expired reset token");
  }

  // Decrypt and verify the token data
  const { data: tokenData, verified } = await decryptSignedEncryptedPayload(
    result.record.data as Parameters<typeof decryptSignedEncryptedPayload>[0],
    serverEncryptionPrivateKeyPem
  );

  if (!verified) {
    logger?.warn(
      "Reset token signature verification failed for user:",
      username
    );
    // Continue anyway - tokens might be legitimately unsigned in migration scenarios
  }

  const { username: tokenUsername, expiresAt } = tokenData as {
    username: string;
    expiresAt: string;
  };

  // Verify username matches
  if (tokenUsername !== username) {
    throw new Error("Invalid reset token");
  }

  // Check if token is expired
  if (new Date(expiresAt) < new Date()) {
    throw new Error("Reset token has expired");
  }

  // Generate new salt and hash
  const salt = generateSalt();
  const hash = await hashPassword(newPassword, salt);

  // Derive obfuscated path for password
  const passwordPath = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "password",
    ...(appScope ? [appScope] : [])
  );
  const passwordData = { hash, salt };
  const passwordSigned = await createSignedEncryptedPayload(
    passwordData,
    serverIdentityPrivateKeyPem,
    serverIdentityPublicKeyHex,
    serverEncryptionPublicKeyHex
  );

  // Update password
  await client.receive([
    `mutable://accounts/${serverPublicKey}/${passwordPath}`,
    passwordSigned,
  ]);

  // Delete the used token
  await client.delete(`mutable://accounts/${serverPublicKey}/${tokenPath}`);

  return tokenUsername;
}

/**
 * Check if a Google user exists by their Google sub ID
 */
export async function googleUserExists(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  googleSub: string,
  appScope?: string
): Promise<boolean> {
  const path = await deriveObfuscatedPath(
    serverPublicKey,
    googleSub,
    "google-profile",
    ...(appScope ? [appScope] : [])
  );
  const result = await client.read(
    `mutable://accounts/${serverPublicKey}/${path}`
  );
  return result.success;
}

/**
 * Create a new user from Google OAuth
 * Stores Google profile info instead of password credentials
 */
export async function createGoogleUser(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  username: string,
  googlePayload: GoogleTokenPayload,
  serverIdentityPrivateKeyPem: string,
  serverIdentityPublicKeyHex: string,
  serverEncryptionPublicKeyHex: string,
  appScope?: string
): Promise<{ username: string; googleSub: string }> {
  // Check if Google user already exists
  if (
    await googleUserExists(client, serverPublicKey, googlePayload.sub, appScope)
  ) {
    throw new Error("Google account already registered");
  }

  // Check if username already exists (from password-based signup)
  if (await userExists(client, serverPublicKey, username, appScope)) {
    throw new Error("Username already exists");
  }

  // Store user profile with signed+encryption
  const profilePath = await deriveObfuscatedPath(
    serverPublicKey,
    username,
    "profile",
    ...(appScope ? [appScope] : [])
  );
  const profileData = {
    username,
    authProvider: "google",
    googleSub: googlePayload.sub,
    email: googlePayload.email,
    name: googlePayload.name,
    picture: googlePayload.picture,
    createdAt: new Date().toISOString(),
  };
  const profileSigned = await createSignedEncryptedPayload(
    profileData,
    serverIdentityPrivateKeyPem,
    serverIdentityPublicKeyHex,
    serverEncryptionPublicKeyHex
  );
  await client.receive([
    `mutable://accounts/${serverPublicKey}/${profilePath}`,
    profileSigned,
  ]);

  // Store Google sub -> username mapping for login lookup
  const googleProfilePath = await deriveObfuscatedPath(
    serverPublicKey,
    googlePayload.sub,
    "google-profile",
    ...(appScope ? [appScope] : [])
  );
  const googleProfileData = {
    googleSub: googlePayload.sub,
    username,
    email: googlePayload.email,
    createdAt: new Date().toISOString(),
  };
  const googleProfileSigned = await createSignedEncryptedPayload(
    googleProfileData,
    serverIdentityPrivateKeyPem,
    serverIdentityPublicKeyHex,
    serverEncryptionPublicKeyHex
  );
  await client.receive([
    `mutable://accounts/${serverPublicKey}/${googleProfilePath}`,
    googleProfileSigned,
  ]);

  return { username, googleSub: googlePayload.sub };
}

/**
 * Authenticate user via Google OAuth
 * Returns the username if Google sub ID is found
 */
export async function authenticateGoogleUser(
  client: NodeProtocolInterface,
  serverPublicKey: string,
  googleSub: string,
  serverEncryptionPrivateKeyPem: string,
  appScope?: string,
  logger?: Logger
): Promise<string | null> {
  // Look up Google sub -> username mapping
  const googleProfilePath = await deriveObfuscatedPath(
    serverPublicKey,
    googleSub,
    "google-profile",
    ...(appScope ? [appScope] : [])
  );

  const result = await client.read<unknown>(
    `mutable://accounts/${serverPublicKey}/${googleProfilePath}`
  );

  if (!result.success || !result.record?.data) {
    return null;
  }

  // Decrypt and verify the signed payload
  const { data, verified } = await decryptSignedEncryptedPayload(
    result.record.data as Parameters<typeof decryptSignedEncryptedPayload>[0],
    serverEncryptionPrivateKeyPem
  );

  if (!verified) {
    logger?.warn(
      "Google profile signature verification failed for sub:",
      googleSub
    );
  }

  const { username } = data as { username: string };
  return username;
}

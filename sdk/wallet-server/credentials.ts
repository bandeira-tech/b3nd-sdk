/**
 * Credential System
 *
 * Unified abstraction for different authentication methods (password, OAuth providers, etc.)
 * Each credential type has a handler that implements signup and login logic.
 */

import type { NodeProtocolInterface } from "../src/types.ts";
import type { Logger, HttpFetch } from "./interfaces.ts";
import {
  createUser,
  authenticateUser,
  createGoogleUser,
  authenticateGoogleUser,
} from "./auth.ts";
import {
  verifyGoogleIdToken,
  generateGoogleUsername,
} from "./google-oauth.ts";
import type { GoogleTokenPayload } from "./google-oauth.ts";
import { generateUserKeys } from "./keys.ts";

/**
 * Standard credential signup/login result
 */
export interface CredentialResult {
  username: string;
  metadata?: Record<string, unknown>; // Provider-specific metadata (email, picture, etc.)
}

/**
 * Base credential payload
 */
export interface BaseCredentialPayload {
  type: string;
  session?: string; // Required for login, not for signup
}

/**
 * Password credential payload
 */
export interface PasswordCredentialPayload extends BaseCredentialPayload {
  type: "password";
  username: string;
  password: string;
}

/**
 * Google OAuth credential payload
 */
export interface GoogleCredentialPayload extends BaseCredentialPayload {
  type: "google";
  googleIdToken: string;
}

/**
 * Union of all credential payload types
 */
export type CredentialPayload =
  | PasswordCredentialPayload
  | GoogleCredentialPayload;

/**
 * Credential handler interface
 */
export interface CredentialHandler<
  T extends BaseCredentialPayload = BaseCredentialPayload
> {
  /**
   * Handle signup with this credential type
   */
  signup(payload: T, context: CredentialContext): Promise<CredentialResult>;

  /**
   * Handle login with this credential type
   */
  login(payload: T, context: CredentialContext): Promise<CredentialResult>;
}

/**
 * Context passed to credential handlers
 */
export interface CredentialContext {
  client: NodeProtocolInterface;
  serverPublicKey: string;
  serverIdentityPrivateKeyPem: string;
  serverIdentityPublicKeyHex: string;
  serverEncryptionPublicKeyHex: string;
  serverEncryptionPrivateKeyPem: string;
  appKey: string;
  googleClientId?: string | null;
  logger?: Logger;
  fetch?: HttpFetch;
}

/**
 * Password credential handler
 */
class PasswordCredentialHandler
  implements CredentialHandler<PasswordCredentialPayload>
{
  async signup(
    payload: PasswordCredentialPayload,
    context: CredentialContext
  ): Promise<CredentialResult> {
    const { username, password } = payload;

    if (!username || typeof username !== "string") {
      throw new Error("username is required");
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      throw new Error(
        "password is required and must be at least 8 characters"
      );
    }

    context.logger?.log(`Creating password user: ${username}`);
    await createUser(
      context.client,
      context.serverPublicKey,
      username,
      password,
      context.serverIdentityPrivateKeyPem,
      context.serverIdentityPublicKeyHex,
      context.serverEncryptionPublicKeyHex,
      context.appKey
    );
    context.logger?.log(`Password user created: ${username}`);

    // Generate user keys
    context.logger?.log(`Generating keys for user: ${username}`);
    await generateUserKeys(
      context.client,
      context.serverPublicKey,
      username,
      context.serverIdentityPrivateKeyPem,
      context.serverIdentityPublicKeyHex,
      context.serverEncryptionPublicKeyHex
    );
    context.logger?.log(`Keys generated for user: ${username}`);

    return { username };
  }

  async login(
    payload: PasswordCredentialPayload,
    context: CredentialContext
  ): Promise<CredentialResult> {
    const { username, password } = payload;

    if (!username || !password) {
      throw new Error("username and password are required");
    }

    // Verify credentials
    const isValid = await authenticateUser(
      context.client,
      context.serverPublicKey,
      username,
      password,
      context.serverIdentityPublicKeyHex,
      context.serverEncryptionPrivateKeyPem,
      context.appKey,
      context.logger
    );

    if (!isValid) {
      throw new Error("Invalid username or password");
    }

    return { username };
  }
}

/**
 * Google OAuth credential handler
 */
class GoogleCredentialHandler
  implements CredentialHandler<GoogleCredentialPayload>
{
  async signup(
    payload: GoogleCredentialPayload,
    context: CredentialContext
  ): Promise<CredentialResult> {
    if (!context.googleClientId) {
      throw new Error("Google OAuth is not configured");
    }

    const { googleIdToken } = payload;

    if (!googleIdToken || typeof googleIdToken !== "string") {
      throw new Error("googleIdToken is required");
    }

    // Verify Google ID token
    context.logger?.log("Verifying Google ID token...");
    const googlePayload = await verifyGoogleIdToken(
      googleIdToken,
      context.googleClientId,
      context.fetch
    );
    context.logger?.log(`Google token verified for: ${googlePayload.email}`);

    // Generate a username from Google sub
    const username = await generateGoogleUsername(googlePayload.sub);
    context.logger?.log(`Creating Google user: ${username}`);

    // Create user with Google profile
    await createGoogleUser(
      context.client,
      context.serverPublicKey,
      username,
      googlePayload,
      context.serverIdentityPrivateKeyPem,
      context.serverIdentityPublicKeyHex,
      context.serverEncryptionPublicKeyHex,
      context.appKey
    );
    context.logger?.log(`Google user created: ${username}`);

    // Generate user keys
    context.logger?.log(`Generating keys for Google user: ${username}`);
    await generateUserKeys(
      context.client,
      context.serverPublicKey,
      username,
      context.serverIdentityPrivateKeyPem,
      context.serverIdentityPublicKeyHex,
      context.serverEncryptionPublicKeyHex
    );
    context.logger?.log(`Keys generated for Google user: ${username}`);

    return {
      username,
      metadata: {
        email: googlePayload.email,
        name: googlePayload.name,
        picture: googlePayload.picture,
      },
    };
  }

  async login(
    payload: GoogleCredentialPayload,
    context: CredentialContext
  ): Promise<CredentialResult> {
    if (!context.googleClientId) {
      throw new Error("Google OAuth is not configured");
    }

    const { googleIdToken } = payload;

    if (!googleIdToken || typeof googleIdToken !== "string") {
      throw new Error("googleIdToken is required");
    }

    // Verify Google ID token
    context.logger?.log("Verifying Google ID token for login...");
    const googlePayload = await verifyGoogleIdToken(
      googleIdToken,
      context.googleClientId,
      context.fetch
    );
    context.logger?.log(`Google token verified for: ${googlePayload.email}`);

    // Look up user by Google sub
    const username = await authenticateGoogleUser(
      context.client,
      context.serverPublicKey,
      googlePayload.sub,
      context.serverEncryptionPrivateKeyPem,
      context.appKey,
      context.logger
    );

    if (!username) {
      throw new Error("Google account not registered. Please sign up first.");
    }

    context.logger?.log(`Google login successful for user: ${username}`);

    return {
      username,
      metadata: {
        email: googlePayload.email,
        name: googlePayload.name,
        picture: googlePayload.picture,
      },
    };
  }
}

/**
 * Credential handler registry
 */
const credentialHandlers = new Map<string, CredentialHandler>([
  ["password", new PasswordCredentialHandler()],
  ["google", new GoogleCredentialHandler()],
]);

/**
 * Get a credential handler by type
 */
export function getCredentialHandler(type: string): CredentialHandler {
  const handler = credentialHandlers.get(type);
  if (!handler) {
    throw new Error(`Unknown credential type: ${type}`);
  }
  return handler;
}

/**
 * Register a new credential handler
 */
export function registerCredentialHandler(
  type: string,
  handler: CredentialHandler
): void {
  credentialHandlers.set(type, handler);
}

/**
 * Get list of supported credential types
 */
export function getSupportedCredentialTypes(): string[] {
  return Array.from(credentialHandlers.keys());
}

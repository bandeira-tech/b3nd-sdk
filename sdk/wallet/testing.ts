/**
 * Test Utilities for B3nd Wallet
 *
 * Provides helpers for setting up test environments with shared in-memory storage.
 *
 * @example
 * ```typescript
 * import { createTestEnvironment } from "@bandeira-tech/b3nd-web/wallet";
 *
 * const { backend, wallet, signupTestUser, cleanup } = await createTestEnvironment();
 *
 * // Sign up a test user
 * const { session, keys } = await signupTestUser("app-key", "testuser", "pass123");
 *
 * // Now wallet.proxyRead/proxyWrite work with the shared backend
 * const writeResult = await wallet.proxyWrite({ uri: "mutable://data/test", data: { foo: "bar" }, encrypt: true });
 * const readResult = await wallet.proxyRead({ uri: "mutable://data/test" });
 * console.log(readResult.decrypted); // { foo: "bar" }
 *
 * // Direct backend access also works
 * const raw = await backend.read("mutable://data/test");
 * ```
 */

import type { Schema } from "../src/types.ts";
import type { AuthSession, UserPublicKeys, SessionKeypair } from "./types.ts";
import { MemoryClient, createTestSchema } from "../clients/memory/mod.ts";
import { MemoryWalletClient, generateTestServerKeys } from "./memory-client.ts";
import type { MemoryWalletClientConfig } from "./memory-client.ts";
import type { ServerKeys } from "../wallet-server/types.ts";
import { generateSigningKeyPair } from "../encrypt/mod.ts";

/**
 * Test environment configuration
 */
export interface TestEnvironmentConfig {
  /**
   * Custom schema for the backend.
   * If not provided, uses createTestSchema() which accepts all writes.
   */
  schema?: Schema;

  /**
   * Custom server keys.
   * If not provided, keys are auto-generated.
   */
  serverKeys?: ServerKeys;

  /**
   * Custom JWT secret.
   * Defaults to a test secret.
   */
  jwtSecret?: string;
}

/**
 * Test environment with shared backend
 */
export interface TestEnvironment {
  /**
   * The shared in-memory backend storage.
   * Use this for direct reads/writes in tests.
   */
  backend: MemoryClient;

  /**
   * The wallet client connected to the shared backend.
   * Same API as WalletClient but runs in-memory.
   */
  wallet: MemoryWalletClient;

  /**
   * Server keys (for advanced testing)
   */
  serverKeys: ServerKeys;

  /**
   * Sign up a test user and set the session.
   * Automatically generates and approves a session keypair for testing.
   *
   * @param appKey - App key for the signup
   * @param username - Username
   * @param password - Password
   * @returns Session, user public keys, and the session keypair used
   */
  signupTestUser(
    appKey: string,
    username: string,
    password: string
  ): Promise<{ session: AuthSession; keys: UserPublicKeys; sessionKeypair: SessionKeypair }>;

  /**
   * Login a test user and set the session.
   * Automatically generates and approves a session keypair for testing.
   *
   * @param appKey - App key for the login
   * @param username - Username
   * @param password - Password
   * @returns Session, user public keys, and the session keypair used
   */
  loginTestUser(
    appKey: string,
    username: string,
    password: string
  ): Promise<{ session: AuthSession; keys: UserPublicKeys; sessionKeypair: SessionKeypair }>;

  /**
   * Clean up the test environment.
   * Clears all data from the backend.
   */
  cleanup(): Promise<void>;
}

/**
 * Create a test environment with shared in-memory backend.
 *
 * This sets up a MemoryClient and MemoryWalletClient that share the same storage,
 * enabling you to test wallet operations alongside direct backend access.
 *
 * @param config - Optional configuration
 * @returns Test environment with backend, wallet, and helper functions
 *
 * @example
 * ```typescript
 * // Basic usage
 * const { backend, wallet, signupTestUser } = await createTestEnvironment();
 * const { keys } = await signupTestUser("my-app", "alice", "password123");
 *
 * // Write encrypted data
 * await wallet.proxyWrite({
 *   uri: "mutable://data/:key/profile",
 *   data: { name: "Alice" },
 *   encrypt: true
 * });
 *
 * // Read and decrypt
 * const result = await wallet.proxyRead({ uri: "mutable://data/:key/profile" });
 * console.log(result.decrypted); // { name: "Alice" }
 * ```
 *
 * @example
 * ```typescript
 * // With custom schema
 * const { backend, wallet } = await createTestEnvironment({
 *   schema: {
 *     "mutable://myapp": async () => ({ valid: true }),
 *     "mutable://accounts": async () => ({ valid: true }),
 *     "immutable://accounts": async () => ({ valid: true }),
 *   }
 * });
 * ```
 */
export async function createTestEnvironment(
  config: TestEnvironmentConfig = {}
): Promise<TestEnvironment> {
  const schema = config.schema || createTestSchema();
  const serverKeys = config.serverKeys || (await generateTestServerKeys());

  // Create shared backend
  const backend = new MemoryClient({ schema });

  // Create wallet client with shared backend
  const walletConfig: MemoryWalletClientConfig = {
    serverKeys,
    jwtSecret: config.jwtSecret,
    backend,
  };
  const wallet = await MemoryWalletClient.create(walletConfig);

  return {
    backend,
    wallet,
    serverKeys,

    async signupTestUser(
      appKey: string,
      username: string,
      password: string
    ): Promise<{ session: AuthSession; keys: UserPublicKeys; sessionKeypair: SessionKeypair }> {
      // Generate a session keypair
      const keypair = await generateSigningKeyPair();
      const sessionKeypair: SessionKeypair = {
        publicKeyHex: keypair.publicKeyHex,
        privateKeyHex: keypair.privateKeyHex,
      };

      // Approve the session by writing to the backend (simulates app approval)
      const sessionUri = `mutable://accounts/${appKey}/sessions/${sessionKeypair.publicKeyHex}`;
      await backend.write(sessionUri, 1);

      // Now signup with the approved session
      const session = await wallet.signup(appKey, sessionKeypair, { type: 'password', username, password });
      wallet.setSession(session);
      const keys = await wallet.getPublicKeys(appKey);
      return { session, keys, sessionKeypair };
    },

    async loginTestUser(
      appKey: string,
      username: string,
      password: string
    ): Promise<{ session: AuthSession; keys: UserPublicKeys; sessionKeypair: SessionKeypair }> {
      // Generate a session keypair
      const keypair = await generateSigningKeyPair();
      const sessionKeypair: SessionKeypair = {
        publicKeyHex: keypair.publicKeyHex,
        privateKeyHex: keypair.privateKeyHex,
      };

      // Approve the session by writing to the backend (simulates app approval)
      const sessionUri = `mutable://accounts/${appKey}/sessions/${sessionKeypair.publicKeyHex}`;
      await backend.write(sessionUri, 1);

      // Now login with the approved session
      const session = await wallet.login(appKey, sessionKeypair, { type: 'password', username, password });
      wallet.setSession(session);
      const keys = await wallet.getPublicKeys(appKey);
      return { session, keys, sessionKeypair };
    },

    async cleanup(): Promise<void> {
      await backend.cleanup();
      wallet.logout();
    },
  };
}

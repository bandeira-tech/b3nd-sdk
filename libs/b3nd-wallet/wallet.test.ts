/**
 * Wallet Session Authentication Tests
 *
 * Tests the session keypair authentication flow:
 * 1. Session keypair generation
 * 2. Session approval (writing 1 to mutable://accounts/{appKey}/sessions/{sessionPubkey})
 * 3. Login with signed payload
 * 4. Session validation (approved vs revoked)
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  generateTestServerKeys,
  MemoryWalletClient,
} from "./memory-client.ts";
import { generateSessionKeypair } from "./client.ts";
import { MemoryClient } from "../b3nd-sdk/clients/memory/mod.ts";
import { generateSigningKeyPair, signWithHex, verify } from "../b3nd-encrypt/mod.ts";

// Test app key (generated once for all tests)
let testAppKey: string;

async function createTestAppKey(): Promise<string> {
  const keypair = await generateSigningKeyPair();
  return keypair.publicKeyHex;
}

Deno.test("generateSessionKeypair - creates valid Ed25519 keypair", async () => {
  const session = await generateSessionKeypair();

  // Check structure
  assertEquals(typeof session.publicKeyHex, "string");
  assertEquals(typeof session.privateKeyHex, "string");

  // Ed25519 public keys are 32 bytes = 64 hex chars
  assertEquals(session.publicKeyHex.length, 64);

  // Verify the keypair works for signing
  const testPayload = { message: "test" };
  const signature = await signWithHex(session.privateKeyHex, testPayload);
  const verified = await verify(session.publicKeyHex, signature, testPayload);

  assertEquals(verified, true);
});

Deno.test("generateSessionKeypair - creates unique keypairs", async () => {
  const session1 = await generateSessionKeypair();
  const session2 = await generateSessionKeypair();

  // Each call should generate a different keypair
  assertEquals(session1.publicKeyHex !== session2.publicKeyHex, true);
  assertEquals(session1.privateKeyHex !== session2.privateKeyHex, true);
});

Deno.test("MemoryWalletClient - signup works with approved session", async () => {
  const appKey = await createTestAppKey();
  const backend = new MemoryClient({
    schema: {
      "mutable://accounts": async () => ({ valid: true }),
      "immutable://accounts": async () => ({ valid: true }),
    },
  });

  const wallet = await MemoryWalletClient.create({ backend });

  // Generate and approve session before signup
  const sessionKeypair = await generateSessionKeypair();
  const sessionUri =
    `mutable://accounts/${appKey}/sessions/${sessionKeypair.publicKeyHex}`;
  await backend.receive([sessionUri, 1]);

  const session = await wallet.signup(appKey, sessionKeypair, {
    type: "password",
    username: "testuser",
    password: "testpass123",
  });

  assertEquals(typeof session.token, "string");
  assertEquals(session.username, "testuser");
  assertEquals(typeof session.expiresIn, "number");
});

Deno.test("MemoryWalletClient - signup fails without session approval", async () => {
  const appKey = await createTestAppKey();
  const backend = new MemoryClient({
    schema: {
      "mutable://accounts": async () => ({ valid: true }),
      "immutable://accounts": async () => ({ valid: true }),
    },
  });

  const wallet = await MemoryWalletClient.create({ backend });

  // Generate session but don't approve it
  const sessionKeypair = await generateSessionKeypair();

  // Signup should fail - session not approved
  await assertRejects(
    async () => {
      await wallet.signup(appKey, sessionKeypair, {
        type: "password",
        username: "testuser",
        password: "testpass123",
      });
    },
    Error,
    "not approved",
  );
});

Deno.test("MemoryWalletClient - login fails without session approval", async () => {
  const appKey = await createTestAppKey();
  const backend = new MemoryClient({
    schema: {
      "mutable://accounts": async () => ({ valid: true }),
      "immutable://accounts": async () => ({ valid: true }),
    },
  });

  const wallet = await MemoryWalletClient.create({ backend });

  // First signup with approved session
  const signupSession = await generateSessionKeypair();
  await backend.receive([
    `mutable://accounts/${appKey}/sessions/${signupSession.publicKeyHex}`,
    1,
  ]);
  await wallet.signup(appKey, signupSession, {
    type: "password",
    username: "testuser",
    password: "testpass123",
  });
  wallet.logout();

  // Generate session but don't approve it
  const sessionKeypair = await generateSessionKeypair();

  // Login should fail - session not approved
  await assertRejects(
    async () => {
      await wallet.login(appKey, sessionKeypair, {
        type: "password",
        username: "testuser",
        password: "testpass123",
      });
    },
    Error,
    "not approved",
  );
});

Deno.test("MemoryWalletClient - login succeeds with approved session", async () => {
  const appKey = await createTestAppKey();
  const backend = new MemoryClient({
    schema: {
      "mutable://accounts": async () => ({ valid: true }),
      "immutable://accounts": async () => ({ valid: true }),
    },
  });

  const wallet = await MemoryWalletClient.create({ backend });

  // First signup with approved session
  const signupSession = await generateSessionKeypair();
  await backend.receive([
    `mutable://accounts/${appKey}/sessions/${signupSession.publicKeyHex}`,
    1,
  ]);
  await wallet.signup(appKey, signupSession, {
    type: "password",
    username: "testuser",
    password: "testpass123",
  });
  wallet.logout();

  // Generate session and approve it
  const sessionKeypair = await generateSessionKeypair();
  const sessionUri =
    `mutable://accounts/${appKey}/sessions/${sessionKeypair.publicKeyHex}`;
  await backend.receive([sessionUri, 1]); // Approve session

  // Login should succeed
  const session = await wallet.login(appKey, sessionKeypair, {
    type: "password",
    username: "testuser",
    password: "testpass123",
  });

  assertEquals(typeof session.token, "string");
  assertEquals(session.username, "testuser");
});

Deno.test("MemoryWalletClient - login fails with revoked session", async () => {
  const appKey = await createTestAppKey();
  const backend = new MemoryClient({
    schema: {
      "mutable://accounts": async () => ({ valid: true }),
      "immutable://accounts": async () => ({ valid: true }),
    },
  });

  const wallet = await MemoryWalletClient.create({ backend });

  // First signup with approved session
  const signupSession = await generateSessionKeypair();
  await backend.receive([
    `mutable://accounts/${appKey}/sessions/${signupSession.publicKeyHex}`,
    1,
  ]);
  await wallet.signup(appKey, signupSession, {
    type: "password",
    username: "testuser",
    password: "testpass123",
  });
  wallet.logout();

  // Generate session and set it as revoked (0)
  const sessionKeypair = await generateSessionKeypair();
  const sessionUri =
    `mutable://accounts/${appKey}/sessions/${sessionKeypair.publicKeyHex}`;
  await backend.receive([sessionUri, 0]); // Revoked session

  // Login should fail - session revoked
  await assertRejects(
    async () => {
      await wallet.login(appKey, sessionKeypair, {
        type: "password",
        username: "testuser",
        password: "testpass123",
      });
    },
    Error,
    "revoked",
  );
});

Deno.test("MemoryWalletClient - login fails with wrong password", async () => {
  const appKey = await createTestAppKey();
  const backend = new MemoryClient({
    schema: {
      "mutable://accounts": async () => ({ valid: true }),
      "immutable://accounts": async () => ({ valid: true }),
    },
  });

  const wallet = await MemoryWalletClient.create({ backend });

  // First signup with approved session
  const signupSession = await generateSessionKeypair();
  await backend.receive([
    `mutable://accounts/${appKey}/sessions/${signupSession.publicKeyHex}`,
    1,
  ]);
  await wallet.signup(appKey, signupSession, {
    type: "password",
    username: "testuser",
    password: "testpass123",
  });
  wallet.logout();

  // Generate and approve session
  const sessionKeypair = await generateSessionKeypair();
  const sessionUri =
    `mutable://accounts/${appKey}/sessions/${sessionKeypair.publicKeyHex}`;
  await backend.receive([sessionUri, 1]);

  // Login should fail - wrong password
  await assertRejects(
    async () => {
      await wallet.login(appKey, sessionKeypair, {
        type: "password",
        username: "testuser",
        password: "wrongpassword",
      });
    },
    Error,
  );
});

Deno.test("MemoryWalletClient - session signature is validated", async () => {
  const appKey = await createTestAppKey();
  const backend = new MemoryClient({
    schema: {
      "mutable://accounts": async () => ({ valid: true }),
      "immutable://accounts": async () => ({ valid: true }),
    },
  });

  const wallet = await MemoryWalletClient.create({ backend });

  // First signup with approved session
  const signupSession = await generateSessionKeypair();
  await backend.receive([
    `mutable://accounts/${appKey}/sessions/${signupSession.publicKeyHex}`,
    1,
  ]);
  await wallet.signup(appKey, signupSession, {
    type: "password",
    username: "testuser",
    password: "testpass123",
  });
  wallet.logout();

  // Generate two different sessions
  const sessionKeypair1 = await generateSessionKeypair();
  const sessionKeypair2 = await generateSessionKeypair();

  // Only approve session1
  const sessionUri1 =
    `mutable://accounts/${appKey}/sessions/${sessionKeypair1.publicKeyHex}`;
  await backend.receive([sessionUri1, 1]);

  // Try to login with session1's pubkey but session2's private key (wrong signature)
  const fakeKeypair = {
    publicKeyHex: sessionKeypair1.publicKeyHex,
    privateKeyHex: sessionKeypair2.privateKeyHex, // Wrong private key!
  };

  await assertRejects(
    async () => {
      await wallet.login(appKey, fakeKeypair, {
        type: "password",
        username: "testuser",
        password: "testpass123",
      });
    },
    Error,
    "signature",
  );
});

Deno.test("MemoryWalletClient - proxyWrite/proxyRead work after login", async () => {
  const appKey = await createTestAppKey();
  const backend = new MemoryClient({
    schema: {
      "mutable://accounts": async () => ({ valid: true }),
      "immutable://accounts": async () => ({ valid: true }),
      "mutable://data": async () => ({ valid: true }),
    },
  });

  const wallet = await MemoryWalletClient.create({ backend });

  // Signup with approved session
  const signupKeypair = await generateSessionKeypair();
  await backend.receive([
    `mutable://accounts/${appKey}/sessions/${signupKeypair.publicKeyHex}`,
    1,
  ]);
  const signupSession = await wallet.signup(appKey, signupKeypair, {
    type: "password",
    username: "testuser",
    password: "testpass123",
  });
  wallet.setSession(signupSession);

  // Get keys
  const keys = await wallet.getPublicKeys(appKey);
  assertEquals(typeof keys.accountPublicKeyHex, "string");
  assertEquals(typeof keys.encryptionPublicKeyHex, "string");

  // Write via proxy
  const writeUri = `mutable://data/${keys.accountPublicKeyHex}/profile`;
  const writeResult = await wallet.proxyWrite({
    uri: writeUri,
    data: { name: "Test User" },
    encrypt: false,
  });
  assertEquals(writeResult.success, true);

  // Read via proxy
  const readResult = await wallet.proxyRead({ uri: writeUri });
  assertEquals(readResult.success, true);
});

Deno.test("createTestEnvironment - loginTestUser generates and approves session", async () => {
  const { createTestEnvironment } = await import("../wallet/testing.ts");

  const env = await createTestEnvironment();
  const appKey = await createTestAppKey();

  // Signup first
  await env.signupTestUser(appKey, "alice", "alicepass123");
  env.wallet.logout();

  // loginTestUser should work (generates + approves session internally)
  const { session, keys, sessionKeypair } = await env.loginTestUser(
    appKey,
    "alice",
    "alicepass123",
  );

  assertEquals(typeof session.token, "string");
  assertEquals(session.username, "alice");
  assertEquals(typeof keys.accountPublicKeyHex, "string");
  assertEquals(typeof sessionKeypair.publicKeyHex, "string");

  await env.cleanup();
});

Deno.test("session flow - full authentication cycle", async () => {
  const appKey = await createTestAppKey();
  const backend = new MemoryClient({
    schema: {
      "mutable://accounts": async () => ({ valid: true }),
      "immutable://accounts": async () => ({ valid: true }),
    },
  });

  const wallet = await MemoryWalletClient.create({ backend });

  // 1. Signup (requires approved session)
  const signupSession = await generateSessionKeypair();
  await backend.receive([
    `mutable://accounts/${appKey}/sessions/${signupSession.publicKeyHex}`,
    1,
  ]);
  const signupResult = await wallet.signup(appKey, signupSession, {
    type: "password",
    username: "fulltest",
    password: "fullpass123",
  });
  assertEquals(signupResult.username, "fulltest");
  wallet.logout();

  // 2. Generate session keypair
  const session1 = await generateSessionKeypair();

  // 3. Approve session (simulates app server approval)
  await backend.receive([
    `mutable://accounts/${appKey}/sessions/${session1.publicKeyHex}`,
    1,
  ]);

  // 4. Login with approved session
  const loginResult = await wallet.login(appKey, session1, {
    type: "password",
    username: "fulltest",
    password: "fullpass123",
  });
  assertEquals(loginResult.username, "fulltest");

  // 5. Session can be reused multiple times
  wallet.logout();
  const loginResult2 = await wallet.login(appKey, session1, {
    type: "password",
    username: "fulltest",
    password: "fullpass123",
  });
  assertEquals(loginResult2.username, "fulltest");

  // 6. Revoke session
  await backend.receive([
    `mutable://accounts/${appKey}/sessions/${session1.publicKeyHex}`,
    0,
  ]);

  // 7. Login fails with revoked session
  wallet.logout();
  await assertRejects(
    async () => {
      await wallet.login(appKey, session1, {
        type: "password",
        username: "fulltest",
        password: "fullpass123",
      });
    },
    Error,
    "revoked",
  );

  // 8. New session works
  const session2 = await generateSessionKeypair();
  await backend.receive([
    `mutable://accounts/${appKey}/sessions/${session2.publicKeyHex}`,
    1,
  ]);

  const loginResult3 = await wallet.login(appKey, session2, {
    type: "password",
    username: "fulltest",
    password: "fullpass123",
  });
  assertEquals(loginResult3.username, "fulltest");
});

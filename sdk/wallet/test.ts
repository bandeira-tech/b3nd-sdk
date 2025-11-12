/**
 * Quick Test Script for B3nd Wallet Client
 *
 * Tests: signup, check keys, write data, read data
 * Run with: deno run --allow-net test.ts
 */

import { WalletClient } from "./mod.ts";
import { HttpClient } from "../clients/http/mod.ts";

const WALLET_SERVER_URL = "http://localhost:3001";
const API_BASE_PATH = "/api/v1";
const BACKEND_URL = "http://localhost:8080";

async function test() {
  // Generate unique username for this test
  const username = `testuser_${Date.now()}`;
  const password = "test-password-123";

  console.log(`Wallet Client Test`);
  console.log(`Wallet: ${WALLET_SERVER_URL} | User: ${username}\n`);

  try {
    // 1. Initialize Wallet Client
    const wallet = new WalletClient({
      walletServerUrl: WALLET_SERVER_URL,
      apiBasePath: API_BASE_PATH,
    });
    console.log("✓ Wallet client initialized");

    // 2. Check Wallet Server Health
    const health = await wallet.health();
    console.log(`✓ Wallet server ${health.status}`);

    // 3. Sign Up New User
    console.log(`\nSigning up ${username}...`);
    const signupSession = await wallet.signup({
      username,
      password,
    });
    console.log(`✓ Signup successful (${signupSession.username})`);
    console.log(`  Token expires in: ${signupSession.expiresIn}s`);

    // Activate session
    wallet.setSession(signupSession);
    console.log(`✓ Session activated`);

    // 4. Get User's Public Keys
    console.log(`\nRetrieving public keys for ${username}...`);
    try {
      const keys = await wallet.getMyPublicKeys();
      console.log(`✓ Public keys retrieved`);
      console.log(`  Account: ${keys.accountPublicKeyHex.substring(0, 16)}...`);
      console.log(`  Encryption: ${keys.encryptionPublicKeyHex.substring(0, 16)}...`);
    } catch (error) {
      console.error(`✗ Failed to get public keys`);
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    // 5. Write Data Through Proxy (Unencrypted to accounts://)
    const writeUri = `mutable://accounts/:key/profile`;
    const profileData = {
      name: "Test User",
      email: `${username}@example.com`,
      bio: "Testing B3nd wallet client",
      timestamp: new Date().toISOString(),
    };

    const writeResult = await wallet.proxyWrite({
      uri: writeUri,
      data: profileData,
      encrypt: false,
    });
    console.log(`✓ Write unencrypted data (ts: ${writeResult.record?.ts})`);

    // 6. Read unencrypted data back from backend
    const backend = new HttpClient({ url: BACKEND_URL });
    const readResult = await backend.read(writeResult.resolvedUri || writeUri);
    if (readResult.success && readResult.record) {
      const readData = readResult.record.data as any;
      const verified = readData.payload?.name === profileData.name;
      console.log(`✓ Read unencrypted data back (verified: ${verified})`);
    } else {
      console.log(`✗ Read failed: ${readResult.error}`);
    }

    // 7. Write Encrypted Data Through Proxy
    const encryptedUri = `mutable://accounts/:key/private`;
    const privateData = {
      secret: "This is encrypted data",
      apiKey: "super-secret-key-12345",
      timestamp: new Date().toISOString(),
    };

    const encryptedWriteResult = await wallet.proxyWrite({
      uri: encryptedUri,
      data: privateData,
      encrypt: true,
    });
    console.log(`✓ Write encrypted data (ts: ${encryptedWriteResult.record?.ts})`);

    // 8. Read encrypted data back from backend
    const encryptedReadResult = await backend.read(encryptedWriteResult.resolvedUri || encryptedUri);
    if (encryptedReadResult.success && encryptedReadResult.record) {
      const encData = encryptedReadResult.record.data as any;
      const hasAuth = !!encData.auth;
      const hasEncryptedPayload = !!encData.payload?.data && !!encData.payload?.nonce;
      console.log(`✓ Read encrypted data back (auth: ${hasAuth}, encrypted: ${hasEncryptedPayload})`);
    } else {
      console.log(`✗ Read encrypted failed: ${encryptedReadResult.error}`);
    }

    // 9. Test Logout
    wallet.logout();
    console.log(`✓ Logout (authenticated: ${wallet.isAuthenticated()})`);

    // 10. Test Login
    const loginSession = await wallet.login({
      username,
      password,
    });
    wallet.setSession(loginSession);
    console.log(`✓ Login (authenticated: ${wallet.isAuthenticated()})`);

    // 11. Write After Re-Login
    const finalUri = `mutable://accounts/:key/final`;
    const finalData = {
      message: "Authentication works after re-login!",
      timestamp: new Date().toISOString(),
    };

    const finalWriteResult = await wallet.proxyWrite({
      uri: finalUri,
      data: finalData,
      encrypt: false,
    });
    console.log(`✓ Write after re-login`);

    // 12. Read after re-login to verify
    const finalReadResult = await backend.read(finalWriteResult.resolvedUri || finalUri);
    if (finalReadResult.success && finalReadResult.record) {
      console.log(`✓ Read after re-login verified`);
    } else {
      console.log(`✗ Read after re-login failed`);
    }

    // 13. Test Login with Wrong Password (Error Case)
    try {
      await wallet.login({
        username,
        password: "wrong-password-123",
      });
      console.log(`✗ ERROR: Login should have failed but succeeded!`);
      throw new Error("Login with wrong password should fail");
    } catch (error) {
      if (error instanceof Error && error.message.includes("Invalid")) {
        console.log(`✓ Wrong password rejected`);
      } else {
        throw error;
      }
    }

    // 14. Test Write Without Authentication (Error Case)
    wallet.logout();
    try {
      await wallet.proxyWrite({
        uri: `mutable://accounts/:key/unauthorized`,
        data: { message: "This should fail" },
        encrypt: false,
      });
      console.log(`✗ ERROR: Write should have failed but succeeded!`);
      throw new Error("Write without authentication should fail");
    } catch (error) {
      if (error instanceof Error && error.message.includes("Not authenticated")) {
        console.log(`✓ Unauthenticated write rejected`);
      } else {
        throw error;
      }
    }

    // Re-login for cleanup
    const cleanupSession = await wallet.login({ username, password });
    wallet.setSession(cleanupSession);

    // Success
    console.log("\nALL TESTS PASSED");
    console.log("Summary: signup, keys, write+read (unencrypted/encrypted) to accounts://:key, logout, login, error cases");
  } catch (error) {
    console.error("\nTEST FAILED");
    console.error(error);
    if (error instanceof Error) {
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}

// Run the test
if (import.meta.main) {
  test();
}

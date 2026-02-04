/**
 * Quick Test Script for B3nd Wallet Client
 *
 * Tests: signup, check keys, write data, read data
 * Run with: deno run --allow-net test.ts
 */

import { WalletClient } from "./mod.ts";
import { AppsClient } from "../b3nd-apps/mod.ts";
import { HttpClient } from "../b3nd-sdk/clients/http/mod.ts";
import { createAuthenticatedMessage } from "../b3nd-encrypt/mod.ts";

const WALLET_SERVER_URL = "http://localhost:3001";
const API_BASE_PATH = "/api/v1";
const BACKEND_URL = "http://localhost:8080";
const APP_SERVER_URL = "http://localhost:3003";
const APP_API_BASE = "/api/v1";

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

    // 3. App Backend setup: register app, create session, then signup scoped to app
    console.log(`\nSetting up App Backend...`);
    const apps = new AppsClient({
      appServerUrl: APP_SERVER_URL,
      apiBasePath: APP_API_BASE,
    });
    await apps.health();
    const appKeys = await generateEd25519();
    const appKey = appKeys.publicKeyHex;
    const accountPrivateKeyPem = appKeys.privateKeyPem;
    const actions = [
      {
        action: "registerForReceiveUpdates",
        validation: { stringValue: { format: "email" } },
        write: {
          plain: "mutable://accounts/:key/subscribers/updates/:signature",
        },
      },
    ];
    const originsMsg = await createAppSignedMessage(
      appKey,
      accountPrivateKeyPem,
      { allowedOrigins: ["*"], encryptionPublicKeyHex: null },
    );
    await apps.updateOrigins(appKey, originsMsg);
    const schemaMsg = await createAppSignedMessage(
      appKey,
      accountPrivateKeyPem,
      { actions, encryptionPublicKeyHex: null },
    );
    await apps.updateSchema(appKey, schemaMsg);
    const sessionKey = crypto.randomUUID().replace(/-/g, "");
    const sessionMsg = await createAppSignedMessage(
      appKey,
      accountPrivateKeyPem,
      { session: sessionKey },
    );
    await apps.createSession(appKey, sessionMsg);
    console.log(`✓ App ready`);

    console.log(`\nSigning up ${username} (app-scoped)...`);
    const signupSession = await wallet.signupWithToken(appKey, {
      username,
      password,
    });
    console.log(`✓ Signup successful (${signupSession.username})`);
    console.log(`  Token expires in: ${signupSession.expiresIn}s`);

    wallet.setSession(signupSession);
    console.log(`✓ Session activated`);

    // 4. Get User's Public Keys
    console.log(`\nRetrieving public keys for ${username}...`);
    try {
      const keys = await wallet.getMyPublicKeys(appKey);
      console.log(`✓ Public keys retrieved`);
      console.log(`  Account: ${keys.accountPublicKeyHex.substring(0, 16)}...`);
      console.log(
        `  Encryption: ${keys.encryptionPublicKeyHex.substring(0, 16)}...`,
      );
    } catch (error) {
      console.error(`✗ Failed to get public keys`);
      console.error(
        `  Error: ${error instanceof Error ? error.message : String(error)}`,
      );
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
    console.log(
      `✓ Write encrypted data (ts: ${encryptedWriteResult.record?.ts})`,
    );

    // 8. Read encrypted data back from backend
    const encryptedReadResult = await backend.read(
      encryptedWriteResult.resolvedUri || encryptedUri,
    );
    if (encryptedReadResult.success && encryptedReadResult.record) {
      const encData = encryptedReadResult.record.data as any;
      const hasAuth = !!encData.auth;
      const hasEncryptedPayload = !!encData.payload?.data &&
        !!encData.payload?.nonce;
      console.log(
        `✓ Read encrypted data back (auth: ${hasAuth}, encrypted: ${hasEncryptedPayload})`,
      );
    } else {
      console.log(`✗ Read encrypted failed: ${encryptedReadResult.error}`);
    }

    // 9. Test Logout
    wallet.logout();
    console.log(`✓ Logout (authenticated: ${wallet.isAuthenticated()})`);

    // 10. Test Login
    const loginSession = await wallet.loginWithTokenSession(
      appKey,
      sessionKey,
      { username, password },
    );
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
    const finalReadResult = await backend.read(
      finalWriteResult.resolvedUri || finalUri,
    );
    if (finalReadResult.success && finalReadResult.record) {
      console.log(`✓ Read after re-login verified`);
    } else {
      console.log(`✗ Read after re-login failed`);
    }

    // 13. Test Login with Wrong Password (Error Case)
    try {
      await wallet.loginWithTokenSession(appKey, sessionKey, {
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
      if (
        error instanceof Error && error.message.includes("Not authenticated")
      ) {
        console.log(`✓ Unauthenticated write rejected`);
      } else {
        throw error;
      }
    }

    // Re-login for cleanup
    const cleanupSession = await wallet.loginWithTokenSession(
      appKey,
      sessionKey,
      { username, password },
    );
    wallet.setSession(cleanupSession);

    // Optional: invoke action via app backend
    const email = `${username}@example.com`;
    const signedInvoke = await createAppSignedMessage(
      appKey,
      accountPrivateKeyPem,
      email,
    );
    const invokeRes = await apps.invokeAction(
      appKey,
      "registerForReceiveUpdates",
      signedInvoke,
      "http://localhost",
    );
    console.log(`✓ Action invoked, wrote to ${invokeRes.uri}`);

    // Success
    console.log("\nALL TESTS PASSED");
    console.log(
      "Summary: signup, keys, write+read (unencrypted/encrypted) to accounts://:key, logout, login, error cases",
    );
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

// Helpers
async function pemToPrivateKey(pem: string): Promise<CryptoKey> {
  const base64 = pem.split("\n").filter((l) => !l.startsWith("-----")).join("");
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "Ed25519", namedCurve: "Ed25519" },
    false,
    ["sign"],
  );
}

async function createAppSignedMessage<T>(
  appKey: string,
  privateKeyPem: string,
  payload: T,
) {
  const privateKey = await pemToPrivateKey(privateKeyPem);
  return await createAuthenticatedMessage(payload, [{
    privateKey,
    publicKeyHex: appKey,
  }]);
}

async function generateEd25519(): Promise<
  { privateKeyPem: string; publicKeyHex: string }
> {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const privateKeyBuffer = await crypto.subtle.exportKey(
    "pkcs8",
    keyPair.privateKey,
  );
  const publicKeyBuffer = await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey,
  );
  const privateKeyBase64 = bytesToBase64(new Uint8Array(privateKeyBuffer));
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${
    privateKeyBase64.match(/.{1,64}/g)?.join("\n")
  }\n-----END PRIVATE KEY-----`;
  const publicKeyHex = [...new Uint8Array(publicKeyBuffer)].map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  return { privateKeyPem, publicKeyHex };
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

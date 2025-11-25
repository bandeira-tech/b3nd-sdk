/**
 * Example usage of the B3nd Wallet Client
 *
 * Run with: deno run --allow-net example.ts
 */

import { WalletClient } from "./mod.ts";

async function main() {
  // Create wallet client
  const wallet = new WalletClient({
    walletServerUrl: "http://localhost:3001",
    apiBasePath: "/api/v1",
  });
  const appKey = Deno.env.get("APP_KEY");
  if (!appKey) {
    throw new Error("APP_KEY is required (set to your wallet app public key)");
  }

  console.log("🔗 B3nd Wallet Client Example\n");

  try {
    // Check server health
    console.log("1️⃣  Checking server health...");
    const health = await wallet.health();
    console.log(`   ✅ Server is ${health.status} - ${health.server}`);
    console.log(`   ⏰ ${health.timestamp}\n`);

    // Generate random username for testing
    const username = `testuser_${Date.now()}`;
    const password = "secure-password-123";

    // Sign up a new user
    console.log(`2️⃣  Signing up new user: ${username}`);
    // App-scoped usage requires token and session from the App Backend
    throw new Error("Update this example: use signupWithToken/loginWithTokenSession with app token and session");
    console.log(`   ✅ Signed up successfully!`);
    console.log(`   👤 Username: ${session.username}`);
    console.log(`   🎫 Token: ${session.token.substring(0, 20)}...`);
    console.log(`   ⏳ Expires in: ${session.expiresIn} seconds`);

    // Activate the session (developer's choice)
    wallet.setSession(session);
    console.log(`   🔓 Session activated\n`);

    // Check authentication
    console.log("3️⃣  Checking authentication status...");
    console.log(`   ✅ Authenticated: ${wallet.isAuthenticated()}`);
    console.log(`   👤 Current user: ${wallet.getUsername()}\n`);

    // Get user's public keys
    console.log("4️⃣  Retrieving user public keys...");
    const keys = await wallet.getMyPublicKeys(appKey);
    console.log(`   🔑 Account key: ${keys.accountPublicKeyHex.substring(0, 16)}...`);
    console.log(
      `   🔐 Encryption key: ${keys.encryptionPublicKeyHex.substring(0, 16)}...\n`
    );

    // Proxy write (unencrypted)
    console.log("5️⃣  Writing data through proxy (unencrypted)...");
    await wallet.proxyWrite({
      uri: `mutable://data/example/${username}/profile`,
      data: {
        name: "Test User",
        bio: "Testing B3nd wallet client",
        timestamp: new Date().toISOString(),
      },
      encrypt: false,
    });
    console.log(`   ✅ Data written successfully\n`);

    // Proxy write (encrypted)
    console.log("6️⃣  Writing data through proxy (encrypted)...");
    await wallet.proxyWrite({
      uri: `mutable://data/example/${username}/private`,
      data: {
        secret: "This is encrypted data",
        timestamp: new Date().toISOString(),
      },
      encrypt: true,
    });
    console.log(`   ✅ Encrypted data written successfully\n`);

    // Change password
    console.log("7️⃣  Changing password...");
    const newPassword = "new-secure-password-456";
    await wallet.changePassword(appKey, password, newPassword);
    console.log(`   ✅ Password changed successfully\n`);

    // Logout
    console.log("8️⃣  Logging out...");
    wallet.logout();
    console.log(`   ✅ Logged out`);
    console.log(`   🔒 Authenticated: ${wallet.isAuthenticated()}\n`);

    // Login with new password
    console.log("9️⃣  Logging back in with new password...");
    const loginSession = await wallet.login({ username, password: newPassword });
    console.log(`   ✅ Logged in successfully!`);
    console.log(`   👤 Username: ${loginSession.username}`);

    // Activate the session
    wallet.setSession(loginSession);
    console.log(`   🔓 Session activated\n`);

    // Request password reset
    console.log("🔟 Requesting password reset...");
    const resetInfo = await wallet.requestPasswordReset(username);
    console.log(`   ✅ Reset token generated`);
    console.log(`   🎫 Token: ${resetInfo.resetToken.substring(0, 20)}...`);
    console.log(`   ⏳ Expires in: ${resetInfo.expiresIn} seconds\n`);

    // Get public keys for the current user (requires auth)
    console.log("1️⃣1️⃣  Getting my public keys again (requires auth)...");
    const publicKeys = await wallet.getMyPublicKeys(appKey);
    console.log(`   ✅ Retrieved public keys`);
    console.log(`   🔑 Account key: ${publicKeys.accountPublicKeyHex.substring(0, 16)}...`);
    console.log(
      `   🔐 Encryption key: ${publicKeys.encryptionPublicKeyHex.substring(0, 16)}...\n`
    );

    console.log("✨ All tests completed successfully!");
  } catch (error) {
    console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

// Run the example if this is the main module
if (import.meta.main) {
  main();
}

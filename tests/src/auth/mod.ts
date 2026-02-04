/**
 * Authentication E2E Test Module
 * Tests authentication, signature verification, and access control
 */

import {
  ApiClient,
  assert,
  assertEqual,
  assertExists,
  generateTestId,
  type TestConfig,
  TestRunner,
} from "../core/mod.ts";

import {
  type AuthenticatedMessage,
  CryptoManager,
  UserSimulator,
} from "../crypto/mod.ts";

export interface AuthTestOptions {
  config?: TestConfig;
  cleanupAfterTests?: boolean;
}

export class AuthTest {
  private apiClient: ApiClient;
  private testRunner: TestRunner;
  private userSimulator: UserSimulator;
  private cryptoManager: CryptoManager;
  private createdUris: Set<string> = new Set();

  constructor(private options: AuthTestOptions = {}) {
    this.apiClient = new ApiClient(options.config);
    this.testRunner = new TestRunner("Authentication Tests", options.config);
    this.userSimulator = new UserSimulator();
    this.cryptoManager = this.userSimulator.getCryptoManager();
  }

  async setup(): Promise<void> {
    console.log("📦 Setting up test users for authentication tests...");

    // Create test users with different roles
    await this.userSimulator.createUser("admin", true);
    await this.userSimulator.createUser("user1", true);
    await this.userSimulator.createUser("user2", true);
    await this.userSimulator.createUser("anonymous", false);

    console.log("  ✅ Created test users: admin, user1, user2, anonymous");
  }

  async cleanup(): Promise<void> {
    if (!this.options.cleanupAfterTests) {
      return;
    }

    console.log("\n🧹 Cleaning up test data...");

    for (const uri of this.createdUris) {
      try {
        await this.apiClient.delete(uri);
        console.log(`  Deleted: ${uri}`);
      } catch (error) {
        console.warn(`  Failed to delete ${uri}: ${error}`);
      }
    }

    this.createdUris.clear();
  }

  /**
   * Test single signature authentication
   */
  async testSingleSignature(): Promise<void> {
    const testId = generateTestId();
    const uri = `test://auth/single/${testId}`;

    const payload = {
      action: "create",
      resource: "document",
      timestamp: Date.now(),
      testId,
    };

    // Create authenticated message signed by user1
    const authMessage = await this.cryptoManager.createAuthenticatedMessage(
      ["user1"],
      payload,
    );

    // Write authenticated message
    const writeResult = await this.apiClient.write(uri, authMessage);
    assert(writeResult.success, "Write with single signature should succeed");
    this.createdUris.add(uri);

    // Read and verify
    const readResult = await this.apiClient.read(uri);
    assert(readResult.success, "Read authenticated message should succeed");
    assertExists(readResult.record, "Should return a record");

    const data = readResult.record.data as AuthenticatedMessage;
    assertEqual(data.auth.length, 1, "Should have one signature");

    // Verify the signature
    const verified = await this.cryptoManager.verify(
      data.auth[0].pubkey,
      data.auth[0].signature,
      data.payload,
    );
    assert(verified, "Signature should be valid");

    // Verify it's from the correct user
    const user1 = this.userSimulator.getUser("user1");
    assertEqual(
      data.auth[0].pubkey,
      user1?.signingKeys.publicKeyHex,
      "Public key should match user1",
    );
  }

  /**
   * Test multi-signature authentication
   */
  async testMultiSignature(): Promise<void> {
    const testId = generateTestId();
    const uri = `test://auth/multi/${testId}`;

    const payload = {
      action: "approve",
      document: "important-doc.pdf",
      timestamp: Date.now(),
      testId,
    };

    // Create multi-sig message (requires both admin and user1)
    const authMessage = await this.cryptoManager.createAuthenticatedMessage(
      ["admin", "user1"],
      payload,
    );

    // Write multi-sig message
    const writeResult = await this.apiClient.write(uri, authMessage);
    assert(writeResult.success, "Write with multi-signature should succeed");
    this.createdUris.add(uri);

    // Read and verify
    const readResult = await this.apiClient.read(uri);
    assert(readResult.success, "Read multi-sig message should succeed");
    assertExists(readResult.record, "Should return a record");

    const data = readResult.record.data as AuthenticatedMessage;
    assertEqual(data.auth.length, 2, "Should have two signatures");

    // Verify all signatures
    for (const authEntry of data.auth) {
      const verified = await this.cryptoManager.verify(
        authEntry.pubkey,
        authEntry.signature,
        data.payload,
      );
      assert(
        verified,
        `Signature from ${authEntry.pubkey.substring(0, 8)}... should be valid`,
      );
    }

    // Verify signers are correct
    const admin = this.userSimulator.getUser("admin");
    const user1 = this.userSimulator.getUser("user1");
    const pubkeys = data.auth.map((a) => a.pubkey);

    assert(
      pubkeys.includes(admin?.signingKeys.publicKeyHex || ""),
      "Should include admin's signature",
    );
    assert(
      pubkeys.includes(user1?.signingKeys.publicKeyHex || ""),
      "Should include user1's signature",
    );
  }

  /**
   * Test invalid signature detection
   */
  async testInvalidSignature(): Promise<void> {
    const testId = generateTestId();
    const uri = `test://auth/invalid/${testId}`;

    const payload = {
      action: "hack",
      target: "system",
      timestamp: Date.now(),
      testId,
    };

    // Create a valid authenticated message
    const authMessage = await this.cryptoManager.createAuthenticatedMessage(
      ["user2"],
      payload,
    );

    // Tamper with the signature
    const tamperedMessage = {
      ...authMessage,
      auth: [
        {
          pubkey: authMessage.auth[0].pubkey,
          signature: authMessage.auth[0].signature.slice(0, -4) + "HACK", // Corrupt signature
        },
      ],
    };

    // Write tampered message (API might accept it, but verification should fail)
    const writeResult = await this.apiClient.write(uri, tamperedMessage);

    if (writeResult.success) {
      this.createdUris.add(uri);

      // Read back
      const readResult = await this.apiClient.read(uri);
      assert(readResult.success, "Read should succeed");
      assertExists(readResult.record, "Should return a record");

      const data = readResult.record.data as AuthenticatedMessage;

      // Verify signature should fail
      const verified = await this.cryptoManager.verify(
        data.auth[0].pubkey,
        data.auth[0].signature,
        data.payload,
      );
      assert(!verified, "Tampered signature should be invalid");
    } else {
      // API rejected the tampered message, which is also correct behavior
      assert(
        writeResult.error?.includes("signature") ||
          writeResult.error?.includes("auth") ||
          writeResult.error?.includes("invalid"),
        "Should reject with signature-related error",
      );
    }
  }

  /**
   * Test signature with modified payload
   */
  async testModifiedPayload(): Promise<void> {
    const testId = generateTestId();

    const originalPayload = {
      amount: 100,
      recipient: "alice",
      timestamp: Date.now(),
      testId,
    };

    // Create authenticated message
    const authMessage = await this.cryptoManager.createAuthenticatedMessage(
      ["admin"],
      originalPayload,
    );

    // Modify the payload but keep the signature
    const modifiedMessage = {
      ...authMessage,
      payload: {
        ...originalPayload,
        amount: 1000000, // Changed amount
      },
    };

    // Verify signature with modified payload should fail
    const verified = await this.cryptoManager.verify(
      modifiedMessage.auth[0].pubkey,
      modifiedMessage.auth[0].signature,
      modifiedMessage.payload,
    );
    assert(!verified, "Signature should be invalid for modified payload");
  }

  /**
   * Test signature timestamp validation
   */
  async testTimestampValidation(): Promise<void> {
    const testId = generateTestId();
    const uri = `test://auth/timestamp/${testId}`;

    // Create payload with current timestamp
    const payload = {
      action: "time-sensitive",
      timestamp: Date.now(),
      testId,
    };

    const authMessage = await this.cryptoManager.createAuthenticatedMessage(
      ["user1"],
      payload,
    );

    // Write message
    const writeResult = await this.apiClient.write(uri, authMessage);
    assert(writeResult.success, "Write with timestamp should succeed");
    this.createdUris.add(uri);

    // Read and verify timestamp is preserved
    const readResult = await this.apiClient.read(uri);
    assert(readResult.success, "Read should succeed");
    assertExists(readResult.record, "Should return a record");

    const data = readResult.record.data as AuthenticatedMessage;
    assertEqual(
      data.payload.timestamp,
      payload.timestamp,
      "Timestamp should be preserved",
    );

    // Verify signature is still valid
    const verified = await this.cryptoManager.verify(
      data.auth[0].pubkey,
      data.auth[0].signature,
      data.payload,
    );
    assert(verified, "Signature should remain valid");
  }

  /**
   * Test hierarchical signature (signature of signature)
   */
  async testHierarchicalSignature(): Promise<void> {
    const testId = generateTestId();
    const uri = `test://auth/hierarchical/${testId}`;

    // First level: user1 signs the initial payload
    const initialPayload = {
      request: "promotion",
      employee: "user1",
      timestamp: Date.now(),
      testId,
    };

    const user1Message = await this.cryptoManager.createAuthenticatedMessage(
      ["user1"],
      initialPayload,
    );

    // Second level: admin signs the user1's signed message
    const adminMessage = await this.cryptoManager.createAuthenticatedMessage(
      ["admin"],
      user1Message,
    );

    // Write hierarchical message
    const writeResult = await this.apiClient.write(uri, adminMessage);
    assert(writeResult.success, "Write hierarchical signature should succeed");
    this.createdUris.add(uri);

    // Read and verify
    const readResult = await this.apiClient.read(uri);
    assert(readResult.success, "Read should succeed");
    assertExists(readResult.record, "Should return a record");

    const data = readResult.record.data as AuthenticatedMessage<
      AuthenticatedMessage
    >;

    // Verify admin's signature
    const adminVerified = await this.cryptoManager.verify(
      data.auth[0].pubkey,
      data.auth[0].signature,
      data.payload,
    );
    assert(adminVerified, "Admin signature should be valid");

    // Verify user1's signature within the payload
    const user1Verified = await this.cryptoManager.verify(
      data.payload.auth[0].pubkey,
      data.payload.auth[0].signature,
      data.payload.payload,
    );
    assert(user1Verified, "User1 signature should be valid");

    // Verify the chain of trust
    const admin = this.userSimulator.getUser("admin");
    const user1 = this.userSimulator.getUser("user1");

    assertEqual(
      data.auth[0].pubkey,
      admin?.signingKeys.publicKeyHex,
      "Top level should be signed by admin",
    );
    assertEqual(
      data.payload.auth[0].pubkey,
      user1?.signingKeys.publicKeyHex,
      "Inner level should be signed by user1",
    );
  }

  /**
   * Run all tests
   */
  async runAll(): Promise<void> {
    await this.setup();

    const tests = [
      { name: "Single Signature", fn: () => this.testSingleSignature() },
      { name: "Multi-Signature", fn: () => this.testMultiSignature() },
      {
        name: "Invalid Signature Detection",
        fn: () => this.testInvalidSignature(),
      },
      {
        name: "Modified Payload Detection",
        fn: () => this.testModifiedPayload(),
      },
      {
        name: "Timestamp Validation",
        fn: () => this.testTimestampValidation(),
      },
      {
        name: "Hierarchical Signatures",
        fn: () => this.testHierarchicalSignature(),
      },
    ];

    await this.testRunner.runAll(tests);
    await this.cleanup();
  }
}

// Export convenience function
export async function runAuthTests(
  options: AuthTestOptions = {},
): Promise<void> {
  const test = new AuthTest(options);
  await test.runAll();
}

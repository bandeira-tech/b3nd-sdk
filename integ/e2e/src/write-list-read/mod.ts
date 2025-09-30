/**
 * Write-List-Read E2E Test Module
 * Tests basic CRUD operations with encryption and authentication
 */

import {
  ApiClient,
  TestRunner,
  loadFixtures,
  assert,
  assertEqual,
  assertExists,
  generateTestId,
  delay,
  type Fixture,
  type TestConfig,
} from "../core/mod.ts";

import {
  CryptoManager,
  UserSimulator,
  type AuthenticatedMessage,
  type SignedEncryptedMessage,
} from "../crypto/mod.ts";

export interface WriteListReadTestOptions {
  config?: TestConfig;
  fixtures?: Fixture[];
  testEncryption?: boolean;
  testAuthentication?: boolean;
  cleanupAfterTests?: boolean;
}

export class WriteListReadTest {
  private apiClient: ApiClient;
  private testRunner: TestRunner;
  private userSimulator: UserSimulator;
  private cryptoManager: CryptoManager;
  private createdUris: Set<string> = new Set();

  constructor(private options: WriteListReadTestOptions = {}) {
    this.apiClient = new ApiClient(options.config);
    this.testRunner = new TestRunner("Write-List-Read Tests", options.config);
    this.userSimulator = new UserSimulator();
    this.cryptoManager = this.userSimulator.getCryptoManager();
  }

  async setup(): Promise<void> {
    console.log("📦 Setting up test users and keys...");

    // Create test users
    await this.userSimulator.createUser("alice", true);
    await this.userSimulator.createUser("bob", true);
    await this.userSimulator.createUser("charlie", false);

    console.log("  ✅ Created test users: alice, bob, charlie");
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
   * Test basic write operation
   */
  async testWrite(): Promise<void> {
    const testId = generateTestId();
    const uri = `test://write-test/${testId}`;
    const data = {
      message: "Test write operation",
      timestamp: Date.now(),
      testId,
    };

    const result = await this.apiClient.write(uri, data);

    assert(result.success, "Write operation should succeed");
    assertExists(result.record, "Write should return a record");
    assertEqual(result.record.data, data, "Written data should match input");

    this.createdUris.add(uri);
  }

  /**
   * Test list operation
   */
  async testList(): Promise<void> {
    // First, write multiple records
    const testId = generateTestId();
    const records = [];

    for (let i = 0; i < 3; i++) {
      const uri = `test://list-test/${testId}/${i}`;
      const data = {
        index: i,
        testId,
        timestamp: Date.now(),
      };

      await this.apiClient.write(uri, data);
      records.push({ uri, data });
      this.createdUris.add(uri);
    }

    // Wait a moment for consistency
    await delay(100);

    // List all records
    const listResult = await this.apiClient.list();
    assert(listResult.success, "List operation should succeed");
    assertExists(listResult.records, "List should return records");

    // Check if our records are in the list
    const ourRecords = listResult.records.filter(r =>
      r.uri.includes(`list-test/${testId}`)
    );

    assertEqual(
      ourRecords.length,
      records.length,
      `Should find all ${records.length} test records`
    );

    // Test list with pattern
    const patternResult = await this.apiClient.list(`*${testId}*`);
    assert(patternResult.success, "List with pattern should succeed");
    assertExists(patternResult.records, "Pattern list should return records");

    const patternRecords = patternResult.records.filter(r =>
      r.uri.includes(testId)
    );

    assert(
      patternRecords.length >= records.length,
      "Pattern should match our test records"
    );
  }

  /**
   * Test read operation
   */
  async testRead(): Promise<void> {
    const testId = generateTestId();
    const uri = `test://read-test/${testId}`;
    const data = {
      message: "Test read operation",
      timestamp: Date.now(),
      testId,
      nested: {
        value: "nested data",
        array: [1, 2, 3],
      },
    };

    // Write first
    const writeResult = await this.apiClient.write(uri, data);
    assert(writeResult.success, "Write should succeed before read test");
    this.createdUris.add(uri);

    // Read back
    const readResult = await this.apiClient.read(uri);

    assert(readResult.success, "Read operation should succeed");
    assertExists(readResult.record, "Read should return a record");
    assertEqual(readResult.record.data, data, "Read data should match written data");
    assert(readResult.record.ts > 0, "Record should have a valid timestamp");
  }

  /**
   * Test authenticated message write and read
   */
  async testAuthenticatedMessage(): Promise<void> {
    if (!this.options.testAuthentication) {
      return;
    }

    const testId = generateTestId();
    const uri = `test://auth-test/${testId}`;

    // Create payload
    const payload = {
      message: "Authenticated message",
      timestamp: Date.now(),
      testId,
    };

    // Create authenticated message signed by alice and bob
    const authMessage = await this.cryptoManager.createAuthenticatedMessage(
      ["alice", "bob"],
      payload
    );

    // Write authenticated message
    const writeResult = await this.apiClient.write(uri, authMessage);
    assert(writeResult.success, "Write of authenticated message should succeed");
    this.createdUris.add(uri);

    // Read back and verify
    const readResult = await this.apiClient.read(uri);
    assert(readResult.success, "Read of authenticated message should succeed");
    assertExists(readResult.record, "Should return a record");

    const readData = readResult.record.data as AuthenticatedMessage;
    assertExists(readData.auth, "Should have auth array");
    assertEqual(readData.auth.length, 2, "Should have 2 signatures");
    assertEqual(readData.payload, payload, "Payload should match");

    // Verify signatures
    for (const authEntry of readData.auth) {
      const verified = await this.cryptoManager.verify(
        authEntry.pubkey,
        authEntry.signature,
        readData.payload
      );
      assert(verified, `Signature from ${authEntry.pubkey.substring(0, 8)}... should be valid`);
    }
  }

  /**
   * Test encrypted payload write and read
   */
  async testEncryptedPayload(): Promise<void> {
    if (!this.options.testEncryption) {
      return;
    }

    const testId = generateTestId();
    const uri = `test://encrypt-test/${testId}`;

    // Create sensitive data
    const sensitiveData = {
      secret: "This is encrypted data",
      apiKey: "super-secret-key-12345",
      timestamp: Date.now(),
      testId,
    };

    // Get bob's encryption keys (recipient)
    const bob = this.userSimulator.getUser("bob");
    assertExists(bob?.encryptionKeys, "Bob should have encryption keys");

    // Encrypt data for bob
    const encrypted = await this.cryptoManager.encrypt(
      sensitiveData,
      bob.encryptionKeys.publicKeyHex
    );

    // Write encrypted data
    const writeResult = await this.apiClient.write(uri, encrypted);
    assert(writeResult.success, "Write of encrypted data should succeed");
    this.createdUris.add(uri);

    // Read back
    const readResult = await this.apiClient.read(uri);
    assert(readResult.success, "Read of encrypted data should succeed");
    assertExists(readResult.record, "Should return a record");

    // Decrypt with bob's private key
    const decrypted = await this.cryptoManager.decrypt(
      readResult.record.data as any,
      bob.encryptionKeys.privateKey
    );

    assertEqual(decrypted, sensitiveData, "Decrypted data should match original");
  }

  /**
   * Test signed and encrypted message
   */
  async testSignedEncryptedMessage(): Promise<void> {
    if (!this.options.testEncryption || !this.options.testAuthentication) {
      return;
    }

    const testId = generateTestId();
    const uri = `test://signed-encrypted-test/${testId}`;

    // Create sensitive data
    const sensitiveData = {
      message: "Signed and encrypted",
      secret: "confidential-data",
      timestamp: Date.now(),
      testId,
    };

    // Get bob's encryption keys (recipient)
    const bob = this.userSimulator.getUser("bob");
    assertExists(bob?.encryptionKeys, "Bob should have encryption keys");

    // Create signed and encrypted message (alice signs, bob receives)
    const signedEncrypted = await this.cryptoManager.createSignedEncryptedMessage(
      sensitiveData,
      ["alice"],
      bob.encryptionKeys.publicKeyHex
    );

    // Write message
    const writeResult = await this.apiClient.write(uri, signedEncrypted);
    assert(writeResult.success, "Write of signed encrypted message should succeed");
    this.createdUris.add(uri);

    // Read back
    const readResult = await this.apiClient.read(uri);
    assert(readResult.success, "Read of signed encrypted message should succeed");
    assertExists(readResult.record, "Should return a record");

    // Verify and decrypt
    const result = await this.cryptoManager.verifyAndDecrypt(
      readResult.record.data as SignedEncryptedMessage,
      bob.encryptionKeys.privateKey
    );

    assert(result.verified, "Signature should be verified");
    assertEqual(result.data, sensitiveData, "Decrypted data should match original");
    assert(result.signers.length === 1, "Should have one signer");

    const alice = this.userSimulator.getUser("alice");
    assert(
      result.signers[0] === alice?.signingKeys.publicKeyHex,
      "Signer should be alice"
    );
  }

  /**
   * Test with fixtures
   */
  async testWithFixtures(): Promise<void> {
    const fixtures = this.options.fixtures || await loadFixtures("fixtures");

    if (fixtures.length === 0) {
      console.log("  ⚠️  No fixtures found, skipping fixture tests");
      return;
    }

    for (const fixture of fixtures) {
      const testId = generateTestId();
      const uri = fixture.uri.includes("://")
        ? fixture.uri
        : `test://fixture/${fixture.name}/${testId}`;

      // Write fixture data
      const writeResult = await this.apiClient.write(uri, fixture.data);
      assert(writeResult.success, `Write fixture ${fixture.name} should succeed`);
      this.createdUris.add(uri);

      // Read back and verify
      const readResult = await this.apiClient.read(uri);
      assert(readResult.success, `Read fixture ${fixture.name} should succeed`);
      assertExists(readResult.record, "Should return a record");
      assertEqual(
        JSON.stringify(readResult.record.data),
        JSON.stringify(fixture.data),
        `Fixture ${fixture.name} data should match`
      );
    }
  }

  /**
   * Run all tests
   */
  async runAll(): Promise<void> {
    await this.setup();

    const tests = [
      { name: "Basic Write", fn: () => this.testWrite() },
      { name: "Basic Read", fn: () => this.testRead() },
      { name: "List Records", fn: () => this.testList() },
    ];

    if (this.options.testAuthentication) {
      tests.push({
        name: "Authenticated Message",
        fn: () => this.testAuthenticatedMessage(),
      });
    }

    if (this.options.testEncryption) {
      tests.push({
        name: "Encrypted Payload",
        fn: () => this.testEncryptedPayload(),
      });
    }

    if (this.options.testEncryption && this.options.testAuthentication) {
      tests.push({
        name: "Signed and Encrypted Message",
        fn: () => this.testSignedEncryptedMessage(),
      });
    }

    const fixtures = this.options.fixtures || await loadFixtures("fixtures");
    if (fixtures.length > 0) {
      tests.push({
        name: `Fixtures (${fixtures.length} files)`,
        fn: () => this.testWithFixtures(),
      });
    }

    await this.testRunner.runAll(tests);
    await this.cleanup();
  }
}

// Export convenience function
export async function runWriteListReadTests(
  options: WriteListReadTestOptions = {}
): Promise<void> {
  const test = new WriteListReadTest(options);
  await test.runAll();
}

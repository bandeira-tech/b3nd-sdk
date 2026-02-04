# E2E Testing System

A comprehensive end-to-end testing framework for testing integrated services
including HTTP API, authentication, persistence, and cryptographic capabilities.

## 🎯 Overview

This E2E testing system provides a modular, self-contained framework for testing
the integration of various services:

- **HTTP API**: Write, read, list, and delete operations
- **Authentication**: Signature verification and authenticated messages
- **Encryption**: Client-side encryption/decryption with key management
- **Persistence**: Data storage and retrieval verification

## 📁 Structure

```
e2e/
├── src/
│   ├── main.ts              # Test orchestrator - runs all or specific test suites
│   ├── core/
│   │   └── mod.ts           # Core testing framework and utilities
│   ├── crypto/
│   │   ├── mod.ts           # Cryptography utilities and key management
│   │   └── main.ts          # Crypto test suite entry point
│   ├── auth/
│   │   ├── mod.ts           # Authentication test implementations
│   │   └── main.ts          # Auth test suite entry point
│   └── write-list-read/
│       ├── mod.ts           # CRUD operations test implementations
│       └── main.ts          # Write-list-read test suite entry point
├── fixtures/                 # Test fixture data
│   ├── note.json
│   ├── profile.json
│   └── schema.ts
└── deno.json                # Task definitions and imports
```

## 🚀 Quick Start

### Prerequisites

- Deno runtime installed
- Target services running (httpapi, auth, persistence)
- Default endpoint: `http://localhost:8000`

### Running Tests

```bash
# Run all test suites
deno task test:e2e

# Run specific test suite
deno task test:e2e:write-list-read
deno task test:e2e:crypto
deno task test:e2e:auth

# Run multiple specific suites
deno task test:e2e write-list-read auth

# Run with custom configuration
E2E_BASE_URL=http://api.example.com E2E_VERBOSE=true deno task test:e2e
```

## 🧪 Test Suites

### 1. Write-List-Read Tests

Tests basic CRUD operations with optional encryption and authentication:

- Write records to the API
- List records with patterns
- Read records back
- Verify data integrity
- Test encrypted payloads
- Test authenticated messages
- Test signed and encrypted messages

### 2. Authentication Tests

Tests signature verification and authentication features:

- Single signature authentication
- Multi-signature authentication
- Invalid signature detection
- Modified payload detection
- Timestamp validation
- Hierarchical signatures (signature of signature)

### 3. Cryptography Tests

Tests encryption and decryption capabilities:

- Key pair generation (Ed25519 for signing, X25519 for encryption)
- AES-GCM encryption with ECDH key exchange
- Payload encryption/decryption
- Combined signing and encryption
- Multi-user scenarios

## ⚙️ Configuration

### Environment Variables

| Variable              | Description                     | Default                 |
| --------------------- | ------------------------------- | ----------------------- |
| `E2E_BASE_URL`        | API base URL                    | `http://localhost:8000` |
| `E2E_INSTANCE`        | Instance name for tests         | `default`               |
| `E2E_TIMEOUT`         | Request timeout in milliseconds | `30000`                 |
| `E2E_VERBOSE`         | Enable verbose output           | `false`                 |
| `E2E_CLEANUP`         | Clean up test data after tests  | `true`                  |
| `E2E_TEST_ENCRYPTION` | Enable encryption tests         | `true`                  |
| `E2E_TEST_AUTH`       | Enable authentication tests     | `true`                  |

### Test Configuration Object

```typescript
interface TestConfig {
  baseUrl: string; // API base URL
  instance: string; // Instance identifier
  timeout: number; // Request timeout in ms
  verbose: boolean; // Enable detailed logging
}
```

## 📝 Writing New Tests

### Creating a New Test Suite

1. Create a new directory under `src/`:

```bash
mkdir src/my-test-suite
```

2. Create the test module (`mod.ts`):

```typescript
import { ApiClient, assert, TestRunner } from "../core/mod.ts";

export class MyTest {
  private testRunner: TestRunner;
  private apiClient: ApiClient;

  constructor(options = {}) {
    this.testRunner = new TestRunner("My Test Suite", options.config);
    this.apiClient = new ApiClient(options.config);
  }

  async testSomething(): Promise<void> {
    // Your test implementation
    assert(true, "This should pass");
  }

  async runAll(): Promise<void> {
    const tests = [
      { name: "Test Something", fn: () => this.testSomething() },
    ];
    await this.testRunner.runAll(tests);
  }
}
```

3. Create the entry point (`main.ts`):

```typescript
import { runMyTests } from "./mod.ts";

async function main() {
  await runMyTests({/* options */});
}

if (import.meta.main) {
  main();
}
```

4. Register in `src/main.ts`:

```typescript
const testSuites: TestSuite[] = [
  // ... existing suites
  {
    name: "my-test-suite",
    description: "My custom test suite",
    module: "./my-test-suite/main.ts",
    enabled: true,
  },
];
```

5. Add task to `deno.json`:

```json
{
  "tasks": {
    "test:e2e:my-suite": "deno run --allow-net --allow-read --allow-env src/my-test-suite/main.ts"
  }
}
```

## 🔧 Core API

### ApiClient

Provides methods for interacting with the HTTP API:

- `write(uri: string, value: unknown)`: Write data
- `read(uri: string)`: Read data
- `list(pattern?: string)`: List records
- `delete(uri: string)`: Delete records

### TestRunner

Manages test execution and reporting:

- `run(name: string, testFn: () => Promise<void>)`: Run a single test
- `runAll(tests: Array)`: Run multiple tests
- `printSummary()`: Display test results

### CryptoManager

Handles cryptographic operations:

- `generateSigningKeyPair(userId: string)`: Generate Ed25519 keys
- `generateEncryptionKeyPair()`: Generate X25519 keys
- `sign(userId: string, payload: T)`: Sign a payload
- `verify(publicKey, signature, payload)`: Verify a signature
- `encrypt(data, recipientPublicKey)`: Encrypt data
- `decrypt(encryptedPayload, privateKey)`: Decrypt data

### UserSimulator

Simulates multiple users for testing:

- `createUser(userId: string, withEncryption: boolean)`: Create a test user
- `createTestPayload(data, options)`: Create various payload types

## 🧩 Fixtures

Test fixtures are JSON files stored in the `fixtures/` directory. They should
follow this format:

```json
{
  "uri": "test://example/path",
  "value": {
    "your": "data",
    "goes": "here"
  },
  "metadata": {
    "optional": "metadata"
  }
}
```

Fixtures are automatically loaded and used in tests when available.

## 🔍 Debugging

### Verbose Mode

Enable verbose output for detailed test execution logs:

```bash
E2E_VERBOSE=true deno task test:e2e
```

### Run Without Cleanup

Keep test data for inspection:

```bash
E2E_CLEANUP=false deno task test:e2e
```

### Test Specific Endpoints

```bash
E2E_BASE_URL=http://staging.api.com deno task test:e2e
```

## 📊 Test Output

The test runner provides comprehensive output:

```
🚀 Write-List-Read E2E Test Suite
============================================================

📋 Configuration:
  Base URL:        http://localhost:8000
  Instance:        default
  Timeout:         30000ms
  Verbose:         false
  Test Encryption: true
  Test Auth:       true
  Cleanup:         true
============================================================

📦 Setting up test users and keys...
  ✅ Created test users: alice, bob, charlie

  Running: Basic Write
  ✅ Passed: Basic Write
  Running: Basic Read
  ✅ Passed: Basic Read
  ...

============================================================
📊 Test Summary: Write-List-Read Tests
============================================================
  Total:    7 tests
  Passed:   7 ✅
  Failed:   0 ❌
  Duration: 523ms
============================================================

✅ All tests passed successfully!
```

## 🤝 Contributing

When adding new tests:

1. Follow the existing module structure
2. Use the core utilities for consistency
3. Add proper cleanup for created resources
4. Document environment variables
5. Update this README with new test descriptions

## 📄 License

This testing system is part of the b3nd project and follows the same licensing
terms.

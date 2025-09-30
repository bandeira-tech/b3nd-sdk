#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env

/**
 * E2E Test Suite Orchestrator
 *
 * This is the main entry point for running end-to-end tests.
 * It can run all test suites or specific ones based on command line arguments.
 *
 * Usage:
 *   deno task test:e2e                  # Run all test suites
 *   deno task test:e2e write-list-read  # Run specific test suite
 *   deno task test:e2e crypto auth       # Run multiple test suites
 *
 * Available test suites:
 *   - write-list-read: Tests basic CRUD operations with encryption/auth
 *   - crypto: Tests encryption and decryption capabilities
 *   - auth: Tests authentication and signature verification
 *
 * Environment variables:
 *   - E2E_BASE_URL: API base URL (default: http://localhost:8000)
 *   - E2E_INSTANCE: Instance name (default: default)
 *   - E2E_VERBOSE: Enable verbose output (default: false)
 *   - E2E_TIMEOUT: Request timeout in ms (default: 30000)
 *   - E2E_CLEANUP: Clean up test data after tests (default: true)
 *   - E2E_TEST_ENCRYPTION: Test encryption features (default: true)
 *   - E2E_TEST_AUTH: Test authentication features (default: true)
 */

import { defaultConfig } from "./core/mod.ts";

// Test suite registry
interface TestSuite {
  name: string;
  description: string;
  module: string;
  enabled: boolean;
}

const testSuites: TestSuite[] = [
  {
    name: "write-list-read",
    description: "Basic CRUD operations with encryption and authentication",
    module: "./write-list-read/main.ts",
    enabled: true,
  },
  {
    name: "crypto",
    description: "Encryption and decryption capabilities",
    module: "./crypto/main.ts",
    enabled: true,
  },
  {
    name: "auth",
    description: "Authentication and signature verification",
    module: "./auth/main.ts",
    enabled: true,
  },
];

async function runTestSuite(suite: TestSuite): Promise<{
  success: boolean;
  duration: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🧪 Running test suite: ${suite.name}`);
    console.log(`📝 ${suite.description}`);
    console.log(`${"=".repeat(60)}\n`);

    // Dynamically import and run the test suite
    const module = await import(suite.module);

    if (typeof module.main === "function") {
      await module.main();
    } else if (typeof module.default === "function") {
      await module.default();
    } else {
      // If no main export, the module should run on import
      console.log(`✅ Test suite ${suite.name} completed`);
    }

    return {
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Test suite ${suite.name} failed: ${errorMessage}`);

    return {
      success: false,
      duration: Date.now() - startTime,
      error: errorMessage,
    };
  }
}

function printHelp(): void {
  console.log(`
E2E Test Suite Orchestrator

Usage:
  deno task test:e2e [suite1] [suite2] ...

Available test suites:`);

  for (const suite of testSuites) {
    const status = suite.enabled ? "✅" : "⏸️ ";
    console.log(`  ${status} ${suite.name.padEnd(20)} - ${suite.description}`);
  }

  console.log(`
Environment variables:
  E2E_BASE_URL         - API base URL (default: ${defaultConfig.baseUrl})
  E2E_INSTANCE         - Instance name (default: ${defaultConfig.instance})
  E2E_VERBOSE          - Enable verbose output (default: false)
  E2E_TIMEOUT          - Request timeout in ms (default: ${defaultConfig.timeout})
  E2E_CLEANUP          - Clean up test data after tests (default: true)
  E2E_TEST_ENCRYPTION  - Test encryption features (default: true)
  E2E_TEST_AUTH        - Test authentication features (default: true)

Examples:
  deno task test:e2e                     # Run all enabled test suites
  deno task test:e2e write-list-read     # Run specific test suite
  deno task test:e2e --help              # Show this help message
`);
}

async function main() {
  const args = Deno.args;

  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    Deno.exit(0);
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    E2E Test Suite Runner                   ║
╚════════════════════════════════════════════════════════════╝`);

  // Display configuration
  const config = {
    ...defaultConfig,
    verbose: Deno.env.get("E2E_VERBOSE") === "true" || defaultConfig.verbose,
  };

  console.log("\n📋 Configuration:");
  console.log(`  Base URL: ${config.baseUrl}`);
  console.log(`  Instance: ${config.instance}`);
  console.log(`  Timeout:  ${config.timeout}ms`);
  console.log(`  Verbose:  ${config.verbose}`);

  // Determine which test suites to run
  let suitesToRun: TestSuite[] = [];

  if (args.length === 0) {
    // No arguments: run all enabled test suites
    suitesToRun = testSuites.filter((suite) => suite.enabled);
    console.log(
      `\n🎯 Running all enabled test suites (${suitesToRun.length} suites)`,
    );
  } else {
    // Run specific test suites
    for (const arg of args) {
      const suite = testSuites.find((s) => s.name === arg);
      if (suite) {
        if (!suite.enabled) {
          console.warn(`⚠️  Test suite '${arg}' is not yet implemented`);
          continue;
        }
        suitesToRun.push(suite);
      } else {
        console.warn(`⚠️  Unknown test suite: ${arg}`);
      }
    }

    if (suitesToRun.length === 0) {
      console.error("\n❌ No valid test suites specified");
      printHelp();
      Deno.exit(1);
    }

    console.log(
      `\n🎯 Running ${suitesToRun.length} test suite(s): ${suitesToRun.map((s) => s.name).join(", ")}`,
    );
  }

  // Run test suites
  const results: Array<{
    suite: TestSuite;
    success: boolean;
    duration: number;
    error?: string;
  }> = [];

  const totalStartTime = Date.now();

  for (const suite of suitesToRun) {
    const result = await runTestSuite(suite);
    results.push({ suite, ...result });
  }

  const totalDuration = Date.now() - totalStartTime;

  // Print summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 OVERALL TEST SUMMARY");
  console.log(`${"=".repeat(60)}`);

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\nTest Suites Run: ${results.length}`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏱️  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);

  if (results.length > 0) {
    console.log("\nDetailed Results:");
    for (const result of results) {
      const status = result.success ? "✅ PASS" : "❌ FAIL";
      const duration = `${(result.duration / 1000).toFixed(2)}s`;
      console.log(`  ${status} ${result.suite.name.padEnd(20)} (${duration})`);
      if (result.error) {
        console.log(`       └─ ${result.error}`);
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);

  if (failed === 0) {
    console.log("✨ All test suites passed successfully!");
    Deno.exit(0);
  } else {
    console.log(
      "❌ Some test suites failed. Check the logs above for details.",
    );
    Deno.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error("\n💥 Fatal error running test orchestrator:");
    console.error(error);
    Deno.exit(1);
  });
}

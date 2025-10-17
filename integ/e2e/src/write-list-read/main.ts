#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env

/**
 * Write-List-Read Test Suite Entry Point
 *
 * Run with: deno task test:e2e:write-list-read
 * Or directly: deno run --allow-net --allow-read --allow-env src/write-list-read/main.ts
 *
 * Environment variables:
 * - E2E_BASE_URL: API base URL (default: http://localhost:8000)
 * - E2E_VERBOSE: Enable verbose output (default: false)
 * - E2E_TIMEOUT: Request timeout in ms (default: 30000)
 * - E2E_CLEANUP: Clean up test data after tests (default: true)
 * - E2E_TEST_ENCRYPTION: Test encryption features (default: true)
 * - E2E_TEST_AUTH: Test authentication features (default: true)
 */

import { runWriteListReadTests } from "./mod.ts";
import { defaultConfig, loadFixtures } from "../core/mod.ts";

async function main() {
  console.log("🚀 Write-List-Read E2E Test Suite");
  console.log("=" + "=".repeat(59));

  // Parse configuration from environment
  const config = {
    ...defaultConfig,
    verbose: !(Deno.env.get("E2E_VERBOSE") === "false") ||
      defaultConfig.verbose,
  };

  // Test options
  const testEncryption = Deno.env.get("E2E_TEST_ENCRYPTION") !== "false";
  const testAuthentication = Deno.env.get("E2E_TEST_AUTH") !== "false";
  const cleanupAfterTests = Deno.env.get("E2E_CLEANUP") !== "false";

  // Load fixtures if available
  let fixtures;
  try {
    fixtures = await loadFixtures("fixtures");
    if (fixtures.length > 0) {
      console.log(`📁 Loaded ${fixtures.length} fixture(s)`);
    }
  } catch (error) {
    console.log("📁 No fixtures found or error loading fixtures");
  }

  // Display configuration
  console.log("\n📋 Configuration:");
  console.log(`  Base URL:        ${config.baseUrl}`);
  console.log(`  Timeout:         ${config.timeout}ms`);
  console.log(`  Verbose:         ${config.verbose}`);
  console.log(`  Test Encryption: ${testEncryption}`);
  console.log(`  Test Auth:       ${testAuthentication}`);
  console.log(`  Cleanup:         ${cleanupAfterTests}`);
  console.log("=" + "=".repeat(59) + "\n");

  try {
    // Run the test suite
    await runWriteListReadTests({
      config,
      fixtures,
      testEncryption,
      testAuthentication,
      cleanupAfterTests,
    });

    console.log("\n✨ Test suite completed successfully!");
    Deno.exit(0);
  } catch (error) {
    console.error("\n❌ Test suite failed with error:");
    console.error(error);
    Deno.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}

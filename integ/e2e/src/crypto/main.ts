#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env

/**
 * Crypto Test Suite Entry Point
 *
 * Run with: deno task test:e2e:crypto
 * Or directly: deno run --allow-net --allow-read --allow-env src/crypto/main.ts
 *
 * Environment variables:
 * - E2E_BASE_URL: API base URL (default: http://localhost:8000)
 * - E2E_INSTANCE: Instance name (default: default)
 * - E2E_VERBOSE: Enable verbose output (default: false)
 * - E2E_TIMEOUT: Request timeout in ms (default: 30000)
 * - E2E_CLEANUP: Clean up test data after tests (default: true)
 */

import { runCryptoTests } from "./mod.ts";
import { defaultConfig } from "../core/mod.ts";

async function main() {
  console.log("🔐 Cryptography E2E Test Suite");
  console.log("=" + "=".repeat(59));

  // Parse configuration from environment
  const config = {
    ...defaultConfig,
    verbose: Deno.env.get("E2E_VERBOSE") === "true" || defaultConfig.verbose,
  };

  const cleanupAfterTests = Deno.env.get("E2E_CLEANUP") !== "false";

  // Display configuration
  console.log("\n📋 Configuration:");
  console.log(`  Base URL:  ${config.baseUrl}`);
  console.log(`  Instance:  ${config.instance}`);
  console.log(`  Timeout:   ${config.timeout}ms`);
  console.log(`  Verbose:   ${config.verbose}`);
  console.log(`  Cleanup:   ${cleanupAfterTests}`);
  console.log("=" + "=".repeat(59) + "\n");

  try {
    // Run the test suite
    await runCryptoTests({
      config,
      cleanupAfterTests,
    });

    console.log("\n✨ Cryptography test suite completed successfully!");
    Deno.exit(0);
  } catch (error) {
    console.error("\n❌ Cryptography test suite failed with error:");
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

export { main };

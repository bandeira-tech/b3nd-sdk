/**
 * MemoryClient Tests
 *
 * Tests the in-memory client implementation using the shared test suite
 * plus MemoryClient-specific tests
 */

import { MemoryClient } from "./mod.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import { runNodeSuite } from "../b3nd-testing/node-suite.ts";

// Run shared suite with MemoryClient factory functions
// Note: MemoryClient stores data as-is (doesn't distinguish binary from JSON),
// so binary tests are skipped as the HTTP transport layer is where binary
// Content-Type detection happens.
runSharedSuite("MemoryClient", {
  happy: () => new MemoryClient(),

  // MemoryClient doesn't have HTTP-level binary Content-Type handling
  supportsBinary: false,
});

// Run node suite with MemoryClient factory functions
runNodeSuite("MemoryClient", {
  happy: () => new MemoryClient(),
});

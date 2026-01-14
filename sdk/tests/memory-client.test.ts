/**
 * MemoryClient Tests
 *
 * Tests the in-memory client implementation using the shared test suite
 * plus MemoryClient-specific tests
 */

import { MemoryClient } from "../clients/memory/mod.ts";
import { runSharedSuite } from "./shared-suite.ts";

// Run shared suite with MemoryClient factory functions
// Note: MemoryClient stores data as-is (doesn't distinguish binary from JSON),
// so binary tests are skipped as the HTTP transport layer is where binary
// Content-Type detection happens.
runSharedSuite("MemoryClient", {
  happy: () =>
    new MemoryClient({
      schema: {
        "store://users": async () => ({ valid: true }),
      },
    }),

  validationError: () =>
    new MemoryClient({
      schema: {
        "store://users": async ({ value }) => {
          const data = value as any;
          if (!data.name) {
            return { valid: false, error: "Name is required" };
          }
          return { valid: true };
        },
      },
    }),

  // MemoryClient doesn't have HTTP-level binary Content-Type handling
  supportsBinary: false,
});

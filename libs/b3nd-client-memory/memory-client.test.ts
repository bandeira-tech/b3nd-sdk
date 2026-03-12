/**
 * MemoryClient Tests
 *
 * Tests the in-memory client implementation using the shared test suite
 * plus MemoryClient-specific tests
 */

import { assertEquals } from "jsr:@std/assert";
import { MemoryClient } from "./mod.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import { runNodeSuite } from "../b3nd-testing/node-suite.ts";

// Run shared suite with MemoryClient factory functions
// Note: MemoryClient stores data as-is (doesn't distinguish binary from JSON),
// so binary tests are skipped as the HTTP transport layer is where binary
// Content-Type detection happens.
runSharedSuite("MemoryClient", {
  happy: () =>
    new MemoryClient({
      schema: {
        "store://users": async () => ({ valid: true }),
        "store://files": async () => ({ valid: true }),
        "store://pagination": async () => ({ valid: true }),
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

// Run node suite with MemoryClient factory functions
runNodeSuite("MemoryClient", {
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
});

// ── receiveIf / version tracking tests ──────────────────────────────

Deno.test("receiveIf: first write returns version=1", async () => {
  const client = new MemoryClient({
    schema: { "mutable://data": async () => ({ valid: true }) },
  });
  const result = await client.receiveIf(
    ["mutable://data/foo", { x: 1 }],
    {},
  );
  assertEquals(result.accepted, true);
  assertEquals(result.version, 1);
});

Deno.test("receiveIf: read returns version after write", async () => {
  const client = new MemoryClient({
    schema: { "mutable://data": async () => ({ valid: true }) },
  });
  await client.receive(["mutable://data/foo", { x: 1 }]);
  const read = await client.read("mutable://data/foo");
  assertEquals(read.success, true);
  assertEquals(read.record?.version, 1);
});

Deno.test("receiveIf: conditional update succeeds with correct expectedVersion", async () => {
  const client = new MemoryClient({
    schema: { "mutable://data": async () => ({ valid: true }) },
  });

  const w1 = await client.receive(["mutable://data/foo", { x: 1 }]);
  assertEquals(w1.version, 1);

  const w2 = await client.receiveIf(
    ["mutable://data/foo", { x: 2 }],
    { expectedVersion: 1 },
  );
  assertEquals(w2.accepted, true);
  assertEquals(w2.version, 2);

  const read = await client.read("mutable://data/foo");
  assertEquals(read.record?.data, { x: 2 });
  assertEquals(read.record?.version, 2);
});

Deno.test("receiveIf: conflict rejection with stale expectedVersion", async () => {
  const client = new MemoryClient({
    schema: { "mutable://data": async () => ({ valid: true }) },
  });

  await client.receive(["mutable://data/foo", { x: 1 }]);
  await client.receive(["mutable://data/foo", { x: 2 }]);

  const result = await client.receiveIf(
    ["mutable://data/foo", { x: 3 }],
    { expectedVersion: 1 },
  );
  assertEquals(result.accepted, false);
  assertEquals(result.error, "version_conflict");
  assertEquals(result.version, 2);

  // Data unchanged
  const read = await client.read("mutable://data/foo");
  assertEquals(read.record?.data, { x: 2 });
});

Deno.test("receiveIf: without expectedVersion behaves like unconditional receive", async () => {
  const client = new MemoryClient({
    schema: { "mutable://data": async () => ({ valid: true }) },
  });

  await client.receive(["mutable://data/foo", { x: 1 }]);

  const result = await client.receiveIf(
    ["mutable://data/foo", { x: 2 }],
    {},
  );
  assertEquals(result.accepted, true);
  assertEquals(result.version, 2);
});

Deno.test("receiveIf: expectedVersion=0 matches non-existent record (first write)", async () => {
  const client = new MemoryClient({
    schema: { "mutable://data": async () => ({ valid: true }) },
  });

  const result = await client.receiveIf(
    ["mutable://data/foo", { x: 1 }],
    { expectedVersion: 0 },
  );
  assertEquals(result.accepted, true);
  assertEquals(result.version, 1);
});

Deno.test("receiveIf: expectedVersion=0 fails if record already exists", async () => {
  const client = new MemoryClient({
    schema: { "mutable://data": async () => ({ valid: true }) },
  });

  await client.receive(["mutable://data/foo", { x: 1 }]);

  const result = await client.receiveIf(
    ["mutable://data/foo", { x: 2 }],
    { expectedVersion: 0 },
  );
  assertEquals(result.accepted, false);
  assertEquals(result.error, "version_conflict");
  assertEquals(result.version, 1);
});

Deno.test("receive: also returns version", async () => {
  const client = new MemoryClient({
    schema: { "mutable://data": async () => ({ valid: true }) },
  });

  const w1 = await client.receive(["mutable://data/foo", { x: 1 }]);
  assertEquals(w1.version, 1);

  const w2 = await client.receive(["mutable://data/foo", { x: 2 }]);
  assertEquals(w2.version, 2);
});

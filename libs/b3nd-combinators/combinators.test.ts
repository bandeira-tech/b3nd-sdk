/**
 * Combinator Tests
 *
 * Tests the actual composition behavior of parallelBroadcast and firstMatchSequence:
 * - parallelBroadcast: writes to all backends, reads from first
 * - firstMatchSequence: tries backends in order, first success wins
 */

import { assertEquals } from "@std/assert";
import { createTestSchema, MemoryClient } from "../b3nd-client-memory/mod.ts";
import { parallelBroadcast } from "./parallel-broadcast.ts";
import { firstMatchSequence } from "./first-match-sequence.ts";

// --- parallelBroadcast tests ---

Deno.test("parallelBroadcast - writes to all backends", async () => {
  const a = new MemoryClient({ schema: createTestSchema() });
  const b = new MemoryClient({ schema: createTestSchema() });
  const combined = parallelBroadcast([a, b]);

  const result = await combined.receive([
    "mutable://data/shared",
    { value: 42 },
  ]);
  assertEquals(result.accepted, true);

  // Both backends should have the data
  const readA = await a.read("mutable://data/shared");
  const readB = await b.read("mutable://data/shared");
  assertEquals(readA.success, true);
  assertEquals(readB.success, true);
  if (readA.success) assertEquals(readA.record?.data, { value: 42 });
  if (readB.success) assertEquals(readB.record?.data, { value: 42 });

  await combined.cleanup();
});

Deno.test("parallelBroadcast - reads from first backend only", async () => {
  const a = new MemoryClient({ schema: createTestSchema() });
  const b = new MemoryClient({ schema: createTestSchema() });

  // Write directly to each backend with different data
  await a.receive(["mutable://data/test", { source: "a" }]);
  await b.receive(["mutable://data/test", { source: "b" }]);

  const combined = parallelBroadcast([a, b]);
  const result = await combined.read("mutable://data/test");

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.record?.data, { source: "a" });
  }

  await combined.cleanup();
});

Deno.test("parallelBroadcast - readMulti reads from first backend", async () => {
  const a = new MemoryClient({ schema: createTestSchema() });
  const b = new MemoryClient({ schema: createTestSchema() });

  await a.receive(["mutable://data/x", { from: "a" }]);
  await b.receive(["mutable://data/x", { from: "b" }]);

  const combined = parallelBroadcast([a, b]);
  const result = await combined.readMulti(["mutable://data/x"]);

  assertEquals(result.success, true);
  assertEquals(result.results[0].success, true);
  if (result.results[0].success) {
    assertEquals(result.results[0].record.data, { from: "a" });
  }

  await combined.cleanup();
});

Deno.test("parallelBroadcast - delete removes from all backends", async () => {
  const a = new MemoryClient({ schema: createTestSchema() });
  const b = new MemoryClient({ schema: createTestSchema() });
  const combined = parallelBroadcast([a, b]);

  await combined.receive(["mutable://data/temp", { v: 1 }]);
  const delResult = await combined.delete("mutable://data/temp");
  assertEquals(delResult.success, true);

  const readA = await a.read("mutable://data/temp");
  const readB = await b.read("mutable://data/temp");
  assertEquals(readA.success, false);
  assertEquals(readB.success, false);

  await combined.cleanup();
});

Deno.test("parallelBroadcast - fails if any backend rejects write", async () => {
  const a = new MemoryClient({ schema: createTestSchema() });
  // b has no schema for mutable://data, so it will reject
  const b = new MemoryClient({
    schema: { "mutable://accounts": async () => ({ valid: true }) },
  });

  const combined = parallelBroadcast([a, b]);
  const result = await combined.receive([
    "mutable://data/test",
    { v: 1 },
  ]);
  assertEquals(result.accepted, false);

  await combined.cleanup();
});

// --- firstMatchSequence tests ---

Deno.test("firstMatchSequence - reads from first backend that has data", async () => {
  const primary = new MemoryClient({ schema: createTestSchema() });
  const fallback = new MemoryClient({ schema: createTestSchema() });

  // Only fallback has the data
  await fallback.receive(["mutable://data/only-in-fallback", { found: true }]);

  const combined = firstMatchSequence([primary, fallback]);
  const result = await combined.read("mutable://data/only-in-fallback");

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.record?.data, { found: true });
  }

  await combined.cleanup();
});

Deno.test("firstMatchSequence - prefers primary over fallback", async () => {
  const primary = new MemoryClient({ schema: createTestSchema() });
  const fallback = new MemoryClient({ schema: createTestSchema() });

  await primary.receive(["mutable://data/both", { source: "primary" }]);
  await fallback.receive(["mutable://data/both", { source: "fallback" }]);

  const combined = firstMatchSequence([primary, fallback]);
  const result = await combined.read("mutable://data/both");

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.record?.data, { source: "primary" });
  }

  await combined.cleanup();
});

Deno.test("firstMatchSequence - returns failure when no backend has data", async () => {
  const a = new MemoryClient({ schema: createTestSchema() });
  const b = new MemoryClient({ schema: createTestSchema() });

  const combined = firstMatchSequence([a, b]);
  const result = await combined.read("mutable://data/nowhere");

  assertEquals(result.success, false);

  await combined.cleanup();
});

Deno.test("firstMatchSequence - write goes to first accepting backend", async () => {
  // primary rejects mutable://data writes
  const primary = new MemoryClient({
    schema: { "mutable://accounts": async () => ({ valid: true }) },
  });
  const fallback = new MemoryClient({ schema: createTestSchema() });

  const combined = firstMatchSequence([primary, fallback]);
  const result = await combined.receive([
    "mutable://data/test",
    { v: 1 },
  ]);
  assertEquals(result.accepted, true);

  // Primary should NOT have it (rejected), fallback should
  const readPrimary = await primary.read("mutable://data/test");
  const readFallback = await fallback.read("mutable://data/test");
  assertEquals(readPrimary.success, false);
  assertEquals(readFallback.success, true);

  await combined.cleanup();
});

Deno.test("firstMatchSequence - readMulti falls through to fallback", async () => {
  const primary = new MemoryClient({ schema: createTestSchema() });
  const fallback = new MemoryClient({ schema: createTestSchema() });

  await fallback.receive(["mutable://data/a", { v: 1 }]);
  await fallback.receive(["mutable://data/b", { v: 2 }]);

  const combined = firstMatchSequence([primary, fallback]);
  const result = await combined.readMulti([
    "mutable://data/a",
    "mutable://data/b",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.summary.succeeded, 2);

  await combined.cleanup();
});

Deno.test("firstMatchSequence - delete uses first matching backend", async () => {
  const primary = new MemoryClient({ schema: createTestSchema() });
  const fallback = new MemoryClient({ schema: createTestSchema() });

  await primary.receive(["mutable://data/del", { v: 1 }]);
  await fallback.receive(["mutable://data/del", { v: 1 }]);

  const combined = firstMatchSequence([primary, fallback]);
  const result = await combined.delete("mutable://data/del");
  assertEquals(result.success, true);

  // Primary should be deleted, fallback untouched
  const readPrimary = await primary.read("mutable://data/del");
  const readFallback = await fallback.read("mutable://data/del");
  assertEquals(readPrimary.success, false);
  assertEquals(readFallback.success, true);

  await combined.cleanup();
});

Deno.test("firstMatchSequence - list falls through to backend with data", async () => {
  const primary = new MemoryClient({ schema: createTestSchema() });
  const fallback = new MemoryClient({ schema: createTestSchema() });

  await fallback.receive(["mutable://data/list-a/profile", { v: 1 }]);
  await fallback.receive(["mutable://data/list-b/profile", { v: 2 }]);

  const combined = firstMatchSequence([primary, fallback]);
  const result = await combined.list("mutable://data");

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 2);
  }

  await combined.cleanup();
});

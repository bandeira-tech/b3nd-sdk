/**
 * Combinator Tests
 *
 * Tests the actual composition behavior of parallelBroadcast and firstMatchSequence:
 * - parallelBroadcast: writes to all backends, reads from first
 * - firstMatchSequence: tries backends in order, first success wins
 */

import { assertEquals } from "@std/assert";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { MessageDataClient } from "../b3nd-core/message-data-client.ts";
import type { NodeProtocolInterface, ReadResult } from "../b3nd-core/types.ts";
import { parallelBroadcast } from "./parallel-broadcast.ts";
import { firstMatchSequence } from "./first-match-sequence.ts";

/** A client that rejects all operations — for testing combinator error paths. */
function rejectingClient(): NodeProtocolInterface {
  return {
    receive: async (msgs) =>
      msgs.map(() => ({ accepted: false, error: "rejected by policy" })),
    read: async <T = unknown>(uris: string | string[]) => {
      const uriList = Array.isArray(uris) ? uris : [uris];
      return uriList.map((uri) => ({
        success: false as const,
        error: "not supported",
      }));
    },
    // deno-lint-ignore require-yield
    async *observe<T = unknown>(
      _pattern: string,
      _signal: AbortSignal,
    ): AsyncIterable<ReadResult<T>> {
      // Not implemented.
    },
    status: async () => ({ status: "unhealthy" as const }),
  };
}

// --- parallelBroadcast tests ---

Deno.test("parallelBroadcast - writes to all backends", async () => {
  const a = new MessageDataClient(new MemoryStore());
  const b = new MessageDataClient(new MemoryStore());
  const combined = parallelBroadcast([a, b]);

  const results = await combined.receive([
    ["mutable://data/shared", {}, { value: 42 }],
  ]);
  assertEquals(results[0].accepted, true);

  // Both backends should have the data
  const readA = await a.read("mutable://data/shared");
  const readB = await b.read("mutable://data/shared");
  assertEquals(readA[0].success, true);
  assertEquals(readB[0].success, true);
  if (readA[0].success) assertEquals(readA[0].record?.data, { value: 42 });
  if (readB[0].success) assertEquals(readB[0].record?.data, { value: 42 });
});

Deno.test("parallelBroadcast - reads from first backend only", async () => {
  const a = new MessageDataClient(new MemoryStore());
  const b = new MessageDataClient(new MemoryStore());

  // Write directly to each backend with different data
  await a.receive([["mutable://data/test", {}, { source: "a" }]]);
  await b.receive([["mutable://data/test", {}, { source: "b" }]]);

  const combined = parallelBroadcast([a, b]);
  const results = await combined.read("mutable://data/test");

  assertEquals(results[0].success, true);
  if (results[0].success) {
    assertEquals(results[0].record?.data, { source: "a" });
  }
});

Deno.test("parallelBroadcast - multi-read from first backend", async () => {
  const a = new MessageDataClient(new MemoryStore());
  const b = new MessageDataClient(new MemoryStore());

  await a.receive([["mutable://data/x", {}, { from: "a" }]]);
  await b.receive([["mutable://data/x", {}, { from: "b" }]]);

  const combined = parallelBroadcast([a, b]);
  const results = await combined.read(["mutable://data/x"]);

  assertEquals(results.length, 1);
  assertEquals(results[0].success, true);
  if (results[0].success) {
    assertEquals(results[0].record?.data, { from: "a" });
  }
});

Deno.test("parallelBroadcast - fails if any backend rejects write", async () => {
  const a = new MessageDataClient(new MemoryStore());
  const b = rejectingClient();

  const combined = parallelBroadcast([a, b]);
  const results = await combined.receive([
    ["mutable://data/test", {}, { v: 1 }],
  ]);
  assertEquals(results[0].accepted, false);
});

// --- firstMatchSequence tests ---

Deno.test("firstMatchSequence - reads from first backend that has data", async () => {
  const primary = new MessageDataClient(new MemoryStore());
  const fallback = new MessageDataClient(new MemoryStore());

  // Only fallback has the data
  await fallback.receive([["mutable://data/only-in-fallback", {}, { found: true }]]);

  const combined = firstMatchSequence([primary, fallback]);
  const results = await combined.read("mutable://data/only-in-fallback");

  assertEquals(results[0].success, true);
  if (results[0].success) {
    assertEquals(results[0].record?.data, { found: true });
  }
});

Deno.test("firstMatchSequence - prefers primary over fallback", async () => {
  const primary = new MessageDataClient(new MemoryStore());
  const fallback = new MessageDataClient(new MemoryStore());

  await primary.receive([["mutable://data/both", {}, { source: "primary" }]]);
  await fallback.receive([["mutable://data/both", {}, { source: "fallback" }]]);

  const combined = firstMatchSequence([primary, fallback]);
  const results = await combined.read("mutable://data/both");

  assertEquals(results[0].success, true);
  if (results[0].success) {
    assertEquals(results[0].record?.data, { source: "primary" });
  }
});

Deno.test("firstMatchSequence - returns failure when no backend has data", async () => {
  const a = new MessageDataClient(new MemoryStore());
  const b = new MessageDataClient(new MemoryStore());

  const combined = firstMatchSequence([a, b]);
  const results = await combined.read("mutable://data/nowhere");

  assertEquals(results[0].success, false);
});

Deno.test("firstMatchSequence - write goes to first accepting backend", async () => {
  // primary rejects all writes
  const primary = rejectingClient();
  const fallback = new MessageDataClient(new MemoryStore());

  const combined = firstMatchSequence([primary, fallback]);
  const results = await combined.receive([
    ["mutable://data/test", {}, { v: 1 }],
  ]);
  assertEquals(results[0].accepted, true);

  // Primary rejected, so fallback should have the data
  const readFallback = await fallback.read("mutable://data/test");
  assertEquals(readFallback[0].success, true);
});

Deno.test("firstMatchSequence - multi-read falls through to fallback", async () => {
  const primary = new MessageDataClient(new MemoryStore());
  const fallback = new MessageDataClient(new MemoryStore());

  await fallback.receive([["mutable://data/a", {}, { v: 1 }]]);
  await fallback.receive([["mutable://data/b", {}, { v: 2 }]]);

  const combined = firstMatchSequence([primary, fallback]);
  const results = await combined.read([
    "mutable://data/a",
    "mutable://data/b",
  ]);

  // Each URI should have a successful result
  const successes = results.filter((r) => r.success);
  assertEquals(successes.length, 2);
});

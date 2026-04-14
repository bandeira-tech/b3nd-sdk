/**
 * MemoryStore Tests
 *
 * Runs the shared Store test suite + MemoryStore-specific tests
 * (observe, capabilities).
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { runSharedStoreSuite } from "../b3nd-testing/shared-store-suite.ts";
import { MemoryStore } from "./store.ts";

const noSanitize = { sanitizeOps: false, sanitizeResources: false };

// ── Shared suite ──────────────────────────────────────────────────

runSharedStoreSuite("MemoryStore", {
  create: () => new MemoryStore(),
});

// ── Observe ───────────────────────────────────────────────────────

Deno.test({
  name: "MemoryStore - observe yields on matching write",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const ac = new AbortController();

    const observed: unknown[] = [];
    const observePromise = (async () => {
      for await (
        const result of store.observe("mutable://app/*", ac.signal)
      ) {
        observed.push(result.record?.data);
        if (observed.length >= 2) ac.abort();
      }
    })();

    // Write matching entries
    await store.write([
      { uri: "mutable://app/x", values: {}, data: "first" },
    ]);
    // Small delay to let the observer pick up
    await new Promise((r) => setTimeout(r, 10));
    await store.write([
      { uri: "mutable://app/y", values: {}, data: "second" },
    ]);

    await observePromise;
    assertEquals(observed, ["first", "second"]);
  },
});

// ── Capabilities ──────────────────────────────────────────────────

Deno.test({
  name: "MemoryStore - capabilities reports observe support",
  ...noSanitize,
  fn: () => {
    const store = new MemoryStore();
    const caps = store.capabilities();
    assertEquals(caps.observe, true);
    assertEquals(caps.atomicBatch, false);
    assertEquals(caps.binaryData, false);
  },
});

/**
 * MemoryStore Tests
 *
 * Tests the Store interface reference implementation.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { MemoryStore } from "./store.ts";

const noSanitize = { sanitizeOps: false, sanitizeResources: false };

// ── Write + Read ───────────────────────────────────────────────────

Deno.test({
  name: "MemoryStore - write and read back",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();

    const writeResults = await store.write([
      { uri: "mutable://app/config", values: {}, data: { theme: "dark" } },
    ]);
    assertEquals(writeResults.length, 1);
    assertEquals(writeResults[0].success, true);

    const readResults = await store.read(["mutable://app/config"]);
    assertEquals(readResults.length, 1);
    assertEquals(readResults[0].success, true);
    assertEquals(readResults[0].record?.data, { theme: "dark" });
    assertEquals(readResults[0].record?.values, {});
  },
});

Deno.test({
  name: "MemoryStore - batch write multiple entries",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();

    const writeResults = await store.write([
      { uri: "mutable://app/a", values: {}, data: "A" },
      { uri: "mutable://app/b", values: { fire: 10 }, data: "B" },
      { uri: "mutable://app/c", values: {}, data: "C" },
    ]);
    assertEquals(writeResults.length, 3);
    assertEquals(writeResults.every((r) => r.success), true);

    const readResults = await store.read([
      "mutable://app/a",
      "mutable://app/b",
      "mutable://app/c",
    ]);
    assertEquals(readResults.length, 3);
    assertEquals(readResults[0].record?.data, "A");
    assertEquals(readResults[1].record?.data, "B");
    assertEquals(readResults[1].record?.values, { fire: 10 });
    assertEquals(readResults[2].record?.data, "C");
  },
});

Deno.test({
  name: "MemoryStore - write overwrites existing value",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();

    await store.write([
      { uri: "mutable://app/x", values: {}, data: "old" },
    ]);
    await store.write([
      { uri: "mutable://app/x", values: {}, data: "new" },
    ]);

    const results = await store.read(["mutable://app/x"]);
    assertEquals(results[0].record?.data, "new");
  },
});

// ── Read ───────────────────────────────────────────────────────────

Deno.test({
  name: "MemoryStore - read nonexistent returns error",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();

    const results = await store.read(["mutable://app/missing"]);
    assertEquals(results.length, 1);
    assertEquals(results[0].success, false);
  },
});

Deno.test({
  name: "MemoryStore - trailing slash lists children",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();

    await store.write([
      { uri: "mutable://app/users/alice", values: {}, data: { name: "Alice" } },
      { uri: "mutable://app/users/bob", values: {}, data: { name: "Bob" } },
    ]);

    const results = await store.read(["mutable://app/users/"]);
    assertEquals(results.length, 2);
    assertEquals(results.every((r) => r.success), true);

    const uris = results.map((r) => r.uri).sort();
    assertEquals(uris, [
      "mutable://app/users/alice",
      "mutable://app/users/bob",
    ]);
  },
});

// ── Delete ─────────────────────────────────────────────────────────

Deno.test({
  name: "MemoryStore - delete removes entry",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();

    await store.write([
      { uri: "mutable://app/x", values: {}, data: "hello" },
    ]);

    const deleteResults = await store.delete(["mutable://app/x"]);
    assertEquals(deleteResults.length, 1);
    assertEquals(deleteResults[0].success, true);

    const readResults = await store.read(["mutable://app/x"]);
    assertEquals(readResults[0].success, false);
  },
});

Deno.test({
  name: "MemoryStore - delete nonexistent succeeds silently",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();

    const results = await store.delete(["mutable://app/missing"]);
    assertEquals(results.length, 1);
    assertEquals(results[0].success, true);
  },
});

Deno.test({
  name: "MemoryStore - batch delete",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();

    await store.write([
      { uri: "mutable://app/a", values: {}, data: "A" },
      { uri: "mutable://app/b", values: {}, data: "B" },
      { uri: "mutable://app/c", values: {}, data: "C" },
    ]);

    await store.delete(["mutable://app/a", "mutable://app/c"]);

    const results = await store.read([
      "mutable://app/a",
      "mutable://app/b",
      "mutable://app/c",
    ]);
    assertEquals(results[0].success, false);
    assertEquals(results[1].success, true);
    assertEquals(results[1].record?.data, "B");
    assertEquals(results[2].success, false);
  },
});

// ── Observe ────────────────────────────────────────────────────────

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

// ── Status & Capabilities ──────────────────────────────────────────

Deno.test({
  name: "MemoryStore - status returns healthy",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const status = await store.status();
    assertEquals(status.status, "healthy");
  },
});

Deno.test({
  name: "MemoryStore - capabilities reports observe support",
  ...noSanitize,
  fn: () => {
    const store = new MemoryStore();
    const caps = store.capabilities();
    assertEquals(caps.observe, true);
    assertEquals(caps.atomicBatch, false);
  },
});

// ── Values preservation ────────────────────────────────────────────

Deno.test({
  name: "MemoryStore - preserves values on write/read",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();

    await store.write([
      {
        uri: "mutable://app/token",
        values: { fire: 100, water: 50 },
        data: null,
      },
    ]);

    const results = await store.read(["mutable://app/token"]);
    assertEquals(results[0].record?.values, { fire: 100, water: 50 });
  },
});

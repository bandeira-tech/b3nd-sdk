/**
 * FirecatDataClient Tests
 *
 * Tests protocol-aware envelope decomposition over a Store.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { FirecatDataClient } from "./firecat-client.ts";
import { MemoryStore } from "@bandeira-tech/b3nd-sdk";

const noSanitize = { sanitizeOps: false, sanitizeResources: false };

// ── Envelope decomposition ─────────────────────────────────────────

Deno.test({
  name: "FirecatDataClient - decomposes envelope: deletes inputs, writes outputs",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const client = new FirecatDataClient(store);

    // Seed an input that will be consumed
    await store.write([
      { uri: "mutable://tokens/1", values: { fire: 100 }, data: null },
    ]);

    // Send envelope that consumes input and produces outputs
    const results = await client.receive([
      ["hash://sha256/abc123", {}, {
        inputs: ["mutable://tokens/1"],
        outputs: [
          ["mutable://tokens/2", { fire: 60 }, null],
          ["mutable://tokens/3", { fire: 40 }, null],
        ],
      }],
    ]);

    assertEquals(results.length, 1);
    assertEquals(results[0].accepted, true);

    // Input was deleted
    const input = await store.read(["mutable://tokens/1"]);
    assertEquals(input[0].success, false);

    // Outputs were written
    const out2 = await store.read(["mutable://tokens/2"]);
    assertEquals(out2[0].success, true);
    assertEquals(out2[0].record?.values, { fire: 60 });

    const out3 = await store.read(["mutable://tokens/3"]);
    assertEquals(out3[0].success, true);
    assertEquals(out3[0].record?.values, { fire: 40 });

    // Envelope itself was persisted
    const envelope = await store.read(["hash://sha256/abc123"]);
    assertEquals(envelope[0].success, true);
  },
});

Deno.test({
  name: "FirecatDataClient - non-envelope data is stored without decomposition",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const client = new FirecatDataClient(store);

    // Data that doesn't have { inputs, outputs } shape
    await client.receive([
      ["mutable://app/config", {}, { theme: "dark" }],
    ]);

    const result = await store.read(["mutable://app/config"]);
    assertEquals(result[0].success, true);
    assertEquals(result[0].record?.data, { theme: "dark" });
  },
});

Deno.test({
  name: "FirecatDataClient - envelope with no inputs, only outputs",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const client = new FirecatDataClient(store);

    await client.receive([
      ["hash://sha256/def456", {}, {
        inputs: [],
        outputs: [
          ["mutable://open/config", {}, { dark: true }],
        ],
      }],
    ]);

    const result = await store.read(["mutable://open/config"]);
    assertEquals(result[0].success, true);
    assertEquals(result[0].record?.data, { dark: true });
  },
});

// ── Batch receive ──────────────────────────────────────────────────

Deno.test({
  name: "FirecatDataClient - batch receive processes each message independently",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const client = new FirecatDataClient(store);

    const results = await client.receive([
      ["hash://sha256/msg1", {}, {
        inputs: [],
        outputs: [["mutable://app/a", {}, "A"]],
      }],
      ["hash://sha256/msg2", {}, {
        inputs: [],
        outputs: [["mutable://app/b", {}, "B"]],
      }],
    ]);

    assertEquals(results.length, 2);
    assertEquals(results.every((r) => r.accepted), true);

    const reads = await store.read(["mutable://app/a", "mutable://app/b"]);
    assertEquals(reads[0].record?.data, "A");
    assertEquals(reads[1].record?.data, "B");
  },
});

// ── Read ───────────────────────────────────────────────────────────

Deno.test({
  name: "FirecatDataClient - read delegates to store",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const client = new FirecatDataClient(store);

    await store.write([
      { uri: "mutable://app/x", values: {}, data: "hello" },
    ]);

    // String form
    const r1 = await client.read("mutable://app/x");
    assertEquals(r1[0].record?.data, "hello");

    // Array form
    const r2 = await client.read(["mutable://app/x"]);
    assertEquals(r2[0].record?.data, "hello");
  },
});

// ── Observe ────────────────────────────────────────────────────────

Deno.test({
  name: "FirecatDataClient - observe sees outputs from envelope decomposition",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const client = new FirecatDataClient(store);
    const ac = new AbortController();

    const observed: unknown[] = [];
    const observePromise = (async () => {
      for await (
        const result of client.observe("mutable://app/*", ac.signal)
      ) {
        observed.push(result.record?.data);
        ac.abort();
      }
    })();

    // Send an envelope that writes to mutable://app/x
    await client.receive([
      ["hash://sha256/test", {}, {
        inputs: [],
        outputs: [["mutable://app/x", {}, "observed!"]],
      }],
    ]);

    await observePromise;
    assertEquals(observed, ["observed!"]);
  },
});

// ── Status ─────────────────────────────────────────────────────────

Deno.test({
  name: "FirecatDataClient - status delegates to store",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const client = new FirecatDataClient(store);

    const status = await client.status();
    assertEquals(status.status, "healthy");
  },
});

// ── Edge cases ─────────────────────────────────────────────────────

Deno.test({
  name: "FirecatDataClient - rejects message without URI",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const client = new FirecatDataClient(store);

    // deno-lint-ignore no-explicit-any
    const results = await client.receive([[null as any, {}, {}]]);
    assertEquals(results[0].accepted, false);
    assertEquals(results[0].error, "Message URI is required");
  },
});

Deno.test({
  name: "FirecatDataClient - null data is stored without decomposition",
  ...noSanitize,
  fn: async () => {
    const store = new MemoryStore();
    const client = new FirecatDataClient(store);

    await client.receive([
      ["mutable://app/empty", {}, null],
    ]);

    const result = await store.read(["mutable://app/empty"]);
    assertEquals(result[0].success, true);
    assertEquals(result[0].record?.data, null);
  },
});

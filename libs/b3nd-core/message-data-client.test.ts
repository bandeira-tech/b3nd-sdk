/**
 * MessageDataClient Tests
 *
 * Tests message-aware envelope decomposition over a Store.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { MessageDataClient } from "./message-data-client.ts";
import { MemoryStore } from "../b3nd-client-memory/store.ts";

// ── Envelope decomposition ─────────────────────────────────────────

Deno.test({
  name: "MessageDataClient - decomposes envelope: deletes inputs, writes outputs",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);

    // Seed an input that will be consumed
    await store.write([
      { uri: "mutable://tokens/1", data: { values: { fire: 100 } } },
    ]);

    // Send envelope that consumes input and produces outputs.
    // Conserved quantities now live inside each output's payload at
    // a protocol-defined key (e.g. payload.values).
    const results = await client.receive([
      ["hash://sha256/abc123", {
        inputs: ["mutable://tokens/1"],
        outputs: [
          ["mutable://tokens/2", { values: { fire: 60 } }],
          ["mutable://tokens/3", { values: { fire: 40 } }],
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
    assertEquals(out2[0].record?.data, { values: { fire: 60 } });

    const out3 = await store.read(["mutable://tokens/3"]);
    assertEquals(out3[0].success, true);
    assertEquals(out3[0].record?.data, { values: { fire: 40 } });

    // Envelope itself was persisted
    const envelope = await store.read(["hash://sha256/abc123"]);
    assertEquals(envelope[0].success, true);
  },
});

Deno.test({
  name: "MessageDataClient - non-envelope data is stored without decomposition",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);

    // Data that doesn't have { inputs, outputs } shape
    await client.receive([
      ["mutable://app/config", { theme: "dark" }],
    ]);

    const result = await store.read(["mutable://app/config"]);
    assertEquals(result[0].success, true);
    assertEquals(result[0].record?.data, { theme: "dark" });
  },
});

Deno.test({
  name: "MessageDataClient - envelope with no inputs, only outputs",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);

    await client.receive([
      ["hash://sha256/def456", {
        inputs: [],
        outputs: [
          ["mutable://open/config", { dark: true }],
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
  name: "MessageDataClient - batch receive processes each message independently",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);

    const results = await client.receive([
      ["hash://sha256/msg1", {
        inputs: [],
        outputs: [["mutable://app/a", "A"]],
      }],
      ["hash://sha256/msg2", {
        inputs: [],
        outputs: [["mutable://app/b", "B"]],
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
  name: "MessageDataClient - read delegates to store",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);

    await store.write([
      { uri: "mutable://app/x", data: "hello" },
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
  name: "MessageDataClient - observe sees outputs from envelope decomposition",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);
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
      ["hash://sha256/test", {
        inputs: [],
        outputs: [["mutable://app/x", "observed!"]],
      }],
    ]);

    await observePromise;
    assertEquals(observed, ["observed!"]);
  },
});

Deno.test({
  name: "MessageDataClient - observe emits null for deleted inputs",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);
    const ac = new AbortController();

    // Seed an input that will be consumed
    await store.write([
      { uri: "mutable://tokens/1", data: { values: { fire: 100 }, label: "live" } },
    ]);

    const observed: { uri?: string; data: unknown }[] = [];
    const done = (async () => {
      for await (const r of client.observe("mutable://tokens/*", ac.signal)) {
        observed.push({ uri: r.uri, data: r.record?.data });
        if (observed.length >= 2) ac.abort();
      }
    })();

    await client.receive([
      ["hash://sha256/burn", {
        inputs: ["mutable://tokens/1"],
        outputs: [["mutable://tokens/2", { values: { fire: 100 }, label: "reborn" }]],
      }],
    ]);

    await done;
    assertEquals(observed, [
      { uri: "mutable://tokens/1", data: null }, // delete
      { uri: "mutable://tokens/2", data: { values: { fire: 100 }, label: "reborn" } }, // output write
    ]);
  },
});

Deno.test({
  name: "MessageDataClient - observe forwards payloads from outputs",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);
    const ac = new AbortController();

    const seen: { uri?: string; data: unknown }[] = [];
    const done = (async () => {
      for await (const r of client.observe("mutable://tokens/*", ac.signal)) {
        seen.push({ uri: r.uri, data: r.record?.data });
        if (seen.length >= 2) ac.abort();
      }
    })();

    // Conserved quantities live inside the payload at a protocol-defined key.
    await client.receive([
      ["hash://sha256/split", {
        inputs: [],
        outputs: [
          ["mutable://tokens/a", { values: { fire: 60 } }],
          ["mutable://tokens/b", { values: { fire: 40 } }],
        ],
      }],
    ]);

    await done;
    assertEquals(seen, [
      { uri: "mutable://tokens/a", data: { values: { fire: 60 } } },
      { uri: "mutable://tokens/b", data: { values: { fire: 40 } } },
    ]);
  },
});

Deno.test({
  name: "MessageDataClient - observe emits envelope URI on write",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);
    const ac = new AbortController();

    const observed: string[] = [];
    const done = (async () => {
      for await (const r of client.observe("hash://sha256/*", ac.signal)) {
        if (r.uri) observed.push(r.uri);
        ac.abort();
      }
    })();

    await client.receive([
      ["hash://sha256/env1", { theme: "dark" }],
    ]);

    await done;
    assertEquals(observed, ["hash://sha256/env1"]);
  },
});

// ── Status ─────────────────────────────────────────────────────────

Deno.test({
  name: "MessageDataClient - status delegates to store",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);

    const status = await client.status();
    assertEquals(status.status, "healthy");
  },
});

// ── Edge cases ─────────────────────────────────────────────────────

Deno.test({
  name: "MessageDataClient - rejects message without URI",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);

    // deno-lint-ignore no-explicit-any
    const results = await client.receive([[null as any, {}]]);
    assertEquals(results[0].accepted, false);
    assertEquals(results[0].error, "Message URI is required");
  },
});

Deno.test({
  name: "MessageDataClient - null data is stored without decomposition",
  fn: async () => {
    const store = new MemoryStore();
    const client = new MessageDataClient(store);

    await client.receive([
      ["mutable://app/empty", null],
    ]);

    const result = await store.read(["mutable://app/empty"]);
    assertEquals(result[0].success, true);
    assertEquals(result[0].record?.data, null);
  },
});

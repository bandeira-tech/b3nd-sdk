/**
 * ConsoleStore Tests
 *
 * ConsoleStore is write-only — it logs writes and deletes
 * but reads always return errors.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { runSharedStoreSuite } from "../b3nd-testing/shared-store-suite.ts";
import { ConsoleStore } from "./store.ts";

const noSanitize = { sanitizeOps: false, sanitizeResources: false };

// Run the shared suite with supportsRead=false
runSharedStoreSuite("ConsoleStore", {
  create: () => {
    const logs: string[] = [];
    return new ConsoleStore("test", (msg: string) => logs.push(msg));
  },
  supportsRead: false,
});

// ── Console-specific tests ────────────────────────────────────────

Deno.test({
  name: "ConsoleStore - logs write operations",
  ...noSanitize,
  fn: async () => {
    const logs: string[] = [];
    const store = new ConsoleStore("debug", (msg: string) => logs.push(msg));

    await store.write([
      {
        uri: "store://app/config",
        values: { fire: 10 },
        data: { theme: "dark" },
      },
    ]);

    assertEquals(logs.length, 1);
    assertEquals(logs[0].includes("[debug] WRITE"), true);
    assertEquals(logs[0].includes("store://app/config"), true);
  },
});

Deno.test({
  name: "ConsoleStore - logs delete operations",
  ...noSanitize,
  fn: async () => {
    const logs: string[] = [];
    const store = new ConsoleStore("debug", (msg: string) => logs.push(msg));

    await store.delete(["store://app/config"]);

    assertEquals(logs.length, 1);
    assertEquals(logs[0].includes("[debug] DELETE"), true);
    assertEquals(logs[0].includes("store://app/config"), true);
  },
});

Deno.test({
  name: "ConsoleStore - read returns error per URI",
  ...noSanitize,
  fn: async () => {
    const store = new ConsoleStore("test");

    const results = await store.read([
      "store://a",
      "store://b",
      "store://c",
    ]);

    assertEquals(results.length, 3);
    assertEquals(results.every((r) => r.success === false), true);
  },
});

import { assertEquals } from "@std/assert";
import { emit, log, noop, when } from "./processors.ts";

// ── noop() ──

Deno.test("noop - always succeeds", async () => {
  const p = noop();
  const result = await p(["mutable://x", {}, {}]);
  assertEquals(result.success, true);
});

// ── emit() ──

Deno.test("emit - calls callback and succeeds", async () => {
  let captured: unknown;
  const p = emit((msg) => {
    captured = msg;
  });

  const result = await p(["mutable://x", {}, { val: 42 }]);
  assertEquals(result.success, true);
  assertEquals(Array.isArray(captured), true);
  assertEquals((captured as [string, Record<string, number>, unknown])[0], "mutable://x");
});

Deno.test("emit - async callback succeeds", async () => {
  const p = emit(async () => {
    await new Promise((r) => setTimeout(r, 1));
  });

  const result = await p(["mutable://x", {}, {}]);
  assertEquals(result.success, true);
});

Deno.test("emit - callback error returns failure", async () => {
  const p = emit(() => {
    throw new Error("webhook failed");
  });

  const result = await p(["mutable://x", {}, {}]);
  assertEquals(result.success, false);
  assertEquals(result.error, "webhook failed");
});

// ── when() ──

Deno.test("when - runs processor when condition is true", async () => {
  let ran = false;
  const p = when(
    (msg) => msg[0].startsWith("mutable://important/"),
    // deno-lint-ignore require-await
    async () => {
      ran = true;
      return { success: true };
    },
  );

  const result = await p(["mutable://important/x", {}, {}]);
  assertEquals(result.success, true);
  assertEquals(ran, true);
});

Deno.test("when - skips processor when condition is false", async () => {
  let ran = false;
  const p = when(
    (msg) => msg[0].startsWith("mutable://important/"),
    // deno-lint-ignore require-await
    async () => {
      ran = true;
      return { success: true };
    },
  );

  const result = await p(["mutable://other/x", {}, {}]);
  assertEquals(result.success, true);
  assertEquals(ran, false);
});

Deno.test("when - async condition works", async () => {
  const p = when(
    async () => {
      await new Promise((r) => setTimeout(r, 1));
      return true;
    },
    // deno-lint-ignore require-await
    async () => ({ success: true }),
  );

  const result = await p(["mutable://x", {}, {}]);
  assertEquals(result.success, true);
});

// ── log() ──

Deno.test("log - always succeeds", async () => {
  // Suppress console output for test
  const origLog = console.log;
  const logged: string[] = [];
  console.log = (...args: unknown[]) => logged.push(args.join(" "));

  try {
    const p = log("test");
    const result = await p(["mutable://x/y", {}, { data: 1 }]);
    assertEquals(result.success, true);
    assertEquals(logged.length, 1);
    assertEquals(logged[0].includes("[test]"), true);
    assertEquals(logged[0].includes("mutable://x/y"), true);
  } finally {
    console.log = origLog;
  }
});

Deno.test("log - default prefix is 'msg'", async () => {
  const origLog = console.log;
  const logged: string[] = [];
  console.log = (...args: unknown[]) => logged.push(args.join(" "));

  try {
    const p = log();
    await p(["mutable://z", {}, {}]);
    assertEquals(logged[0].includes("[msg]"), true);
  } finally {
    console.log = origLog;
  }
});

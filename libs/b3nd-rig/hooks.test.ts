import { assertEquals } from "@std/assert";
import type { HookContext } from "./hooks.ts";
import { runPostHooks, runPreHooks } from "./hooks.ts";

// ── runPreHooks ──

Deno.test("runPreHooks - empty array passes through", async () => {
  const ctx: HookContext = { op: "read", uri: "mutable://test" };
  const result = await runPreHooks([], ctx);
  assertEquals(result.aborted, false);
  if (!result.aborted) {
    assertEquals(result.ctx, ctx);
  }
});

Deno.test("runPreHooks - void return passes through", async () => {
  const ctx: HookContext = { op: "read", uri: "mutable://test" };
  const result = await runPreHooks([() => {}], ctx);
  assertEquals(result.aborted, false);
});

Deno.test("runPreHooks - abort stops execution", async () => {
  const calls: string[] = [];
  const result = await runPreHooks(
    [
      () => {
        calls.push("first");
        return { abort: true as const, reason: "denied" };
      },
      () => {
        calls.push("second");
      },
    ],
    { op: "receive", uri: "mutable://test", data: {} },
  );
  assertEquals(result.aborted, true);
  if (result.aborted) {
    assertEquals(result.reason, "denied");
  }
  assertEquals(calls, ["first"]); // second never ran
});

Deno.test("runPreHooks - context replacement threads through", async () => {
  const result = await runPreHooks(
    [
      (_ctx) => ({
        ctx: { op: "read" as const, uri: "mutable://replaced" },
      }),
      (ctx) => {
        // Should see the replaced URI
        if (ctx.op === "read") {
          assertEquals(ctx.uri, "mutable://replaced");
        }
      },
    ],
    { op: "read", uri: "mutable://original" },
  );
  assertEquals(result.aborted, false);
  if (!result.aborted && result.ctx.op === "read") {
    assertEquals(result.ctx.uri, "mutable://replaced");
  }
});

Deno.test("runPreHooks - async hooks work", async () => {
  const result = await runPreHooks(
    [
      async () => {
        await new Promise((r) => setTimeout(r, 1));
        return { abort: true as const, reason: "async deny" };
      },
    ],
    { op: "delete", uri: "mutable://test" },
  );
  assertEquals(result.aborted, true);
  if (result.aborted) {
    assertEquals(result.reason, "async deny");
  }
});

// ── runPostHooks ──

Deno.test("runPostHooks - empty array passes result through", async () => {
  const result = await runPostHooks(
    [],
    { op: "read", uri: "mutable://test" },
    { success: true, record: { ts: 1, data: "hello" } },
  );
  assertEquals(result, { success: true, record: { ts: 1, data: "hello" } });
});

Deno.test("runPostHooks - void return passes result through", async () => {
  const result = await runPostHooks(
    [() => {}],
    { op: "read", uri: "mutable://test" },
    { success: true },
  );
  assertEquals(result, { success: true });
});

Deno.test("runPostHooks - transformation replaces result", async () => {
  const result = await runPostHooks(
    [
      (_ctx, result) => {
        const r = result as { success: boolean; record?: { data: number } };
        if (r.record) {
          return { ...r, record: { ...r.record, data: r.record.data * 2 } };
        }
      },
    ],
    { op: "read", uri: "mutable://test" },
    { success: true, record: { ts: 1, data: 5 } },
  );
  assertEquals(
    (result as { record: { data: number } }).record.data,
    10,
  );
});

Deno.test("runPostHooks - multiple hooks chain transformations", async () => {
  const result = await runPostHooks(
    [
      (_ctx, result) => ({
        ...(result as Record<string, unknown>),
        step1: true,
      }),
      (_ctx, result) => ({
        ...(result as Record<string, unknown>),
        step2: true,
      }),
    ],
    { op: "read", uri: "mutable://test" },
    { original: true },
  );
  assertEquals(result, { original: true, step1: true, step2: true });
});

Deno.test("runPostHooks - async hooks work", async () => {
  const result = await runPostHooks(
    [
      async (_ctx, _result) => {
        await new Promise((r) => setTimeout(r, 1));
        return { transformed: true };
      },
    ],
    { op: "read", uri: "mutable://test" },
    { original: true },
  );
  assertEquals(result, { transformed: true });
});

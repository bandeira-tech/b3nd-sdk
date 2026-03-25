import { assertEquals, assertRejects } from "@std/assert";
import type { HookContext } from "./hooks.ts";
import { createHookChains, runPostHooks, runPreHooks } from "./hooks.ts";

// ── runPreHooks ──

Deno.test("runPreHooks - empty array passes through", async () => {
  const ctx: HookContext = { op: "read", uri: "mutable://test" };
  const result = await runPreHooks([], ctx);
  assertEquals(result, ctx);
});

Deno.test("runPreHooks - void return passes through", async () => {
  const ctx: HookContext = { op: "read", uri: "mutable://test" };
  const result = await runPreHooks([() => {}], ctx);
  assertEquals(result, ctx);
});

Deno.test("runPreHooks - throw rejects operation", async () => {
  const calls: string[] = [];
  await assertRejects(
    () =>
      runPreHooks(
        [
          () => {
            calls.push("first");
            throw new Error("denied");
          },
          () => {
            calls.push("second");
          },
        ],
        { op: "receive", uri: "mutable://test", data: {} },
      ),
    Error,
    "denied",
  );
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
  if (result.op === "read") {
    assertEquals(result.uri, "mutable://replaced");
  }
});

Deno.test("runPreHooks - async hooks work", async () => {
  await assertRejects(
    () =>
      runPreHooks(
        [
          async () => {
            await new Promise((r) => setTimeout(r, 1));
            throw new Error("async deny");
          },
        ],
        { op: "delete", uri: "mutable://test" },
      ),
    Error,
    "async deny",
  );
});

// ── runPostHooks ──

Deno.test("runPostHooks - empty array completes", async () => {
  await runPostHooks(
    [],
    { op: "read", uri: "mutable://test" },
    { success: true, record: { ts: 1, data: "hello" } },
  );
  // no error = pass
});

Deno.test("runPostHooks - observers see the result", async () => {
  const seen: unknown[] = [];
  await runPostHooks(
    [(_ctx, result) => {
      seen.push(result);
    }],
    { op: "read", uri: "mutable://test" },
    { success: true },
  );
  assertEquals(seen, [{ success: true }]);
});

Deno.test("runPostHooks - throw propagates to caller", async () => {
  await assertRejects(
    () =>
      runPostHooks(
        [() => {
          throw new Error("post-condition violated");
        }],
        { op: "read", uri: "mutable://test" },
        { success: true },
      ),
    Error,
    "post-condition violated",
  );
});

Deno.test("runPostHooks - multiple hooks run sequentially", async () => {
  const order: number[] = [];
  await runPostHooks(
    [
      () => {
        order.push(1);
      },
      () => {
        order.push(2);
      },
      () => {
        order.push(3);
      },
    ],
    { op: "read", uri: "mutable://test" },
    { success: true },
  );
  assertEquals(order, [1, 2, 3]);
});

Deno.test("runPostHooks - async hooks work", async () => {
  let called = false;
  await runPostHooks(
    [
      async () => {
        await new Promise((r) => setTimeout(r, 1));
        called = true;
      },
    ],
    { op: "read", uri: "mutable://test" },
    { original: true },
  );
  assertEquals(called, true);
});

// ── createHookChains ──

Deno.test("createHookChains - frozen after creation", () => {
  const chains = createHookChains({
    receive: { pre: [() => {}] },
  });

  // Chains are frozen — mutations throw in strict mode or silently fail
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    (chains.receive.pre as any).push(() => {});
  } catch {
    threw = true;
  }
  // Frozen arrays throw on push in strict mode
  assertEquals(threw, true);
  assertEquals(chains.receive.pre.length, 1);
});

Deno.test("createHookChains - empty config gives empty chains", () => {
  const chains = createHookChains();
  assertEquals(chains.send.pre.length, 0);
  assertEquals(chains.send.post.length, 0);
  assertEquals(chains.receive.pre.length, 0);
  assertEquals(chains.delete.post.length, 0);
});

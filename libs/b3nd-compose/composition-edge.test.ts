/**
 * Edge case tests for b3nd-compose composition utilities.
 *
 * Covers:
 * - seq() with zero validators, single validator, error propagation
 * - any() with all failing, mixed pass/fail, single validator
 * - all() with partial failures, error aggregation
 * - parallel() processor with client adapters
 * - pipeline() processor chain
 * - firstMatch() reader with empty readers
 */

import { assertEquals } from "@std/assert";
import {
  all,
  any,
  firstMatch,
  parallel,
  pipeline,
  seq,
} from "./composition.ts";
import type { ReadResult } from "../b3nd-core/types.ts";
import type { Processor, ReadInterface, Validator } from "./types.ts";

// ── Helpers ──

function stubRead(
  store: Record<string, unknown> = {},
): <T>(uri: string) => Promise<ReadResult<T>> {
  // deno-lint-ignore require-await
  return async <T>(uri: string): Promise<ReadResult<T>> => {
    if (uri in store) {
      return {
        success: true,
        record: { data: store[uri] as T, ts: Date.now() },
      };
    }
    return { success: false, error: "Not found" };
  };
}

const pass: Validator = async () => ({ valid: true });
const failWith = (msg: string): Validator => async () => ({
  valid: false,
  error: msg,
});

// =============================================================================
// seq() — sequential validator composition
// =============================================================================

Deno.test("seq - zero validators always passes", async () => {
  const v = seq();
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, true);
});

Deno.test("seq - single validator passes through result", async () => {
  const v = seq(failWith("only-one"));
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "only-one");
});

Deno.test("seq - stops at first failure", async () => {
  let secondCalled = false;
  const second: Validator = async () => {
    secondCalled = true;
    return { valid: true };
  };

  const v = seq(failWith("first-fails"), second);
  const result = await v(["mutable://x", {}], stubRead());

  assertEquals(result.valid, false);
  assertEquals(result.error, "first-fails");
  assertEquals(secondCalled, false);
});

Deno.test("seq - runs all validators when all pass", async () => {
  const calls: number[] = [];
  const tracker = (id: number): Validator => async () => {
    calls.push(id);
    return { valid: true };
  };

  const v = seq(tracker(1), tracker(2), tracker(3));
  const result = await v(["mutable://x", {}], stubRead());

  assertEquals(result.valid, true);
  assertEquals(calls, [1, 2, 3]);
});

Deno.test("seq - preserves error from failing validator", async () => {
  const v = seq(pass, pass, failWith("third-fails"));
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "third-fails");
});

// =============================================================================
// any() — first-pass validator composition
// =============================================================================

Deno.test("any - returns valid when first passes", async () => {
  const v = any(pass, failWith("ignored"));
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, true);
});

Deno.test("any - returns valid when second passes", async () => {
  const v = any(failWith("first"), pass);
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, true);
});

Deno.test("any - aggregates all errors when none pass", async () => {
  const v = any(failWith("e1"), failWith("e2"), failWith("e3"));
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "e1; e2; e3");
});

Deno.test("any - zero validators fails with default message", async () => {
  const v = any();
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "All validators failed");
});

Deno.test("any - single passing validator", async () => {
  const v = any(pass);
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, true);
});

// =============================================================================
// all() — parallel validator composition (all must pass)
// =============================================================================

Deno.test("all - passes when all validators pass", async () => {
  const v = all(pass, pass, pass);
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, true);
});

Deno.test("all - fails when one validator fails", async () => {
  const v = all(pass, failWith("middle-fails"), pass);
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "middle-fails");
});

Deno.test("all - aggregates multiple failures", async () => {
  const v = all(failWith("a"), pass, failWith("b"));
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "a; b");
});

Deno.test("all - zero validators passes", async () => {
  const v = all();
  const result = await v(["mutable://x", {}], stubRead());
  assertEquals(result.valid, true);
});

Deno.test("all - runs validators in parallel", async () => {
  const order: number[] = [];
  const delayed = (id: number, ms: number): Validator => async () => {
    await new Promise((r) => setTimeout(r, ms));
    order.push(id);
    return { valid: true };
  };

  // If truly parallel, shorter delays finish first
  const v = all(delayed(1, 30), delayed(2, 10), delayed(3, 20));
  const result = await v(["mutable://x", {}], stubRead());

  assertEquals(result.valid, true);
  // Parallel execution means 2 (10ms) finishes before 3 (20ms) before 1 (30ms)
  assertEquals(order, [2, 3, 1]);
});

// =============================================================================
// parallel() — processor composition
// =============================================================================

Deno.test("parallel - succeeds when at least one processor succeeds", async () => {
  const failProcessor: Processor = async () => ({
    success: false,
    error: "fail",
  });
  const passProcessor: Processor = async () => ({ success: true });

  const p = parallel(failProcessor, passProcessor);
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, true);
});

Deno.test("parallel - fails when all processors fail", async () => {
  const fail1: Processor = async () => ({ success: false, error: "e1" });
  const fail2: Processor = async () => ({ success: false, error: "e2" });

  const p = parallel(fail1, fail2);
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, false);
  assertEquals(result.error!.includes("e1"), true);
  assertEquals(result.error!.includes("e2"), true);
});

Deno.test("parallel - adapts receivers (clients) automatically", async () => {
  let received: unknown = null;
  const mockClient = {
    async receive(msg: [string, unknown]) {
      received = msg;
      return { accepted: true };
    },
  };

  const p = parallel(mockClient);
  const result = await p(["mutable://test", { data: 1 }]);

  assertEquals(result.success, true);
  assertEquals(received, ["mutable://test", { data: 1 }]);
});

Deno.test("parallel - handles rejected promises from processors", async () => {
  const throwing: Processor = async () => {
    throw new Error("boom");
  };

  const p = parallel(throwing);
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, false);
});

// =============================================================================
// pipeline() — sequential processor composition
// =============================================================================

Deno.test("pipeline - runs all processors in order", async () => {
  const order: number[] = [];
  const tracker = (id: number): Processor => async () => {
    order.push(id);
    return { success: true };
  };

  const p = pipeline(tracker(1), tracker(2), tracker(3));
  const result = await p(["mutable://x", {}]);

  assertEquals(result.success, true);
  assertEquals(order, [1, 2, 3]);
});

Deno.test("pipeline - stops at first failure", async () => {
  let thirdCalled = false;
  const p = pipeline(
    async () => ({ success: true }),
    async () => ({ success: false, error: "step2-fail" }),
    async () => {
      thirdCalled = true;
      return { success: true };
    },
  );

  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, false);
  assertEquals(result.error, "step2-fail");
  assertEquals(thirdCalled, false);
});

Deno.test("pipeline - empty pipeline succeeds", async () => {
  const p = pipeline();
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, true);
});

// =============================================================================
// firstMatch() — reader composition
// =============================================================================

Deno.test("firstMatch - returns first successful read", async () => {
  const empty: ReadInterface = {
    read: async () => ({ success: false, error: "empty" }),
    readMulti: async (uris) => ({
      success: false,
      results: [],
      summary: { total: uris.length, succeeded: 0, failed: uris.length },
    }),
    list: async () => ({ success: false, error: "empty" }),
  };

  const hasData: ReadInterface = {
    read: async <T>() =>
      ({
        success: true,
        record: { data: "found" as unknown as T, ts: Date.now() },
      }) as ReadResult<T>,
    readMulti: async () => ({
      success: true,
      results: [],
      summary: { total: 0, succeeded: 0, failed: 0 },
    }),
    list: async () => ({ success: true, data: [] }),
  };

  const reader = firstMatch(empty, hasData);
  const result = await reader.read("mutable://x");
  assertEquals(result.success, true);
  assertEquals(result.record?.data, "found");
});

Deno.test("firstMatch - returns failure when none have data", async () => {
  const empty1: ReadInterface = {
    read: async () => ({ success: false, error: "nope1" }),
    readMulti: async (uris) => ({
      success: false,
      results: [],
      summary: { total: uris.length, succeeded: 0, failed: uris.length },
    }),
    list: async () => ({ success: false, error: "nope1" }),
  };
  const empty2: ReadInterface = {
    read: async () => ({ success: false, error: "nope2" }),
    readMulti: async (uris) => ({
      success: false,
      results: [],
      summary: { total: uris.length, succeeded: 0, failed: uris.length },
    }),
    list: async () => ({ success: false, error: "nope2" }),
  };

  const reader = firstMatch(empty1, empty2);
  const result = await reader.read("mutable://x");
  assertEquals(result.success, false);
  assertEquals(result.error, "Not found in any reader");
});

Deno.test("firstMatch - list falls through to second reader", async () => {
  const empty: ReadInterface = {
    read: async () => ({ success: false }),
    readMulti: async (uris) => ({
      success: false,
      results: [],
      summary: { total: uris.length, succeeded: 0, failed: uris.length },
    }),
    list: async () => ({ success: false, error: "empty" }),
  };

  const hasList: ReadInterface = {
    read: async () => ({ success: false }),
    readMulti: async (uris) => ({
      success: false,
      results: [],
      summary: { total: uris.length, succeeded: 0, failed: uris.length },
    }),
    list: async () => ({
      success: true,
      data: [{ uri: "mutable://items/1", ts: Date.now() }],
    }),
  };

  const reader = firstMatch(empty, hasList);
  const result = await reader.list("mutable://items");
  assertEquals(result.success, true);
  assertEquals(result.data!.length, 1);
});

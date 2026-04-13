import { assertEquals } from "@std/assert";
import {
  all,
  any,
  firstMatch,
  parallel,
  pipeline,
  seq,
} from "./composition.ts";
import type { Validator } from "./types.ts";
import type { ReadResult } from "../b3nd-core/types.ts";

// ── Helpers ──

// deno-lint-ignore require-await
const stubRead = async <T>(_uri: string): Promise<ReadResult<T>> => ({
  success: false as const,
  error: "stub",
});

// deno-lint-ignore require-await
const pass: Validator = async () => ({ valid: true });
// deno-lint-ignore require-await
const fail: Validator = async () => ({ valid: false, error: "failed" });
// deno-lint-ignore require-await
const failWith = (msg: string): Validator => async () => ({
  valid: false,
  error: msg,
});

// ── seq() ──

Deno.test("seq - all pass → valid", async () => {
  const v = seq(pass, pass, pass);
  const result = await v(["mutable://x", {}], undefined, stubRead);
  assertEquals(result.valid, true);
});

Deno.test("seq - first failure stops", async () => {
  let thirdCalled = false;
  // deno-lint-ignore require-await
  const third: Validator = async () => {
    thirdCalled = true;
    return { valid: true };
  };

  const v = seq(pass, fail, third);
  const result = await v(["mutable://x", {}], undefined, stubRead);
  assertEquals(result.valid, false);
  assertEquals(result.error, "failed");
  assertEquals(thirdCalled, false);
});

Deno.test("seq - empty validators → valid", async () => {
  const v = seq();
  const result = await v(["mutable://x", {}], undefined, stubRead);
  assertEquals(result.valid, true);
});

// ── any() ──

Deno.test("any - first pass wins", async () => {
  const v = any(failWith("a"), pass, failWith("c"));
  const result = await v(["mutable://x", {}], undefined, stubRead);
  assertEquals(result.valid, true);
});

Deno.test("any - all fail → combined errors", async () => {
  const v = any(failWith("err-a"), failWith("err-b"));
  const result = await v(["mutable://x", {}], undefined, stubRead);
  assertEquals(result.valid, false);
  assertEquals(result.error, "err-a; err-b");
});

Deno.test("any - empty validators → all failed message", async () => {
  const v = any();
  const result = await v(["mutable://x", {}], undefined, stubRead);
  assertEquals(result.valid, false);
  assertEquals(result.error, "All validators failed");
});

// ── all() ──

Deno.test("all - all pass → valid", async () => {
  const v = all(pass, pass, pass);
  const result = await v(["mutable://x", {}], undefined, stubRead);
  assertEquals(result.valid, true);
});

Deno.test("all - one fail → invalid", async () => {
  const v = all(pass, failWith("nope"), pass);
  const result = await v(["mutable://x", {}], undefined, stubRead);
  assertEquals(result.valid, false);
  assertEquals(result.error, "nope");
});

Deno.test("all - multiple failures → combined errors", async () => {
  const v = all(failWith("a"), pass, failWith("b"));
  const result = await v(["mutable://x", {}], undefined, stubRead);
  assertEquals(result.valid, false);
  assertEquals(result.error, "a; b");
});

Deno.test("all - empty validators → valid", async () => {
  const v = all();
  const result = await v(["mutable://x", {}], undefined, stubRead);
  assertEquals(result.valid, true);
});

// ── parallel() (processor) ──

Deno.test("parallel - at least one success → success", async () => {
  // deno-lint-ignore require-await
  const succeedProc = async () => ({ success: true });
  // deno-lint-ignore require-await
  const failProc = async () => ({ success: false, error: "fail" });

  const p = parallel(succeedProc, failProc);
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, true);
});

Deno.test("parallel - all fail → failure with errors", async () => {
  // deno-lint-ignore require-await
  const failA = async () => ({ success: false, error: "err-a" });
  // deno-lint-ignore require-await
  const failB = async () => ({ success: false, error: "err-b" });

  const p = parallel(failA, failB);
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, false);
  assertEquals(typeof result.error, "string");
  assertEquals(result.error!.includes("err-a"), true);
  assertEquals(result.error!.includes("err-b"), true);
});

Deno.test("parallel - adapts receiver objects", async () => {
  const receiver = {
    // deno-lint-ignore require-await
    receive: async () => ({ accepted: true }),
  };

  const p = parallel(receiver);
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, true);
});

Deno.test("parallel - handles thrown errors in processors", async () => {
  // deno-lint-ignore require-await
  const throwing = async () => {
    throw new Error("boom");
  };

  const p = parallel(throwing);
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, false);
});

// ── pipeline() (processor) ──

Deno.test("pipeline - all succeed → success", async () => {
  // deno-lint-ignore require-await
  const a = async () => ({ success: true });
  // deno-lint-ignore require-await
  const b = async () => ({ success: true });

  const p = pipeline(a, b);
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, true);
});

Deno.test("pipeline - first failure stops", async () => {
  let secondCalled = false;
  // deno-lint-ignore require-await
  const a = async () => ({ success: false, error: "stopped" });
  // deno-lint-ignore require-await
  const b = async () => {
    secondCalled = true;
    return { success: true };
  };

  const p = pipeline(a, b);
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, false);
  assertEquals(result.error, "stopped");
  assertEquals(secondCalled, false);
});

Deno.test("pipeline - empty → success", async () => {
  const p = pipeline();
  const result = await p(["mutable://x", {}]);
  assertEquals(result.success, true);
});

// ── firstMatch() (reader) ──

Deno.test("firstMatch - returns first successful read", async () => {
  const emptyReader = {
    // deno-lint-ignore require-await
    read: async <T = unknown>(
      uris: string | string[],
    ): Promise<ReadResult<T>[]> => {
      const uriList = Array.isArray(uris) ? uris : [uris];
      return uriList.map(() => ({ success: false as const, error: "empty" }));
    },
  };

  const dataReader = {
    // deno-lint-ignore require-await
    read: async <T = unknown>(
      uris: string | string[],
    ): Promise<ReadResult<T>[]> => {
      const uriList = Array.isArray(uris) ? uris : [uris];
      return uriList.map((uri) => ({
        success: true as const,
        uri,
        record: { data: { name: "Alice" } as T, values: {} },
      }));
    },
  };

  const composite = firstMatch(emptyReader, dataReader);

  const readResult = await composite.read("mutable://x/a");
  assertEquals(readResult[0].success, true);
});

Deno.test("firstMatch - all fail → not found", async () => {
  const failReader = {
    // deno-lint-ignore require-await
    read: async <T = unknown>(
      uris: string | string[],
    ): Promise<ReadResult<T>[]> => {
      const uriList = Array.isArray(uris) ? uris : [uris];
      return uriList.map(() => ({ success: false as const, error: "gone" }));
    },
  };

  const composite = firstMatch(failReader);

  const readResult = await composite.read("mutable://x/a");
  assertEquals(readResult[0].success, false);
});

Deno.test("firstMatch - empty readers → not found", async () => {
  const composite = firstMatch();

  const readResult = await composite.read("mutable://x");
  assertEquals(readResult[0].success, false);
  assertEquals(readResult[0].error, "Not found in any reader");
});

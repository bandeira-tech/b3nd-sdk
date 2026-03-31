import { assertEquals } from "@std/assert";
import {
  accept,
  format,
  msgSchema,
  reject,
  requireFields,
  schema,
  uriPattern,
} from "./validators.ts";
import type { ReadResult } from "../b3nd-core/types.ts";

// ── Stub read function for validators that need state ──

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

// ── accept() ──

Deno.test("accept - always returns valid", async () => {
  const v = accept();
  const result = await v(["mutable://anything", { x: 1 }], undefined, stubRead());
  assertEquals(result.valid, true);
});

Deno.test("accept - works with null data", async () => {
  const v = accept();
  const result = await v(["mutable://x", null], undefined, stubRead());
  assertEquals(result.valid, true);
});

// ── reject() ──

Deno.test("reject - always returns invalid with default message", async () => {
  const v = reject();
  const result = await v(["mutable://x", {}], undefined, stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "Rejected");
});

Deno.test("reject - uses custom message", async () => {
  const v = reject("Program disabled");
  const result = await v(["mutable://x", {}], undefined, stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "Program disabled");
});

// ── format() ──

Deno.test("format - passes when check returns true", async () => {
  const v = format(() => true);
  const result = await v(["mutable://x", { name: "Alice" }], undefined, stubRead());
  assertEquals(result.valid, true);
});

Deno.test("format - fails when check returns false", async () => {
  const v = format(() => false);
  const result = await v(["mutable://x", null], undefined, stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "Format validation failed");
});

Deno.test("format - uses custom error string from check", async () => {
  const v = format((output) => {
    const [, data] = output;
    if (typeof data !== "object" || data === null) return "data must be object";
    return true;
  });
  const result = await v(["mutable://x", "not-object"], undefined, stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "data must be object");
});

Deno.test("format - receives the full message tuple", async () => {
  let captured: unknown;
  const v = format((output) => {
    captured = output;
    return true;
  });
  await v(["mutable://x", { key: "val" }], undefined, stubRead());
  assertEquals(Array.isArray(captured), true);
  assertEquals((captured as [string, unknown])[0], "mutable://x");
});

// ── uriPattern() ──

Deno.test("uriPattern - accepts matching URI", async () => {
  const v = uriPattern(/^mutable:\/\/users\//);
  const result = await v(
    ["mutable://users/alice/profile", { name: "A" }],
    undefined,
    stubRead(),
  );
  assertEquals(result.valid, true);
});

Deno.test("uriPattern - rejects non-matching URI", async () => {
  const v = uriPattern(/^mutable:\/\/users\//);
  const result = await v(["mutable://posts/1", {}], undefined, stubRead());
  assertEquals(result.valid, false);
  assertEquals(
    result.error,
    "URI does not match pattern: /^mutable:\\/\\/users\\//",
  );
});

Deno.test("uriPattern - works with complex patterns", async () => {
  const v = uriPattern(/^mutable:\/\/users\/[a-z0-9-]+\/profile$/);
  const pass = await v(
    ["mutable://users/alice-123/profile", {}],
    undefined,
    stubRead(),
  );
  assertEquals(pass.valid, true);

  const fail = await v(
    ["mutable://users/alice/settings", {}],
    undefined,
    stubRead(),
  );
  assertEquals(fail.valid, false);
});

// ── requireFields() ──

Deno.test("requireFields - passes when all fields present", async () => {
  const v = requireFields(["name", "email"]);
  const result = await v(
    ["mutable://x", { name: "Alice", email: "a@b.com" }],
    undefined,
    stubRead(),
  );
  assertEquals(result.valid, true);
});

Deno.test("requireFields - fails when fields missing", async () => {
  const v = requireFields(["name", "email"]);
  const result = await v(
    ["mutable://x", { name: "Alice" }],
    undefined,
    stubRead(),
  );
  assertEquals(result.valid, false);
  assertEquals(result.error, "Missing required fields: email");
});

Deno.test("requireFields - fails with null data", async () => {
  const v = requireFields(["name"]);
  const result = await v(["mutable://x", null], undefined, stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "Data must be an object");
});

Deno.test("requireFields - fails with string data", async () => {
  const v = requireFields(["name"]);
  const result = await v(["mutable://x", "string-data"], undefined, stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "Data must be an object");
});

Deno.test("requireFields - lists all missing fields", async () => {
  const v = requireFields(["a", "b", "c"]);
  const result = await v(["mutable://x", {}], undefined, stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "Missing required fields: a, b, c");
});

Deno.test("requireFields - empty fields array always passes for objects", async () => {
  const v = requireFields([]);
  const result = await v(["mutable://x", { anything: true }], undefined, stubRead());
  assertEquals(result.valid, true);
});

// ── schema() ──

Deno.test("schema - routes to correct program validator", async () => {
  const s = schema({
    // deno-lint-ignore require-await
    "mutable://users": async ([uri, value], upstream, read) => {
      const v = value as Record<string, unknown>;
      if (!v?.name) return { valid: false, error: "name required" };
      return { valid: true };
    },
  });

  const pass = await s(
    ["mutable://users/alice", { name: "Alice" }],
    undefined,
    stubRead(),
  );
  assertEquals(pass.valid, true);

  const fail = await s(
    ["mutable://users/bob", { email: "b@c.com" }],
    undefined,
    stubRead(),
  );
  assertEquals(fail.valid, false);
  assertEquals(fail.error, "name required");
});

Deno.test("schema - rejects unknown programs", async () => {
  const s = schema({
    // deno-lint-ignore require-await
    "mutable://users": async () => ({ valid: true }),
  });

  const result = await s(
    ["mutable://posts/1", { title: "Hello" }],
    undefined,
    stubRead(),
  );
  assertEquals(result.valid, false);
  assertEquals(result.error, "Unknown program: mutable://posts");
});

Deno.test("schema - rejects invalid URI format", async () => {
  const s = schema({});
  const result = await s(["not-a-uri", {}], undefined, stubRead());
  assertEquals(result.valid, false);
  assertEquals(result.error, "Invalid URI format");
});

Deno.test("schema - passes read function to program validator", async () => {
  let readCalled = false;
  const s = schema({
    "mutable://users": async ([uri, value], upstream, read) => {
      if (read) {
        const existing = await read("mutable://users/alice");
        readCalled = existing.success || !existing.success;
      }
      return { valid: true };
    },
  });

  await s(
    ["mutable://users/alice", { name: "Alice" }],
    undefined,
    stubRead({ "mutable://users/alice": { name: "Old" } }),
  );
  assertEquals(readCalled, true);
});

// ── msgSchema() ──

Deno.test("msgSchema - validates plain messages like schema()", async () => {
  const v = msgSchema({
    // deno-lint-ignore require-await
    "mutable://users": async ([uri, value], upstream, read) => {
      const d = value as Record<string, unknown>;
      if (!d?.name) return { valid: false, error: "name required" };
      return { valid: true };
    },
  });

  const pass = await v(
    ["mutable://users/alice", { name: "Alice" }],
    undefined,
    stubRead(),
  );
  assertEquals(pass.valid, true);

  const fail = await v(
    ["mutable://users/bob", {}],
    undefined,
    stubRead(),
  );
  assertEquals(fail.valid, false);
});

Deno.test("msgSchema - validates MessageData envelopes", async () => {
  const v = msgSchema({
    // deno-lint-ignore require-await
    "mutable://messages": async () => ({ valid: true }),
    // deno-lint-ignore require-await
    "mutable://users": async ([uri, value], upstream, read) => {
      const d = value as Record<string, unknown>;
      if (!d?.name) return { valid: false, error: "name required" };
      return { valid: true };
    },
  });

  // MessageData envelope structure (requires payload.inputs + payload.outputs)
  const messageData = {
    payload: {
      inputs: [] as string[],
      outputs: [
        ["mutable://users/alice", { name: "Alice" }],
      ] as [string, unknown][],
    },
    auth: [{ pubkey: "abc123", signature: "sig123" }],
  };

  const result = await v(
    ["mutable://messages/msg1", messageData],
    undefined,
    stubRead(),
  );
  assertEquals(result.valid, true);
});

Deno.test("msgSchema - rejects envelope with invalid output", async () => {
  const v = msgSchema({
    // deno-lint-ignore require-await
    "mutable://messages": async () => ({ valid: true }),
    // deno-lint-ignore require-await
    "mutable://users": async ([uri, value], upstream, read) => {
      const d = value as Record<string, unknown>;
      if (!d?.name) return { valid: false, error: "name required" };
      return { valid: true };
    },
  });

  const messageData = {
    payload: {
      inputs: [] as string[],
      outputs: [
        ["mutable://users/alice", {}], // missing name
      ] as [string, unknown][],
    },
    auth: [{ pubkey: "abc123", signature: "sig123" }],
  };

  const result = await v(
    ["mutable://messages/msg1", messageData],
    undefined,
    stubRead(),
  );
  assertEquals(result.valid, false);
  assertEquals(result.error, "name required");
});

Deno.test("msgSchema - rejects envelope with unknown output program", async () => {
  const v = msgSchema({
    // deno-lint-ignore require-await
    "mutable://messages": async () => ({ valid: true }),
  });

  const messageData = {
    payload: {
      inputs: [] as string[],
      outputs: [
        ["mutable://unknown/x", { data: 1 }],
      ] as [string, unknown][],
    },
    auth: [{ pubkey: "abc123", signature: "sig123" }],
  };

  const result = await v(
    ["mutable://messages/msg1", messageData],
    undefined,
    stubRead(),
  );
  assertEquals(result.valid, false);
  assertEquals(result.error, "Unknown program: mutable://unknown");
});

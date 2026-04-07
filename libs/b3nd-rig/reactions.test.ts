import { assertEquals } from "@std/assert";
import { matchPattern, ReactionRegistry } from "./reactions.ts";

// ── matchPattern ──

Deno.test("matchPattern - exact match", () => {
  const segments = "mutable://app/config".split("/");
  assertEquals(matchPattern(segments, "mutable://app/config"), {});
  assertEquals(matchPattern(segments, "mutable://app/other"), null);
});

Deno.test("matchPattern - :param captures segment", () => {
  const segments = "mutable://app/users/:id".split("/");
  assertEquals(
    matchPattern(segments, "mutable://app/users/alice"),
    { id: "alice" },
  );
  assertEquals(
    matchPattern(segments, "mutable://app/users/bob"),
    { id: "bob" },
  );
  assertEquals(matchPattern(segments, "mutable://app/users"), null);
  assertEquals(
    matchPattern(segments, "mutable://app/users/alice/extra"),
    null,
  );
});

Deno.test("matchPattern - multiple :params", () => {
  const segments = "mutable://app/:org/users/:id".split("/");
  assertEquals(
    matchPattern(segments, "mutable://app/acme/users/alice"),
    { org: "acme", id: "alice" },
  );
});

Deno.test("matchPattern - * wildcard matches rest", () => {
  const segments = "hash://sha256/*".split("/");
  assertEquals(
    matchPattern(segments, "hash://sha256/abc123"),
    { "*": "abc123" },
  );
  assertEquals(
    matchPattern(segments, "hash://sha256/abc/def"),
    { "*": "abc/def" },
  );
});

Deno.test("matchPattern - protocol mismatch", () => {
  const segments = "mutable://app/key".split("/");
  assertEquals(matchPattern(segments, "immutable://app/key"), null);
});

Deno.test("matchPattern - empty segments", () => {
  const segments = "mutable:".split("/");
  assertEquals(matchPattern(segments, "mutable:"), {});
});

// ── ReactionRegistry ──

Deno.test("ReactionRegistry - fires matching handler", async () => {
  const registry = new ReactionRegistry();
  const calls: {
    uri: string;
    data: unknown;
    params: Record<string, string>;
  }[] = [];

  registry.add("mutable://app/users/:id", (uri, data, params) => {
    calls.push({ uri, data, params });
  });

  registry.match("mutable://app/users/alice", { name: "Alice" });
  await new Promise((r) => setTimeout(r, 10));

  assertEquals(calls.length, 1);
  assertEquals(calls[0].uri, "mutable://app/users/alice");
  assertEquals(calls[0].data, { name: "Alice" });
  assertEquals(calls[0].params, { id: "alice" });
});

Deno.test("ReactionRegistry - no match does not fire", async () => {
  const registry = new ReactionRegistry();
  let called = false;

  registry.add("mutable://app/users/:id", () => {
    called = true;
  });

  registry.match("mutable://app/posts/123", {});
  await new Promise((r) => setTimeout(r, 10));

  assertEquals(called, false);
});

Deno.test("ReactionRegistry - unsubscribe removes handler", async () => {
  const registry = new ReactionRegistry();
  let count = 0;

  const unsub = registry.add("mutable://app/config", () => {
    count++;
  });

  registry.match("mutable://app/config", {});
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(count, 1);

  unsub();

  registry.match("mutable://app/config", {});
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(count, 1); // no change
});

Deno.test("ReactionRegistry - handler errors are swallowed", async () => {
  const registry = new ReactionRegistry();
  let secondCalled = false;

  registry.add("mutable://app/key", () => {
    throw new Error("boom");
  });
  registry.add("mutable://app/key", () => {
    secondCalled = true;
  });

  registry.match("mutable://app/key", {});
  await new Promise((r) => setTimeout(r, 10));

  assertEquals(secondCalled, true);
});

Deno.test("ReactionRegistry - multiple patterns match same URI", async () => {
  const registry = new ReactionRegistry();
  const calls: string[] = [];

  registry.add("mutable://app/users/:id", () => {
    calls.push("specific");
  });
  registry.add("mutable://app/*", () => {
    calls.push("wildcard");
  });

  registry.match("mutable://app/users/alice", {});
  await new Promise((r) => setTimeout(r, 10));

  assertEquals(calls, ["specific", "wildcard"]);
});

Deno.test("ReactionRegistry - size tracks entries", () => {
  const registry = new ReactionRegistry();
  assertEquals(registry.size, 0);

  const unsub = registry.add("mutable://app/key", () => {});
  assertEquals(registry.size, 1);

  registry.add("mutable://app/other", () => {});
  assertEquals(registry.size, 2);

  unsub();
  assertEquals(registry.size, 1);
});

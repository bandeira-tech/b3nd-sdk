import { assertEquals } from "@std/assert";
import { clientAccepts, withFilter } from "./filter.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";

Deno.test("withFilter - accepts matching receive pattern", () => {
  const raw = new MemoryClient({ schema: {} });
  const filtered = withFilter(raw, {
    receive: ["mutable://*"],
  });

  assertEquals(filtered.accepts("receive", "mutable://open/test"), true);
  assertEquals(filtered.accepts("receive", "hash://sha256/abc"), false);
});

Deno.test("withFilter - rejects operations not in filter", () => {
  const raw = new MemoryClient({ schema: {} });
  const filtered = withFilter(raw, {
    receive: ["mutable://*"],
    // no read patterns
  });

  assertEquals(filtered.accepts("receive", "mutable://open/test"), true);
  assertEquals(filtered.accepts("read", "mutable://open/test"), false);
  assertEquals(filtered.accepts("list", "mutable://open/test"), false);
  assertEquals(filtered.accepts("delete", "mutable://open/test"), false);
});

Deno.test("withFilter - multiple patterns per operation", () => {
  const raw = new MemoryClient({ schema: {} });
  const filtered = withFilter(raw, {
    read: ["mutable://*", "hash://sha256/*"],
  });

  assertEquals(filtered.accepts("read", "mutable://open/test"), true);
  assertEquals(filtered.accepts("read", "hash://sha256/abc"), true);
  assertEquals(filtered.accepts("read", "firecat://message/123"), false);
});

Deno.test("withFilter - :param pattern matching", () => {
  const raw = new MemoryClient({ schema: {} });
  const filtered = withFilter(raw, {
    receive: ["mutable://accounts/:key/*"],
  });

  assertEquals(
    filtered.accepts("receive", "mutable://accounts/abc123/profile"),
    true,
  );
  assertEquals(
    filtered.accepts("receive", "mutable://open/test"),
    false,
  );
});

Deno.test("withFilter - delegates methods to underlying client", async () => {
  const schema = {
    "mutable://open": async () => ({ valid: true }),
  };
  const raw = new MemoryClient({ schema });
  const filtered = withFilter(raw, {
    receive: ["mutable://*"],
    read: ["mutable://*"],
  });

  // Write through filtered client
  const result = await filtered.receive(["mutable://open/test", { x: 1 }]);
  assertEquals(result.accepted, true);

  // Read through filtered client
  const read = await filtered.read("mutable://open/test");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, { x: 1 });
});

Deno.test("withFilter - different patterns per operation", () => {
  const raw = new MemoryClient({ schema: {} });
  const filtered = withFilter(raw, {
    receive: ["mutable://*", "hash://*"],
    read: ["mutable://*", "hash://*", "link://*"],
    list: ["mutable://*"],
    delete: ["mutable://*"],
  });

  // link:// only accepted for reads
  assertEquals(filtered.accepts("read", "link://accounts/key/path"), true);
  assertEquals(filtered.accepts("receive", "link://accounts/key/path"), false);
  assertEquals(filtered.accepts("list", "link://accounts/key/path"), false);
});

Deno.test("clientAccepts - unfiltered client accepts everything", () => {
  const raw = new MemoryClient({ schema: {} });
  assertEquals(clientAccepts(raw, "receive", "anything://here"), true);
  assertEquals(clientAccepts(raw, "read", "anything://here"), true);
});

Deno.test("clientAccepts - filtered client uses accepts()", () => {
  const raw = new MemoryClient({ schema: {} });
  const filtered = withFilter(raw, {
    receive: ["mutable://*"],
  });
  assertEquals(clientAccepts(filtered, "receive", "mutable://open/x"), true);
  assertEquals(clientAccepts(filtered, "receive", "hash://sha256/x"), false);
  assertEquals(clientAccepts(filtered, "read", "mutable://open/x"), false);
});

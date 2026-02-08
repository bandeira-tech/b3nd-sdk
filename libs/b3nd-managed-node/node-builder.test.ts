import { assertEquals } from "@std/assert";
import { assertRejects } from "@std/assert";
import { buildClientsFromSpec } from "./node-builder.ts";

Deno.test("node-builder: memory backend returns a working client", async () => {
  const acceptAll = async () => ({ valid: true });
  const schema = {
    "mutable://nodes": acceptAll,
  };

  const clients = await buildClientsFromSpec(
    [{ type: "memory", url: "memory://" }],
    schema,
  );

  assertEquals(clients.length, 1);

  // Verify the client works
  const result = await clients[0].receive([
    "mutable://nodes/abc/n1/config",
    { hello: "world" },
  ]);
  assertEquals(result.accepted, true);

  const read = await clients[0].read("mutable://nodes/abc/n1/config");
  assertEquals(read.success, true);
});

Deno.test("node-builder: multiple memory backends returns multiple clients", async () => {
  const acceptAll = async () => ({ valid: true });
  const schema = {
    "mutable://nodes": acceptAll,
  };

  const clients = await buildClientsFromSpec(
    [
      { type: "memory", url: "memory://1" },
      { type: "memory", url: "memory://2" },
    ],
    schema,
  );

  assertEquals(clients.length, 2);
});

Deno.test("node-builder: postgresql without executor throws", async () => {
  const schema = { "mutable://nodes": async () => ({ valid: true }) };

  await assertRejects(
    () =>
      buildClientsFromSpec(
        [{ type: "postgresql", url: "postgresql://localhost/db" }],
        schema,
      ),
    Error,
    "PostgreSQL executor factory required",
  );
});

Deno.test("node-builder: mongodb without executor throws", async () => {
  const schema = { "mutable://nodes": async () => ({ valid: true }) };

  await assertRejects(
    () =>
      buildClientsFromSpec(
        [{ type: "mongodb", url: "mongodb://localhost/mydb" }],
        schema,
      ),
    Error,
    "MongoDB executor factory required",
  );
});

Deno.test("node-builder: empty backends returns empty array", async () => {
  const schema = { "mutable://nodes": async () => ({ valid: true }) };
  const clients = await buildClientsFromSpec([], schema);
  assertEquals(clients.length, 0);
});

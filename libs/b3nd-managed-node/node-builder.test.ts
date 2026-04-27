import { assertEquals, assertRejects } from "@std/assert";
import { buildClientsFromSpec } from "./node-builder.ts";

Deno.test("node-builder: memory backend returns a working client", async () => {
  const clients = await buildClientsFromSpec(
    [{ type: "memory", url: "memory://" }],
  );

  assertEquals(clients.length, 1);

  const [result] = await clients[0].receive([[
    "mutable://accounts/abc/nodes/n1/config",
    { hello: "world" },
  ]]);
  assertEquals(result.accepted, true);

  const readResults = await clients[0].read(
    "mutable://accounts/abc/nodes/n1/config",
  );
  assertEquals(readResults[0].success, true);
});

Deno.test("node-builder: multiple memory backends returns multiple clients", async () => {
  const clients = await buildClientsFromSpec(
    [
      { type: "memory", url: "memory://1" },
      { type: "memory", url: "memory://2" },
    ],
  );
  assertEquals(clients.length, 2);
});

Deno.test("node-builder: postgresql without backend resolver throws", async () => {
  await assertRejects(
    () =>
      buildClientsFromSpec(
        [{ type: "postgresql", url: "postgresql://localhost/db" }],
      ),
    Error,
    "Unsupported backend type",
  );
});

Deno.test("node-builder: mongodb without backend resolver throws", async () => {
  await assertRejects(
    () =>
      buildClientsFromSpec(
        [{ type: "mongodb", url: "mongodb://localhost/mydb" }],
      ),
    Error,
    "Unsupported backend type",
  );
});

Deno.test("node-builder: empty backends returns empty array", async () => {
  const clients = await buildClientsFromSpec([]);
  assertEquals(clients.length, 0);
});

import { assertEquals, assertThrows } from "@std/assert";
import { buildClientsFromSpec } from "./node-builder.ts";

Deno.test("node-builder: memory backend returns a working client", async () => {
  const clients = buildClientsFromSpec(
    [{ type: "memory", url: "memory://" }],
  );

  assertEquals(clients.length, 1);

  const uri = "mutable://accounts/abc/nodes/n1/config";
  const [result] = await clients[0].receive([[uri, { hello: "world" }]]);
  assertEquals(result.accepted, true);

  const [output] = await clients[0].read([uri]);
  assertEquals(output[0], uri);
});

Deno.test("node-builder: multiple memory backends returns multiple clients", () => {
  const clients = buildClientsFromSpec(
    [
      { type: "memory", url: "memory://1" },
      { type: "memory", url: "memory://2" },
    ],
  );
  assertEquals(clients.length, 2);
});

Deno.test("node-builder: postgresql without backend resolver throws", () => {
  assertThrows(
    () =>
      buildClientsFromSpec(
        [{ type: "postgresql", url: "postgresql://localhost/db" }],
      ),
    Error,
    "Unsupported backend type",
  );
});

Deno.test("node-builder: mongodb without backend resolver throws", () => {
  assertThrows(
    () =>
      buildClientsFromSpec(
        [{ type: "mongodb", url: "mongodb://localhost/mydb" }],
      ),
    Error,
    "Unsupported backend type",
  );
});

Deno.test("node-builder: empty backends returns empty array", () => {
  const clients = buildClientsFromSpec([]);
  assertEquals(clients.length, 0);
});

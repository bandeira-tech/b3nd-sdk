import { assertEquals } from "@std/assert";
import { connection, Rig } from "../libs/b3nd-rig/mod.ts";
import { createTestSchema, MemoryClient } from "../libs/b3nd-client-memory/mod.ts";

Deno.test("createRigHandler - status endpoint", async () => {
  const rig = new Rig({
    connections: [connection(new MemoryClient(), { receive: ["*"], read: ["*"] })],
    schema: createTestSchema(),
  });
  const handler = rig.handler({ healthMeta: { test: true } });
  const res = await handler(new Request("http://localhost/api/v1/status"));
  const body = await res.json();
  assertEquals(body.status, "healthy");
  assertEquals(body.test, true);
});

Deno.test("createRigHandler - receive/read/list round-trip", async () => {
  const rig = new Rig({
    connections: [connection(new MemoryClient(), { receive: ["*"], read: ["*"] })],
    schema: createTestSchema(),
  });
  const handler = rig.handler();

  // Receive
  const receiveRes = await handler(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://open/hello", { msg: "world" }]),
    }),
  );
  const receive = await receiveRes.json();
  assertEquals(receive.accepted, true);

  // Read
  const readRes = await handler(
    new Request("http://localhost/api/v1/read/mutable/open/hello"),
  );
  const read = await readRes.json();
  assertEquals(read.data.msg, "world");

  // List (via trailing-slash read)
  const listRes = await handler(
    new Request("http://localhost/api/v1/list/mutable/open"),
  );
  const list = await listRes.json();
  assertEquals(list.data.length, 1);
});

Deno.test("createRigHandler - unknown route returns 404", async () => {
  const rig = new Rig({
    connections: [connection(new MemoryClient(), { receive: ["*"], read: ["*"] })],
    schema: createTestSchema(),
  });
  const handler = rig.handler();
  const res = await handler(new Request("http://localhost/unknown"));
  assertEquals(res.status, 404);
});

import { assertEquals } from "@std/assert";
import { Rig } from "../libs/b3nd-rig/mod.ts";
import { createTestSchema, MemoryClient } from "../libs/b3nd-client-memory/mod.ts";

Deno.test("createRigHandler - health endpoint", async () => {
  const rig = await Rig.init({
    client: new MemoryClient({ schema: {} }),
    schema: createTestSchema(),
  });
  const handler = rig.handler({ healthMeta: { test: true } });
  const res = await handler(new Request("http://localhost/api/v1/health"));
  const body = await res.json();
  assertEquals(body.status, "healthy");
  assertEquals(body.test, true);
  await rig.cleanup();
});

Deno.test("createRigHandler - receive/read/list round-trip", async () => {
  const rig = await Rig.init({
    client: new MemoryClient({ schema: {} }),
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

  // List
  const listRes = await handler(
    new Request("http://localhost/api/v1/list/mutable/open"),
  );
  const list = await listRes.json();
  assertEquals(list.data.length, 1);
  await rig.cleanup();
});

Deno.test("createRigHandler - delete endpoint", async () => {
  const rig = await Rig.init({
    client: new MemoryClient({ schema: {} }),
    schema: createTestSchema(),
  });
  const handler = rig.handler();

  // Write first
  await handler(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://open/del", { x: 1 }]),
    }),
  );

  // Delete
  const delRes = await handler(
    new Request("http://localhost/api/v1/delete/mutable/open/del", {
      method: "DELETE",
    }),
  );
  const del = await delRes.json();
  assertEquals(del.success, true);

  // Verify gone
  const readRes = await handler(
    new Request("http://localhost/api/v1/read/mutable/open/del"),
  );
  assertEquals(readRes.status, 404);
  await rig.cleanup();
});

Deno.test("createRigHandler - unknown route returns 404", async () => {
  const rig = await Rig.init({
    client: new MemoryClient({ schema: {} }),
    schema: createTestSchema(),
  });
  const handler = rig.handler();
  const res = await handler(new Request("http://localhost/unknown"));
  assertEquals(res.status, 404);
  await rig.cleanup();
});

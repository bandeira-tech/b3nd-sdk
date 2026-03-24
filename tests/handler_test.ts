import { assertEquals } from "@std/assert";
import { createTestSchema, MemoryClient } from "../libs/b3nd-client-memory/mod.ts";
import { createHttpHandler } from "../libs/b3nd-servers/http.ts";

Deno.test("createHttpHandler - health endpoint", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const handler = createHttpHandler(client, { healthMeta: { test: true } });
  const res = await handler(new Request("http://localhost/api/v1/health"));
  const body = await res.json();
  assertEquals(body.status, "healthy");
  assertEquals(body.test, true);
});

Deno.test("createHttpHandler - receive/read/list round-trip", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const handler = createHttpHandler(client);

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
});

Deno.test("createHttpHandler - delete endpoint", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const handler = createHttpHandler(client);

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
});

Deno.test("createHttpHandler - unknown route returns 404", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const handler = createHttpHandler(client);
  const res = await handler(new Request("http://localhost/unknown"));
  assertEquals(res.status, 404);
});

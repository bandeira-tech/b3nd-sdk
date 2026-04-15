import { assertEquals } from "@std/assert";
import { connection, httpApi, Rig } from "../libs/b3nd-rig/mod.ts";
import { createTestSchema } from "../libs/b3nd-client-memory/mod.ts";
import { MemoryStore } from "../libs/b3nd-client-memory/store.ts";
import { MessageDataClient } from "../libs/b3nd-core/message-data-client.ts";

function memClient() {
  return new MessageDataClient(new MemoryStore());
}

Deno.test("httpApi - status endpoint", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { receive: ["*"], read: ["*"] }),
    ],
    schema: createTestSchema(),
  });
  const api = httpApi(rig, { statusMeta: { test: true } });
  const res = await api(new Request("http://localhost/api/v1/status"));
  const body = await res.json();
  assertEquals(body.status, "healthy");
  assertEquals(body.test, true);
});

Deno.test("httpApi - receive/read/list round-trip", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { receive: ["*"], read: ["*"] }),
    ],
    schema: createTestSchema(),
  });
  const api = httpApi(rig);

  // Receive
  const receiveRes = await api(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://open/hello", {}, { msg: "world" }]),
    }),
  );
  const receive = await receiveRes.json();
  assertEquals(receive.accepted, true);

  // Read
  const readRes = await api(
    new Request("http://localhost/api/v1/read/mutable/open/hello"),
  );
  const read = await readRes.json();
  assertEquals(read.data.msg, "world");

  // List (via trailing-slash read)
  const listRes = await api(
    new Request("http://localhost/api/v1/list/mutable/open"),
  );
  const list = await listRes.json();
  assertEquals(list.data.length, 1);
});

Deno.test("httpApi - unknown route returns 404", async () => {
  const rig = new Rig({
    connections: [
      connection(memClient(), { receive: ["*"], read: ["*"] }),
    ],
    schema: createTestSchema(),
  });
  const api = httpApi(rig);
  const res = await api(new Request("http://localhost/unknown"));
  assertEquals(res.status, 404);
});

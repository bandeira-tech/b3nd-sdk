import { assertEquals } from "@std/assert";
import { connection, httpApi, Rig } from "../libs/b3nd-rig/mod.ts";
import { createTestPrograms } from "../libs/b3nd-client-memory/mod.ts";
import { MemoryStore } from "../libs/b3nd-client-memory/store.ts";
import { DataStoreClient } from "../libs/b3nd-core/data-store-client.ts";

function memClient() {
  return new DataStoreClient(new MemoryStore());
}

Deno.test("httpApi - status endpoint", async () => {
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
    programs: createTestPrograms(),
  });
  const api = httpApi(rig, { statusMeta: { test: true } });
  const res = await api(new Request("http://localhost/api/v1/status"));
  const body = await res.json();
  assertEquals(body.status, "healthy");
  assertEquals(body.test, true);
});

Deno.test("httpApi - receive/read/list round-trip", async () => {
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
    programs: createTestPrograms(),
  });
  const api = httpApi(rig);

  const receiveRes = await api(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://open/hello", { msg: "world" }]),
    }),
  );
  const receive = await receiveRes.json();
  assertEquals(receive.accepted, true);

  const readRes = await api(
    new Request("http://localhost/api/v1/read/mutable/open/hello"),
  );
  const read = await readRes.json();
  assertEquals(read.data.msg, "world");

  const listRes = await api(
    new Request("http://localhost/api/v1/list/mutable/open"),
  );
  const list = await listRes.json();
  assertEquals(list.data.length, 1);
});

Deno.test("httpApi - unknown route returns 404", async () => {
  const rig = new Rig({
    connections: [connection(memClient(), { receive: ["*"], read: ["*"] })],
    programs: createTestPrograms(),
  });
  const api = httpApi(rig);
  const res = await api(new Request("http://localhost/unknown"));
  assertEquals(res.status, 404);
});

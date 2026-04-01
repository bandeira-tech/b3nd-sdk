/// <reference lib="deno.ns" />
/**
 * Tests for the connection primitive and its integration with the rig.
 *
 * Covers: local routing, multi-connection broadcast/first-match,
 * unconnected URI rejection, serialization for wire, best-effort
 * enforcement, and schema/connection separation.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { MemoryClient } from "@bandeira-tech/b3nd-sdk";
import { connection } from "./connection.ts";
import { Rig } from "./rig.ts";
import type { Schema } from "../b3nd-core/types.ts";

// ── connection() unit tests ──

Deno.test("connection - accepts matching URI", () => {
  const conn = connection(new MemoryClient(), {
    receive: ["mutable://*"],
    read: ["mutable://*"],
  });
  assertEquals(conn.accepts("receive", "mutable://open/app/x"), true);
  assertEquals(conn.accepts("read", "mutable://open/app/x"), true);
});

Deno.test("connection - rejects non-matching URI", () => {
  const conn = connection(new MemoryClient(), {
    receive: ["mutable://*"],
  });
  assertEquals(conn.accepts("receive", "hash://sha256/abc"), false);
});

Deno.test("connection - rejects unlisted operation", () => {
  const conn = connection(new MemoryClient(), {
    receive: ["mutable://*"],
  });
  // read not listed → not accepted
  assertEquals(conn.accepts("read", "mutable://open/x"), false);
  assertEquals(conn.accepts("delete", "mutable://open/x"), false);
  assertEquals(conn.accepts("list", "mutable://open/x"), false);
});

Deno.test("connection - patterns are serializable", () => {
  const conn = connection(new MemoryClient(), {
    receive: ["mutable://*", "hash://*"],
    read: ["mutable://*"],
  });
  const wire = JSON.stringify(conn.patterns);
  const parsed = JSON.parse(wire);
  assertEquals(parsed.receive, ["mutable://*", "hash://*"]);
  assertEquals(parsed.read, ["mutable://*"]);
});

Deno.test("connection - express-style param patterns", () => {
  const conn = connection(new MemoryClient(), {
    read: ["mutable://accounts/:id/*"],
  });
  assertEquals(conn.accepts("read", "mutable://accounts/alice/profile"), true);
  assertEquals(conn.accepts("read", "mutable://accounts/bob/settings"), true);
  assertEquals(conn.accepts("read", "mutable://open/anything"), false);
});

Deno.test("connection - patterns are frozen", () => {
  const patterns = { receive: ["mutable://*"] };
  const conn = connection(new MemoryClient(), patterns);
  // Mutating the original doesn't affect the connection
  patterns.receive.push("hash://*");
  assertEquals(conn.patterns.receive, ["mutable://*"]);
});

// ── Rig + connections integration tests ──

Deno.test("rig routes receive to correct connection", async () => {
  const remote = new MemoryClient();
  const local = new MemoryClient();

  const rig = await Rig.init({
    connections: [
      connection(remote, { receive: ["mutable://*"], read: ["mutable://*"] }),
      connection(local, { receive: ["local://*"], read: ["local://*"] }),
    ],
  });

  await rig.receive(["mutable://open/x", { v: 1 }]);
  await rig.receive(["local://app/y", { v: 2 }]);

  // remote has mutable data, local doesn't
  const r1 = await remote.read("mutable://open/x");
  assertEquals(r1.success, true);
  const r2 = await local.read("mutable://open/x");
  assertEquals(r2.success, false);

  // local has local data, remote doesn't
  const r3 = await local.read("local://app/y");
  assertEquals(r3.success, true);
  const r4 = await remote.read("local://app/y");
  assertEquals(r4.success, false);

  await rig.cleanup();
});

Deno.test("rig reads from first matching connection", async () => {
  const primary = new MemoryClient();
  const fallback = new MemoryClient();

  // Write directly to fallback (simulating pre-existing data)
  await fallback.receive(["mutable://open/old", { from: "fallback" }]);

  const rig = await Rig.init({
    connections: [
      connection(primary, { read: ["mutable://*"], receive: ["mutable://*"] }),
      connection(fallback, { read: ["mutable://*"] }),
    ],
  });

  // Write through rig goes to primary only (fallback has no receive)
  await rig.receive(["mutable://open/new", { from: "primary" }]);

  // Read "new" → primary has it (first match)
  const r1 = await rig.read("mutable://open/new");
  assertEquals(r1.success, true);
  assertEquals(r1.record?.data, { from: "primary" });

  // Read "old" → primary doesn't have it, falls through to fallback
  const r2 = await rig.read("mutable://open/old");
  assertEquals(r2.success, true);
  assertEquals(r2.record?.data, { from: "fallback" });

  await rig.cleanup();
});

Deno.test("rig broadcasts writes to all matching connections", async () => {
  const primary = new MemoryClient();
  const mirror = new MemoryClient();

  const rig = await Rig.init({
    connections: [
      connection(primary, { receive: ["mutable://*"], read: ["mutable://*"] }),
      connection(mirror, { receive: ["mutable://*"] }),
    ],
  });

  await rig.receive(["mutable://open/x", { v: 1 }]);

  // Both have the data
  const r1 = await primary.read("mutable://open/x");
  assertEquals(r1.success, true);
  const r2 = await mirror.read("mutable://open/x");
  assertEquals(r2.success, true);

  await rig.cleanup();
});

Deno.test("rig rejects receive for unconnected URI", async () => {
  const rig = await Rig.init({
    connections: [
      connection(new MemoryClient(), { receive: ["local://*"] }),
    ],
  });

  const result = await rig.receive(["mutable://open/x", { v: 1 }]);
  assertEquals(result.accepted, false);

  await rig.cleanup();
});

Deno.test("rig rejects read for unconnected URI", async () => {
  const rig = await Rig.init({
    connections: [
      connection(new MemoryClient(), { read: ["local://*"] }),
    ],
  });

  const result = await rig.read("mutable://open/x");
  assertEquals(result.success, false);

  await rig.cleanup();
});

Deno.test("rig rejects delete for unconnected URI", async () => {
  const rig = await Rig.init({
    connections: [
      connection(new MemoryClient(), { delete: ["local://*"] }),
    ],
  });

  const result = await rig.delete("mutable://open/x");
  assertEquals(result.success, false);

  await rig.cleanup();
});

Deno.test("best-effort: local connection enforces even if client accepts everything", async () => {
  // MemoryClient accepts anything — no internal filtering
  const client = new MemoryClient();

  const rig = await Rig.init({
    connections: [
      connection(client, { receive: ["mutable://*"] }),
    ],
  });

  // hash:// not in connection → rejected by rig, even though client would accept it
  const result = await rig.receive(["hash://sha256/abc", "some data"]);
  assertEquals(result.accepted, false);

  // Verify nothing was written
  const read = await client.read("hash://sha256/abc");
  assertEquals(read.success, false);

  await rig.cleanup();
});

Deno.test("schema and connections are separate concerns", async () => {
  const client = new MemoryClient();

  const schema: Schema = {
    "mutable://open": async ([_uri, value]) => {
      if (typeof value !== "object" || value === null) {
        return { valid: false, error: "must be an object" };
      }
      return { valid: true };
    },
  };

  const rig = await Rig.init({
    connections: [
      connection(client, {
        receive: ["mutable://*"],
        read: ["mutable://*"],
      }),
    ],
    schema,
  });

  // Matches connection + passes schema → accepted
  const r1 = await rig.receive(["mutable://open/x", { valid: true }]);
  assertEquals(r1.accepted, true);

  // Matches connection but fails schema → rejected with schema error
  const r2 = await rig.receive(["mutable://open/y", "not an object"]);
  assertEquals(r2.accepted, false);

  // Doesn't match connection → rejected before schema runs
  const r3 = await rig.receive(["hash://sha256/abc", { valid: true }]);
  assertEquals(r3.accepted, false);

  await rig.cleanup();
});

Deno.test("schema validation runs after connection routing", async () => {
  const client = new MemoryClient();
  let schemaCalledWith: string[] = [];

  const schema: Schema = {
    "mutable://open": async ([uri]) => {
      schemaCalledWith.push(uri);
      return { valid: true };
    },
  };

  const rig = await Rig.init({
    connections: [
      connection(client, { receive: ["mutable://*"] }),
    ],
    schema,
  });

  // Unconnected URI → schema never called
  schemaCalledWith = [];
  await rig.receive(["hash://sha256/abc", "data"]);
  assertEquals(schemaCalledWith.length, 0);

  // Subscribed URI → schema IS called
  await rig.receive(["mutable://open/x", "data"]);
  assertEquals(schemaCalledWith.length, 1);

  await rig.cleanup();
});

Deno.test("single client via url still works (catch-all connection)", async () => {
  const rig = await Rig.init({ url: "memory://" });

  // Everything accepted — no filtering
  const r1 = await rig.receive(["mutable://open/x", { v: 1 }]);
  assertEquals(r1.accepted, true);
  const r2 = await rig.receive(["hash://sha256/whatever", "data"]);
  assertEquals(r2.accepted, true);

  await rig.cleanup();
});

Deno.test("single client via client still works (catch-all connection)", async () => {
  const rig = await Rig.init({ client: new MemoryClient() });

  const r = await rig.receive(["mutable://open/x", { v: 1 }]);
  assertEquals(r.accepted, true);
  const read = await rig.read("mutable://open/x");
  assertEquals(read.success, true);

  await rig.cleanup();
});

Deno.test("getSchema unions all connection client schemas", async () => {
  const a = new MemoryClient();
  const b = new MemoryClient();

  // Write some data so getSchema has something to report
  await a.receive(["mutable://open/x", "data"]);
  await b.receive(["local://app/y", "data"]);

  const rig = await Rig.init({
    connections: [
      connection(a, { receive: ["mutable://*"], read: ["mutable://*"] }),
      connection(b, { receive: ["local://*"], read: ["local://*"] }),
    ],
  });

  const schema = await rig.getSchema();
  assertEquals(Array.isArray(schema), true);

  await rig.cleanup();
});

Deno.test("health aggregates across all connection clients", async () => {
  const rig = await Rig.init({
    connections: [
      connection(new MemoryClient(), { receive: ["mutable://*"] }),
      connection(new MemoryClient(), { receive: ["local://*"] }),
    ],
  });

  const health = await rig.health();
  assertEquals(health.status, "healthy");

  await rig.cleanup();
});

Deno.test("cleanup runs on all connection clients", async () => {
  let cleanupCalls = 0;
  const client = new MemoryClient();
  const origCleanup = client.cleanup.bind(client);
  client.cleanup = async () => {
    cleanupCalls++;
    return origCleanup();
  };

  const rig = await Rig.init({
    connections: [
      connection(client, { receive: ["mutable://*"] }),
    ],
  });

  await rig.cleanup();
  assertEquals(cleanupCalls, 1);
});

Deno.test("list routes through connection", async () => {
  const client = new MemoryClient();

  const rig = await Rig.init({
    connections: [
      connection(client, {
        receive: ["mutable://*"],
        read: ["mutable://*"],
        list: ["mutable://*"],
      }),
    ],
  });

  await rig.receive(["mutable://open/a", "one"]);
  await rig.receive(["mutable://open/b", "two"]);

  const result = await rig.list("mutable://open");
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length >= 2, true);
  }

  await rig.cleanup();
});

Deno.test("delete broadcasts to matching connections", async () => {
  const a = new MemoryClient();
  const b = new MemoryClient();

  // Write directly to both
  await a.receive(["mutable://open/x", "data"]);
  await b.receive(["mutable://open/x", "data"]);

  const rig = await Rig.init({
    connections: [
      connection(a, { delete: ["mutable://*"], read: ["mutable://*"] }),
      connection(b, { delete: ["mutable://*"] }),
    ],
  });

  await rig.delete("mutable://open/x");

  const r1 = await a.read("mutable://open/x");
  assertEquals(r1.success, false);
  const r2 = await b.read("mutable://open/x");
  assertEquals(r2.success, false);

  await rig.cleanup();
});

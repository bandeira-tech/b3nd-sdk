/// <reference lib="deno.ns" />
/**
 * Tests for the subscription primitive and its integration with the rig.
 *
 * Covers: local routing, multi-subscription broadcast/first-match,
 * unsubscribed URI rejection, serialization for wire, best-effort
 * enforcement, and schema/subscription separation.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { MemoryClient } from "@bandeira-tech/b3nd-sdk";
import { subscribe } from "./subscription.ts";
import { Rig } from "./rig.ts";
import type { Schema } from "../b3nd-core/types.ts";

// ── subscribe() unit tests ──

Deno.test("subscribe - accepts matching URI", () => {
  const sub = subscribe(new MemoryClient(), {
    receive: ["mutable://*"],
    read: ["mutable://*"],
  });
  assertEquals(sub.accepts("receive", "mutable://open/app/x"), true);
  assertEquals(sub.accepts("read", "mutable://open/app/x"), true);
});

Deno.test("subscribe - rejects non-matching URI", () => {
  const sub = subscribe(new MemoryClient(), {
    receive: ["mutable://*"],
  });
  assertEquals(sub.accepts("receive", "hash://sha256/abc"), false);
});

Deno.test("subscribe - rejects unlisted operation", () => {
  const sub = subscribe(new MemoryClient(), {
    receive: ["mutable://*"],
  });
  // read not listed → not accepted
  assertEquals(sub.accepts("read", "mutable://open/x"), false);
  assertEquals(sub.accepts("delete", "mutable://open/x"), false);
  assertEquals(sub.accepts("list", "mutable://open/x"), false);
});

Deno.test("subscribe - patterns are serializable", () => {
  const sub = subscribe(new MemoryClient(), {
    receive: ["mutable://*", "hash://*"],
    read: ["mutable://*"],
  });
  const wire = JSON.stringify(sub.patterns);
  const parsed = JSON.parse(wire);
  assertEquals(parsed.receive, ["mutable://*", "hash://*"]);
  assertEquals(parsed.read, ["mutable://*"]);
});

Deno.test("subscribe - express-style param patterns", () => {
  const sub = subscribe(new MemoryClient(), {
    read: ["mutable://accounts/:id/*"],
  });
  assertEquals(sub.accepts("read", "mutable://accounts/alice/profile"), true);
  assertEquals(sub.accepts("read", "mutable://accounts/bob/settings"), true);
  assertEquals(sub.accepts("read", "mutable://open/anything"), false);
});

Deno.test("subscribe - patterns are frozen", () => {
  const patterns = { receive: ["mutable://*"] };
  const sub = subscribe(new MemoryClient(), patterns);
  // Mutating the original doesn't affect the subscription
  patterns.receive.push("hash://*");
  assertEquals(sub.patterns.receive, ["mutable://*"]);
});

// ── Rig + subscriptions integration tests ──

Deno.test("rig routes receive to correct subscription", async () => {
  const remote = new MemoryClient();
  const local = new MemoryClient();

  const rig = await Rig.init({
    subscriptions: [
      subscribe(remote, { receive: ["mutable://*"], read: ["mutable://*"] }),
      subscribe(local, { receive: ["local://*"], read: ["local://*"] }),
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

Deno.test("rig reads from first matching subscription", async () => {
  const primary = new MemoryClient();
  const fallback = new MemoryClient();

  // Write directly to fallback (simulating pre-existing data)
  await fallback.receive(["mutable://open/old", { from: "fallback" }]);

  const rig = await Rig.init({
    subscriptions: [
      subscribe(primary, { read: ["mutable://*"], receive: ["mutable://*"] }),
      subscribe(fallback, { read: ["mutable://*"] }),
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

Deno.test("rig broadcasts writes to all matching subscriptions", async () => {
  const primary = new MemoryClient();
  const mirror = new MemoryClient();

  const rig = await Rig.init({
    subscriptions: [
      subscribe(primary, { receive: ["mutable://*"], read: ["mutable://*"] }),
      subscribe(mirror, { receive: ["mutable://*"] }),
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

Deno.test("rig rejects receive for unsubscribed URI", async () => {
  const rig = await Rig.init({
    subscriptions: [
      subscribe(new MemoryClient(), { receive: ["local://*"] }),
    ],
  });

  const result = await rig.receive(["mutable://open/x", { v: 1 }]);
  assertEquals(result.accepted, false);

  await rig.cleanup();
});

Deno.test("rig rejects read for unsubscribed URI", async () => {
  const rig = await Rig.init({
    subscriptions: [
      subscribe(new MemoryClient(), { read: ["local://*"] }),
    ],
  });

  const result = await rig.read("mutable://open/x");
  assertEquals(result.success, false);

  await rig.cleanup();
});

Deno.test("rig rejects delete for unsubscribed URI", async () => {
  const rig = await Rig.init({
    subscriptions: [
      subscribe(new MemoryClient(), { delete: ["local://*"] }),
    ],
  });

  const result = await rig.delete("mutable://open/x");
  assertEquals(result.success, false);

  await rig.cleanup();
});

Deno.test("best-effort: local subscription enforces even if client accepts everything", async () => {
  // MemoryClient accepts anything — no internal filtering
  const client = new MemoryClient();

  const rig = await Rig.init({
    subscriptions: [
      subscribe(client, { receive: ["mutable://*"] }),
    ],
  });

  // hash:// not in subscription → rejected by rig, even though client would accept it
  const result = await rig.receive(["hash://sha256/abc", "some data"]);
  assertEquals(result.accepted, false);

  // Verify nothing was written
  const read = await client.read("hash://sha256/abc");
  assertEquals(read.success, false);

  await rig.cleanup();
});

Deno.test("schema and subscriptions are separate concerns", async () => {
  const client = new MemoryClient();

  const schema: Schema = {
    "mutable://open": async ({ value }) => {
      if (typeof value !== "object" || value === null) {
        return { valid: false, error: "must be an object" };
      }
      return { valid: true };
    },
  };

  const rig = await Rig.init({
    subscriptions: [
      subscribe(client, {
        receive: ["mutable://*"],
        read: ["mutable://*"],
      }),
    ],
    schema,
  });

  // Matches subscription + passes schema → accepted
  const r1 = await rig.receive(["mutable://open/x", { valid: true }]);
  assertEquals(r1.accepted, true);

  // Matches subscription but fails schema → rejected with schema error
  const r2 = await rig.receive(["mutable://open/y", "not an object"]);
  assertEquals(r2.accepted, false);

  // Doesn't match subscription → rejected before schema runs
  const r3 = await rig.receive(["hash://sha256/abc", { valid: true }]);
  assertEquals(r3.accepted, false);

  await rig.cleanup();
});

Deno.test("schema validation runs after subscription routing", async () => {
  const client = new MemoryClient();
  let schemaCalledWith: string[] = [];

  const schema: Schema = {
    "mutable://open": async ({ uri }) => {
      schemaCalledWith.push(uri);
      return { valid: true };
    },
  };

  const rig = await Rig.init({
    subscriptions: [
      subscribe(client, { receive: ["mutable://*"] }),
    ],
    schema,
  });

  // Unsubscribed URI → schema never called
  schemaCalledWith = [];
  await rig.receive(["hash://sha256/abc", "data"]);
  assertEquals(schemaCalledWith.length, 0);

  // Subscribed URI → schema IS called
  await rig.receive(["mutable://open/x", "data"]);
  assertEquals(schemaCalledWith.length, 1);

  await rig.cleanup();
});

Deno.test("single client via url still works (catch-all subscription)", async () => {
  const rig = await Rig.init({ url: "memory://" });

  // Everything accepted — no filtering
  const r1 = await rig.receive(["mutable://open/x", { v: 1 }]);
  assertEquals(r1.accepted, true);
  const r2 = await rig.receive(["hash://sha256/whatever", "data"]);
  assertEquals(r2.accepted, true);

  await rig.cleanup();
});

Deno.test("single client via client still works (catch-all subscription)", async () => {
  const rig = await Rig.init({ client: new MemoryClient() });

  const r = await rig.receive(["mutable://open/x", { v: 1 }]);
  assertEquals(r.accepted, true);
  const read = await rig.read("mutable://open/x");
  assertEquals(read.success, true);

  await rig.cleanup();
});

Deno.test("getSchema unions all subscription client schemas", async () => {
  const a = new MemoryClient();
  const b = new MemoryClient();

  // Write some data so getSchema has something to report
  await a.receive(["mutable://open/x", "data"]);
  await b.receive(["local://app/y", "data"]);

  const rig = await Rig.init({
    subscriptions: [
      subscribe(a, { receive: ["mutable://*"], read: ["mutable://*"] }),
      subscribe(b, { receive: ["local://*"], read: ["local://*"] }),
    ],
  });

  const schema = await rig.getSchema();
  assertEquals(Array.isArray(schema), true);

  await rig.cleanup();
});

Deno.test("health aggregates across all subscription clients", async () => {
  const rig = await Rig.init({
    subscriptions: [
      subscribe(new MemoryClient(), { receive: ["mutable://*"] }),
      subscribe(new MemoryClient(), { receive: ["local://*"] }),
    ],
  });

  const health = await rig.health();
  assertEquals(health.status, "healthy");

  await rig.cleanup();
});

Deno.test("cleanup runs on all subscription clients", async () => {
  let cleanupCalls = 0;
  const client = new MemoryClient();
  const origCleanup = client.cleanup.bind(client);
  client.cleanup = async () => {
    cleanupCalls++;
    return origCleanup();
  };

  const rig = await Rig.init({
    subscriptions: [
      subscribe(client, { receive: ["mutable://*"] }),
    ],
  });

  await rig.cleanup();
  assertEquals(cleanupCalls, 1);
});

Deno.test("list routes through subscription", async () => {
  const client = new MemoryClient();

  const rig = await Rig.init({
    subscriptions: [
      subscribe(client, {
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

Deno.test("delete broadcasts to matching subscriptions", async () => {
  const a = new MemoryClient();
  const b = new MemoryClient();

  // Write directly to both
  await a.receive(["mutable://open/x", "data"]);
  await b.receive(["mutable://open/x", "data"]);

  const rig = await Rig.init({
    subscriptions: [
      subscribe(a, { delete: ["mutable://*"], read: ["mutable://*"] }),
      subscribe(b, { delete: ["mutable://*"] }),
    ],
  });

  await rig.delete("mutable://open/x");

  const r1 = await a.read("mutable://open/x");
  assertEquals(r1.success, false);
  const r2 = await b.read("mutable://open/x");
  assertEquals(r2.success, false);

  await rig.cleanup();
});

/// <reference lib="deno.ns" />
import { assert, assertEquals } from "@std/assert";
import { connection, Identity, Rig } from "@b3nd/rig";
import {
  createValidatedClient,
  MemoryStore,
  MessageDataClient,
  msgSchema,
} from "@bandeira-tech/b3nd-sdk";
import { createSchema, registerApp, SharenetSession } from "./mod.ts";

async function setup() {
  const operator = await Identity.fromSeed("test-operator");
  const schema = createSchema({ operators: [operator.pubkey] });
  const store = new MessageDataClient(new MemoryStore());
  // rig.send() bypasses the schema (it's only applied on rig.receive()),
  // so wrap the client in a validator to enforce the protocol in-process.
  const validated = createValidatedClient({
    write: store,
    read: store,
    validate: msgSchema(schema),
  });
  const rig = new Rig({
    connections: [connection(validated, { receive: ["*"], read: ["*"] })],
    schema,
  });
  return { operator, rig };
}

Deno.test("operator registers app, user writes, reads back", async () => {
  const { operator, rig } = await setup();
  const reg = await registerApp(rig, operator, {
    appId: "listify",
    name: "Listify",
    ownerPubkey: operator.pubkey,
    version: 1,
  });
  assertEquals(reg.accepted, true);

  const alice = await Identity.fromSeed("test-alice");
  const s = new SharenetSession(rig, "listify", alice);
  const w = await s.setItem("lists/x", { items: ["milk", "eggs"] });
  assertEquals(w.accepted, true);

  const back = await s.getItem<{ items: string[] }>("lists/x");
  assertEquals(back?.items, ["milk", "eggs"]);
});

Deno.test("writes to an unregistered app are rejected", async () => {
  const { rig } = await setup();
  const alice = await Identity.fromSeed("test-alice");
  const s = new SharenetSession(rig, "ghostapp", alice);
  const w = await s.setItem("x", { a: 1 });
  assertEquals(w.accepted, false);
  assert(w.error?.includes("not registered"));
});

Deno.test("user cannot write under another user's pubkey", async () => {
  const { operator, rig } = await setup();
  await registerApp(rig, operator, {
    appId: "listify",
    name: "Listify",
    ownerPubkey: operator.pubkey,
    version: 1,
  });
  const alice = await Identity.fromSeed("test-alice");
  const bob = await Identity.fromSeed("test-bob");
  // Alice signs, but the target URI carries Bob's pubkey.
  const session = alice.rig(rig);
  const result = await session.send({
    inputs: [],
    outputs: [[
      `mutable://sharenet/listify/users/${bob.pubkey}/hijack`,
      {},
      { pwned: true },
    ]],
  });
  assertEquals(result.accepted, false);
  assert(result.error?.includes("not signed by path pubkey"));
});

Deno.test("hash:// blobs verify and link:// requires existing target", async () => {
  const { operator, rig } = await setup();
  await registerApp(rig, operator, {
    appId: "inkwell",
    name: "Inkwell",
    ownerPubkey: operator.pubkey,
    version: 1,
  });
  const alice = await Identity.fromSeed("test-alice");
  const s = new SharenetSession(rig, "inkwell", alice);

  const target = await s.publishBlob({ hello: "world" });
  const ok = await s.setLink("pinned", target);
  assertEquals(ok.accepted, true);

  // link to non-existent hash should fail
  const bogus = await s.setLink(
    "bogus",
    "hash://sha256/" + "0".repeat(64),
  );
  assertEquals(bogus.accepted, false);
});

Deno.test("encrypted write round-trips through setPrivate/getPrivate", async () => {
  const { operator, rig } = await setup();
  await registerApp(rig, operator, {
    appId: "whisper",
    name: "Whisper",
    ownerPubkey: operator.pubkey,
    version: 1,
  });
  const alice = await Identity.fromSeed("test-alice");
  const s = new SharenetSession(rig, "whisper", alice);
  await s.setPrivate("notes/diary", { mood: "curious" });
  const back = await s.getPrivate<{ mood: string }>("notes/diary");
  assertEquals(back?.mood, "curious");
});

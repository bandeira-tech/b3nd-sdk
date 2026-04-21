/**
 * Protocol-level tests — the schema's acceptance/rejection rules.
 *
 * These run against a bare MessageDataClient + Rig with the shared-infra
 * schema, no app SDK. They pin down the contract the SDK depends on.
 */

import { assert, assertEquals } from "./_assert.ts";
import { send } from "../../../libs/b3nd-msg/data/send.ts";
import { generateIdentity, uri, AppClient } from "../sdk/mod.ts";
import * as encrypt from "../../../libs/b3nd-encrypt/mod.ts";
import { buildRig } from "./fixtures.ts";

Deno.test("shared-infra: app writes rejected before registration", async () => {
  const { client } = buildRig();
  const result = await send({
    inputs: [],
    outputs: [[uri.config("not-registered"), {}, { hello: "world" }]],
  }, client);
  assertEquals(result.accepted, false);
  assert(/not registered/i.test(result.error ?? ""));
});

Deno.test("shared-infra: registration enables app writes", async () => {
  const { client } = buildRig();
  const app = new AppClient({ appId: "demo", client });
  await app.register({ name: "Demo" });

  const write = await app.putConfig({ theme: "dark" });
  assertEquals(write.accepted, true);

  const cfg = await app.getConfig<{ theme: string }>();
  assertEquals(cfg?.theme, "dark");
});

Deno.test("shared-infra: user path requires valid signature from owner", async () => {
  const { client } = buildRig();
  const app = new AppClient({ appId: "demo", client });
  await app.register({ name: "Demo" });

  const alice = await generateIdentity();
  const bob = await generateIdentity();

  // Alice signs and writes to her own path: OK.
  const envelope = await encrypt.createAuthenticatedMessageWithHex(
    { hello: "alice" },
    alice.pubkeyHex,
    alice.privateKeyHex,
  );
  const ok = await send({
    inputs: [],
    outputs: [[
      uri.userDoc("demo", alice.pubkeyHex, "doc"),
      {},
      envelope,
    ]],
  }, client);
  assertEquals(ok.accepted, true);

  // Bob tries to write with his signature to *Alice's* path: rejected.
  const bobEnvelope = await encrypt.createAuthenticatedMessageWithHex(
    { hello: "bob" },
    bob.pubkeyHex,
    bob.privateKeyHex,
  );
  const bad = await send({
    inputs: [],
    outputs: [[
      uri.userDoc("demo", alice.pubkeyHex, "doc"),
      {},
      bobEnvelope,
    ]],
  }, client);
  assertEquals(bad.accepted, false);
  assert(/signature does not match/i.test(bad.error ?? ""));
});

Deno.test("shared-infra: hash:// is write-once", async () => {
  const { client } = buildRig();
  const app = new AppClient({ appId: "demo", client });
  await app.register({ name: "Demo" });

  const first = await app.putContent({ text: "hello" });
  assert(first.startsWith("hash://sha256/"));

  // Putting the same content returns the same URI and tolerates the
  // "already exists" write-once rejection.
  const second = await app.putContent({ text: "hello" });
  assertEquals(first, second);
});

Deno.test("shared-infra: link must point at an existing hash", async () => {
  const { client } = buildRig();
  const app = new AppClient({ appId: "demo", client });
  await app.register({ name: "Demo" });

  const dangling = await send({
    inputs: [],
    outputs: [[
      uri.latest("demo", "nonsense"),
      {},
      "hash://sha256/deadbeef".padEnd(80, "0"),
    ]],
  }, client);
  assertEquals(dangling.accepted, false);
  assert(/linked content not found/i.test(dangling.error ?? ""));
});

Deno.test("shared-infra: log:// is append-only (rejects overwrite)", async () => {
  const { client } = buildRig();
  const app = new AppClient({ appId: "demo", client });
  await app.register({ name: "Demo" });

  const first = await app.appendLog("audit/1", { at: 1, note: "hi" });
  assertEquals(first.accepted, true);

  const second = await app.appendLog("audit/1", { at: 2, note: "collide" });
  assertEquals(second.accepted, false);
  assert(/already exists/i.test(second.error ?? ""));
});

Deno.test("shared-infra: quota enforced on oversized payloads", async () => {
  const { client } = buildRig({ maxPayloadBytes: 64 });
  const app = new AppClient({ appId: "demo", client });
  await app.register({ name: "Demo" }); // { appId, name, createdAt } fits

  const big = "x".repeat(1024);
  const huge = await app.putConfig({ big });
  assertEquals(huge.accepted, false);
  assert(/too large/i.test(huge.error ?? ""));
});

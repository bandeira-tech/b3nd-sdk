/**
 * Lightweight throughput smoke — not a benchmark, but a regression guard
 * that pushes ~a few thousand writes through the rig and asserts nothing
 * rejects unexpectedly. Useful when changing the schema, hooks, or the
 * parallel-broadcast combinator.
 */

import { assert, assertEquals } from "./_assert.ts";
import { buildRig } from "./fixtures.ts";
import { AppClient, generateIdentity } from "../sdk/mod.ts";
import { Chat } from "../apps/chat/mod.ts";

Deno.test("throughput: 500 chat messages in one rig", async () => {
  const { client, rig } = buildRig({ backends: 2 });
  const alice = await generateIdentity();
  const chat = await Chat.connect({
    app: new AppClient({ appId: "chat", client }),
    identity: alice,
  });
  const room = await chat.createRoom("load");

  const N = 500;
  let accepted = 0;
  let rejected = 0;
  rig.on("receive:success", () => {
    accepted++;
  });
  rig.on("receive:error", () => {
    rejected++;
  });

  const start = performance.now();
  await Promise.all(
    Array.from({ length: N }, (_, i) => chat.postMessage(room.id, `m-${i}`)),
  );
  const elapsed = performance.now() - start;

  const history = await chat.history(room.id, N + 10);
  assertEquals(history.length, N);
  assertEquals(rejected, 0, `unexpected rejections: ${rejected}`);
  assert(accepted > 0, "expected receive:success events");

  // Not an assertion on time — just make it visible when running -v.
  console.log(
    `[throughput] ${N} chat msgs in ${elapsed.toFixed(0)}ms → ${
      (N / elapsed * 1000).toFixed(0)
    } msg/s`,
  );
});

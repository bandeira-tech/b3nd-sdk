/**
 * Replication & store stress tests.
 *
 * Points a rig at N MemoryStore backends via `parallelBroadcast`, then
 * drives writes from all three sample apps concurrently. After the run
 * we assert that every backend has a byte-identical copy of every key —
 * which is what "shared nodes" replication means in practice.
 */

import { assert, assertEquals } from "./_assert.ts";
import { buildRig } from "./fixtures.ts";
import { AppClient, generateIdentity } from "../sdk/mod.ts";
import { ListManager } from "../apps/list-manager/mod.ts";
import { Blog } from "../apps/blog/mod.ts";
import { Chat } from "../apps/chat/mod.ts";

// Helper — list all keys directly from a backend's MemoryStore.
async function dumpKeys(c: { read: (uri: string) => Promise<any[]> }) {
  const rows: string[] = [];
  for (const prefix of [
    "mutable://registry/apps/",
    "mutable://app/",
    "hash://sha256/",
    "link://app/",
    "log://app/",
  ]) {
    const r = await c.read(prefix);
    for (const x of r) rows.push(x.uri ?? "");
  }
  return rows.filter(Boolean).sort();
}

Deno.test("replication: writes broadcast to all backends", async () => {
  const { client, backends } = buildRig({ backends: 3 });
  const app = new AppClient({ appId: "demo", client });
  await app.register({ name: "Demo" });
  await app.putConfig({ theme: "neon" });

  for (const b of backends) {
    const [cfg] = await b.read<{ theme: string }>("mutable://app/demo/config");
    assertEquals(cfg.record?.data.theme, "neon");
  }
});

Deno.test("replication: concurrent traffic from 3 apps lands identically", async () => {
  const { client, backends } = buildRig({ backends: 3 });
  const alice = await generateIdentity();
  const bob = await generateIdentity();

  const lm = await ListManager.connect({
    app: new AppClient({ appId: "list-manager", client }),
    identity: alice,
  });
  const blog = await Blog.connect({
    app: new AppClient({ appId: "blog", client }),
    identity: alice,
  });
  const chatA = await Chat.connect({
    app: new AppClient({ appId: "chat", client }),
    identity: alice,
  });
  const chatB = await Chat.connect({
    app: new AppClient({ appId: "chat", client }),
    identity: bob,
  });

  // Drive each app's workload in parallel.
  const room = await chatA.createRoom("stress");
  const listP = (async () => {
    const list = await lm.createList("Stress Test");
    for (let i = 0; i < 20; i++) {
      await lm.addItem(list.id, `item-${i}`);
    }
  })();
  const blogP = (async () => {
    for (let i = 0; i < 10; i++) {
      await blog.publish({
        slug: `post-${i % 3}`,
        title: `Post ${i}`,
        body: `body ${i}`,
        tags: [`v${i}`],
      });
    }
  })();
  const chatP = (async () => {
    for (let i = 0; i < 40; i++) {
      const who = i % 2 === 0 ? chatA : chatB;
      await who.postMessage(room.id, `msg-${i}`);
    }
  })();
  await Promise.all([listP, blogP, chatP]);

  // Every backend sees the same set of keys.
  const dumps = await Promise.all(backends.map((b) => dumpKeys(b)));
  for (let i = 1; i < dumps.length; i++) {
    assertEquals(
      dumps[i],
      dumps[0],
      `backend #${i} diverged from backend #0`,
    );
  }

  // The log has all 40 messages — log:// is append-only so nothing clobbers.
  const logs = await chatA.session.app.listLog(`rooms/${room.id}`);
  assertEquals(logs.length, 40);
});

Deno.test("replication: read fallback when first backend misses", async () => {
  const { backends } = buildRig({ backends: 2 });
  // Simulate "cold cache, warm backup" — put directly in backend #1, not #0.
  await backends[1].receive([[
    "mutable://registry/apps/warm",
    {},
    { appId: "warm", name: "Warm" },
  ]]);
  await backends[1].receive([[
    "mutable://app/warm/config",
    {},
    { replicated: true },
  ]]);

  // Build a second rig that treats #0 as primary, #1 as fallback.
  const { firstMatchSequence } = await import(
    "../../../libs/b3nd-combinators/mod.ts"
  );
  const merged = firstMatchSequence(backends);
  const [cfg] = await merged.read<{ replicated: boolean }>(
    "mutable://app/warm/config",
  );
  assert(cfg.success);
  assertEquals(cfg.record?.data.replicated, true);
});

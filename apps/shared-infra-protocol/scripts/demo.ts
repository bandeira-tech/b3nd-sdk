/**
 * End-to-end demo: start a shared-infra rig in-process, then drive all
 * three sample apps against it. Prints a summary so you can eyeball
 * replication and per-app state at the end.
 *
 * Run:
 *   deno run -A apps/shared-infra-protocol/scripts/demo.ts
 */

import { buildRig } from "../stress/fixtures.ts";
import { AppClient, generateIdentity } from "../sdk/mod.ts";
import { ListManager } from "../apps/list-manager/mod.ts";
import { Blog } from "../apps/blog/mod.ts";
import { Chat } from "../apps/chat/mod.ts";

const { client, backends } = buildRig({ backends: 2 });

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

const chat = await Chat.connect({
  app: new AppClient({ appId: "chat", client }),
  identity: alice,
});
const chatBob = await Chat.connect({
  app: new AppClient({ appId: "chat", client }),
  identity: bob,
});

// list-manager
const groceries = await lm.createList("Groceries");
for (const item of ["Milk", "Bread", "Eggs", "Coffee"]) {
  await lm.addItem(groceries.id, item);
}
await lm.toggleItem(groceries.id, (await lm.getList(groceries.id))!.items[0].id);

// blog
await blog.publish({
  slug: "hello",
  title: "Hello, shared-infra",
  body: "First post against a shared b3nd node.",
  tags: ["welcome"],
});
await blog.publish({
  slug: "hello",
  title: "Hello, shared-infra (v2)",
  body: "Edited — old body still lives at its hash://.",
  tags: ["welcome", "edit"],
});
await blog.publish({
  slug: "patterns",
  title: "Protocol patterns",
  body: "log:// for events, link:// for pointers, hash:// for bodies.",
  tags: ["architecture"],
});

// chat
const room = await chat.createRoom("#general", "everyone");
await chat.postMessage(room.id, "hey team");
await new Promise((r) => setTimeout(r, 2));
await chatBob.postMessage(room.id, "hi alice!");
await new Promise((r) => setTimeout(r, 2));
await chat.postMessage(room.id, "demo is live");
await chat.setPresence("online");
await chatBob.setPresence("online");

// ── summary ────────────────────────────────────────────────────

const sep = "─".repeat(60);

console.log(sep);
console.log("list-manager (alice)");
console.log(sep);
for (const list of await lm.listLists()) {
  console.log(`  [${list.title}] — ${list.items.length} items`);
  for (const item of list.items) {
    console.log(`    ${item.done ? "[x]" : "[ ]"} ${item.text}`);
  }
}

console.log(sep);
console.log("blog — latest posts");
console.log(sep);
for (const entry of await blog.listPosts()) {
  const body = await blog.getLatest(entry.slug);
  console.log(`  ${entry.slug}  ${entry.title}`);
  console.log(`    body: ${body?.body}`);
  const history = await blog.history(entry.slug);
  console.log(`    history: ${history.length} version(s)`);
}

console.log(sep);
console.log(`chat — rooms & history`);
console.log(sep);
for (const r of await chat.listRooms()) {
  console.log(`  #${r.name} (${r.id})`);
  for (const m of await chat.history(r.id)) {
    const who = m.author === alice.pubkeyHex
      ? "alice"
      : m.author === bob.pubkeyHex
      ? "bob"
      : m.author.slice(0, 8);
    console.log(`    ${who}: ${m.text}`);
  }
}

console.log(sep);
console.log("replication check");
console.log(sep);
for (let i = 0; i < backends.length; i++) {
  const stored = await backends[i].read("mutable://app/");
  const logs = await backends[i].read("log://app/");
  const hashes = await backends[i].read("hash://sha256/");
  console.log(
    `  backend[${i}]  mutable=${stored.length}  logs=${logs.length}  hashes=${hashes.length}`,
  );
}

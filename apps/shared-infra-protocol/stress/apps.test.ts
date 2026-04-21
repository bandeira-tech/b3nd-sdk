/**
 * End-to-end sample-app tests — each of list-manager, blog, and chat
 * driven through the SDK against a single shared node. The point is to
 * prove that unrelated apps coexist under one schema / one rig without
 * stepping on each other.
 */

import { assert, assertEquals } from "./_assert.ts";
import { buildRig } from "./fixtures.ts";
import { AppClient, generateIdentity } from "../sdk/mod.ts";
import { ListManager } from "../apps/list-manager/mod.ts";
import { Blog } from "../apps/blog/mod.ts";
import { Chat } from "../apps/chat/mod.ts";

Deno.test("list-manager: basic CRUD via signed user session", async () => {
  const { client } = buildRig();
  const identity = await generateIdentity();
  const app = new AppClient({
    appId: "list-manager",
    client,
  });
  const lm = await ListManager.connect({ app, identity });

  const list = await lm.createList("Groceries");
  assertEquals(list.items.length, 0);

  await lm.addItem(list.id, "Milk");
  await lm.addItem(list.id, "Bread");
  const updated = await lm.addItem(list.id, "Eggs");
  assertEquals(updated.items.length, 3);

  const toggled = await lm.toggleItem(list.id, updated.items[0].id);
  assertEquals(toggled.items[0].done, true);

  const mine = await lm.listLists();
  assertEquals(mine.length, 1);
  assertEquals(mine[0].items.length, 3);

  // The log should have one entry per mutation (create + 3 adds + 1 toggle).
  const log = await lm.session.app.listLog(`user/${identity.pubkeyHex}/${list.id}`);
  assertEquals(log.length, 5);
});

Deno.test("blog: publish updates latest, preserves history via hash chain", async () => {
  const { client } = buildRig();
  const identity = await generateIdentity();
  const blog = await Blog.connect({
    app: new AppClient({ appId: "blog", client }),
    identity,
  });

  await blog.publish({ slug: "hello", title: "Hello", body: "v1", tags: [] });
  await blog.publish({ slug: "hello", title: "Hello", body: "v2", tags: [] });
  const { hashUri } = await blog.publish({
    slug: "hello",
    title: "Hello v3",
    body: "v3",
    tags: ["release"],
  });

  const latest = await blog.getLatest("hello");
  assertEquals(latest?.body, "v3");
  assertEquals(latest?.title, "Hello v3");

  const history = await blog.history("hello");
  assertEquals(history.map((p) => p.body), ["v3", "v2", "v1"]);

  // The index must list exactly one entry (same slug — index overwrites).
  const posts = await blog.listPosts();
  assertEquals(posts.length, 1);
  assertEquals(posts[0].latestHash, hashUri);
});

Deno.test("chat: multi-user room with append-only log", async () => {
  const { client } = buildRig();
  const appShared = new AppClient({ appId: "chat", client });

  const alice = await Chat.connect({ app: appShared, identity: await generateIdentity() });
  const bob = await Chat.connect({ app: appShared, identity: await generateIdentity() });

  const room = await alice.createRoom("General");
  assert(room.id);

  await alice.postMessage(room.id, "hi bob");
  await new Promise((r) => setTimeout(r, 2)); // ensure monotonic `at`
  await bob.postMessage(room.id, "hi alice");
  await new Promise((r) => setTimeout(r, 2));
  await alice.postMessage(room.id, "how are you?");

  const history = await alice.history(room.id);
  assertEquals(history.length, 3);
  assertEquals(
    history.map((m) => m.author),
    [alice.session.pubkey, bob.session.pubkey, alice.session.pubkey],
  );

  const rooms = await bob.listRooms();
  assertEquals(rooms.length, 1);
  assertEquals(rooms[0].name, "General");
});

Deno.test("apps coexist: all three running against the same rig", async () => {
  const { client } = buildRig();
  const alice = await generateIdentity();

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

  await lm.createList("Todo");
  await blog.publish({ slug: "welcome", title: "Hi", body: "…", tags: [] });
  const room = await chat.createRoom("Main");
  await chat.postMessage(room.id, "first!");

  // Reads cross over without collision — distinct namespaces, same node.
  assertEquals((await lm.listLists()).length, 1);
  assertEquals((await blog.listPosts()).length, 1);
  assertEquals((await chat.listRooms()).length, 1);
});

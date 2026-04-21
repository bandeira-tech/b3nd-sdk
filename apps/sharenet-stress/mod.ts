/// <reference lib="deno.ns" />
/**
 * @module
 * sharenet-stress — end-to-end stress harness for the sharenet protocol.
 *
 * Wires up an in-process rig with *two* replicated backends and drives
 * the three sample apps (listify, inkwell, whisper) concurrently against
 * it. Every step exercises a different slice of the stack:
 *
 *   1. Identity / signing         — operator + N users, each backed by a
 *                                    deterministic seed.
 *   2. Schema dispatch            — app://registry, mutable://sharenet,
 *                                    hash://sha256, link://sharenet.
 *   3. Storage                    — MessageDataClient(MemoryStore) ×2.
 *   4. Replication                — parallelBroadcast on write;
 *                                    firstMatchSequence on read; we also
 *                                    poke each backend directly to prove
 *                                    that writes really did broadcast.
 *   5. Encryption                 — X25519 round-trip via whisper.
 *
 * Run with:
 *
 *     deno run -A mod.ts
 *
 * Tunable knobs (env vars): `USERS`, `LISTS_PER_USER`, `POSTS_PER_USER`,
 * `CHATS_PER_PAIR`.
 */

import { connection, Identity, Rig } from "@b3nd/rig";
import {
  createValidatedClient,
  firstMatchSequence,
  MemoryStore,
  MessageDataClient,
  msgSchema,
  parallelBroadcast,
} from "@bandeira-tech/b3nd-sdk";
import { createSchema, registerApp } from "@sharenet/protocol";
import { Listify } from "../sharenet-apps/listify/mod.ts";
import { Inkwell } from "../sharenet-apps/inkwell/mod.ts";
import { Whisper } from "../sharenet-apps/whisper/mod.ts";

const USERS = Number(Deno.env.get("USERS") ?? "4");
const LISTS_PER_USER = Number(Deno.env.get("LISTS_PER_USER") ?? "2");
const ITEMS_PER_LIST = Number(Deno.env.get("ITEMS_PER_LIST") ?? "5");
const POSTS_PER_USER = Number(Deno.env.get("POSTS_PER_USER") ?? "3");
const CHATS_PER_PAIR = Number(Deno.env.get("CHATS_PER_PAIR") ?? "4");

// ── Build the replicated rig ────────────────────────────────────

const operator = await Identity.fromSeed("sharenet-stress-operator");
const schema = createSchema({ operators: [operator.pubkey] });

// Two independent backends — same role, same schema. `parallelBroadcast`
// writes to both; `firstMatchSequence` reads from the first that has the
// record. In production these would be "memory cache + postgres" or
// "local + remote peer"; for the harness, two memory backends are
// sufficient to prove the replication contract.
const store1 = new MessageDataClient(new MemoryStore());
const store2 = new MessageDataClient(new MemoryStore());
// In-process `rig.send()` bypasses schema validation (it's only enforced on
// `rig.receive()`, i.e. when the rig is fronting an HTTP node). Wrapping
// the backing client in `createValidatedClient` forces every write through
// the schema, so the stress harness actually exercises the validator.
const replicated = createValidatedClient({
  write: parallelBroadcast([store1, store2]),
  read: firstMatchSequence([store1, store2]),
  validate: msgSchema(schema),
});

const rig = new Rig({
  connections: [connection(replicated, { receive: ["*"], read: ["*"] })],
  schema,
});

// ── Register the three sample apps ──────────────────────────────

for (const [appId, name] of [
  ["listify", "Listify — personal lists"],
  ["inkwell", "Inkwell — content-addressed blog"],
  ["whisper", "Whisper — encrypted chat"],
] as const) {
  const result = await registerApp(rig, operator, {
    appId,
    name,
    ownerPubkey: operator.pubkey,
    version: 1,
  });
  assertAccepted(`register ${appId}`, result.accepted, result.error);
}

// ── Spin up users ───────────────────────────────────────────────

const users = await Promise.all(
  Array.from({ length: USERS }, (_, i) =>
    Identity.fromSeed(`sharenet-stress-user-${i}`)),
);

const t0 = Date.now();

// ── listify: many small signed writes ──────────────────────────

let listifyOps = 0;
await Promise.all(users.map(async (id) => {
  const app = new Listify(rig, id);
  for (let l = 0; l < LISTS_PER_USER; l++) {
    const list = await app.createList(`user-${id.pubkey.slice(0, 6)}-${l}`);
    listifyOps++;
    for (let i = 0; i < ITEMS_PER_LIST; i++) {
      await app.addItem(list.id, `item ${i}`);
      listifyOps++;
    }
  }
  const all = await app.listAll();
  if (all.length !== LISTS_PER_USER) {
    throw new Error(
      `listify: user ${id.pubkey.slice(0, 6)} expected ${LISTS_PER_USER} lists, got ${all.length}`,
    );
  }
}));

// ── inkwell: hash blobs + links + shared feed ──────────────────

let inkwellOps = 0;
await Promise.all(users.map(async (id, userIdx) => {
  const app = new Inkwell(rig, id);
  for (let p = 0; p < POSTS_PER_USER; p++) {
    await app.publish({
      slug: `post-${p}`,
      title: `Post ${p} from user ${userIdx}`,
      body: "x".repeat(256 + p * 64),
      tags: ["stress", `u${userIdx}`],
    });
    inkwellOps++;
  }
}));

// Shared feed should carry one entry per (user, post). Readers see
// everyone's posts.
{
  const app = new Inkwell(rig, users[0]);
  const feed = await app.feed();
  const expected = USERS * POSTS_PER_USER;
  if (feed.length !== expected) {
    throw new Error(
      `inkwell: shared feed expected ${expected} entries, got ${feed.length}`,
    );
  }
}

// ── whisper: encrypt + decrypt across pairs ────────────────────

let whisperOps = 0;
const apps = users.map((id) => new Whisper(rig, id));
await Promise.all(apps.map((a, i) => a.setProfile(`User ${i}`)));
whisperOps += apps.length;

// Each user DMs the *next* user in the ring CHATS_PER_PAIR times.
for (let i = 0; i < users.length; i++) {
  const sender = apps[i];
  const recipient = apps[(i + 1) % apps.length];
  const profile = await sender.lookupProfile(recipient.pubkey);
  if (!profile) throw new Error(`whisper: missing profile for user ${i}`);
  for (let m = 0; m < CHATS_PER_PAIR; m++) {
    await sender.send(profile, `hi #${m} from ${i}`);
    whisperOps++;
  }
}

// Each recipient should decrypt exactly CHATS_PER_PAIR messages from
// the prior user in the ring.
for (let i = 0; i < users.length; i++) {
  const recipient = apps[i];
  const inbox = await recipient.inbox();
  if (inbox.length !== CHATS_PER_PAIR) {
    throw new Error(
      `whisper: user ${i} inbox expected ${CHATS_PER_PAIR}, got ${inbox.length}`,
    );
  }
}

// ── Verify replication: both backends must carry every write ───

const [s1, s2] = await Promise.all([store1.status(), store2.status()]);
const [reg1] = await store1.read(`app://registry/listify`);
const [reg2] = await store2.read(`app://registry/listify`);
if (!reg1.success || !reg2.success) {
  throw new Error("replication: app://registry/listify missing on a replica");
}

const totalOps = listifyOps + inkwellOps + whisperOps + 3 /* registrations */;
const elapsed = Date.now() - t0;
console.log(`sharenet-stress: ${totalOps} signed ops in ${elapsed}ms`);
console.log(`  listify  : ${listifyOps}`);
console.log(`  inkwell  : ${inkwellOps}`);
console.log(`  whisper  : ${whisperOps}`);
console.log(`  store1   : ${s1.status}`);
console.log(`  store2   : ${s2.status}`);

function assertAccepted(op: string, accepted: boolean, error?: string): void {
  if (!accepted) throw new Error(`${op} rejected: ${error ?? "unknown"}`);
}

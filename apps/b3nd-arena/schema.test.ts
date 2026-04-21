import { assertEquals } from "@std/assert";
import { MemoryStore, MessageDataClient } from "@bandeira-tech/b3nd-sdk";
import schema, { LIMITS } from "./schema.ts";

// ── Minimal validator runner ─────────────────────────────────────────

const run = (
  key: keyof typeof schema,
  uri: string,
  data: unknown,
) => schema[key]([uri, {}, data], undefined, async () => ({ success: false }));

// ── room://arena ─────────────────────────────────────────────────────

Deno.test("room: accepts a well-formed config", async () => {
  const r = await run(
    "room://arena",
    "room://arena/alpha/config",
    { name: "Alpha", mode: "ffa", maxPlayers: 16, createdAt: 1, createdBy: "k" },
  );
  assertEquals(r.valid, true);
});

Deno.test("room: rejects bad mode", async () => {
  const r = await run(
    "room://arena",
    "room://arena/alpha/config",
    { name: "Alpha", mode: "battle-royale", maxPlayers: 16, createdAt: 1, createdBy: "k" },
  );
  assertEquals(r.valid, false);
});

Deno.test("room: rejects overlong name", async () => {
  const r = await run(
    "room://arena",
    "room://arena/alpha/config",
    {
      name: "x".repeat(LIMITS.roomNameMax + 1),
      mode: "ffa",
      maxPlayers: 16,
      createdAt: 1,
      createdBy: "k",
    },
  );
  assertEquals(r.valid, false);
});

Deno.test("room: rejects maxPlayers over hard cap", async () => {
  const r = await run(
    "room://arena",
    "room://arena/alpha/config",
    {
      name: "A",
      mode: "ffa",
      maxPlayers: LIMITS.maxPlayersHardCap + 1,
      createdAt: 1,
      createdBy: "k",
    },
  );
  assertEquals(r.valid, false);
});

Deno.test("room: rejects wrong URI tail", async () => {
  const r = await run(
    "room://arena",
    "room://arena/alpha/settings",
    { name: "A", mode: "ffa", maxPlayers: 4, createdAt: 1, createdBy: "k" },
  );
  assertEquals(r.valid, false);
});

// ── player://arena ───────────────────────────────────────────────────

Deno.test("player: accepts a well-formed player", async () => {
  const r = await run(
    "player://arena",
    "player://arena/alpha/abc123",
    { name: "Ace", color: "#ff0055", status: "alive", joinedAt: 1 },
  );
  assertEquals(r.valid, true);
});

Deno.test("player: rejects bad color", async () => {
  const r = await run(
    "player://arena",
    "player://arena/alpha/abc123",
    { name: "Ace", color: "red", status: "alive", joinedAt: 1 },
  );
  assertEquals(r.valid, false);
});

Deno.test("player: rejects extra path segment", async () => {
  const r = await run(
    "player://arena",
    "player://arena/alpha/abc123/extra",
    { name: "Ace", color: "#ff0055", status: "alive", joinedAt: 1 },
  );
  assertEquals(r.valid, false);
});

// ── tick://arena (hot path) ──────────────────────────────────────────

Deno.test("tick: accepts a minimal position frame", async () => {
  const r = await run(
    "tick://arena",
    "tick://arena/alpha/abc123/17",
    { t: 1, p: [0, 0, 0], r: [0, 0], hp: 100 },
  );
  assertEquals(r.valid, true);
});

Deno.test("tick: rejects out-of-bounds position", async () => {
  const r = await run(
    "tick://arena",
    "tick://arena/alpha/abc123/17",
    { t: 1, p: [LIMITS.worldHalfExtent + 1, 0, 0], r: [0, 0], hp: 100 },
  );
  assertEquals(r.valid, false);
});

Deno.test("tick: rejects bloated payload", async () => {
  const r = await run(
    "tick://arena",
    "tick://arena/alpha/abc123/17",
    { t: 1, p: [0, 0, 0], r: [0, 0], hp: 100, pad: "x".repeat(LIMITS.tickDataMaxBytes) },
  );
  assertEquals(r.valid, false);
});

Deno.test("tick: rejects missing seq", async () => {
  const r = await run(
    "tick://arena",
    "tick://arena/alpha/abc123",
    { t: 1, p: [0, 0, 0], r: [0, 0], hp: 100 },
  );
  assertEquals(r.valid, false);
});

// ── shot://arena (hot path) ──────────────────────────────────────────

Deno.test("shot: accepts a unit-length direction", async () => {
  const r = await run(
    "shot://arena",
    "shot://arena/alpha/abc123/s1",
    { t: 1, o: [0, 0, 0], d: [1, 0, 0], w: "pistol", dmg: 10 },
  );
  assertEquals(r.valid, true);
});

Deno.test("shot: rejects non-unit direction", async () => {
  const r = await run(
    "shot://arena",
    "shot://arena/alpha/abc123/s1",
    { t: 1, o: [0, 0, 0], d: [3, 0, 0], w: "pistol", dmg: 10 },
  );
  assertEquals(r.valid, false);
});

Deno.test("shot: rejects absurd damage", async () => {
  const r = await run(
    "shot://arena",
    "shot://arena/alpha/abc123/s1",
    { t: 1, o: [0, 0, 0], d: [1, 0, 0], w: "pistol", dmg: 10_000 },
  );
  assertEquals(r.valid, false);
});

// ── chat://arena ─────────────────────────────────────────────────────

Deno.test("chat: accepts a normal message", async () => {
  const r = await run(
    "chat://arena",
    "chat://arena/alpha/m1",
    { t: 1, from: "abc", text: "hello" },
  );
  assertEquals(r.valid, true);
});

Deno.test("chat: rejects overlong text", async () => {
  const r = await run(
    "chat://arena",
    "chat://arena/alpha/m1",
    { t: 1, from: "abc", text: "x".repeat(LIMITS.chatTextMax + 1) },
  );
  assertEquals(r.valid, false);
});

// ── score://arena ────────────────────────────────────────────────────

Deno.test("score: rejects negative counter", async () => {
  const r = await run(
    "score://arena",
    "score://arena/alpha/abc",
    { kills: -1, deaths: 0, points: 0 },
  );
  assertEquals(r.valid, false);
});

// ── End-to-end: use the schema with a real MessageDataClient ────────

Deno.test("e2e: MessageDataClient round-trip through schema", async () => {
  const client = new MessageDataClient(new MemoryStore());

  // Create a room + join, then pump a position frame and a shot.
  const res1 = await client.receive([[
    "room://arena/alpha/config",
    {},
    { name: "Alpha", mode: "ffa", maxPlayers: 16, createdAt: 1, createdBy: "k" },
  ]]);
  assertEquals(res1[0].accepted, true);

  const res2 = await client.receive([[
    "tick://arena/alpha/abc/1",
    {},
    { t: 2, p: [10, 0, 5], r: [0.1, 0], hp: 100 },
  ]]);
  assertEquals(res2[0].accepted, true);

  // Read back.
  const ticks = await client.read("tick://arena/alpha/abc/1");
  assertEquals(ticks[0].success, true);
  assertEquals((ticks[0].record?.data as { hp: number }).hp, 100);
});

/**
 * @module
 * B3nd Arena — gaming protocol schema for a high-frequency multiplayer
 * backend running on a private b3nd network.
 *
 * Seven programs cover the surface area of a real-time arena shooter:
 *
 *   room://arena     — Room metadata (mode, name, capacity)
 *   player://arena   — Player presence inside a room (name, color, team)
 *   tick://arena     — Position & rotation snapshots (HOT PATH, ~20Hz/player)
 *   shot://arena     — Projectile events (HOT PATH, fire-and-forget)
 *   chat://arena     — Chat messages (rate limited by schema length)
 *   score://arena    — Scoreboard per player
 *   kill://arena     — Append-only kill log
 *
 * Hot-path programs (tick, shot) use O(1) shape validators — no cross-program
 * reads, no signature verification. This is intentional: on a private LAN
 * the cost-per-message is what decides the tick rate a node can sustain.
 *
 * URI layout keeps the owner pubkey in the path so access control is a
 * string comparison. On a private network the signature check is optional;
 * a public deployment can layer `authValidation()` on top of the same paths.
 */

import type { Output, Schema, Validator } from "@bandeira-tech/b3nd-sdk/types";

// ── Limits ───────────────────────────────────────────────────────────

const LIMITS = {
  roomNameMax: 40,
  playerNameMax: 24,
  chatTextMax: 240,
  maxPlayersHardCap: 64,
  tickDataMaxBytes: 160,
  shotDataMaxBytes: 160,
  // World half-extent — clients can cull but server sanity-checks too.
  worldHalfExtent: 10_000,
};

// ── Helpers ──────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));

const isVec2 = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n));

const inBounds = (xyz: [number, number, number]) =>
  xyz.every((n) => Math.abs(n) <= LIMITS.worldHalfExtent);

const byteSize = (v: unknown) => JSON.stringify(v).length;

// Extract a path segment (0-indexed after the program prefix).
// e.g. uri "tick://arena/room42/abcd/17" → parts = ["room42", "abcd", "17"]
const parts = (uri: string): string[] => {
  const hashIdx = uri.indexOf("://");
  if (hashIdx < 0) return [];
  return uri.slice(hashIdx + 3).split("/").slice(1);
};

// Ok / fail convenience to cut boilerplate.
const ok = async () => ({ valid: true as const });
const fail = async (error: string) => ({ valid: false as const, error });

// ── Program validators ───────────────────────────────────────────────

/**
 * room://arena/{roomId}/config
 *
 * { name: string, mode: "ffa"|"team"|"coop", maxPlayers: number,
 *   createdAt: number, createdBy: string }
 */
const roomProgram: Validator = async ([uri, , data]) => {
  if (!isObject(data)) return fail("Room data must be an object");
  const { name, mode, maxPlayers } = data;
  if (typeof name !== "string" || name.length === 0) {
    return fail("Room name required");
  }
  if (name.length > LIMITS.roomNameMax) {
    return fail(`Room name too long (max ${LIMITS.roomNameMax})`);
  }
  if (mode !== "ffa" && mode !== "team" && mode !== "coop") {
    return fail("Room mode must be one of ffa|team|coop");
  }
  if (
    typeof maxPlayers !== "number" ||
    !Number.isInteger(maxPlayers) ||
    maxPlayers < 2 ||
    maxPlayers > LIMITS.maxPlayersHardCap
  ) {
    return fail(`Room maxPlayers must be 2..${LIMITS.maxPlayersHardCap}`);
  }
  // Require the roomId path segment to exist.
  const [roomId, tail] = parts(uri);
  if (!roomId || tail !== "config") {
    return fail("Room URI must be room://arena/{roomId}/config");
  }
  return ok();
};

/**
 * player://arena/{roomId}/{pubkey}
 *
 * { name: string, color: string, team?: number, status: "alive"|"dead",
 *   joinedAt: number }
 */
const playerProgram: Validator = async ([uri, , data]) => {
  if (!isObject(data)) return fail("Player data must be an object");
  const { name, color, status } = data;
  if (typeof name !== "string" || name.length === 0) {
    return fail("Player name required");
  }
  if (name.length > LIMITS.playerNameMax) {
    return fail(`Player name too long (max ${LIMITS.playerNameMax})`);
  }
  if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return fail("Player color must be a #RRGGBB string");
  }
  if (status !== "alive" && status !== "dead" && status !== "spectator") {
    return fail("Player status must be alive|dead|spectator");
  }
  const [roomId, pubkey, extra] = parts(uri);
  if (!roomId || !pubkey || extra !== undefined) {
    return fail("Player URI must be player://arena/{roomId}/{pubkey}");
  }
  return ok();
};

/**
 * tick://arena/{roomId}/{pubkey}/{seq}   — HOT PATH
 *
 * { t: number (ms), p: [x,y,z], r: [yaw, pitch], hp: number, st?: number }
 *
 * Validator is O(1) and does no cross-program reads. The URI carries
 * enough information to route/filter; the seq lets clients order frames
 * and detect drops without the server having to track anything.
 */
const tickProgram: Validator = async ([uri, , data]) => {
  if (!isObject(data)) return fail("Tick data must be an object");
  if (byteSize(data) > LIMITS.tickDataMaxBytes) return fail("Tick too large");
  const { t, p, r, hp } = data;
  if (typeof t !== "number" || !Number.isFinite(t)) return fail("Tick t invalid");
  if (!isVec3(p) || !inBounds(p)) return fail("Tick p out of bounds");
  if (!isVec2(r)) return fail("Tick r invalid");
  if (typeof hp !== "number" || hp < 0 || hp > 1000) return fail("Tick hp invalid");
  const [roomId, pubkey, seq] = parts(uri);
  if (!roomId || !pubkey || !seq) {
    return fail("Tick URI must be tick://arena/{roomId}/{pubkey}/{seq}");
  }
  return ok();
};

/**
 * shot://arena/{roomId}/{pubkey}/{shotId}   — HOT PATH
 *
 * { t: number, o: [x,y,z], d: [dx,dy,dz], w: string, dmg: number }
 *
 * `d` is expected to be roughly unit length; we check 0.9..1.1 to allow
 * for client-side quantization without requiring a square root.
 */
const shotProgram: Validator = async ([uri, , data]) => {
  if (!isObject(data)) return fail("Shot data must be an object");
  if (byteSize(data) > LIMITS.shotDataMaxBytes) return fail("Shot too large");
  const { t, o, d, w, dmg } = data;
  if (typeof t !== "number" || !Number.isFinite(t)) return fail("Shot t invalid");
  if (!isVec3(o) || !inBounds(o)) return fail("Shot origin out of bounds");
  if (!isVec3(d)) return fail("Shot direction invalid");
  const mag2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (mag2 < 0.81 || mag2 > 1.21) return fail("Shot direction not unit-ish");
  if (typeof w !== "string" || w.length > 16) return fail("Shot weapon invalid");
  if (typeof dmg !== "number" || dmg < 0 || dmg > 1_000) {
    return fail("Shot dmg invalid");
  }
  const [roomId, pubkey, shotId] = parts(uri);
  if (!roomId || !pubkey || !shotId) {
    return fail("Shot URI must be shot://arena/{roomId}/{pubkey}/{shotId}");
  }
  return ok();
};

/**
 * chat://arena/{roomId}/{msgId}
 *
 * { t: number, from: string, text: string }
 */
const chatProgram: Validator = async ([uri, , data]) => {
  if (!isObject(data)) return fail("Chat data must be an object");
  const { t, from, text } = data;
  if (typeof t !== "number") return fail("Chat t invalid");
  if (typeof from !== "string" || from.length === 0) return fail("Chat from invalid");
  if (typeof text !== "string" || text.length === 0) return fail("Chat text invalid");
  if (text.length > LIMITS.chatTextMax) {
    return fail(`Chat text too long (max ${LIMITS.chatTextMax})`);
  }
  const [roomId, msgId] = parts(uri);
  if (!roomId || !msgId) {
    return fail("Chat URI must be chat://arena/{roomId}/{msgId}");
  }
  return ok();
};

/**
 * score://arena/{roomId}/{pubkey}
 *
 * { kills: number, deaths: number, points: number }
 */
const scoreProgram: Validator = async ([uri, , data]) => {
  if (!isObject(data)) return fail("Score data must be an object");
  const { kills, deaths, points } = data;
  for (const [name, v] of [["kills", kills], ["deaths", deaths], ["points", points]] as const) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      return fail(`Score ${name} must be a non-negative integer`);
    }
  }
  const [roomId, pubkey, extra] = parts(uri);
  if (!roomId || !pubkey || extra !== undefined) {
    return fail("Score URI must be score://arena/{roomId}/{pubkey}");
  }
  return ok();
};

/**
 * kill://arena/{roomId}/{killId}
 *
 * { t: number, killer: string, victim: string, weapon: string }
 *
 * Append-only — we don't forbid rewriting at the protocol level
 * (on a private network the operator picks a Store that enforces
 * write-once if desired), but clients treat it as immutable.
 */
const killProgram: Validator = async ([uri, , data]) => {
  if (!isObject(data)) return fail("Kill data must be an object");
  const { t, killer, victim, weapon } = data;
  if (typeof t !== "number") return fail("Kill t invalid");
  if (typeof killer !== "string" || killer.length === 0) return fail("Kill killer invalid");
  if (typeof victim !== "string" || victim.length === 0) return fail("Kill victim invalid");
  if (typeof weapon !== "string" || weapon.length > 16) return fail("Kill weapon invalid");
  const [roomId, killId] = parts(uri);
  if (!roomId || !killId) {
    return fail("Kill URI must be kill://arena/{roomId}/{killId}");
  }
  return ok();
};

// ── Schema export ────────────────────────────────────────────────────

export const schema = {
  "room://arena": roomProgram,
  "player://arena": playerProgram,
  "tick://arena": tickProgram,
  "shot://arena": shotProgram,
  "chat://arena": chatProgram,
  "score://arena": scoreProgram,
  "kill://arena": killProgram,
} satisfies Schema;

export default schema;

export { LIMITS };

/** Typed output shapes — consumers can import these to build messages. */
export type RoomConfig = {
  name: string;
  mode: "ffa" | "team" | "coop";
  maxPlayers: number;
  createdAt: number;
  createdBy: string;
};

export type PlayerPresence = {
  name: string;
  color: string;
  team?: number;
  status: "alive" | "dead" | "spectator";
  joinedAt: number;
};

export type Tick = {
  t: number;
  p: [number, number, number];
  r: [number, number];
  hp: number;
  st?: number;
};

export type Shot = {
  t: number;
  o: [number, number, number];
  d: [number, number, number];
  w: string;
  dmg: number;
};

export type ChatMsg = { t: number; from: string; text: string };
export type Score = { kills: number; deaths: number; points: number };
export type Kill = { t: number; killer: string; victim: string; weapon: string };

// Re-export Output for external validator consumers.
export type { Output };

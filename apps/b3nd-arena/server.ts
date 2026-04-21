/// <reference lib="deno.ns" />
/**
 * @module
 * B3nd Arena — private-network node + static game server.
 *
 * Wraps the arena schema in a Rig backed by an in-memory Store, exposes it
 * over the standard b3nd HTTP API under `/api/*`, and serves the browser
 * game client from `./static/`. Designed to be run on a LAN — one instance
 * per arena, clients point straight at it.
 *
 *   PORT=9942 deno run -A apps/b3nd-arena/server.ts
 *
 * For a postgres-backed persistent arena swap the MemoryStore for a
 * PostgresStore or compose multiple backends with parallelBroadcast /
 * firstMatchSequence — the schema stays the same.
 */

import { connection, httpApi, Rig } from "@b3nd/rig";
import { MemoryStore, MessageDataClient } from "@bandeira-tech/b3nd-sdk";
import schema from "./schema.ts";

// ── Config ───────────────────────────────────────────────────────────

const PORT = Number(Deno.env.get("PORT") ?? 9942);
const HOST = Deno.env.get("HOST") ?? "0.0.0.0";
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN") ?? "*";

const here = new URL(".", import.meta.url).pathname;
const staticDir = `${here}static`;

// ── Rig ──────────────────────────────────────────────────────────────

const client = new MessageDataClient(new MemoryStore());

const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  schema,
  on: {
    "receive:error": [(e) => {
      // Drop noisy hot-path rejections to stderr so the live server stays quiet
      // when clients fat-finger a payload.
      console.warn(`[arena] receive rejected ${e.uri ?? "?"}: ${e.error}`);
    }],
  },
});

const b3ndHandler = httpApi(rig, {
  statusMeta: { protocol: "b3nd-arena", version: "0.1.0" },
});

// ── Static server ────────────────────────────────────────────────────

const mimes: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
};

async function serveStatic(path: string): Promise<Response | null> {
  const rel = path === "/" ? "/index.html" : path;
  // Reject traversal — we only serve files under staticDir.
  if (rel.includes("..")) return new Response("Forbidden", { status: 403 });
  const file = `${staticDir}${rel}`;
  try {
    const data = await Deno.readFile(file);
    const ext = rel.split(".").pop() ?? "";
    return new Response(data, {
      headers: {
        "Content-Type": mimes[ext] ?? "application/octet-stream",
        // Dev-friendly: no cache so reloads always see new game code.
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return null;
  }
}

// ── CORS wrapper ─────────────────────────────────────────────────────

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", CORS_ORIGIN);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
  return new Response(res.body, { status: res.status, headers });
}

// ── Request dispatch ─────────────────────────────────────────────────

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

  const url = new URL(req.url);

  if (url.pathname.startsWith("/api/")) {
    return withCors(await b3ndHandler(req));
  }

  const file = await serveStatic(url.pathname);
  if (file) return withCors(file);

  return withCors(new Response("Not found", { status: 404 }));
}

// ── Boot ─────────────────────────────────────────────────────────────

Deno.serve({ port: PORT, hostname: HOST }, handle);

console.log(`B3nd Arena ready — http://${HOST}:${PORT}`);
console.log(`  protocol: ${Object.keys(schema).join(", ")}`);
console.log(`  open the game at http://localhost:${PORT}/`);

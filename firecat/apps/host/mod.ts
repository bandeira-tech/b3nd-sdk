/// <reference lib="deno.ns" />
import { connection, createClientFromUrl, Rig } from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHandler } from "./src/handler.ts";
import type { HostConfig } from "./src/types.ts";

// ── Configuration ────────────────────────────────────────────────────

const BACKEND_URL = Deno.env.get("BACKEND_URL");
if (!BACKEND_URL) throw new Error("BACKEND_URL env var is required");

const PORT = Number(Deno.env.get("PORT") || "8080");
const TARGET = Deno.env.get("TARGET");
const PRIMARY_DOMAIN = Deno.env.get("PRIMARY_DOMAIN");

const config: HostConfig = {
  backendUrl: BACKEND_URL,
  port: PORT,
  target: TARGET,
  primaryDomain: PRIMARY_DOMAIN,
};

// ── Rig & Server ─────────────────────────────────────────────────────

const backendClient = await createClientFromUrl(BACKEND_URL);
const rig = new Rig({
  connections: [connection(backendClient, { receive: ["*"], read: ["*"] })],
});
rig.on("read:error", (e) => {
  console.error(`[rig] read failed: ${e.uri ?? "unknown"} — ${e.error}`);
});
// Pass rig directly — it satisfies NodeProtocolReadInterface
const handler = createHandler(rig, config);

const app = new Hono();
app.use("*", cors());
app.all("*", (c) => handler(c.req.raw));

Deno.serve({ port: PORT }, app.fetch);
console.log(`firecat-host listening on :${PORT} → ${BACKEND_URL}`);

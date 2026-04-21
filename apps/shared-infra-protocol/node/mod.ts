/// <reference lib="deno.ns" />
/**
 * @module
 * shared-infra node bootstrap.
 *
 * Boots a b3nd node preloaded with the shared-infra schema. Meant to be the
 * daemon operators run on the "shared infra" machines that host every app.
 *
 * Usage:
 *
 *   # single memory-backed node
 *   PORT=9942 deno run -A node/mod.ts
 *
 *   # multi-backend, replicating through two peers
 *   PORT=9942 BACKENDS=memory://,fs:///tmp/b3nd-shared \
 *   PEERS=http://node-b:9942,http://node-c:9942 \
 *   deno run -A node/mod.ts
 *
 * The node answers on `/api/v1/{status,receive,read,observe}` — the same
 * HTTP surface the b3nd SDK's `HttpClient` uses. All shared-infra apps
 * (list-manager, blog, chat) talk to it via that SDK.
 */

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";

import {
  connection,
  createClientFromUrl,
  httpApi,
  Rig,
} from "../../../libs/b3nd-rig/mod.ts";
import {
  firstMatchSequence,
  parallelBroadcast,
} from "../../../libs/b3nd-combinators/mod.ts";
import type { NodeProtocolInterface } from "../../../libs/b3nd-core/types.ts";
import { HttpClient } from "../../../libs/b3nd-client-http/mod.ts";
import { createSharedInfraSchema } from "../schema/mod.ts";

const env = (name: string, fallback?: string) =>
  Deno.env.get(name) ?? fallback;

const PORT = Number(env("PORT", "9942"));
const CORS_ORIGIN = env("CORS_ORIGIN", "*")!;
const BACKENDS = env("BACKENDS", "memory://")!;
const PEERS = env("PEERS", "")!;
const OPERATORS = env("OPERATOR_PUBKEYS", "")!;
const MAX_PAYLOAD = Number(env("MAX_PAYLOAD_BYTES", `${256 * 1024}`));
const REQUIRE_REG = env("REQUIRE_APP_REGISTRATION", "true") !== "false";
const NODE_LABEL = env("NODE_LABEL", `node-${PORT}`)!;

// ── Build clients from URLs ─────────────────────────────────────────

const backendSpecs = BACKENDS.split(",").map((s) => s.trim()).filter(Boolean);
const peerSpecs = PEERS.split(",").map((s) => s.trim()).filter(Boolean);

const backends = await Promise.all(
  backendSpecs.map((u) => createClientFromUrl(u)),
);

// Peer replication: remote b3nd nodes we broadcast writes to.
const peers = peerSpecs.map((url) => new HttpClient({ url }));

// ── Compose the merged client (local + peers) ──────────────────────

const writeClients = [...backends, ...peers];
const readClients = [...backends, ...peers];

const merged: NodeProtocolInterface =
  writeClients.length === 1 && readClients.length === 1
    ? backends[0]
    : {
      receive: (msg: Parameters<typeof backends[0]["receive"]>[0]) =>
        parallelBroadcast(writeClients).receive(msg),
      read: <T = unknown>(uris: string | string[]) =>
        firstMatchSequence(readClients).read<T>(uris),
      status: () => backends[0].status(),
    } as unknown as NodeProtocolInterface;

// ── Rig with schema and observation hooks ─────────────────────────

const schema = createSharedInfraSchema({
  operatorPubkeys: OPERATORS.split(",").map((s) => s.trim()).filter(Boolean),
  maxPayloadBytes: MAX_PAYLOAD,
  requireAppRegistration: REQUIRE_REG,
});

const counters = { accepted: 0, rejected: 0, reads: 0 };

const rig = new Rig({
  connections: [connection(merged, { receive: ["*"], read: ["*"] })],
  schema,
  on: {
    "receive:success": [() => {
      counters.accepted++;
    }],
    "receive:error": [
      (e) => {
        counters.rejected++;
        console.warn(
          `[${NODE_LABEL}] reject ${e.uri ?? "?"} — ${e.error}`,
        );
      },
    ],
    "read:success": [() => {
      counters.reads++;
    }],
  },
});

// ── HTTP wiring ─────────────────────────────────────────────────────

const b3ndHandler = httpApi(rig, {
  statusMeta: {
    node: NODE_LABEL,
    backends: backendSpecs,
    peers: peerSpecs,
    protocol: "shared-infra",
  },
});

const app = new Hono();
app.use("*", cors({ origin: CORS_ORIGIN }));
app.get("/", (c) =>
  c.json({
    node: NODE_LABEL,
    protocol: "shared-infra",
    backends: backendSpecs,
    peers: peerSpecs,
    counters,
  }));
app.all("/api/*", (c) => b3ndHandler(c.req.raw));

Deno.serve({ port: PORT }, app.fetch);

console.log(
  `[${NODE_LABEL}] shared-infra node up on :${PORT} ` +
    `(backends=${backendSpecs.join("+")} peers=${peerSpecs.length})`,
);

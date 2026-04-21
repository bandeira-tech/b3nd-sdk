/// <reference lib="deno.ns" />
/**
 * @module
 * sharenet-node — a reference operator node for the sharenet protocol.
 *
 * Launches a b3nd rig with the sharenet schema and whatever backends the
 * operator configured, then serves the HTTP api. Two backends are
 * recommended (memory for hot reads + durable storage for persistence) so
 * every write broadcasts to both and reads fall through in order — that's
 * how replication is stress-tested end to end.
 *
 * Env vars:
 *
 *   PORT=9942
 *   CORS_ORIGIN=*
 *   BACKEND_URL=memory://,sqlite:///data/sharenet.db
 *   OPERATORS=<hex-pubkey>,<hex-pubkey>
 *   MAX_MUTABLE_BYTES=65536   (optional)
 *   MAX_BLOB_BYTES=2097152    (optional)
 */

import {
  connection,
  createClientFromUrl,
  httpApi,
  Rig,
} from "@b3nd/rig";
import {
  createValidatedClient,
  firstMatchSequence,
  msgSchema,
  parallelBroadcast,
} from "@bandeira-tech/b3nd-sdk";
import { createSchema } from "@sharenet/protocol";

const PORT = Number(Deno.env.get("PORT") ?? "9942");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN") ?? "*";
const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "memory://";
const OPERATORS = (Deno.env.get("OPERATORS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (OPERATORS.length === 0) {
  console.warn(
    "[sharenet-node] OPERATORS env var is empty — no one can register apps.",
  );
}

const schema = createSchema({
  operators: OPERATORS,
  maxMutableBytes: Number(Deno.env.get("MAX_MUTABLE_BYTES") ?? "65536"),
  maxBlobBytes: Number(Deno.env.get("MAX_BLOB_BYTES") ?? "2097152"),
});

// Build backends from BACKEND_URL (comma-separated). Writes broadcast to
// all; reads try each in order. Swapping "memory://" for "memory://,pg://..."
// gives you replication with zero app-code changes.
const backends = await Promise.all(
  BACKEND_URL.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => createClientFromUrl(url)),
);

const client = backends.length === 1
  ? backends[0]
  : createValidatedClient({
    write: parallelBroadcast(backends),
    read: firstMatchSequence(backends),
    validate: msgSchema(schema),
  });

const rig = new Rig({
  connections: [connection(client, { receive: ["*"], read: ["*"] })],
  schema,
  on: {
    "receive:error": [(e) => {
      console.error(`[sharenet] receive failed: ${e.uri ?? "?"} — ${e.error}`);
    }],
    "read:error": [(e) => {
      console.error(`[sharenet] read failed: ${e.uri ?? "?"} — ${e.error}`);
    }],
  },
});

const handler = httpApi(rig, {
  statusMeta: {
    protocol: "sharenet",
    operators: OPERATORS.length,
    backends: BACKEND_URL.split(",").map((s) => s.split("://")[0]),
  },
});

const { Hono } = await import("npm:hono");
const { cors } = await import("npm:hono/cors");
const app = new Hono();
app.use("*", cors({ origin: CORS_ORIGIN }));
app.all("/api/*", (c: { req: { raw: Request } }) => handler(c.req.raw));

Deno.serve({ port: PORT }, app.fetch);
console.log(
  `[sharenet-node] listening on :${PORT} (backends=${BACKEND_URL}, operators=${OPERATORS.length})`,
);

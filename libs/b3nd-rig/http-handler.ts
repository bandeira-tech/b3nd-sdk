/**
 * @module
 * Thin HTTP adapter for the Rig.
 *
 * Translates HTTP requests to rig method calls. No framework dependency,
 * no middleware, no state — just a `(Request) => Promise<Response>` function.
 *
 * Routes:
 *   GET  /api/v1/health           → rig.health()
 *   GET  /api/v1/schema           → rig.getSchema()
 *   POST /api/v1/receive          → rig.receive([uri, data])
 *   GET  /api/v1/read/:uri        → rig.read(uri)
 *   GET  /api/v1/list/:uri        → rig.list(uri, options)
 *   DELETE /api/v1/delete/:uri    → rig.delete(uri)
 *   GET  /api/v1/subscribe/:uri   → SSE stream from rig events
 */

import { decodeBase64 } from "../b3nd-core/encoding.ts";
import type { Rig } from "./rig.ts";
import type { RigEvent } from "./events.ts";
import { matchPattern } from "./observe.ts";

// ── Types ──

export interface RigHandlerOptions {
  /** Extra metadata merged into health responses. */
  healthMeta?: Record<string, unknown>;
}

// ── Binary deserialization ──

/** Unwrap base64-encoded binary marker objects back to Uint8Array. */
function deserializeBinary(data: unknown): unknown {
  if (
    data &&
    typeof data === "object" &&
    (data as Record<string, unknown>).__b3nd_binary__ === true &&
    (data as Record<string, unknown>).encoding === "base64" &&
    typeof (data as Record<string, unknown>).data === "string"
  ) {
    return decodeBase64((data as Record<string, unknown>).data as string);
  }
  return data;
}

// ── URI helpers ──

/** Extract a b3nd URI from the request path after a prefix. */
function extractUri(path: string, prefix: string): string | null {
  // /api/v1/read/mutable/open/test → mutable://open/test
  const rest = path.slice(prefix.length);
  if (!rest) return null;
  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) {
    // protocol-only: /api/v1/list/mutable → mutable://
    return parts.length === 1 ? `${parts[0]}://` : null;
  }
  const protocol = parts[0];
  const domain = parts[1];
  const subpath = parts.slice(2).join("/");
  return subpath
    ? `${protocol}://${domain}/${subpath}`
    : `${protocol}://${domain}`;
}

/** Guess MIME type from URI file extension. */
function getMimeType(uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    woff2: "font/woff2",
    woff: "font/woff",
    ttf: "font/ttf",
    pdf: "application/pdf",
    wasm: "application/wasm",
    ico: "image/x-icon",
    txt: "text/plain",
    xml: "application/xml",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
  };
  return types[ext ?? ""] ?? "application/octet-stream";
}

// ── Responses ──

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Handler factory ──

/**
 * Create an HTTP request handler backed by a Rig.
 *
 * The handler is a standard `(Request) => Promise<Response>` — plug it
 * into Deno.serve, Hono, or any other HTTP framework.
 *
 * SSE subscriptions are powered by rig events — when `rig.receive()`
 * or `rig.send()` succeeds, SSE subscribers with matching prefixes
 * receive the event in real-time.
 *
 * @example
 * ```ts
 * import { Rig } from "@b3nd/rig";
 * import { createRigHandler } from "@b3nd/rig/http-handler";
 *
 * const rig = await Rig.init({ use: "memory://" });
 * const handler = createRigHandler(rig);
 * Deno.serve({ port: 3000 }, handler);
 * ```
 */
export function createRigHandler(
  rig: Rig,
  options?: RigHandlerOptions,
): (req: Request) => Promise<Response> {
  const healthMeta = options?.healthMeta;

  // ── SSE subscriber tracking ──
  // Each subscriber has a prefix and a write function.
  type SseSubscriber = {
    prefix: string;
    prefixSegments: string[];
    write: (text: string) => void;
    closed: boolean;
  };
  const subscribers = new Set<SseSubscriber>();

  // Wire rig events to SSE subscribers
  const pushToSubscribers = (e: RigEvent) => {
    if (!e.uri || subscribers.size === 0) return;
    const event = { uri: e.uri, data: e.data, ts: e.ts };
    const payload = `id: ${e.ts}\nevent: write\ndata: ${
      JSON.stringify(event)
    }\n\n`;
    for (const sub of subscribers) {
      if (sub.closed) continue;
      // Prefix match — subscriber's prefix must be a prefix of the URI
      if (e.uri.startsWith(sub.prefix) || sub.prefix === "*") {
        sub.write(payload);
      }
    }
  };
  rig.on("receive:success", pushToSubscribers);
  rig.on("send:success", pushToSubscribers);

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // ── Health ──
    if (method === "GET" && path === "/api/v1/health") {
      const res = await rig.health();
      const body = healthMeta ? { ...res, ...healthMeta } : res;
      return json(body, res.status === "healthy" ? 200 : 503);
    }

    // ── Schema ──
    if (method === "GET" && path === "/api/v1/schema") {
      const keys = await rig.getSchema();
      return json({ schema: keys });
    }

    // ── Receive ──
    if (method === "POST" && path === "/api/v1/receive") {
      let msg: unknown;
      try {
        msg = await req.json();
      } catch {
        return json(
          { accepted: false, error: "Invalid JSON body" },
          400,
        );
      }
      if (!Array.isArray(msg) || msg.length < 2) {
        return json(
          { accepted: false, error: "Expected [uri, data]" },
          400,
        );
      }
      const [uri, rawData] = msg;
      if (!uri || typeof uri !== "string") {
        return json(
          { accepted: false, error: "URI is required" },
          400,
        );
      }
      const data = deserializeBinary(rawData);
      const result = await rig.receive([uri, data]);
      return json(result, result.accepted ? 200 : 400);
    }

    // ── Read ──
    if (method === "GET" && path.startsWith("/api/v1/read/")) {
      const uri = extractUri(path, "/api/v1/read/");
      if (!uri) return json({ error: "Invalid URI" }, 400);
      const res = await rig.read(uri);
      if (!res.success || !res.record) {
        return json({ error: res.error || "Not found" }, 404);
      }
      // Binary data → raw bytes
      if (res.record.data instanceof Uint8Array) {
        return new Response(res.record.data as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": getMimeType(uri),
            "Content-Length": res.record.data.length.toString(),
          },
        });
      }
      return json(res.record);
    }

    // ── List ──
    if (method === "GET" && path.startsWith("/api/v1/list/")) {
      const uri = extractUri(path, "/api/v1/list/");
      if (!uri) return json({ error: "Invalid URI" }, 400);
      const opts = {
        page: url.searchParams.has("page")
          ? Number(url.searchParams.get("page"))
          : undefined,
        limit: url.searchParams.has("limit")
          ? Number(url.searchParams.get("limit"))
          : undefined,
        pattern: url.searchParams.get("pattern") || undefined,
        sortBy: url.searchParams.get("sortBy") as
          | "name"
          | "timestamp"
          | undefined,
        sortOrder: url.searchParams.get("sortOrder") as
          | "asc"
          | "desc"
          | undefined,
      };
      const res = await rig.list(uri, opts);
      return json(res);
    }

    // ── Delete ──
    if (method === "DELETE" && path.startsWith("/api/v1/delete/")) {
      const uri = extractUri(path, "/api/v1/delete/");
      if (!uri) return json({ error: "Invalid URI" }, 400);
      const res = await rig.delete(uri);
      return json(res, res.success ? 200 : 404);
    }

    // ── SSE Subscribe ──
    if (method === "GET" && path.startsWith("/api/v1/subscribe/")) {
      const uri = extractUri(path, "/api/v1/subscribe/");
      if (!uri) return json({ error: "Invalid URI" }, 400);

      const since = Number(url.searchParams.get("since") || "0");
      const lastEventId = req.headers.get("Last-Event-ID");
      const effectiveSince = lastEventId ? Number(lastEventId) : since;

      const sub: SseSubscriber = {
        prefix: uri,
        prefixSegments: uri.split("/"),
        write: () => {},
        closed: false,
      };

      const body = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          sub.write = (text: string) => {
            if (sub.closed) return;
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              sub.closed = true;
            }
          };
          subscribers.add(sub);

          // Send backlog (items since timestamp)
          (async () => {
            try {
              const listResult = await rig.list(uri);
              if (listResult.success) {
                for (const item of listResult.data) {
                  if (sub.closed) break;
                  const itemTs = (item as { ts?: number }).ts ?? 0;
                  if (itemTs <= effectiveSince) continue;
                  const readResult = await rig.read(item.uri);
                  if (readResult.success && readResult.record) {
                    const event = {
                      uri: item.uri,
                      data: readResult.record.data,
                      ts: readResult.record.ts,
                    };
                    sub.write(
                      `id: ${event.ts}\nevent: write\ndata: ${
                        JSON.stringify(event)
                      }\n\n`,
                    );
                  }
                }
              }
            } catch {
              // Backlog failed — continue with live events
            }
          })();

          // Keep-alive ping
          const keepAlive = setInterval(() => {
            sub.write(": keepalive\n\n");
          }, 30_000);

          // Cleanup on stream close
          sub.write = ((origWrite) => (text: string) => {
            origWrite(text);
          })(sub.write);

          // Store cleanup for cancel
          (controller as unknown as { _cleanup: () => void })._cleanup = () => {
            sub.closed = true;
            subscribers.delete(sub);
            clearInterval(keepAlive);
          };
        },
        cancel(controller) {
          (controller as unknown as { _cleanup?: () => void })._cleanup?.();
          sub.closed = true;
          subscribers.delete(sub);
        },
      });

      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ── Not found ──
    return new Response("Not Found", { status: 404 });
  };
}

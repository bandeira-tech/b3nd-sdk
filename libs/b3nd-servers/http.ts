import type { ServerFrontend } from "./node.ts";
import type {
  Message,
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  Schema,
} from "../b3nd-core/types.ts";
import type { Node } from "../b3nd-compose/types.ts";
import { decodeBase64 } from "../b3nd-core/encoding.ts";
import { SubscriptionBus } from "./subscription-bus.ts";

/**
 * Deserialize message data from JSON transport.
 * Unwraps base64-encoded binary marker objects back to Uint8Array.
 */
function deserializeMsgData(data: unknown): unknown {
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

/**
 * MIME type mapping from file extension
 */
const MIME_TYPES: Record<string, string> = {
  // Text
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  json: "application/json",
  xml: "application/xml",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  avif: "image/avif",
  // Fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  // Audio/Video
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
  // Other
  wasm: "application/wasm",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
};

/**
 * Get MIME type from URI based on file extension
 */
function getMimeTypeFromUri(uri: string): string {
  const path = uri.split("://").pop() || uri;
  const ext = path.split(".").pop()?.toLowerCase();
  return MIME_TYPES[ext || ""] || "application/octet-stream";
}

// Define a minimal interface that matches the subset of Hono we use.
// This removes the hard dependency on the 'hono' package from the SDK,
// while preserving the same usage pattern (httpServer(app)).
export interface MinimalRequest {
  param: (name: string) => string;
  query: (name: string) => string | undefined | null;
  header: (name: string) => string | undefined | null;
  url: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface MinimalContext {
  req: MinimalRequest;
  json: (body: unknown, status?: number) => Response;
}

export interface MinimalRouter {
  get: (
    path: string,
    handler: (c: MinimalContext) => Promise<Response> | Response,
  ) => void;
  post: (
    path: string,
    handler: (c: MinimalContext) => Promise<Response> | Response,
  ) => void;
  delete: (
    path: string,
    handler: (c: MinimalContext) => Promise<Response> | Response,
  ) => void;
  fetch: (req: Request) => Promise<Response> | Response;
}

type HttpServerOptions = {
  healthMeta?: Record<string, unknown>;
};

type HttpHandlerOptions = HttpServerOptions;

/** Return type for createHttpHandler — the handler + a way to push SSE events. */
export interface HttpHandlerResult {
  /** The request handler: `(req: Request) => Promise<Response>` */
  handler: (req: Request) => Promise<Response>;
  /**
   * Push a write event to SSE subscribers.
   *
   * Call this for writes that happen outside the HTTP endpoint
   * (e.g. rig.receive() calls) so SSE subscribers see them.
   */
  notifyWrite: (uri: string, data: unknown, ts: number) => void;
}

// ── Built-in minimal router (zero external dependencies) ──────────────

type RouteHandler = (c: MinimalContext) => Promise<Response> | Response;
type RouteEntry = { pattern: URLPattern; handler: RouteHandler };

/**
 * A tiny router that implements MinimalRouter using the standard URLPattern API.
 * No external dependencies — works in Deno, Cloudflare Workers, and modern Node.
 */
function createMinimalRouter(): MinimalRouter {
  const routes: { method: string; entry: RouteEntry }[] = [];
  const baseUrl = "http://localhost"; // only for pattern matching

  function register(method: string, path: string, handler: RouteHandler) {
    // Convert Express-style :param and * to URLPattern syntax
    const pathname = path.replace(/:(\w+)/g, ":$1").replace(
      /\*/g,
      ":__rest(.*)",
    );
    routes.push({
      method,
      entry: { pattern: new URLPattern({ pathname }), handler },
    });

    // If path ends with /*, also register without the wildcard so the base
    // path matches too (e.g. /api/v1/list/:protocol/:domain).
    if (path.endsWith("/*")) {
      const basePath = path.slice(0, -2).replace(/:(\w+)/g, ":$1");
      routes.push({
        method,
        entry: { pattern: new URLPattern({ pathname: basePath }), handler },
      });
    }
  }

  function matchRoute(
    method: string,
    url: string,
  ): { handler: RouteHandler; params: Record<string, string> } | null {
    for (const route of routes) {
      if (route.method !== method) continue;
      const result = route.entry.pattern.exec(url, baseUrl);
      if (result) {
        const params: Record<string, string> = {};
        const groups = result.pathname.groups;
        for (const [key, value] of Object.entries(groups)) {
          if (key === "__rest") {
            params["*"] = value ?? "";
          } else {
            params[key] = value ?? "";
          }
        }
        return { handler: route.entry.handler, params };
      }
    }
    return null;
  }

  return {
    get: (path, handler) => register("GET", path, handler),
    post: (path, handler) => register("POST", path, handler),
    delete: (path, handler) => register("DELETE", path, handler),
    async fetch(req: Request): Promise<Response> {
      const match = matchRoute(req.method, req.url);
      if (!match) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      const url = new URL(req.url);
      const ctx: MinimalContext = {
        req: {
          param: (name: string) => match.params[name] ?? "",
          query: (name: string) => url.searchParams.get(name),
          header: (name: string) => req.headers.get(name),
          url: req.url,
          arrayBuffer: () => req.arrayBuffer(),
          json: () => req.json(),
        } as MinimalRequest & { json: () => Promise<unknown> },
        json: (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
      };
      return match.handler(ctx);
    },
  };
}

/**
 * Create a standalone HTTP fetch handler for a b3nd client.
 *
 * Returns a standard `(Request) => Promise<Response>` function that can be
 * used with any server: `Deno.serve()`, Hono, Express (via adapter),
 * Cloudflare Workers, etc. No framework dependencies.
 *
 * @example Deno.serve
 * ```typescript
 * const handler = createHttpHandler(client);
 * Deno.serve({ port: 3000 }, handler);
 * ```
 *
 * @example Hono (with CORS or other middleware)
 * ```typescript
 * const app = new Hono();
 * app.use("*", cors({ origin: "*" }));
 * const handler = createHttpHandler(client);
 * app.all("/api/*", (c) => handler(c.req.raw));
 * ```
 */
/**
 * Create an HTTP handler — returns the handler function AND a notifyWrite
 * hook for pushing SSE events from non-HTTP writes.
 */
export function createHttpHandler(
  client: NodeProtocolInterface,
  options?: HttpHandlerOptions,
): HttpHandlerResult {
  const router = createMinimalRouter();
  const frontend = httpServer(router, { healthMeta: options?.healthMeta });
  frontend.configure({ client });

  // Access the bus exposed by httpServer (typed internally)
  // deno-lint-ignore no-explicit-any
  const busFrontend = frontend as any;

  return {
    handler: (req: Request) => Promise.resolve(frontend.fetch(req)),
    notifyWrite: (uri: string, data: unknown, ts: number) => {
      busFrontend.bus?.notify?.(uri, data, ts);
    },
  };
}

export function httpServer(
  app: MinimalRouter,
  options?: HttpServerOptions,
): ServerFrontend {
  const healthMeta = options?.healthMeta;

  // Backend + schema configured by createServerNode
  let backend:
    | { write: NodeProtocolWriteInterface; read: NodeProtocolReadInterface }
    | undefined;
  let schema: Schema | undefined;
  // Node interface for unified receive() endpoint
  let node: Node | undefined;
  // New simplified client interface
  let client: NodeProtocolInterface | undefined;

  // Subscription bus for SSE push — notified on every successful receive
  const bus = new SubscriptionBus();

  const extractProgramKey = (uri: string): string | undefined => {
    const programMatch = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+)/);
    return programMatch ? programMatch[1] : undefined;
  };

  function extractUriFromParams(c: any): string {
    const protocol = c.req.param("protocol");
    const domain = c.req.param("domain");
    let rest = c.req.param("path") || c.req.param("*") || "";
    if (!rest) {
      try {
        const url = new URL(c.req.url);
        const fullPath = url.pathname;
        const match = fullPath.match(/^\/api\/v1\/\w+\/[^/]+\/[^/]+(\/.*)$/);
        if (match && match[1]) {
          rest = match[1].substring(1);
        }
      } catch (_e) {}
    }
    const path = rest ? "/" + rest : "";
    return `${protocol}://${domain}${path}`;
  }

  // Wire routes using the provided router interface
  app.get("/api/v1/health", async (c: MinimalContext) => {
    if (client) {
      const res = await client.health();
      return c.json(
        healthMeta ? { ...res, ...healthMeta } : res,
        res.status === "healthy" ? 200 : 503,
      );
    }
    if (!backend) {
      return c.json(
        { status: "unhealthy", message: "handler not attached", ...healthMeta },
        503,
      );
    }
    const res = await backend.read.health();
    return c.json(
      healthMeta ? { ...res, ...healthMeta } : res,
      res.status === "healthy" ? 200 : 503,
    );
  });

  app.get("/api/v1/schema", async (c: MinimalContext) => {
    if (client) {
      const keys = await client.getSchema();
      return c.json({ schema: keys });
    }
    if (!backend) return c.json({ schema: [] });
    const keys = await backend.read.getSchema();
    return c.json({ schema: keys });
  });

  // Unified receive endpoint (new Node interface)
  app.post("/api/v1/receive", async (c: MinimalContext) => {
    // Parse request body — the body IS the message: [uri, data]
    const msg = await (async () => {
      try {
        return await (c as any).req.json?.() ?? null;
      } catch {
        return null;
      }
    })() as Message | null;

    if (!msg || !Array.isArray(msg) || msg.length < 2) {
      return c.json({
        accepted: false,
        error: "Invalid message format: expected [uri, data]",
      }, 400);
    }

    const [uri, rawData] = msg;
    if (!uri || typeof uri !== "string") {
      return c.json(
        { accepted: false, error: "Message URI is required" },
        400,
      );
    }

    // Deserialize binary data from base64-encoded wrapper
    const data = deserializeMsgData(rawData);

    // If client is configured, delegate directly.
    // SSE notification happens via rig events → notifyWrite (wired in rig.handler()).
    // For non-rig clients the bus.notify in the node path below handles it.
    if (client) {
      const result = await client.receive([uri, data] as Message);
      if (!result.accepted) {
        console.warn(`[receive] REJECTED ${uri}: ${result.error ?? "unknown"}`);
      }
      return c.json(result, result.accepted ? 200 : 400);
    }

    // If node is configured, use it directly
    if (node) {
      const result = await node.receive([uri, data] as Message);
      if (!result.accepted) {
        console.warn(`[receive] REJECTED ${uri}: ${result.error ?? "unknown"}`);
      } else {
        bus.notify(uri, data, Date.now());
      }
      return c.json(result, result.accepted ? 200 : 400);
    }

    // Fallback to legacy backend + schema validation
    if (!backend || !schema) {
      return c.json({ accepted: false, error: "handler not attached" }, 501);
    }

    const programKey = extractProgramKey(uri);
    const validator = programKey ? (schema as any)[programKey] : undefined;
    if (!validator) {
      return c.json({
        accepted: false,
        error: `No schema defined for program key: ${programKey}`,
      }, 400);
    }

    const validation = await validator({
      uri,
      value: data,
      read: backend.read.read.bind(backend.read),
    });
    if (!validation.valid) {
      return c.json({
        accepted: false,
        error: validation.error || "Validation failed",
      }, 400);
    }

    const res = await backend.write.receive([uri, data] as Message);
    if (res.accepted) {
      bus.notify(uri, data, Date.now());
    }
    return c.json(res, res.accepted ? 200 : 400);
  });

  app.get("/api/v1/read/:protocol/:domain/*", async (c: MinimalContext) => {
    const reader = client || backend?.read;
    if (!reader) return c.json({ error: "handler not attached" }, 501);
    const uri = extractUriFromParams(c);
    const res = await reader.read(uri);

    if (!res.success || !res.record) {
      console.warn(`[read] FAILED ${uri}: ${res.error ?? "no record"}`);
      return c.json({ error: res.error || "Not found" }, 404);
    }

    // If data is binary (Uint8Array), return raw bytes
    if (res.record.data instanceof Uint8Array) {
      const mimeType = getMimeTypeFromUri(uri);
      return new Response(res.record.data as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": res.record.data.length.toString(),
        },
      });
    }

    // Otherwise return JSON (existing behavior)
    return c.json(res.record, 200);
  });

  app.get("/api/v1/list/:protocol/:domain/*", async (c: MinimalContext) => {
    const reader = client || backend?.read;
    if (!reader) {
      return c.json({ data: [], pagination: { page: 1, limit: 50, total: 0 } });
    }
    const baseUri = extractUriFromParams(c).replace(/\/$/, "");
    const res = await reader.list(baseUri, {
      page:
        (c.req.query("page") ? Number(c.req.query("page")) : undefined) as any,
      limit: (c.req.query("limit")
        ? Number(c.req.query("limit"))
        : undefined) as any,
      pattern: (c.req.query("pattern") || undefined) as any,
      sortBy: (c.req.query("sortBy") as any) || undefined,
      sortOrder: (c.req.query("sortOrder") as any) || undefined,
    });
    return c.json(res, 200);
  });

  app.delete(
    "/api/v1/delete/:protocol/:domain/*",
    async (c: MinimalContext) => {
      const writer = client || backend?.write;
      if (!writer) {
        return c.json({
          success: false,
          error: "handler not attached",
        }, 501);
      }
      const uri = extractUriFromParams(c);
      const res = await writer.delete(uri);
      return c.json(res, res.success ? 200 : 404);
    },
  );

  // ── SSE subscription endpoint ────────────────────────────────────────
  app.get(
    "/api/v1/subscribe/:protocol/:domain/*",
    async (c: MinimalContext) => {
      const reader = client || backend?.read;
      if (!reader) {
        return new Response(
          JSON.stringify({ error: "handler not attached" }),
          { status: 501, headers: { "Content-Type": "application/json" } },
        );
      }

      const prefix = extractUriFromParams(c);
      const since = Number(c.req.query("since") || "0");
      const lastEventId = c.req.header("Last-Event-ID");
      const effectiveSince = lastEventId ? Number(lastEventId) : since;

      // Cleanup state — shared between start() and cancel()
      let cleanupFn: (() => void) | null = null;

      const body = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          let closed = false;
          const write = (text: string) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              closed = true;
            }
          };

          // 1. Send backlog (items since timestamp)
          (async () => {
            try {
              const listResult = await reader.list(prefix);
              if (listResult.success) {
                for (const item of listResult.data) {
                  if (closed) break;
                  const itemTs = (item as { ts?: number }).ts ?? 0;
                  if (itemTs <= effectiveSince) continue;

                  const readResult = await reader.read(item.uri);
                  if (readResult.success && readResult.record) {
                    const event = {
                      uri: item.uri,
                      data: readResult.record.data,
                      ts: readResult.record.ts,
                    };
                    write(
                      `id: ${event.ts}\nevent: write\ndata: ${
                        JSON.stringify(event)
                      }\n\n`,
                    );
                  }
                }
              }
            } catch (err) {
              if (!closed) console.warn("[sse] backlog error:", err);
            }

            // 2. Subscribe to live changes
            const unsub = bus.subscribe(prefix, (event) => {
              write(
                `id: ${event.ts}\nevent: write\ndata: ${
                  JSON.stringify(event)
                }\n\n`,
              );
            });

            // 3. Keep-alive ping every 30s
            const keepAlive = setInterval(() => {
              write(": keepalive\n\n");
            }, 30_000);

            // Register cleanup
            cleanupFn = () => {
              closed = true;
              unsub();
              clearInterval(keepAlive);
            };
          })();
        },
        cancel() {
          cleanupFn?.();
        },
      });

      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no", // Disable nginx buffering
        },
      });
    },
  );

  return {
    listen(port: number) {
      Deno.serve({ port }, (req) => app.fetch(req));
    },
    fetch: (req: Request) => app.fetch(req),
    configure: (
      opts:
        | {
          backend: {
            write: NodeProtocolWriteInterface;
            read: NodeProtocolReadInterface;
          };
          schema: Schema;
          node?: Node;
        }
        | { client: NodeProtocolInterface },
    ) => {
      if ("client" in opts) {
        client = opts.client;
      } else {
        backend = opts.backend;
        schema = opts.schema;
        node = opts.node;
      }
    },
    /** Expose the SSE subscription bus for external write notification. */
    bus,
  } as ServerFrontend & { bus: SubscriptionBus };
}

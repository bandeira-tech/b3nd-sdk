import type { ServerFrontend } from "./node.ts";
import type {
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  Schema,
  Transaction,
} from "../b3nd-core/types.ts";
import type { Node } from "../b3nd-compose/types.ts";
import { decodeBase64 } from "../b3nd-core/encoding.ts";

/**
 * Deserialize transaction data from JSON transport.
 * Unwraps base64-encoded binary marker objects back to Uint8Array.
 */
function deserializeTxData(data: unknown): unknown {
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
  cors?: "*" | {
    origin:
      | string
      | string[]
      | ((
        origin: string,
        c: unknown,
      ) => Promise<string | undefined | null> | string | undefined | null);
    allowMethods?:
      | string[]
      | ((origin: string, c: unknown) => Promise<string[]> | string[]);
    allowHeaders?: string[];
    maxAge?: number;
    credentials?: boolean;
    exposeHeaders?: string[];
  };
};

export function httpServer(app: MinimalRouter): ServerFrontend {
  // Backend + schema configured by createServerNode
  let backend:
    | { write: NodeProtocolWriteInterface; read: NodeProtocolReadInterface }
    | undefined;
  let schema: Schema | undefined;
  // Node interface for unified receive() endpoint
  let node: Node | undefined;
  // New simplified client interface
  let client: NodeProtocolInterface | undefined;

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
      return c.json(res, res.status === "healthy" ? 200 : 503);
    }
    if (!backend) {
      return c.json(
        { status: "unhealthy", message: "handler not attached" },
        503,
      );
    }
    const res = await backend.read.health();
    return c.json(res, res.status === "healthy" ? 200 : 503);
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
    // Parse request body to get transaction
    const body = await (async () => {
      try {
        return await (c as any).req.json?.() ?? {};
      } catch {
        return {};
      }
    })();

    const tx = (body as { tx?: Transaction }).tx;
    if (!tx || !Array.isArray(tx) || tx.length < 2) {
      return c.json({
        accepted: false,
        error: "Invalid transaction format: expected { tx: [uri, data] }",
      }, 400);
    }

    const [uri, rawData] = tx;
    if (!uri || typeof uri !== "string") {
      return c.json(
        { accepted: false, error: "Transaction URI is required" },
        400,
      );
    }

    // Deserialize binary data from base64-encoded wrapper
    const data = deserializeTxData(rawData);

    // If client is configured, delegate directly
    if (client) {
      const result = await client.receive([uri, data] as Transaction);
      return c.json(result, result.accepted ? 200 : 400);
    }

    // If node is configured, use it directly
    if (node) {
      const result = await node.receive([uri, data] as Transaction);
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

    const res = await backend.write.receive([uri, data] as Transaction);
    return c.json(res, res.accepted ? 200 : 400);
  });

  app.get("/api/v1/read/:protocol/:domain/*", async (c: MinimalContext) => {
    const reader = client || backend?.read;
    if (!reader) return c.json({ error: "handler not attached" }, 501);
    const uri = extractUriFromParams(c);
    const res = await reader.read(uri);

    if (!res.success || !res.record) {
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
  } as ServerFrontend;
}

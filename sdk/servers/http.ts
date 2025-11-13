import type { ServerFrontend } from "./node.ts";
import type {
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  Schema,
} from "../src/types.ts";

// Define a minimal interface that matches the subset of Hono we use.
// This removes the hard dependency on the 'hono' package from the SDK,
// while preserving the same usage pattern (httpServer(app)).
export interface MinimalRequest {
  param: (name: string) => string;
  query: (name: string) => string | undefined | null;
  url: string;
}

export interface MinimalContext {
  req: MinimalRequest;
  json: (body: unknown, status?: number) => Response;
}

export interface MinimalRouter {
  get: (path: string, handler: (c: MinimalContext) => Promise<Response> | Response) => void;
  post: (path: string, handler: (c: MinimalContext) => Promise<Response> | Response) => void;
  delete: (path: string, handler: (c: MinimalContext) => Promise<Response> | Response) => void;
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
    if (!backend) {
      return c.json({ status: "unhealthy", message: "handler not attached" }, 503);
    }
    const res = await backend.read.health();
    return c.json(res, res.status === "healthy" ? 200 : 503);
  });

  app.get("/api/v1/schema", async (c: MinimalContext) => {
    if (!backend) return c.json({ schema: [] });
    const keys = await backend.read.getSchema();
    return c.json({ schema: keys });
  });

  app.post("/api/v1/write/:protocol/:domain/*", async (c: MinimalContext) => {
    if (!backend || !schema) return c.json({ success: false, error: "handler not attached" }, 501);
    const uri = extractUriFromParams(c);
    const body = await (async () => {
      try { return await (c as any).req.json?.() ?? {}; } catch { return {}; }
    })();
    const programKey = extractProgramKey(uri);
    const validator = programKey ? (schema as any)[programKey] : undefined;
    if (!validator) return c.json({ success: false, error: `No schema defined for program key: ${programKey}` }, 400);
    const value = (body as any).value;
    const validation = await validator({ uri, value, read: backend.read.read.bind(backend.read) });
    if (!validation.valid) return c.json({ success: false, error: validation.error || "Validation failed" }, 400);
    const res = await backend.write.write(uri, value);
    return c.json(res, res.success ? 200 : 400);
  });

  app.get("/api/v1/read/:protocol/:domain/*", async (c: MinimalContext) => {
    if (!backend) return c.json({ error: "handler not attached" }, 501);
    const uri = extractUriFromParams(c);
    const res = await backend.read.read(uri);
    return c.json(res.record ?? { error: res.error }, res.success ? 200 : 404);
  });

  app.get("/api/v1/list/:protocol/:domain/*", async (c: MinimalContext) => {
    if (!backend) return c.json({ data: [], pagination: { page: 1, limit: 50, total: 0 } });
    const baseUri = extractUriFromParams(c).replace(/\/$/, "");
    const res = await backend.read.list(baseUri, {
      page: (c.req.query("page") ? Number(c.req.query("page")) : undefined) as any,
      limit: (c.req.query("limit") ? Number(c.req.query("limit")) : undefined) as any,
      pattern: (c.req.query("pattern") || undefined) as any,
      sortBy: (c.req.query("sortBy") as any) || undefined,
      sortOrder: (c.req.query("sortOrder") as any) || undefined,
    });
    return c.json(res, 200);
  });

  app.delete("/api/v1/delete/:protocol/:domain/*", async (c: MinimalContext) => {
    if (!backend) return c.json({ success: false, error: "handler not attached" }, 501);
    const uri = extractUriFromParams(c);
    const res = await backend.write.delete(uri);
    return c.json(res, res.success ? 200 : 404);
  });

  return {
    listen(port: number) {
      Deno.serve({ port }, (req) => app.fetch(req));
    },
    fetch: (req: Request) => app.fetch(req),
    configure: (
      opts: {
        backend: {
          write: NodeProtocolWriteInterface;
          read: NodeProtocolReadInterface;
        };
        schema: Schema;
      },
    ) => {
      backend = opts.backend;
      schema = opts.schema;
    },
  } as ServerFrontend;
}

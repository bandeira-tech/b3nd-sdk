import { Hono, type Context } from "hono";
import type { ServerFrontend } from "./node.ts";
import type {
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  Schema,
} from "../src/types.ts";

type HttpServerOptions = {
  cors?: "*" | {
    origin:
      | string
      | string[]
      | ((
        origin: string,
        c: Context,
      ) => Promise<string | undefined | null> | string | undefined | null);
    allowMethods?:
      | string[]
      | ((origin: string, c: Context) => Promise<string[]> | string[]);
    allowHeaders?: string[];
    maxAge?: number;
    credentials?: boolean;
    exposeHeaders?: string[];
  };
};

export function httpServer(app: Hono): ServerFrontend {
  // Backend + schema configured by createServerNode
  let backend:
    | { write: NodeProtocolWriteInterface; read: NodeProtocolReadInterface }
    | undefined;
  let schema: Schema | undefined;

  const extractProgramKey = (uri: string): string | undefined => {
    const programMatch = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+)/);
    return programMatch ? programMatch[1] : undefined;
  };

  app.get("/api/v1/health", async (c: Context) => {
    if (!backend) {
      return c.json(
        { status: "unhealthy", message: "handler not attached" },
        503,
      );
    }
    const res = await backend.read.health();
    return c.json(res, res.status === "healthy" ? 200 : 503);
  });

  app.get("/api/v1/schema", async (c: Context) => {
    if (!backend) return c.json({ schema: [] });
    const keys = await backend.read.getSchema();
    return c.json({ schema: keys });
  });

  function extractUriFromParams(c: any): string {
    const protocol = c.req.param("protocol");
    const domain = c.req.param("domain");
    const rest = c.req.param("*") || "";
    const path = rest ? "/" + rest : "";
    return `${protocol}://${domain}${path}`;
  }

  app.post("/api/v1/write/:protocol/:domain/*", async (c: Context) => {
    if (!backend || !schema) {
      return c.json({ success: false, error: "handler not attached" }, 501);
    }
    const uri = extractUriFromParams(c);
    const body = await c.req.json().catch(() => ({}));
    const programKey = extractProgramKey(uri);
    const validator = programKey ? (schema as any)[programKey] : undefined;
    if (!validator) {
      return c.json({
        success: false,
        error: `No schema defined for program key: ${programKey}`,
      }, 400);
    }
    // Try to parse nested signed/encrypted payloads by passing them through as-is; validation only checks the outer
    const value = body.value;
    const validation = await validator({ uri, value });
    if (!validation.valid) {
      return c.json({
        success: false,
        error: validation.error || "Validation failed",
      }, 400);
    }
    const res = await backend.write.write(uri, value);
    return c.json(res, res.success ? 200 : 400);
  });

  app.get("/api/v1/read/:protocol/:domain/*", async (c: Context) => {
    if (!backend) return c.json({ error: "handler not attached" }, 501);
    const uri = extractUriFromParams(c);
    const res = await backend.read.read(uri);
    return c.json(res.record ?? { error: res.error }, res.success ? 200 : 404);
  });

  app.get("/api/v1/list/:protocol/:domain/*", async (c: Context) => {
    if (!backend) {
      return c.json({ data: [], pagination: { page: 1, limit: 50, total: 0 } });
    }
    const baseUri = extractUriFromParams(c).replace(/\/$/, "");
    const res = await backend.read.list(baseUri, {
      page: c.req.query("page") ? Number(c.req.query("page")) : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      pattern: c.req.query("pattern") || undefined,
      sortBy: c.req.query("sortBy") as any || undefined,
      sortOrder: c.req.query("sortOrder") as any || undefined,
    });
    return c.json(res, 200);
  });

  // Protocol-root listing: allow /api/v1/list/:protocol/ to list across the protocol
  app.get("/api/v1/list/:protocol/", async (c: Context) => {
    if (!backend) {
      return c.json({ data: [], pagination: { page: 1, limit: 50, total: 0 } });
    }
    const protocol = c.req.param("protocol");
    const page = c.req.query("page") ? Number(c.req.query("page")) : undefined;
    const limit = c.req.query("limit")
      ? Number(c.req.query("limit"))
      : undefined;
    const pattern = c.req.query("pattern") || undefined;
    const sortBy = c.req.query("sortBy") as any || undefined;
    const sortOrder = c.req.query("sortOrder") as any || undefined;
    const res = await backend.read.list(`${protocol}://`, {
      page,
      limit,
      pattern,
      sortBy,
      sortOrder,
    });
    return c.json(res, 200);
  });


  app.delete("/api/v1/delete/:protocol/:domain/*", async (c: Context) => {
    if (!backend) {
      return c.json({ success: false, error: "handler not attached" }, 501);
    }
    const uri = extractUriFromParams(c);
    const res = await backend.write.delete(uri);
    return c.json(res, res.success ? 200 : 404);
  });

  const serveHandler = (req: Request) => app.fetch(req);

  return {
    listen(port: number) {
      Deno.serve({ port }, serveHandler);
    },
    fetch: serveHandler,
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

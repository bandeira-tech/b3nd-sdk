import { Hono } from "hono";
import { z } from "zod";
import { getClientManager } from "./clients.ts";
import type {
  DeleteResponse,
  ListResponse,
  ReadResponse,
  WriteRequest,
  WriteResponse,
} from "./types.ts";

const api = new Hono();

// Shared schemas
const PathSchema = z.string().min(1);
const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const WriteBodySchema = z.object({
  uri: z.string().url(),
  value: z.unknown(),
});

// Helper function to handle client errors
function handleClientError(error: unknown, context: string): Response {
  console.error(`[Routes] ${context} error:`, error);

  if (error instanceof Error) {
    if (error.message.includes("not found")) {
      return new Response(
        JSON.stringify({
          error: "Instance not found",
          message: error.message,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  return new Response(
    JSON.stringify({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  );
}

// GET /api/v1/health - Health check endpoint
api.get("/health", async (c) => {
  try {
    const manager = getClientManager();
    const instanceNames = manager.getInstanceNames();
    const healthChecks: Record<string, any> = {};

    for (const name of instanceNames) {
      try {
        const client = manager.getClient(name);
        const health = await client.health();
        healthChecks[name] = health;
      } catch (error) {
        healthChecks[name] = {
          status: "unhealthy",
          message: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    const allHealthy = Object.values(healthChecks).every(
      (h: any) => h.status === "healthy",
    );

    return c.json(
      {
        status: allHealthy ? "healthy" : "degraded",
        instances: healthChecks,
        timestamp: Date.now(),
      },
      allHealthy ? 200 : 503,
    );
  } catch (error) {
    return c.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: Date.now(),
      },
      503,
    );
  }
});

// Helper for list logic
async function handleList(c: any, instance: string, protocol: string, domain: string, path: string) {
  const pagination = PaginationSchema.parse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
  });

  const client = getClientManager().getClient(instance);
  const normalizedPath = !path || path === "" ? "/" : (path.startsWith("/") ? path : "/" + path);
  const uri = `${protocol}://${domain}${normalizedPath}`;
  const result = await client.list(uri, pagination);

  return c.json(result, 200);
}

// GET /api/v1/list/:instance/:protocol/:domain - List contents at domain root
api.get("/list/:instance/:protocol/:domain", async (c) => {
  try {
    const { instance, protocol, domain } = c.req.param();
    return await handleList(c, instance, protocol, domain, "/");
  } catch (error) {
    const response = handleClientError(error, "List");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
});

// GET /api/v1/list/:instance/:protocol/:domain/:path* - List contents at path with pagination
api.get("/list/:instance/:protocol/:domain/:path*", async (c) => {
  try {
    const { instance, protocol, domain } = c.req.param();
    const path = c.req.param("path*") || "/";
    return await handleList(c, instance, protocol, domain, path);
  } catch (error) {
    const response = handleClientError(error, "List");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
});

// GET /api/v1/read/:instance/:protocol/:domain/:path* - Read with instance in path
api.get("/read/:instance/:protocol/:domain/:path*", async (c) => {
  try {
    const { instance, protocol, domain, "path*": path } = c.req.param();

    const client = getClientManager().getClient(instance);
    const normalizedPath = path.startsWith("/") ? path : "/" + path;
    const uri = `${protocol}://${domain}${normalizedPath}`;
    const result = await client.read(uri);

    if (!result.success || !result.record) {
      return c.json({ error: "Record not found" }, 404);
    }

    return c.json(result.record, 200);
  } catch (error) {
    const response = handleClientError(error, "Read");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
});

// POST /api/v1/write - Write or update record
api.post("/write", async (c) => {
  try {
    const body = await c.req.json();
    const writeReq: WriteRequest = WriteBodySchema.parse(body);
    const instance = c.req.query("instance");

    const client = getClientManager().getClient(instance);
    const result = await client.write(writeReq.uri, writeReq.value);

    if (!result.success) {
      return c.json({ error: result.error || "Write failed" }, 400);
    }

    return c.json(result, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation failed",
          details: error.errors,
        },
        400,
      );
    }

    const response = handleClientError(error, "Write");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
});

// DELETE /api/v1/delete/:protocol/:domain/:path* - Delete record at path
api.delete("/delete/:protocol/:domain/:path*", async (c) => {
  try {
    const { protocol, domain, path: rawPath } = c.req.param();
    let fullPath = decodeURIComponent(rawPath || "");
    if (!fullPath.startsWith("/")) fullPath = "/" + fullPath;
    PathSchema.parse(fullPath);
    const instance = c.req.query("instance");

    const client = getClientManager().getClient(instance);
    const uri = `${protocol}://${domain}${fullPath}`;
    const result = await client.delete(uri);

    if (!result.success) {
      return c.json({ error: result.error || "Delete failed" }, 400);
    }

    return c.json(result, 200);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation failed",
          details: error.errors,
        },
        400,
      );
    }

    const response = handleClientError(error, "Delete");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
});

// GET /api/v1/schema - Get configured schema URIs
api.get("/schema", async (c) => {
  try {
    const manager = getClientManager();
    const schemas = await manager.getSchemas();
    const instances = manager.getInstanceNames();
    const defaultInstance = manager.getDefaultInstance();

    return c.json({
      schemas,
      instances,
      default: defaultInstance,
    }, 200);
  } catch (error) {
    console.error("[Schema endpoint] Error:", error);
    return handleClientError(error, "Schema");
  }
});

export { api };

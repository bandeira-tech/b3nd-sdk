import { Hono } from "hono";
import { z } from "zod";

import { getAdapter } from "./adapter.ts";
import type { PersistenceAdapter } from "./adapter.ts";
import type {
  ListResponse,
  ReadResponse,
  WriteRequest,
  WriteResponse,
  DeleteResponse,
} from "./types.ts";

const api = new Hono();

// Shared schemas
const InstanceSchema = z.string().min(1).optional();
const PathSchema = z.string().min(1);
const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const WriteBodySchema = z.object({
  uri: z.string().url(),
  value: z.unknown(),
});

// Helper function to handle adapter errors
function handleAdapterError(error: unknown, context: string): Response {
  console.error(`[Routes] ${context} error:`, error);

  if (error instanceof Error) {
    if (error.message.includes("not found in config")) {
      return new Response(
        JSON.stringify({
          error: "Instance not found",
          message: error.message,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    if (error.message.includes("not initialized")) {
      return new Response(
        JSON.stringify({
          error: "Service unavailable",
          message: "Persistence adapter not initialized",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    if (error.message.includes("Schema load failed")) {
      return new Response(
        JSON.stringify({
          error: "Configuration error",
          message: error.message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
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
    const adapter = getAdapter() as any;
    if (adapter.health) {
      const health = await adapter.health();
      const healthArray = Array.from(health.entries());
      const allHealthy = healthArray.every(
        ([_, status]) => status.status === "healthy",
      );

      return c.json(
        {
          status: allHealthy ? "healthy" : "degraded",
          instances: Object.fromEntries(health),
          timestamp: Date.now(),
        },
        allHealthy ? 200 : 503,
      );
    }

    return c.json(
      {
        status: "unknown",
        message: "Health check not available",
      },
      200,
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

// GET /api/v1/list/:protocol/:domain/:path* - List contents at path with pagination
api.get("/list", async (c) => {
  try {
    const instance = c.req.query("instance");
    const pattern = c.req.query("pattern");
    const pagination = PaginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });

    // If pattern is provided, use it for filtering
    // Otherwise list all
    const adapter: PersistenceAdapter = getAdapter();

    // For now, we'll list from root with pattern filtering
    // This is a simplified implementation
    const result = await adapter.listPath(
      "test", // default protocol for listing
      "localhost", // default domain for listing
      "/",
      {
        ...pagination,
        pattern: pattern,
      } as any,
      instance,
    );

    return c.json(result, 200);
  } catch (error) {
    const response = handleAdapterError(error, "List");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
});

// GET /api/v1/list/:protocol/:domain/:path* - List contents at specific path
api.get("/list/:protocol/:domain/:path*", async (c) => {
  try {
    const { protocol, domain, path: rawPath } = c.req.param();
    const fullPath = rawPath ? decodeURIComponent(rawPath) : "/";
    const instance = c.req.query("instance");
    const pagination = PaginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });

    const adapter: PersistenceAdapter = getAdapter();
    const result: ListResponse = await adapter.listPath(
      protocol,
      domain,
      fullPath,
      { ...pagination },
      instance,
    );

    return c.json(result, 200);
  } catch (error) {
    const response = handleAdapterError(error, "List");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
});

// GET /api/v1/read/:instance/:protocol/:domain/:path* - Read with instance in path
api.get("/read/:instance/:protocol/:domain/:path*", async (c) => {
  try {
    const { instance, protocol, domain, path } = c.req.param();

    const record: ReadResponse | null = await getAdapter().read(
      protocol,
      domain,
      path || "/",
      instance,
    );

    if (!record) {
      return c.json({ error: "Record not found" }, 404);
    }

    return c.json(record, 200);
  } catch (error) {
    const response = handleAdapterError(error, "Read");
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

    const url = new URL(writeReq.uri);
    const protocol = url.protocol.replace(":", "");
    const domain = url.hostname;
    const path = url.pathname;

    const adapter: PersistenceAdapter = getAdapter();
    const result: WriteResponse = await adapter.write(
      protocol,
      domain,
      path,
      writeReq.value,
      instance,
    );

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

    const response = handleAdapterError(error, "Write");
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

    const adapter: PersistenceAdapter = getAdapter();
    const result: DeleteResponse = await adapter.delete(
      protocol,
      domain,
      fullPath,
      instance,
    );

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

    const response = handleAdapterError(error, "Delete");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
});

export { api };

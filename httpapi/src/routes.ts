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
  uri: z.string().min(1).refine(
    (uri) => {
      // Allow custom URI schemes (protocol://path)
      return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/.+/.test(uri);
    },
    { message: "Invalid URI format. Expected format: protocol://path" }
  ),
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

// New canonical non-instance routes (compat with SDK servers and E2E)

// GET /api/v1/read/:protocol/:domain/* - Read a record
api.get("/read/:protocol/:domain/:path*", async (c) => {
  try {
    const { protocol, domain } = c.req.param();
    const rest = c.req.param("path*") || "";
    const path = rest ? `/${rest}` : "";
    const client = getClientManager().getClient();
    const uri = `${protocol}://${domain}${path}`;
    const result = await client.read(uri);
    if (!result.success || !result.record) {
      return c.json({ error: "Record not found" }, 404);
    }
    return c.json(result.record, 200);
  } catch (error) {
    const response = handleClientError(error, "Read");
    return new Response(response.body, { status: response.status, headers: response.headers });
  }
});

// GET /api/v1/list/:protocol/:domain/* - List under a domain
api.get("/list/:protocol/:domain/:path*", async (c) => {
  try {
    const { protocol, domain } = c.req.param();
    const rest = c.req.param("path*") || "";
    const path = rest ? `/${rest}` : "";
    const pagination = PaginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });
    const client = getClientManager().getClient();
    const baseUri = `${protocol}://${domain}${path}`.replace(/\/$/, "");
    const result = await client.list(baseUri, pagination);
    return c.json(result, 200);
  } catch (error) {
    const response = handleClientError(error, "List");
    return new Response(response.body, { status: response.status, headers: response.headers });
  }
});

// GET /api/v1/list/:protocol/ - List across a protocol (protocol root)
api.get("/list/:protocol/", async (c) => {
  try {
    const { protocol } = c.req.param();
    const pagination = PaginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });
    const client = getClientManager().getClient();
    const result = await client.list(`${protocol}://`, pagination);
    return c.json(result, 200);
  } catch (error) {
    const response = handleClientError(error, "List");
    return new Response(response.body, { status: response.status, headers: response.headers });
  }
});

// POST /api/v1/write/:protocol/:domain/* - Write or update record
api.post("/write/:protocol/:domain/:path*", async (c) => {
  try {
    const { protocol, domain } = c.req.param();
    const rest = c.req.param("path*") || "";
    const path = rest ? `/${rest}` : "";
    const body = await c.req.json().catch(() => ({ value: undefined }));
    const client = getClientManager().getClient();
    const uri = `${protocol}://${domain}${path}`;
    const result = await client.write(uri, body.value);
    if (!result.success) {
      return c.json({ success: false, error: result.error || "Write failed" }, 400);
    }
    return c.json(result, 201);
  } catch (error) {
    const response = handleClientError(error, "Write");
    return new Response(response.body, { status: response.status, headers: response.headers });
  }
});

// Helper for list logic
async function handleList(c: any, instance: string, protocol: string, path?: string) {
  try {
    const pagination = PaginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });

    const client = getClientManager().getClient(instance);

    // Handle empty path or "/" as protocol root
    const uri = (!path || path === "/")
      ? `${protocol}://`
      : `${protocol}://${path}`;

    const result = await client.list(uri, pagination);

    return c.json(result, 200);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation failed",
          details: error.issues,
        },
        400,
      );
    }
    throw error;
  }
}

// GET /api/v1/list/:instance/:protocol/:path* - List contents with pagination
api.get("/list/:instance/:protocol/:path*", async (c) => {
  try {
    const { instance, protocol } = c.req.param();
    const path = c.req.param("path*");
    return await handleList(c, instance, protocol, path);
  } catch (error) {
    const response = handleClientError(error, "List");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
});

// GET /api/v1/read/:instance/:protocol/ - Explicit handler for trailing slash (protocol root)
api.get("/read/:instance/:protocol/", async (c) => {
  try {
    const { instance, protocol } = c.req.param();
    const client = getClientManager().getClient(instance);
    const uri = `${protocol}://`;
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

// GET /api/v1/read/:instance/:protocol/:path+ - Read with instance and resource path
api.get("/read/:instance/:protocol/:path+", async (c) => {
  try {
    const { instance, protocol } = c.req.param();
    const path = c.req.param("path+");

    const client = getClientManager().getClient(instance);
    const uri = `${protocol}://${path}`;
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
    const requestedInstance = c.req.query("instance");
    const manager = getClientManager();
    const instance = requestedInstance || manager.getDefaultInstance() || "default";

    const writeReq: WriteRequest = {
      ...WriteBodySchema.parse(body),
      instance,
    };

    const client = manager.getClient(writeReq.instance);
    const result = await client.write(writeReq.uri, writeReq.value);

    if (!result.success) {
      return c.json({ success: false, error: result.error || "Write failed" }, 400);
    }

    return c.json(result, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation failed",
          details: error.issues,
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

// DELETE /api/v1/delete/:protocol/:path* - Delete record
api.delete("/delete/:protocol/:path*", async (c) => {
  try {
    const { protocol } = c.req.param();
    const path = c.req.param("path*") || "";
    const requestedInstance = c.req.query("instance");
    const manager = getClientManager();
    const instance = requestedInstance || manager.getDefaultInstance() || "default";

    const client = manager.getClient(instance);

    // Handle empty path or "/" as protocol root
    const uri = (!path || path === "/")
      ? `${protocol}://`
      : `${protocol}://${path}`;

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
          details: error.issues,
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

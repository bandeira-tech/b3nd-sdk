import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadServerConfig } from "./config.ts";
import { api } from "./routes.ts";
import { getClientManager } from "./clients.ts";

/**
 * Create and configure the Hono application
 * This function sets up all middleware, routes, and error handlers
 */
async function createApp() {
  const app = new Hono();

  // Load server configuration
  const serverConfig = await loadServerConfig();

  // Apply CORS middleware
  app.use("*", cors(serverConfig.cors));

  // Request logging middleware (standard HTTP logs: method, URL, status, duration)
  app.use(async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(
      `${c.req.method} ${c.req.url} ${c.res.status} - ${duration}ms`,
    );
  });

  // Health endpoint - checks client manager status
  app.get("/api/v1/health", async (c) => {
    try {
      const manager = getClientManager();
      const instanceNames = manager.getInstanceNames();
      const instances: Record<string, any> = {};

      for (const name of instanceNames) {
        try {
          const client = manager.getClient(name);
          const health = await client.health();
          instances[name] = health;
        } catch (error) {
          instances[name] = {
            status: "unhealthy",
            message: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }

      // If no instances are configured, return unhealthy status
      if (instanceNames.length === 0) {
        return c.json({
          status: "unhealthy",
          error: "No client instances configured",
          timestamp: Date.now(),
        }, 503);
      }

      return c.json({
        status: "healthy",
        instances,
        timestamp: Date.now(),
      });
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

  // Schema endpoint - returns loaded schemas and instances
  app.get("/api/v1/schema", async (c) => {
    try {
      const manager = getClientManager();
      const schemas = await manager.getSchemas();
      const instances = manager.getInstanceNames();
      const defaultInstance = manager.getDefaultInstance();

      return c.json({
        schemas,
        instances,
        default: defaultInstance,
      });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  });

  // Mount core API routes
  app.route("/api/v1", api);

  // 404 handler - return JSON instead of plain text
  app.notFound((c) => {
    return c.json({ error: "Not found" }, 404);
  });

  // Enhanced error handler: Log request context + full stack trace on errors
  const errorHandler = (err: Error, c: any) => {
    const errorMsg = err.message || "Internal server error";
    const stackTrace = err.stack || "No stack trace available";
    console.error(
      `Error: ${errorMsg} (request: ${c.req.method} ${c.req.url})`,
    );
    console.error(stackTrace);
    return c.json(
      {
        error: errorMsg,
        code: "INTERNAL_ERROR",
      },
      500,
    );
  };

  api.onError(errorHandler);
  app.onError(errorHandler);

  return app;
}

// Create the app instance at module level for imports
export const app = await createApp();

// If run directly, start a simple server
if (import.meta.main) {
  try {
    const serverConfig = await loadServerConfig();
    const port = serverConfig.port || 8000;

    console.log(`Server starting on http://localhost:${port}`);
    console.log(`Health check: http://localhost:${port}/api/v1/health`);

    Deno.serve({ port }, app.fetch);
  } catch (error) {
    const errorMsg = (error as Error).message || "Failed to start server";
    const stackTrace = (error as Error).stack || "No stack trace available";
    console.error(`Startup error: ${errorMsg}`);
    console.error(stackTrace);
    Deno.exit(1);
  }
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadServerConfig, loadPersistenceConfig } from "./config.ts";
import { api } from "./routes.ts";

// Create and configure the app
const app = new Hono();

async function main() {
  try {
    const serverConfig = await loadServerConfig();
    const persistenceConfig = await loadPersistenceConfig();
    console.log(
      `Server loaded config: instances=${Object.keys(persistenceConfig).join(", ")}`,
    );

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

    // Adapters loaded lazily in routes

    // Health endpoint
    app.get("/api/v1/health", (c) =>
      c.json({
        status: "healthy",
        instances: Object.keys(persistenceConfig),
      }),
    );

    // Schema endpoint (returns persistence config structure)
    app.get("/api/v1/schema", (c) =>
      c.json({
        schemas: persistenceConfig,
      }),
    );

    // Mount core API routes
    app.route("/api/v1", api);

    // Enhanced error handler: Log request context + full stack trace on errors
    const errorHandler = (err, c) => {
      console.log("foobar");
      const errorMsg = (err as Error).message || "Internal server error";
      const stackTrace = (err as Error).stack || "No stack trace available";
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

    const port = serverConfig.port || 8000;
    console.log(`Server starting on http://localhost:${port}`);

    // Start the server
    await Deno.serve({ port }, app.fetch);
  } catch (error) {
    const errorMsg = (error as Error).message || "Failed to start server";
    const stackTrace = (error as Error).stack || "No stack trace available";
    console.error(`Startup error: ${errorMsg}`);
    console.error(stackTrace);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}

export { app };

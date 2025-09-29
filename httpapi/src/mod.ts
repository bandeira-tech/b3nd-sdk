import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadServerConfig, loadPersistenceConfig } from "./config.ts";
import { DefaultPersistenceAdapter } from "./adapter.ts";
import { api } from "./routes.ts";

async function main() {
  try {
    const serverConfig = await loadServerConfig();
    const persistenceConfig = await loadPersistenceConfig();

    const app = new Hono();

    // Apply CORS middleware
    app.use("*", cors(serverConfig.cors));

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

    // Basic error handler middleware
    app.onError((err, c) => {
      console.error("Server error:", err);
      return c.json(
        {
          error: (err as Error).message || "Internal server error",
          code: "INTERNAL_ERROR",
        },
        500,
      );
    });

    const port = serverConfig.port || 8000;
    console.log(`Server starting on http://localhost:${port}`);

    // Start the server
    await Deno.serve({ port }, app.fetch);
  } catch (error) {
    console.error("Failed to start server:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}

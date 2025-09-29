import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadServerConfig, loadPersistenceConfig } from "./config.ts";

async function main() {
  try {
    const serverConfig = await loadServerConfig();
    const persistenceConfig = await loadPersistenceConfig();

    const app = new Hono();

    // Apply CORS middleware
    app.use("*", cors(serverConfig.cors));

    // Health endpoint
    app.get("/api/v1/health", (c) =>
      c.json({
        status: "healthy",
        instances: Object.keys(persistenceConfig),
      }),
    );

    // Schema endpoint (placeholder for now, returns persistence config structure)
    // Schema endpoint (placeholder: returns persistence config structure for now)
    app.get("/api/v1/schema", (c) =>
      c.json({
        schemas: persistenceConfig,
      }),
    );

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

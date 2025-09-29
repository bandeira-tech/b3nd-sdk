import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadServerConfig, loadPersistenceConfig } from "./config";
import type {
  Persistence,
  PersistenceWrite,
  PersistenceRecord,
} from "../../persistence/mod.ts";

async function main() {
  try {
    const serverConfig = await loadServerConfig();
    const persistenceConfig = await loadPersistenceConfig();

    // Dummy schema for dev (always allow writes)
    type ValidationFn = (write: PersistenceWrite<any>) => Promise<boolean>;
    const schema: Record<string, ValidationFn> = {
      "https://default/": async () => true,
    };
    const persistence = new Persistence({ schema } as any);

    const adapter = {
      async listPath(
        path: string = "/",
        options: { page?: number; limit?: number } = {},
      ) {
        const { page = 1, limit = 50 } = options;
        const items: Array<{
          uri: string;
          ts: number;
          data: any;
          type: "file" | "dir";
        }> = [];
        const protocol = "https";
        const host = "default";
        const store = persistence.storage[protocol]?.[host];
        if (store) {
          for (const fullPath in store) {
            if (fullPath.startsWith(path)) {
              const item = store[fullPath];
              const isDir = fullPath.endsWith("/") || item.data?.type === "dir";
              items.push({
                uri: `${protocol}://${host}${fullPath}`,
                ts: item.ts,
                data: item.data,
                type: isDir ? "dir" : "file",
              });
            }
          }
        }
        items.sort((a, b) => b.ts - a.ts);
        const total = items.length;
        const start = (page - 1) * limit;
        const data = items.slice(start, start + limit);
        const hasNext = start + limit < total;
        const hasPrev = page > 1;
        return { data, pagination: { page, limit, total, hasNext, hasPrev } };
      },
      async readRecord(uri: string): Promise<PersistenceRecord<any>> {
        const record = await persistence.read(uri);
        if (!record) {
          throw new Error(`Record not found at ${uri}`);
        }
        return record;
      },
      async writeRecord(input: {
        uri: string;
        value: any;
      }): Promise<[boolean, PersistenceRecord<any> | null]> {
        return await persistence.write(input);
      },
      async deleteRecord(
        uri: string,
      ): Promise<{ success: boolean; error?: string }> {
        try {
          const target = new URL(uri);
          const protocol = target.protocol;
          const host = target.host;
          const pathname = target.pathname;
          const store = persistence.storage[protocol]?.[host];
          if (store && store[pathname]) {
            delete store[pathname];
            return { success: true };
          }
          return { success: false, error: "Not found" };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      },
      async search(
        q: string = "",
        options: { page?: number; limit?: number } = {},
      ): Promise<{ data: any[]; pagination: any }> {
        // Placeholder: no real search yet
        const { page = 1, limit = 20 } = options;
        return {
          data: [],
          pagination: { page, limit, total: 0, hasNext: false, hasPrev: false },
        };
      },
    };

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

    // Core API routes using adapter
    app.get("/api/v1/list/:path*", async (c) => {
      let path = c.req.param("path") || "/";
      if (!path.endsWith("/")) path += "/";
      const page = Number(c.req.query("page")) || 1;
      const limit = Number(c.req.query("limit")) || 50;
      const result = await adapter.listPath(path, { page, limit });
      return c.json(result);
    });

    app.get("/api/v1/read/:path", async (c) => {
      const path = c.req.param("path");
      if (!path) return c.json({ error: "Path required" }, 400);
      const uri = `https://default${path.startsWith("/") ? "" : "/"}${path}`;
      try {
        const record = await adapter.readRecord(uri);
        return c.json(record);
      } catch (err) {
        return c.json({ error: (err as Error).message }, 404);
      }
    });

    app.get("/api/v1/search", async (c) => {
      const q = c.req.query("q") || "";
      const page = Number(c.req.query("page")) || 1;
      const limit = Number(c.req.query("limit")) || 20;
      const result = await adapter.search(q, { page, limit });
      return c.json(result);
    });

    app.post("/api/v1/write", async (c) => {
      let body;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      const { uri, value } = body;
      if (!uri || value === undefined) {
        return c.json({ error: "uri and value are required" }, 400);
      }
      const [err, record] = await adapter.writeRecord({ uri, value });
      if (err) {
        return c.json({ success: false, error: "Write failed" }, 400);
      }
      return c.json({ success: true, record }, 201);
    });

    app.delete("/api/v1/delete/:path", async (c) => {
      const path = c.req.param("path");
      if (!path) return c.json({ error: "Path required" }, 400);
      const uri = `https://default${path.startsWith("/") ? "" : "/"}${path}`;
      const result = await adapter.deleteRecord(uri);
      if (result.success) {
        return c.json({ success: true });
      } else {
        return c.json({ success: false, error: result.error }, 404);
      }
    });

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

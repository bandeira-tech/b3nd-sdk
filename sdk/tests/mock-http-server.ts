/**
 * Mock HTTP Server for testing HttpClient
 *
 * Provides configurable HTTP server instances that simulate different scenarios:
 * - Happy path (successful operations)
 * - Connection errors (server unreachable)
 * - Validation errors (schema validation failures)
 */

import type {
  HealthStatus,
  ListResult,
  PersistenceRecord,
} from "../src/types.ts";

export interface MockServerConfig {
  /** Port to run server on */
  port: number;

  /** Behavior mode */
  mode: "happy" | "connectionError" | "validationError";

  /** In-memory storage for happy path */
  storage?: Map<string, PersistenceRecord<unknown>>;
}

export class MockHttpServer {
  private server?: Deno.HttpServer;
  private config: MockServerConfig;
  private storage: Map<string, PersistenceRecord<unknown>>;

  constructor(config: MockServerConfig) {
    this.config = config;
    this.storage = config.storage || new Map();
  }

  async start(): Promise<void> {
    if (this.config.mode === "connectionError") {
      // Don't actually start server for connection error mode
      return;
    }

    const handler = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);

      // Health endpoint
      if (url.pathname === "/api/v1/health") {
        return this.handleHealth();
      }

      // Schema endpoint
      if (url.pathname === "/api/v1/schema") {
        return this.handleSchema();
      }

      // Write endpoint
      if (url.pathname.startsWith("/api/v1/write/")) {
        return await this.handleWrite(req, url);
      }

      // Read endpoint
      if (url.pathname.startsWith("/api/v1/read/")) {
        return this.handleRead(url);
      }

      // List endpoint
      if (url.pathname.startsWith("/api/v1/list/")) {
        return this.handleList(url);
      }

      // Delete endpoint
      if (url.pathname.startsWith("/api/v1/delete/")) {
        return this.handleDelete(url);
      }

      return new Response("Not Found", { status: 404 });
    };

    this.server = Deno.serve({
      port: this.config.port,
      hostname: "127.0.0.1",
      onListen: () => {},
    }, handler);
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
    }
  }

  private handleHealth(): Response {
    const health: HealthStatus = {
      status: "healthy",
      message: "Mock server operational",
    };
    return Response.json(health);
  }

  private handleSchema(): Response {
    return Response.json({
      default: "default",
      schemas: {
        default: ["users://", "cache://"],
      },
    });
  }

  private async handleWrite(req: Request, url: URL): Promise<Response> {
    if (this.config.mode === "validationError") {
      return new Response("Validation failed: Name is required", {
        status: 400,
      });
    }

    // Parse URI from path: /api/v1/write/{protocol}/{domain}{path}
    const parts = url.pathname.split("/").slice(4); // Skip /api/v1/write/
    const protocol = parts[0];
    const domain = parts[1];
    const path = "/" + parts.slice(2).join("/");
    const uri = `${protocol}://${domain}${path}`;

    // Get value from request body
    const body: any = await req.json();

    const record: PersistenceRecord<unknown> = {
      ts: Date.now(),
      data: body.value,
    };

    this.storage.set(uri, record);

    return Response.json({
      success: true,
      record,
    });
  }

  private handleRead(url: URL): Response {
    // Parse URI from path: /api/v1/read/{instance}/{protocol}/{domain}{path}
    const parts = url.pathname.split("/").slice(5); // Skip /api/v1/read/{instance}/
    const protocol = parts[0];
    const domain = parts[1];
    const path = "/" + parts.slice(2).join("/");
    const uri = `${protocol}://${domain}${path}`;

    const record = this.storage.get(uri);

    if (!record) {
      return new Response("Not found", { status: 404 });
    }

    return Response.json(record);
  }

  private handleList(url: URL): Response {
    // Parse URI from path: /api/v1/list/{instance}/{protocol}/{domain}{path}
    const parts = url.pathname.split("/").slice(5); // Skip /api/v1/list/{instance}/
    const protocol = parts[0];
    const domain = parts[1];
    const pathPart = parts.length > 2 ? "/" + parts.slice(2).join("/") : "";

    const prefix = `${protocol}://${domain}${pathPart}`;
    const pattern = url.searchParams.get("pattern");

    let items = Array.from(this.storage.keys())
      .filter((key) => key.startsWith(prefix))
      .map((uri) => ({
        uri,
        type: "file" as const,
      }));

    // Apply pattern filter if provided
    if (pattern) {
      items = items.filter((item) => item.uri.includes(pattern));
    }

    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "50");

    const result: ListResult = {
      success: true,
      data: items.slice((page - 1) * limit, page * limit),
      pagination: {
        page,
        limit,
        total: items.length,
      },
    };

    return Response.json(result);
  }

  private handleDelete(url: URL): Response {
    // Parse URI from path: /api/v1/delete/{protocol}/{domain}{path}
    const parts = url.pathname.split("/").slice(4); // Skip /api/v1/delete/
    const protocol = parts[0];
    const domain = parts[1];
    const path = "/" + parts.slice(2).join("/");
    const uri = `${protocol}://${domain}${path}`;

    const existed = this.storage.has(uri);

    if (!existed) {
      return new Response("Not found", { status: 404 });
    }

    this.storage.delete(uri);

    return Response.json({
      success: true,
    });
  }
}

/**
 * Create mock server instances for testing
 */
export async function createMockServers(): Promise<{
  happy: MockHttpServer;
  validationError: MockHttpServer;
  cleanup: () => Promise<void>;
}> {
  const sharedStorage = new Map<string, PersistenceRecord<unknown>>();

  const happy = new MockHttpServer({
    port: 8765,
    mode: "happy",
    storage: sharedStorage,
  });

  const validationError = new MockHttpServer({
    port: 8766,
    mode: "validationError",
  });

  await happy.start();
  await validationError.start();

  // Small delay to ensure servers are ready
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    happy,
    validationError,
    cleanup: async () => {
      await happy.stop();
      await validationError.stop();
    },
  };
}

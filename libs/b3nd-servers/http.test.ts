/**
 * HTTP Server Tests
 *
 * Tests for the httpServer function covering all API routes,
 * binary data handling, error conditions, and configuration modes.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { httpServer } from "./http.ts";
import type { MinimalContext, MinimalRouter } from "./http.ts";
import type { Message, NodeProtocolInterface } from "../b3nd-core/types.ts";

// ============================================================================
// Helpers: build a minimal in-memory router that httpServer can wire into
// ============================================================================

type Handler = (c: MinimalContext) => Promise<Response> | Response;

function createMockRouter(): MinimalRouter & {
  routes: Map<string, Handler>;
} {
  const routes = new Map<string, Handler>();

  function matchRoute(method: string, path: string): Handler | undefined {
    // Exact match first
    const exact = routes.get(`${method} ${path}`);
    if (exact) return exact;

    // Parameterized route matching
    for (const [pattern, handler] of routes) {
      const [m, p] = pattern.split(" ", 2);
      if (m !== method) continue;

      const patternParts = p.split("/");
      const pathParts = path.split("/");

      // Handle wildcard routes (e.g., /api/v1/read/:protocol/:domain/*)
      const hasWildcard = patternParts[patternParts.length - 1] === "*";
      if (
        !hasWildcard && patternParts.length !== pathParts.length
      ) continue;
      if (hasWildcard && pathParts.length < patternParts.length - 1) continue;

      let match = true;
      const params: Record<string, string> = {};
      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i] === "*") {
          // Collect remaining path
          params["*"] = pathParts.slice(i).join("/");
          break;
        }
        if (patternParts[i].startsWith(":")) {
          params[patternParts[i].slice(1)] = pathParts[i];
        } else if (patternParts[i] !== pathParts[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        // Return handler with params baked in
        return (c: MinimalContext) => {
          const origParam = c.req.param;
          c.req.param = (name: string) => params[name] ?? origParam(name);
          return handler(c);
        };
      }
    }
    return undefined;
  }

  const router: MinimalRouter & { routes: Map<string, Handler> } = {
    routes,
    get(path: string, handler: Handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path: string, handler: Handler) {
      routes.set(`POST ${path}`, handler);
    },
    delete(path: string, handler: Handler) {
      routes.set(`DELETE ${path}`, handler);
    },
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const method = req.method;
      const handler = matchRoute(method, url.pathname);
      if (!handler) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
        });
      }

      let bodyParsed: unknown = undefined;
      const c: MinimalContext = {
        req: {
          param: (_name: string) => "",
          query: (name: string) => url.searchParams.get(name) ?? undefined,
          header: (name: string) => req.headers.get(name) ?? undefined,
          url: req.url,
          arrayBuffer: () => req.arrayBuffer(),
          // deno-lint-ignore no-explicit-any
          json: async () => {
            if (bodyParsed === undefined) bodyParsed = await req.json();
            return bodyParsed;
          },
          // deno-lint-ignore no-explicit-any
        } as any,
        json: (body: unknown, status?: number) =>
          new Response(JSON.stringify(body), {
            status: status ?? 200,
            headers: { "Content-Type": "application/json" },
          }),
      };

      return handler(c) as Promise<Response>;
    },
  };
  return router;
}

// ============================================================================
// Mock client implementing NodeProtocolInterface
// ============================================================================

// deno-lint-ignore no-explicit-any
function createMockClient(overrides: any = {}): NodeProtocolInterface {
  return {
    receive: overrides.receive ?? (async ([uri, data]: Message) => ({
      accepted: true,
      uri,
      record: { ts: Date.now(), data },
    })),
    read: overrides.read ?? (async (_uri: string) => ({
      success: true,
      record: { ts: Date.now(), data: { hello: "world" } },
    })),
    readMulti: overrides.readMulti ?? (async (uris: string[]) => ({
      success: true,
      results: uris.map((uri) => ({
        uri,
        success: true as const,
        record: { ts: Date.now(), data: {} },
      })),
      summary: { total: uris.length, succeeded: uris.length, failed: 0 },
    })),
    list: overrides.list ?? (async (_uri: string) => ({
      success: true as const,
      data: [],
      pagination: { page: 1, limit: 50, total: 0 },
    })),
    delete: overrides.delete ?? (async (_uri: string) => ({
      success: true,
    })),
    health: overrides.health ?? (async () => ({
      status: "healthy" as const,
    })),
    getSchema: overrides.getSchema ?? (async () => ["mutable://test"]),
    cleanup: overrides.cleanup ?? (async () => {}),
  } as NodeProtocolInterface;
}

// ============================================================================
// Health endpoint
// ============================================================================

Deno.test("httpServer - GET /health returns healthy when client configured", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({ client: createMockClient() });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "healthy");
});

Deno.test("httpServer - GET /health returns unhealthy when not configured", async () => {
  const router = createMockRouter();
  const server = httpServer(router);

  const res = await server.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.status, "unhealthy");
});

Deno.test("httpServer - GET /health includes healthMeta", async () => {
  const router = createMockRouter();
  const server = httpServer(router, {
    healthMeta: { version: "1.0.0", nodeId: "abc" },
  });
  server.configure({ client: createMockClient() });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  const body = await res.json();
  assertEquals(body.version, "1.0.0");
  assertEquals(body.nodeId, "abc");
});

Deno.test("httpServer - GET /health returns 503 when client reports unhealthy", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      health: async () => ({ status: "unhealthy" as const }),
    }),
  });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 503);
});

// ============================================================================
// Schema endpoint
// ============================================================================

Deno.test("httpServer - GET /schema returns schema keys", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      getSchema: async () => ["mutable://users", "mutable://posts"],
    }),
  });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/schema"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.schema, ["mutable://users", "mutable://posts"]);
});

Deno.test("httpServer - GET /schema returns empty when not configured", async () => {
  const router = createMockRouter();
  const server = httpServer(router);

  const res = await server.fetch(
    new Request("http://localhost/api/v1/schema"),
  );
  const body = await res.json();
  assertEquals(body.schema, []);
});

// ============================================================================
// Receive endpoint
// ============================================================================

Deno.test("httpServer - POST /receive accepts valid message", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({ client: createMockClient() });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/key", { name: "Alice" }]),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.accepted, true);
});

Deno.test("httpServer - POST /receive rejects invalid format (not array)", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({ client: createMockClient() });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri: "mutable://test", data: {} }),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
  assertStringIncludes(body.error, "Invalid message format");
});

Deno.test("httpServer - POST /receive rejects when URI is missing", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({ client: createMockClient() });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([null, { name: "Alice" }]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertStringIncludes(body.error, "URI is required");
});

Deno.test("httpServer - POST /receive returns 501 when not configured", async () => {
  const router = createMockRouter();
  const server = httpServer(router);

  const res = await server.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/key", { name: "Alice" }]),
    }),
  );
  assertEquals(res.status, 501);
});

Deno.test("httpServer - POST /receive returns 400 when client rejects", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      receive: async () => ({ accepted: false, error: "Validation failed" }),
    }),
  });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/key", { invalid: true }]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
});

Deno.test("httpServer - POST /receive deserializes binary data", async () => {
  let receivedData: unknown;
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      receive: async ([uri, data]: Message) => {
        receivedData = data;
        return { accepted: true, uri, record: { ts: Date.now(), data } };
      },
    }),
  });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        "mutable://test/binary",
        { __b3nd_binary__: true, encoding: "base64", data: "AQID" }, // [1,2,3]
      ]),
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(receivedData instanceof Uint8Array, true);
  assertEquals(Array.from(receivedData as Uint8Array), [1, 2, 3]);
});

// ============================================================================
// Read endpoint
// ============================================================================

Deno.test("httpServer - GET /read returns JSON data", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      read: async () => ({
        success: true,
        record: { ts: 1000, data: { name: "Alice" } },
      }),
    }),
  });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/read/mutable/users/alice"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data, { name: "Alice" });
});

Deno.test("httpServer - GET /read returns 404 for missing record", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      read: async () => ({
        success: false,
        error: "Not found",
      }),
    }),
  });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/read/mutable/users/missing"),
  );
  assertEquals(res.status, 404);
});

Deno.test("httpServer - GET /read returns 501 when not configured", async () => {
  const router = createMockRouter();
  const server = httpServer(router);

  const res = await server.fetch(
    new Request("http://localhost/api/v1/read/mutable/users/alice"),
  );
  assertEquals(res.status, 501);
});

Deno.test("httpServer - GET /read returns binary data with correct MIME type", async () => {
  const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      read: async () => ({
        success: true,
        record: { ts: 1000, data: binaryData },
      }),
    }),
  });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/read/mutable/assets/logo.png"),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "image/png");
  assertEquals(res.headers.get("Content-Length"), "4");
  const buf = new Uint8Array(await res.arrayBuffer());
  assertEquals(Array.from(buf), [0x89, 0x50, 0x4E, 0x47]);
});

// ============================================================================
// List endpoint
// ============================================================================

Deno.test("httpServer - GET /list returns paginated results", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      list: async () => ({
        data: ["mutable://users/alice", "mutable://users/bob"],
        pagination: { page: 1, limit: 50, total: 2 },
      }),
    }),
  });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/list/mutable/users"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.length, 2);
  assertEquals(body.pagination.total, 2);
});

Deno.test("httpServer - GET /list passes query params", async () => {
  let capturedOpts: Record<string, unknown> = {};
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      // deno-lint-ignore no-explicit-any
      list: async (_uri: string, opts?: any) => {
        capturedOpts = opts || {};
        return {
          success: true as const,
          data: [],
          pagination: { page: 2, limit: 10, total: 15 },
        };
      },
    }),
  });

  const res = await server.fetch(
    new Request(
      "http://localhost/api/v1/list/mutable/users?page=2&limit=10&pattern=alice",
    ),
  );
  assertEquals(res.status, 200);
  assertEquals(capturedOpts.page, 2);
  assertEquals(capturedOpts.limit, 10);
  assertEquals(capturedOpts.pattern, "alice");
});

Deno.test("httpServer - GET /list returns empty when not configured", async () => {
  const router = createMockRouter();
  const server = httpServer(router);

  const res = await server.fetch(
    new Request("http://localhost/api/v1/list/mutable/users"),
  );
  const body = await res.json();
  assertEquals(body.data, []);
  assertEquals(body.pagination.total, 0);
});

// ============================================================================
// Delete endpoint
// ============================================================================

Deno.test("httpServer - DELETE /delete removes record", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      delete: async () => ({ success: true }),
    }),
  });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/delete/mutable/users/alice", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
});

Deno.test("httpServer - DELETE /delete returns 404 on failure", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({
    client: createMockClient({
      delete: async () => ({ success: false, error: "Not found" }),
    }),
  });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/delete/mutable/users/missing", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 404);
});

Deno.test("httpServer - DELETE /delete returns 501 when not configured", async () => {
  const router = createMockRouter();
  const server = httpServer(router);

  const res = await server.fetch(
    new Request("http://localhost/api/v1/delete/mutable/users/alice", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 501);
});

// ============================================================================
// MIME type detection
// ============================================================================

Deno.test("httpServer - returns correct MIME for various extensions", async () => {
  const cases: [string, string][] = [
    ["mutable/assets/style.css", "text/css"],
    ["mutable/assets/app.js", "application/javascript"],
    ["mutable/assets/photo.jpg", "image/jpeg"],
    ["mutable/assets/icon.svg", "image/svg+xml"],
    ["mutable/assets/data.json", "application/json"],
    ["mutable/assets/doc.pdf", "application/pdf"],
    ["mutable/assets/font.woff2", "font/woff2"],
    ["mutable/assets/unknown.xyz", "application/octet-stream"],
  ];

  for (const [path, expectedMime] of cases) {
    const router = createMockRouter();
    const server = httpServer(router);
    server.configure({
      client: createMockClient({
        read: async () => ({
          success: true,
          record: { ts: 1000, data: new Uint8Array([1]) },
        }),
      }),
    });

    const res = await server.fetch(
      new Request(`http://localhost/api/v1/read/${path}`),
    );
    assertEquals(
      res.headers.get("Content-Type"),
      expectedMime,
      `Expected ${expectedMime} for ${path}`,
    );
  }
});

// ============================================================================
// ServerFrontend.fetch() — direct fetch mode
// ============================================================================

Deno.test("httpServer - fetch() delegates to router", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  server.configure({ client: createMockClient() });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
});

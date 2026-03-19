/// <reference lib="deno.ns" />
/**
 * Tests for b3nd-servers HTTP module.
 *
 * Validates all API routes: health, schema, receive, read, list, delete.
 * Uses a mock MinimalRouter to test httpServer() without a real HTTP server.
 */

import {
  assertEquals,
  assertExists,
} from "@std/assert";
import { httpServer } from "./http.ts";
import type { MinimalContext, MinimalRequest, MinimalRouter } from "./http.ts";
import type {
  DeleteResult,
  HealthStatus,
  ListResult,
  Message,
  NodeProtocolInterface,
  ReceiveResult,
} from "../b3nd-core/types.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Minimal mock router that captures registered route handlers */
function createMockRouter(): MinimalRouter & {
  routes: Map<string, (c: MinimalContext) => Promise<Response> | Response>;
} {
  const routes = new Map<
    string,
    (c: MinimalContext) => Promise<Response> | Response
  >();
  return {
    routes,
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
    delete(path, handler) {
      routes.set(`DELETE ${path}`, handler);
    },
    async fetch(req: Request) {
      const url = new URL(req.url);
      const method = req.method;

      for (const [key, handler] of routes.entries()) {
        const [routeMethod, routePath] = key.split(" ", 2);
        if (routeMethod !== method) continue;

        const match = matchRoute(routePath, url.pathname);
        if (match) {
          const ctx = createMockContext(req, url, match.params);
          return await handler(ctx);
        }
      }
      return new Response("Not Found", { status: 404 });
    },
  };
}

/** Simple route matching with :param and * wildcard support */
function matchRoute(
  pattern: string,
  pathname: string,
): { params: Record<string, string> } | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp === "*") {
      // Wildcard: capture the rest
      params["path"] = pathParts.slice(i).join("/");
      params["*"] = pathParts.slice(i).join("/");
      return { params };
    }
    if (pp.startsWith(":")) {
      params[pp.slice(1)] = pathParts[i] || "";
      continue;
    }
    if (pp !== pathParts[i]) return null;
  }
  if (patternParts.length !== pathParts.length) return null;
  return { params };
}

/** Create a mock MinimalContext from a Request */
function createMockContext(
  req: Request,
  url: URL,
  params: Record<string, string>,
): MinimalContext {
  return {
    req: {
      param: (name: string) => params[name] || "",
      query: (name: string) => url.searchParams.get(name),
      header: (name: string) => req.headers.get(name),
      url: req.url,
      arrayBuffer: () => req.arrayBuffer(),
      json: () => req.json(),
    } as MinimalRequest & { json: () => Promise<unknown> },
    json: (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  };
}

// deno-lint-ignore no-explicit-any
type MockOverrides = Record<string, any>;

/** Create a mock NodeProtocolInterface */
function createMockClient(
  overrides: MockOverrides = {},
): NodeProtocolInterface {
  return {
    receive: overrides.receive ??
      (async (_msg: Message) => ({ accepted: true })),
    delete: overrides.delete ??
      (async (_uri: string) => ({ success: true })),
    health: overrides.health ??
      (async () => ({ status: "healthy" as const })),
    getSchema: overrides.getSchema ?? (async () => ["mutable://", "hash://"]),
    cleanup: overrides.cleanup ?? (async () => {}),
    read: overrides.read ??
      (async (_uri: string) => ({
        success: true,
        record: { ts: Date.now(), data: { hello: "world" } },
      })),
    readMulti: overrides.readMulti ??
      (async (_uris: string[]) => ({
        success: true,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      })),
    list: overrides.list ??
      (async (_uri: string) => ({
        success: true as const,
        data: [],
        pagination: { page: 1, limit: 50, total: 0 },
      })),
  } as NodeProtocolInterface;
}

/** Make a request through the mock router */
async function makeRequest(
  router: MinimalRouter,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<unknown> }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await router.fetch(
    new Request(`http://localhost${path}`, init),
  );
  return {
    status: res.status,
    json: () => res.json(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("httpServer — health endpoint returns healthy with client", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient();
  server.configure({ client });

  const res = await makeRequest(router, "GET", "/api/v1/health");
  assertEquals(res.status, 200);

  const body = (await res.json()) as HealthStatus;
  assertEquals(body.status, "healthy");
});

Deno.test("httpServer — health endpoint returns healthMeta", async () => {
  const router = createMockRouter();
  const server = httpServer(router, { healthMeta: { version: "1.0.0" } });
  const client = createMockClient();
  server.configure({ client });

  const res = await makeRequest(router, "GET", "/api/v1/health");
  assertEquals(res.status, 200);

  const body = (await res.json()) as Record<string, unknown>;
  assertEquals(body.status, "healthy");
  assertEquals(body.version, "1.0.0");
});

Deno.test("httpServer — health returns 503 when unhealthy", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient({
    health: async () => ({ status: "unhealthy", message: "db down" }),
  });
  server.configure({ client });

  const res = await makeRequest(router, "GET", "/api/v1/health");
  assertEquals(res.status, 503);

  const body = (await res.json()) as HealthStatus;
  assertEquals(body.status, "unhealthy");
  assertEquals(body.message, "db down");
});

Deno.test("httpServer — health returns 503 when no backend attached", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await makeRequest(router, "GET", "/api/v1/health");
  assertEquals(res.status, 503);

  const body = (await res.json()) as Record<string, unknown>;
  assertEquals(body.status, "unhealthy");
});

Deno.test("httpServer — schema endpoint returns schema keys", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient({
    getSchema: async () => ["mutable://", "immutable://", "hash://"],
  });
  server.configure({ client });

  const res = await makeRequest(router, "GET", "/api/v1/schema");
  assertEquals(res.status, 200);

  const body = (await res.json()) as { schema: string[] };
  assertEquals(body.schema, ["mutable://", "immutable://", "hash://"]);
});

Deno.test("httpServer — schema returns empty when no backend", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await makeRequest(router, "GET", "/api/v1/schema");
  assertEquals(res.status, 200);

  const body = (await res.json()) as { schema: string[] };
  assertEquals(body.schema, []);
});

Deno.test("httpServer — receive accepts valid message", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const received: Message[] = [];
  const client = createMockClient({
    receive: async (msg: Message) => {
      received.push(msg);
      return { accepted: true };
    },
  });
  server.configure({ client });

  const res = await makeRequest(router, "POST", "/api/v1/receive", [
    "mutable://test/data",
    { value: 42 },
  ]);
  assertEquals(res.status, 200);

  const body = (await res.json()) as ReceiveResult;
  assertEquals(body.accepted, true);
  assertEquals(received.length, 1);
  assertEquals(received[0][0], "mutable://test/data");
  assertEquals((received[0][1] as Record<string, unknown>).value, 42);
});

Deno.test("httpServer — receive rejects invalid message format", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient();
  server.configure({ client });

  // Not an array
  const res1 = await makeRequest(router, "POST", "/api/v1/receive", {
    bad: true,
  });
  assertEquals(res1.status, 400);
  const body1 = (await res1.json()) as { accepted: boolean; error: string };
  assertEquals(body1.accepted, false);

  // Array with only one element
  const res2 = await makeRequest(router, "POST", "/api/v1/receive", [
    "mutable://x",
  ]);
  assertEquals(res2.status, 400);
});

Deno.test("httpServer — receive rejects when URI is not a string", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient();
  server.configure({ client });

  const res = await makeRequest(router, "POST", "/api/v1/receive", [
    123,
    { data: true },
  ]);
  assertEquals(res.status, 400);
  const body = (await res.json()) as { accepted: boolean; error: string };
  assertEquals(body.accepted, false);
  assertExists(body.error);
});

Deno.test("httpServer — receive returns 400 on validation rejection", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient({
    receive: async () => ({ accepted: false, error: "Invalid data" }),
  });
  server.configure({ client });

  const res = await makeRequest(router, "POST", "/api/v1/receive", [
    "mutable://test",
    { bad: true },
  ]);
  assertEquals(res.status, 400);

  const body = (await res.json()) as ReceiveResult;
  assertEquals(body.accepted, false);
  assertEquals(body.error, "Invalid data");
});

Deno.test("httpServer — receive returns 501 when no handler attached", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await makeRequest(router, "POST", "/api/v1/receive", [
    "mutable://test",
    {},
  ]);
  assertEquals(res.status, 501);
});

Deno.test("httpServer — receive deserializes base64 binary data", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const received: Message[] = [];
  const client = createMockClient({
    receive: async (msg: Message) => {
      received.push(msg);
      return { accepted: true };
    },
  });
  server.configure({ client });

  // Send base64-wrapped binary
  const res = await makeRequest(router, "POST", "/api/v1/receive", [
    "hash://content/abc123",
    { __b3nd_binary__: true, encoding: "base64", data: "AQID" }, // [1, 2, 3]
  ]);
  assertEquals(res.status, 200);

  assertEquals(received.length, 1);
  const data = received[0][1];
  assertEquals(data instanceof Uint8Array, true);
  assertEquals(Array.from(data as Uint8Array), [1, 2, 3]);
});

Deno.test("httpServer — read endpoint returns JSON record", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient({
    read: (async (uri: string) => ({
      success: true,
      record: { ts: 1000, data: { key: uri } },
    })) as NodeProtocolInterface["read"],
  });
  server.configure({ client });

  const res = await makeRequest(
    router,
    "GET",
    "/api/v1/read/mutable/test/some/path",
  );
  assertEquals(res.status, 200);

  const body = (await res.json()) as { ts: number; data: unknown };
  assertEquals(body.ts, 1000);
  assertEquals((body.data as Record<string, string>).key, "mutable://test/some/path");
});

Deno.test("httpServer — read returns 404 when not found", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient({
    read: async () => ({ success: false, error: "Not found" }),
  });
  server.configure({ client });

  const res = await makeRequest(
    router,
    "GET",
    "/api/v1/read/mutable/test/missing",
  );
  assertEquals(res.status, 404);
});

Deno.test("httpServer — read returns 501 when no handler", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await makeRequest(
    router,
    "GET",
    "/api/v1/read/mutable/test/data",
  );
  assertEquals(res.status, 501);
});

Deno.test("httpServer — read returns raw bytes for Uint8Array data", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
  const client = createMockClient({
    read: (async () => ({
      success: true,
      record: { ts: 1000, data: binaryData },
    })) as NodeProtocolInterface["read"],
  });
  server.configure({ client });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/read/hash/content/image.png"),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "image/png");
  assertEquals(res.headers.get("Content-Length"), "4");

  const bytes = new Uint8Array(await res.arrayBuffer());
  assertEquals(Array.from(bytes), [0x89, 0x50, 0x4e, 0x47]);
});

Deno.test("httpServer — list endpoint returns items", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient({
    list: async () => ({
      success: true as const,
      data: [{ uri: "mutable://test/a" }, { uri: "mutable://test/b" }],
      pagination: { page: 1, limit: 50, total: 2 },
    }),
  });
  server.configure({ client });

  const res = await makeRequest(
    router,
    "GET",
    "/api/v1/list/mutable/test/items",
  );
  assertEquals(res.status, 200);

  const body = (await res.json()) as ListResult;
  assertEquals(body.success, true);
  if (body.success) {
    assertEquals(body.data.length, 2);
    assertEquals(body.pagination.total, 2);
  }
});

Deno.test("httpServer — list passes query params", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  let capturedOptions: Record<string, unknown> = {};
  const client = createMockClient({
    list: async (_uri: string, options?: Record<string, unknown>) => {
      capturedOptions = options || {};
      return {
        success: true as const,
        data: [],
        pagination: { page: 2, limit: 10, total: 0 },
      };
    },
  });
  server.configure({ client });

  await makeRequest(
    router,
    "GET",
    "/api/v1/list/mutable/test/items?page=2&limit=10&sortBy=timestamp&sortOrder=desc",
  );

  assertEquals(capturedOptions.page, 2);
  assertEquals(capturedOptions.limit, 10);
  assertEquals(capturedOptions.sortBy, "timestamp");
  assertEquals(capturedOptions.sortOrder, "desc");
});

Deno.test("httpServer — list returns empty when no handler", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await makeRequest(
    router,
    "GET",
    "/api/v1/list/mutable/test/items",
  );
  assertEquals(res.status, 200);

  const body = (await res.json()) as { data: unknown[]; pagination: unknown };
  assertEquals(body.data, []);
});

Deno.test("httpServer — delete endpoint succeeds", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  let deletedUri = "";
  const client = createMockClient({
    delete: async (uri: string) => {
      deletedUri = uri;
      return { success: true };
    },
  });
  server.configure({ client });

  const res = await makeRequest(
    router,
    "DELETE",
    "/api/v1/delete/mutable/test/some/resource",
  );
  assertEquals(res.status, 200);

  const body = (await res.json()) as DeleteResult;
  assertEquals(body.success, true);
  assertEquals(deletedUri, "mutable://test/some/resource");
});

Deno.test("httpServer — delete returns 404 on failure", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient({
    delete: async () => ({ success: false, error: "Not found" }),
  });
  server.configure({ client });

  const res = await makeRequest(
    router,
    "DELETE",
    "/api/v1/delete/mutable/test/missing",
  );
  assertEquals(res.status, 404);
});

Deno.test("httpServer — delete returns 501 when no handler", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await makeRequest(
    router,
    "DELETE",
    "/api/v1/delete/mutable/test/data",
  );
  assertEquals(res.status, 501);
});

Deno.test("httpServer — configure with legacy backend + schema", async () => {
  const router = createMockRouter();
  const server = httpServer(router);

  const mockSchema = {
    "mutable://test": async () => ({ valid: true }),
  };

  const mockBackend = {
    write: {
      receive: async (msg: Message) => ({ accepted: true }),
      delete: async () => ({ success: true }),
      health: async () => ({ status: "healthy" as const }),
      getSchema: async () => ["mutable://test"],
      cleanup: async () => {},
    },
    read: {
      read: async (uri: string) => ({
        success: true,
        record: { ts: 1000, data: { from: "backend" } },
      }),
      readMulti: async () => ({
        success: true,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      }),
      list: async () => ({
        success: true as const,
        data: [],
        pagination: { page: 1, limit: 50, total: 0 },
      }),
      health: async () => ({ status: "healthy" as const }),
      getSchema: async () => ["mutable://test"],
      cleanup: async () => {},
    },
  };

  // deno-lint-ignore no-explicit-any
  server.configure({ backend: mockBackend, schema: mockSchema } as any);

  // Health should work via legacy backend
  const healthRes = await makeRequest(router, "GET", "/api/v1/health");
  assertEquals(healthRes.status, 200);

  // Schema should work
  const schemaRes = await makeRequest(router, "GET", "/api/v1/schema");
  const schemaBody = (await schemaRes.json()) as { schema: string[] };
  assertEquals(schemaBody.schema, ["mutable://test"]);

  // Read should work via legacy backend
  const readRes = await makeRequest(
    router,
    "GET",
    "/api/v1/read/mutable/test/data",
  );
  assertEquals(readRes.status, 200);
});

Deno.test("httpServer — receive with legacy backend validates schema", async () => {
  const router = createMockRouter();
  const server = httpServer(router);

  let validatorCalled = false;
  const mockSchema = {
    "mutable://test": async (write: { uri: string; value: unknown }) => {
      validatorCalled = true;
      return { valid: true };
    },
  };

  const mockBackend = {
    write: {
      receive: async (msg: Message) => ({ accepted: true }),
      delete: async () => ({ success: true }),
      health: async () => ({ status: "healthy" as const }),
      getSchema: async () => ["mutable://test"],
      cleanup: async () => {},
    },
    read: {
      read: async () => ({ success: false }),
      readMulti: async () => ({
        success: true,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      }),
      list: async () => ({
        success: true as const,
        data: [],
        pagination: { page: 1, limit: 50, total: 0 },
      }),
      health: async () => ({ status: "healthy" as const }),
      getSchema: async () => ["mutable://test"],
      cleanup: async () => {},
    },
  };

  // deno-lint-ignore no-explicit-any
  server.configure({ backend: mockBackend, schema: mockSchema } as any);

  const res = await makeRequest(router, "POST", "/api/v1/receive", [
    "mutable://test/item",
    { value: 1 },
  ]);
  assertEquals(res.status, 200);
  assertEquals(validatorCalled, true);
});

Deno.test("httpServer — receive with legacy backend rejects unknown program key", async () => {
  const router = createMockRouter();
  const server = httpServer(router);

  const mockSchema = {
    "mutable://known": async () => ({ valid: true }),
  };

  const mockBackend = {
    write: {
      receive: async () => ({ accepted: true }),
      delete: async () => ({ success: true }),
      health: async () => ({ status: "healthy" as const }),
      getSchema: async () => [],
      cleanup: async () => {},
    },
    read: {
      read: async () => ({ success: false }),
      readMulti: async () => ({
        success: true,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      }),
      list: async () => ({
        success: true as const,
        data: [],
        pagination: { page: 1, limit: 50, total: 0 },
      }),
      health: async () => ({ status: "healthy" as const }),
      getSchema: async () => [],
      cleanup: async () => {},
    },
  };

  // deno-lint-ignore no-explicit-any
  server.configure({ backend: mockBackend, schema: mockSchema } as any);

  const res = await makeRequest(router, "POST", "/api/v1/receive", [
    "mutable://unknown/item",
    {},
  ]);
  assertEquals(res.status, 400);
  const body = (await res.json()) as { accepted: boolean; error: string };
  assertEquals(body.accepted, false);
  assertExists(body.error);
});

Deno.test("httpServer — receive with legacy backend rejects invalid data", async () => {
  const router = createMockRouter();
  const server = httpServer(router);

  const mockSchema = {
    "mutable://test": async () => ({
      valid: false,
      error: "data must have a name field",
    }),
  };

  const mockBackend = {
    write: {
      receive: async () => ({ accepted: true }),
      delete: async () => ({ success: true }),
      health: async () => ({ status: "healthy" as const }),
      getSchema: async () => [],
      cleanup: async () => {},
    },
    read: {
      read: async () => ({ success: false }),
      readMulti: async () => ({
        success: true,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      }),
      list: async () => ({
        success: true as const,
        data: [],
        pagination: { page: 1, limit: 50, total: 0 },
      }),
      health: async () => ({ status: "healthy" as const }),
      getSchema: async () => [],
      cleanup: async () => {},
    },
  };

  // deno-lint-ignore no-explicit-any
  server.configure({ backend: mockBackend, schema: mockSchema } as any);

  const res = await makeRequest(router, "POST", "/api/v1/receive", [
    "mutable://test/item",
    { bad: true },
  ]);
  assertEquals(res.status, 400);
  const body = (await res.json()) as { accepted: boolean; error: string };
  assertEquals(body.accepted, false);
  assertEquals(body.error, "data must have a name field");
});

Deno.test("httpServer — fetch method delegates to router", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const client = createMockClient();
  server.configure({ client });

  // Use server.fetch directly
  const res = await server.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
});

Deno.test("httpServer — MIME types for binary read responses", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const binaryData = new Uint8Array([1, 2, 3]);
  const client = createMockClient({
    read: (async () => ({
      success: true,
      record: { ts: 1000, data: binaryData },
    })) as NodeProtocolInterface["read"],
  });
  server.configure({ client });

  // Test various MIME types
  const cases = [
    { ext: "json", mime: "application/json" },
    { ext: "html", mime: "text/html" },
    { ext: "css", mime: "text/css" },
    { ext: "js", mime: "application/javascript" },
    { ext: "svg", mime: "image/svg+xml" },
    { ext: "wasm", mime: "application/wasm" },
    { ext: "pdf", mime: "application/pdf" },
    { ext: "woff2", mime: "font/woff2" },
  ];

  for (const { ext, mime } of cases) {
    const res = await router.fetch(
      new Request(`http://localhost/api/v1/read/hash/content/file.${ext}`),
    );
    assertEquals(
      res.headers.get("Content-Type"),
      mime,
      `Expected ${mime} for .${ext}`,
    );
  }
});

Deno.test("httpServer — unknown file extension returns octet-stream", async () => {
  const router = createMockRouter();
  const server = httpServer(router);
  const binaryData = new Uint8Array([1]);
  const client = createMockClient({
    read: (async () => ({
      success: true,
      record: { ts: 1000, data: binaryData },
    })) as NodeProtocolInterface["read"],
  });
  server.configure({ client });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/read/hash/content/file.xyz"),
  );
  assertEquals(res.headers.get("Content-Type"), "application/octet-stream");
});

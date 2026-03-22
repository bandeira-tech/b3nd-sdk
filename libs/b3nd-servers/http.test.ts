/**
 * HTTP Server Tests
 *
 * Tests for the httpServer() function: route handling, request parsing,
 * response serialization, binary content serving, and error paths.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert@1/equals";
import { assert } from "jsr:@std/assert@1/assert";
import { httpServer } from "./http.ts";
import type { MinimalContext, MinimalRouter } from "./http.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";
import { createServerNode } from "./node.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Hono-like router backed by a simple route table */
function createMockRouter(): MinimalRouter {
  const getRoutes = new Map<
    string,
    (c: MinimalContext) => Promise<Response> | Response
  >();
  const postRoutes = new Map<
    string,
    (c: MinimalContext) => Promise<Response> | Response
  >();
  const deleteRoutes = new Map<
    string,
    (c: MinimalContext) => Promise<Response> | Response
  >();

  function matchRoute(
    routes: Map<string, (c: MinimalContext) => Promise<Response> | Response>,
    path: string,
  ): {
    handler: (c: MinimalContext) => Promise<Response> | Response;
    params: Record<string, string>;
  } | null {
    for (const [pattern, handler] of routes) {
      const params = matchPattern(pattern, path);
      if (params !== null) {
        return { handler, params };
      }
    }
    return null;
  }

  /** Simple pattern matcher for Express-like :param and * wildcard routes */
  function matchPattern(
    pattern: string,
    path: string,
  ): Record<string, string> | null {
    const patternParts = pattern.split("/");
    const pathParts = path.split("/");
    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i];
      if (pp === "*") {
        params["*"] = pathParts.slice(i).join("/");
        return params;
      }
      if (pp.startsWith(":")) {
        params[pp.slice(1)] = pathParts[i] || "";
      } else if (pp !== pathParts[i]) {
        return null;
      }
    }

    // Exact length match (unless pattern ended with *)
    if (patternParts.length !== pathParts.length) return null;
    return params;
  }

  function buildContext(
    req: Request,
    params: Record<string, string>,
  ): MinimalContext {
    const url = new URL(req.url);
    return {
      req: {
        param: (name: string) => params[name] || "",
        query: (name: string) => url.searchParams.get(name),
        header: (name: string) => req.headers.get(name),
        url: req.url,
        arrayBuffer: () => req.arrayBuffer(),
        json: () => req.json(),
      } as any,
      json: (body: unknown, status?: number) =>
        new Response(JSON.stringify(body), {
          status: status ?? 200,
          headers: { "Content-Type": "application/json" },
        }),
    };
  }

  return {
    get(path, handler) {
      getRoutes.set(path, handler);
    },
    post(path, handler) {
      postRoutes.set(path, handler);
    },
    delete(path, handler) {
      deleteRoutes.set(path, handler);
    },
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const routeMap = req.method === "GET"
        ? getRoutes
        : req.method === "POST"
        ? postRoutes
        : req.method === "DELETE"
        ? deleteRoutes
        : null;
      if (!routeMap) return new Response("Method not allowed", { status: 405 });

      const match = matchRoute(routeMap, url.pathname);
      if (!match) return new Response("Not found", { status: 404 });
      return await match.handler(buildContext(req, match.params));
    },
  };
}

/** Create a configured server backed by MemoryClient */
function createTestServer(schema?: Record<string, any>) {
  const client = new MemoryClient({
    schema: schema ?? { "mutable://test": async () => ({ valid: true }) },
  });
  const app = createMockRouter();
  const frontend = httpServer(app);
  createServerNode({ frontend, client });
  return { client, app, frontend };
}

// ---------------------------------------------------------------------------
// Health endpoint
// ---------------------------------------------------------------------------

Deno.test("httpServer — /health returns healthy when backend configured", async () => {
  const { app } = createTestServer();
  const res = await app.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "healthy");
});

Deno.test("httpServer — /health includes healthMeta options", async () => {
  const client = new MemoryClient({
    schema: { "mutable://test": async () => ({ valid: true }) },
  });
  const app = createMockRouter();
  const frontend = httpServer(app, { healthMeta: { version: "1.0.0" } });
  createServerNode({ frontend, client });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.version, "1.0.0");
  assertEquals(body.status, "healthy");
});

Deno.test("httpServer — /health returns 503 when not configured", async () => {
  const app = createMockRouter();
  httpServer(app); // no configure call
  const res = await app.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.status, "unhealthy");
});

// ---------------------------------------------------------------------------
// Schema endpoint
// ---------------------------------------------------------------------------

Deno.test("httpServer — /schema returns registered program keys", async () => {
  const { app } = createTestServer({
    "mutable://users": async () => ({ valid: true }),
    "mutable://posts": async () => ({ valid: true }),
  });
  const res = await app.fetch(
    new Request("http://localhost/api/v1/schema"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(Array.isArray(body.schema));
  assert(body.schema.includes("mutable://users"));
  assert(body.schema.includes("mutable://posts"));
});

Deno.test("httpServer — /schema returns empty when not configured", async () => {
  const app = createMockRouter();
  httpServer(app); // no configure call
  const res = await app.fetch(
    new Request("http://localhost/api/v1/schema"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.schema, []);
});

// ---------------------------------------------------------------------------
// Receive endpoint
// ---------------------------------------------------------------------------

Deno.test("httpServer — /receive accepts valid message", async () => {
  const { app } = createTestServer();
  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/hello", { greeting: "world" }]),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.accepted, true);
});

Deno.test("httpServer — /receive rejects invalid message format", async () => {
  const { app } = createTestServer();
  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ not: "an array" }),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
  assert(body.error?.includes("Invalid message format"));
});

Deno.test("httpServer — /receive rejects empty array", async () => {
  const { app } = createTestServer();
  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
});

Deno.test("httpServer — /receive rejects null URI", async () => {
  const { app } = createTestServer();
  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([null, { data: "test" }]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
  assert(body.error?.includes("URI is required"));
});

Deno.test("httpServer — /receive handles schema validation rejection", async () => {
  const { app } = createTestServer({
    "mutable://strict": async () => ({
      valid: false,
      error: "Data must have name field",
    }),
  });
  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://strict/item", { bad: true }]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
  assert(body.error?.includes("name field"));
});

Deno.test("httpServer — /receive deserializes binary data from base64 wrapper", async () => {
  const { app, client } = createTestServer();
  const binaryPayload = {
    __b3nd_binary__: true,
    encoding: "base64",
    data: "AQID", // [1, 2, 3] in base64
  };
  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/bin", binaryPayload]),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.accepted, true);

  // Verify the stored data is a Uint8Array
  const readResult = await client.read("mutable://test/bin");
  assert(readResult.success);
  assert(readResult.record?.data instanceof Uint8Array);
  assertEquals(Array.from(readResult.record.data as Uint8Array), [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// Read endpoint
// ---------------------------------------------------------------------------

Deno.test("httpServer — /read returns stored JSON record", async () => {
  const { app, client } = createTestServer();
  await client.receive(["mutable://test/doc", { title: "hello" }]);

  const res = await app.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/doc"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.title, "hello");
  assert(typeof body.ts === "number");
});

Deno.test("httpServer — /read returns 404 for missing URI", async () => {
  const { app } = createTestServer();
  const res = await app.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/nonexistent"),
  );
  assertEquals(res.status, 404);
});

Deno.test("httpServer — /read returns binary with correct MIME type", async () => {
  const { app, client } = createTestServer();
  const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
  await client.receive(["mutable://test/image.png", imageBytes]);

  const res = await app.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/image.png"),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "image/png");
  assertEquals(res.headers.get("Content-Length"), "4");
  const arrayBuf = await res.arrayBuffer();
  assertEquals(new Uint8Array(arrayBuf), imageBytes);
});

Deno.test("httpServer — /read returns 501 when not configured", async () => {
  const app = createMockRouter();
  httpServer(app);
  const res = await app.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/doc"),
  );
  assertEquals(res.status, 501);
});

// ---------------------------------------------------------------------------
// List endpoint
// ---------------------------------------------------------------------------

Deno.test("httpServer — /list returns stored URIs", async () => {
  const { app, client } = createTestServer();
  await client.receive(["mutable://test/a", { v: 1 }]);
  await client.receive(["mutable://test/b", { v: 2 }]);
  await client.receive(["mutable://test/c", { v: 3 }]);

  const res = await app.fetch(
    new Request("http://localhost/api/v1/list/mutable/test"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(body.data?.length >= 3);
});

Deno.test("httpServer — /list supports pagination query params", async () => {
  const { app, client } = createTestServer();
  for (let i = 0; i < 5; i++) {
    await client.receive([`mutable://test/item${i}`, { i }]);
  }

  const res = await app.fetch(
    new Request(
      "http://localhost/api/v1/list/mutable/test?page=1&limit=2",
    ),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data?.length, 2);
  assertEquals(body.pagination?.limit, 2);
  assertEquals(body.pagination?.page, 1);
});

Deno.test("httpServer — /list returns empty array when not configured", async () => {
  const app = createMockRouter();
  httpServer(app);
  const res = await app.fetch(
    new Request("http://localhost/api/v1/list/mutable/test"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(Array.isArray(body.data));
  assertEquals(body.data.length, 0);
});

// ---------------------------------------------------------------------------
// Delete endpoint
// ---------------------------------------------------------------------------

Deno.test("httpServer — /delete removes stored record", async () => {
  const { app, client } = createTestServer();
  await client.receive(["mutable://test/del", { v: "bye" }]);

  // Verify it exists
  const readBefore = await client.read("mutable://test/del");
  assert(readBefore.success);

  const res = await app.fetch(
    new Request("http://localhost/api/v1/delete/mutable/test/del", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);

  // Verify it's gone
  const readAfter = await client.read("mutable://test/del");
  assertEquals(readAfter.success, false);
});

Deno.test("httpServer — /delete returns 404 for missing URI", async () => {
  const { app } = createTestServer();
  const res = await app.fetch(
    new Request("http://localhost/api/v1/delete/mutable/test/nope", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 404);
});

Deno.test("httpServer — /delete returns 501 when not configured", async () => {
  const app = createMockRouter();
  httpServer(app);
  const res = await app.fetch(
    new Request("http://localhost/api/v1/delete/mutable/test/x", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 501);
});

// ---------------------------------------------------------------------------
// createServerNode
// ---------------------------------------------------------------------------

Deno.test("createServerNode — throws if no frontend", () => {
  let threw = false;
  try {
    createServerNode(null as any);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("createServerNode — client path wires correctly", async () => {
  const client = new MemoryClient({
    schema: { "mutable://test": async () => ({ valid: true }) },
  });
  const app = createMockRouter();
  const frontend = httpServer(app);
  const { serverHandler } = createServerNode({ frontend, client });

  // Write via HTTP, read via client
  const res = await serverHandler(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/via-handler", { ok: true }]),
    }),
  );
  assertEquals(res.status, 200);

  const readResult = await client.read("mutable://test/via-handler");
  assert(readResult.success);
  assertEquals((readResult.record?.data as any).ok, true);
});

// ---------------------------------------------------------------------------
// MIME type detection
// ---------------------------------------------------------------------------

Deno.test("httpServer — serves correct MIME types for common extensions", async () => {
  const { app, client } = createTestServer();
  const bytes = new Uint8Array([0]);

  const cases: [string, string][] = [
    ["mutable://test/style.css", "text/css"],
    ["mutable://test/app.js", "application/javascript"],
    ["mutable://test/data.json", "application/json"],
    ["mutable://test/photo.jpg", "image/jpeg"],
    ["mutable://test/icon.svg", "image/svg+xml"],
    ["mutable://test/font.woff2", "font/woff2"],
    ["mutable://test/doc.pdf", "application/pdf"],
  ];

  for (const [uri, expectedMime] of cases) {
    await client.receive([uri, bytes]);
    const path = uri.replace("mutable://", "mutable/");
    const res = await app.fetch(
      new Request(`http://localhost/api/v1/read/${path}`),
    );
    assertEquals(
      res.headers.get("Content-Type"),
      expectedMime,
      `Expected ${expectedMime} for ${uri}`,
    );
  }
});

Deno.test("httpServer — falls back to application/octet-stream for unknown extension", async () => {
  const { app, client } = createTestServer();
  await client.receive(["mutable://test/file.xyz", new Uint8Array([0])]);
  const res = await app.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/file.xyz"),
  );
  assertEquals(res.headers.get("Content-Type"), "application/octet-stream");
});

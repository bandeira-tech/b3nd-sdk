import { assertEquals } from "@std/assert";
import { httpServer } from "./http.ts";
import type { MinimalContext, MinimalRequest, MinimalRouter } from "./http.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";

// ============================================================================
// Helpers
// ============================================================================

/** Minimal in-memory router matching the MinimalRouter interface */
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

      for (const [key, handler] of routes) {
        const [routeMethod, routePath] = key.split(" ", 2);
        if (routeMethod !== method) continue;

        const match = matchRoute(routePath, url.pathname);
        if (match) {
          const ctx = createContext(req, url, match.params);
          return await handler(ctx);
        }
      }
      return new Response("Not Found", { status: 404 });
    },
  };
}

/** Simple route pattern matcher supporting :param and wildcard * */
function matchRoute(
  pattern: string,
  pathname: string,
): { params: Record<string, string> } | null {
  // Convert pattern to regex
  const parts = pattern.split("/");
  const pathParts = pathname.split("/");

  const params: Record<string, string> = {};
  let i = 0;
  for (; i < parts.length; i++) {
    const part = parts[i];
    if (part === "*") {
      params["*"] = pathParts.slice(i).join("/");
      return { params };
    }
    if (part.startsWith(":")) {
      const name = part.slice(1);
      if (i >= pathParts.length) return null;
      params[name] = pathParts[i];
    } else {
      if (pathParts[i] !== part) return null;
    }
  }
  // If pattern consumed but path has more parts, capture as wildcard
  if (i < pathParts.length && parts[parts.length - 1] === "*") {
    return { params };
  }
  if (i < pathParts.length) {
    // Check if the route expects a wildcard at the end
    params["*"] = pathParts.slice(i).join("/");
    return { params };
  }
  return { params };
}

/** Create a MinimalContext from a Request */
function createContext(
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
      json: async () => {
        const text = await req.text();
        return JSON.parse(text);
      },
    } as unknown as MinimalRequest,
    json: (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  };
}

function createTestSchema() {
  return {
    "mutable://test": () => Promise.resolve({ valid: true }),
  };
}

// deno-lint-ignore no-explicit-any
function jsonBody(res: Response): Promise<Record<string, any>> {
  return res.json();
}

// ============================================================================
// httpServer - route registration
// ============================================================================

Deno.test("httpServer - registers all expected routes", () => {
  const router = createMockRouter();
  httpServer(router);

  const routeKeys = [...router.routes.keys()];
  assertEquals(routeKeys.includes("GET /api/v1/health"), true);
  assertEquals(routeKeys.includes("GET /api/v1/schema"), true);
  assertEquals(routeKeys.includes("POST /api/v1/receive"), true);
  assertEquals(
    routeKeys.includes("GET /api/v1/read/:protocol/:domain/*"),
    true,
  );
  assertEquals(
    routeKeys.includes("GET /api/v1/list/:protocol/:domain/*"),
    true,
  );
  assertEquals(
    routeKeys.includes("DELETE /api/v1/delete/:protocol/:domain/*"),
    true,
  );
});

// ============================================================================
// httpServer - configure
// ============================================================================

Deno.test("httpServer - configure with client", () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });

  // Should not throw
  frontend.configure({ client });
});

Deno.test("httpServer - configure with backend + schema", () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });

  // Use the client as both read and write backend
  frontend.configure({
    backend: { write: client, read: client },
    schema,
  });
});

// ============================================================================
// GET /api/v1/health
// ============================================================================

Deno.test("health - returns healthy when client configured", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
  const body = await jsonBody(res);
  assertEquals(body.status, "healthy");
});

Deno.test("health - merges healthMeta", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router, {
    healthMeta: { version: "1.0.0", nodeId: "test-node" },
  });
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  const body = await jsonBody(res);
  assertEquals(body.version, "1.0.0");
  assertEquals(body.nodeId, "test-node");
});

Deno.test("health - returns 503 when no backend attached", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await router.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 503);
  const body = await jsonBody(res);
  assertEquals(body.status, "unhealthy");
  assertEquals(body.message, "handler not attached");
});

// ============================================================================
// GET /api/v1/schema
// ============================================================================

Deno.test("schema - returns schema keys from client", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/schema"),
  );
  assertEquals(res.status, 200);
  const body = await jsonBody(res);
  assertEquals(body.schema, ["mutable://test"]);
});

Deno.test("schema - returns empty array when no backend", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await router.fetch(
    new Request("http://localhost/api/v1/schema"),
  );
  const body = await jsonBody(res);
  assertEquals(body.schema, []);
});

// ============================================================================
// POST /api/v1/receive
// ============================================================================

Deno.test("receive - accepts valid message via client", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/item1", { name: "hello" }]),
    }),
  );
  assertEquals(res.status, 200);
  const body = await jsonBody(res);
  assertEquals(body.accepted, true);
});

Deno.test("receive - rejects invalid message format", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invalid: true }),
    }),
  );
  assertEquals(res.status, 400);
  const body = await jsonBody(res);
  assertEquals(body.accepted, false);
});

Deno.test("receive - rejects empty URI", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["", { data: "test" }]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await jsonBody(res);
  assertEquals(body.accepted, false);
});

Deno.test("receive - returns 501 when no handler attached", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/item", { data: "test" }]),
    }),
  );
  assertEquals(res.status, 501);
  const body = await jsonBody(res);
  assertEquals(body.accepted, false);
});

Deno.test("receive - deserializes binary data from base64", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  // Send binary data encoded as base64 marker
  const res = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        "mutable://test/binary",
        { __b3nd_binary__: true, encoding: "base64", data: "AQID" },
      ]),
    }),
  );
  assertEquals(res.status, 200);
  const body = await jsonBody(res);
  assertEquals(body.accepted, true);
});

// ============================================================================
// GET /api/v1/read/:protocol/:domain/*
// ============================================================================

Deno.test("read - returns stored data", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  // Write data first
  await client.receive(["mutable://test/item1", { name: "alice" }]);

  const res = await router.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/item1"),
  );
  assertEquals(res.status, 200);
  const body = await jsonBody(res);
  assertEquals(body.data.name, "alice");
});

Deno.test("read - returns 404 for missing data", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/nonexistent"),
  );
  assertEquals(res.status, 404);
});

Deno.test("read - returns 501 when no handler attached", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await router.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/item"),
  );
  assertEquals(res.status, 501);
});

// ============================================================================
// GET /api/v1/list/:protocol/:domain/*
// ============================================================================

Deno.test("list - returns items at prefix", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  await client.receive(["mutable://test/a", { v: 1 }]);
  await client.receive(["mutable://test/b", { v: 2 }]);

  const res = await router.fetch(
    new Request("http://localhost/api/v1/list/mutable/test"),
  );
  assertEquals(res.status, 200);
  const body = await jsonBody(res);
  assertEquals(body.data.length, 2);
});

Deno.test("list - returns empty when no handler attached", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await router.fetch(
    new Request("http://localhost/api/v1/list/mutable/test"),
  );
  const body = await jsonBody(res);
  assertEquals(body.data, []);
  assertEquals(body.pagination.total, 0);
});

// ============================================================================
// DELETE /api/v1/delete/:protocol/:domain/*
// ============================================================================

Deno.test("delete - removes stored data", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  await client.receive(["mutable://test/item", { v: 1 }]);
  const res = await router.fetch(
    new Request("http://localhost/api/v1/delete/mutable/test/item", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 200);
  const body = await jsonBody(res);
  assertEquals(body.success, true);

  // Verify deleted
  const readRes = await router.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/item"),
  );
  assertEquals(readRes.status, 404);
});

Deno.test("delete - returns 501 when no handler attached", async () => {
  const router = createMockRouter();
  httpServer(router);

  const res = await router.fetch(
    new Request("http://localhost/api/v1/delete/mutable/test/item", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 501);
});

// ============================================================================
// Full write-read-list-delete cycle via HTTP
// ============================================================================

Deno.test("full cycle - write, read, list, delete via HTTP", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });
  frontend.configure({ client });

  // Write
  const writeRes = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/cycle", { msg: "hello" }]),
    }),
  );
  assertEquals((await jsonBody(writeRes)).accepted, true);

  // Read
  const readRes = await router.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/cycle"),
  );
  assertEquals((await jsonBody(readRes)).data.msg, "hello");

  // List
  const listRes = await router.fetch(
    new Request("http://localhost/api/v1/list/mutable/test"),
  );
  const listBody = await jsonBody(listRes);
  assertEquals(listBody.data.length >= 1, true);

  // Delete
  const delRes = await router.fetch(
    new Request("http://localhost/api/v1/delete/mutable/test/cycle", {
      method: "DELETE",
    }),
  );
  assertEquals((await jsonBody(delRes)).success, true);

  // Confirm deleted
  const readAfter = await router.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/cycle"),
  );
  assertEquals(readAfter.status, 404);
});

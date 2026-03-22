import { assertEquals, assertExists } from "@std/assert";
import { httpServer, type MinimalContext, type MinimalRouter } from "./http.ts";
import { createServerNode } from "./node.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";
import type { Schema } from "../b3nd-core/types.ts";

/** Permissive schema that accepts all writes for the programs used in tests */
const testSchema: Schema = {
  "mutable://test": async () => ({ valid: true }),
  "mutable://items": async () => ({ valid: true }),
  "mutable://del": async () => ({ valid: true }),
  "mutable://nonexistent": async () => ({ valid: true }),
  "mutable://binary": async () => ({ valid: true }),
  "mutable://paged": async () => ({ valid: true }),
};

function createTestClient() {
  return new MemoryClient({ schema: testSchema });
}

/**
 * Create a minimal router (mock) that stores handlers and dispatches fetch().
 * This avoids any dependency on Hono or other frameworks.
 */
function createMockRouter(): MinimalRouter {
  const routes: {
    method: string;
    path: string;
    handler: (c: MinimalContext) => Promise<Response> | Response;
  }[] = [];

  function matchRoute(method: string, url: URL) {
    for (const route of routes) {
      const match = matchPath(route.path, url.pathname);
      if (route.method === method && match) {
        return { handler: route.handler, params: match };
      }
    }
    return null;
  }

  // Simple path matcher supporting :param and * wildcards
  function matchPath(
    pattern: string,
    pathname: string,
  ): Record<string, string> | null {
    const patternParts = pattern.split("/");
    const pathParts = pathname.split("/");

    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i];
      if (pp === "*") {
        // Wildcard — capture rest
        params["*"] = pathParts.slice(i).join("/");
        return params;
      }
      if (pp.startsWith(":")) {
        const paramName = pp.slice(1);
        if (i >= pathParts.length) return null;
        params[paramName] = pathParts[i];
      } else {
        if (pathParts[i] !== pp) return null;
      }
    }

    // Pattern consumed but pathname has more parts — no match (unless wildcard already matched)
    if (pathParts.length > patternParts.length) return null;

    return params;
  }

  const router: MinimalRouter = {
    get(path, handler) {
      routes.push({ method: "GET", path, handler });
    },
    post(path, handler) {
      routes.push({ method: "POST", path, handler });
    },
    delete(path, handler) {
      routes.push({ method: "DELETE", path, handler });
    },
    async fetch(req: Request) {
      const url = new URL(req.url);
      const method = req.method;
      const matched = matchRoute(method, url);

      if (!matched) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
        });
      }

      const { handler, params } = matched;

      // Build MinimalContext
      const context: MinimalContext = {
        req: {
          param: (name: string) => params[name] || "",
          query: (name: string) => url.searchParams.get(name),
          header: (name: string) => req.headers.get(name),
          url: req.url,
          arrayBuffer: () => req.arrayBuffer(),
          // json() used by receive endpoint
          json: () => req.json(),
        } as any,
        json: (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
      };

      return await handler(context);
    },
  };

  return router;
}

// ─── httpServer + createServerNode tests ───

Deno.test("httpServer: health endpoint returns healthy with client", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  const server = createServerNode({
    frontend: httpServer(router),
    client,
  });

  const res = await server.serverHandler(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "healthy");
});

Deno.test("httpServer: health endpoint returns unhealthy when not attached", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  // Not calling configure — handler not attached

  const res = await router.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.status, "unhealthy");
});

Deno.test("httpServer: health endpoint includes healthMeta", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router, { healthMeta: { version: "1.0.0" } }),
    client,
  });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.version, "1.0.0");
});

Deno.test("httpServer: schema endpoint returns empty array initially", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/schema"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.schema);
});

Deno.test("httpServer: receive stores data and read retrieves it", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  // Receive (write)
  const receiveRes = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/hello", { greeting: "world" }]),
    }),
  );
  assertEquals(receiveRes.status, 200);
  const receiveBody = await receiveRes.json();
  assertEquals(receiveBody.accepted, true);

  // Read it back
  const readRes = await router.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/hello"),
  );
  assertEquals(readRes.status, 200);
  const readBody = await readRes.json();
  assertEquals(readBody.data.greeting, "world");
  assertExists(readBody.ts);
});

Deno.test("httpServer: receive rejects invalid message format", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  // Not an array
  const res1 = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri: "mutable://test", data: {} }),
    }),
  );
  assertEquals(res1.status, 400);
  const body1 = await res1.json();
  assertEquals(body1.accepted, false);

  // Array with only 1 element
  const res2 = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test"]),
    }),
  );
  assertEquals(res2.status, 400);
});

Deno.test("httpServer: receive rejects missing URI", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([null, { data: "test" }]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
});

Deno.test("httpServer: read returns 404 for missing data", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/read/mutable/nonexistent/key"),
  );
  assertEquals(res.status, 404);
});

Deno.test("httpServer: list returns result for empty path", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  // Store one item first so the path exists
  await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/items/first", { v: 1 }]),
    }),
  );

  const res = await router.fetch(
    new Request("http://localhost/api/v1/list/mutable/test/items"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.data);
  assertEquals(Array.isArray(body.data), true);
  assertEquals(body.data.length, 1);
});

Deno.test("httpServer: list returns stored items", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  // Store two items
  await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://items/a", { name: "A" }]),
    }),
  );
  await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://items/b", { name: "B" }]),
    }),
  );

  const res = await router.fetch(
    new Request("http://localhost/api/v1/list/mutable/items"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.length, 2);
});

Deno.test("httpServer: delete removes stored data", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  // Store
  await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://del/target", { value: 1 }]),
    }),
  );

  // Verify it's there
  const readRes = await router.fetch(
    new Request("http://localhost/api/v1/read/mutable/del/target"),
  );
  assertEquals(readRes.status, 200);

  // Delete it
  const delRes = await router.fetch(
    new Request("http://localhost/api/v1/delete/mutable/del/target", {
      method: "DELETE",
    }),
  );
  assertEquals(delRes.status, 200);
  const delBody = await delRes.json();
  assertEquals(delBody.success, true);

  // Verify it's gone
  const readRes2 = await router.fetch(
    new Request("http://localhost/api/v1/read/mutable/del/target"),
  );
  assertEquals(readRes2.status, 404);
});

Deno.test("httpServer: delete returns 404 for missing data", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  const res = await router.fetch(
    new Request("http://localhost/api/v1/delete/mutable/nonexistent/key", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 404);
});

// ─── createServerNode tests ───

Deno.test("createServerNode: throws without frontend", () => {
  try {
    createServerNode({} as any);
    throw new Error("should have thrown");
  } catch (e) {
    assertEquals((e as Error).message, "frontend is required");
  }
});

Deno.test("createServerNode: returns serverHandler and listen", () => {
  const router = createMockRouter();
  const client = createTestClient();
  const server = createServerNode({
    frontend: httpServer(router),
    client,
  });

  assertExists(server.serverHandler);
  assertExists(server.listen);
  assertEquals(typeof server.serverHandler, "function");
  assertEquals(typeof server.listen, "function");
});

Deno.test("httpServer: receive handles binary data markers", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  // Send data with binary marker (base64 encoded "hello")
  const res = await router.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        "mutable://binary/test",
        { __b3nd_binary__: true, encoding: "base64", data: "aGVsbG8=" },
      ]),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.accepted, true);
});

Deno.test("httpServer: list supports query parameters", async () => {
  const router = createMockRouter();
  const client = createTestClient();
  createServerNode({
    frontend: httpServer(router),
    client,
  });

  // Store items
  for (let i = 0; i < 5; i++) {
    await router.fetch(
      new Request("http://localhost/api/v1/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([`mutable://paged/item${i}`, { index: i }]),
      }),
    );
  }

  // List with page and limit
  const res = await router.fetch(
    new Request(
      "http://localhost/api/v1/list/mutable/paged?page=1&limit=2",
    ),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.length, 2);
  assertEquals(body.pagination.page, 1);
  assertEquals(body.pagination.limit, 2);
  assertEquals(body.pagination.total, 5);
});

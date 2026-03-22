import { assertEquals } from "@std/assert";
import { httpServer } from "./http.ts";
import { createServerNode } from "./node.ts";
import { createTestSchema, MemoryClient } from "../b3nd-client-memory/mod.ts";
import type { NodeProtocolInterface } from "../b3nd-core/types.ts";

// ── Helpers ──

/** Minimal router that records registered routes and dispatches fetch. */
function createMockRouter() {
  const routes: Record<string, Record<string, Function>> = {};

  function register(method: string, path: string, handler: Function) {
    if (!routes[method]) routes[method] = {};
    routes[method][path] = handler;
  }

  return {
    get: (path: string, handler: Function) => register("GET", path, handler),
    post: (path: string, handler: Function) => register("POST", path, handler),
    delete: (path: string, handler: Function) =>
      register("DELETE", path, handler),
    fetch: async (req: Request) => {
      const url = new URL(req.url);
      const method = req.method;
      const handlers = routes[method] || {};

      // Try exact match first
      if (handlers[url.pathname]) {
        const c = createMockContext(req, url);
        return await handlers[url.pathname](c);
      }

      // Try parameterized routes
      for (const [pattern, handler] of Object.entries(handlers)) {
        const params = matchRoute(pattern, url.pathname);
        if (params) {
          const c = createMockContext(req, url, params);
          return await handler(c);
        }
      }

      return new Response("Not Found", { status: 404 });
    },
    routes,
  };
}

/** Match a route pattern like /api/v1/read/:protocol/:domain/* to a path */
function matchRoute(
  pattern: string,
  path: string,
): Record<string, string> | null {
  // Convert pattern to regex
  const paramNames: string[] = [];
  let hasWildcard = false;

  let regexStr = pattern.replace(/:(\w+)/g, (_match, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });

  if (regexStr.endsWith("/*")) {
    hasWildcard = true;
    regexStr = regexStr.slice(0, -2) + "(?:/(.*))?";
  }

  const regex = new RegExp("^" + regexStr + "$");
  const match = path.match(regex);
  if (!match) return null;

  const params: Record<string, string> = {};
  paramNames.forEach((name, i) => {
    params[name] = match[i + 1];
  });
  if (hasWildcard) {
    params["path"] = match[paramNames.length + 1] || "";
    params["*"] = match[paramNames.length + 1] || "";
  }
  return params;
}

/** Create a mock Hono-like context */
function createMockContext(
  req: Request,
  url: URL,
  params?: Record<string, string>,
) {
  return {
    req: {
      param: (name: string) => params?.[name] ?? "",
      query: (name: string) => url.searchParams.get(name) ?? undefined,
      header: (name: string) => req.headers.get(name) ?? undefined,
      url: req.url,
      json: () => req.json(),
      arrayBuffer: () => req.arrayBuffer(),
    },
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  };
}

/** Build a configured httpServer backed by MemoryClient */
function createTestServer(healthMeta?: Record<string, unknown>) {
  const router = createMockRouter();
  const frontend = httpServer(router, healthMeta ? { healthMeta } : undefined);
  const client = new MemoryClient({ schema: createTestSchema() });
  frontend.configure({ client });
  return { router, frontend, client };
}

/** Helper to make requests against the test server */
async function request(
  router: ReturnType<typeof createMockRouter>,
  method: string,
  path: string,
  body?: unknown,
) {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  const res = await router.fetch(
    new Request(`http://localhost${path}`, opts),
  );
  return res;
}

async function json(res: Response) {
  return await res.json();
}

// ── Health endpoint ──

Deno.test("GET /api/v1/health - returns healthy with client", async () => {
  const { router } = createTestServer();
  const res = await request(router, "GET", "/api/v1/health");
  assertEquals(res.status, 200);
  const data = await json(res);
  assertEquals(data.status, "healthy");
});

Deno.test("GET /api/v1/health - includes healthMeta", async () => {
  const { router } = createTestServer({ version: "1.0.0", node: "test-node" });
  const res = await request(router, "GET", "/api/v1/health");
  assertEquals(res.status, 200);
  const data = await json(res);
  assertEquals(data.status, "healthy");
  assertEquals(data.version, "1.0.0");
  assertEquals(data.node, "test-node");
});

Deno.test("GET /api/v1/health - returns 503 when no backend attached", async () => {
  const router = createMockRouter();
  httpServer(router); // no configure called
  const res = await request(router, "GET", "/api/v1/health");
  assertEquals(res.status, 503);
  const data = await json(res);
  assertEquals(data.status, "unhealthy");
});

// ── Schema endpoint ──

Deno.test("GET /api/v1/schema - returns schema keys", async () => {
  const { router } = createTestServer();
  const res = await request(router, "GET", "/api/v1/schema");
  assertEquals(res.status, 200);
  const data = await json(res);
  assertEquals(Array.isArray(data.schema), true);
  assertEquals(data.schema.length > 0, true);
  assertEquals(data.schema.includes("mutable://accounts"), true);
});

Deno.test("GET /api/v1/schema - returns empty when no backend", async () => {
  const router = createMockRouter();
  httpServer(router);
  const res = await request(router, "GET", "/api/v1/schema");
  assertEquals(res.status, 200);
  const data = await json(res);
  assertEquals(data.schema, []);
});

// ── Receive (write) endpoint ──

Deno.test("POST /api/v1/receive - writes data successfully", async () => {
  const { router } = createTestServer();
  const res = await request(router, "POST", "/api/v1/receive", [
    "mutable://accounts/alice/profile",
    { name: "Alice" },
  ]);
  assertEquals(res.status, 200);
  const data = await json(res);
  assertEquals(data.accepted, true);
});

Deno.test("POST /api/v1/receive - rejects invalid message format", async () => {
  const { router } = createTestServer();

  // Not an array
  const res1 = await request(router, "POST", "/api/v1/receive", {
    uri: "mutable://accounts/test",
  });
  assertEquals(res1.status, 400);
  const data1 = await json(res1);
  assertEquals(data1.accepted, false);

  // Array too short
  const res2 = await request(router, "POST", "/api/v1/receive", ["only-uri"]);
  assertEquals(res2.status, 400);

  // Null body
  const res3 = await request(router, "POST", "/api/v1/receive", null);
  assertEquals(res3.status, 400);
});

Deno.test("POST /api/v1/receive - rejects missing URI", async () => {
  const { router } = createTestServer();
  const res = await request(router, "POST", "/api/v1/receive", [
    "",
    { data: "test" },
  ]);
  assertEquals(res.status, 400);
  const data = await json(res);
  assertEquals(data.accepted, false);
  assertEquals(data.error.includes("URI"), true);
});

Deno.test("POST /api/v1/receive - rejects non-string URI", async () => {
  const { router } = createTestServer();
  const res = await request(router, "POST", "/api/v1/receive", [
    123,
    { data: "test" },
  ]);
  assertEquals(res.status, 400);
});

Deno.test("POST /api/v1/receive - returns 501 when no backend", async () => {
  const router = createMockRouter();
  httpServer(router);
  const res = await request(router, "POST", "/api/v1/receive", [
    "mutable://accounts/test",
    { data: "test" },
  ]);
  assertEquals(res.status, 501);
});

// ── Read endpoint ──

Deno.test("GET /api/v1/read - reads back written data", async () => {
  const { router } = createTestServer();

  // Write first
  await request(router, "POST", "/api/v1/receive", [
    "mutable://accounts/bob/profile",
    { name: "Bob", age: 30 },
  ]);

  // Read
  const res = await request(
    router,
    "GET",
    "/api/v1/read/mutable/accounts/bob/profile",
  );
  assertEquals(res.status, 200);
  const data = await json(res);
  assertEquals(data.data.name, "Bob");
  assertEquals(data.data.age, 30);
});

Deno.test("GET /api/v1/read - returns 404 for non-existent key", async () => {
  const { router } = createTestServer();
  const res = await request(
    router,
    "GET",
    "/api/v1/read/mutable/accounts/nonexistent",
  );
  assertEquals(res.status, 404);
});

Deno.test("GET /api/v1/read - returns 501 when no backend", async () => {
  const router = createMockRouter();
  httpServer(router);
  const res = await request(
    router,
    "GET",
    "/api/v1/read/mutable/accounts/test",
  );
  assertEquals(res.status, 501);
});

// ── List endpoint ──

Deno.test("GET /api/v1/list - lists items at prefix", async () => {
  const { router } = createTestServer();

  // Write a few items
  await request(router, "POST", "/api/v1/receive", [
    "mutable://accounts/user1/profile",
    { name: "User 1" },
  ]);
  await request(router, "POST", "/api/v1/receive", [
    "mutable://accounts/user2/profile",
    { name: "User 2" },
  ]);

  const res = await request(
    router,
    "GET",
    "/api/v1/list/mutable/accounts",
  );
  assertEquals(res.status, 200);
  const data = await json(res);
  assertEquals(Array.isArray(data.data), true);
  assertEquals(data.data.length >= 2, true);
});

Deno.test("GET /api/v1/list - supports pagination params", async () => {
  const { router } = createTestServer();

  await request(router, "POST", "/api/v1/receive", [
    "mutable://open/item1",
    { v: 1 },
  ]);
  await request(router, "POST", "/api/v1/receive", [
    "mutable://open/item2",
    { v: 2 },
  ]);

  const res = await request(
    router,
    "GET",
    "/api/v1/list/mutable/open?page=1&limit=1",
  );
  assertEquals(res.status, 200);
  const data = await json(res);
  assertEquals(data.data.length, 1);
});

Deno.test("GET /api/v1/list - returns empty for no backend", async () => {
  const router = createMockRouter();
  httpServer(router);
  const res = await request(router, "GET", "/api/v1/list/mutable/accounts");
  assertEquals(res.status, 200);
  const data = await json(res);
  assertEquals(data.data, []);
});

// ── Delete endpoint ──

Deno.test("DELETE /api/v1/delete - deletes existing data", async () => {
  const { router } = createTestServer();

  // Write
  await request(router, "POST", "/api/v1/receive", [
    "mutable://accounts/to-delete/data",
    { temp: true },
  ]);

  // Verify it exists
  const readRes = await request(
    router,
    "GET",
    "/api/v1/read/mutable/accounts/to-delete/data",
  );
  assertEquals(readRes.status, 200);

  // Delete
  const delRes = await request(
    router,
    "DELETE",
    "/api/v1/delete/mutable/accounts/to-delete/data",
  );
  assertEquals(delRes.status, 200);
  const delData = await json(delRes);
  assertEquals(delData.success, true);

  // Verify gone
  const readRes2 = await request(
    router,
    "GET",
    "/api/v1/read/mutable/accounts/to-delete/data",
  );
  assertEquals(readRes2.status, 404);
});

Deno.test("DELETE /api/v1/delete - returns 501 when no backend", async () => {
  const router = createMockRouter();
  httpServer(router);
  const res = await request(
    router,
    "DELETE",
    "/api/v1/delete/mutable/accounts/test",
  );
  assertEquals(res.status, 501);
});

// ── createServerNode ──

Deno.test("createServerNode - works with client interface", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const client: NodeProtocolInterface = new MemoryClient({
    schema: createTestSchema(),
  });

  const { serverHandler } = createServerNode({ frontend, client });

  // Use serverHandler directly
  const healthRes = await serverHandler(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(healthRes.status, 200);
  const healthData = await healthRes.json();
  assertEquals(healthData.status, "healthy");
});

Deno.test("createServerNode - throws without frontend", () => {
  let threw = false;
  try {
    createServerNode(null as any);
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message.includes("frontend"), true);
  }
  assertEquals(threw, true);
});

Deno.test("createServerNode - legacy path requires backend and schema", () => {
  const router = createMockRouter();
  const frontend = httpServer(router);

  let threw = false;
  try {
    createServerNode({ frontend });
  } catch (e) {
    threw = true;
    assertEquals(
      (e as Error).message.includes("backend") ||
        (e as Error).message.includes("required"),
      true,
    );
  }
  assertEquals(threw, true);
});

// ── Full round-trip via serverHandler ──

Deno.test("serverHandler - full write/read/list/delete round-trip", async () => {
  const router = createMockRouter();
  const frontend = httpServer(router);
  const client = new MemoryClient({ schema: createTestSchema() });
  const { serverHandler } = createServerNode({ frontend, client });

  // Write
  const writeRes = await serverHandler(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      body: JSON.stringify(["mutable://data/roundtrip/item", {
        round: "trip",
      }]),
      headers: { "Content-Type": "application/json" },
    }),
  );
  assertEquals(writeRes.status, 200);
  assertEquals((await writeRes.json()).accepted, true);

  // Read
  const readRes = await serverHandler(
    new Request("http://localhost/api/v1/read/mutable/data/roundtrip/item"),
  );
  assertEquals(readRes.status, 200);
  const record = await readRes.json();
  assertEquals(record.data.round, "trip");

  // List
  const listRes = await serverHandler(
    new Request("http://localhost/api/v1/list/mutable/data/roundtrip"),
  );
  assertEquals(listRes.status, 200);
  const listData = await listRes.json();
  assertEquals(listData.data.length >= 1, true);

  // Delete
  const delRes = await serverHandler(
    new Request(
      "http://localhost/api/v1/delete/mutable/data/roundtrip/item",
      { method: "DELETE" },
    ),
  );
  assertEquals(delRes.status, 200);

  // Verify deleted
  const readRes2 = await serverHandler(
    new Request("http://localhost/api/v1/read/mutable/data/roundtrip/item"),
  );
  assertEquals(readRes2.status, 404);
});

// ── Binary data handling ──

Deno.test("POST /api/v1/receive - deserializes base64 binary data", async () => {
  const { router } = createTestServer();

  // Send binary-wrapped data
  const res = await request(router, "POST", "/api/v1/receive", [
    "mutable://data/binary-test",
    { __b3nd_binary__: true, encoding: "base64", data: "AQID" }, // [1, 2, 3]
  ]);
  assertEquals(res.status, 200);
  const data = await json(res);
  assertEquals(data.accepted, true);
});

// ── Multiple writes to same key (overwrite) ──

Deno.test("POST /api/v1/receive - overwrites existing data", async () => {
  const { router } = createTestServer();

  await request(router, "POST", "/api/v1/receive", [
    "mutable://accounts/overwrite-test",
    { version: 1 },
  ]);

  await request(router, "POST", "/api/v1/receive", [
    "mutable://accounts/overwrite-test",
    { version: 2 },
  ]);

  const res = await request(
    router,
    "GET",
    "/api/v1/read/mutable/accounts/overwrite-test",
  );
  const data = await json(res);
  assertEquals(data.data.version, 2);
});

// ── Schema endpoint content ──

Deno.test("GET /api/v1/schema - returns all expected protocol keys", async () => {
  const { router } = createTestServer();
  const res = await request(router, "GET", "/api/v1/schema");
  const data = await json(res);
  const expected = [
    "mutable://accounts",
    "mutable://open",
    "mutable://data",
    "immutable://accounts",
    "immutable://open",
    "immutable://data",
  ];
  for (const key of expected) {
    assertEquals(data.schema.includes(key), true, `Missing schema key: ${key}`);
  }
});

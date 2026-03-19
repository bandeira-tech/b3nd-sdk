import { assertEquals } from "@std/assert";
import type { MinimalContext, MinimalRequest, MinimalRouter } from "./http.ts";
import { httpServer } from "./http.ts";
import type {
  ListResult,
  Message,
  NodeProtocolInterface,
  ReceiveResult,
} from "../b3nd-core/types.ts";

// ── Helpers ──

/** Build a MinimalRouter backed by simple route maps. */
function createMockRouter(): MinimalRouter & {
  routes: {
    GET: Map<string, (c: MinimalContext) => Promise<Response> | Response>;
    POST: Map<string, (c: MinimalContext) => Promise<Response> | Response>;
    DELETE: Map<string, (c: MinimalContext) => Promise<Response> | Response>;
  };
} {
  const routes = {
    GET: new Map<
      string,
      (c: MinimalContext) => Promise<Response> | Response
    >(),
    POST: new Map<
      string,
      (c: MinimalContext) => Promise<Response> | Response
    >(),
    DELETE: new Map<
      string,
      (c: MinimalContext) => Promise<Response> | Response
    >(),
  };
  return {
    routes,
    get(path, handler) {
      routes.GET.set(path, handler);
    },
    post(path, handler) {
      routes.POST.set(path, handler);
    },
    delete(path, handler) {
      routes.DELETE.set(path, handler);
    },
    async fetch(req: Request) {
      const url = new URL(req.url);
      const method = req.method.toUpperCase() as "GET" | "POST" | "DELETE";
      const methodRoutes = routes[method];
      if (!methodRoutes) {
        return new Response("Method not allowed", { status: 405 });
      }
      for (const [pattern, handler] of methodRoutes) {
        const match = matchRoute(pattern, url.pathname);
        if (match) {
          const ctx = createContext(req, url, match.params, match.wildcard);
          return await handler(ctx);
        }
      }
      return new Response("Not found", { status: 404 });
    },
  };
}

/** Simple route pattern matcher supporting :param and trailing * */
function matchRoute(
  pattern: string,
  pathname: string,
): { params: Record<string, string>; wildcard: string } | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);

  const params: Record<string, string> = {};
  let wildcard = "";

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp === "*") {
      wildcard = pathParts.slice(i).join("/");
      return { params, wildcard };
    }
    if (pp.startsWith(":")) {
      const key = pp.slice(1);
      if (i >= pathParts.length) return null;
      params[key] = pathParts[i];
    } else {
      if (pathParts[i] !== pp) return null;
    }
  }

  if (patternParts.length === pathParts.length) {
    return { params, wildcard };
  }
  return null;
}

function createContext(
  req: Request,
  url: URL,
  params: Record<string, string>,
  wildcard: string,
): MinimalContext {
  const mockReq: MinimalRequest & { json: () => Promise<unknown> } = {
    param: (name: string) => {
      if (name === "*") return wildcard;
      return params[name] || "";
    },
    query: (name: string) => url.searchParams.get(name),
    header: (name: string) => req.headers.get(name),
    url: req.url,
    arrayBuffer: () => req.arrayBuffer(),
    json: () => req.json(),
  };
  return {
    req: mockReq,
    json: (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  };
}

const now = Date.now();

/** Create a mock NodeProtocolInterface for testing */
function createMockClient(
  overrides: Partial<Record<string, unknown>> = {},
): NodeProtocolInterface {
  const base = {
    health: () =>
      Promise.resolve({ status: "healthy" as const, timestamp: now }),
    getSchema: () => Promise.resolve(["mutable://test"]),
    receive: (msg: Message) =>
      Promise.resolve({ accepted: true, uri: msg[0] } as ReceiveResult),
    read: (_uri: string) =>
      Promise.resolve({
        success: true,
        record: { ts: now, data: { hello: "world" } },
      }),
    readMulti: (uris: string[]) =>
      Promise.resolve({
        success: true,
        results: uris.map((uri) => ({
          uri,
          success: true as const,
          record: { ts: now, data: {} },
        })),
        summary: { total: uris.length, succeeded: uris.length, failed: 0 },
      }),
    list: () =>
      Promise.resolve({
        success: true as const,
        data: [{ uri: "mutable://test/a" }, { uri: "mutable://test/b" }],
        pagination: { page: 1, limit: 50, total: 2 },
      }),
    delete: (uri: string) => Promise.resolve({ success: true, uri }),
    cleanup: () => Promise.resolve(),
    ...overrides,
  };
  return base as unknown as NodeProtocolInterface;
}

// ── Health endpoint ──

Deno.test("httpServer - health returns healthy when client is configured", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({ client: createMockClient() });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "healthy");
});

Deno.test("httpServer - health returns 503 when no backend configured", async () => {
  const app = createMockRouter();
  httpServer(app);

  const res = await app.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.status, "unhealthy");
  assertEquals(body.message, "handler not attached");
});

Deno.test("httpServer - health includes healthMeta", async () => {
  const app = createMockRouter();
  const server = httpServer(app, { healthMeta: { version: "1.0.0" } });
  server.configure({ client: createMockClient() });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  const body = await res.json();
  assertEquals(body.status, "healthy");
  assertEquals(body.version, "1.0.0");
});

Deno.test("httpServer - health 503 includes healthMeta", async () => {
  const app = createMockRouter();
  httpServer(app, { healthMeta: { node: "test-node" } });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.node, "test-node");
});

Deno.test("httpServer - health returns unhealthy status from client", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      health: () =>
        Promise.resolve({
          status: "unhealthy" as const,
          timestamp: now,
        }),
    }),
  });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.status, "unhealthy");
});

// ── Schema endpoint ──

Deno.test("httpServer - schema returns schema keys from client", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      getSchema: () => Promise.resolve(["mutable://users", "mutable://posts"]),
    }),
  });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/schema"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.schema, ["mutable://users", "mutable://posts"]);
});

Deno.test("httpServer - schema returns empty when no backend", async () => {
  const app = createMockRouter();
  httpServer(app);

  const res = await app.fetch(
    new Request("http://localhost/api/v1/schema"),
  );
  const body = await res.json();
  assertEquals(body.schema, []);
});

// ── Receive endpoint ──

Deno.test("httpServer - receive accepts valid message via client", async () => {
  const received: Message[] = [];
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      receive: (msg: Message) => {
        received.push(msg);
        return Promise.resolve({
          accepted: true,
          uri: msg[0],
        } as ReceiveResult);
      },
    }),
  });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/doc", { name: "Alice" }]),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.accepted, true);
  assertEquals(received.length, 1);
  assertEquals(received[0][0], "mutable://test/doc");
  assertEquals(received[0][1], { name: "Alice" });
});

Deno.test("httpServer - receive rejects invalid format (not array)", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({ client: createMockClient() });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri: "mutable://x", data: {} }),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
});

Deno.test("httpServer - receive rejects missing URI", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({ client: createMockClient() });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([null, { data: 1 }]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
  assertEquals(body.error, "Message URI is required");
});

Deno.test("httpServer - receive rejects numeric URI", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({ client: createMockClient() });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([123, { data: 1 }]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
});

Deno.test("httpServer - receive returns 400 for rejected messages", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      receive: () =>
        Promise.resolve({
          accepted: false,
          error: "Validation failed",
        } as ReceiveResult),
    }),
  });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/x", { bad: true }]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
  assertEquals(body.error, "Validation failed");
});

Deno.test("httpServer - receive returns 501 when not configured", async () => {
  const app = createMockRouter();
  httpServer(app);

  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/x", {}]),
    }),
  );
  assertEquals(res.status, 501);
  const body = await res.json();
  assertEquals(body.accepted, false);
  assertEquals(body.error, "handler not attached");
});

Deno.test("httpServer - receive deserializes binary data", async () => {
  const received: Message[] = [];
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      receive: (msg: Message) => {
        received.push(msg);
        return Promise.resolve({
          accepted: true,
          uri: msg[0],
        } as ReceiveResult);
      },
    }),
  });

  // Send a base64-encoded binary marker
  const binaryMarker = {
    __b3nd_binary__: true,
    encoding: "base64",
    data: "AQID", // [1, 2, 3] in base64
  };

  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://test/bin", binaryMarker]),
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(received.length, 1);
  const data = received[0][1] as Uint8Array;
  assertEquals(data instanceof Uint8Array, true);
  assertEquals(data[0], 1);
  assertEquals(data[1], 2);
  assertEquals(data[2], 3);
});

Deno.test("httpServer - receive handles malformed JSON body", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({ client: createMockClient() });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
});

// ── Read endpoint ──

Deno.test("httpServer - read returns JSON record", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      read: () =>
        Promise.resolve({
          success: true,
          record: { ts: 1000, data: { name: "test" } },
        }),
    }),
  });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/doc"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data, { name: "test" });
  assertEquals(body.ts, 1000);
});

Deno.test("httpServer - read returns 404 for missing record", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      read: () => Promise.resolve({ success: false, error: "Not found" }),
    }),
  });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/missing"),
  );
  assertEquals(res.status, 404);
});

Deno.test("httpServer - read returns 501 when not configured", async () => {
  const app = createMockRouter();
  httpServer(app);

  const res = await app.fetch(
    new Request("http://localhost/api/v1/read/mutable/test/x"),
  );
  assertEquals(res.status, 501);
});

Deno.test("httpServer - read returns binary data with MIME type", async () => {
  const pngBytes = new Uint8Array([137, 80, 78, 71]);
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      read: () =>
        Promise.resolve({
          success: true,
          record: { ts: 1000, data: pngBytes },
        }),
    }),
  });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/read/mutable/assets/image.png"),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "image/png");
  assertEquals(res.headers.get("Content-Length"), "4");
  const body = new Uint8Array(await res.arrayBuffer());
  assertEquals(body, pngBytes);
});

// ── List endpoint ──

Deno.test("httpServer - list returns items from client", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      list: () =>
        Promise.resolve({
          success: true as const,
          data: [{ uri: "mutable://test/a" }, { uri: "mutable://test/b" }],
          pagination: { page: 1, limit: 50, total: 2 },
        }),
    }),
  });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/list/mutable/test/"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.length, 2);
});

Deno.test("httpServer - list returns empty when not configured", async () => {
  const app = createMockRouter();
  httpServer(app);

  const res = await app.fetch(
    new Request("http://localhost/api/v1/list/mutable/test/"),
  );
  const body = await res.json();
  assertEquals(body.data, []);
  assertEquals(body.pagination.total, 0);
});

Deno.test("httpServer - list passes query params", async () => {
  let capturedOpts: Record<string, unknown> = {};
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      list: (_uri: string, opts?: Record<string, unknown>) => {
        capturedOpts = opts || {};
        return Promise.resolve({
          success: true as const,
          data: [],
          pagination: { page: 2, limit: 10, total: 0 },
        });
      },
    }),
  });

  await app.fetch(
    new Request(
      "http://localhost/api/v1/list/mutable/test/?page=2&limit=10&pattern=*.json",
    ),
  );
  assertEquals(capturedOpts.page, 2);
  assertEquals(capturedOpts.limit, 10);
  assertEquals(capturedOpts.pattern, "*.json");
});

// ── Delete endpoint ──

Deno.test("httpServer - delete succeeds via client", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      delete: (uri: string) => Promise.resolve({ success: true, uri }),
    }),
  });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/delete/mutable/test/doc", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
});

Deno.test("httpServer - delete returns 404 for missing", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({
    client: createMockClient({
      delete: () => Promise.resolve({ success: false, error: "Not found" }),
    }),
  });

  const res = await app.fetch(
    new Request("http://localhost/api/v1/delete/mutable/test/missing", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 404);
});

Deno.test("httpServer - delete returns 501 when not configured", async () => {
  const app = createMockRouter();
  httpServer(app);

  const res = await app.fetch(
    new Request("http://localhost/api/v1/delete/mutable/test/x", {
      method: "DELETE",
    }),
  );
  assertEquals(res.status, 501);
});

// ── ServerFrontend interface ──

Deno.test("httpServer - returns ServerFrontend with fetch and configure", () => {
  const app = createMockRouter();
  const server = httpServer(app);
  assertEquals(typeof server.listen, "function");
  assertEquals(typeof server.fetch, "function");
  assertEquals(typeof server.configure, "function");
});

Deno.test("httpServer - fetch delegates to app.fetch", async () => {
  const app = createMockRouter();
  const server = httpServer(app);
  server.configure({ client: createMockClient() });

  const res = await server.fetch(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
});

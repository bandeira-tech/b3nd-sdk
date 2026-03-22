/// <reference lib="deno.ns" />
/**
 * Tests for b3nd-servers: httpServer and createServerNode.
 *
 * Uses a minimal in-memory router to test the HTTP API surface
 * without spinning up actual network servers.
 */

import { assertEquals, assertExists } from "@std/assert";
import { httpServer, type MinimalContext, type MinimalRouter } from "./http.ts";
import { createServerNode } from "./node.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";
import type { NodeProtocolInterface, Schema } from "../b3nd-core/types.ts";

// ── Minimal in-memory router (no Hono dependency) ────────────────────

type RouteHandler = (c: MinimalContext) => Promise<Response> | Response;

function createTestRouter(): MinimalRouter {
  const routes: { method: string; path: string; handler: RouteHandler }[] = [];

  function matchRoute(
    method: string,
    pathname: string,
  ): { handler: RouteHandler; params: Record<string, string> } | null {
    for (const route of routes) {
      if (route.method !== method) continue;
      const params = matchPath(route.path, pathname);
      if (params !== null) return { handler: route.handler, params };
    }
    return null;
  }

  return {
    get(path: string, handler: RouteHandler) {
      routes.push({ method: "GET", path, handler });
    },
    post(path: string, handler: RouteHandler) {
      routes.push({ method: "POST", path, handler });
    },
    delete(path: string, handler: RouteHandler) {
      routes.push({ method: "DELETE", path, handler });
    },
    fetch(req: Request): Promise<Response> | Response {
      const url = new URL(req.url);
      const matched = matchRoute(req.method, url.pathname);
      if (!matched) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
        });
      }

      const ctx: MinimalContext = {
        req: {
          param: (name: string) => matched.params[name] ?? "",
          query: (name: string) => url.searchParams.get(name),
          header: (name: string) => req.headers.get(name),
          url: req.url,
          arrayBuffer: () => req.arrayBuffer(),
          json: () => req.json(),
        } as MinimalContext["req"],
        json: (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
      };

      return matched.handler(ctx);
    },
  };
}

/**
 * Simple path matching supporting :param and * wildcards.
 * Returns extracted params or null if no match.
 */
function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const params: Record<string, string> = {};
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp === "*") {
      params["*"] = pathParts.slice(i).join("/");
      return params;
    }
    if (pp.startsWith(":")) {
      params[pp.slice(1)] = pathParts[i] ?? "";
    } else if (pp !== pathParts[i]) {
      return null;
    }
  }

  if (patternParts.length !== pathParts.length) return null;
  return params;
}

// ── Permissive schema for tests ──────────────────────────────────────

const permissiveValidator = () => Promise.resolve({ valid: true as const });
const permissiveSchema: Schema = {
  "mutable://open": permissiveValidator,
};

// ── Helper: create a configured test server ──────────────────────────

function createTestServer(opts?: { healthMeta?: Record<string, unknown> }) {
  const client = new MemoryClient({ schema: permissiveSchema });
  const app = createTestRouter();
  const server = httpServer(app, opts);
  server.configure({ client: client as unknown as NodeProtocolInterface });
  return { server, client, fetch: (req: Request) => server.fetch(req) };
}

// ── Tests ────────────────────────────────────────────────────────────

Deno.test("health endpoint returns healthy status", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(new Request("http://localhost/api/v1/health"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "healthy");
});

Deno.test("health endpoint includes healthMeta", async () => {
  const { fetch } = createTestServer({
    healthMeta: { backends: ["memory"], version: "1.0" },
  });
  const res = await fetch(new Request("http://localhost/api/v1/health"));
  const body = await res.json();
  assertEquals(body.status, "healthy");
  assertEquals(body.backends, ["memory"]);
  assertEquals(body.version, "1.0");
});

Deno.test("schema endpoint returns array", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(new Request("http://localhost/api/v1/schema"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.schema);
});

Deno.test("receive accepts valid message", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://open/test/item", { hello: "world" }]),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.accepted, true);
});

Deno.test("receive rejects invalid message format", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invalid: "format" }),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
});

Deno.test("receive rejects empty URI", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["", { data: 1 }]),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.accepted, false);
});

Deno.test("receive and read round-trip", async () => {
  const { fetch } = createTestServer();

  // Write
  const writeRes = await fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://open/test/roundtrip", { value: 42 }]),
    }),
  );
  assertEquals((await writeRes.json()).accepted, true);

  // Read
  const readRes = await fetch(
    new Request("http://localhost/api/v1/read/mutable/open/test/roundtrip"),
  );
  assertEquals(readRes.status, 200);
  const record = await readRes.json();
  assertEquals(record.data.value, 42);
});

Deno.test("read returns 404 for missing URI", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(
    new Request("http://localhost/api/v1/read/mutable/open/nonexistent"),
  );
  assertEquals(res.status, 404);
});

Deno.test("list returns items after write", async () => {
  const { fetch } = createTestServer();

  // Write items
  for (const id of ["x", "y", "z"]) {
    await fetch(
      new Request("http://localhost/api/v1/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([`mutable://open/list-test/${id}`, { id }]),
      }),
    );
  }

  // List
  const res = await fetch(
    new Request("http://localhost/api/v1/list/mutable/open/list-test"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.length >= 3, true);
});

Deno.test("delete removes item", async () => {
  const { fetch } = createTestServer();

  // Write
  await fetch(
    new Request("http://localhost/api/v1/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["mutable://open/del-test/item", { v: 1 }]),
    }),
  );

  // Delete
  const delRes = await fetch(
    new Request("http://localhost/api/v1/delete/mutable/open/del-test/item", {
      method: "DELETE",
    }),
  );
  assertEquals(delRes.status, 200);
  assertEquals((await delRes.json()).success, true);

  // Read should 404
  const readRes = await fetch(
    new Request("http://localhost/api/v1/read/mutable/open/del-test/item"),
  );
  assertEquals(readRes.status, 404);
});

// ── createServerNode tests ───────────────────────────────────────────

Deno.test("createServerNode with client produces working handler", async () => {
  const client = new MemoryClient({ schema: permissiveSchema });
  const app = createTestRouter();
  const frontend = httpServer(app);

  const { serverHandler } = createServerNode({
    frontend,
    client: client as unknown as NodeProtocolInterface,
  });

  // Health check
  const healthRes = await serverHandler(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(healthRes.status, 200);
  const body = await healthRes.json();
  assertEquals(body.status, "healthy");
});

Deno.test("createServerNode throws without frontend", () => {
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    createServerNode({ frontend: null as any });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("createServerNode throws without backend or client", () => {
  const app = createTestRouter();
  const frontend = httpServer(app);
  let threw = false;
  try {
    createServerNode({ frontend });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

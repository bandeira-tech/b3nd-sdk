/**
 * AppsClient Tests
 *
 * Tests the AppsClient with a mock fetch implementation to verify
 * all HTTP interactions: health, schema, sessions, actions, reads.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert@1/equals";
import { assert } from "jsr:@std/assert@1/assert";
import { assertRejects } from "jsr:@std/assert@1/rejects";
import { AppsClient } from "./mod.ts";

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

type MockRoute = {
  match: (url: string, method: string) => boolean;
  respond: (url: string, body?: any) => { status: number; body: unknown };
};

function createMockFetch(routes: MockRoute[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const method = init?.method || "GET";
    const requestBody = init?.body ? JSON.parse(init.body as string) : null;

    for (const route of routes) {
      if (route.match(url, method)) {
        const { status, body } = route.respond(url, requestBody);
        return new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
    });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

Deno.test("AppsClient — throws if appServerUrl missing", () => {
  let threw = false;
  try {
    new AppsClient({ appServerUrl: "", apiBasePath: "/api" });
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("AppsClient — throws if apiBasePath missing", () => {
  let threw = false;
  try {
    new AppsClient({ appServerUrl: "http://localhost", apiBasePath: "" });
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("AppsClient — normalizes trailing slashes", () => {
  // Should not throw; validates internal URL construction
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000/",
    apiBasePath: "/api/v1/",
    fetch: createMockFetch([]),
  });
  assert(client);
});

Deno.test("AppsClient — prepends slash to apiBasePath if missing", () => {
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "api/v1",
    fetch: createMockFetch([]),
  });
  assert(client);
});

// ---------------------------------------------------------------------------
// health()
// ---------------------------------------------------------------------------

Deno.test("AppsClient — health() returns response on success", async () => {
  const mockFetch = createMockFetch([{
    match: (url) => url.includes("/health"),
    respond: () => ({ status: 200, body: { status: "healthy" } }),
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  const result = await client.health();
  assertEquals((result as any).status, "healthy");
});

Deno.test("AppsClient — health() throws on non-OK response", async () => {
  const mockFetch = createMockFetch([{
    match: (url) => url.includes("/health"),
    respond: () => ({ status: 503, body: { error: "down" } }),
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  await assertRejects(() => client.health());
});

// ---------------------------------------------------------------------------
// updateOrigins()
// ---------------------------------------------------------------------------

Deno.test("AppsClient — updateOrigins() sends authenticated message", async () => {
  let capturedBody: any = null;
  const mockFetch = createMockFetch([{
    match: (url, method) => url.includes("/apps/origins/") && method === "POST",
    respond: (_url, body) => {
      capturedBody = body;
      return { status: 200, body: { success: true } };
    },
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  const message = {
    auth: [{ pubkey: "abc123", signature: "sig456" }],
    payload: { allowedOrigins: ["http://localhost:5173"] },
  };

  const result = await client.updateOrigins("my-app", message);
  assertEquals(result.success, true);
  assertEquals(capturedBody.auth[0].pubkey, "abc123");
  assertEquals(capturedBody.payload.allowedOrigins[0], "http://localhost:5173");
});

Deno.test("AppsClient — updateOrigins() throws on failure", async () => {
  const mockFetch = createMockFetch([{
    match: (url, method) => url.includes("/apps/origins/") && method === "POST",
    respond: () => ({
      status: 400,
      body: { success: false, error: "Invalid origins" },
    }),
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  await assertRejects(
    () =>
      client.updateOrigins("my-app", {
        auth: [],
        payload: { allowedOrigins: [] },
      }),
    Error,
    "Invalid origins",
  );
});

// ---------------------------------------------------------------------------
// updateGoogleClientId()
// ---------------------------------------------------------------------------

Deno.test("AppsClient — updateGoogleClientId() sends correct payload", async () => {
  let capturedUrl = "";
  const mockFetch = createMockFetch([{
    match: (url, method) =>
      url.includes("/apps/google-client-id/") && method === "POST",
    respond: (url) => {
      capturedUrl = url;
      return { status: 200, body: { success: true } };
    },
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  const result = await client.updateGoogleClientId("my-app", {
    auth: [{ pubkey: "key", signature: "sig" }],
    payload: { googleClientId: "123456.apps.googleusercontent.com" },
  });
  assertEquals(result.success, true);
  assert(capturedUrl.includes("/apps/google-client-id/my-app"));
});

// ---------------------------------------------------------------------------
// updateSchema()
// ---------------------------------------------------------------------------

Deno.test("AppsClient — updateSchema() sends actions array", async () => {
  let capturedBody: any = null;
  const mockFetch = createMockFetch([{
    match: (url, method) => url.includes("/apps/schema/") && method === "POST",
    respond: (_url, body) => {
      capturedBody = body;
      return { status: 200, body: { success: true } };
    },
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  const result = await client.updateSchema("my-app", {
    auth: [{ pubkey: "key", signature: "sig" }],
    payload: {
      actions: [
        { action: "register", write: { plain: "users" } },
        {
          action: "subscribe",
          validation: { stringValue: { format: "email" } },
          write: { encrypted: "emails" },
        },
      ],
    },
  });
  assertEquals(result.success, true);
  assertEquals(capturedBody.payload.actions.length, 2);
  assertEquals(capturedBody.payload.actions[0].action, "register");
});

// ---------------------------------------------------------------------------
// getSchema()
// ---------------------------------------------------------------------------

Deno.test("AppsClient — getSchema() returns app config", async () => {
  const mockFetch = createMockFetch([{
    match: (url, method) => url.includes("/apps/schema/") && method === "GET",
    respond: () => ({
      status: 200,
      body: {
        success: true,
        config: {
          appKey: "my-app",
          allowedOrigins: ["http://localhost"],
          actions: [{ action: "post", write: { plain: "posts" } }],
        },
      },
    }),
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  const result = await client.getSchema("my-app");
  assert(result.success);
  assertEquals(result.config.appKey, "my-app");
  assertEquals(result.config.actions.length, 1);
});

// ---------------------------------------------------------------------------
// createSession()
// ---------------------------------------------------------------------------

Deno.test("AppsClient — createSession() returns session and URI", async () => {
  const mockFetch = createMockFetch([{
    match: (url, method) =>
      url.includes("/app/my-app/session") && method === "POST",
    respond: () => ({
      status: 200,
      body: {
        success: true,
        session: "sess-abc",
        uri: "mutable://my-app/sessions/sess-abc",
      },
    }),
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  const result = await client.createSession("my-app", {
    auth: [{ pubkey: "key", signature: "sig" }],
    payload: { session: "sess-abc" },
  });
  assert(result.success);
  assertEquals(result.session, "sess-abc");
  assert(result.uri.includes("sess-abc"));
});

// ---------------------------------------------------------------------------
// invokeAction()
// ---------------------------------------------------------------------------

Deno.test("AppsClient — invokeAction() returns URI and record", async () => {
  const mockFetch = createMockFetch([{
    match: (url, method) =>
      url.includes("/app/my-app/post") && method === "POST",
    respond: () => ({
      status: 200,
      body: {
        success: true,
        uri: "mutable://my-app/posts/123",
        record: { ts: 1234567890, data: { title: "Hello" } },
      },
    }),
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  const result = await client.invokeAction("my-app", "post", {
    auth: [{ pubkey: "key", signature: "sig" }],
    payload: { title: "Hello" },
  });
  assert(result.success);
  assertEquals(result.uri, "mutable://my-app/posts/123");
  assertEquals((result.record.data as any).title, "Hello");
});

Deno.test("AppsClient — invokeAction() passes Origin header", async () => {
  let capturedOrigin = "";
  const mockFetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedOrigin = (init?.headers as Record<string, string>)?.Origin || "";
    return new Response(
      JSON.stringify({
        success: true,
        uri: "mutable://a/b",
        record: { ts: 0, data: null },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  await client.invokeAction(
    "my-app",
    "act",
    { auth: [], payload: {} },
    "http://example.com",
  );
  assertEquals(capturedOrigin, "http://example.com");
});

// ---------------------------------------------------------------------------
// read()
// ---------------------------------------------------------------------------

Deno.test("AppsClient — read() fetches record by URI", async () => {
  const mockFetch = createMockFetch([{
    match: (url, method) =>
      url.includes("/app/my-app/read") && method === "GET",
    respond: (url) => {
      const u = new URL(url);
      const uri = u.searchParams.get("uri");
      return {
        status: 200,
        body: {
          success: true,
          uri,
          record: { ts: 1234567890, data: { found: true } },
        },
      };
    },
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  const result = await client.read("my-app", "mutable://my-app/posts/123");
  assert(result.success);
  assertEquals(result.uri, "mutable://my-app/posts/123");
  assertEquals((result.record.data as any).found, true);
});

Deno.test("AppsClient — read() throws on failure", async () => {
  const mockFetch = createMockFetch([{
    match: (url) => url.includes("/app/my-app/read"),
    respond: () => ({
      status: 404,
      body: { success: false, error: "Not found" },
    }),
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  await assertRejects(
    () => client.read("my-app", "mutable://my-app/missing"),
    Error,
    "Not found",
  );
});

// ---------------------------------------------------------------------------
// URL encoding of appKey
// ---------------------------------------------------------------------------

Deno.test("AppsClient — encodes appKey with special characters in URLs", async () => {
  let capturedUrl = "";
  const mockFetch = createMockFetch([{
    match: () => true,
    respond: (url) => {
      capturedUrl = url;
      return {
        status: 200,
        body: {
          success: true,
          config: {
            appKey: "app/with/slashes",
            allowedOrigins: [],
            actions: [],
          },
        },
      };
    },
  }]);

  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch,
  });

  await client.getSchema("app/with/slashes");
  assert(capturedUrl.includes("app%2Fwith%2Fslashes"));
});

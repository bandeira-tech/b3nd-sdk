/**
 * AppsClient Test Suite
 *
 * Tests for AppsClient — a lightweight HTTP client for the B3nd App Backend.
 * Uses a mock fetch to verify request construction, URL encoding, and error handling.
 */

/// <reference lib="deno.ns" />

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { AppsClient } from "./mod.ts";
import type { AuthenticatedMessage } from "./mod.ts";

// ============================================================================
// Helpers
// ============================================================================

/** Minimal Response-like object for mock fetch */
function mockResponse(
  body: unknown,
  status = 200,
  statusText = "OK",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

/** Create a mock fetch that records calls and returns canned responses */
function createMockFetch(
  handler: (url: string, init?: RequestInit) => Response,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { fn: fn as typeof fetch, calls };
}

// ============================================================================
// Constructor Validation
// ============================================================================

Deno.test("AppsClient — constructor requires appServerUrl", () => {
  let threw = false;
  try {
    new AppsClient({ appServerUrl: "", apiBasePath: "/api" });
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, "appServerUrl is required");
  }
  assertEquals(threw, true);
});

Deno.test("AppsClient — constructor requires apiBasePath", () => {
  let threw = false;
  try {
    new AppsClient({ appServerUrl: "http://localhost:3000", apiBasePath: "" });
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, "apiBasePath is required");
  }
  assertEquals(threw, true);
});

Deno.test("AppsClient — constructor normalizes trailing slashes", async () => {
  const { fn, calls } = createMockFetch(() => mockResponse({ status: "ok" }));
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000/",
    apiBasePath: "/api/v1/",
    fetch: fn,
  });

  await client.health();
  assertEquals(calls[0].url, "http://localhost:3000/api/v1/health");
});

Deno.test("AppsClient — constructor adds leading slash to apiBasePath", async () => {
  const { fn, calls } = createMockFetch(() => mockResponse({ status: "ok" }));
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "api",
    fetch: fn,
  });

  await client.health();
  assertEquals(calls[0].url, "http://localhost:3000/api/health");
});

// ============================================================================
// health()
// ============================================================================

Deno.test("AppsClient — health returns parsed JSON on success", async () => {
  const { fn } = createMockFetch(() =>
    mockResponse({ status: "ok", uptime: 123 })
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  const result = await client.health();
  assertEquals(result, { status: "ok", uptime: 123 });
});

Deno.test("AppsClient — health throws on non-ok response", async () => {
  const { fn } = createMockFetch(() =>
    mockResponse({}, 503, "Service Unavailable")
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await assertRejects(
    () => client.health(),
    Error,
    "health failed: Service Unavailable",
  );
});

// ============================================================================
// updateOrigins()
// ============================================================================

Deno.test("AppsClient — updateOrigins sends POST with correct URL and body", async () => {
  const { fn, calls } = createMockFetch(() => mockResponse({ success: true }));
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  const message: AuthenticatedMessage<{ allowedOrigins: string[] }> = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: { allowedOrigins: ["http://localhost:5173"] },
  };

  await client.updateOrigins("myapp", message);

  assertEquals(calls[0].url, "http://localhost:3000/api/apps/origins/myapp");
  assertEquals(calls[0].init?.method, "POST");
  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(body.payload.allowedOrigins, ["http://localhost:5173"]);
});

Deno.test("AppsClient — updateOrigins URL-encodes appKey", async () => {
  const { fn, calls } = createMockFetch(() => mockResponse({ success: true }));
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  const message: AuthenticatedMessage<{ allowedOrigins: string[] }> = {
    auth: [],
    payload: { allowedOrigins: [] },
  };

  await client.updateOrigins("key with spaces", message);
  assertEquals(calls[0].url.includes("key%20with%20spaces"), true);
});

Deno.test("AppsClient — updateOrigins throws on error response", async () => {
  const { fn } = createMockFetch(() =>
    mockResponse({ success: false, error: "unauthorized" }, 403)
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await assertRejects(
    () =>
      client.updateOrigins("myapp", {
        auth: [],
        payload: { allowedOrigins: [] },
      }),
    Error,
    "unauthorized",
  );
});

// ============================================================================
// updateGoogleClientId()
// ============================================================================

Deno.test("AppsClient — updateGoogleClientId sends to correct endpoint", async () => {
  const { fn, calls } = createMockFetch(() => mockResponse({ success: true }));
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await client.updateGoogleClientId("myapp", {
    auth: [{ pubkey: "pk", signature: "sig" }],
    payload: { googleClientId: "123456.apps.googleusercontent.com" },
  });

  assertEquals(
    calls[0].url,
    "http://localhost:3000/api/apps/google-client-id/myapp",
  );
  assertEquals(calls[0].init?.method, "POST");
});

Deno.test("AppsClient — updateGoogleClientId with null clears client id", async () => {
  const { fn, calls } = createMockFetch(() => mockResponse({ success: true }));
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await client.updateGoogleClientId("myapp", {
    auth: [],
    payload: { googleClientId: null },
  });

  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(body.payload.googleClientId, null);
});

// ============================================================================
// updateSchema()
// ============================================================================

Deno.test("AppsClient — updateSchema sends actions to correct endpoint", async () => {
  const { fn, calls } = createMockFetch(() => mockResponse({ success: true }));
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await client.updateSchema("myapp", {
    auth: [{ pubkey: "pk", signature: "sig" }],
    payload: {
      actions: [
        {
          action: "register",
          write: { plain: "mutable://app/users/{pubkey}" },
        },
      ],
    },
  });

  assertEquals(calls[0].url, "http://localhost:3000/api/apps/schema/myapp");
  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(body.payload.actions.length, 1);
  assertEquals(body.payload.actions[0].action, "register");
});

Deno.test("AppsClient — updateSchema throws on server error", async () => {
  const { fn } = createMockFetch(() =>
    mockResponse({ success: false, error: "invalid schema" }, 400)
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await assertRejects(
    () =>
      client.updateSchema("myapp", {
        auth: [],
        payload: { actions: [] },
      }),
    Error,
    "invalid schema",
  );
});

// ============================================================================
// getSchema()
// ============================================================================

Deno.test("AppsClient — getSchema sends GET to correct endpoint", async () => {
  const { fn, calls } = createMockFetch(() =>
    mockResponse({
      success: true,
      config: {
        appKey: "myapp",
        allowedOrigins: ["http://localhost:5173"],
        actions: [],
      },
    })
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  const result = await client.getSchema("myapp");
  assertEquals(calls[0].url, "http://localhost:3000/api/apps/schema/myapp");
  assertEquals(calls[0].init, undefined); // GET has no init
  assertEquals(result.success, true);
  assertEquals(result.config.appKey, "myapp");
});

Deno.test("AppsClient — getSchema throws on not found", async () => {
  const { fn } = createMockFetch(() =>
    mockResponse({ success: false, error: "app not found" }, 404)
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await assertRejects(
    () => client.getSchema("nonexistent"),
    Error,
    "app not found",
  );
});

// ============================================================================
// createSession()
// ============================================================================

Deno.test("AppsClient — createSession sends POST to session endpoint", async () => {
  const { fn, calls } = createMockFetch(() =>
    mockResponse({
      success: true,
      session: "sess_abc123",
      uri: "mutable://app/sessions/sess_abc123",
    })
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  const result = await client.createSession("myapp", {
    auth: [{ pubkey: "pk", signature: "sig" }],
    payload: { session: "sess_abc123" },
  });

  assertEquals(calls[0].url, "http://localhost:3000/api/app/myapp/session");
  assertEquals(result.success, true);
  assertEquals(result.session, "sess_abc123");
});

// ============================================================================
// invokeAction()
// ============================================================================

Deno.test("AppsClient — invokeAction sends POST with action in URL", async () => {
  const { fn, calls } = createMockFetch(() =>
    mockResponse({
      success: true,
      uri: "mutable://app/users/abc",
      record: { ts: 1000, data: { name: "Alice" } },
    })
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  const result = await client.invokeAction("myapp", "register", {
    auth: [{ pubkey: "pk", signature: "sig" }],
    payload: { name: "Alice" },
  });

  assertEquals(calls[0].url, "http://localhost:3000/api/app/myapp/register");
  assertEquals(result.success, true);
  assertEquals(result.uri, "mutable://app/users/abc");
});

Deno.test("AppsClient — invokeAction includes Origin header when provided", async () => {
  const { fn, calls } = createMockFetch(() =>
    mockResponse({
      success: true,
      uri: "mutable://app/test",
      record: { ts: 1, data: null },
    })
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await client.invokeAction(
    "myapp",
    "action",
    { auth: [], payload: {} },
    "http://localhost:5173",
  );

  const headers = calls[0].init?.headers as Record<string, string>;
  assertEquals(headers["Origin"], "http://localhost:5173");
});

Deno.test("AppsClient — invokeAction omits Origin header when not provided", async () => {
  const { fn, calls } = createMockFetch(() =>
    mockResponse({
      success: true,
      uri: "mutable://app/test",
      record: { ts: 1, data: null },
    })
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await client.invokeAction("myapp", "action", { auth: [], payload: {} });

  const headers = calls[0].init?.headers as Record<string, string>;
  assertEquals(headers["Origin"], undefined);
});

Deno.test("AppsClient — invokeAction URL-encodes action name", async () => {
  const { fn, calls } = createMockFetch(() =>
    mockResponse({
      success: true,
      uri: "mutable://test",
      record: { ts: 1, data: null },
    })
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await client.invokeAction("myapp", "my action", { auth: [], payload: {} });
  assertEquals(calls[0].url.includes("my%20action"), true);
});

// ============================================================================
// read()
// ============================================================================

Deno.test("AppsClient — read sends GET with uri query parameter", async () => {
  const { fn, calls } = createMockFetch(() =>
    mockResponse({
      success: true,
      uri: "mutable://app/users/alice",
      record: { ts: 1000, data: { name: "Alice" } },
    })
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  const result = await client.read("myapp", "mutable://app/users/alice");

  const url = new URL(calls[0].url);
  assertEquals(url.pathname, "/api/app/myapp/read");
  assertEquals(url.searchParams.get("uri"), "mutable://app/users/alice");
  assertEquals(result.success, true);
  assertEquals(result.record?.data, { name: "Alice" });
});

Deno.test("AppsClient — read throws on not found", async () => {
  const { fn } = createMockFetch(() =>
    mockResponse({ success: false, error: "not found" }, 404)
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await assertRejects(
    () => client.read("myapp", "mutable://nonexistent"),
    Error,
    "not found",
  );
});

Deno.test("AppsClient — read falls back to statusText when no error field", async () => {
  const { fn } = createMockFetch(() =>
    mockResponse({ success: false }, 500, "Internal Server Error")
  );
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: fn,
  });

  await assertRejects(
    () => client.read("myapp", "mutable://test"),
    Error,
    "Internal Server Error",
  );
});

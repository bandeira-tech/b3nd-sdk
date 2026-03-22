/**
 * AppsClient Tests
 *
 * Tests for the App Backend client using injected mock fetch.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { AppsClient } from "./mod.ts";
import type { AuthenticatedMessage } from "./mod.ts";

// ============================================================================
// Helpers
// ============================================================================

function mockFetch(
  status: number,
  body: unknown,
  checks?: (url: string, init?: RequestInit) => void,
): typeof fetch {
  return (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    checks?.(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function makeClient(
  fetchFn: typeof fetch,
  opts?: { appServerUrl?: string; apiBasePath?: string },
): AppsClient {
  return new AppsClient({
    appServerUrl: opts?.appServerUrl ?? "https://apps.example.com",
    apiBasePath: opts?.apiBasePath ?? "/api/v1",
    fetch: fetchFn,
  });
}

const testAuth: AuthenticatedMessage<unknown> = {
  auth: [{ pubkey: "abc123", signature: "sig456" }],
  payload: {},
};

// ============================================================================
// Constructor validation
// ============================================================================

Deno.test("AppsClient - throws when appServerUrl is missing", () => {
  try {
    // deno-lint-ignore no-explicit-any
    new AppsClient({ appServerUrl: "", apiBasePath: "/api" } as any);
    throw new Error("Should have thrown");
  } catch (e) {
    assertStringIncludes((e as Error).message, "appServerUrl is required");
  }
});

Deno.test("AppsClient - throws when apiBasePath is missing", () => {
  try {
    new AppsClient({
      appServerUrl: "https://example.com",
      apiBasePath: "",
    });
    throw new Error("Should have thrown");
  } catch (e) {
    assertStringIncludes((e as Error).message, "apiBasePath is required");
  }
});

Deno.test("AppsClient - normalizes trailing slashes and leading slashes", () => {
  let capturedUrl = "";
  const client = makeClient(
    mockFetch(200, { status: "healthy" }, (url) => {
      capturedUrl = url;
    }),
    { appServerUrl: "https://example.com/", apiBasePath: "api/v1/" },
  );

  // health() should produce clean URL
  client.health();
  assertStringIncludes(capturedUrl, "https://example.com/api/v1/health");
});

// ============================================================================
// health()
// ============================================================================

Deno.test("AppsClient - health() returns response on success", async () => {
  const client = makeClient(
    mockFetch(200, { status: "healthy", uptime: 42 }),
  );
  const result = await client.health();
  assertEquals((result as Record<string, unknown>).status, "healthy");
});

Deno.test("AppsClient - health() throws on non-ok response", async () => {
  const client = makeClient(
    mockFetch(503, { status: "unhealthy" }),
  );
  await assertRejects(
    () => client.health(),
    Error,
    "health failed",
  );
});

// ============================================================================
// updateOrigins()
// ============================================================================

Deno.test("AppsClient - updateOrigins() sends POST with message body", async () => {
  let capturedBody: string | undefined;
  let capturedUrl = "";

  const client = makeClient(
    mockFetch(200, { success: true }, (url, init) => {
      capturedUrl = url;
      capturedBody = init?.body as string;
    }),
  );

  const msg: AuthenticatedMessage<{
    allowedOrigins: string[];
  }> = {
    auth: [{ pubkey: "pk1", signature: "s1" }],
    payload: { allowedOrigins: ["https://app.example.com"] },
  };

  const result = await client.updateOrigins("myApp", msg);
  assertEquals(result.success, true);
  assertStringIncludes(capturedUrl, "/apps/origins/myApp");
  const parsed = JSON.parse(capturedBody!);
  assertEquals(parsed.payload.allowedOrigins, ["https://app.example.com"]);
});

Deno.test("AppsClient - updateOrigins() throws on failure", async () => {
  const client = makeClient(
    mockFetch(400, { success: false, error: "Invalid origins" }),
  );
  await assertRejects(
    () =>
      client.updateOrigins(
        "myApp",
        testAuth as AuthenticatedMessage<{ allowedOrigins?: string[] }>,
      ),
    Error,
    "Invalid origins",
  );
});

// ============================================================================
// updateGoogleClientId()
// ============================================================================

Deno.test("AppsClient - updateGoogleClientId() sends correct request", async () => {
  let capturedUrl = "";
  const client = makeClient(
    mockFetch(200, { success: true }, (url) => {
      capturedUrl = url;
    }),
  );

  const msg: AuthenticatedMessage<{ googleClientId: string }> = {
    auth: [{ pubkey: "pk1", signature: "s1" }],
    payload: { googleClientId: "goog-123.apps.googleusercontent.com" },
  };

  await client.updateGoogleClientId("myApp", msg);
  assertStringIncludes(capturedUrl, "/apps/google-client-id/myApp");
});

// ============================================================================
// updateSchema()
// ============================================================================

Deno.test("AppsClient - updateSchema() sends actions", async () => {
  let capturedBody: string | undefined;
  const client = makeClient(
    mockFetch(200, { success: true }, (_url, init) => {
      capturedBody = init?.body as string;
    }),
  );

  const msg: AuthenticatedMessage<{
    actions: Array<{ action: string; write: { plain: string } }>;
  }> = {
    auth: [{ pubkey: "pk1", signature: "s1" }],
    payload: {
      actions: [
        { action: "create-post", write: { plain: "mutable://posts/{id}" } },
      ],
    },
  };

  // deno-lint-ignore no-explicit-any
  const result = await client.updateSchema("myApp", msg as any);
  assertEquals(result.success, true);
  const parsed = JSON.parse(capturedBody!);
  assertEquals(parsed.payload.actions.length, 1);
  assertEquals(parsed.payload.actions[0].action, "create-post");
});

Deno.test("AppsClient - updateSchema() throws on server error", async () => {
  const client = makeClient(
    mockFetch(500, { success: false, error: "Schema too large" }),
  );
  await assertRejects(
    () =>
      // deno-lint-ignore no-explicit-any
      client.updateSchema("myApp", testAuth as any),
    Error,
    "Schema too large",
  );
});

// ============================================================================
// getSchema()
// ============================================================================

Deno.test("AppsClient - getSchema() returns config", async () => {
  const client = makeClient(
    mockFetch(200, {
      success: true,
      config: {
        appKey: "myApp",
        allowedOrigins: ["https://app.example.com"],
        actions: [{
          action: "create-post",
          write: { plain: "mutable://posts/{id}" },
        }],
      },
    }),
  );

  const result = await client.getSchema("myApp");
  assertEquals(result.success, true);
  assertEquals(result.config.appKey, "myApp");
  assertEquals(result.config.actions.length, 1);
});

Deno.test("AppsClient - getSchema() uses GET method", async () => {
  let capturedInit: RequestInit | undefined;
  const client = makeClient(
    mockFetch(200, {
      success: true,
      config: { appKey: "x", allowedOrigins: [], actions: [] },
    }, (_url, init) => {
      capturedInit = init;
    }),
  );

  await client.getSchema("myApp");
  // GET request should not have method or body set
  assertEquals(capturedInit, undefined);
});

// ============================================================================
// createSession()
// ============================================================================

Deno.test("AppsClient - createSession() returns session data", async () => {
  let capturedUrl = "";
  const client = makeClient(
    mockFetch(
      200,
      {
        success: true,
        session: "sess-abc",
        uri: "mutable://sessions/sess-abc",
      },
      (url) => {
        capturedUrl = url;
      },
    ),
  );

  const msg: AuthenticatedMessage<{ session: string }> = {
    auth: [{ pubkey: "pk1", signature: "s1" }],
    payload: { session: "sess-abc" },
  };

  const result = await client.createSession("myApp", msg);
  assertEquals(result.success, true);
  assertEquals(result.session, "sess-abc");
  assertStringIncludes(capturedUrl, "/app/myApp/session");
});

// ============================================================================
// invokeAction()
// ============================================================================

Deno.test("AppsClient - invokeAction() sends action request", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  const client = makeClient(
    mockFetch(
      200,
      {
        success: true,
        uri: "mutable://posts/post-1",
        record: { ts: 1000, data: { title: "Hello" } },
      },
      (url, init) => {
        capturedUrl = url;
        const headers = init?.headers as Record<string, string>;
        capturedHeaders = headers || {};
      },
    ),
  );

  // deno-lint-ignore no-explicit-any
  const result = await client.invokeAction(
    "myApp",
    "create-post",
    testAuth as any,
    "https://origin.com",
  );
  assertEquals(result.success, true);
  assertStringIncludes(capturedUrl, "/app/myApp/create-post");
  assertEquals(capturedHeaders["Origin"], "https://origin.com");
});

Deno.test("AppsClient - invokeAction() works without origin", async () => {
  let capturedHeaders: Record<string, string> = {};
  const client = makeClient(
    mockFetch(
      200,
      { success: true, uri: "mutable://test", record: { ts: 1, data: null } },
      (_url, init) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
      },
    ),
  );

  // deno-lint-ignore no-explicit-any
  await client.invokeAction("myApp", "action", testAuth as any);
  assertEquals(capturedHeaders["Origin"], undefined);
});

// ============================================================================
// read()
// ============================================================================

Deno.test("AppsClient - read() passes URI as query param", async () => {
  let capturedUrl = "";
  const client = makeClient(
    mockFetch(
      200,
      {
        success: true,
        uri: "mutable://data/key",
        record: { ts: 1000, data: { value: 42 } },
      },
      (url) => {
        capturedUrl = url;
      },
    ),
  );

  const result = await client.read("myApp", "mutable://data/key");
  assertEquals(result.success, true);
  assertEquals(result.record.data, { value: 42 });
  assertStringIncludes(capturedUrl, "/app/myApp/read");
  assertStringIncludes(capturedUrl, "uri=mutable");
});

Deno.test("AppsClient - read() throws on not found", async () => {
  const client = makeClient(
    mockFetch(404, { success: false, error: "Record not found" }),
  );
  await assertRejects(
    () => client.read("myApp", "mutable://missing"),
    Error,
    "Record not found",
  );
});

// ============================================================================
// URL encoding
// ============================================================================

Deno.test("AppsClient - encodes appKey in URL", async () => {
  let capturedUrl = "";
  const client = makeClient(
    mockFetch(200, {
      success: true,
      config: { appKey: "x", allowedOrigins: [], actions: [] },
    }, (url) => {
      capturedUrl = url;
    }),
  );

  await client.getSchema("app/with/slashes");
  assertStringIncludes(capturedUrl, encodeURIComponent("app/with/slashes"));
});

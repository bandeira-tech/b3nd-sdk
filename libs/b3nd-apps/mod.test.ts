import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { AppsClient } from "./mod.ts";

// ============================================================================
// Helpers
// ============================================================================

/** Create a mock fetch that returns a canned JSON response */
function mockFetch(
  response: Record<string, unknown>,
  status = 200,
): typeof fetch {
  return ((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        statusText: status >= 400 ? "Error" : "OK",
        headers: { "Content-Type": "application/json" },
      }),
    )) as unknown as typeof fetch;
}

/** Create a mock fetch that captures the request for assertions */
function capturingFetch(
  response: Record<string, unknown>,
  status = 200,
): {
  fetch: typeof fetch;
  lastUrl: () => string;
  lastInit: () => RequestInit | undefined;
} {
  let lastUrl = "";
  let lastInit: RequestInit | undefined;
  const f = ((input: string | URL | Request, init?: RequestInit) => {
    lastUrl = typeof input === "string" ? input : input.toString();
    lastInit = init;
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        statusText: status >= 400 ? "Error" : "OK",
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetch: f, lastUrl: () => lastUrl, lastInit: () => lastInit };
}

// ============================================================================
// Constructor
// ============================================================================

Deno.test("AppsClient - constructor requires appServerUrl", () => {
  assertThrows(
    () => new AppsClient({ appServerUrl: "", apiBasePath: "/api" }),
    Error,
    "appServerUrl is required",
  );
});

Deno.test("AppsClient - constructor requires apiBasePath", () => {
  assertThrows(
    () =>
      new AppsClient({
        appServerUrl: "http://localhost:3000",
        apiBasePath: "",
      }),
    Error,
    "apiBasePath is required",
  );
});

Deno.test("AppsClient - constructor normalizes trailing slashes", async () => {
  const capture = capturingFetch({ status: "healthy" });
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000/",
    apiBasePath: "/api/v1/",
    fetch: capture.fetch,
  });
  await client.health();
  assertEquals(
    capture.lastUrl(),
    "http://localhost:3000/api/v1/health",
  );
});

Deno.test("AppsClient - constructor adds leading slash to apiBasePath", async () => {
  const capture = capturingFetch({ status: "healthy" });
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "api/v1",
    fetch: capture.fetch,
  });
  await client.health();
  assertEquals(
    capture.lastUrl(),
    "http://localhost:3000/api/v1/health",
  );
});

// ============================================================================
// health()
// ============================================================================

Deno.test("health - returns response on success", async () => {
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch({ status: "healthy", uptime: 1234 }),
  });
  const result = await client.health();
  assertEquals((result as Record<string, unknown>).status, "healthy");
});

Deno.test("health - throws on HTTP error", async () => {
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch({}, 500),
  });
  await assertRejects(() => client.health(), Error, "health failed");
});

// ============================================================================
// updateOrigins()
// ============================================================================

Deno.test("updateOrigins - sends POST with authenticated message", async () => {
  const capture = capturingFetch({ success: true });
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: capture.fetch,
  });

  const msg = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: { allowedOrigins: ["http://localhost:5000"] },
  };
  const result = await client.updateOrigins("my-app", msg);
  assertEquals(result.success, true);
  assertEquals(capture.lastInit()?.method, "POST");
  assertEquals(
    capture.lastUrl(),
    "http://localhost:3000/api/apps/origins/my-app",
  );
});

Deno.test("updateOrigins - throws on failure", async () => {
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch({ success: false, error: "unauthorized" }, 403),
  });
  await assertRejects(
    () =>
      client.updateOrigins("my-app", {
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

Deno.test("updateGoogleClientId - sends POST correctly", async () => {
  const capture = capturingFetch({ success: true });
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: capture.fetch,
  });

  await client.updateGoogleClientId("my-app", {
    auth: [{ pubkey: "pk", signature: "sig" }],
    payload: { googleClientId: "client-id-123" },
  });
  assertEquals(
    capture.lastUrl(),
    "http://localhost:3000/api/apps/google-client-id/my-app",
  );
});

// ============================================================================
// updateSchema()
// ============================================================================

Deno.test("updateSchema - sends actions and returns success", async () => {
  const capture = capturingFetch({ success: true });
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: capture.fetch,
  });

  const result = await client.updateSchema("my-app", {
    auth: [{ pubkey: "pk", signature: "sig" }],
    payload: {
      actions: [{ action: "create", write: { plain: "mutable://data" } }],
    },
  });
  assertEquals(result.success, true);
  assertEquals(
    capture.lastUrl(),
    "http://localhost:3000/api/apps/schema/my-app",
  );
});

// ============================================================================
// getSchema()
// ============================================================================

Deno.test("getSchema - returns config on success", async () => {
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch({
      success: true,
      config: {
        appKey: "my-app",
        allowedOrigins: ["*"],
        actions: [],
      },
    }),
  });

  const result = await client.getSchema("my-app");
  assertEquals(result.config.appKey, "my-app");
  assertEquals(result.config.allowedOrigins, ["*"]);
});

Deno.test("getSchema - throws on failure", async () => {
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch({ success: false, error: "not found" }, 404),
  });
  await assertRejects(() => client.getSchema("missing"), Error, "not found");
});

// ============================================================================
// createSession()
// ============================================================================

Deno.test("createSession - returns session and uri", async () => {
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch({
      success: true,
      session: "sess-123",
      uri: "mutable://sessions/sess-123",
    }),
  });

  const result = await client.createSession("my-app", {
    auth: [{ pubkey: "pk", signature: "sig" }],
    payload: { session: "sess-123" },
  });
  assertEquals(result.session, "sess-123");
  assertEquals(result.uri, "mutable://sessions/sess-123");
});

// ============================================================================
// invokeAction()
// ============================================================================

Deno.test("invokeAction - sends action with origin header", async () => {
  const capture = capturingFetch({
    success: true,
    uri: "mutable://data/item1",
    record: { ts: 1234, data: { v: 1 } },
  });
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: capture.fetch,
  });

  const result = await client.invokeAction(
    "my-app",
    "create",
    { auth: [{ pubkey: "pk", signature: "sig" }], payload: { v: 1 } },
    "http://localhost:5000",
  );
  assertEquals(result.uri, "mutable://data/item1");
  assertEquals(
    capture.lastUrl(),
    "http://localhost:3000/api/app/my-app/create",
  );
  // Verify origin header was included
  const headers = capture.lastInit()?.headers as Record<string, string>;
  assertEquals(headers?.Origin, "http://localhost:5000");
});

Deno.test("invokeAction - works without origin", async () => {
  const capture = capturingFetch({
    success: true,
    uri: "mutable://data/item1",
    record: { ts: 1234, data: {} },
  });
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: capture.fetch,
  });

  await client.invokeAction("my-app", "create", {
    auth: [],
    payload: {},
  });
  const headers = capture.lastInit()?.headers as Record<string, string>;
  assertEquals(headers?.Origin, undefined);
});

// ============================================================================
// read()
// ============================================================================

Deno.test("read - returns record for given uri", async () => {
  const capture = capturingFetch({
    success: true,
    uri: "mutable://data/item1",
    record: { ts: 1234, data: { name: "test" } },
  });
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: capture.fetch,
  });

  const result = await client.read("my-app", "mutable://data/item1");
  assertEquals(result.uri, "mutable://data/item1");
  assertEquals(
    (result.record.data as Record<string, unknown>).name,
    "test",
  );
  // Verify URI is passed as query param
  assertEquals(
    capture.lastUrl().includes("uri=mutable"),
    true,
  );
});

Deno.test("read - throws on not found", async () => {
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: mockFetch({ success: false, error: "not found" }, 404),
  });
  await assertRejects(
    () => client.read("my-app", "mutable://data/missing"),
    Error,
    "not found",
  );
});

// ============================================================================
// URL encoding
// ============================================================================

Deno.test("AppsClient - encodes appKey in URL", async () => {
  const capture = capturingFetch({ success: true });
  const client = new AppsClient({
    appServerUrl: "http://localhost:3000",
    apiBasePath: "/api",
    fetch: capture.fetch,
  });

  await client.updateOrigins("app/with/slashes", {
    auth: [],
    payload: { allowedOrigins: [] },
  });
  assertEquals(
    capture.lastUrl().includes("app%2Fwith%2Fslashes"),
    true,
  );
});

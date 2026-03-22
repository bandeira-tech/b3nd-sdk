/**
 * AppsClient Tests
 *
 * Tests the AppsClient using a mock fetch implementation
 * to verify request construction, error handling, and response parsing.
 */

/// <reference lib="deno.ns" />

import { assertEquals, assertRejects } from "@std/assert";
import { AppsClient } from "./mod.ts";

// ── Mock fetch helper ──

type MockResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  body: unknown;
};

function createMockFetch(responses: Map<string, MockResponse>) {
  const calls: { url: string; init?: RequestInit }[] = [];

  const mockFetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    calls.push({ url, init });

    // Match by URL path (strip query params for matching)
    const urlPath = new URL(url).pathname;
    const match = responses.get(urlPath) ||
      responses.get(url) ||
      // Try matching with query params
      [...responses.entries()].find(([key]) => url.includes(key))?.[1];

    if (!match) {
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () => Promise.resolve({ error: "Not found" }),
      } as unknown as Response);
    }

    return Promise.resolve({
      ok: match.ok,
      status: match.status,
      statusText: match.statusText,
      json: () => Promise.resolve(match.body),
    } as unknown as Response);
  };

  return { fetch: mockFetch as unknown as typeof fetch, calls };
}

// ── Constructor tests ──

Deno.test("AppsClient - constructor requires appServerUrl", () => {
  try {
    new AppsClient({
      appServerUrl: "",
      apiBasePath: "/api/v1",
    });
    throw new Error("Should have thrown");
  } catch (e) {
    assertEquals((e as Error).message, "appServerUrl is required");
  }
});

Deno.test("AppsClient - constructor requires apiBasePath", () => {
  try {
    new AppsClient({
      appServerUrl: "https://example.com",
      apiBasePath: "",
    });
    throw new Error("Should have thrown");
  } catch (e) {
    assertEquals((e as Error).message, "apiBasePath is required");
  }
});

Deno.test("AppsClient - constructor normalizes URLs", () => {
  const { fetch, calls } = createMockFetch(
    new Map([
      [
        "/api/v1/health",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: { status: "ok" },
        },
      ],
    ]),
  );

  // Trailing slash on server URL should be stripped
  const client = new AppsClient({
    appServerUrl: "https://example.com/",
    apiBasePath: "api/v1/",
    fetch,
  });

  client.health();
  assertEquals(calls[0].url, "https://example.com/api/v1/health");
});

// ── Health tests ──

Deno.test("AppsClient - health returns response on success", async () => {
  const { fetch } = createMockFetch(
    new Map([
      [
        "/api/v1/health",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: { status: "healthy", uptime: 1234 },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  const result = await client.health();
  assertEquals(result, { status: "healthy", uptime: 1234 });
});

Deno.test("AppsClient - health throws on failure", async () => {
  const { fetch } = createMockFetch(
    new Map([
      [
        "/api/v1/health",
        {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          body: { error: "down" },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  await assertRejects(() => client.health(), Error, "Service Unavailable");
});

// ── updateOrigins tests ──

Deno.test("AppsClient - updateOrigins sends correct request", async () => {
  const { fetch, calls } = createMockFetch(
    new Map([
      [
        "/api/v1/apps/origins/app123",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: { success: true },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  const message = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: { allowedOrigins: ["https://app.example.com"] },
  };

  const result = await client.updateOrigins("app123", message);
  assertEquals(result, { success: true });
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(
    JSON.parse(calls[0].init?.body as string),
    message,
  );
});

Deno.test("AppsClient - updateOrigins throws on error response", async () => {
  const { fetch } = createMockFetch(
    new Map([
      [
        "/api/v1/apps/origins/app123",
        {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          body: { success: false, error: "Invalid origins" },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  await assertRejects(
    () =>
      client.updateOrigins("app123", {
        auth: [],
        payload: { allowedOrigins: [] },
      }),
    Error,
    "Invalid origins",
  );
});

// ── updateSchema tests ──

Deno.test("AppsClient - updateSchema sends correct request", async () => {
  const { fetch, calls } = createMockFetch(
    new Map([
      [
        "/api/v1/apps/schema/myapp",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: { success: true },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  const message = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: {
      actions: [
        {
          action: "subscribe",
          validation: { stringValue: { format: "email" as const } },
          write: { plain: "mutable://subscribers" },
        },
      ],
    },
  };

  const result = await client.updateSchema("myapp", message);
  assertEquals(result, { success: true });
  assertEquals(calls[0].init?.method, "POST");
});

// ── getSchema tests ──

Deno.test("AppsClient - getSchema returns config", async () => {
  const { fetch } = createMockFetch(
    new Map([
      [
        "/api/v1/apps/schema/myapp",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: {
            success: true,
            config: {
              appKey: "myapp",
              allowedOrigins: ["https://app.example.com"],
              actions: [
                {
                  action: "subscribe",
                  write: { plain: "mutable://subscribers" },
                },
              ],
            },
          },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  const result = await client.getSchema("myapp");
  assertEquals(result.success, true);
  assertEquals(result.config.appKey, "myapp");
  assertEquals(result.config.actions.length, 1);
});

// ── createSession tests ──

Deno.test("AppsClient - createSession sends correct request", async () => {
  const { fetch, calls } = createMockFetch(
    new Map([
      [
        "/api/v1/app/myapp/session",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: {
            success: true,
            session: "sess_abc123",
            uri: "mutable://sessions/sess_abc123",
          },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  const message = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: { session: "sess_abc123" },
  };

  const result = await client.createSession("myapp", message);
  assertEquals(result.success, true);
  assertEquals(result.session, "sess_abc123");
  assertEquals(calls[0].init?.method, "POST");
});

// ── invokeAction tests ──

Deno.test("AppsClient - invokeAction sends correct request", async () => {
  const { fetch, calls } = createMockFetch(
    new Map([
      [
        "/api/v1/app/myapp/subscribe",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: {
            success: true,
            uri: "mutable://subscribers/user1",
            record: { ts: 1234567890, data: { email: "user@example.com" } },
          },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  const message = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: { email: "user@example.com" },
  };

  const result = await client.invokeAction("myapp", "subscribe", message);
  assertEquals(result.success, true);
  assertEquals(result.uri, "mutable://subscribers/user1");
  assertEquals(calls[0].init?.method, "POST");
});

Deno.test("AppsClient - invokeAction passes Origin header", async () => {
  const { fetch, calls } = createMockFetch(
    new Map([
      [
        "/api/v1/app/myapp/subscribe",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: {
            success: true,
            uri: "mutable://subscribers/user1",
            record: { ts: 1234567890, data: {} },
          },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  await client.invokeAction(
    "myapp",
    "subscribe",
    { auth: [], payload: {} },
    "https://app.example.com",
  );

  const headers = calls[0].init?.headers as Record<string, string>;
  assertEquals(headers["Origin"], "https://app.example.com");
});

Deno.test("AppsClient - invokeAction throws on failure", async () => {
  const { fetch } = createMockFetch(
    new Map([
      [
        "/api/v1/app/myapp/subscribe",
        {
          ok: false,
          status: 403,
          statusText: "Forbidden",
          body: { success: false, error: "Origin not allowed" },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  await assertRejects(
    () =>
      client.invokeAction("myapp", "subscribe", {
        auth: [],
        payload: {},
      }),
    Error,
    "Origin not allowed",
  );
});

// ── read tests ──

Deno.test("AppsClient - read sends correct request with URI param", async () => {
  const { fetch, calls } = createMockFetch(
    new Map([
      [
        "/api/v1/app/myapp/read",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: {
            success: true,
            uri: "mutable://users/alice",
            record: { ts: 1234567890, data: { name: "Alice" } },
          },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  const result = await client.read("myapp", "mutable://users/alice");
  assertEquals(result.success, true);
  assertEquals(result.record.data, { name: "Alice" });

  // Verify URI was passed as query param
  const url = new URL(calls[0].url);
  assertEquals(url.searchParams.get("uri"), "mutable://users/alice");
});

Deno.test("AppsClient - read throws on not found", async () => {
  const { fetch } = createMockFetch(
    new Map([
      [
        "/api/v1/app/myapp/read",
        {
          ok: false,
          status: 404,
          statusText: "Not Found",
          body: { success: false, error: "Record not found" },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  await assertRejects(
    () => client.read("myapp", "mutable://users/nobody"),
    Error,
    "Record not found",
  );
});

// ── updateGoogleClientId tests ──

Deno.test("AppsClient - updateGoogleClientId sends correct request", async () => {
  const { fetch, calls } = createMockFetch(
    new Map([
      [
        "/api/v1/apps/google-client-id/myapp",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: { success: true },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  const message = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: { googleClientId: "123456.apps.googleusercontent.com" },
  };

  const result = await client.updateGoogleClientId("myapp", message);
  assertEquals(result, { success: true });
  assertEquals(calls[0].init?.method, "POST");
});

// ── URL encoding tests ──

Deno.test("AppsClient - encodes appKey in URLs", async () => {
  const { fetch, calls } = createMockFetch(
    new Map([
      [
        "/api/v1/apps/schema/my%20app",
        {
          ok: true,
          status: 200,
          statusText: "OK",
          body: {
            success: true,
            config: {
              appKey: "my app",
              allowedOrigins: [],
              actions: [],
            },
          },
        },
      ],
    ]),
  );

  const client = new AppsClient({
    appServerUrl: "https://example.com",
    apiBasePath: "/api/v1",
    fetch,
  });

  await client.getSchema("my app");
  assertEquals(calls[0].url.includes("my%20app"), true);
});

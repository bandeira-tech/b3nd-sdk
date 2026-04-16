/**
 * WalletClient Tests
 *
 * Tests the wallet client's construction, session management,
 * and HTTP method behavior using a mock fetch.
 */

/// <reference lib="deno.ns" />

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { generateSessionKeypair, WalletClient } from "./client.ts";
import type { AuthSession } from "./types.ts";

// ── Mock fetch ──────────────────────────────────────────────────────

function mockFetch(
  status: number,
  body: Record<string, unknown>,
): typeof fetch {
  return ((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

/** Track fetch calls for assertion */
function spyFetch(
  status: number,
  body: Record<string, unknown>,
): { fetch: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const spy = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { fetch: spy, calls };
}

const BASE_CONFIG = {
  walletServerUrl: "http://localhost:3001",
  apiBasePath: "/api/v1",
};

const TEST_SESSION: AuthSession = {
  username: "alice",
  token: "jwt-token-123",
  expiresIn: 3600,
};

// ── Construction ────────────────────────────────────────────────────

Deno.test("WalletClient - constructor requires apiBasePath", () => {
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    new WalletClient({ walletServerUrl: "http://x", apiBasePath: "" } as any);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("WalletClient - constructor normalizes URLs", () => {
  const { calls, fetch: spy } = spyFetch(200, {
    success: true,
    status: "ok",
    server: "test",
    timestamp: "now",
  });
  const client = new WalletClient({
    walletServerUrl: "http://localhost:3001/",
    apiBasePath: "api/v1/",
    fetch: spy,
  });
  client.health();
  assertEquals(calls[0].url, "http://localhost:3001/api/v1/health");
});

// ── Session management ──────────────────────────────────────────────

Deno.test("WalletClient - session starts null", () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {}),
  });
  assertEquals(client.getSession(), null);
  assertEquals(client.isAuthenticated(), false);
  assertEquals(client.getUsername(), null);
  assertEquals(client.getToken(), null);
});

Deno.test("WalletClient - setSession / getSession round-trip", () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {}),
  });
  client.setSession(TEST_SESSION);
  assertEquals(client.isAuthenticated(), true);
  assertEquals(client.getUsername(), "alice");
  assertEquals(client.getToken(), "jwt-token-123");
  assertEquals(client.getSession(), TEST_SESSION);
});

Deno.test("WalletClient - logout clears session", () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {}),
  });
  client.setSession(TEST_SESSION);
  client.logout();
  assertEquals(client.isAuthenticated(), false);
  assertEquals(client.getSession(), null);
});

// ── Health ───────────────────────────────────────────────────────────

Deno.test("WalletClient - health returns server status", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {
      success: true,
      status: "ok",
      server: "b3nd-wallet",
      timestamp: "2025-01-01T00:00:00Z",
    }),
  });
  const result = await client.health();
  assertEquals(result.status, "ok");
  assertEquals(result.server, "b3nd-wallet");
});

Deno.test("WalletClient - health throws on failure", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(503, {}),
  });
  await assertRejects(() => client.health(), Error, "Health check failed");
});

// ── Auth-required methods throw without session ─────────────────────

Deno.test("WalletClient - proxyWrite throws without session", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {}),
  });
  await assertRejects(
    () => client.proxyWrite({ uri: "mutable://test", data: {} }),
    Error,
    "Not authenticated",
  );
});

Deno.test("WalletClient - proxyRead throws without session", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {}),
  });
  await assertRejects(
    () => client.proxyRead({ uri: "mutable://test" }),
    Error,
    "Not authenticated",
  );
});

Deno.test("WalletClient - proxyReadMulti throws without session", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {}),
  });
  await assertRejects(
    () => client.proxyReadMulti({ uris: ["mutable://test"] }),
    Error,
    "Not authenticated",
  );
});

Deno.test("WalletClient - getPublicKeys throws without session", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {}),
  });
  await assertRejects(
    () => client.getPublicKeys("app-key"),
    Error,
    "Not authenticated",
  );
});

Deno.test("WalletClient - changePassword throws without session", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {}),
  });
  await assertRejects(
    () => client.changePassword("app-key", "old", "new"),
    Error,
    "Not authenticated",
  );
});

// ── Proxy write / read with session ─────────────────────────────────

Deno.test("WalletClient - proxyWrite sends correct request", async () => {
  const { fetch: spy, calls } = spyFetch(200, {
    success: true,
    uri: "mutable://test",
    data: { val: 1 },
  });
  const client = new WalletClient({ ...BASE_CONFIG, fetch: spy });
  client.setSession(TEST_SESSION);

  const result = await client.proxyWrite({
    uri: "mutable://test",
    data: { val: 1 },
    encrypt: true,
  });

  assertEquals(result.success, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "http://localhost:3001/api/v1/proxy/write");
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(
    calls[0].init?.headers?.["Authorization" as keyof HeadersInit],
    "Bearer jwt-token-123",
  );
});

Deno.test("WalletClient - proxyRead sends correct request", async () => {
  const { fetch: spy, calls } = spyFetch(200, {
    success: true,
    uri: "mutable://test",
    record: { data: "hello", ts: 1 },
  });
  const client = new WalletClient({ ...BASE_CONFIG, fetch: spy });
  client.setSession(TEST_SESSION);

  const result = await client.proxyRead({ uri: "mutable://test" });
  assertEquals(result.success, true);
  assertEquals(result.record?.data, "hello");
  assertEquals(calls[0].url.includes("/proxy/read"), true);
  assertEquals(calls[0].url.includes("uri=mutable"), true);
});

Deno.test("WalletClient - proxyReadMulti sends correct request", async () => {
  const { fetch: spy, calls } = spyFetch(200, {
    success: true,
    results: [
      { uri: "mutable://a", success: true, record: { data: 1, ts: 1 } },
      { uri: "mutable://b", success: true, record: { data: 2, ts: 1 } },
    ],
    summary: { total: 2, succeeded: 2, failed: 0 },
  });
  const client = new WalletClient({ ...BASE_CONFIG, fetch: spy });
  client.setSession(TEST_SESSION);

  const result = await client.proxyReadMulti({
    uris: ["mutable://a", "mutable://b"],
  });
  assertEquals(result.success, true);
  assertEquals(result.results.length, 2);
  assertEquals(calls[0].url, "http://localhost:3001/api/v1/proxy/read-multi");
});

// ── Public keys ─────────────────────────────────────────────────────

Deno.test("WalletClient - getPublicKeys returns keys", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {
      success: true,
      accountPublicKeyHex: "abc123",
      encryptionPublicKeyHex: "def456",
    }),
  });
  client.setSession(TEST_SESSION);

  const keys = await client.getPublicKeys("app-key");
  assertEquals(keys.accountPublicKeyHex, "abc123");
  assertEquals(keys.encryptionPublicKeyHex, "def456");
});

Deno.test("WalletClient - getPublicKeys requires appKey", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {}),
  });
  client.setSession(TEST_SESSION);
  await assertRejects(
    () => client.getPublicKeys(""),
    Error,
    "appKey is required",
  );
});

// ── Server keys ─────────────────────────────────────────────────────

Deno.test("WalletClient - getServerKeys returns keys", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {
      success: true,
      identityPublicKeyHex: "id-key",
      encryptionPublicKeyHex: "enc-key",
    }),
  });
  const keys = await client.getServerKeys();
  assertEquals(keys.identityPublicKeyHex, "id-key");
  assertEquals(keys.encryptionPublicKeyHex, "enc-key");
});

// ── Signup / Login ──────────────────────────────────────────────────

Deno.test("WalletClient - signup requires session keypair", async () => {
  const client = new WalletClient({
    ...BASE_CONFIG,
    fetch: mockFetch(200, {}),
  });
  await assertRejects(
    // deno-lint-ignore no-explicit-any
    () => client.signup("app-key", null as any, { type: "password", username: "a", password: "b" }),
    Error,
    "session keypair is required",
  );
});

Deno.test("WalletClient - signup sends authenticated message", async () => {
  const { fetch: spy, calls } = spyFetch(200, {
    success: true,
    username: "alice",
    token: "new-token",
    expiresIn: 3600,
  });
  const client = new WalletClient({ ...BASE_CONFIG, fetch: spy });
  const session = await generateSessionKeypair();

  const result = await client.signup("app-key", session, {
    type: "password",
    username: "alice",
    password: "password123",
  });

  assertEquals(result.username, "alice");
  assertEquals(result.token, "new-token");
  assertEquals(calls[0].url, "http://localhost:3001/api/v1/auth/signup/app-key");
  assertEquals(calls[0].init?.method, "POST");
});

Deno.test("WalletClient - login sends authenticated message", async () => {
  const { fetch: spy, calls } = spyFetch(200, {
    success: true,
    username: "alice",
    token: "login-token",
    expiresIn: 7200,
  });
  const client = new WalletClient({ ...BASE_CONFIG, fetch: spy });
  const session = await generateSessionKeypair();

  const result = await client.login("app-key", session, {
    type: "password",
    username: "alice",
    password: "password123",
  });

  assertEquals(result.username, "alice");
  assertEquals(result.token, "login-token");
  assertEquals(calls[0].url, "http://localhost:3001/api/v1/auth/login/app-key");
});

// ── generateSessionKeypair ──────────────────────────────────────────

Deno.test("generateSessionKeypair - returns hex keypair", async () => {
  const keypair = await generateSessionKeypair();
  assertEquals(typeof keypair.publicKeyHex, "string");
  assertEquals(typeof keypair.privateKeyHex, "string");
  assertEquals(keypair.publicKeyHex.length > 0, true);
  assertEquals(keypair.privateKeyHex.length > 0, true);
});

Deno.test("generateSessionKeypair - produces unique keys", async () => {
  const a = await generateSessionKeypair();
  const b = await generateSessionKeypair();
  assertEquals(a.publicKeyHex !== b.publicKeyHex, true);
});

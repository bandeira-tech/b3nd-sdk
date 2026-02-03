/// <reference lib="deno.ns" />
/**
 * E2E Test Suite — Deno.test wrapper
 *
 * Self-contained: starts its own test server, runs HTTP-level
 * assertions against the B3nd SDK API, then stops the server.
 *
 * Usage:
 *   deno test -A e2e.test.ts
 */

import { assertEquals } from "@std/assert";

const SERVER_PORT = 8787; // Non-standard port to avoid conflicts
const BASE_URL = `http://localhost:${SERVER_PORT}`;

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json();
  return { status: res.status, data };
}

function parseUri(uri: string) {
  const url = new URL(uri);
  return {
    protocol: url.protocol.replace(":", ""),
    domain: url.hostname,
    path: url.pathname,
  };
}

function readUrl(uri: string): string {
  const { protocol, domain, path } = parseUri(uri);
  return `${BASE_URL}/api/v1/read/${protocol}/${domain}${path}`;
}

function listUrl(uri: string): string {
  const { protocol, domain, path } = parseUri(uri);
  return `${BASE_URL}/api/v1/list/${protocol}/${domain}${path}`;
}

function deleteUrl(uri: string): string {
  const { protocol, domain, path } = parseUri(uri);
  return `${BASE_URL}/api/v1/delete/${protocol}/${domain}${path}`;
}

async function receive(uri: string, data: unknown) {
  return fetchJson(`${BASE_URL}/api/v1/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx: [uri, data] }),
  });
}

Deno.test({
  name: "E2E write-list-read suite",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    // --- Start test server ---
    const serverDir = new URL(".", import.meta.url).pathname;
    const command = new Deno.Command("deno", {
      args: ["run", "--allow-net", "--allow-env", "--allow-read", "test-server.ts"],
      cwd: serverDir,
      env: { ...Deno.env.toObject(), E2E_SERVER_PORT: String(SERVER_PORT) },
      stdout: "piped",
      stderr: "piped",
    });
    const server = command.spawn();

    // Wait for server to be ready
    let serverReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${BASE_URL}/api/v1/health`);
        if (res.ok) {
          serverReady = true;
          break;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!serverReady) {
      try {
        server.kill("SIGTERM");
      } catch { /* ignore */ }
      throw new Error("Test server failed to start within 15s");
    }

    try {
      // --- Tests ---

      await t.step("receive and read back", async () => {
        const uri = `test://write-test/e2e-${Date.now()}`;
        const data = { message: "hello", ts: Date.now() };

        const wr = await receive(uri, data);
        assertEquals(wr.data.accepted, true);

        const rd = await fetchJson(readUrl(uri));
        assertEquals(rd.status, 200);
        assertEquals(rd.data.data, data);
      });

      await t.step("read non-existent returns 404", async () => {
        const res = await fetch(readUrl("test://nonexistent/nothing"));
        assertEquals(res.status, 404);
        await res.body?.cancel();
      });

      await t.step("list returns items", async () => {
        const ns = `e2e-list-${Date.now()}`;
        for (let i = 0; i < 3; i++) {
          await receive(`test://list-test/${ns}/item${i}`, { i });
        }

        const lr = await fetchJson(`${BASE_URL}/api/v1/list/test/list-test/${ns}`);
        assertEquals(lr.status, 200);
        assertEquals(lr.data.data.length, 3);
      });

      await t.step("delete removes item", async () => {
        const ns = `e2e-del-${Date.now()}`;
        const uri = `test://write-test/${ns}/temp`;
        await receive(uri, { temp: true });

        const dr = await fetch(deleteUrl(uri), { method: "DELETE" });
        assertEquals(dr.status, 200);
        await dr.body?.cancel();

        const rr = await fetch(readUrl(uri));
        assertEquals(rr.status, 404);
        await rr.body?.cancel();
      });

      await t.step("health endpoint", async () => {
        const res = await fetchJson(`${BASE_URL}/api/v1/health`);
        assertEquals(res.data.status, "healthy");
      });

      await t.step("schema endpoint", async () => {
        const res = await fetchJson(`${BASE_URL}/api/v1/schema`);
        assertEquals(Array.isArray(res.data.schema), true);
      });

      await t.step("receive invalid transaction returns error", async () => {
        const res = await fetchJson(`${BASE_URL}/api/v1/receive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tx: ["invalid"] }),
        });
        assertEquals(res.data.accepted, false);
      });
    } finally {
      // --- Stop test server ---
      try {
        server.kill("SIGTERM");
      } catch { /* ignore */ }
      try {
        await server.stdout.cancel();
      } catch { /* ignore */ }
      try {
        await server.stderr.cancel();
      } catch { /* ignore */ }
    }
  },
});

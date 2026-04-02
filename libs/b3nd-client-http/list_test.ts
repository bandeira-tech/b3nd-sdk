/// <reference lib="deno.ns" />
/**
 * Tests for HttpClient.read() with trailing slash (list mode) error handling.
 *
 * Verifies that read("uri/") handles HTTP errors and network failures
 * gracefully (returns empty results on errors, per HttpClient._list behavior).
 */

import { assertEquals } from "@std/assert";
import { HttpClient } from "./mod.ts";

/** Create an HttpClient pointed at a mock server */
function createClientWithServer(handler: (req: Request) => Response): {
  client: HttpClient;
  server: Deno.HttpServer;
} {
  const server = Deno.serve({ port: 0, onListen: () => {} }, handler);
  const addr = server.addr as Deno.NetAddr;
  const client = new HttpClient({ url: `http://localhost:${addr.port}` });
  return { client, server };
}

Deno.test("read trailing slash: returns empty on HTTP 500", async () => {
  const { client, server } = createClientWithServer(
    () => new Response("Internal Server Error", { status: 500 }),
  );

  try {
    const results = await client.read("mutable://open/test/");
    assertEquals(results.length, 0);
  } finally {
    await server.shutdown();
  }
});

Deno.test("read trailing slash: returns empty on HTTP 404", async () => {
  const { client, server } = createClientWithServer(
    () => new Response("Not Found", { status: 404 }),
  );

  try {
    const results = await client.read("mutable://open/test/");
    assertEquals(results.length, 0);
  } finally {
    await server.shutdown();
  }
});

Deno.test("read trailing slash: returns empty on network error", async () => {
  // Connect to a port that's not listening
  const client = new HttpClient({ url: "http://localhost:1" });
  const results = await client.read("mutable://open/test/");
  assertEquals(results.length, 0);
});

Deno.test("read trailing slash: returns results on HTTP 200", async () => {
  // The HttpClient._list expects { data: [{ uri }] } from the server,
  // then fetches each URI individually via _readOne. Mock both calls.
  let callCount = 0;
  const { client, server } = createClientWithServer((req) => {
    callCount++;
    if (callCount === 1) {
      // First call: list endpoint returns URIs
      const mockData = {
        data: [
          { uri: "mutable://open/test/item1" },
          { uri: "mutable://open/test/item2" },
        ],
      };
      return new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Subsequent calls: _readOne for each URI
    return new Response(JSON.stringify({ data: { value: callCount }, ts: Date.now() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    const results = await client.read("mutable://open/test/");
    assertEquals(results.length, 2);
    assertEquals(results[0].success, true);
    assertEquals(results[1].success, true);
  } finally {
    await server.shutdown();
  }
});

/// <reference lib="deno.ns" />
/**
 * Tests for HttpClient.list() error handling.
 *
 * Verifies that list() returns { success: false, error } on HTTP errors
 * and network failures, instead of silently returning empty results.
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

Deno.test("list: returns success:false on HTTP 500", async () => {
  const { client, server } = createClientWithServer(
    () => new Response("Internal Server Error", { status: 500 }),
  );

  try {
    const result = await client.list("mutable://open/test/");
    assertEquals(result.success, false);
    assertEquals("error" in result, true);
    if (!result.success) {
      assertEquals(result.error.includes("500"), true);
    }
  } finally {
    await server.shutdown();
  }
});

Deno.test("list: returns success:false on HTTP 404", async () => {
  const { client, server } = createClientWithServer(
    () => new Response("Not Found", { status: 404 }),
  );

  try {
    const result = await client.list("mutable://open/test/");
    assertEquals(result.success, false);
    if (!result.success) {
      assertEquals(result.error.includes("404"), true);
    }
  } finally {
    await server.shutdown();
  }
});

Deno.test("list: returns success:false on network error", async () => {
  // Connect to a port that's not listening
  const client = new HttpClient({ url: "http://localhost:1" });
  const result = await client.list("mutable://open/test/");
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(typeof result.error, "string");
    assertEquals(result.error.length > 0, true);
  }
});

Deno.test("list: returns success:true with data on HTTP 200", async () => {
  const mockData = {
    success: true,
    data: [{ uri: "mutable://open/test/item1" }, {
      uri: "mutable://open/test/item2",
    }],
    pagination: { page: 1, limit: 50, total: 2 },
  };

  const { client, server } = createClientWithServer(
    () =>
      new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  try {
    const result = await client.list("mutable://open/test/");
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.length, 2);
      assertEquals(result.data[0].uri, "mutable://open/test/item1");
    }
  } finally {
    await server.shutdown();
  }
});

Deno.test("list: passes query parameters correctly", async () => {
  let capturedUrl = "";
  const mockData = {
    success: true,
    data: [],
    pagination: { page: 2, limit: 10 },
  };

  const { client, server } = createClientWithServer((req) => {
    capturedUrl = req.url;
    return new Response(JSON.stringify(mockData), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    await client.list("mutable://open/test/", {
      page: 2,
      limit: 10,
      sortBy: "timestamp",
      sortOrder: "desc",
    });
    assertEquals(capturedUrl.includes("page=2"), true);
    assertEquals(capturedUrl.includes("limit=10"), true);
    assertEquals(capturedUrl.includes("sortBy=timestamp"), true);
    assertEquals(capturedUrl.includes("sortOrder=desc"), true);
  } finally {
    await server.shutdown();
  }
});

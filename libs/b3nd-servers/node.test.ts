/**
 * Server Node Tests
 *
 * Tests for createServerNode which wires frontends to backends.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { createServerNode } from "./node.ts";
import type { ServerFrontend } from "./node.ts";
import type { Message, NodeProtocolInterface } from "../b3nd-core/types.ts";

// ============================================================================
// Helpers
// ============================================================================

function createMockFrontend(): ServerFrontend & {
  configuredWith: unknown;
  listenedPort: number | null;
} {
  const mock = {
    configuredWith: null as unknown,
    listenedPort: null as number | null,
    listen(port: number) {
      mock.listenedPort = port;
    },
    fetch(req: Request) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    configure(opts: unknown) {
      mock.configuredWith = opts;
    },
  };
  return mock;
}

function createMockClient(): NodeProtocolInterface {
  return {
    receive: async ([uri, data]: Message) => ({
      accepted: true,
      uri,
      record: { ts: Date.now(), data },
    }),
    read: async () => ({
      success: true,
      record: { ts: Date.now(), data: {} },
    }),
    readMulti: async (uris: string[]) => ({
      success: true,
      results: uris.map((uri) => ({
        uri,
        success: true as const,
        record: { ts: Date.now(), data: {} },
      })),
      summary: { total: uris.length, succeeded: uris.length, failed: 0 },
    }),
    list: async () => ({
      success: true as const,
      data: [],
      pagination: { page: 1, limit: 50, total: 0 },
    }),
    delete: async () => ({ success: true }),
    health: async () => ({ status: "healthy" as const }),
    getSchema: async () => [],
    cleanup: async () => {},
  } as NodeProtocolInterface;
}

// ============================================================================
// createServerNode with client (new path)
// ============================================================================

Deno.test("createServerNode - client path configures frontend", () => {
  const frontend = createMockFrontend();
  const client = createMockClient();

  const node = createServerNode({ frontend, client });

  assertEquals(typeof node.serverHandler, "function");
  assertEquals(typeof node.listen, "function");
  assertEquals(
    (frontend.configuredWith as Record<string, unknown>).client,
    client,
  );
});

Deno.test("createServerNode - client path serverHandler delegates to frontend.fetch", async () => {
  const frontend = createMockFrontend();
  const client = createMockClient();

  const node = createServerNode({ frontend, client });
  const res = await node.serverHandler(
    new Request("http://localhost/api/v1/health"),
  );
  assertEquals(res.status, 200);
});

Deno.test("createServerNode - client path listen delegates to frontend.listen", () => {
  const frontend = createMockFrontend();
  const client = createMockClient();

  const node = createServerNode({ frontend, client });
  node.listen(8080);
  assertEquals(frontend.listenedPort, 8080);
});

// ============================================================================
// createServerNode with legacy backend+schema path
// ============================================================================

Deno.test("createServerNode - legacy path configures frontend with backend+schema", () => {
  const frontend = createMockFrontend();
  const backend = {
    write: createMockClient(),
    read: createMockClient(),
  };
  const schema = { "mutable://test": async () => ({ valid: true }) };

  const node = createServerNode({ frontend, backend, schema });

  assertEquals(typeof node.serverHandler, "function");
  const config = frontend.configuredWith as Record<string, unknown>;
  assertEquals(config.backend, backend);
  assertEquals(config.schema, schema);
});

// ============================================================================
// createServerNode error cases
// ============================================================================

Deno.test("createServerNode - throws when frontend missing", () => {
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => createServerNode({} as any),
    Error,
    "frontend is required",
  );
});

Deno.test("createServerNode - legacy path throws when backend.write missing", () => {
  const frontend = createMockFrontend();
  assertThrows(
    () =>
      createServerNode({
        frontend,
        // deno-lint-ignore no-explicit-any
        backend: { read: createMockClient() } as any,
        schema: {},
      }),
    Error,
    "backend write/read are required",
  );
});

Deno.test("createServerNode - legacy path throws when schema missing", () => {
  const frontend = createMockFrontend();
  assertThrows(
    () =>
      createServerNode({
        frontend,
        backend: {
          write: createMockClient(),
          read: createMockClient(),
        },
      }),
    Error,
    "schema is required",
  );
});

/// <reference lib="deno.ns" />
/**
 * Tests for b3nd-servers createServerNode.
 *
 * Validates the server node factory that wires frontends to backends.
 */

import {
  assertEquals,
  assertThrows,
} from "@std/assert";
import { createServerNode } from "./node.ts";
import type { ServerFrontend, ServerNodeOptions } from "./node.ts";
import type {
  Message,
  NodeProtocolInterface,
  Schema,
} from "../b3nd-core/types.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockFrontend(): ServerFrontend & {
  configured: boolean;
  configOpts: unknown;
} {
  const mock = {
    configured: false,
    configOpts: null as unknown,
    listen(_port: number) {},
    fetch(_req: Request) {
      return new Response("ok");
    },
    configure(opts: unknown) {
      mock.configured = true;
      mock.configOpts = opts;
    },
  };
  return mock;
}

function createMockClient(): NodeProtocolInterface {
  return {
    receive: async () => ({ accepted: true }),
    delete: async () => ({ success: true }),
    health: async () => ({ status: "healthy" as const }),
    getSchema: async () => [],
    cleanup: async () => {},
    read: async () => ({ success: false }),
    readMulti: async () => ({
      success: true,
      results: [],
      summary: { total: 0, succeeded: 0, failed: 0 },
    }),
    list: async () => ({
      success: true as const,
      data: [],
      pagination: { page: 1, limit: 50, total: 0 },
    }),
  };
}

function createMockBackend() {
  return {
    write: {
      receive: async (_msg: Message) => ({ accepted: true }),
      delete: async () => ({ success: true }),
      health: async () => ({ status: "healthy" as const }),
      getSchema: async () => ["mutable://"],
      cleanup: async () => {},
    },
    read: {
      read: async () => ({ success: false }),
      readMulti: async () => ({
        success: true,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      }),
      list: async () => ({
        success: true as const,
        data: [],
        pagination: { page: 1, limit: 50, total: 0 },
      }),
      health: async () => ({ status: "healthy" as const }),
      getSchema: async () => ["mutable://"],
      cleanup: async () => {},
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("createServerNode — throws when frontend is missing", () => {
  assertThrows(
    () => createServerNode({} as ServerNodeOptions),
    Error,
    "frontend is required",
  );
});

Deno.test("createServerNode — configures with client", () => {
  const frontend = createMockFrontend();
  const client = createMockClient();

  const result = createServerNode({ frontend, client });

  assertEquals(frontend.configured, true);
  assertEquals((frontend.configOpts as { client: unknown }).client, client);
  assertEquals(typeof result.serverHandler, "function");
  assertEquals(typeof result.listen, "function");
});

Deno.test("createServerNode — configures with legacy backend + schema", () => {
  const frontend = createMockFrontend();
  const backend = createMockBackend();
  const schema: Schema = {
    "mutable://": async () => ({ valid: true }),
  };

  const result = createServerNode({ frontend, backend, schema });

  assertEquals(frontend.configured, true);
  const opts = frontend.configOpts as {
    backend: unknown;
    schema: unknown;
  };
  assertEquals(opts.backend, backend);
  assertEquals(opts.schema, schema);
  assertEquals(typeof result.serverHandler, "function");
});

Deno.test("createServerNode — throws when backend write/read missing (legacy)", () => {
  const frontend = createMockFrontend();
  const schema: Schema = {};

  assertThrows(
    () => createServerNode({ frontend, schema } as ServerNodeOptions),
    Error,
    "backend write/read are required",
  );
});

Deno.test("createServerNode — throws when schema missing (legacy)", () => {
  const frontend = createMockFrontend();
  const backend = createMockBackend();

  assertThrows(
    () => createServerNode({ frontend, backend } as ServerNodeOptions),
    Error,
    "schema is required",
  );
});

Deno.test("createServerNode — serverHandler delegates to frontend.fetch", async () => {
  const frontend = createMockFrontend();
  const client = createMockClient();

  const { serverHandler } = createServerNode({ frontend, client });
  const res = await serverHandler(new Request("http://localhost/test"));
  assertEquals(res.status, 200);
});

Deno.test("createServerNode — prefers client over legacy backend", () => {
  const frontend = createMockFrontend();
  const client = createMockClient();
  const backend = createMockBackend();
  const schema: Schema = {};

  // When client is provided, it takes the "new simplified path"
  createServerNode({ frontend, client, backend, schema });

  const opts = frontend.configOpts as { client: unknown };
  assertEquals(opts.client, client);
});

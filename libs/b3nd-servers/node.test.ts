import { assertEquals, assertThrows } from "@std/assert";
import { createServerNode } from "./node.ts";
import type { ServerFrontend } from "./node.ts";
import type {
  Message,
  NodeProtocolInterface,
  ReceiveResult,
} from "../b3nd-core/types.ts";

// ── Helpers ──

function createMockFrontend(): ServerFrontend & {
  configured: boolean;
  configuredWith: unknown;
} {
  const state = {
    configured: false,
    configuredWith: null as unknown,
  };
  return {
    get configured() {
      return state.configured;
    },
    get configuredWith() {
      return state.configuredWith;
    },
    listen(_port: number) {},
    fetch(_req: Request) {
      return new Response("ok");
    },
    configure(opts) {
      state.configured = true;
      state.configuredWith = opts;
    },
  };
}

const now = Date.now();

function createMockClient(): NodeProtocolInterface {
  const base = {
    health: () =>
      Promise.resolve({ status: "healthy" as const, timestamp: now }),
    getSchema: () => Promise.resolve([]),
    receive: (msg: Message) =>
      Promise.resolve({ accepted: true, uri: msg[0] } as ReceiveResult),
    read: () =>
      Promise.resolve({
        success: true,
        record: { ts: now, data: {} },
      }),
    readMulti: (uris: string[]) =>
      Promise.resolve({
        success: true,
        results: uris.map((uri) => ({
          uri,
          success: true as const,
          record: { ts: now, data: {} },
        })),
        summary: { total: uris.length, succeeded: uris.length, failed: 0 },
      }),
    list: () =>
      Promise.resolve({
        success: true as const,
        data: [],
        pagination: { page: 1, limit: 50, total: 0 },
      }),
    delete: () => Promise.resolve({ success: true }),
    cleanup: () => Promise.resolve(),
  };
  return base as unknown as NodeProtocolInterface;
}

// ── createServerNode tests ──

Deno.test("createServerNode - throws when no frontend provided", () => {
  assertThrows(
    () => createServerNode({} as any),
    Error,
    "frontend is required",
  );
});

Deno.test("createServerNode - throws when frontend is null", () => {
  assertThrows(
    () => createServerNode({ frontend: null } as any),
    Error,
    "frontend is required",
  );
});

Deno.test("createServerNode - client path configures frontend with client", () => {
  const frontend = createMockFrontend();
  const client = createMockClient();

  const result = createServerNode({ frontend, client });

  assertEquals(frontend.configured, true);
  assertEquals(typeof result.serverHandler, "function");
  assertEquals(typeof result.listen, "function");
});

Deno.test("createServerNode - client path serverHandler delegates to frontend.fetch", async () => {
  const frontend = createMockFrontend();
  const client = createMockClient();
  const { serverHandler } = createServerNode({ frontend, client });

  const res = await serverHandler(new Request("http://localhost/test"));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ok");
});

Deno.test("createServerNode - legacy path requires backend write/read", () => {
  const frontend = createMockFrontend();

  assertThrows(
    () => createServerNode({ frontend, schema: {} } as any),
    Error,
    "backend write/read are required",
  );
});

Deno.test("createServerNode - legacy path requires schema", () => {
  const frontend = createMockFrontend();
  const backend = {
    write: { receive: () => Promise.resolve({ accepted: true }) },
    read: { read: () => Promise.resolve({ success: true }) },
  };

  assertThrows(
    () => createServerNode({ frontend, backend } as any),
    Error,
    "schema is required",
  );
});

Deno.test("createServerNode - legacy path configures frontend with backend+schema", () => {
  const frontend = createMockFrontend();
  const backend = {
    write: { receive: () => Promise.resolve({ accepted: true }) },
    read: { read: () => Promise.resolve({ success: true }) },
  };
  const schema = { "mutable://test": () => ({ valid: true }) };

  const result = createServerNode({
    frontend,
    backend: backend as any,
    schema: schema as any,
  });

  assertEquals(frontend.configured, true);
  assertEquals(typeof result.serverHandler, "function");
  assertEquals(typeof result.listen, "function");
});

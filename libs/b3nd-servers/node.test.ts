import { assertEquals, assertThrows } from "@std/assert";
import { createServerNode } from "./node.ts";
import type { ServerFrontend, ServerNodeOptions } from "./node.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";
import type {
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
} from "../b3nd-core/types.ts";

// ============================================================================
// Helpers
// ============================================================================

function createTestSchema() {
  return {
    "mutable://test": () => Promise.resolve({ valid: true }),
  };
}

function createMockFrontend(): ServerFrontend & {
  configuredWith: Record<string, unknown> | null;
  listenedPort: number | null;
} {
  const state = {
    configuredWith: null as Record<string, unknown> | null,
    listenedPort: null as number | null,
  };
  return {
    get configuredWith() {
      return state.configuredWith;
    },
    get listenedPort() {
      return state.listenedPort;
    },
    listen(port: number) {
      state.listenedPort = port;
    },
    fetch(_req: Request) {
      return new Response("ok");
    },
    configure(opts) {
      state.configuredWith = opts as unknown as Record<string, unknown>;
    },
  };
}

// ============================================================================
// createServerNode - validation
// ============================================================================

Deno.test("createServerNode - throws when frontend is missing", () => {
  assertThrows(
    () => createServerNode({} as ServerNodeOptions),
    Error,
    "frontend is required",
  );
});

Deno.test(
  "createServerNode - throws when backend.write missing (legacy path)",
  () => {
    const frontend = createMockFrontend();
    assertThrows(
      () =>
        createServerNode({
          frontend,
          backend: {
            write: undefined as unknown as NodeProtocolWriteInterface,
            read: {} as NodeProtocolReadInterface,
          },
          schema: createTestSchema(),
        }),
      Error,
      "backend write/read are required",
    );
  },
);

Deno.test(
  "createServerNode - throws when schema missing (legacy path)",
  () => {
    const frontend = createMockFrontend();
    const schema = createTestSchema();
    const client = new MemoryClient({ schema });
    assertThrows(
      () =>
        createServerNode({
          frontend,
          backend: { write: client, read: client },
        }),
      Error,
      "schema is required",
    );
  },
);

// ============================================================================
// createServerNode - client path
// ============================================================================

Deno.test("createServerNode - configures frontend with client", () => {
  const frontend = createMockFrontend();
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });

  const { serverHandler, listen } = createServerNode({ frontend, client });

  assertEquals(typeof serverHandler, "function");
  assertEquals(typeof listen, "function");
  assertEquals(
    frontend.configuredWith !== null && "client" in frontend.configuredWith,
    true,
  );
});

Deno.test(
  "createServerNode - serverHandler delegates to frontend.fetch",
  async () => {
    const frontend = createMockFrontend();
    const schema = createTestSchema();
    const client = new MemoryClient({ schema });

    const { serverHandler } = createServerNode({ frontend, client });
    const res = await serverHandler(new Request("http://localhost/test"));
    assertEquals(res.status, 200);
  },
);

Deno.test("createServerNode - listen delegates to frontend.listen", () => {
  const frontend = createMockFrontend();
  const schema = createTestSchema();
  const client = new MemoryClient({ schema });

  const { listen } = createServerNode({ frontend, client });
  listen(9999);
  assertEquals(frontend.listenedPort, 9999);
});

// ============================================================================
// createServerNode - legacy path
// ============================================================================

Deno.test(
  "createServerNode - configures frontend with backend + schema",
  () => {
    const frontend = createMockFrontend();
    const schema = createTestSchema();
    const client = new MemoryClient({ schema });

    createServerNode({
      frontend,
      backend: { write: client, read: client },
      schema,
    });

    assertEquals(
      frontend.configuredWith !== null &&
        "backend" in frontend.configuredWith,
      true,
    );
    assertEquals(
      frontend.configuredWith !== null && "schema" in frontend.configuredWith,
      true,
    );
  },
);

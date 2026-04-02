/**
 * Message Envelope Client Tests
 *
 * Verifies that unpacked MessageData outputs are correctly stored and
 * accessible through standard client operations (read, read with array, read with trailing slash).
 * Unpacking happens inside the client's receive method, not at the node level.
 */

import { assertEquals } from "@std/assert";
import type { MessageData } from "./data/types.ts";
import type { Schema } from "../b3nd-core/types.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";
import { createValidatedClient, msgSchema } from "../b3nd-compose/mod.ts";

function createTestSetup() {
  const schema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "immutable://open": async ([uri], _upstream, read) => {
      const existing = await read(uri);
      return { valid: !existing.success };
    },
    "msg://open": async () => ({ valid: true }),
  };

  const client = new MemoryClient();

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(schema),
  });

  return { client, node };
}

// =============================================================================
// MemoryClient: read individual outputs
// =============================================================================

Deno.test("MemoryClient - read each output URI individually", async () => {
  const { client, node } = createTestSetup();

  const msgData: MessageData = {
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/users/alice", { name: "Alice", age: 30 }],
        ["mutable://open/users/bob", { name: "Bob", age: 25 }],
        ["mutable://open/settings/theme", { dark: true }],
      ],
    },
  };

  const result = await node.receive(["msg://open/batch-1", msgData]);
  assertEquals(result.accepted, true);

  const alice = await client.read("mutable://open/users/alice");
  assertEquals(alice[0].success, true);
  assertEquals(alice[0].record?.data, { name: "Alice", age: 30 });

  const bob = await client.read("mutable://open/users/bob");
  assertEquals(bob[0].success, true);
  assertEquals(bob[0].record?.data, { name: "Bob", age: 25 });

  const theme = await client.read("mutable://open/settings/theme");
  assertEquals(theme[0].success, true);
  assertEquals(theme[0].record?.data, { dark: true });
});

// =============================================================================
// MemoryClient: list outputs under parent URI (trailing slash)
// =============================================================================

Deno.test("MemoryClient - list outputs under a parent URI via trailing slash", async () => {
  const { client, node } = createTestSetup();

  const msgData: MessageData = {
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/items/1", { title: "Item 1" }],
        ["mutable://open/items/2", { title: "Item 2" }],
        ["mutable://open/items/3", { title: "Item 3" }],
      ],
    },
  };

  const result = await node.receive(["msg://open/batch-list", msgData]);
  assertEquals(result.accepted, true);

  const results = await client.read("mutable://open/items/");
  assertEquals(results.length, 3);
  const uris = results.filter((r) => r.success).map((r) => r.uri!).sort();
  assertEquals(uris, [
    "mutable://open/items/1",
    "mutable://open/items/2",
    "mutable://open/items/3",
  ]);
});


// =============================================================================
// MemoryClient: read multiple output URIs
// =============================================================================

Deno.test("MemoryClient - read multiple output URIs", async () => {
  const { client, node } = createTestSetup();

  const msgData: MessageData = {
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/multi/1", { v: 1 }],
        ["mutable://open/multi/2", { v: 2 }],
        ["mutable://open/multi/3", { v: 3 }],
      ],
    },
  };

  const result = await node.receive(["msg://open/batch-multi", msgData]);
  assertEquals(result.accepted, true);

  const results = await client.read([
    "mutable://open/multi/1",
    "mutable://open/multi/2",
    "mutable://open/multi/3",
    "mutable://open/multi/missing", // Not stored
  ]);

  assertEquals(results.length, 4);

  const successResults = results.filter((r) => r.success);
  assertEquals(successResults.length, 3);

  const failedResults = results.filter((r) => !r.success);
  assertEquals(failedResults.length, 1);
});

// =============================================================================
// MemoryClient: message envelope is also stored
// =============================================================================

Deno.test("MemoryClient - message envelope is stored alongside outputs", async () => {
  const { client, node } = createTestSetup();

  const msgData: MessageData = {
    payload: {
      inputs: ["mutable://open/ref/1"],
      outputs: [
        ["mutable://open/out/1", { value: 42 }],
      ],
    },
  };

  const result = await node.receive(["msg://open/envelope-test", msgData]);
  assertEquals(result.accepted, true);

  // The envelope itself is stored
  const envelope = await client.read<MessageData>(
    "msg://open/envelope-test",
  );
  assertEquals(envelope[0].success, true);
  assertEquals(envelope[0].record?.data.payload.inputs, ["mutable://open/ref/1"]);
  assertEquals(envelope[0].record?.data.payload.outputs.length, 1);

  // The output is also stored individually
  const output = await client.read("mutable://open/out/1");
  assertEquals(output[0].success, true);
  assertEquals(output[0].record?.data, { value: 42 });
});

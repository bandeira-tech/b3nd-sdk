/**
 * Message Envelope Client Tests
 *
 * Verifies that unpacked MessageData outputs are correctly stored and
 * accessible through standard client operations (read, list, delete, readMulti).
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
    "immutable://open": async ({ uri, read }) => {
      const existing = await read(uri);
      return { valid: !existing.success };
    },
    "msg://open": async () => ({ valid: true }),
  };

  const client = new MemoryClient({ schema });

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
  assertEquals(alice.success, true);
  assertEquals(alice.record?.data, { name: "Alice", age: 30 });

  const bob = await client.read("mutable://open/users/bob");
  assertEquals(bob.success, true);
  assertEquals(bob.record?.data, { name: "Bob", age: 25 });

  const theme = await client.read("mutable://open/settings/theme");
  assertEquals(theme.success, true);
  assertEquals(theme.record?.data, { dark: true });
});

// =============================================================================
// MemoryClient: list outputs under parent URI
// =============================================================================

Deno.test("MemoryClient - list outputs under a parent URI", async () => {
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

  const list = await client.list("mutable://open/items");
  assertEquals(list.success, true);
  if (list.success) {
    assertEquals(list.data.length, 3);
    const uris = list.data.map((item) => item.uri).sort();
    assertEquals(uris, [
      "mutable://open/items/1",
      "mutable://open/items/2",
      "mutable://open/items/3",
    ]);
  }
});

// =============================================================================
// MemoryClient: delete an output URI
// =============================================================================

Deno.test("MemoryClient - delete an output URI", async () => {
  const { client, node } = createTestSetup();

  const msgData: MessageData = {
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/del/a", { value: 1 }],
        ["mutable://open/del/b", { value: 2 }],
      ],
    },
  };

  const result = await node.receive(["msg://open/batch-del", msgData]);
  assertEquals(result.accepted, true);

  // Verify both exist
  assertEquals((await client.read("mutable://open/del/a")).success, true);
  assertEquals((await client.read("mutable://open/del/b")).success, true);

  // Delete one
  const delResult = await client.delete("mutable://open/del/a");
  assertEquals(delResult.success, true);

  // Verify deleted
  assertEquals((await client.read("mutable://open/del/a")).success, false);
  // Other still exists
  assertEquals((await client.read("mutable://open/del/b")).success, true);
});

// =============================================================================
// MemoryClient: readMulti on output URIs
// =============================================================================

Deno.test("MemoryClient - readMulti on output URIs", async () => {
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

  const multi = await client.readMulti([
    "mutable://open/multi/1",
    "mutable://open/multi/2",
    "mutable://open/multi/3",
    "mutable://open/multi/missing", // Not stored
  ]);

  assertEquals(multi.success, true);
  assertEquals(multi.summary.total, 4);
  assertEquals(multi.summary.succeeded, 3);
  assertEquals(multi.summary.failed, 1);

  const successResults = multi.results.filter((r) => r.success);
  assertEquals(successResults.length, 3);
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
  assertEquals(envelope.success, true);
  assertEquals(envelope.record?.data.payload.inputs, ["mutable://open/ref/1"]);
  assertEquals(envelope.record?.data.payload.outputs.length, 1);

  // The output is also stored individually
  const output = await client.read("mutable://open/out/1");
  assertEquals(output.success, true);
  assertEquals(output.record?.data, { value: 42 });
});

/**
 * Message Envelope Validation Tests
 *
 * Tests for msgSchema validator and integration with
 * the unified node system.
 *
 * Note: isMessageData detection and client-level unpacking tests
 * have been removed — isMessageData is deprecated, and envelope
 * decomposition is now tested in data-client.test.ts (b3nd-core).
 */

import { assertEquals } from "@std/assert";
import type { MessageData } from "./data/types.ts";
import type { Schema } from "../b3nd-core/types.ts";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { DataClient } from "../b3nd-core/data-client.ts";
import { createValidatedClient, msgSchema } from "../b3nd-compose/mod.ts";

// =============================================================================
// msgSchema validator
// =============================================================================

Deno.test("msgSchema - validates each output against schema", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "msg://open": async () => ({ valid: true }),
  };

  const validator = msgSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const msgData: MessageData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", {}, { value: 1 }],
      ["mutable://open/y", {}, { value: 2 }],
    ],
  };

  const result = await validator(
    ["msg://open/test", {}, msgData],
    undefined,
    read,
  );
  assertEquals(result.valid, true);
});

Deno.test("msgSchema - rejects if output program unknown", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "msg://open": async () => ({ valid: true }),
  };

  const validator = msgSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const msgData: MessageData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", {}, { value: 1 }],
      ["unknown://program/y", {}, { value: 2 }],
    ],
  };

  const result = await validator(
    ["msg://open/test", {}, msgData],
    undefined,
    read,
  );
  assertEquals(result.valid, false);
  assertEquals(result.error, "Unknown program: unknown://program");
});

Deno.test("msgSchema - delegates non-MessageData to plain schema validation", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
  };

  const validator = msgSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const result = await validator(
    ["mutable://open/x", {}, { name: "Alice" }],
    undefined,
    read,
  );
  assertEquals(result.valid, true);
});

Deno.test("msgSchema - rejects non-MessageData with unknown program", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
  };

  const validator = msgSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const result = await validator(
    ["unknown://program/x", {}, { name: "Alice" }],
    undefined,
    read,
  );
  assertEquals(result.valid, false);
  assertEquals(result.error, "Unknown program: unknown://program");
});

// =============================================================================
// Integration tests (node + client)
// =============================================================================

Deno.test("integration - receive MessageData through node → client unpacks outputs", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "msg://open": async () => ({ valid: true }),
  };

  const client = new DataClient(new MemoryStore());

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  const msgData: MessageData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", {}, { value: 1 }],
      ["mutable://open/y", {}, { value: 2 }],
    ],
  };

  const result = await node.receive([["msg://open/test-1", {}, msgData]]);
  assertEquals(result[0].accepted, true);

  // Envelope stored
  const storedMsg = await client.read("msg://open/test-1");
  assertEquals(storedMsg[0].success, true);
  assertEquals(storedMsg[0].record?.data, msgData);

  // Outputs stored by client
  const readX = await client.read("mutable://open/x");
  assertEquals(readX[0].success, true);
  assertEquals(readX[0].record?.data, { value: 1 });

  const readY = await client.read("mutable://open/y");
  assertEquals(readY[0].success, true);
  assertEquals(readY[0].record?.data, { value: 2 });
});

Deno.test("integration - plain messages still work alongside MessageData", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "msg://open": async () => ({ valid: true }),
  };

  const client = new DataClient(new MemoryStore());

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  // Plain message
  const plainResult = await node.receive([["mutable://open/plain", {}, {
    name: "Alice",
  }]]);
  assertEquals(plainResult[0].accepted, true);

  const readPlain = await client.read("mutable://open/plain");
  assertEquals(readPlain[0].success, true);
  assertEquals(readPlain[0].record?.data, { name: "Alice" });

  // MessageData
  const msgData: MessageData = {
    inputs: [],
    outputs: [["mutable://open/from-msg", {}, { value: 42 }]],
  };
  const msgResult = await node.receive([["msg://open/test-2", {}, msgData]]);
  assertEquals(msgResult[0].accepted, true);

  const readFromMsg = await client.read("mutable://open/from-msg");
  assertEquals(readFromMsg[0].success, true);
  assertEquals(readFromMsg[0].record?.data, { value: 42 });
});

Deno.test("integration - MessageData with mixed programs (mutable + immutable)", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "immutable://open": async ([uri], _upstream, read) => {
      const existing = await read(uri);
      return { valid: !existing.success };
    },
    "msg://open": async () => ({ valid: true }),
  };

  const client = new DataClient(new MemoryStore());

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  const msgData: MessageData = {
    inputs: [],
    outputs: [
      ["mutable://open/a", {}, { mutable: true }],
      ["immutable://open/b", {}, { immutable: true }],
    ],
  };

  const result = await node.receive([["msg://open/mixed-1", {}, msgData]]);
  assertEquals(result[0].accepted, true);

  const readA = await client.read("mutable://open/a");
  assertEquals(readA[0].success, true);
  assertEquals(readA[0].record?.data, { mutable: true });

  const readB = await client.read("immutable://open/b");
  assertEquals(readB[0].success, true);
  assertEquals(readB[0].record?.data, { immutable: true });
});

Deno.test("integration - msgSchema rejects invalid outputs before client sees them", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "mutable://restricted": async () => ({
      valid: false,
      error: "access denied",
    }),
    "msg://open": async () => ({ valid: true }),
  };

  const client = new DataClient(new MemoryStore());

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  const msgData: MessageData = {
    inputs: [],
    outputs: [
      ["mutable://open/ok", {}, { value: 1 }],
      ["mutable://restricted/nope", {}, { value: 2 }],
    ],
  };

  // msgSchema rejects because mutable://restricted fails
  const result = await node.receive([["msg://open/fail-1", {}, msgData]]);
  assertEquals(result[0].accepted, false);

  // Nothing stored — validation rejected before processing
  const readOk = await client.read("mutable://open/ok");
  assertEquals(readOk[0].success, false);

  const readNope = await client.read("mutable://restricted/nope");
  assertEquals(readNope[0].success, false);
});

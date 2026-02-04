/**
 * Message Envelope Unpack Tests
 *
 * Tests for isMessageData detection, msgSchema validator,
 * client-level MessageData unpacking, and integration with
 * the unified node system.
 */

import { assertEquals } from "@std/assert";
import { isMessageData } from "./data/detect.ts";
import type { MessageData } from "./data/types.ts";
import type { Schema } from "../b3nd-core/types.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";
import { createValidatedClient, msgSchema } from "../b3nd-compose/mod.ts";

// =============================================================================
// isMessageData detection
// =============================================================================

Deno.test("isMessageData - detects valid MessageData", () => {
  const valid: MessageData = {
    inputs: ["utxo://alice/1"],
    outputs: [
      ["mutable://open/x", { value: 1 }],
      ["mutable://open/y", { value: 2 }],
    ],
  };
  assertEquals(isMessageData(valid), true);
});

Deno.test("isMessageData - detects valid with empty inputs/outputs", () => {
  assertEquals(isMessageData({ inputs: [], outputs: [] }), true);
});

Deno.test("isMessageData - rejects null", () => {
  assertEquals(isMessageData(null), false);
});

Deno.test("isMessageData - rejects primitives", () => {
  assertEquals(isMessageData("string"), false);
  assertEquals(isMessageData(42), false);
  assertEquals(isMessageData(undefined), false);
});

Deno.test("isMessageData - rejects missing inputs", () => {
  assertEquals(isMessageData({ outputs: [] }), false);
});

Deno.test("isMessageData - rejects missing outputs", () => {
  assertEquals(isMessageData({ inputs: [] }), false);
});

Deno.test("isMessageData - rejects malformed outputs", () => {
  assertEquals(
    isMessageData({ inputs: [], outputs: [["only-one-element"]] }),
    false,
  );
  assertEquals(
    isMessageData({ inputs: [], outputs: [[123, "value"]] }),
    false,
  );
});

Deno.test("isMessageData - rejects plain objects (not MessageData)", () => {
  assertEquals(isMessageData({ name: "Alice", age: 30 }), false);
  assertEquals(isMessageData({ data: "hello" }), false);
});

// =============================================================================
// Client-level MessageData unpacking (MemoryClient)
// =============================================================================

Deno.test("MemoryClient - unpacks MessageData outputs on receive", async () => {
  const client = new MemoryClient({
    schema: {
      "mutable://open": async () => ({ valid: true }),
      "msg://open": async () => ({ valid: true }),
    },
  });

  const msgData: MessageData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", { value: 1 }],
      ["mutable://open/y", { value: 2 }],
    ],
  };

  const result = await client.receive(["msg://open/test", msgData]);
  assertEquals(result.accepted, true);

  // Verify envelope was stored
  const envelope = await client.read("msg://open/test");
  assertEquals(envelope.success, true);

  // Verify each output was stored
  const readX = await client.read("mutable://open/x");
  assertEquals(readX.success, true);
  assertEquals(readX.record?.data, { value: 1 });

  const readY = await client.read("mutable://open/y");
  assertEquals(readY.success, true);
  assertEquals(readY.record?.data, { value: 2 });
});

Deno.test("MemoryClient - plain data stored normally (no unpacking)", async () => {
  const client = new MemoryClient({
    schema: {
      "mutable://open": async () => ({ valid: true }),
    },
  });

  const result = await client.receive(["mutable://open/z", { name: "Alice" }]);
  assertEquals(result.accepted, true);

  const read = await client.read("mutable://open/z");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, { name: "Alice" });
});

Deno.test("MemoryClient - fails if any output in MessageData fails", async () => {
  const client = new MemoryClient({
    schema: {
      "mutable://open": async () => ({ valid: true }),
      "msg://open": async () => ({ valid: true }),
      // No schema for "unknown://program"
    },
  });

  const msgData: MessageData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", { value: 1 }],
      ["unknown://program/y", { value: 2 }], // Will fail
    ],
  };

  const result = await client.receive(["msg://open/test", msgData]);
  assertEquals(result.accepted, false);
});

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
      ["mutable://open/x", { value: 1 }],
      ["mutable://open/y", { value: 2 }],
    ],
  };

  const result = await validator(["msg://open/test", msgData], read);
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
      ["mutable://open/x", { value: 1 }],
      ["unknown://program/y", { value: 2 }],
    ],
  };

  const result = await validator(["msg://open/test", msgData], read);
  assertEquals(result.valid, false);
  assertEquals(result.error, "Unknown program: unknown://program");
});

Deno.test("msgSchema - delegates non-MessageData to plain schema validation", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
  };

  const validator = msgSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const result = await validator(["mutable://open/x", { name: "Alice" }], read);
  assertEquals(result.valid, true);
});

Deno.test("msgSchema - rejects non-MessageData with unknown program", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
  };

  const validator = msgSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const result = await validator(
    ["unknown://program/x", { name: "Alice" }],
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

  const client = new MemoryClient({ schema: testSchema });

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  const msgData: MessageData = {
    inputs: [],
    outputs: [
      ["mutable://open/x", { value: 1 }],
      ["mutable://open/y", { value: 2 }],
    ],
  };

  const result = await node.receive(["msg://open/test-1", msgData]);
  assertEquals(result.accepted, true);

  // Envelope stored
  const storedMsg = await client.read("msg://open/test-1");
  assertEquals(storedMsg.success, true);
  assertEquals(storedMsg.record?.data, msgData);

  // Outputs stored by client
  const readX = await client.read("mutable://open/x");
  assertEquals(readX.success, true);
  assertEquals(readX.record?.data, { value: 1 });

  const readY = await client.read("mutable://open/y");
  assertEquals(readY.success, true);
  assertEquals(readY.record?.data, { value: 2 });
});

Deno.test("integration - plain messages still work alongside MessageData", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "msg://open": async () => ({ valid: true }),
  };

  const client = new MemoryClient({ schema: testSchema });

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  // Plain message
  const plainResult = await node.receive(["mutable://open/plain", {
    name: "Alice",
  }]);
  assertEquals(plainResult.accepted, true);

  const readPlain = await client.read("mutable://open/plain");
  assertEquals(readPlain.success, true);
  assertEquals(readPlain.record?.data, { name: "Alice" });

  // MessageData
  const msgData: MessageData = {
    inputs: [],
    outputs: [["mutable://open/from-msg", { value: 42 }]],
  };
  const msgResult = await node.receive(["msg://open/test-2", msgData]);
  assertEquals(msgResult.accepted, true);

  const readFromMsg = await client.read("mutable://open/from-msg");
  assertEquals(readFromMsg.success, true);
  assertEquals(readFromMsg.record?.data, { value: 42 });
});

Deno.test("integration - MessageData with mixed programs (mutable + immutable)", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "immutable://open": async ({ uri, read }) => {
      const existing = await read(uri);
      return { valid: !existing.success };
    },
    "msg://open": async () => ({ valid: true }),
  };

  const client = new MemoryClient({ schema: testSchema });

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  const msgData: MessageData = {
    inputs: [],
    outputs: [
      ["mutable://open/a", { mutable: true }],
      ["immutable://open/b", { immutable: true }],
    ],
  };

  const result = await node.receive(["msg://open/mixed-1", msgData]);
  assertEquals(result.accepted, true);

  const readA = await client.read("mutable://open/a");
  assertEquals(readA.success, true);
  assertEquals(readA.record?.data, { mutable: true });

  const readB = await client.read("immutable://open/b");
  assertEquals(readB.success, true);
  assertEquals(readB.record?.data, { immutable: true });
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

  const client = new MemoryClient({ schema: testSchema });

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  const msgData: MessageData = {
    inputs: [],
    outputs: [
      ["mutable://open/ok", { value: 1 }],
      ["mutable://restricted/nope", { value: 2 }],
    ],
  };

  // msgSchema rejects because mutable://restricted fails
  const result = await node.receive(["msg://open/fail-1", msgData]);
  assertEquals(result.accepted, false);

  // Nothing stored — validation rejected before processing
  const readOk = await client.read("mutable://open/ok");
  assertEquals(readOk.success, false);

  const readNope = await client.read("mutable://restricted/nope");
  assertEquals(readNope.success, false);
});

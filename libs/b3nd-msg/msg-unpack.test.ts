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
    payload: {
      inputs: ["utxo://alice/1"],
      outputs: [
        ["mutable://open/x", { value: 1 }],
        ["mutable://open/y", { value: 2 }],
      ],
    },
  };
  assertEquals(isMessageData(valid), true);
});

Deno.test("isMessageData - detects valid with empty inputs/outputs", () => {
  assertEquals(isMessageData({ payload: { inputs: [], outputs: [] } }), true);
});

Deno.test("isMessageData - detects valid with auth", () => {
  assertEquals(
    isMessageData({
      auth: [{ pubkey: "abc", signature: "def" }],
      payload: { inputs: [], outputs: [] },
    }),
    true,
  );
});

Deno.test("isMessageData - rejects null", () => {
  assertEquals(isMessageData(null), false);
});

Deno.test("isMessageData - rejects primitives", () => {
  assertEquals(isMessageData("string"), false);
  assertEquals(isMessageData(42), false);
  assertEquals(isMessageData(undefined), false);
});

Deno.test("isMessageData - rejects missing payload", () => {
  assertEquals(isMessageData({ inputs: [], outputs: [] }), false);
});

Deno.test("isMessageData - rejects missing payload.inputs", () => {
  assertEquals(isMessageData({ payload: { outputs: [] } }), false);
});

Deno.test("isMessageData - rejects missing payload.outputs", () => {
  assertEquals(isMessageData({ payload: { inputs: [] } }), false);
});

Deno.test("isMessageData - rejects malformed outputs", () => {
  assertEquals(
    isMessageData({ payload: { inputs: [], outputs: [["only-one-element"]] } }),
    false,
  );
  assertEquals(
    isMessageData({ payload: { inputs: [], outputs: [[123, "value"]] } }),
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
  const client = new MemoryClient();

  const msgData: MessageData = {
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/x", { value: 1 }],
        ["mutable://open/y", { value: 2 }],
      ],
    },
  };

  const result = await client.receive(["msg://open/test", msgData]);
  assertEquals(result.accepted, true);

  // Verify envelope was stored
  const envelope = await client.read("msg://open/test");
  assertEquals(envelope[0].success, true);

  // Verify each output was stored
  const readX = await client.read("mutable://open/x");
  assertEquals(readX[0].success, true);
  assertEquals(readX[0].record?.data, { value: 1 });

  const readY = await client.read("mutable://open/y");
  assertEquals(readY[0].success, true);
  assertEquals(readY[0].record?.data, { value: 2 });
});

Deno.test("MemoryClient - plain data stored normally (no unpacking)", async () => {
  const client = new MemoryClient();

  const result = await client.receive(["mutable://open/z", { name: "Alice" }]);
  assertEquals(result.accepted, true);

  const read = await client.read("mutable://open/z");
  assertEquals(read[0].success, true);
  assertEquals(read[0].record?.data, { name: "Alice" });
});

Deno.test("MemoryClient - fails if any output in MessageData fails", async () => {
  const schema: Schema = {
    "mutable://open": async () => ({ valid: true }),
    "msg://open": async () => ({ valid: true }),
    // No schema for "unknown://program"
  };
  const raw = new MemoryClient();
  // Wrap with validated client so schema is enforced (MemoryClient is a dumb pipe)
  const client = createValidatedClient({
    write: raw,
    read: raw,
    validate: msgSchema(schema),
  });

  const msgData: MessageData = {
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/x", { value: 1 }],
        ["unknown://program/y", { value: 2 }], // Will fail
      ],
    },
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
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/x", { value: 1 }],
        ["mutable://open/y", { value: 2 }],
      ],
    },
  };

  const result = await validator(["msg://open/test", msgData], undefined, read);
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
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/x", { value: 1 }],
        ["unknown://program/y", { value: 2 }],
      ],
    },
  };

  const result = await validator(["msg://open/test", msgData], undefined, read);
  assertEquals(result.valid, false);
  assertEquals(result.error, "Unknown program: unknown://program");
});

Deno.test("msgSchema - delegates non-MessageData to plain schema validation", async () => {
  const testSchema: Schema = {
    "mutable://open": async () => ({ valid: true }),
  };

  const validator = msgSchema(testSchema);
  const read = async () => ({ success: false as const, error: "not found" });

  const result = await validator(["mutable://open/x", { name: "Alice" }], undefined, read);
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

  const client = new MemoryClient();

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  const msgData: MessageData = {
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/x", { value: 1 }],
        ["mutable://open/y", { value: 2 }],
      ],
    },
  };

  const result = await node.receive(["msg://open/test-1", msgData]);
  assertEquals(result.accepted, true);

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

  const client = new MemoryClient();

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
  assertEquals(readPlain[0].success, true);
  assertEquals(readPlain[0].record?.data, { name: "Alice" });

  // MessageData
  const msgData: MessageData = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/from-msg", { value: 42 }]],
    },
  };
  const msgResult = await node.receive(["msg://open/test-2", msgData]);
  assertEquals(msgResult.accepted, true);

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

  const client = new MemoryClient();

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  const msgData: MessageData = {
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/a", { mutable: true }],
        ["immutable://open/b", { immutable: true }],
      ],
    },
  };

  const result = await node.receive(["msg://open/mixed-1", msgData]);
  assertEquals(result.accepted, true);

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

  const client = new MemoryClient();

  const node = createValidatedClient({
    write: client,
    read: client,
    validate: msgSchema(testSchema),
  });

  const msgData: MessageData = {
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/ok", { value: 1 }],
        ["mutable://restricted/nope", { value: 2 }],
      ],
    },
  };

  // msgSchema rejects because mutable://restricted fails
  const result = await node.receive(["msg://open/fail-1", msgData]);
  assertEquals(result.accepted, false);

  // Nothing stored — validation rejected before processing
  const readOk = await client.read("mutable://open/ok");
  assertEquals(readOk[0].success, false);

  const readNope = await client.read("mutable://restricted/nope");
  assertEquals(readNope[0].success, false);
});

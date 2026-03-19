/**
 * Message Data Layer Tests
 *
 * Comprehensive tests for the msg-data module:
 * - detect.ts: isMessageData type guard
 * - message.ts: content-addressed envelope builder
 * - send.ts: envelope builder + client send
 * - validators.ts: extractProgram, createOutputValidator, combineValidators
 *   (edge cases not covered in msg.test.ts)
 */

import { assertEquals, assertExists } from "@std/assert";
import type { ReadResult } from "../../b3nd-core/types.ts";
import { isMessageData } from "./detect.ts";
import { message } from "./message.ts";
import { send, type SendResult } from "./send.ts";
import type { MessageData } from "./types.ts";
import {
  combineValidators,
  createOutputValidator,
  extractProgram,
} from "./validators.ts";

// =============================================================================
// isMessageData — type guard
// =============================================================================

Deno.test("isMessageData - valid MessageData with inputs and outputs", () => {
  const data: MessageData = {
    payload: {
      inputs: ["utxo://alice/1"],
      outputs: [["utxo://bob/1", 50]],
    },
  };
  assertEquals(isMessageData(data), true);
});

Deno.test("isMessageData - valid with empty inputs and outputs", () => {
  const data: MessageData = {
    payload: {
      inputs: [],
      outputs: [],
    },
  };
  assertEquals(isMessageData(data), true);
});

Deno.test("isMessageData - valid with auth field", () => {
  const data = {
    auth: [{ pubkey: "abc", signature: "def" }],
    payload: {
      inputs: [],
      outputs: [["mutable://open/config", { theme: "dark" }]],
    },
  };
  assertEquals(isMessageData(data), true);
});

Deno.test("isMessageData - valid with multiple outputs", () => {
  const data = {
    payload: {
      inputs: ["utxo://alice/1", "utxo://alice/2"],
      outputs: [
        ["utxo://bob/99", 50],
        ["utxo://alice/3", 30],
        ["fees://pool", 1],
      ],
    },
  };
  assertEquals(isMessageData(data), true);
});

Deno.test("isMessageData - rejects null", () => {
  assertEquals(isMessageData(null), false);
});

Deno.test("isMessageData - rejects undefined", () => {
  assertEquals(isMessageData(undefined), false);
});

Deno.test("isMessageData - rejects primitives", () => {
  assertEquals(isMessageData(42), false);
  assertEquals(isMessageData("hello"), false);
  assertEquals(isMessageData(true), false);
});

Deno.test("isMessageData - rejects empty object", () => {
  assertEquals(isMessageData({}), false);
});

Deno.test("isMessageData - rejects object without payload", () => {
  assertEquals(isMessageData({ data: "something" }), false);
});

Deno.test("isMessageData - rejects payload that is not an object", () => {
  assertEquals(isMessageData({ payload: "string" }), false);
  assertEquals(isMessageData({ payload: 42 }), false);
  assertEquals(isMessageData({ payload: null }), false);
});

Deno.test("isMessageData - rejects missing inputs", () => {
  assertEquals(
    isMessageData({
      payload: {
        outputs: [["utxo://bob/1", 50]],
      },
    }),
    false,
  );
});

Deno.test("isMessageData - rejects missing outputs", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: ["utxo://alice/1"],
      },
    }),
    false,
  );
});

Deno.test("isMessageData - rejects non-array inputs", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: "not-an-array",
        outputs: [],
      },
    }),
    false,
  );
});

Deno.test("isMessageData - rejects non-array outputs", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: [],
        outputs: "not-an-array",
      },
    }),
    false,
  );
});

Deno.test("isMessageData - rejects outputs with wrong tuple shape", () => {
  // Output is not an array
  assertEquals(
    isMessageData({
      payload: {
        inputs: [],
        outputs: [{ uri: "utxo://bob/1", value: 50 }],
      },
    }),
    false,
  );
});

Deno.test("isMessageData - rejects outputs with wrong tuple length", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: [],
        outputs: [["utxo://bob/1"]],
      },
    }),
    false,
  );
});

Deno.test("isMessageData - rejects outputs where URI is not a string", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: [],
        outputs: [[42, "value"]],
      },
    }),
    false,
  );
});

Deno.test("isMessageData - accepts outputs with any value type", () => {
  // The value can be anything — object, number, string, null, boolean
  const data = {
    payload: {
      inputs: [],
      outputs: [
        ["mutable://open/a", { complex: "object" }],
        ["mutable://open/b", 42],
        ["mutable://open/c", "string-value"],
        ["mutable://open/d", null],
        ["mutable://open/e", true],
      ],
    },
  };
  assertEquals(isMessageData(data), true);
});

// =============================================================================
// message() — content-addressed envelope builder
// =============================================================================

Deno.test("message - returns [hashUri, data] tuple", async () => {
  const data: MessageData = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/config", { theme: "dark" }]],
    },
  };

  const [uri, envelope] = await message(data);

  // URI should be a hash URI
  assertEquals(uri.startsWith("hash://sha256/"), true);

  // Envelope should be the original data
  assertEquals(envelope, data);
  assertEquals(envelope.payload.outputs[0][0], "mutable://open/config");
  assertEquals(envelope.payload.outputs[0][1], { theme: "dark" });
});

Deno.test("message - produces deterministic hash for same data", async () => {
  const data: MessageData = {
    payload: {
      inputs: ["utxo://alice/1"],
      outputs: [["utxo://bob/1", 50]],
    },
  };

  const [uri1] = await message(data);
  const [uri2] = await message(data);

  assertEquals(uri1, uri2);
});

Deno.test("message - produces different hash for different data", async () => {
  const data1: MessageData = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/a", 1]],
    },
  };

  const data2: MessageData = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/a", 2]],
    },
  };

  const [uri1] = await message(data1);
  const [uri2] = await message(data2);

  assertEquals(uri1 !== uri2, true);
});

Deno.test("message - hash URI has correct format", async () => {
  const data: MessageData = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/x", "test"]],
    },
  };

  const [uri] = await message(data);

  // Format: hash://sha256/{64 hex chars}
  const match = uri.match(/^hash:\/\/sha256\/([0-9a-f]+)$/);
  assertExists(match, "URI should match hash://sha256/{hex} format");
  assertEquals(match![1].length, 64, "SHA-256 hash should be 64 hex chars");
});

Deno.test("message - handles data with auth", async () => {
  const data: MessageData = {
    auth: [{ pubkey: "abc123", signature: "sig456" }],
    payload: {
      inputs: ["utxo://alice/1"],
      outputs: [["utxo://bob/1", 100]],
    },
  };

  const [uri, envelope] = await message(data);

  assertEquals(uri.startsWith("hash://sha256/"), true);
  assertEquals(envelope.auth?.length, 1);
  assertEquals(envelope.auth![0].pubkey, "abc123");
});

Deno.test("message - handles empty outputs and inputs", async () => {
  const data: MessageData = {
    payload: {
      inputs: [],
      outputs: [],
    },
  };

  const [uri, envelope] = await message(data);

  assertEquals(uri.startsWith("hash://sha256/"), true);
  assertEquals(envelope.payload.inputs.length, 0);
  assertEquals(envelope.payload.outputs.length, 0);
});

// =============================================================================
// send() — envelope builder + client send
// =============================================================================

Deno.test("send - builds envelope and sends to client", async () => {
  const received: [string, unknown][] = [];

  const mockClient = {
    receive: async (msg: [string, unknown]) => {
      received.push(msg);
      return { accepted: true };
    },
  };

  const data: MessageData = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/config", { theme: "light" }]],
    },
  };

  const result: SendResult = await send(data, mockClient);

  assertEquals(result.accepted, true);
  assertEquals(result.uri.startsWith("hash://sha256/"), true);

  // Client should have received the envelope
  assertEquals(received.length, 1);
  assertEquals(received[0][0], result.uri);
  assertEquals(
    (received[0][1] as MessageData).payload.outputs[0][0],
    "mutable://open/config",
  );
});

Deno.test("send - returns rejection from client", async () => {
  const mockClient = {
    receive: async () => ({
      accepted: false,
      error: "schema_validation_failed",
    }),
  };

  const data: MessageData = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/config", "bad"]],
    },
  };

  const result = await send(data, mockClient);

  assertEquals(result.accepted, false);
  assertEquals(result.error, "schema_validation_failed");
  assertEquals(result.uri.startsWith("hash://sha256/"), true);
});

Deno.test("send - URI is deterministic", async () => {
  const mockClient = {
    receive: async () => ({ accepted: true }),
  };

  const data: MessageData = {
    payload: {
      inputs: ["utxo://alice/1"],
      outputs: [["utxo://bob/1", 42]],
    },
  };

  const result1 = await send(data, mockClient);
  const result2 = await send(data, mockClient);

  assertEquals(result1.uri, result2.uri);
});

Deno.test("send - merges client result properties", async () => {
  const mockClient = {
    receive: async () => ({
      accepted: true,
      extra: "metadata",
    } as { accepted: boolean; extra: string }),
  };

  const data: MessageData = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/x", 1]],
    },
  };

  const result = await send(data, mockClient);

  assertEquals(result.accepted, true);
  assertEquals(result.uri.startsWith("hash://sha256/"), true);
  // Extra properties from client result are spread
  assertEquals((result as any).extra, "metadata");
});

// =============================================================================
// extractProgram — additional edge cases
// =============================================================================

Deno.test("extractProgram - handles deep paths", () => {
  assertEquals(
    extractProgram("mutable://accounts/alice/profile/settings/theme"),
    "mutable://accounts",
  );
});

Deno.test("extractProgram - handles numeric path segments", () => {
  assertEquals(
    extractProgram("msg://transfers/42/data"),
    "msg://transfers",
  );
});

Deno.test("extractProgram - handles hash URIs", () => {
  assertEquals(
    extractProgram(
      "hash://sha256/abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
    ),
    "hash://sha256",
  );
});

// =============================================================================
// createOutputValidator — edge cases and error paths
// =============================================================================

Deno.test("createOutputValidator - rejects null data", async () => {
  const validator = createOutputValidator({
    schema: {},
  });

  const read = async () => ({ success: false, error: "not found" });
  const result = await validator(["msg://test/1", null as any], read);

  assertEquals(result.valid, false);
  assertEquals(result.error, "Invalid message data");
});

Deno.test("createOutputValidator - rejects non-object data", async () => {
  const validator = createOutputValidator({
    schema: {},
  });

  const read = async () => ({ success: false, error: "not found" });
  const result = await validator(["msg://test/1", "string" as any], read);

  assertEquals(result.valid, false);
  assertEquals(result.error, "Invalid message data");
});

Deno.test("createOutputValidator - rejects missing payload", async () => {
  const validator = createOutputValidator({
    schema: {},
  });

  const read = async () => ({ success: false, error: "not found" });
  const result = await validator(["msg://test/1", {} as any], read);

  assertEquals(result.valid, false);
  assertEquals(result.error, "payload must be an object");
});

Deno.test("createOutputValidator - rejects non-object payload", async () => {
  const validator = createOutputValidator({
    schema: {},
  });

  const read = async () => ({ success: false, error: "not found" });
  const result = await validator(
    ["msg://test/1", { payload: "string" } as any],
    read,
  );

  assertEquals(result.valid, false);
  assertEquals(result.error, "payload must be an object");
});

Deno.test("createOutputValidator - rejects non-array inputs", async () => {
  const validator = createOutputValidator({
    schema: {},
  });

  const read = async () => ({ success: false, error: "not found" });
  const result = await validator(
    ["msg://test/1", { payload: { inputs: "not-array", outputs: [] } } as any],
    read,
  );

  assertEquals(result.valid, false);
  assertEquals(result.error, "payload.inputs must be an array");
});

Deno.test("createOutputValidator - rejects non-array outputs", async () => {
  const validator = createOutputValidator({
    schema: {},
  });

  const read = async () => ({ success: false, error: "not found" });
  const result = await validator(
    ["msg://test/1", { payload: { inputs: [], outputs: "not-array" } } as any],
    read,
  );

  assertEquals(result.valid, false);
  assertEquals(result.error, "payload.outputs must be an array");
});

Deno.test("createOutputValidator - rejects invalid output URI", async () => {
  const validator = createOutputValidator({
    schema: {},
  });

  const read = async () => ({ success: false, error: "not found" });
  const result = await validator(
    [
      "msg://test/1",
      {
        payload: {
          inputs: [],
          outputs: [["not-a-valid-uri", 42]],
        },
      },
    ],
    read,
  );

  assertEquals(result.valid, false);
  assertEquals(result.error, "Invalid output URI: not-a-valid-uri");
});

Deno.test("createOutputValidator - passes outputs without matching schema entry", async () => {
  // Schema only has utxo://bob — utxo://alice outputs should pass without validator
  const validator = createOutputValidator({
    schema: {
      "utxo://bob": async () => ({ valid: true }),
    },
  });

  const read = async () => ({ success: false, error: "not found" });
  const result = await validator(
    [
      "msg://test/1",
      {
        payload: {
          inputs: [],
          outputs: [
            ["utxo://bob/1", 50],
            ["utxo://alice/change", 30], // No validator for utxo://alice
          ],
        },
      },
    ],
    read,
  );

  assertEquals(result.valid, true);
});

Deno.test("createOutputValidator - validator receives correct context", async () => {
  let capturedCtx: any = null;

  const validator = createOutputValidator({
    schema: {
      "mutable://data": async (ctx) => {
        capturedCtx = ctx;
        return { valid: true };
      },
    },
  });

  const read = async <T>(uri: string): Promise<ReadResult<T>> => {
    if (uri === "state://counter") {
      return { success: true, record: { ts: Date.now(), data: 42 as T } };
    }
    return { success: false, error: "not found" };
  };

  await validator(
    [
      "msg://test/1",
      {
        payload: {
          inputs: ["state://counter"],
          outputs: [
            ["mutable://data/item", { name: "test" }],
            ["fees://pool", 1],
          ],
        },
      },
    ],
    read,
  );

  assertExists(capturedCtx);
  assertEquals(capturedCtx.uri, "mutable://data/item");
  assertEquals(capturedCtx.value, { name: "test" });
  assertEquals(capturedCtx.inputs, ["state://counter"]);
  assertEquals(capturedCtx.outputs.length, 2);
  // Verify read function is passed through
  const readResult = await capturedCtx.read("state://counter");
  assertEquals(readResult.success, true);
  assertEquals(readResult.record.data, 42);
});

Deno.test("createOutputValidator - shows program prefix in error", async () => {
  const validator = createOutputValidator({
    schema: {
      "mutable://accounts": async () => ({
        valid: false,
        error: "account_locked",
      }),
    },
  });

  const read = async () => ({ success: false, error: "not found" });
  const result = await validator(
    [
      "msg://test/1",
      {
        payload: {
          inputs: [],
          outputs: [["mutable://accounts/alice", { balance: 0 }]],
        },
      },
    ],
    read,
  );

  assertEquals(result.valid, false);
  assertEquals(result.error, "mutable://accounts: account_locked");
});

Deno.test("createOutputValidator - uses default error when validator returns none", async () => {
  const validator = createOutputValidator({
    schema: {
      "mutable://data": async () => ({ valid: false }), // No error message
    },
  });

  const read = async () => ({ success: false, error: "not found" });
  const result = await validator(
    [
      "msg://test/1",
      {
        payload: {
          inputs: [],
          outputs: [["mutable://data/x", "val"]],
        },
      },
    ],
    read,
  );

  assertEquals(result.valid, false);
  assertEquals(result.error, "mutable://data: validation failed");
});

// =============================================================================
// combineValidators — additional edge cases
// =============================================================================

Deno.test("combineValidators - empty list of validators passes", async () => {
  const combined = combineValidators();
  const read = async () => ({ success: false, error: "not found" });

  const result = await combined(["msg://test/1", {}], read);
  assertEquals(result.valid, true);
});

Deno.test("combineValidators - single validator", async () => {
  const v = combineValidators(
    async () => ({ valid: false, error: "only_one" }),
  );
  const read = async () => ({ success: false, error: "not found" });

  const result = await v(["msg://test/1", {}], read);
  assertEquals(result.valid, false);
  assertEquals(result.error, "only_one");
});

Deno.test("combineValidators - stops at first failure", async () => {
  const calls: string[] = [];

  const v1 = async () => {
    calls.push("v1");
    return { valid: true };
  };
  const v2 = async () => {
    calls.push("v2");
    return { valid: false, error: "v2_failed" };
  };
  const v3 = async () => {
    calls.push("v3");
    return { valid: true };
  };

  const combined = combineValidators(v1, v2, v3);
  const read = async () => ({ success: false, error: "not found" });

  const result = await combined(["msg://test/1", {}], read);

  assertEquals(result.valid, false);
  assertEquals(result.error, "v2_failed");
  // v3 should NOT have been called
  assertEquals(calls, ["v1", "v2"]);
});

Deno.test("combineValidators - passes read function to each validator", async () => {
  const readUris: string[] = [];

  const v1 = async (_msg: any, read: any) => {
    const r = await read("state://a");
    readUris.push("state://a");
    return { valid: true };
  };
  const v2 = async (_msg: any, read: any) => {
    const r = await read("state://b");
    readUris.push("state://b");
    return { valid: true };
  };

  const combined = combineValidators(v1, v2);
  const read = async <T>(uri: string): Promise<ReadResult<T>> => ({
    success: true,
    record: { ts: Date.now(), data: `value-for-${uri}` as T },
  });

  await combined(["msg://test/1", {}], read);

  assertEquals(readUris, ["state://a", "state://b"]);
});

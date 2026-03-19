/**
 * Tests for b3nd-msg data module: message(), send(), isMessageData(), extractProgram()
 *
 * Covers:
 * - message() content-addressed envelope construction
 * - send() end-to-end flow with mock client
 * - isMessageData() type guard edge cases
 * - extractProgram() URI parsing edge cases
 */

import { assertEquals, assertExists } from "@std/assert";
import { message } from "./message.ts";
import { send } from "./send.ts";
import { isMessageData } from "./detect.ts";
import { extractProgram } from "./validators.ts";
import type { MessageData } from "./types.ts";

// =============================================================================
// message() — content-addressed envelope construction
// =============================================================================

Deno.test("message - returns hash URI and data tuple", async () => {
  const data: MessageData<number> = {
    payload: {
      inputs: ["utxo://alice/1"],
      outputs: [
        ["utxo://bob/99", 50],
        ["utxo://alice/2", 30],
      ],
    },
  };

  const [uri, envelope] = await message(data);

  // URI must be a hash://sha256/{hex} URI
  assertEquals(uri.startsWith("hash://sha256/"), true);
  assertEquals(uri.length > "hash://sha256/".length, true);

  // Envelope must be the same data
  assertEquals(envelope, data);
  assertEquals(envelope.payload.inputs, ["utxo://alice/1"]);
  assertEquals(envelope.payload.outputs.length, 2);
});

Deno.test("message - deterministic hash for same data", async () => {
  const data: MessageData<string> = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/config", "dark"]],
    },
  };

  const [uri1] = await message(data);
  const [uri2] = await message(data);

  assertEquals(uri1, uri2);
});

Deno.test("message - different data produces different hashes", async () => {
  const data1: MessageData<string> = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/config", "dark"]],
    },
  };
  const data2: MessageData<string> = {
    payload: {
      inputs: [],
      outputs: [["mutable://open/config", "light"]],
    },
  };

  const [uri1] = await message(data1);
  const [uri2] = await message(data2);

  assertEquals(uri1 !== uri2, true);
});

Deno.test("message - preserves auth field", async () => {
  const data: MessageData = {
    auth: [{ pubkey: "abc123", signature: "sig456" }],
    payload: {
      inputs: [],
      outputs: [["mutable://x", { value: 1 }]],
    },
  };

  const [, envelope] = await message(data);
  assertExists(envelope.auth);
  assertEquals(envelope.auth!.length, 1);
  assertEquals(envelope.auth![0].pubkey, "abc123");
});

Deno.test("message - handles empty inputs and outputs", async () => {
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

Deno.test("message - handles complex nested output values", async () => {
  const data: MessageData = {
    payload: {
      inputs: ["ref://doc/1"],
      outputs: [
        ["mutable://users/alice", {
          name: "Alice",
          nested: { deep: { array: [1, 2, 3] } },
        }],
      ],
    },
  };

  const [uri, envelope] = await message(data);
  assertEquals(uri.startsWith("hash://sha256/"), true);

  const output = envelope.payload.outputs[0];
  assertEquals(output[0], "mutable://users/alice");
  assertEquals(
    (output[1] as Record<string, unknown>).name,
    "Alice",
  );
});

// =============================================================================
// send() — end-to-end flow
// =============================================================================

Deno.test("send - calls client.receive with hash URI envelope", async () => {
  let receivedMsg: [string, unknown] | null = null;

  const mockClient = {
    async receive(msg: [string, unknown]) {
      receivedMsg = msg;
      return { accepted: true };
    },
  };

  const data: MessageData<number> = {
    payload: {
      inputs: [],
      outputs: [["mutable://counter", 42]],
    },
  };

  const result = await send(data, mockClient);

  assertEquals(result.accepted, true);
  assertEquals(result.uri.startsWith("hash://sha256/"), true);
  assertExists(receivedMsg);
  assertEquals(receivedMsg![0], result.uri);
});

Deno.test("send - propagates rejection from client", async () => {
  const mockClient = {
    async receive(_msg: [string, unknown]) {
      return { accepted: false, error: "validation_failed" };
    },
  };

  const data: MessageData = {
    payload: {
      inputs: [],
      outputs: [["mutable://x", null]],
    },
  };

  const result = await send(data, mockClient);

  assertEquals(result.accepted, false);
  assertEquals(result.error, "validation_failed");
  assertEquals(result.uri.startsWith("hash://sha256/"), true);
});

Deno.test("send - same data produces same URI across calls", async () => {
  const calls: string[] = [];
  const mockClient = {
    async receive(msg: [string, unknown]) {
      calls.push(msg[0] as string);
      return { accepted: true };
    },
  };

  const data: MessageData = {
    payload: {
      inputs: [],
      outputs: [["mutable://stable", "value"]],
    },
  };

  await send(data, mockClient);
  await send(data, mockClient);

  assertEquals(calls.length, 2);
  assertEquals(calls[0], calls[1]);
});

// =============================================================================
// isMessageData() — type guard edge cases
// =============================================================================

Deno.test("isMessageData - accepts valid MessageData", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: ["utxo://alice/1"],
        outputs: [["utxo://bob/1", 50]],
      },
    }),
    true,
  );
});

Deno.test("isMessageData - accepts with auth field", () => {
  assertEquals(
    isMessageData({
      auth: [{ pubkey: "abc", signature: "def" }],
      payload: {
        inputs: [],
        outputs: [["mutable://x", "val"]],
      },
    }),
    true,
  );
});

Deno.test("isMessageData - accepts empty inputs and outputs", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: [],
        outputs: [],
      },
    }),
    true,
  );
});

Deno.test("isMessageData - rejects null", () => {
  assertEquals(isMessageData(null), false);
});

Deno.test("isMessageData - rejects undefined", () => {
  assertEquals(isMessageData(undefined), false);
});

Deno.test("isMessageData - rejects primitive string", () => {
  assertEquals(isMessageData("hello"), false);
});

Deno.test("isMessageData - rejects primitive number", () => {
  assertEquals(isMessageData(42), false);
});

Deno.test("isMessageData - rejects empty object", () => {
  assertEquals(isMessageData({}), false);
});

Deno.test("isMessageData - rejects object without payload", () => {
  assertEquals(isMessageData({ data: "something" }), false);
});

Deno.test("isMessageData - rejects payload without inputs", () => {
  assertEquals(
    isMessageData({
      payload: {
        outputs: [["mutable://x", 1]],
      },
    }),
    false,
  );
});

Deno.test("isMessageData - rejects payload without outputs", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: ["utxo://x"],
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

Deno.test("isMessageData - rejects malformed output tuples (not array)", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: [],
        outputs: ["not-a-tuple"],
      },
    }),
    false,
  );
});

Deno.test("isMessageData - rejects output tuple with non-string URI", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: [],
        outputs: [[123, "value"]],
      },
    }),
    false,
  );
});

Deno.test("isMessageData - rejects output tuple with wrong length", () => {
  assertEquals(
    isMessageData({
      payload: {
        inputs: [],
        outputs: [["only-uri"]],
      },
    }),
    false,
  );
});

Deno.test("isMessageData - rejects array as data", () => {
  assertEquals(isMessageData([1, 2, 3]), false);
});

Deno.test("isMessageData - rejects payload as null", () => {
  assertEquals(isMessageData({ payload: null }), false);
});

Deno.test("isMessageData - rejects payload as string", () => {
  assertEquals(isMessageData({ payload: "string" }), false);
});

// =============================================================================
// extractProgram() — URI parsing edge cases
// =============================================================================

Deno.test("extractProgram - standard URIs", () => {
  assertEquals(extractProgram("mutable://users/alice"), "mutable://users");
  assertEquals(extractProgram("hash://sha256/abc123"), "hash://sha256");
  assertEquals(extractProgram("utxo://alice/1"), "utxo://alice");
  assertEquals(extractProgram("fees://pool"), "fees://pool");
  assertEquals(extractProgram("msg://transfers/42"), "msg://transfers");
});

Deno.test("extractProgram - deep paths", () => {
  assertEquals(
    extractProgram("mutable://accounts/alice/settings/theme"),
    "mutable://accounts",
  );
});

Deno.test("extractProgram - returns null for empty string", () => {
  assertEquals(extractProgram(""), null);
});

Deno.test("extractProgram - returns null for plain text", () => {
  assertEquals(extractProgram("just-some-text"), null);
});

Deno.test("extractProgram - handles URI with empty host", () => {
  // "mutable://" is a valid URL with empty hostname
  assertEquals(extractProgram("mutable://"), "mutable://");
});

import { assertEquals } from "@std/assert";
import { createValidatedClient } from "./validated-client.ts";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { DataClient } from "../b3nd-core/data-client.ts";
import { accept, msgSchema, reject, requireFields } from "./validators.ts";
import type {
  Output,
  ReadResult,
  Schema,
  Validator,
} from "../b3nd-core/types.ts";
import type { MessageData } from "../b3nd-msg/data/types.ts";

function mem() {
  return new DataClient(new MemoryStore());
}

// ── createValidatedClient ──

Deno.test("createValidatedClient - accept validator allows writes", async () => {
  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: accept(),
  });

  const results = await client.receive([
    ["mutable://data/alice", {}, { name: "Alice" }],
  ]);
  assertEquals(results[0].accepted, true);

  const readResults = await client.read("mutable://data/alice");
  assertEquals(readResults[0].success, true);
  assertEquals(
    (readResults[0].record?.data as Record<string, unknown>)?.name,
    "Alice",
  );
});

Deno.test("createValidatedClient - reject validator blocks writes", async () => {
  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: reject("not allowed"),
  });

  const results = await client.receive([["mutable://data/x", {}, { data: 1 }]]);
  assertEquals(results[0].accepted, false);
  assertEquals(results[0].error, "not allowed");

  // Data should NOT be written
  const readResults = await client.read("mutable://data/x");
  assertEquals(readResults[0].success, false);
});

Deno.test("createValidatedClient - requireFields blocks invalid data", async () => {
  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: requireFields(["name", "email"]),
  });

  // Missing email
  const failResults = await client.receive([
    ["mutable://data/alice", {}, { name: "Alice" }],
  ]);
  assertEquals(failResults[0].accepted, false);
  assertEquals(failResults[0].error, "Missing required fields: email");

  // All fields present
  const passResults = await client.receive([
    ["mutable://data/alice", {}, { name: "Alice", email: "a@b.com" }],
  ]);
  assertEquals(passResults[0].accepted, true);
});

Deno.test("createValidatedClient - rejects empty URI", async () => {
  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: accept(),
  });

  const results = await client.receive([["", {}, { data: 1 }]]);
  assertEquals(results[0].accepted, false);
  assertEquals(results[0].error, "Message URI is required");
});

Deno.test("createValidatedClient - read delegates to read backend", async () => {
  const writeMem = mem();
  const readMem = mem();

  // Pre-populate read backend
  await readMem.receive([["mutable://data/a", {}, { val: 1 }]]);
  await readMem.receive([["mutable://data/b", {}, { val: 2 }]]);

  const client = createValidatedClient({
    write: writeMem,
    read: readMem,
    validate: accept(),
  });

  const readResults = await client.read("mutable://data/a");
  assertEquals(readResults[0].success, true);

  // List via trailing slash
  const listResults = await client.read("mutable://data/");
  assertEquals(listResults.length, 2);
  assertEquals(listResults.every((r) => r.success), true);
});

Deno.test("createValidatedClient - handles validator that throws", async () => {
  const m = mem();
  // deno-lint-ignore require-await
  const throwingValidator = async () => {
    throw new Error("validator exploded");
  };

  const client = createValidatedClient({
    write: m,
    read: m,
    validate: throwingValidator,
  });

  const results = await client.receive([["mutable://data/x", {}, { data: 1 }]]);
  assertEquals(results[0].accepted, false);
  assertEquals(results[0].error, "Validation error: validator exploded");
});

// ── upstream vs read distinction ──

Deno.test("msgSchema - upstream provides sibling outputs, read provides storage", async () => {
  // A validator that inspects upstream for sibling outputs
  // and read for storage, verifying the distinction
  let readResult: ReadResult<unknown> | null = null;
  let siblingFromUpstream: Output | undefined = undefined;

  const testValidator: Validator = async ([uri, , value], upstream, read) => {
    // Explicit: check storage via read()
    readResult = await read("mutable://data/sibling");

    // Explicit: check sibling outputs via upstream
    if (upstream) {
      const [, , envelope] = upstream;
      const msg = envelope as MessageData;
      siblingFromUpstream = msg.outputs.find(([u]) =>
        u === "mutable://data/sibling"
      );
    }

    return { valid: true };
  };

  const SCHEMA: Schema = {
    "hash://sha256": async () => ({ valid: true }),
    "mutable://data": testValidator,
  };

  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: msgSchema(SCHEMA),
  });

  // Send a MessageData envelope with two sibling outputs
  const envelope = {
    inputs: [],
    outputs: [
      ["mutable://data/sibling", {}, { greeting: "hello" }],
      ["mutable://data/main", {}, { value: 42 }],
    ] as Output[],
  };

  const results = await client.receive([
    ["hash://sha256/test-envelope", {}, envelope],
  ]);
  assertEquals(results[0].accepted, true, `Envelope rejected: ${results[0].error}`);

  // read() should NOT find the sibling (not yet committed to storage)
  assertEquals(
    readResult!.success,
    false,
    "read() should not find sibling outputs",
  );

  // upstream should have the sibling from the envelope
  assertEquals(
    siblingFromUpstream !== undefined,
    true,
    "upstream should have sibling output",
  );
  assertEquals(
    (siblingFromUpstream![2] as Record<string, unknown>)?.greeting,
    "hello",
  );
});

Deno.test("msgSchema - upstream is undefined for plain writes", async () => {
  let receivedUpstream: Output | undefined = "not-called" as unknown as Output;

  const testValidator: Validator = async (_output, upstream, _read) => {
    receivedUpstream = upstream;
    return { valid: true };
  };

  const SCHEMA: Schema = {
    "mutable://data": testValidator,
  };

  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: msgSchema(SCHEMA),
  });

  // Plain message (not a MessageData envelope)
  const results = await client.receive([["mutable://data/item", {}, { value: 1 }]]);
  assertEquals(results[0].accepted, true);

  // For plain messages, upstream should be undefined
  assertEquals(receivedUpstream, undefined, "Plain writes have no upstream");
});

Deno.test("msgSchema - upstream is the envelope for inner outputs", async () => {
  let receivedUpstream: Output | undefined = undefined;

  const testValidator: Validator = async (_output, upstream, _read) => {
    receivedUpstream = upstream;
    return { valid: true };
  };

  const SCHEMA: Schema = {
    "hash://sha256": async () => ({ valid: true }),
    "mutable://data": testValidator,
  };

  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: msgSchema(SCHEMA),
  });

  const envelope = {
    inputs: [],
    outputs: [
      ["mutable://data/item", {}, { value: 1 }],
    ] as Output[],
  };

  const results = await client.receive([
    ["hash://sha256/test-envelope", {}, envelope],
  ]);
  assertEquals(results[0].accepted, true, `Envelope rejected: ${results[0].error}`);

  // Upstream should be the envelope itself
  assertEquals(
    receivedUpstream !== undefined,
    true,
    "Inner outputs should have upstream",
  );
  assertEquals(receivedUpstream![0], "hash://sha256/test-envelope");
  assertEquals(
    (receivedUpstream![2] as { outputs: unknown[] }).outputs.length,
    1,
  );
});

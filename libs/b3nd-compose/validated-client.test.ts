import { assertEquals } from "@std/assert";
import { createValidatedClient } from "./validated-client.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";
import { accept, reject, requireFields } from "./validators.ts";

function mem() {
  return new MemoryClient();
}

// ── createValidatedClient ──

Deno.test("createValidatedClient - accept validator allows writes", async () => {
  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: accept(),
  });

  const result = await client.receive([
    "mutable://data/alice",
    { name: "Alice" },
  ]);
  assertEquals(result.accepted, true);

  const read = await client.read("mutable://data/alice");
  assertEquals(read.success, true);
  assertEquals((read.record?.data as Record<string, unknown>)?.name, "Alice");
});

Deno.test("createValidatedClient - reject validator blocks writes", async () => {
  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: reject("not allowed"),
  });

  const result = await client.receive(["mutable://data/x", { data: 1 }]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "not allowed");

  // Data should NOT be written
  const read = await client.read("mutable://data/x");
  assertEquals(read.success, false);
});

Deno.test("createValidatedClient - requireFields blocks invalid data", async () => {
  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: requireFields(["name", "email"]),
  });

  // Missing email
  const fail = await client.receive([
    "mutable://data/alice",
    { name: "Alice" },
  ]);
  assertEquals(fail.accepted, false);
  assertEquals(fail.error, "Missing required fields: email");

  // All fields present
  const pass = await client.receive([
    "mutable://data/alice",
    { name: "Alice", email: "a@b.com" },
  ]);
  assertEquals(pass.accepted, true);
});

Deno.test("createValidatedClient - rejects empty URI", async () => {
  const m = mem();
  const client = createValidatedClient({
    write: m,
    read: m,
    validate: accept(),
  });

  const result = await client.receive(["", { data: 1 }]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "Message URI is required");
});

Deno.test("createValidatedClient - read/list delegate to read backend", async () => {
  const writeMem = mem();
  const readMem = mem();

  // Pre-populate read backend
  await readMem.receive(["mutable://data/a", { val: 1 }]);
  await readMem.receive(["mutable://data/b", { val: 2 }]);

  const client = createValidatedClient({
    write: writeMem,
    read: readMem,
    validate: accept(),
  });

  const read = await client.read("mutable://data/a");
  assertEquals(read.success, true);

  const list = await client.list("mutable://data/");
  assertEquals(list.success, true);
});

Deno.test("createValidatedClient - delete delegates to write backend", async () => {
  const m = mem();
  await m.receive(["mutable://data/a", { val: 1 }]);

  const client = createValidatedClient({
    write: m,
    read: m,
    validate: accept(),
  });

  const del = await client.delete("mutable://data/a");
  assertEquals(del.success, true);

  const read = await client.read("mutable://data/a");
  assertEquals(read.success, false);
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

  const result = await client.receive(["mutable://data/x", { data: 1 }]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "Validation error: validator exploded");
});

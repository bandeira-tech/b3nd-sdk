import { assert, assertEquals } from "jsr:@std/assert";
import { Persistence } from "../../persistence/mod.ts";
import { createLocalClient } from "../../client-sdk/mod.ts";

Deno.test("LocalClient.getSchema() returns schema keys", async () => {
  const schema = {
    "test://example": (_write: any) => Promise.resolve(true),
    "users://alice": (_write: any) => Promise.resolve(true),
    "notes://bob": (_write: any) => Promise.resolve(true),
  };

  const persistence = new Persistence({ schema });
  const client = createLocalClient(persistence);

  const schemaKeys = await client.getSchema();

  assertEquals(schemaKeys.length, 3);
  assert(schemaKeys.includes("test://example"));
  assert(schemaKeys.includes("users://alice"));
  assert(schemaKeys.includes("notes://bob"));
});

Deno.test("LocalClient.getSchema() returns empty array when no schema", async () => {
  const persistence = new Persistence({ schema: {} });
  const client = createLocalClient(persistence);

  const schemaKeys = await client.getSchema();

  assertEquals(schemaKeys, []);
});

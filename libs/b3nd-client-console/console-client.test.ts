import { assertEquals } from "@std/assert";
import { ConsoleClient } from "./mod.ts";

function createClient(
  schema = { "store://logs": () => Promise.resolve({ valid: true }) },
  label?: string,
) {
  const output: string[] = [];
  const client = new ConsoleClient({
    schema,
    label,
    logger: (msg: string) => output.push(msg),
  });
  return { client, output };
}

Deno.test("ConsoleClient - receive logs to console", async () => {
  const { client, output } = createClient();

  const result = await client.receive([
    "store://logs/entry-1",
    { level: "info", msg: "hello" },
  ]);

  assertEquals(result.accepted, true);
  assertEquals(output.length, 1);
  assertEquals(
    output[0],
    '[b3nd] RECEIVE store://logs/entry-1 {"level":"info","msg":"hello"}',
  );
});

Deno.test("ConsoleClient - custom label", async () => {
  const { client, output } = createClient(undefined, "myapp");

  await client.receive(["store://logs/x", "data"]);

  assertEquals(output[0], '[myapp] RECEIVE store://logs/x "data"');
});

Deno.test("ConsoleClient - rejects unknown program", async () => {
  const { client, output } = createClient();

  const result = await client.receive(["unknown://foo/bar", "data"]);

  assertEquals(result.accepted, false);
  assertEquals(result.error, "Program not found");
  assertEquals(output.length, 0);
});

Deno.test("ConsoleClient - rejects invalid URI", async () => {
  const { client } = createClient();

  const result = await client.receive(["", "data"]);

  assertEquals(result.accepted, false);
  assertEquals(result.error, "Message URI is required");
});

Deno.test("ConsoleClient - validation failure logs rejection", async () => {
  const { client, output } = createClient({
    "store://logs": ({ value }) => {
      const data = value as { level?: string };
      if (!data?.level) {
        return Promise.resolve({ valid: false, error: "level is required" });
      }
      return Promise.resolve({ valid: true });
    },
  });

  const result = await client.receive(["store://logs/x", { msg: "no level" }]);

  assertEquals(result.accepted, false);
  assertEquals(result.error, "level is required");
  assertEquals(output.length, 1);
  assertEquals(output[0], "[b3nd] REJECTED store://logs/x level is required");
});

Deno.test("ConsoleClient - delete logs to console", async () => {
  const { client, output } = createClient();

  const result = await client.delete("store://logs/entry-1");

  assertEquals(result.success, true);
  assertEquals(output.length, 1);
  assertEquals(output[0], "[b3nd] DELETE store://logs/entry-1");
});

Deno.test("ConsoleClient - delete rejects unknown program", async () => {
  const { client } = createClient();

  const result = await client.delete("unknown://foo/bar");

  assertEquals(result.success, false);
  assertEquals(result.error, "Program not found");
});

Deno.test("ConsoleClient - health returns healthy", async () => {
  const { client } = createClient();

  const result = await client.health();

  assertEquals(result.status, "healthy");
});

Deno.test("ConsoleClient - getSchema returns schema keys", async () => {
  const { client } = createClient({
    "store://logs": () => Promise.resolve({ valid: true }),
    "store://events": () => Promise.resolve({ valid: true }),
  });

  const schema = await client.getSchema();

  assertEquals(schema, ["store://logs", "store://events"]);
});

Deno.test("ConsoleClient - cleanup resolves", async () => {
  const { client } = createClient();
  await client.cleanup();
});

Deno.test("ConsoleClient - invalid schema key throws", () => {
  let threw = false;
  try {
    new ConsoleClient({
      schema: { "invalid-key": () => Promise.resolve({ valid: true }) },
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

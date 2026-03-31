import { assertEquals } from "@std/assert";
import { ConsoleClient } from "./mod.ts";

function createClient(
  label?: string,
) {
  const output: string[] = [];
  const client = new ConsoleClient({
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
  const { client, output } = createClient("myapp");

  await client.receive(["store://logs/x", "data"]);

  assertEquals(output[0], '[myapp] RECEIVE store://logs/x "data"');
});

Deno.test("ConsoleClient - rejects invalid URI", async () => {
  const { client } = createClient();

  const result = await client.receive(["", "data"]);

  assertEquals(result.accepted, false);
  assertEquals(result.error, "Message URI is required");
});

Deno.test("ConsoleClient - delete logs to console", async () => {
  const { client, output } = createClient();

  const result = await client.delete("store://logs/entry-1");

  assertEquals(result.success, true);
  assertEquals(output.length, 1);
  assertEquals(output[0], "[b3nd] DELETE store://logs/entry-1");
});

Deno.test("ConsoleClient - health returns healthy", async () => {
  const { client } = createClient();

  const result = await client.health();

  assertEquals(result.status, "healthy");
});

Deno.test("ConsoleClient - cleanup resolves", async () => {
  const { client } = createClient();
  await client.cleanup();
});


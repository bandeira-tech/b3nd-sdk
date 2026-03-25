import { assertEquals } from "@std/assert";
import { S3Client, type S3Executor } from "./mod.ts";

/**
 * In-memory S3 executor stub for testing.
 */
function createMockExecutor(): S3Executor & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    putObject: async (key: string, body: string, _contentType: string) => {
      objects.set(key, body);
    },
    getObject: async (key: string) => {
      return objects.get(key) ?? null;
    },
    deleteObject: async (key: string) => {
      objects.delete(key);
    },
    listObjects: async (prefix: string) => {
      const keys: string[] = [];
      for (const key of objects.keys()) {
        if (key.startsWith(prefix)) {
          keys.push(key);
        }
      }
      return keys;
    },
    headBucket: async () => true,
  };
}

const acceptAll = async () => ({ valid: true });

function createClient(
  schema = { "store://data": acceptAll },
  prefix?: string,
) {
  const executor = createMockExecutor();
  const client = new S3Client(
    { bucket: "test-bucket", schema, prefix },
    executor,
  );
  return { client, executor };
}

Deno.test("S3Client - receive and read", async () => {
  const { client } = createClient();

  const result = await client.receive([
    "store://data/key-1",
    { value: "hello" },
  ]);
  assertEquals(result.accepted, true);

  const read = await client.read("store://data/key-1");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, { value: "hello" });
});

Deno.test("S3Client - read not found", async () => {
  const { client } = createClient();

  const read = await client.read("store://data/missing");
  assertEquals(read.success, false);
  assertEquals(read.error, "Not found: store://data/missing");
});

Deno.test("S3Client - receive rejects unknown program", async () => {
  const { client } = createClient();

  const result = await client.receive(["unknown://foo/bar", "data"]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "No schema defined for program key: unknown://foo");
});

Deno.test("S3Client - receive validates data", async () => {
  const { client } = createClient({
    "store://data": async ({ value }) => {
      const v = value as { name?: string };
      if (!v?.name) return { valid: false, error: "name is required" };
      return { valid: true };
    },
  });

  const result = await client.receive(["store://data/x", { age: 30 }]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "name is required");
});

Deno.test("S3Client - delete existing object", async () => {
  const { client } = createClient();

  await client.receive(["store://data/x", "val"]);
  const del = await client.delete("store://data/x");
  assertEquals(del.success, true);

  const read = await client.read("store://data/x");
  assertEquals(read.success, false);
});

Deno.test("S3Client - delete not found", async () => {
  const { client } = createClient();

  const del = await client.delete("store://data/missing");
  assertEquals(del.success, false);
  assertEquals(del.error, "Not found");
});

Deno.test("S3Client - list items", async () => {
  const { client } = createClient();

  await client.receive(["store://data/users/alice", { name: "Alice" }]);
  await client.receive(["store://data/users/bob", { name: "Bob" }]);

  const list = await client.list("store://data/users");
  assertEquals(list.success, true);
  if (list.success) {
    assertEquals(list.data.length, 2);
    const uris = list.data.map((i) => i.uri).sort();
    assertEquals(uris, [
      "store://data/users/alice",
      "store://data/users/bob",
    ]);
  }
});

Deno.test("S3Client - list empty prefix", async () => {
  const { client } = createClient();

  const list = await client.list("store://data/empty");
  assertEquals(list.success, true);
  if (list.success) {
    assertEquals(list.data.length, 0);
  }
});

Deno.test("S3Client - list with pattern filter", async () => {
  const { client } = createClient();

  await client.receive(["store://data/logs/info-1", "a"]);
  await client.receive(["store://data/logs/error-1", "b"]);
  await client.receive(["store://data/logs/info-2", "c"]);

  const list = await client.list("store://data/logs", { pattern: "info" });
  assertEquals(list.success, true);
  if (list.success) {
    assertEquals(list.data.length, 2);
  }
});

Deno.test("S3Client - list with pagination", async () => {
  const { client } = createClient();

  await client.receive(["store://data/items/a", 1]);
  await client.receive(["store://data/items/b", 2]);
  await client.receive(["store://data/items/c", 3]);

  const page1 = await client.list("store://data/items", { page: 1, limit: 2 });
  assertEquals(page1.success, true);
  if (page1.success) {
    assertEquals(page1.data.length, 2);
    assertEquals(page1.pagination.total, 3);
  }

  const page2 = await client.list("store://data/items", { page: 2, limit: 2 });
  assertEquals(page2.success, true);
  if (page2.success) {
    assertEquals(page2.data.length, 1);
  }
});

Deno.test("S3Client - readMulti", async () => {
  const { client } = createClient();

  await client.receive(["store://data/a", "val-a"]);
  await client.receive(["store://data/b", "val-b"]);

  const result = await client.readMulti([
    "store://data/a",
    "store://data/b",
    "store://data/missing",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.summary.total, 3);
  assertEquals(result.summary.succeeded, 2);
  assertEquals(result.summary.failed, 1);
});

Deno.test("S3Client - readMulti empty array", async () => {
  const { client } = createClient();

  const result = await client.readMulti([]);
  assertEquals(result.success, false);
  assertEquals(result.summary.total, 0);
});

Deno.test("S3Client - readMulti exceeds batch limit", async () => {
  const { client } = createClient();

  const uris = Array.from({ length: 51 }, (_, i) => `store://data/${i}`);
  const result = await client.readMulti(uris);

  assertEquals(result.success, false);
  assertEquals(result.summary.failed, 51);
});

Deno.test("S3Client - health returns healthy", async () => {
  const { client } = createClient();

  const health = await client.health();
  assertEquals(health.status, "healthy");
});

Deno.test("S3Client - health returns unhealthy", async () => {
  const executor = createMockExecutor();
  executor.headBucket = async () => false;

  const client = new S3Client(
    { bucket: "bad-bucket", schema: { "store://data": acceptAll } },
    executor,
  );

  const health = await client.health();
  assertEquals(health.status, "unhealthy");
});

Deno.test("S3Client - getSchema returns keys", async () => {
  const { client } = createClient({
    "store://data": acceptAll,
    "store://logs": acceptAll,
  });

  const schema = await client.getSchema();
  assertEquals(schema, ["store://data", "store://logs"]);
});

Deno.test("S3Client - cleanup delegates to executor", async () => {
  let cleaned = false;
  const executor = createMockExecutor();
  executor.cleanup = async () => { cleaned = true; };

  const client = new S3Client(
    { bucket: "b", schema: { "store://data": acceptAll } },
    executor,
  );

  await client.cleanup();
  assertEquals(cleaned, true);
});

Deno.test("S3Client - prefix is applied to keys", async () => {
  const { client, executor } = createClient(
    { "store://data": acceptAll },
    "prod/b3nd/",
  );

  await client.receive(["store://data/key", "value"]);

  // The key in the executor should include the prefix
  assertEquals(executor.objects.has("prod/b3nd/store/data/key.json"), true);

  // Read should still work via URI
  const read = await client.read("store://data/key");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, "value");
});

Deno.test("S3Client - constructor validates schema keys", () => {
  let threw = false;
  try {
    new S3Client(
      { bucket: "b", schema: { "bad-key": acceptAll } },
      createMockExecutor(),
    );
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("S3Client - constructor requires executor", () => {
  let threw = false;
  try {
    new S3Client({ bucket: "b", schema: { "store://data": acceptAll } });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("S3Client - receive invalid URI", async () => {
  const { client } = createClient();

  const result = await client.receive(["", "data"]);
  assertEquals(result.accepted, false);
  assertEquals(result.error, "Message URI is required");
});

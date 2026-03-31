import { assertEquals } from "@std/assert";
import { S3Client, type S3Executor } from "./mod.ts";

/**
 * In-memory S3 executor stub for testing.
 */
function createMockExecutor(): S3Executor & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    putObject: (key: string, body: string, _contentType: string) => {
      objects.set(key, body);
      return Promise.resolve();
    },
    getObject: (key: string) => {
      return Promise.resolve(objects.get(key) ?? null);
    },
    deleteObject: (key: string) => {
      objects.delete(key);
      return Promise.resolve();
    },
    listObjects: (prefix: string) => {
      const keys: string[] = [];
      for (const key of objects.keys()) {
        if (key.startsWith(prefix)) {
          keys.push(key);
        }
      }
      return Promise.resolve(keys);
    },
    headBucket: () => Promise.resolve(true),
  };
}

function createClient(
  prefix?: string,
) {
  const executor = createMockExecutor();
  const client = new S3Client(
    { bucket: "test-bucket", prefix },
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

Deno.test("S3Client - receive accepts known program", async () => {
  const { client } = createClient();

  const result = await client.receive(["store://data/x", { age: 30 }]);
  assertEquals(result.accepted, true);
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

Deno.test("S3Client - status returns healthy", async () => {
  const { client } = createClient();

  const st = await client.status();
  assertEquals(st.healthy, true);
});

Deno.test("S3Client - status returns unhealthy", async () => {
  const executor = createMockExecutor();
  executor.headBucket = () => Promise.resolve(false);

  const client = new S3Client(
    { bucket: "bad-bucket" },
    executor,
  );

  const st = await client.status();
  assertEquals(st.healthy, false);
});

Deno.test("S3Client - status returns healthy", async () => {
  const { client } = createClient();

  const st = await client.status();
  assertEquals(st.healthy, true);
});

Deno.test("S3Client - cleanup delegates to executor", async () => {
  let cleaned = false;
  const executor = createMockExecutor();
  executor.cleanup = () => {
    cleaned = true;
    return Promise.resolve();
  };

  const client = new S3Client(
    { bucket: "b" },
    executor,
  );

  await client.cleanup();
  assertEquals(cleaned, true);
});

Deno.test("S3Client - prefix is applied to keys", async () => {
  const { client, executor } = createClient(
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


Deno.test("S3Client - constructor requires executor", () => {
  let threw = false;
  try {
    new S3Client({ bucket: "b" });
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

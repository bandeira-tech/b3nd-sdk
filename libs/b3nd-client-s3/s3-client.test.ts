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

  const results = await client.read("store://data/key-1");
  assertEquals(results.length, 1);
  assertEquals(results[0].success, true);
  assertEquals(results[0].record?.data, { value: "hello" });
});

Deno.test("S3Client - read not found", async () => {
  const { client } = createClient();

  const results = await client.read("store://data/missing");
  assertEquals(results.length, 1);
  assertEquals(results[0].success, false);
  assertEquals(results[0].error, "Not found: store://data/missing");
});

Deno.test("S3Client - receive accepts known program", async () => {
  const { client } = createClient();

  const result = await client.receive(["store://data/x", { age: 30 }]);
  assertEquals(result.accepted, true);
});

Deno.test("S3Client - read with trailing slash lists items", async () => {
  const { client } = createClient();

  await client.receive(["store://data/users/alice", { name: "Alice" }]);
  await client.receive(["store://data/users/bob", { name: "Bob" }]);

  const results = await client.read("store://data/users/");
  assertEquals(results.length, 2);
  const uris = results.map((r) => r.uri).sort();
  assertEquals(uris, [
    "store://data/users/alice",
    "store://data/users/bob",
  ]);
});

Deno.test("S3Client - read with trailing slash empty prefix", async () => {
  const { client } = createClient();

  const results = await client.read("store://data/empty/");
  assertEquals(results.length, 0);
});

Deno.test("S3Client - read multiple URIs", async () => {
  const { client } = createClient();

  await client.receive(["store://data/a", "val-a"]);
  await client.receive(["store://data/b", "val-b"]);

  const results = await client.read([
    "store://data/a",
    "store://data/b",
    "store://data/missing",
  ]);

  assertEquals(results.length, 3);
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  assertEquals(succeeded.length, 2);
  assertEquals(failed.length, 1);
});

Deno.test("S3Client - status returns healthy", async () => {
  const { client } = createClient();

  const result = await client.status();
  assertEquals(result.status, "healthy");
});

Deno.test("S3Client - status returns unhealthy", async () => {
  const executor = createMockExecutor();
  executor.headBucket = () => Promise.resolve(false);

  const client = new S3Client(
    { bucket: "bad-bucket" },
    executor,
  );

  const result = await client.status();
  assertEquals(result.status, "unhealthy");
});

Deno.test("S3Client - prefix is applied to keys", async () => {
  const { client, executor } = createClient(
    "prod/b3nd/",
  );

  await client.receive(["store://data/key", "value"]);

  // The key in the executor should include the prefix
  assertEquals(executor.objects.has("prod/b3nd/store/data/key.json"), true);

  // Read should still work via URI
  const results = await client.read("store://data/key");
  assertEquals(results.length, 1);
  assertEquals(results[0].success, true);
  assertEquals(results[0].record?.data, "value");
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

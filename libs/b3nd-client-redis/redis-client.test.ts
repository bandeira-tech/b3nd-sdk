/**
 * RedisClient Tests
 *
 * Tests the Redis client implementation using an in-memory mock executor.
 * No real Redis server needed — the mock fully implements RedisExecutor.
 */

/// <reference lib="deno.ns" />

import { RedisClient } from "./mod.ts";
import type { RedisCommand, RedisExecutor } from "./mod.ts";
import { runSharedSuite } from "../b3nd-testing/shared-suite.ts";
import type { Schema } from "../b3nd-core/types.ts";
import { assertEquals } from "@std/assert";

/**
 * In-memory mock RedisExecutor for testing without a running Redis server.
 */
class MockRedisExecutor implements RedisExecutor {
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly sortedSets = new Map<
    string,
    Map<string, number>
  >();

  async hset(
    key: string,
    fields: Record<string, string>,
  ): Promise<number> {
    let map = this.hashes.get(key);
    if (!map) {
      map = new Map();
      this.hashes.set(key, map);
    }
    let added = 0;
    for (const [f, v] of Object.entries(fields)) {
      if (!map.has(f)) added++;
      map.set(f, v);
    }
    return added;
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    const map = this.hashes.get(key);
    if (!map || map.size === 0) return null;
    const result: Record<string, string> = {};
    for (const [k, v] of map) result[k] = v;
    return result;
  }

  async hmget(
    keys: string[],
    _fields: string[],
  ): Promise<(Record<string, string> | null)[]> {
    return Promise.all(keys.map((k) => this.hgetall(k)));
  }

  async del(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let deleted = 0;
    for (const k of keys) {
      if (this.hashes.delete(k)) deleted++;
    }
    return deleted;
  }

  async expire(_key: string, _seconds: number): Promise<boolean> {
    // TTL not tracked in mock — always succeed
    return true;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    let set = this.sortedSets.get(key);
    if (!set) {
      set = new Map();
      this.sortedSets.set(key, set);
    }
    const isNew = !set.has(member);
    set.set(member, score);
    return isNew ? 1 : 0;
  }

  async zrem(key: string, member: string): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) return 0;
    return set.delete(member) ? 1 : 0;
  }

  async zrangebyscore(
    key: string,
    _min: string | number,
    _max: string | number,
    options?: { offset?: number; count?: number },
  ): Promise<string[]> {
    const set = this.sortedSets.get(key);
    if (!set) return [];
    const entries = [...set.entries()].sort((a, b) => a[1] - b[1]);
    const offset = options?.offset ?? 0;
    const count = options?.count ?? entries.length;
    return entries.slice(offset, offset + count).map(([m]) => m);
  }

  async zrevrangebyscore(
    key: string,
    _max: string | number,
    _min: string | number,
    options?: { offset?: number; count?: number },
  ): Promise<string[]> {
    const set = this.sortedSets.get(key);
    if (!set) return [];
    const entries = [...set.entries()].sort((a, b) => b[1] - a[1]);
    const offset = options?.offset ?? 0;
    const count = options?.count ?? entries.length;
    return entries.slice(offset, offset + count).map(([m]) => m);
  }

  async zcount(
    key: string,
    _min: string | number,
    _max: string | number,
  ): Promise<number> {
    const set = this.sortedSets.get(key);
    return set?.size ?? 0;
  }

  async zscan(
    key: string,
    _cursor: number,
    options?: { match?: string; count?: number },
  ): Promise<[string, string[]]> {
    const set = this.sortedSets.get(key);
    if (!set) return ["0", []];
    let members = [...set.keys()];
    if (options?.match) {
      const regex = new RegExp(
        options.match.replace(/\*/g, ".*").replace(/\?/g, "."),
      );
      members = members.filter((m) => regex.test(m));
    }
    return ["0", members];
  }

  async ping(): Promise<string> {
    return "PONG";
  }

  async multi(commands: RedisCommand[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const cmd of commands) {
      switch (cmd[0]) {
        case "hset":
          results.push(await this.hset(cmd[1], cmd[2]));
          break;
        case "del":
          results.push(await this.del(cmd[1]));
          break;
        case "expire":
          results.push(await this.expire(cmd[1], cmd[2]));
          break;
        case "zadd":
          results.push(await this.zadd(cmd[1], cmd[2], cmd[3]));
          break;
        case "zrem":
          results.push(await this.zrem(cmd[1], cmd[2]));
          break;
      }
    }
    return results;
  }

  async cleanup(): Promise<void> {
    this.hashes.clear();
    this.sortedSets.clear();
  }
}

// ── Test schema ─────────────────────────────────────────

function createSchema(
  validator?: (value: unknown) => Promise<{ valid: boolean; error?: string }>,
): Schema {
  const defaultValidator = async (
    { value }: { value: unknown; read: unknown },
  ) => {
    if (validator) return validator(value);
    return { valid: true };
  };

  return {
    "store://users": defaultValidator,
    "store://files": defaultValidator,
    "store://pagination": defaultValidator,
    "mutable://accounts": defaultValidator,
    "mutable://open": defaultValidator,
    "mutable://data": defaultValidator,
    "immutable://accounts": defaultValidator,
    "immutable://open": defaultValidator,
    "immutable://data": defaultValidator,
    "hash://sha256": defaultValidator,
  };
}

function createClient(schema?: Schema) {
  const executor = new MockRedisExecutor();
  return new RedisClient(
    {
      connectionUrl: "redis://localhost:6379",
      schema: schema ?? createSchema(),
      keyPrefix: "b3nd",
    },
    executor,
  );
}

// ── Shared suite ────────────────────────────────────────

runSharedSuite("RedisClient", {
  happy: () => createClient(),
  validationError: () =>
    createClient(
      createSchema(async (value) => {
        const data = value as { name?: string };
        if (!data.name) return { valid: false, error: "Name is required" };
        return { valid: true };
      }),
    ),
});

// ── Redis-specific tests ────────────────────────────────

Deno.test("RedisClient: constructor validation", () => {
  const executor = new MockRedisExecutor();

  // Missing config
  try {
    new RedisClient(null as any, executor);
    throw new Error("should have thrown");
  } catch (e) {
    assertEquals((e as Error).message, "RedisClientConfig is required");
  }

  // Missing connectionUrl
  try {
    new RedisClient(
      { connectionUrl: "", schema: createSchema(), keyPrefix: "b3nd" },
      executor,
    );
    throw new Error("should have thrown");
  } catch (e) {
    assertEquals(
      (e as Error).message,
      "connectionUrl is required in RedisClientConfig",
    );
  }

  // Missing executor
  try {
    new RedisClient({
      connectionUrl: "redis://localhost",
      schema: createSchema(),
      keyPrefix: "b3nd",
    });
    throw new Error("should have thrown");
  } catch (e) {
    assertEquals((e as Error).message, "executor is required");
  }
});

Deno.test("RedisClient: health check returns healthy", async () => {
  const client = createClient();
  const health = await client.health();
  assertEquals(health.status, "healthy");
  await client.cleanup();
});

Deno.test("RedisClient: health check after cleanup returns unhealthy", async () => {
  const client = createClient();
  await client.cleanup();
  const health = await client.health();
  assertEquals(health.status, "unhealthy");
});

Deno.test("RedisClient: getSchema returns schema keys", async () => {
  const client = createClient();
  const keys = await client.getSchema();
  assertEquals(keys.includes("mutable://accounts"), true);
  assertEquals(keys.includes("hash://sha256"), true);
  await client.cleanup();
});

Deno.test("RedisClient: rejects unknown program key", async () => {
  const client = createClient();
  const result = await client.receive(["unknown://foo/bar", { test: 1 }]);
  assertEquals(result.accepted, false);
  assertEquals(result.errorDetail?.code, "INVALID_SCHEMA");
  await client.cleanup();
});

Deno.test("RedisClient: write + read round-trip", async () => {
  const client = createClient();
  const data = { name: "Alice", age: 30 };
  const res = await client.receive(["mutable://accounts/alice", data]);
  assertEquals(res.accepted, true);

  const read = await client.read("mutable://accounts/alice");
  assertEquals(read.success, true);
  assertEquals(read.record?.data, data);
  await client.cleanup();
});

Deno.test("RedisClient: read not found", async () => {
  const client = createClient();
  const read = await client.read("mutable://accounts/nonexistent");
  assertEquals(read.success, false);
  assertEquals(read.errorDetail?.code, "NOT_FOUND");
  await client.cleanup();
});

Deno.test("RedisClient: delete existing key", async () => {
  const client = createClient();
  await client.receive(["mutable://accounts/alice", { name: "Alice" }]);
  const del = await client.delete("mutable://accounts/alice");
  assertEquals(del.success, true);

  const read = await client.read("mutable://accounts/alice");
  assertEquals(read.success, false);
  await client.cleanup();
});

Deno.test("RedisClient: delete not found", async () => {
  const client = createClient();
  const del = await client.delete("mutable://accounts/nobody");
  assertEquals(del.success, false);
  assertEquals(del.errorDetail?.code, "NOT_FOUND");
  await client.cleanup();
});

Deno.test("RedisClient: list returns stored items", async () => {
  const client = createClient();
  await client.receive(["mutable://accounts/alice", { name: "Alice" }]);
  await client.receive(["mutable://accounts/bob", { name: "Bob" }]);

  const list = await client.list("mutable://accounts");
  assertEquals(list.success, true);
  if (list.success) {
    assertEquals(list.data.length, 2);
    assertEquals(list.pagination.total, 2);
  }
  await client.cleanup();
});

Deno.test("RedisClient: list with pattern filter", async () => {
  const client = createClient();
  await client.receive(["mutable://accounts/alice", { name: "Alice" }]);
  await client.receive(["mutable://accounts/bob", { name: "Bob" }]);

  const list = await client.list("mutable://accounts", { pattern: "alice" });
  assertEquals(list.success, true);
  if (list.success) {
    assertEquals(list.data.length, 1);
    assertEquals(list.data[0].uri, "mutable://accounts/alice");
  }
  await client.cleanup();
});

Deno.test("RedisClient: readMulti batch read", async () => {
  const client = createClient();
  await client.receive(["mutable://accounts/alice", { name: "Alice" }]);
  await client.receive(["mutable://accounts/bob", { name: "Bob" }]);

  const result = await client.readMulti([
    "mutable://accounts/alice",
    "mutable://accounts/bob",
    "mutable://accounts/nobody",
  ]);
  assertEquals(result.success, true);
  assertEquals(result.summary.succeeded, 2);
  assertEquals(result.summary.failed, 1);
  await client.cleanup();
});

Deno.test("RedisClient: readMulti empty array", async () => {
  const client = createClient();
  const result = await client.readMulti([]);
  assertEquals(result.success, false);
  assertEquals(result.summary.total, 0);
  await client.cleanup();
});

Deno.test("RedisClient: readMulti exceeds limit", async () => {
  const client = createClient();
  const uris = Array.from({ length: 51 }, (_, i) => `mutable://accounts/u${i}`);
  const result = await client.readMulti(uris);
  assertEquals(result.success, false);
  assertEquals(result.summary.failed, 51);
  await client.cleanup();
});

Deno.test("RedisClient: overwrite existing record", async () => {
  const client = createClient();
  await client.receive(["mutable://accounts/alice", { version: 1 }]);
  await client.receive(["mutable://accounts/alice", { version: 2 }]);

  const read = await client.read<{ version: number }>("mutable://accounts/alice");
  assertEquals(read.success, true);
  assertEquals(read.record?.data.version, 2);
  await client.cleanup();
});

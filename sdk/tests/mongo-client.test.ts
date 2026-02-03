/**
 * MongoClient Tests
 *
 * Tests the MongoDB client implementation using the shared test suite.
 * Connects to a real MongoDB instance using an environment-provided URL,
 * or spins up a Docker Mongo container when not provided.
 */

/// <reference lib="deno.ns" />

import { MongoClient } from "../clients/mongo/mod.ts";
import { runSharedSuite } from "./shared-suite.ts";
import type { PersistenceRecord, Schema } from "../src/types.ts";
import type { MongoExecutor } from "../clients/mongo/mod.ts";

import { MongoClient as NativeMongoClient } from "npm:mongodb";

class RealMongoExecutor implements MongoExecutor {
  private readonly client: NativeMongoClient;
  private connected = false;
  private readonly dbName: string;
  private readonly collectionName: string;

  constructor(connectionString: string, dbName: string, collectionName: string) {
    this.client = new NativeMongoClient(connectionString);
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  private async collection() {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
    return this.client.db(this.dbName).collection(this.collectionName);
  }

  async insertOne(doc: Record<string, unknown>) {
    const col = await this.collection();
    const res = await col.insertOne(doc);
    return { acknowledged: res.acknowledged };
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) {
    const col = await this.collection();
    const res = await col.updateOne(filter, update, options);
    return {
      matchedCount: res.matchedCount,
      modifiedCount: res.modifiedCount,
      upsertedId: res.upsertedId,
    };
  }

  async findOne(filter: Record<string, unknown>) {
    const col = await this.collection();
    const doc = await col.findOne(filter);
    return (doc ?? null) as Record<string, unknown> | null;
  }

  async findMany(filter: Record<string, unknown>) {
    const col = await this.collection();
    const docs = await col.find(filter).toArray();
    return docs as Record<string, unknown>[];
  }

  async deleteOne(filter: Record<string, unknown>) {
    const col = await this.collection();
    const res = await col.deleteOne(filter);
    return { deletedCount: res.deletedCount };
  }

  async ping() {
    const db = this.client.db(this.dbName);
    await db.command({ ping: 1 });
    return true;
  }

  async cleanup() {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }
}

interface MongoSetupResult {
  url: string;
  dbName: string;
  collectionName: string;
  containerName?: string;
}

const mongoSetupPromise: Promise<MongoSetupResult> = (async () => {
  const envUrl = Deno.env.get("MONGODB_URL");
  const envDb = Deno.env.get("MONGODB_DB");
  const envCollection = Deno.env.get("MONGODB_COLLECTION");

  if (envUrl && envDb && envCollection) {
    return { url: envUrl, dbName: envDb, collectionName: envCollection };
  }

  const containerName = Deno.env.get("MONGODB_TEST_CONTAINER") ??
    "b3nd-mongo";
  const image = Deno.env.get("MONGODB_TEST_IMAGE") ?? "mongo:8";
  const dbName = Deno.env.get("MONGODB_DB") ?? "b3nd_test";
  const port = Number(Deno.env.get("MONGODB_PORT") ?? "57017");

  const isReady = async (): Promise<boolean> => {
    const cmd = new Deno.Command("docker", {
      args: [
        "exec",
        containerName,
        "mongosh",
        "--quiet",
        "--eval",
        "db.adminCommand('ping')",
      ],
      stdout: "null",
      stderr: "null",
    });
    const result = await cmd.output();
    return result.code === 0;
  };

  // Reuse existing container if it's already running and healthy
  if (await isReady()) {
    console.log(`[mongo-test] Reusing running container "${containerName}"`);
  } else {
    // Clean up any stopped/unhealthy container with same name
    try {
      const rm = new Deno.Command("docker", {
        args: ["rm", "-f", containerName],
        stdout: "null",
        stderr: "null",
      });
      await rm.output();
    } catch {
      // ignore
    }

    const run = new Deno.Command("docker", {
      args: [
        "run",
        "--rm",
        "-d",
        "--name",
        containerName,
        "-e",
        `MONGO_INITDB_DATABASE=${dbName}`,
        "-p",
        `${port}:27017`,
        image,
      ],
      stdout: "piped",
      stderr: "inherit",
    });

    const runResult = await run.output();
    if (runResult.code !== 0) {
      throw new Error("Failed to start MongoDB Docker container for tests");
    }

    for (let i = 0; i < 30; i++) {
      if (await isReady()) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!(await isReady())) {
      throw new Error(
        "MongoDB Docker container did not become ready in time",
      );
    }
  }

  const url = `mongodb://localhost:${port}/${dbName}`;

  return {
    url,
    dbName,
    collectionName: "b3nd_data",
    containerName,
  };
})();

function createSchema(
  validator?: (value: unknown) => Promise<{ valid: boolean; error?: string }>,
): Schema {
  const defaultValidator = async ({ value, read }: { value: unknown; read: unknown }) => {
    if (validator) {
      return validator(value);
    }
    const _ = read as <T = unknown>(
      uri: string,
    ) => Promise<{ success: boolean; record?: PersistenceRecord<T> }>;
    return { valid: true };
  };

  return {
    "store://users": defaultValidator,
    "store://files": defaultValidator, // For binary tests
    "store://pagination": defaultValidator, // For pagination tests
  };
}

async function createClient(
  schema: Schema,
): Promise<MongoClient> {
  const { url, dbName, collectionName } = await mongoSetupPromise;

  const executor = new RealMongoExecutor(url, dbName, collectionName);
  const client = new MongoClient(
    {
      connectionString: url,
      schema,
      collectionName,
    },
    executor,
  );

  return client;
}

runSharedSuite("MongoClient", {
  happy: () => createClient(createSchema()),

  validationError: () =>
    createClient(
      createSchema(async (value) => {
        const data = value as { name?: string };
        if (!data.name) {
          return { valid: false, error: "Name is required" };
        }
        return { valid: true };
      }),
    ),
});

// Optional Docker cleanup (disabled by default to avoid conflicts in parallel runs)
false && Deno.test({
  name: "MongoClient - docker cleanup",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const setup = await mongoSetupPromise;
    if (!setup.containerName) {
      return;
    }
    const stop = new Deno.Command("docker", {
      args: ["rm", "-f", setup.containerName],
      stdout: "null",
      stderr: "null",
    });
    await stop.output();
  },
});

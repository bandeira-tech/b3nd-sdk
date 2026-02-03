/**
 * PostgresClient Tests
 *
 * Tests the PostgreSQL client implementation using the shared test suite.
 * Connects to a real PostgreSQL database using an environment-provided URL.
 */

/// <reference lib="deno.ns" />

import { PostgresClient, type SqlExecutor } from "../clients/postgres/mod.ts";
import { runSharedSuite } from "./shared-suite.ts";
import type { PersistenceRecord, Schema } from "../src/types.ts";

import { Client } from "npm:pg";

class RealSqlExecutor implements SqlExecutor {
  private readonly client: Client;
  private connected = false;

  constructor(connectionString: string) {
    this.client = new Client(connectionString);
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async query(sql: string, args: unknown[] = []) {
    await this.ensureConnected();
    const result = await this.client.query(
      sql,
      args as unknown[],
    );
    return {
      rows: result.rows as unknown[],
      rowCount: (result as any).rowCount as number | undefined,
    };
  }

  async cleanup(): Promise<void> {
    if (this.connected) {
      await this.client.end();
      this.connected = false;
    }
  }
}

interface PostgresSetupResult {
  url: string;
  containerName?: string;
}

const postgresSetupPromise: Promise<PostgresSetupResult> = (async () => {
  const envUrl = Deno.env.get("POSTGRES_URL") ??
    Deno.env.get("DATABASE_URL");

  if (envUrl) {
    return { url: envUrl };
  }

  const containerName = Deno.env.get("POSTGRES_TEST_CONTAINER") ??
    "b3nd-postgres-test";
  const image = Deno.env.get("POSTGRES_TEST_IMAGE") ?? "postgres:17-alpine";
  const db = Deno.env.get("POSTGRES_DB") ?? "b3nd_test";
  const user = Deno.env.get("POSTGRES_USER") ?? "postgres";
  const password = Deno.env.get("POSTGRES_PASSWORD") ?? "postgres";
  const port = Number(Deno.env.get("POSTGRES_PORT") ?? "55432");

  // Best-effort cleanup of any stray container from previous runs
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
      `POSTGRES_DB=${db}`,
      "-e",
      `POSTGRES_USER=${user}`,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-p",
      `${port}:5432`,
      image,
    ],
    stdout: "piped",
    stderr: "inherit",
  });

  const runResult = await run.output();
  if (runResult.code !== 0) {
    throw new Error("Failed to start PostgreSQL Docker container for tests");
  }

  // Wait for Postgres to be ready
  const isReady = async (): Promise<boolean> => {
    const cmd = new Deno.Command("docker", {
      args: [
        "exec",
        containerName,
        "pg_isready",
        "-U",
        user,
      ],
      stdout: "null",
      stderr: "null",
    });
    const result = await cmd.output();
    return result.code === 0;
  };

  for (let i = 0; i < 30; i++) {
    if (await isReady()) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!(await isReady())) {
    throw new Error("PostgreSQL Docker container did not become ready in time");
  }

  const url = `postgresql://${encodeURIComponent(user)}:${
    encodeURIComponent(password)
  }@localhost:${port}/${db}`;

  return { url, containerName };
})();

function createSchema(
  validator?: (value: unknown) => Promise<{ valid: boolean; error?: string }>,
): Schema {
  const defaultValidator = async ({ value, read }: { value: unknown; read: unknown }) => {
    if (validator) {
      return validator(value);
    }
    // Default happy-path validator
    const _ = read as <T = unknown>(
      uri: string,
    ) => Promise<{ success: boolean; record?: PersistenceRecord<T> }>;
    return { valid: true };
  };

  return {
    "store://users": defaultValidator,
    "store://files": defaultValidator, // For binary tests
  };
}

async function createClient(
  schema: Schema,
): Promise<PostgresClient> {
  const { url } = await postgresSetupPromise;

  const executor = new RealSqlExecutor(url);
  const client = new PostgresClient(
    {
      connection: url,
      schema,
      tablePrefix: "b3nd",
      poolSize: 1,
      connectionTimeout: 5000,
    },
    executor,
  );

  // Ensure schema exists in the target database
  await client.initializeSchema();
  return client;
}

runSharedSuite("PostgresClient", {
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

// Ensure Docker container is cleaned up when tests finish (if we created one)
false && Deno.test({
  name: "PostgresClient - docker cleanup",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const setup = await postgresSetupPromise;
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

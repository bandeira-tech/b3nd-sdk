/**
 * @module
 * Backend factory — resolves URL strings to typed b3nd clients.
 *
 * Scheme mapping:
 *   http:// | https://    → HttpClient
 *   ws:// | wss://        → WebSocketClient
 *   postgresql://         → PostgresClient (requires executor factory)
 *   mongodb://            → MongoClient (requires executor factory)
 *   memory://             → MemoryClient
 */

import type { NodeProtocolInterface, Schema } from "../../b3nd-core/types.ts";
import { HttpClient } from "../../b3nd-client-http/mod.ts";
import { MemoryClient } from "../../b3nd-client-memory/mod.ts";
import type { MongoExecutor, PostgresExecutor } from "../types.ts";

/**
 * Resolve a single backend URL string into a NodeProtocolInterface client.
 */
export async function resolveBackend(
  spec: string,
  opts: {
    schema?: Schema;
    executors?: {
      postgres?: (connectionString: string) => Promise<PostgresExecutor>;
      mongo?: (
        connectionString: string,
        dbName: string,
        collectionName: string,
      ) => Promise<MongoExecutor>;
    };
  },
): Promise<NodeProtocolInterface> {
  // HTTP / HTTPS → HttpClient
  if (spec.startsWith("http://") || spec.startsWith("https://")) {
    return new HttpClient({ url: spec });
  }

  // WebSocket → WebSocketClient
  if (spec.startsWith("ws://") || spec.startsWith("wss://")) {
    const { WebSocketClient } = await import("../../b3nd-client-ws/mod.ts");
    return new WebSocketClient({ url: spec });
  }

  // Memory → MemoryClient
  if (spec.startsWith("memory://")) {
    return new MemoryClient({ schema: opts.schema || {} });
  }

  // PostgreSQL → PostgresClient
  if (spec.startsWith("postgresql://") || spec.startsWith("postgres://")) {
    if (!opts.executors?.postgres) {
      throw new Error(
        `PostgreSQL backend requires an executor factory. ` +
          `Pass executors.postgres in RigConfig.`,
      );
    }

    const { PostgresClient } = await import(
      "../../b3nd-client-postgres/mod.ts"
    );
    const executor = await opts.executors.postgres(spec);
    const pg = new PostgresClient(
      {
        connection: spec,
        tablePrefix: "b3nd",
        schema: opts.schema || {},
        poolSize: 5,
        connectionTimeout: 10_000,
      },
      executor as any,
    );

    await pg.initializeSchema();
    return pg;
  }

  // MongoDB → MongoClient
  if (spec.startsWith("mongodb://") || spec.startsWith("mongodb+srv://")) {
    if (!opts.executors?.mongo) {
      throw new Error(
        `MongoDB backend requires an executor factory. ` +
          `Pass executors.mongo in RigConfig.`,
      );
    }

    const url = new URL(spec);
    const dbName = url.pathname.replace(/^\//, "");
    if (!dbName) {
      throw new Error(`MongoDB URL must include database in path: ${spec}`);
    }
    const collectionName = url.searchParams.get("collection") ?? "b3nd_data";

    const { MongoClient } = await import("../../b3nd-client-mongo/mod.ts");
    const executor = await opts.executors.mongo(spec, dbName, collectionName);
    return new MongoClient(
      {
        connectionString: spec,
        schema: opts.schema || {},
        collectionName,
      },
      executor,
    );
  }

  throw new Error(`Unsupported backend URL scheme: ${spec}`);
}

/**
 * Resolve an array of backend specs (strings or pre-built clients) into clients.
 */
export async function resolveBackends(
  specs: (string | NodeProtocolInterface)[],
  opts: {
    schema?: Schema;
    executors?: {
      postgres?: (connectionString: string) => Promise<PostgresExecutor>;
      mongo?: (
        connectionString: string,
        dbName: string,
        collectionName: string,
      ) => Promise<MongoExecutor>;
    };
  },
): Promise<NodeProtocolInterface[]> {
  const clients: NodeProtocolInterface[] = [];

  for (const spec of specs) {
    if (typeof spec === "string") {
      clients.push(await resolveBackend(spec, opts));
    } else {
      // Pre-built client — pass through
      clients.push(spec);
    }
  }

  return clients;
}

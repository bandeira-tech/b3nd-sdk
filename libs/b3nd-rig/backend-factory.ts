/**
 * @module
 * Backend factory — resolves URL strings into typed clients.
 *
 * Protocol → Client mapping:
 *   https:// | http://   → HttpClient
 *   wss:// | ws://       → WebSocketClient
 *   memory://             → MemoryClient
 *   postgresql://         → PostgresClient (requires executor)
 *   mongodb://            → MongoClient (requires executor)
 *   sqlite://             → SqliteClient (requires executor)
 */

import type { NodeProtocolInterface, Schema } from "../b3nd-core/types.ts";
import type { PostgresExecutorFactory, MongoExecutorFactory, SqliteExecutorFactory } from "./types.ts";
import { HttpClient } from "../b3nd-client-http/mod.ts";
import { WebSocketClient } from "../b3nd-client-ws/mod.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";

/** Default schema for memory:// backends — includes hash:// for MessageData envelopes. */
function createRigTestSchema(): Schema {
  const acceptAll = async () => ({ valid: true });
  return {
    "mutable://accounts": acceptAll,
    "mutable://open": acceptAll,
    "mutable://data": acceptAll,
    "immutable://accounts": acceptAll,
    "immutable://open": acceptAll,
    "immutable://data": acceptAll,
    "hash://sha256": acceptAll,
  };
}

export interface BackendFactoryOptions {
  schema?: Schema;
  executors?: {
    postgres?: PostgresExecutorFactory;
    mongo?: MongoExecutorFactory;
    sqlite?: SqliteExecutorFactory;
  };
}

/**
 * Create a NodeProtocolInterface client from a URL string.
 */
export async function createClientFromUrl(
  url: string,
  options: BackendFactoryOptions = {},
): Promise<NodeProtocolInterface> {
  const parsed = new URL(url);
  const protocol = parsed.protocol;

  switch (protocol) {
    case "https:":
    case "http:": {
      return new HttpClient({ url });
    }

    case "wss:":
    case "ws:": {
      return new WebSocketClient({ url });
    }

    case "memory:": {
      const schema = options.schema || createRigTestSchema();
      return new MemoryClient({ schema });
    }

    case "postgresql:":
    case "postgres:": {
      if (!options.executors?.postgres) {
        throw new Error(
          `PostgreSQL URL requires an executor factory. Pass executors.postgres to Rig.init().`,
        );
      }
      const { PostgresClient } = await import("../b3nd-client-postgres/mod.ts");
      const schema = options.schema;
      if (!schema) {
        throw new Error("PostgreSQL backend requires a schema.");
      }
      const executor = await options.executors.postgres(url);
      const client = new PostgresClient(
        {
          connection: url,
          schema,
          tablePrefix: "b3nd",
          poolSize: 5,
          connectionTimeout: 30000,
        },
        executor,
      );
      await client.initializeSchema();
      return client;
    }

    case "mongodb:":
    case "mongodb+srv:": {
      if (!options.executors?.mongo) {
        throw new Error(
          `MongoDB URL requires an executor factory. Pass executors.mongo to Rig.init().`,
        );
      }
      const schema = options.schema;
      if (!schema) {
        throw new Error("MongoDB backend requires a schema.");
      }
      // Parse db and collection from URL or use defaults
      const dbName = parsed.pathname.replace(/^\//, "") || "b3nd";
      const collectionName = "b3nd_data";

      const { MongoClient } = await import("../b3nd-client-mongo/mod.ts");
      const executor = await options.executors.mongo(url, dbName, collectionName);
      return new MongoClient(
        {
          connectionString: url,
          schema,
          collectionName,
        },
        executor,
      );
    }

    case "sqlite:": {
      if (!options.executors?.sqlite) {
        throw new Error(
          `SQLite URL requires an executor factory. Pass executors.sqlite to Rig.init().`,
        );
      }
      const schema = options.schema;
      if (!schema) {
        throw new Error("SQLite backend requires a schema.");
      }
      // sqlite://path/to/db.sqlite or sqlite://:memory:
      const path = parsed.pathname === "/:memory:" ? ":memory:" : parsed.pathname;
      const { SqliteClient } = await import("../b3nd-client-sqlite/mod.ts");
      const executor = options.executors.sqlite(path);
      return new SqliteClient(
        {
          path,
          schema,
          tablePrefix: "b3nd",
        },
        executor,
      );
    }

    default:
      throw new Error(
        `Unsupported backend URL protocol: "${protocol}". ` +
          `Supported: https://, http://, wss://, ws://, memory://, postgresql://, mongodb://, sqlite://`,
      );
  }
}

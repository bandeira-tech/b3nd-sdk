/**
 * Node builder for managed nodes.
 *
 * Constructs NodeProtocolInterface clients from BackendSpec arrays,
 * using Store + MessageDataClient (envelope-aware protocol wrapper).
 */

import {
  HttpClient,
  type NodeProtocolInterface,
} from "@bandeira-tech/b3nd-sdk";
import { MessageDataClient } from "../b3nd-core/message-data-client.ts";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import type { BackendSpec } from "./types.ts";

/**
 * Build an array of clients from backend specifications.
 *
 * For PostgreSQL and MongoDB backends, the caller must provide executor
 * factories since those depend on platform-specific drivers.
 */
export async function buildClientsFromSpec(
  backends: BackendSpec[],
  executors?: {
    postgres?: (connectionString: string) => Promise<any>;
    mongo?: (
      connectionString: string,
      dbName: string,
      collectionName: string,
    ) => Promise<any>;
    sqlite?: (path: string) => any;
    fs?: (rootDir: string) => any;
    ipfs?: (apiUrl: string) => any;
  },
): Promise<NodeProtocolInterface[]> {
  const clients: NodeProtocolInterface[] = [];

  for (const spec of backends) {
    switch (spec.type) {
      case "memory": {
        clients.push(new MessageDataClient(new MemoryStore()));
        break;
      }

      case "postgresql": {
        if (!executors?.postgres) {
          throw new Error(
            "PostgreSQL executor factory required for postgresql backend",
          );
        }
        const { PostgresStore } = await import(
          "../b3nd-client-postgres/store.ts"
        );
        const { generatePostgresSchema } = await import(
          "../b3nd-client-postgres/schema.ts"
        );
        const executor = await executors.postgres(spec.url);
        const tablePrefix =
          (spec.options?.tablePrefix as string) ?? "b3nd";
        // Initialize schema (create tables if needed)
        const schemaSQL = generatePostgresSchema(tablePrefix);
        await executor.query(schemaSQL);
        const store = new PostgresStore(tablePrefix, executor);
        clients.push(new MessageDataClient(store));
        break;
      }

      case "mongodb": {
        if (!executors?.mongo) {
          throw new Error(
            "MongoDB executor factory required for mongodb backend",
          );
        }
        const url = new URL(spec.url);
        const dbName = url.pathname.replace(/^\//, "");
        if (!dbName) {
          throw new Error(
            `MongoDB spec must include database in path: ${spec.url}`,
          );
        }
        const collectionName = (spec.options?.collectionName as string) ??
          url.searchParams.get("collection") ?? "b3nd_data";
        const { MongoStore } = await import("../b3nd-client-mongo/store.ts");
        const executor = await executors.mongo(
          spec.url,
          dbName,
          collectionName,
        );
        const store = new MongoStore(collectionName, executor);
        clients.push(new MessageDataClient(store));
        break;
      }

      case "sqlite": {
        if (!executors?.sqlite) {
          throw new Error(
            "SQLite executor factory required for sqlite backend",
          );
        }
        const sqlitePath = new URL(spec.url).pathname || ":memory:";
        const { SqliteStore } = await import("../b3nd-client-sqlite/store.ts");
        const executor = executors.sqlite(sqlitePath);
        const tablePrefix =
          (spec.options?.tablePrefix as string) ?? "b3nd";
        const store = new SqliteStore(tablePrefix, executor);
        clients.push(new MessageDataClient(store));
        break;
      }

      case "filesystem": {
        if (!executors?.fs) {
          throw new Error(
            "Filesystem executor factory required for filesystem backend",
          );
        }
        const rootDir = new URL(spec.url).pathname;
        const { FsStore } = await import("../b3nd-client-fs/store.ts");
        const executor = executors.fs(rootDir);
        const store = new FsStore(rootDir, executor);
        clients.push(new MessageDataClient(store));
        break;
      }

      case "http": {
        clients.push(new HttpClient({ url: spec.url }));
        break;
      }

      default:
        throw new Error(`Unsupported backend type: ${(spec as any).type}`);
    }
  }

  return clients;
}

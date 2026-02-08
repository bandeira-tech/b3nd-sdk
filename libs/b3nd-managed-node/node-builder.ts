/**
 * Node builder for managed nodes.
 *
 * Constructs NodeProtocolInterface clients from BackendSpec arrays,
 * extracted from the client construction logic in apps/b3nd-node/mod.ts.
 */

import {
  HttpClient,
  MemoryClient,
  type NodeProtocolInterface,
  type Schema,
} from "@bandeira-tech/b3nd-sdk";
import type { BackendSpec } from "./types.ts";

/**
 * Build an array of clients from backend specifications.
 *
 * For PostgreSQL and MongoDB backends, the caller must provide executor
 * factories since those depend on platform-specific drivers.
 */
export async function buildClientsFromSpec(
  backends: BackendSpec[],
  schema: Schema,
  executors?: {
    postgres?: (connectionString: string) => Promise<any>;
    mongo?: (connectionString: string, dbName: string, collectionName: string) => Promise<any>;
  },
): Promise<NodeProtocolInterface[]> {
  const clients: NodeProtocolInterface[] = [];

  for (const spec of backends) {
    switch (spec.type) {
      case "memory": {
        clients.push(new MemoryClient({ schema }));
        break;
      }

      case "postgresql": {
        // Dynamic import to avoid hard dependency on postgres driver
        const { PostgresClient } = await import("@bandeira-tech/b3nd-sdk");
        if (!executors?.postgres) {
          throw new Error("PostgreSQL executor factory required for postgresql backend");
        }
        const executor = await executors.postgres(spec.url);
        const pg = new PostgresClient(
          {
            connection: spec.url,
            tablePrefix: (spec.options?.tablePrefix as string) ?? "b3nd",
            schema,
            poolSize: (spec.options?.poolSize as number) ?? 5,
            connectionTimeout: (spec.options?.connectionTimeout as number) ?? 10_000,
          },
          executor as any,
        );
        await pg.initializeSchema();
        clients.push(pg);
        break;
      }

      case "mongodb": {
        const { MongoClient } = await import("@bandeira-tech/b3nd-sdk");
        if (!executors?.mongo) {
          throw new Error("MongoDB executor factory required for mongodb backend");
        }
        const url = new URL(spec.url);
        const dbName = url.pathname.replace(/^\//, "");
        if (!dbName) {
          throw new Error(`MongoDB spec must include database in path: ${spec.url}`);
        }
        const collectionName = (spec.options?.collectionName as string) ??
          url.searchParams.get("collection") ?? "b3nd_data";
        const executor = await executors.mongo(spec.url, dbName, collectionName);
        const mongo = new MongoClient(
          {
            connectionString: spec.url,
            schema,
            collectionName,
          },
          executor,
        );
        clients.push(mongo);
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

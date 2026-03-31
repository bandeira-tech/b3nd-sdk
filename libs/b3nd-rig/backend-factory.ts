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
 *   file://               → FilesystemClient (requires executor)
 *   ipfs://               → IpfsClient (requires executor)
 *   s3://                 → S3Client (requires executor)
 *   elasticsearch://      → ElasticsearchClient (requires executor)
 */

import type { NodeProtocolInterface } from "../b3nd-core/types.ts";
import type {
  ElasticsearchExecutorFactory,
  FsExecutorFactory,
  IpfsExecutorFactory,
  MongoExecutorFactory,
  PostgresExecutorFactory,
  S3ExecutorFactory,
  SqliteExecutorFactory,
} from "./types.ts";
import { HttpClient } from "../b3nd-client-http/mod.ts";
import { WebSocketClient } from "../b3nd-client-ws/mod.ts";
import { MemoryClient } from "../b3nd-client-memory/mod.ts";

/** All supported backend URL protocols. */
export const SUPPORTED_PROTOCOLS = [
  "https://",
  "http://",
  "wss://",
  "ws://",
  "memory://",
  "postgresql://",
  "mongodb://",
  "mongodb+srv://",
  "sqlite://",
  "file://",
  "ipfs://",
  "s3://",
  "elasticsearch://",
] as const;

/** Returns the list of supported backend URL protocols. */
export function getSupportedProtocols(): readonly string[] {
  return SUPPORTED_PROTOCOLS;
}

export interface BackendFactoryOptions {
  executors?: {
    postgres?: PostgresExecutorFactory;
    mongo?: MongoExecutorFactory;
    sqlite?: SqliteExecutorFactory;
    fs?: FsExecutorFactory;
    ipfs?: IpfsExecutorFactory;
    s3?: S3ExecutorFactory;
    elasticsearch?: ElasticsearchExecutorFactory;
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
      return new MemoryClient();
    }

    case "postgresql:":
    case "postgres:": {
      if (!options.executors?.postgres) {
        throw new Error(
          `PostgreSQL URL requires an executor factory. Pass executors.postgres to createClientFromUrl().`,
        );
      }
      const { PostgresClient } = await import("../b3nd-client-postgres/mod.ts");
      const executor = await options.executors.postgres(url);
      const client = new PostgresClient(
        {
          connection: url,
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
          `MongoDB URL requires an executor factory. Pass executors.mongo to createClientFromUrl().`,
        );
      }
      const dbName = parsed.pathname.replace(/^\//, "") || "b3nd";
      const collectionName = "b3nd_data";

      const { MongoClient } = await import("../b3nd-client-mongo/mod.ts");
      const executor = await options.executors.mongo(
        url,
        dbName,
        collectionName,
      );
      return new MongoClient(
        {
          connectionString: url,
          collectionName,
        },
        executor,
      );
    }

    case "sqlite:": {
      if (!options.executors?.sqlite) {
        throw new Error(
          `SQLite URL requires an executor factory. Pass executors.sqlite to createClientFromUrl().`,
        );
      }
      const path = parsed.pathname === "/:memory:"
        ? ":memory:"
        : parsed.pathname;
      const { SqliteClient } = await import("../b3nd-client-sqlite/mod.ts");
      const executor = options.executors.sqlite(path);
      return new SqliteClient(
        {
          path,
          tablePrefix: "b3nd",
        },
        executor,
      );
    }

    case "file:": {
      if (!options.executors?.fs) {
        throw new Error(
          `File URL requires an executor factory. Pass executors.fs to createClientFromUrl().`,
        );
      }
      const rootDir = parsed.pathname;
      const { FilesystemClient } = await import("../b3nd-client-fs/mod.ts");
      const executor = options.executors.fs(rootDir);
      return new FilesystemClient(
        {
          rootDir,
        },
        executor,
      );
    }

    case "ipfs:": {
      if (!options.executors?.ipfs) {
        throw new Error(
          `IPFS URL requires an executor factory. Pass executors.ipfs to createClientFromUrl().`,
        );
      }
      const apiUrl = `http://${parsed.hostname}${
        parsed.port ? ":" + parsed.port : ":5001"
      }${parsed.pathname}`;
      const { IpfsClient } = await import("../b3nd-client-ipfs/mod.ts");
      const executor = options.executors.ipfs(apiUrl);
      return new IpfsClient(
        {
          apiUrl,
        },
        executor,
      );
    }

    case "s3:": {
      if (!options.executors?.s3) {
        throw new Error(
          `S3 URL requires an executor factory. Pass executors.s3 to createClientFromUrl().`,
        );
      }
      const bucket = parsed.hostname;
      const prefix = parsed.pathname.length > 1
        ? parsed.pathname.substring(1)
        : "";
      const { S3Client } = await import("../b3nd-client-s3/mod.ts");
      const executor = options.executors.s3(bucket, prefix);
      return new S3Client(
        {
          bucket,
          prefix,
        },
        executor,
      );
    }

    case "elasticsearch:": {
      if (!options.executors?.elasticsearch) {
        throw new Error(
          `Elasticsearch URL requires an executor factory. Pass executors.elasticsearch to createClientFromUrl().`,
        );
      }
      const endpoint = `http://${parsed.hostname}${
        parsed.port ? ":" + parsed.port : ":9200"
      }`;
      const { ElasticsearchClient } = await import(
        "../b3nd-client-elasticsearch/mod.ts"
      );
      const executor = options.executors.elasticsearch(endpoint);
      return new ElasticsearchClient(
        {
          indexPrefix: "b3nd",
        },
        executor,
      );
    }

    default:
      throw new Error(
        `Unsupported backend URL protocol: "${protocol}". ` +
          `Supported: ${SUPPORTED_PROTOCOLS.join(", ")}`,
      );
  }
}

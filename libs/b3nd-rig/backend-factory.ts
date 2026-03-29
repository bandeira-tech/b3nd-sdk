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
 *   graphql://            → GraphQLClient (optional executor)
 */

import type { NodeProtocolInterface, Schema } from "../b3nd-core/types.ts";
import type {
  FsExecutorFactory,
  GraphQLExecutorFactory,
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
  "graphql://",
] as const;

/** Returns the list of supported backend URL protocols. */
export function getSupportedProtocols(): readonly string[] {
  return SUPPORTED_PROTOCOLS;
}

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
    fs?: FsExecutorFactory;
    ipfs?: IpfsExecutorFactory;
    s3?: S3ExecutorFactory;
    graphql?: GraphQLExecutorFactory;
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
      const executor = await options.executors.mongo(
        url,
        dbName,
        collectionName,
      );
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
      const path = parsed.pathname === "/:memory:"
        ? ":memory:"
        : parsed.pathname;
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

    case "file:": {
      if (!options.executors?.fs) {
        throw new Error(
          `File URL requires an executor factory. Pass executors.fs to Rig.init().`,
        );
      }
      const schema = options.schema;
      if (!schema) {
        throw new Error("Filesystem backend requires a schema.");
      }
      // file:///path/to/root → rootDir = /path/to/root
      const rootDir = parsed.pathname;
      const { FilesystemClient } = await import("../b3nd-client-fs/mod.ts");
      const executor = options.executors.fs(rootDir);
      return new FilesystemClient(
        {
          rootDir,
          schema,
        },
        executor,
      );
    }

    case "ipfs:": {
      if (!options.executors?.ipfs) {
        throw new Error(
          `IPFS URL requires an executor factory. Pass executors.ipfs to Rig.init().`,
        );
      }
      const schema = options.schema;
      if (!schema) {
        throw new Error("IPFS backend requires a schema.");
      }
      // ipfs://host:port → apiUrl = http://host:port
      const apiUrl = `http://${parsed.hostname}${
        parsed.port ? ":" + parsed.port : ":5001"
      }${parsed.pathname}`;
      const { IpfsClient } = await import("../b3nd-client-ipfs/mod.ts");
      const executor = options.executors.ipfs(apiUrl);
      return new IpfsClient(
        {
          apiUrl,
          schema,
        },
        executor,
      );
    }

    case "s3:": {
      if (!options.executors?.s3) {
        throw new Error(
          `S3 URL requires an executor factory. Pass executors.s3 to Rig.init().`,
        );
      }
      const schema = options.schema;
      if (!schema) {
        throw new Error("S3 backend requires a schema.");
      }
      // s3://bucket-name/optional/prefix
      const bucket = parsed.hostname;
      const prefix = parsed.pathname.length > 1
        ? parsed.pathname.substring(1) // strip leading "/"
        : "";
      const { S3Client } = await import("../b3nd-client-s3/mod.ts");
      const executor = options.executors.s3(bucket, prefix);
      return new S3Client(
        {
          bucket,
          prefix,
          schema,
        },
        executor,
      );
    }

    case "graphql:": {
      // graphql://host:port/path → http://host:port/path
      const graphqlUrl = `http://${parsed.hostname}${
        parsed.port ? ":" + parsed.port : ""
      }${parsed.pathname}`;
      const { GraphQLClient } = await import(
        "../b3nd-client-graphql/mod.ts"
      );
      const gqlSchema = options.schema;
      const config = { url: graphqlUrl, schema: gqlSchema };
      if (options.executors?.graphql) {
        const executor = options.executors.graphql(graphqlUrl);
        return new GraphQLClient(config, executor);
      }
      return new GraphQLClient(config);
    }

    default:
      throw new Error(
        `Unsupported backend URL protocol: "${protocol}". ` +
          `Supported: ${SUPPORTED_PROTOCOLS.join(", ")}`,
      );
  }
}

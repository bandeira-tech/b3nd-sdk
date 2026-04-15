/**
 * @module
 * Backend factory — resolves URL strings into Stores and Clients.
 *
 * Two entry points:
 *   createStoreFromUrl(url, options)   → Store
 *   createClientFromUrl(url, options)  → NodeProtocolInterface
 *
 * createStoreFromUrl is the primitive — it maps a URL to a Store.
 * createClientFromUrl wraps that Store with a client class.
 *
 * Protocol → Store mapping:
 *   memory://             → MemoryStore
 *   postgresql://         → PostgresStore (requires executor)
 *   mongodb://            → MongoStore (requires executor)
 *   sqlite://             → SqliteStore (requires executor)
 *   file://               → FsStore (requires executor)
 *   ipfs://               → IpfsStore (requires executor)
 *   s3://                 → S3Store (requires executor)
 *   elasticsearch://      → ElasticsearchStore (requires executor)
 *
 * Transport protocols (no Store — return clients directly):
 *   https:// | http://    → HttpClient
 *   wss:// | ws://        → WebSocketClient
 *   console://            → ConsoleClient (write-only sink, no storage)
 */

import type { NodeProtocolInterface, Store } from "../b3nd-core/types.ts";
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
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { ConsoleClient } from "../b3nd-client-console/client.ts";
import { SimpleClient } from "../b3nd-core/simple-client.ts";

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
  "console://",
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

/** Constructor type for clients that wrap a Store. */
export type StoreClientConstructor = new (store: Store) => NodeProtocolInterface;

// ── Storage protocols (URL → Store) ─────────────────────────────────

const TRANSPORT_PROTOCOLS = new Set(["https:", "http:", "wss:", "ws:", "console:"]);

/**
 * Create a Store from a URL string.
 *
 * Works for storage protocols only (memory, postgresql, mongodb, etc.).
 * Transport protocols (http, ws) throw — use createClientFromUrl instead.
 */
export async function createStoreFromUrl(
  url: string,
  options: BackendFactoryOptions = {},
): Promise<Store> {
  const parsed = new URL(url);
  const protocol = parsed.protocol;

  if (TRANSPORT_PROTOCOLS.has(protocol)) {
    throw new Error(
      `"${protocol}" is a transport protocol with no Store. ` +
        `Use createClientFromUrl() for HTTP/WebSocket backends.`,
    );
  }

  switch (protocol) {
    case "memory:":
      return new MemoryStore();

    case "postgresql:":
    case "postgres:": {
      if (!options.executors?.postgres) {
        throw new Error(
          `PostgreSQL URL requires an executor factory. ` +
            `Pass executors.postgres to createStoreFromUrl().`,
        );
      }
      const { PostgresStore } = await import(
        "../b3nd-client-postgres/store.ts"
      );
      const executor = await options.executors.postgres(url);
      return new PostgresStore("b3nd", executor);
    }

    case "mongodb:":
    case "mongodb+srv:": {
      if (!options.executors?.mongo) {
        throw new Error(
          `MongoDB URL requires an executor factory. ` +
            `Pass executors.mongo to createStoreFromUrl().`,
        );
      }
      const dbName = parsed.pathname.replace(/^\//, "") || "b3nd";
      const collectionName = "b3nd_data";
      const { MongoStore } = await import("../b3nd-client-mongo/store.ts");
      const executor = await options.executors.mongo(
        url,
        dbName,
        collectionName,
      );
      return new MongoStore(collectionName, executor);
    }

    case "sqlite:": {
      if (!options.executors?.sqlite) {
        throw new Error(
          `SQLite URL requires an executor factory. ` +
            `Pass executors.sqlite to createStoreFromUrl().`,
        );
      }
      const path = parsed.pathname === "/:memory:"
        ? ":memory:"
        : parsed.pathname;
      const { SqliteStore } = await import("../b3nd-client-sqlite/store.ts");
      const executor = options.executors.sqlite(path);
      return new SqliteStore("b3nd", executor);
    }

    case "file:": {
      if (!options.executors?.fs) {
        throw new Error(
          `File URL requires an executor factory. ` +
            `Pass executors.fs to createStoreFromUrl().`,
        );
      }
      const rootDir = parsed.pathname;
      const { FsStore } = await import("../b3nd-client-fs/store.ts");
      const executor = options.executors.fs(rootDir);
      return new FsStore(rootDir, executor);
    }

    case "ipfs:": {
      if (!options.executors?.ipfs) {
        throw new Error(
          `IPFS URL requires an executor factory. ` +
            `Pass executors.ipfs to createStoreFromUrl().`,
        );
      }
      const apiUrl = `http://${parsed.hostname}${
        parsed.port ? ":" + parsed.port : ":5001"
      }${parsed.pathname}`;
      const { IpfsStore } = await import("../b3nd-client-ipfs/store.ts");
      const executor = options.executors.ipfs(apiUrl);
      return new IpfsStore(executor);
    }

    case "s3:": {
      if (!options.executors?.s3) {
        throw new Error(
          `S3 URL requires an executor factory. ` +
            `Pass executors.s3 to createStoreFromUrl().`,
        );
      }
      const bucket = parsed.hostname;
      const prefix = parsed.pathname.length > 1
        ? parsed.pathname.substring(1)
        : "";
      const { S3Store } = await import("../b3nd-client-s3/store.ts");
      const executor = options.executors.s3(bucket, prefix);
      return new S3Store(bucket, executor, prefix);
    }

    case "elasticsearch:": {
      if (!options.executors?.elasticsearch) {
        throw new Error(
          `Elasticsearch URL requires an executor factory. ` +
            `Pass executors.elasticsearch to createStoreFromUrl().`,
        );
      }
      const { ElasticsearchStore } = await import(
        "../b3nd-client-elasticsearch/store.ts"
      );
      const executor = options.executors.elasticsearch(
        `http://${parsed.hostname}${parsed.port ? ":" + parsed.port : ":9200"}`,
      );
      return new ElasticsearchStore("b3nd", executor);
    }

    default:
      throw new Error(
        `Unsupported backend URL protocol: "${protocol}". ` +
          `Supported: ${SUPPORTED_PROTOCOLS.join(", ")}`,
      );
  }
}

// ── Client from URL ─────────────────────────────────────────────────

/**
 * Create a NodeProtocolInterface client from a URL string.
 *
 * For storage protocols: creates a Store, wraps with the given client class
 * (defaults to SimpleClient).
 *
 * For transport protocols (http, ws): returns the transport client directly
 * (client arg is ignored — there's no Store to wrap).
 */
export async function createClientFromUrl(
  url: string,
  options?: BackendFactoryOptions & { client?: StoreClientConstructor },
): Promise<NodeProtocolInterface>;
/**
 * Create a NodeProtocolInterface client from a URL string with a specific
 * client class.
 */
export async function createClientFromUrl(
  url: string,
  Client: StoreClientConstructor,
  options?: BackendFactoryOptions,
): Promise<NodeProtocolInterface>;
export async function createClientFromUrl(
  url: string,
  clientOrOptions?:
    | StoreClientConstructor
    | (BackendFactoryOptions & { client?: StoreClientConstructor }),
  maybeOptions?: BackendFactoryOptions,
): Promise<NodeProtocolInterface> {
  let ClientClass: StoreClientConstructor;
  let options: BackendFactoryOptions;

  if (typeof clientOrOptions === "function") {
    // createClientFromUrl(url, Client, options?)
    ClientClass = clientOrOptions;
    options = maybeOptions ?? {};
  } else {
    // createClientFromUrl(url, options?)
    const opts = clientOrOptions ?? {};
    ClientClass = (opts as { client?: StoreClientConstructor }).client ??
      SimpleClient;
    options = opts;
  }

  const parsed = new URL(url);
  const protocol = parsed.protocol;

  // Transport protocols — return client directly (no Store)
  switch (protocol) {
    case "https:":
    case "http:":
      return new HttpClient({ url });
    case "wss:":
    case "ws:":
      return new WebSocketClient({ url });
    case "console:": {
      const label = parsed.hostname || "b3nd";
      return new ConsoleClient(label);
    }
  }

  // Storage protocols — create Store, wrap with client
  const store = await createStoreFromUrl(url, options);
  return new ClientClass(store);
}

// ── Resolvers (configure once, resolve many) ───────────────────────

/**
 * Create a store resolver — bind executor factories once, resolve URLs later.
 *
 * This is the primary pattern for runtime URL → Store mapping.
 * Configure your executor factories once (from env, config, DI container),
 * then use the returned function to resolve any number of URLs.
 *
 * Only handles storage protocols (memory, postgresql, mongodb, etc.).
 * Transport URLs (http, ws) will throw — those produce clients directly,
 * not Stores.
 *
 * @example
 * ```typescript
 * const resolveStore = createStoreResolver({
 *   postgres: (url) => createPgExecutor(url),
 *   mongo: (url, db, coll) => createMongoExecutor(url, db, coll),
 * });
 *
 * // Map env-var URLs to stores
 * const urls = process.env.BACKEND_URLS!.split(",");
 * const stores = await Promise.all(urls.map(resolveStore));
 * ```
 */
export function createStoreResolver(
  executors: BackendFactoryOptions["executors"] = {},
): (url: string) => Promise<Store> {
  const options: BackendFactoryOptions = { executors };
  return (url: string) => createStoreFromUrl(url, options);
}

/**
 * Create a client resolver — bind a client class and executor factories once,
 * resolve URLs later.
 *
 * For storage protocols: creates a Store and wraps it with the given client class.
 * For transport protocols (http, ws): returns the transport client directly
 * (client class is ignored — there's no Store to wrap).
 *
 * @example
 * ```typescript
 * import { DataClient } from "@bandeira-tech/b3nd-sdk";
 *
 * const resolveClient = createClientResolver(DataClient, {
 *   postgres: (url) => createPgExecutor(url),
 * });
 *
 * // Map env-var URLs to clients
 * const urls = process.env.BACKEND_URLS!.split(",");
 * const clients = await Promise.all(urls.map(resolveClient));
 * ```
 */
export function createClientResolver(
  ClientClass: StoreClientConstructor = SimpleClient,
  executors: BackendFactoryOptions["executors"] = {},
): (url: string) => Promise<NodeProtocolInterface> {
  const options: BackendFactoryOptions = { executors };
  return (url: string) => createClientFromUrl(url, ClientClass, options);
}

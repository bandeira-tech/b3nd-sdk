/**
 * @module
 * Types for the b3nd Rig — the universal harness.
 */

import type { CodeHandler, NodeProtocolInterface, Program } from "../b3nd-core/types.ts";
import type { HooksConfig } from "./hooks.ts";
import type { EventHandler, RigEventName } from "./events.ts";
import type { ReactionHandler } from "./reactions.ts";
import type { Connection } from "./connection.ts";

/**
 * Factory function for creating a PostgreSQL executor from a connection string.
 */
export type PostgresExecutor = {
  query: (
    sql: string,
    args?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number }>;
  transaction: <T>(fn: (tx: PostgresExecutor) => Promise<T>) => Promise<T>;
  cleanup?: () => Promise<void>;
};

export type PostgresExecutorFactory = (
  connectionString: string,
) => Promise<PostgresExecutor>;

/**
 * Factory function for creating a MongoDB executor from connection params.
 */
export type MongoExecutorFactory = (
  connectionString: string,
  databaseName: string,
  collectionName: string,
) => Promise<{
  insertOne: (
    doc: Record<string, unknown>,
  ) => Promise<{ acknowledged?: boolean }>;
  updateOne: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<
    { matchedCount?: number; modifiedCount?: number; upsertedId?: unknown }
  >;
  findOne: (
    filter: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
  findMany: (
    filter: Record<string, unknown>,
  ) => Promise<Record<string, unknown>[]>;
  ping: () => Promise<boolean>;
  cleanup?: () => Promise<void>;
}>;

/**
 * Factory function for creating a SQLite executor from a file path.
 */
export type SqliteExecutorFactory = (
  path: string,
) => import("@bandeira-tech/b3nd-stores/sqlite").SqliteExecutor;

/**
 * Factory function for creating a filesystem executor from a root directory path.
 */
export type FsExecutorFactory = (
  rootDir: string,
) => import("@bandeira-tech/b3nd-stores/fs").FsExecutor;

/**
 * Factory function for creating an IPFS executor from an API URL.
 */
export type IpfsExecutorFactory = (
  apiUrl: string,
) => import("@bandeira-tech/b3nd-stores/ipfs").IpfsExecutor;

/**
 * Factory function for creating an S3 executor from a bucket URL.
 */
export type S3ExecutorFactory = (
  bucket: string,
  prefix: string,
) => import("@bandeira-tech/b3nd-stores/s3").S3Executor;

/**
 * Factory function for creating an Elasticsearch executor from an endpoint URL.
 */
export type ElasticsearchExecutorFactory = (
  endpoint: string,
) => import("@bandeira-tech/b3nd-stores/elasticsearch").ElasticsearchExecutor;

/**
 * Configuration for `new Rig()`.
 *
 * The rig is pure orchestration — build clients outside, hand them in
 * as connections. Connections are the only way to wire clients.
 */
export interface RigConfig {
  /**
   * Connections — the single filtering primitive.
   *
   * Each connection wraps a client with URI patterns that control routing.
   * Writes broadcast to all matching connections; reads try first match.
   * The same patterns can be published over the wire for remote filtering.
   *
   * ```typescript
   * const rig = new Rig({
   *   connections: [
   *     connection(httpClient, {
   *       receive: ["mutable://*", "hash://*"],
   *       read: ["mutable://*", "hash://*"],
   *     }),
   *     connection(memoryClient, {
   *       receive: ["local://*"],
   *       read: ["local://*"],
   *     }),
   *   ],
   * });
   * ```
   */
  connections: Connection[];

  /**
   * Programs — pure classifiers that return protocol-defined codes.
   *
   * Maps URI prefixes (e.g. `"store://balance"`) to Program functions.
   * When a message arrives, the rig looks up the program for its URI,
   * runs classification, and routes to the handler for the returned code.
   *
   * ```typescript
   * const rig = new Rig({
   *   connections: [...],
   *   programs: {
   *     "store://balance": balanceProgram,
   *     "msg://app": appMsgProgram,
   *   },
   *   handlers: {
   *     "app:valid": async (msg, broadcast) => { ... },
   *     "app:confirmed": async (msg, broadcast, read) => { ... },
   *   },
   * });
   * ```
   */
  programs?: Record<string, Program>;

  /**
   * Code handlers — what to do when a program returns a specific code.
   *
   * Each handler gets `(message, broadcast, read)` where `broadcast` goes
   * direct to clients (bypasses programs). The handler decides what to store.
   */
  handlers?: Record<string, CodeHandler>;

  /**
   * Hooks — frozen after construction, one function per slot.
   *
   * Before-hooks **throw** to reject (no silent aborts).
   * After-hooks **observe** (cannot modify the result; throw if violated).
   *
   * @example
   * ```typescript
   * const rig = new Rig({
   *   connections: [...],
   *   hooks: {
   *     beforeReceive: (ctx) => { validate(ctx.uri); },
   *     afterRead: (ctx, result) => { audit(ctx.uri, result); },
   *   },
   * });
   * ```
   */
  hooks?: HooksConfig;

  /**
   * Async event handlers — fire-and-forget after operations complete.
   *
   * Events never block the caller. Handler errors are caught and logged.
   * Wildcard events (`*:success`, `*:error`) fire for all operations.
   *
   * @example
   * ```typescript
   * const rig = new Rig({
   *   connections: [...],
   *   on: {
   *     "send:success": [audit, notifyPeers],
   *     "*:error": [alertOps],
   *   },
   * });
   * ```
   */
  on?: Partial<Record<RigEventName, EventHandler[]>>;

  /**
   * URI-pattern reactions — fire on successful writes.
   *
   * Patterns use Express-style matching: `:param` captures a segment,
   * `*` matches the rest. Handlers are fire-and-forget.
   *
   * @example
   * ```typescript
   * const rig = new Rig({
   *   connections: [...],
   *   reactions: {
   *     "mutable://app/users/:id": (uri, data, { id }) => {
   *       console.log(`User ${id} updated`);
   *     },
   *   },
   * });
   * ```
   */
  reactions?: Record<string, ReactionHandler>;
}

/**
 * Snapshot of a Rig's current state — returned by `rig.info()`.
 *
 * Pure local inspection, no network calls. Useful for debugging,
 * logging, and UI display of identity/capability status.
 */
export interface RigInfo {
  /** Behavior layer counts — hooks, events, and observers registered. */
  behavior: {
    hooks: string[];
    events: Record<string, number>;
    reactors: number;
  };
}

/**
 * Options for rig.watch() — reactive polling.
 */
export interface WatchOptions {
  /** Polling interval in milliseconds. Default: 1000. */
  intervalMs?: number;
  /** AbortSignal to stop watching. */
  signal?: AbortSignal;
}

/**
 * Options for rig.watchAll() — reactive collection watching.
 */
export interface WatchAllOptions extends WatchOptions {
}

/**
 * A snapshot emitted by watchAll() when any item in the collection changes.
 */
export interface WatchAllSnapshot<T = unknown> {
  /** Current state of all items — URI → data. */
  items: Map<string, T>;
  /** URIs added since the last snapshot. */
  added: string[];
  /** URIs removed since the last snapshot. */
  removed: string[];
  /** URIs whose data changed since the last snapshot. */
  changed: string[];
}

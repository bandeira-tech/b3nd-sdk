/**
 * @module
 * Types for the b3nd Rig — the universal harness.
 */

import type { NodeProtocolInterface, Schema } from "../b3nd-core/types.ts";
import type { HookableOp, PostHook, PreHook } from "./hooks.ts";
import type { EventHandler, RigEventName } from "./events.ts";
import type { ObserveHandler } from "./observe.ts";

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
  deleteOne: (
    filter: Record<string, unknown>,
  ) => Promise<{ deletedCount?: number }>;
  ping: () => Promise<boolean>;
  cleanup?: () => Promise<void>;
}>;

/**
 * Factory function for creating a SQLite executor from a file path.
 */
export type SqliteExecutorFactory = (
  path: string,
) => import("../b3nd-client-sqlite/mod.ts").SqliteExecutor;

/**
 * Factory function for creating a filesystem executor from a root directory path.
 */
export type FsExecutorFactory = (
  rootDir: string,
) => import("../b3nd-client-fs/mod.ts").FsExecutor;

/**
 * Factory function for creating an IPFS executor from an API URL.
 */
export type IpfsExecutorFactory = (
  apiUrl: string,
) => import("../b3nd-client-ipfs/mod.ts").IpfsExecutor;

/**
 * Factory function for creating an S3 executor from a bucket URL.
 */
export type S3ExecutorFactory = (
  bucket: string,
  prefix: string,
) => import("../b3nd-client-s3/mod.ts").S3Executor;

/**
 * Configuration for Rig.init().
 */
export interface RigConfig {
  /** URL(s) → client(s). Strings are auto-resolved by protocol. */
  use?: string | string[];

  /** Pre-built client — bypasses URL resolution entirely. */
  client?: NodeProtocolInterface;

  /** Optional identity (can be set/swapped later). */
  identity?: import("./identity.ts").Identity;

  /** Optional schema for local validation on server-side backends. */
  schema?: Schema;

  /**
   * Executor factories for database backends.
   * Required when using postgresql://, mongodb://, sqlite://, or s3:// URLs.
   */
  executors?: {
    postgres?: PostgresExecutorFactory;
    mongo?: MongoExecutorFactory;
    sqlite?: SqliteExecutorFactory;
    fs?: FsExecutorFactory;
    ipfs?: IpfsExecutorFactory;
    s3?: S3ExecutorFactory;
  };

  /**
   * Per-operation client routing.
   *
   * Overrides the default `use`/`client` for specific operations.
   * Each entry is either a pre-built client or URL string(s) to resolve.
   *
   * - `send`, `receive`, `delete` → composed with parallelBroadcast (all must accept)
   * - `read`, `list` → composed with firstMatchSequence (first success wins)
   *
   * @example
   * ```typescript
   * const rig = await Rig.init({
   *   use: "postgresql://primary",
   *   clients: {
   *     read: ["redis://cache", "postgresql://primary"],
   *     observe: ["wss://realtime"],
   *   },
   * });
   * ```
   */
  clients?: {
    send?: string[] | NodeProtocolInterface;
    receive?: string[] | NodeProtocolInterface;
    read?: string[] | NodeProtocolInterface;
    list?: string[] | NodeProtocolInterface;
    delete?: string[] | NodeProtocolInterface;
    observe?: string[] | NodeProtocolInterface;
  };

  /**
   * Synchronous hook pipelines — frozen after init.
   *
   * Pre-hooks **throw** to reject an operation (no silent aborts).
   * Post-hooks **observe** the result but cannot modify it (throw if violated).
   * Hooks are immutable — want different hooks? Create a new rig.
   *
   * @example
   * ```typescript
   * const rig = await Rig.init({
   *   use: "memory://",
   *   hooks: {
   *     receive: { pre: [validateSchema] },
   *     read:    { post: [auditRead] },
   *   },
   * });
   * ```
   */
  hooks?: Partial<
    Record<HookableOp, { pre?: PreHook[]; post?: PostHook[] }>
  >;

  /**
   * Async event handlers — fire-and-forget after operations complete.
   *
   * Events never block the caller. Handler errors are caught and logged.
   * Wildcard events (`*:success`, `*:error`) fire for all operations.
   *
   * @example
   * ```typescript
   * const rig = await Rig.init({
   *   use: "memory://",
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
   * const rig = await Rig.init({
   *   use: "memory://",
   *   observe: {
   *     "mutable://app/users/:id": (uri, data, { id }) => {
   *       console.log(`User ${id} updated`);
   *     },
   *   },
   * });
   * ```
   */
  observe?: Record<string, ObserveHandler>;
}

/**
 * Snapshot of a Rig's current state — returned by `rig.info()`.
 *
 * Pure local inspection, no network calls. Useful for debugging,
 * logging, and UI display of identity/capability status.
 */
export interface RigInfo {
  /** Ed25519 public key hex, or null if no identity. */
  pubkey: string | null;
  /** X25519 encryption public key hex, or null. */
  encryptionPubkey: string | null;
  /** Whether the rig can sign messages (has signing private key). */
  canSign: boolean;
  /** Whether the rig can encrypt/decrypt (has encryption keys). */
  canEncrypt: boolean;
  /** Whether an identity is attached at all. */
  hasIdentity: boolean;
  /** Behavior layer counts — hooks, events, and observers registered. */
  behavior: {
    hooks: Record<string, { pre: number; post: number }>;
    events: Record<string, number>;
    observers: number;
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
  /** List options (e.g. limit) passed to listData on each poll. */
  listOptions?: import("../b3nd-core/types.ts").ListOptions;
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

/**
 * Cleanup function returned by subscribe() — call to stop watching.
 */
export type Unsubscribe = () => void;

/**
 * Options for rig.handler().
 */
export interface HandlerOptions {
  /** Extra metadata to include in health response. */
  healthMeta?: Record<string, unknown>;
}

/**
 * @deprecated Use HandlerOptions instead. The rig no longer owns the server.
 */
export type ServeOptions = HandlerOptions & {
  port: number;
  cors?: string;
};

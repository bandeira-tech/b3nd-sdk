/**
 * @module
 * Types for the b3nd Rig — the universal harness.
 */

import type { NodeProtocolInterface, Schema } from "../b3nd-core/types.ts";

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
   * Required when using postgresql://, mongodb://, or sqlite:// URLs.
   */
  executors?: {
    postgres?: PostgresExecutorFactory;
    mongo?: MongoExecutorFactory;
    sqlite?: SqliteExecutorFactory;
    fs?: FsExecutorFactory;
    ipfs?: IpfsExecutorFactory;
  };
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
 * Options for rig.serve().
 */
export interface ServeOptions {
  /** Port to listen on. */
  port: number;
  /** CORS origin header value. */
  cors?: string;
  /** Extra metadata to include in health response. */
  healthMeta?: Record<string, unknown>;
}

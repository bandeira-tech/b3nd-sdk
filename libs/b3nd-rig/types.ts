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
 * Factory function for creating a SQLite executor from a path.
 */
export type SqliteExecutor = {
  query: (sql: string, args?: unknown[]) => { rows: unknown[]; rowCount?: number };
  transaction: <T>(fn: (tx: SqliteExecutor) => T) => T;
  cleanup?: () => void;
};

export type SqliteExecutorFactory = (
  path: string,
) => SqliteExecutor;

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
 * Factory function for creating a Redis executor from a connection URL.
 */
export type RedisExecutorFactory = (
  connectionUrl: string,
) => Promise<import("../b3nd-client-redis/mod.ts").RedisExecutor>;

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
   * Required when using postgresql://, mongodb://, sqlite://, or redis:// URLs.
   */
  executors?: {
    postgres?: PostgresExecutorFactory;
    mongo?: MongoExecutorFactory;
    sqlite?: SqliteExecutorFactory;
    redis?: RedisExecutorFactory;
  };
}

/**
 * RedisClient - Redis implementation of NodeProtocolInterface
 *
 * Stores data in Redis using hash sets keyed by URI.
 * Uses an injected executor so the SDK does not depend on a specific driver.
 * Works with `ioredis`, `redis` (node-redis), `@denodrivers/redis`, or any
 * driver implementing the RedisExecutor interface.
 *
 * Storage layout:
 *   HSET "b3nd:{uri}" "data" "{json}" "timestamp" "{ts}"
 *   Prefix index: ZADD "b3nd:idx:{prefix}" {ts} "{uri}"
 *
 * Supports optional TTL per-key for cache use cases.
 */

import {
  Errors,
  type DeleteResult,
  type HealthStatus,
  type ListItem,
  type ListOptions,
  type ListResult,
  type Message,
  type NodeProtocolInterface,
  type PersistenceRecord,
  type ReadMultiResult,
  type ReadMultiResultItem,
  type ReadResult,
  type ReceiveResult,
  type RedisClientConfig,
  type Schema,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";

export type { RedisClientConfig } from "../b3nd-core/types.ts";

/**
 * Minimal interface for a Redis executor.
 * Keeps the client driver-agnostic.
 */
export interface RedisExecutor {
  /** Set a hash field. HSET key field value [field value ...] */
  hset(key: string, fields: Record<string, string>): Promise<number>;
  /** Get all fields of a hash. HGETALL key */
  hgetall(key: string): Promise<Record<string, string> | null>;
  /** Get specific hash fields from multiple keys (pipeline-friendly). */
  hmget(keys: string[], fields: string[]): Promise<(Record<string, string> | null)[]>;
  /** Delete a key. DEL key */
  del(key: string | string[]): Promise<number>;
  /** Set expiry. EXPIRE key seconds */
  expire(key: string, seconds: number): Promise<boolean>;
  /** Add to sorted set. ZADD key score member */
  zadd(key: string, score: number, member: string): Promise<number>;
  /** Remove from sorted set. ZREM key member */
  zrem(key: string, member: string): Promise<number>;
  /** Range query on sorted set with scores. ZRANGEBYSCORE key min max [LIMIT offset count] */
  zrangebyscore(
    key: string,
    min: string | number,
    max: string | number,
    options?: { offset?: number; count?: number },
  ): Promise<string[]>;
  /** Reverse range query. ZREVRANGEBYSCORE */
  zrevrangebyscore(
    key: string,
    max: string | number,
    min: string | number,
    options?: { offset?: number; count?: number },
  ): Promise<string[]>;
  /** Count members in sorted set range. ZCOUNT key min max */
  zcount(
    key: string,
    min: string | number,
    max: string | number,
  ): Promise<number>;
  /** Scan sorted set members matching a pattern. */
  zscan(
    key: string,
    cursor: number,
    options?: { match?: string; count?: number },
  ): Promise<[string, string[]]>;
  /** PING for health check */
  ping(): Promise<string>;
  /** Run multiple commands atomically (MULTI/EXEC) */
  multi(commands: RedisCommand[]): Promise<unknown[]>;
  /** Cleanup / disconnect */
  cleanup?: () => Promise<void>;
}

export type RedisCommand =
  | ["hset", string, Record<string, string>]
  | ["del", string]
  | ["expire", string, number]
  | ["zadd", string, number, string]
  | ["zrem", string, string];

export class RedisClient implements NodeProtocolInterface {
  private readonly config: RedisClientConfig;
  private readonly schema: Schema;
  private readonly keyPrefix: string;
  private readonly defaultTtl: number;
  private readonly executor: RedisExecutor;
  private connected = false;

  constructor(config: RedisClientConfig, executor?: RedisExecutor) {
    if (!config) throw new Error("RedisClientConfig is required");
    if (!config.connectionUrl) {
      throw new Error("connectionUrl is required in RedisClientConfig");
    }
    if (!config.keyPrefix) {
      throw new Error("keyPrefix is required in RedisClientConfig");
    }
    if (!config.schema) {
      throw new Error("schema is required in RedisClientConfig");
    }
    if (!executor) throw new Error("executor is required");

    this.config = config;
    this.schema = config.schema;
    this.keyPrefix = config.keyPrefix;
    this.defaultTtl = config.defaultTtl ?? 0;
    this.executor = executor;
    this.connected = true;
  }

  // ── Write ────────────────────────────────────────────────

  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    const [uri, data] = msg;

    if (!uri || typeof uri !== "string") {
      return {
        accepted: false,
        error: "Message URI is required",
        errorDetail: Errors.invalidUri(uri ?? "", "Message URI is required"),
      };
    }

    try {
      const programKey = this.extractProgramKey(uri);
      const validator = this.schema[programKey];

      if (!validator) {
        const msg = `No schema defined for program key: ${programKey}`;
        return {
          accepted: false,
          error: msg,
          errorDetail: Errors.invalidSchema(uri, msg),
        };
      }

      const validation = await validator({
        uri,
        value: data,
        read: this.read.bind(this),
      });

      if (!validation.valid) {
        const msg = validation.error || "Validation failed";
        return {
          accepted: false,
          error: msg,
          errorDetail: Errors.invalidSchema(uri, msg),
        };
      }

      const encodedData = encodeBinaryForJson(data);
      const ts = Date.now();

      if (isMessageData(data)) {
        // Atomic: store envelope + all outputs in a single MULTI/EXEC
        const commands: RedisCommand[] = [];
        const indexKey = this.indexKey(uri);

        commands.push([
          "hset",
          this.dataKey(uri),
          { data: JSON.stringify(encodedData), timestamp: String(ts) },
        ]);
        commands.push(["zadd", indexKey, ts, uri]);
        if (this.defaultTtl > 0) {
          commands.push(["expire", this.dataKey(uri), this.defaultTtl]);
        }

        for (const [outputUri, outputValue] of data.payload.outputs) {
          const outEncoded = encodeBinaryForJson(outputValue);
          const outTs = Date.now();
          const outIndexKey = this.indexKey(outputUri);
          commands.push([
            "hset",
            this.dataKey(outputUri),
            { data: JSON.stringify(outEncoded), timestamp: String(outTs) },
          ]);
          commands.push(["zadd", outIndexKey, outTs, outputUri]);
          if (this.defaultTtl > 0) {
            commands.push(["expire", this.dataKey(outputUri), this.defaultTtl]);
          }
        }

        await this.executor.multi(commands);
      } else {
        // Single write
        const key = this.dataKey(uri);
        await this.executor.hset(key, {
          data: JSON.stringify(encodedData),
          timestamp: String(ts),
        });

        // Maintain sorted set index for list() queries
        const indexKey = this.indexKey(uri);
        await this.executor.zadd(indexKey, ts, uri);

        if (this.defaultTtl > 0) {
          await this.executor.expire(key, this.defaultTtl);
        }
      }

      return { accepted: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        accepted: false,
        error: msg,
        errorDetail: Errors.storageError(msg, uri),
      };
    }
  }

  // ── Read ─────────────────────────────────────────────────

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const key = this.dataKey(uri);
      const fields = await this.executor.hgetall(key);

      if (!fields || !fields.data) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }

      const parsed = JSON.parse(fields.data);
      const decodedData = decodeBinaryFromJson(parsed) as T;
      const record: PersistenceRecord<T> = {
        ts: Number(fields.timestamp),
        data: decodedData,
      };

      return { success: true, record };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: msg,
        errorDetail: Errors.storageError(msg, uri),
      };
    }
  }

  // ── ReadMulti ────────────────────────────────────────────

  async readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    if (uris.length === 0) {
      return {
        success: false,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      };
    }

    if (uris.length > 50) {
      return {
        success: false,
        results: [],
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    }

    try {
      const keys = uris.map((u) => this.dataKey(u));
      const docs = await this.executor.hmget(keys, ["data", "timestamp"]);

      const results: ReadMultiResultItem<T>[] = [];
      let succeeded = 0;

      for (let i = 0; i < uris.length; i++) {
        const fields = docs[i];
        if (fields && fields.data) {
          const parsed = JSON.parse(fields.data);
          const decodedData = decodeBinaryFromJson(parsed) as T;
          results.push({
            uri: uris[i],
            success: true,
            record: { ts: Number(fields.timestamp), data: decodedData },
          });
          succeeded++;
        } else {
          results.push({
            uri: uris[i],
            success: false,
            error: `Not found: ${uris[i]}`,
          });
        }
      }

      return {
        success: succeeded > 0,
        results,
        summary: {
          total: uris.length,
          succeeded,
          failed: uris.length - succeeded,
        },
      };
    } catch (error) {
      // Fallback to individual reads
      const results: ReadMultiResultItem<T>[] = await Promise.all(
        uris.map(async (uri): Promise<ReadMultiResultItem<T>> => {
          const result = await this.read<T>(uri);
          if (result.success && result.record) {
            return { uri, success: true, record: result.record };
          }
          return {
            uri,
            success: false,
            error: result.error || "Read failed",
          };
        }),
      );

      const succeeded = results.filter((r) => r.success).length;
      return {
        success: succeeded > 0,
        results,
        summary: {
          total: uris.length,
          succeeded,
          failed: uris.length - succeeded,
        },
      };
    }
  }

  // ── List ─────────────────────────────────────────────────

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const indexKey = this.indexKey(uri);
      const page = options?.page ?? 1;
      const limit = options?.limit ?? 50;
      const offset = (page - 1) * limit;

      // Sub-path prefix: list("mutable://accounts/alice") should only return
      // URIs under that path, not all URIs in the "mutable://accounts" program.
      const uriPrefix = uri.endsWith("/") ? uri : `${uri}/`;

      // Fetch all members from the sorted set for this program, then filter
      // by sub-path prefix. The sorted set is indexed at the program level
      // (protocol://hostname), so sub-path filtering must happen client-side.
      const allRaw = await this.executor.zrangebyscore(
        indexKey,
        "-inf",
        "+inf",
      );

      // Filter to only URIs under the requested path
      let allMembers = allRaw.filter((m) => m.startsWith(uriPrefix));

      // Apply regex pattern filter if specified
      if (options?.pattern) {
        const regex = new RegExp(options.pattern);
        allMembers = allMembers.filter((m) => regex.test(m));
      }

      // Apply name sort if requested (timestamp sort is the default via sorted set scores)
      if (options?.sortBy === "name") {
        allMembers.sort((a, b) =>
          options?.sortOrder === "desc"
            ? b.localeCompare(a)
            : a.localeCompare(b)
        );
      } else if (options?.sortOrder === "desc") {
        allMembers.reverse();
      }

      const filteredTotal = allMembers.length;

      // Apply pagination
      const data: ListItem[] = allMembers.slice(offset, offset + limit)
        .map((m) => ({ uri: m }));

      return {
        success: true,
        data,
        pagination: { page, limit, total: filteredTotal },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Delete ───────────────────────────────────────────────

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const key = this.dataKey(uri);
      const deleted = await this.executor.del(key);

      if (deleted === 0) {
        return {
          success: false,
          error: "Not found",
          errorDetail: Errors.notFound(uri),
        };
      }

      // Remove from index
      const indexKey = this.indexKey(uri);
      await this.executor.zrem(indexKey, uri);

      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: msg,
        errorDetail: Errors.storageError(msg, uri),
      };
    }
  }

  // ── Health / Schema / Cleanup ────────────────────────────

  async health(): Promise<HealthStatus> {
    try {
      if (!this.connected) {
        return { status: "unhealthy", message: "Not connected to Redis" };
      }
      const pong = await this.executor.ping();
      if (pong !== "PONG") {
        return { status: "unhealthy", message: `Unexpected ping response: ${pong}` };
      }
      return {
        status: "healthy",
        message: "Redis client is operational",
        details: {
          keyPrefix: this.keyPrefix,
          defaultTtl: this.defaultTtl,
          schemaKeys: Object.keys(this.schema),
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getSchema(): Promise<string[]> {
    return this.schema ? Object.keys(this.schema) : [];
  }

  async cleanup(): Promise<void> {
    if (this.executor.cleanup) {
      await this.executor.cleanup();
    }
    this.connected = false;
  }

  // ── Private helpers ──────────────────────────────────────

  /** Redis key for storing a record's data hash */
  private dataKey(uri: string): string {
    return `${this.keyPrefix}:${uri}`;
  }

  /**
   * Sorted set key for the list index.
   * Groups by program prefix (protocol://hostname) so list("mutable://accounts")
   * scans only the relevant sorted set.
   */
  private indexKey(uri: string): string {
    const prefix = this.extractProgramKey(uri);
    return `${this.keyPrefix}:idx:${prefix}`;
  }

  private extractProgramKey(uri: string): string {
    const url = new URL(uri);
    return `${url.protocol}//${url.hostname}`;
  }
}

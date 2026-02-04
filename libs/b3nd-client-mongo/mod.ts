/**
 * MongoClient - MongoDB implementation of NodeProtocolInterface
 *
 * Stores data in a single MongoDB collection with schema-based validation.
 * Uses an injected executor so the SDK does not depend on a specific driver.
 */

import type {
  DeleteResult,
  HealthStatus,
  ListItem,
  ListOptions,
  ListResult,
  Message,
  MongoClientConfig,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  Schema,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";

export interface MongoExecutor {
  insertOne(doc: Record<string, unknown>): Promise<{ acknowledged?: boolean }>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<
    { matchedCount?: number; modifiedCount?: number; upsertedId?: unknown }
  >;
  findOne(
    filter: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  findMany(filter: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  deleteOne(
    filter: Record<string, unknown>,
  ): Promise<{ deletedCount?: number }>;
  ping(): Promise<boolean>;
  cleanup?: () => Promise<void>;
}

export class MongoClient implements NodeProtocolInterface {
  private readonly config: MongoClientConfig;
  private readonly schema: Schema;
  private readonly collectionName: string;
  private readonly executor: MongoExecutor;
  private connected = false;

  constructor(config: MongoClientConfig, executor?: MongoExecutor) {
    if (!config) {
      throw new Error("MongoClientConfig is required");
    }
    if (!config.connectionString) {
      throw new Error("connectionString is required in MongoClientConfig");
    }
    if (!config.collectionName) {
      throw new Error("collectionName is required in MongoClientConfig");
    }
    if (!config.schema) {
      throw new Error("schema is required in MongoClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    this.config = config;
    this.schema = config.schema;
    this.collectionName = config.collectionName;
    this.executor = executor;
    this.connected = true;
  }

  /**
   * Receive a message - the unified entry point for all state changes
   * @param msg - Message tuple [uri, data]
   * @returns ReceiveResult indicating acceptance
   */
  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    const [uri, data] = msg;

    // Basic URI validation
    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Message URI is required" };
    }

    try {
      const programKey = this.extractProgramKey(uri);
      const validator = this.schema[programKey];

      if (!validator) {
        return {
          accepted: false,
          error: `No schema defined for program key: ${programKey}`,
        };
      }

      const validation = await validator({
        uri,
        value: data,
        read: this.read.bind(this),
      });

      if (!validation.valid) {
        return {
          accepted: false,
          error: validation.error || "Validation failed",
        };
      }

      // Encode binary data for JSON storage
      const encodedData = encodeBinaryForJson(data);
      const record: PersistenceRecord<typeof encodedData> = {
        ts: Date.now(),
        data: encodedData,
      };

      await this.executor.updateOne(
        { uri },
        {
          $set: {
            uri,
            data: record.data as unknown,
            timestamp: record.ts,
            updatedAt: new Date(),
            collection: this.collectionName,
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        } as unknown as Record<string, unknown>,
        { upsert: true },
      );

      // If MessageData, also store each output at its own URI
      if (isMessageData(data)) {
        for (const [outputUri, outputValue] of data.outputs) {
          const outputResult = await this.receive([outputUri, outputValue]);
          if (!outputResult.accepted) {
            return {
              accepted: false,
              error: outputResult.error ||
                `Failed to store output: ${outputUri}`,
            };
          }
        }
      }

      return { accepted: true };
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const doc = await this.executor.findOne({ uri });
      if (!doc) {
        return {
          success: false,
          error: `Not found: ${uri}`,
        };
      }

      const tsValue = doc.timestamp;
      const dataValue = doc.data;
      // Decode binary data if encoded
      const decodedData = decodeBinaryFromJson(dataValue) as T;

      const record: PersistenceRecord<T> = {
        ts: typeof tsValue === "number" ? tsValue : Number(tsValue),
        data: decodedData,
      };

      return {
        success: true,
        record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

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
      // Single query using $in instead of N individual findOne calls
      const docs = await this.executor.findMany({ uri: { $in: uris } });

      // Build a map of found documents for O(1) lookup
      const found = new Map<string, PersistenceRecord<T>>();
      for (const doc of docs) {
        const docUri = typeof doc.uri === "string" ? doc.uri : undefined;
        if (!docUri) continue;

        const tsValue = doc.timestamp;
        const decodedData = decodeBinaryFromJson(doc.data) as T;
        found.set(docUri, {
          ts: typeof tsValue === "number" ? tsValue : Number(tsValue),
          data: decodedData,
        });
      }

      // Build results in the original URI order
      const results: ReadMultiResultItem<T>[] = [];
      let succeeded = 0;

      for (const uri of uris) {
        const record = found.get(uri);
        if (record) {
          results.push({ uri, success: true, record });
          succeeded++;
        } else {
          results.push({ uri, success: false, error: `Not found: ${uri}` });
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
      // Fallback to individual reads on query failure
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

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const prefixBase = uri.endsWith("/") ? uri : `${uri}/`;
      const prefixRegex = new RegExp(`^${this.escapeRegex(prefixBase)}`);

      const docs = await this.executor.findMany({ uri: prefixRegex });

      type ItemWithTs = { uri: string; ts: number };

      let items: ItemWithTs[] = [];

      for (const doc of docs) {
        const fullUri = typeof doc.uri === "string" ? doc.uri : undefined;
        if (!fullUri || !fullUri.startsWith(prefixBase)) continue;

        const tsValue = doc.timestamp;
        const ts = typeof tsValue === "number"
          ? tsValue
          : tsValue != null
          ? Number(tsValue)
          : 0;

        items.push({ uri: fullUri, ts });
      }

      if (options?.pattern) {
        const regex = new RegExp(options.pattern);
        items = items.filter((item) => regex.test(item.uri));
      }

      if (options?.sortBy === "name") {
        items.sort((a, b) => a.uri.localeCompare(b.uri));
      } else if (options?.sortBy === "timestamp") {
        items.sort((a, b) => a.ts - b.ts);
      }

      if (options?.sortOrder === "desc") {
        items.reverse();
      }

      const page = options?.page ?? 1;
      const limit = options?.limit ?? 50;
      const offset = (page - 1) * limit;
      const paginated = items.slice(offset, offset + limit);

      const data: ListItem[] = paginated.map((item) => ({
        uri: item.uri,
      }));

      return {
        success: true,
        data,
        pagination: {
          page,
          limit,
          total: items.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const res = await this.executor.deleteOne({ uri });
      const deleted = typeof res.deletedCount === "number"
        ? res.deletedCount > 0
        : false;
      if (!deleted) {
        return {
          success: false,
          error: "Not found",
        };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(): Promise<HealthStatus> {
    try {
      if (!this.connected) {
        return {
          status: "unhealthy",
          message: "Not connected to MongoDB",
        };
      }

      const ok = await this.executor.ping();
      if (!ok) {
        return {
          status: "unhealthy",
          message: "MongoDB ping failed",
        };
      }

      return {
        status: "healthy",
        message: "MongoDB client is operational",
        details: {
          collectionName: this.collectionName,
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

  private extractProgramKey(uri: string): string {
    const url = new URL(uri);
    return `${url.protocol}//${url.hostname}`;
  }

  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

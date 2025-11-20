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
  MongoClientConfig,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadResult,
  Schema,
  WriteResult,
} from "../../src/types.ts";

export interface MongoExecutor {
  insertOne(doc: Record<string, unknown>): Promise<{ acknowledged?: boolean }>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ matchedCount?: number; modifiedCount?: number; upsertedId?: unknown }>;
  findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  findMany(filter: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
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

  async write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>> {
    try {
      const programKey = this.extractProgramKey(uri);
      const validator = this.schema[programKey];

      if (!validator) {
        return {
          success: false,
          error: `No schema defined for program key: ${programKey}`,
        };
      }

      const validation = await validator({
        uri,
        value,
        read: this.read.bind(this),
      });

      if (!validation.valid) {
        return {
          success: false,
          error: validation.error || "Validation failed",
        };
      }

      const record: PersistenceRecord<T> = {
        ts: Date.now(),
        data: value,
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

      const record: PersistenceRecord<T> = {
        ts: typeof tsValue === "number" ? tsValue : Number(tsValue),
        data: dataValue as T,
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

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const prefixBase = uri.endsWith("/") ? uri : `${uri}/`;
      const prefixRegex = new RegExp(`^${this.escapeRegex(prefixBase)}`);

      const docs = await this.executor.findMany({ uri: prefixRegex });

      type ItemWithTs = { uri: string; type: "file" | "directory"; ts: number };

      const directories = new Map<string, ItemWithTs>();
      const files: ItemWithTs[] = [];

      for (const doc of docs) {
        const fullUri = typeof doc.uri === "string" ? doc.uri : undefined;
        if (!fullUri || !fullUri.startsWith(prefixBase)) continue;

        const relative = fullUri.slice(prefixBase.length);
        if (!relative) continue;

        const [firstSegment, ...rest] = relative.split("/");
        if (!firstSegment) continue;

        const tsValue = doc.timestamp;
        const ts =
          typeof tsValue === "number"
            ? tsValue
            : tsValue != null
              ? Number(tsValue)
              : 0;

        if (rest.length === 0) {
          files.push({ uri: fullUri, type: "file", ts });
        } else {
          const dirUri = `${prefixBase}${firstSegment}`;
          if (!directories.has(dirUri)) {
            directories.set(dirUri, {
              uri: dirUri,
              type: "directory",
              ts: 0,
            });
          }
        }
      }

      let items: ItemWithTs[] = [...directories.values(), ...files];

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
        type: item.type,
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

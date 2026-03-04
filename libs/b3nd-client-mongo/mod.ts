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
  NativeQueryOptions,
  NodeProtocolInterface,
  PersistenceRecord,
  PortableQueryOptions,
  QueryOptions,
  QueryRecord,
  QueryResult,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  Schema,
  WhereClause,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";
import {
  isNativeQuery,
  isStoredQuery,
  resolveStoredQuery,
} from "../b3nd-core/query.ts";

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
  findMany(
    filter: Record<string, unknown>,
    options?: {
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
      projection?: Record<string, 0 | 1>;
    },
  ): Promise<Record<string, unknown>[]>;
  countDocuments?(
    filter: Record<string, unknown>,
  ): Promise<number>;
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
        for (const [outputUri, outputValue] of data.payload.outputs) {
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

  async query<T = unknown>(options: QueryOptions): Promise<QueryResult<T>> {
    // Mode 3: Stored query — resolve to native, then re-enter
    if (isStoredQuery(options)) {
      const resolved = await resolveStoredQuery(options, this.read.bind(this));
      if ("success" in resolved && !resolved.success) return resolved;
      return this.query<T>(resolved as NativeQueryOptions);
    }

    // Mode 2: Native passthrough — developer sends Mongo query directly
    if (isNativeQuery(options)) {
      return this.queryNative<T>(options);
    }

    // Mode 1: Portable DSL
    return this.queryPortable<T>(options);
  }

  /**
   * Mode 2 — Native MongoDB passthrough.
   *
   * The `native` object is passed straight to findMany as-is.
   * No automatic URI scoping is added — the developer has full control.
   * Shape: { filter?, sort?, projection?, limit?, skip? }
   */
  private async queryNative<T = unknown>(
    options: NativeQueryOptions,
  ): Promise<QueryResult<T>> {
    try {
      const native = (options.native ?? {}) as {
        filter?: Record<string, unknown>;
        sort?: Record<string, 1 | -1>;
        projection?: Record<string, 0 | 1>;
        limit?: number;
        skip?: number;
      };

      const filter: Record<string, unknown> = native.filter ?? {};

      const limit = native.limit ?? 50;
      const skip = native.skip ?? 0;

      // Get total count
      let total: number | undefined;
      if (this.executor.countDocuments) {
        total = await this.executor.countDocuments(filter);
      }

      // Execute query with user's sort/projection/limit/skip
      const docs = await this.executor.findMany(filter, {
        sort: native.sort,
        limit,
        skip,
        projection: native.projection,
      });

      const records: QueryRecord<T>[] = docs.map((doc) => ({
        uri: doc.uri as string,
        data: decodeBinaryFromJson(doc.data) as T,
        ts: typeof doc.timestamp === "number"
          ? doc.timestamp
          : Number(doc.timestamp),
      }));

      return { success: true, records, total };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Mode 1 — Portable DSL query.
   */
  private async queryPortable<T = unknown>(
    options: PortableQueryOptions,
  ): Promise<QueryResult<T>> {
    try {
      const uriBase = options.uri.endsWith("/")
        ? options.uri
        : `${options.uri}/`;
      const prefixRegex = new RegExp(`^${this.escapeRegex(uriBase)}`);

      // Build Mongo filter from query descriptor
      const filter: Record<string, unknown> = { uri: prefixRegex };
      if (options.where) {
        const whereFilter = this.buildMongoFilter(options.where);
        Object.assign(filter, whereFilter);
      }

      // Build sort
      const sort: Record<string, 1 | -1> = {};
      if (options.orderBy && options.orderBy.length > 0) {
        for (const { field, direction } of options.orderBy) {
          sort[`data.${field}`] = direction === "desc" ? -1 : 1;
        }
      }

      // Build projection
      let projection: Record<string, 0 | 1> | undefined;
      if (options.select && options.select.length > 0) {
        projection = { uri: 1, timestamp: 1 } as Record<string, 0 | 1>;
        for (const field of options.select) {
          projection[`data.${field}`] = 1;
        }
      }

      const limit = options.limit ?? 50;
      const skip = options.offset ?? 0;

      // Get total count
      let total: number | undefined;
      if (this.executor.countDocuments) {
        total = await this.executor.countDocuments(filter);
      }

      // Execute query
      const docs = await this.executor.findMany(filter, {
        sort: Object.keys(sort).length > 0 ? sort : undefined,
        limit,
        skip,
        projection,
      });

      const records: QueryRecord<T>[] = docs.map((doc) => ({
        uri: doc.uri as string,
        data: decodeBinaryFromJson(doc.data) as T,
        ts: typeof doc.timestamp === "number"
          ? doc.timestamp
          : Number(doc.timestamp),
      }));

      return { success: true, records, total };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Translate a WhereClause into a MongoDB filter object.
   */
  private buildMongoFilter(clause: WhereClause): Record<string, unknown> {
    // Logical combinators
    if ("and" in clause) {
      return { $and: clause.and.map((c) => this.buildMongoFilter(c)) };
    }
    if ("or" in clause) {
      return { $or: clause.or.map((c) => this.buildMongoFilter(c)) };
    }
    if ("not" in clause) {
      // MongoDB $not works on field-level operators, so we wrap with $nor
      return { $nor: [this.buildMongoFilter(clause.not)] };
    }

    // Field condition — prefix with "data." since records are stored with data field
    const mongoField = `data.${clause.field}`;

    switch (clause.op) {
      case "eq":
        return { [mongoField]: clause.value };
      case "neq":
        return { [mongoField]: { $ne: clause.value } };
      case "gt":
        return { [mongoField]: { $gt: clause.value } };
      case "gte":
        return { [mongoField]: { $gte: clause.value } };
      case "lt":
        return { [mongoField]: { $lt: clause.value } };
      case "lte":
        return { [mongoField]: { $lte: clause.value } };
      case "in":
        return { [mongoField]: { $in: clause.value } };
      case "contains":
        return {
          [mongoField]: { $regex: this.escapeRegex(clause.value), $options: "i" },
        };
      case "startsWith":
        return { [mongoField]: { $regex: `^${this.escapeRegex(clause.value)}` } };
      case "endsWith":
        return { [mongoField]: { $regex: `${this.escapeRegex(clause.value)}$` } };
      case "exists":
        return { [mongoField]: { $exists: clause.value } };
      default:
        return {};
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

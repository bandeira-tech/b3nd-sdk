/**
 * MongoClient - MongoDB implementation of NodeProtocolInterface
 *
 * Stores data in a single MongoDB collection with schema-based validation.
 * Uses an injected executor so the SDK does not depend on a specific driver.
 */

import {
  Errors,
  type DeleteResult,
  type HealthStatus,
  type ListItem,
  type ListOptions,
  type ListResult,
  type Message,
  type MongoClientConfig,
  type NodeProtocolInterface,
  type PersistenceRecord,
  type ReadMultiResult,
  type ReadMultiResultItem,
  type ReadResult,
  type ReceiveResult,
  type Schema,
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
  findMany(
    filter: Record<string, unknown>,
    options?: {
      sort?: Record<string, 1 | -1>;
      skip?: number;
      limit?: number;
    },
  ): Promise<Record<string, unknown>[]>;
  deleteOne(
    filter: Record<string, unknown>,
  ): Promise<{ deletedCount?: number }>;
  /**
   * Count documents matching the filter.
   * When not provided, list() falls back to a findMany count.
   */
  countDocuments?: (filter: Record<string, unknown>) => Promise<number>;
  ping(): Promise<boolean>;
  /**
   * Run multiple operations atomically within a MongoDB session/transaction.
   * When provided, MessageData envelopes and their outputs are stored together.
   * If not implemented, outputs are stored sequentially without rollback guarantees.
   */
  transaction?: <T>(fn: (executor: MongoExecutor) => Promise<T>) => Promise<T>;
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
    return this.receiveWithExecutor(msg, this.executor);
  }

  private async receiveWithExecutor<D = unknown>(
    msg: Message<D>,
    executor: MongoExecutor,
  ): Promise<ReceiveResult> {
    const [uri, data] = msg;

    // Basic URI validation
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

      // Encode binary data for JSON storage
      const encodedData = encodeBinaryForJson(data);
      const record: PersistenceRecord<typeof encodedData> = {
        ts: Date.now(),
        data: encodedData,
      };

      // If MessageData with outputs, wrap in a transaction for atomicity
      if (isMessageData(data) && executor.transaction) {
        await executor.transaction(async (tx) => {
          // Store the envelope itself
          await tx.updateOne(
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

          // Store each output within the same transaction
          for (const [outputUri, outputValue] of data.payload.outputs) {
            const outputResult = await this.receiveWithExecutor(
              [outputUri, outputValue],
              tx,
            );
            if (!outputResult.accepted) {
              throw new Error(
                outputResult.error || `Failed to store output: ${outputUri}`,
              );
            }
          }
        });
      } else {
        // Single write or no transaction support — store envelope
        await executor.updateOne(
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

        // Store outputs sequentially (no atomicity guarantees without transaction)
        if (isMessageData(data)) {
          for (const [outputUri, outputValue] of data.payload.outputs) {
            const outputResult = await this.receiveWithExecutor(
              [outputUri, outputValue],
              executor,
            );
            if (!outputResult.accepted) {
              return {
                accepted: false,
                error: outputResult.error ||
                  `Failed to store output: ${outputUri}`,
              };
            }
          }
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

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const doc = await this.executor.findOne({ uri });
      if (!doc) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
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
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: msg,
        errorDetail: Errors.storageError(msg, uri),
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

      const page = options?.page ?? 1;
      const limit = options?.limit ?? 50;
      const offset = (page - 1) * limit;

      // Build filter — combine prefix regex with optional pattern filter
      const filter: Record<string, unknown> = options?.pattern
        ? {
          $and: [
            { uri: prefixRegex },
            { uri: new RegExp(options.pattern) },
          ],
        }
        : { uri: prefixRegex };

      // Determine sort — push to MongoDB for server-side ordering
      const sortField = options?.sortBy === "timestamp" ? "timestamp" : "uri";
      const sortDir: 1 | -1 = options?.sortOrder === "desc" ? -1 : 1;

      // Count total for pagination — prefer countDocuments, fall back to findMany length
      const total = this.executor.countDocuments
        ? await this.executor.countDocuments(filter)
        : (await this.executor.findMany(filter)).length;

      // Fetch paginated results with server-side sort/skip/limit
      const docs = await this.executor.findMany(filter, {
        sort: { [sortField]: sortDir },
        skip: offset,
        limit,
      });

      const data: ListItem[] = [];
      for (const doc of docs) {
        if (typeof doc.uri === "string") {
          data.push({ uri: doc.uri });
        }
      }

      return {
        success: true,
        data,
        pagination: { page, limit, total },
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
          errorDetail: Errors.notFound(uri),
        };
      }
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

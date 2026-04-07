/**
 * MongoClient - MongoDB implementation of NodeProtocolInterface
 *
 * Stores data in a single MongoDB collection. Pure storage — validation is the rig's concern.
 * Uses an injected executor so the SDK does not depend on a specific driver.
 */

import {
  Errors,
  type Message,
  type MongoClientConfig,
  type NodeProtocolInterface,
  type PersistenceRecord,
  type ReadResult,
  type ReceiveResult,
  type StatusResult,
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
  countDocuments?: (filter: Record<string, unknown>) => Promise<number>;
  ping(): Promise<boolean>;
  transaction?: <T>(fn: (executor: MongoExecutor) => Promise<T>) => Promise<T>;
  cleanup?: () => Promise<void>;
}

export class MongoClient implements NodeProtocolInterface {
  private readonly config: MongoClientConfig;
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
    if (!executor) {
      throw new Error("executor is required");
    }

    this.config = config;
    this.collectionName = config.collectionName;
    this.executor = executor;
    this.connected = true;
  }

  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    return this.receiveWithExecutor(msg, this.executor);
  }

  private async receiveWithExecutor<D = unknown>(
    msg: Message<D>,
    executor: MongoExecutor,
  ): Promise<ReceiveResult> {
    const [uri, data] = msg;

    if (!uri || typeof uri !== "string") {
      return {
        accepted: false,
        error: "Message URI is required",
        errorDetail: Errors.invalidUri(uri ?? "", "Message URI is required"),
      };
    }

    try {
      const encodedData = encodeBinaryForJson(data);
      const record: PersistenceRecord<typeof encodedData> = {
        ts: Date.now(),
        data: encodedData,
      };

      if (isMessageData(data) && executor.transaction) {
        await executor.transaction(async (tx) => {
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

  async read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    const results: ReadResult<T>[] = [];

    for (const uri of uriList) {
      if (uri.endsWith("/")) {
        results.push(...await this._list<T>(uri));
      } else {
        results.push(await this._readOne<T>(uri));
      }
    }

    return results;
  }

  private async _readOne<T = unknown>(uri: string): Promise<ReadResult<T>> {
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
      const decodedData = decodeBinaryFromJson(dataValue) as T;

      const record: PersistenceRecord<T> = {
        ts: typeof tsValue === "number" ? tsValue : Number(tsValue),
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

  private async _list<T = unknown>(uri: string): Promise<ReadResult<T>[]> {
    try {
      const prefixBase = uri.endsWith("/") ? uri : `${uri}/`;
      const prefixRegex = new RegExp(`^${this.escapeRegex(prefixBase)}`);

      const docs = await this.executor.findMany({ uri: prefixRegex });

      if (!docs.length) {
        return [];
      }

      const results: ReadResult<T>[] = [];
      for (const doc of docs) {
        const docUri = typeof doc.uri === "string" ? doc.uri : undefined;
        if (!docUri) continue;

        const tsValue = doc.timestamp;
        const decodedData = decodeBinaryFromJson(doc.data) as T;
        results.push({
          success: true,
          record: {
            ts: typeof tsValue === "number" ? tsValue : Number(tsValue),
            data: decodedData,
            uri: docUri,
          } as PersistenceRecord<T>,
        });
      }

      return results;
    } catch (_error) {
      return [];
    }
  }

  // deno-lint-ignore require-yield
  async *observe<T = unknown>(
    _pattern: string,
    _signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    // Not implemented — observe requires transport-specific support.
  }

  async status(): Promise<StatusResult> {
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
        schema: [],
        message: "MongoDB client is operational",
        details: {
          collectionName: this.collectionName,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

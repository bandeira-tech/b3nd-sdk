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
  deleteOne?: (
    filter: Record<string, unknown>,
  ) => Promise<{ deletedCount?: number }>;
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

  async receive(msgs: Message[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const msg of msgs) {
      results.push(await this.receiveOne(msg));
    }

    return results;
  }

  private async receiveOne(msg: Message): Promise<ReceiveResult> {
    const [uri, , data] = msg;

    if (!uri || typeof uri !== "string") {
      return {
        accepted: false,
        error: "Message URI is required",
        errorDetail: Errors.invalidUri(uri ?? "", "Message URI is required"),
      };
    }

    try {
      const { inputs, outputs } = data as {
        inputs: string[];
        outputs: [string, Record<string, number>, unknown][];
      };

      // Delete every URI in inputs
      if (inputs && this.executor.deleteOne) {
        for (const inputUri of inputs) {
          await this.executor.deleteOne({ uri: inputUri });
        }
      }

      // Write every output
      if (outputs) {
        for (const [outUri, outValues, outData] of outputs) {
          const encodedData = encodeBinaryForJson(outData);
          await this.executor.updateOne(
            { uri: outUri },
            {
              $set: {
                uri: outUri,
                data: encodedData as unknown,
                values: outValues,
                updatedAt: new Date(),
                collection: this.collectionName,
              },
              $setOnInsert: {
                createdAt: new Date(),
              },
            } as unknown as Record<string, unknown>,
            { upsert: true },
          );
        }
      }

      return { accepted: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        accepted: false,
        error: errMsg,
        errorDetail: Errors.storageError(errMsg, uri),
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

      const dataValue = doc.data;
      const decodedData = decodeBinaryFromJson(dataValue) as T;
      const valuesValue = (doc.values ?? {}) as Record<string, number>;

      const record: PersistenceRecord<T> = {
        values: valuesValue,
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

        const decodedData = decodeBinaryFromJson(doc.data) as T;
        const valuesValue = (doc.values ?? {}) as Record<string, number>;
        results.push({
          success: true,
          record: {
            values: valuesValue,
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

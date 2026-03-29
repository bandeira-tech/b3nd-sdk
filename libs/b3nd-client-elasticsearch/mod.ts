/**
 * ElasticsearchClient - Elasticsearch implementation of NodeProtocolInterface
 *
 * Stores data as documents in Elasticsearch indices using the URI structure
 * to derive index names and document IDs. Each record becomes a document
 * containing `{ ts, data }`.
 *
 * Uses an injected executor so the SDK does not depend on a specific
 * Elasticsearch client library. Works with any wrapper that implements
 * the ElasticsearchExecutor interface.
 *
 * URL format: elasticsearch://host:port
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
  type Schema,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";

/**
 * Configuration for ElasticsearchClient
 */
export interface ElasticsearchClientConfig {
  /** Index name prefix for b3nd data (e.g., "b3nd") */
  indexPrefix: string;

  /** Schema for validation — must be explicitly provided */
  schema: Schema;
}

/**
 * Elasticsearch executor interface.
 * Abstracts Elasticsearch I/O so the client works with any ES library or test stubs.
 */
export interface ElasticsearchExecutor {
  /** Index (upsert) a document */
  index: (
    index: string,
    id: string,
    body: Record<string, unknown>,
  ) => Promise<void>;
  /** Get a document by ID. Returns null if not found. */
  get: (
    index: string,
    id: string,
  ) => Promise<Record<string, unknown> | null>;
  /** Delete a document by ID */
  delete: (index: string, id: string) => Promise<void>;
  /** Search documents with a query body */
  search: (
    index: string,
    body: Record<string, unknown>,
  ) => Promise<{
    hits: Array<{ _id: string; _source: Record<string, unknown> }>;
  }>;
  /** Check cluster health */
  ping: () => Promise<boolean>;
  /** Optional cleanup */
  cleanup?: () => Promise<void>;
}

/**
 * Validate schema key format.
 * Keys must be in format: "protocol://hostname"
 */
function validateSchemaKey(key: string): boolean {
  return /^[a-z]+:\/\/[a-z0-9-]+$/.test(key);
}

/**
 * Extract program key from a URI.
 * "mutable://accounts/alice/profile" → "mutable://accounts"
 */
function extractProgramKey(uri: string): string {
  const url = new URL(uri);
  return `${url.protocol}//${url.hostname}`;
}

/**
 * Derive index name and document ID from a URI and index prefix.
 *
 * "mutable://accounts/alice/profile" with prefix "b3nd" →
 *   index: "b3nd_mutable_accounts"
 *   docId: "alice/profile"
 */
function uriToIndexAndDocId(
  uri: string,
  indexPrefix: string,
): { index: string; docId: string } {
  const url = new URL(uri);
  const protocol = url.protocol.replace(":", ""); // "mutable"
  const hostname = url.hostname; // "accounts"
  const index = `${indexPrefix}_${protocol}_${hostname}`;
  const docId = url.pathname.substring(1); // strip leading "/"
  return { index, docId };
}

/**
 * Reconstruct a URI from index name and document ID.
 */
function indexAndDocIdToUri(
  index: string,
  indexPrefix: string,
  docId: string,
): string {
  // index: "b3nd_mutable_accounts" → protocol: "mutable", hostname: "accounts"
  const withoutPrefix = index.substring(indexPrefix.length + 1); // "mutable_accounts"
  const firstUnderscore = withoutPrefix.indexOf("_");
  const protocol = withoutPrefix.substring(0, firstUnderscore);
  const hostname = withoutPrefix.substring(firstUnderscore + 1);
  return `${protocol}://${hostname}/${docId}`;
}

export class ElasticsearchClient implements NodeProtocolInterface {
  private readonly schema: Schema;
  private readonly indexPrefix: string;
  private readonly executor: ElasticsearchExecutor;

  constructor(config: ElasticsearchClientConfig, executor: ElasticsearchExecutor) {
    if (!config) {
      throw new Error("ElasticsearchClientConfig is required");
    }
    if (!config.indexPrefix) {
      throw new Error("indexPrefix is required in ElasticsearchClientConfig");
    }
    if (!config.schema) {
      throw new Error("schema is required in ElasticsearchClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    // Validate schema key format
    const invalidKeys = Object.keys(config.schema).filter(
      (key) => !validateSchemaKey(key),
    );
    if (invalidKeys.length > 0) {
      throw new Error(
        `Invalid schema key format: ${invalidKeys.map((k) => `"${k}"`).join(", ")}. ` +
          `Keys must be in "protocol://hostname" format (e.g., "mutable://accounts", "immutable://data").`,
      );
    }

    this.schema = config.schema;
    this.indexPrefix = config.indexPrefix;
    this.executor = executor;
  }

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
      const programKey = extractProgramKey(uri);
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
      const { index, docId } = uriToIndexAndDocId(uri, this.indexPrefix);

      await this.executor.index(index, docId, { ts, data: encodedData });

      // If MessageData, also store each output at its own URI
      if (isMessageData(data)) {
        for (const [outputUri, outputValue] of data.payload.outputs) {
          const outputEncoded = encodeBinaryForJson(outputValue);
          const outputTs = Date.now();
          const { index: outIndex, docId: outDocId } = uriToIndexAndDocId(
            outputUri,
            this.indexPrefix,
          );
          await this.executor.index(outIndex, outDocId, {
            ts: outputTs,
            data: outputEncoded,
          });
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
      const { index, docId } = uriToIndexAndDocId(uri, this.indexPrefix);
      const doc = await this.executor.get(index, docId);

      if (!doc) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }

      const record = doc as unknown as PersistenceRecord;
      const decodedData = decodeBinaryFromJson(record.data) as T;

      return {
        success: true,
        record: { ts: record.ts, data: decodedData },
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

    // Parallel reads — ES is network-bound so Promise.all is optimal
    const readPromises = uris.map((uri) => this.read<T>(uri));
    const readResults = await Promise.all(readPromises);

    const results: ReadMultiResultItem<T>[] = [];
    let succeeded = 0;

    for (let i = 0; i < uris.length; i++) {
      const uri = uris[i];
      const result = readResults[i];
      if (result.success && result.record) {
        results.push({ uri, success: true, record: result.record });
        succeeded++;
      } else {
        results.push({
          uri,
          success: false,
          error: result.error || "Read failed",
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
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const { index, docId } = uriToIndexAndDocId(uri, this.indexPrefix);
      const pathPrefix = docId;

      const page = options?.page ?? 1;
      const limit = options?.limit ?? 50;

      // Use prefix query on _id to find documents under this path
      const searchBody: Record<string, unknown> = {
        query: { prefix: { _id: pathPrefix } },
        size: 10000, // fetch all matches, paginate locally
      };

      const searchResult = await this.executor.search(index, searchBody);

      let items: ListItem[] = searchResult.hits.map((hit) =>
        ({ uri: indexAndDocIdToUri(index, this.indexPrefix, hit._id) })
      );

      // Apply pattern filter
      if (options?.pattern) {
        const regex = new RegExp(options.pattern);
        items = items.filter((item) => regex.test(item.uri));
      }

      // Sort
      if (options?.sortBy === "name" || !options?.sortBy) {
        items.sort((a, b) => a.uri.localeCompare(b.uri));
      } else if (options?.sortBy === "timestamp") {
        // Would need to read each doc for ts; fall back to name sort
        items.sort((a, b) => a.uri.localeCompare(b.uri));
      }

      if (options?.sortOrder === "desc") {
        items.reverse();
      }

      const total = items.length;
      const offset = (page - 1) * limit;
      const paginated = items.slice(offset, offset + limit);

      return {
        success: true,
        data: paginated,
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
      const { index, docId } = uriToIndexAndDocId(uri, this.indexPrefix);

      // Check existence first
      const doc = await this.executor.get(index, docId);
      if (!doc) {
        return {
          success: false,
          error: "Not found",
          errorDetail: Errors.notFound(uri),
        };
      }

      await this.executor.delete(index, docId);
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
      const alive = await this.executor.ping();
      if (!alive) {
        return {
          status: "unhealthy",
          message: "Elasticsearch cluster is not reachable",
        };
      }

      return {
        status: "healthy",
        message: "Elasticsearch client is operational",
        details: {
          indexPrefix: this.indexPrefix,
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

  getSchema(): Promise<string[]> {
    return Promise.resolve(Object.keys(this.schema));
  }

  async cleanup(): Promise<void> {
    if (this.executor.cleanup) {
      await this.executor.cleanup();
    }
  }
}

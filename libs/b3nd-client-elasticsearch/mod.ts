/**
 * ElasticsearchClient - Elasticsearch implementation of NodeProtocolInterface
 *
 * Stores data as documents in Elasticsearch indices. Pure storage — validation is the rig's concern.
 *
 * Uses an injected executor so the SDK does not depend on a specific
 * Elasticsearch client library.
 *
 * URL format: elasticsearch://host:port
 */

import {
  Errors,
  type DeleteResult,
  type ListItem,
  type ListOptions,
  type ListResult,
  type Message,
  type NodeProtocolInterface,
  type NodeStatus,
  type PersistenceRecord,
  type ReadMultiResult,
  type ReadMultiResultItem,
  type ReadResult,
  type ReceiveResult,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";

export interface ElasticsearchClientConfig {
  /** Index name prefix for b3nd data (e.g., "b3nd") */
  indexPrefix: string;
}

export interface ElasticsearchExecutor {
  index: (
    index: string,
    id: string,
    body: Record<string, unknown>,
  ) => Promise<void>;
  get: (
    index: string,
    id: string,
  ) => Promise<Record<string, unknown> | null>;
  delete: (index: string, id: string) => Promise<void>;
  search: (
    index: string,
    body: Record<string, unknown>,
  ) => Promise<{
    hits: Array<{ _id: string; _source: Record<string, unknown> }>;
  }>;
  ping: () => Promise<boolean>;
  cleanup?: () => Promise<void>;
}

function uriToIndexAndDocId(
  uri: string,
  indexPrefix: string,
): { index: string; docId: string } {
  const url = new URL(uri);
  const protocol = url.protocol.replace(":", "");
  const hostname = url.hostname;
  const index = `${indexPrefix}_${protocol}_${hostname}`;
  const docId = url.pathname.substring(1);
  return { index, docId };
}

function indexAndDocIdToUri(
  index: string,
  indexPrefix: string,
  docId: string,
): string {
  const withoutPrefix = index.substring(indexPrefix.length + 1);
  const firstUnderscore = withoutPrefix.indexOf("_");
  const protocol = withoutPrefix.substring(0, firstUnderscore);
  const hostname = withoutPrefix.substring(firstUnderscore + 1);
  return `${protocol}://${hostname}/${docId}`;
}

export class ElasticsearchClient implements NodeProtocolInterface {
  private readonly indexPrefix: string;
  private readonly executor: ElasticsearchExecutor;

  constructor(config: ElasticsearchClientConfig, executor: ElasticsearchExecutor) {
    if (!config) {
      throw new Error("ElasticsearchClientConfig is required");
    }
    if (!config.indexPrefix) {
      throw new Error("indexPrefix is required in ElasticsearchClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

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
      const encodedData = encodeBinaryForJson(data);
      const ts = Date.now();
      const { index, docId } = uriToIndexAndDocId(uri, this.indexPrefix);

      await this.executor.index(index, docId, { ts, data: encodedData });

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

      const searchBody: Record<string, unknown> = {
        query: { prefix: { _id: pathPrefix } },
        size: 10000,
      };

      const searchResult = await this.executor.search(index, searchBody);

      let items: ListItem[] = searchResult.hits.map((hit) =>
        ({ uri: indexAndDocIdToUri(index, this.indexPrefix, hit._id) })
      );

      if (options?.pattern) {
        const regex = new RegExp(options.pattern);
        items = items.filter((item) => regex.test(item.uri));
      }

      if (options?.sortBy === "name" || !options?.sortBy) {
        items.sort((a, b) => a.uri.localeCompare(b.uri));
      } else if (options?.sortBy === "timestamp") {
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

  async status(): Promise<NodeStatus> {
    try {
      const alive = await this.executor.ping();
      if (!alive) {
        return {
          healthy: false,
          message: "Elasticsearch cluster is not reachable",
        };
      }

      return {
        healthy: true,
        message: "Elasticsearch client is operational",
        indexPrefix: this.indexPrefix,
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async cleanup(): Promise<void> {
    if (this.executor.cleanup) {
      await this.executor.cleanup();
    }
  }
}

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
  type Message,
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

  constructor(
    config: ElasticsearchClientConfig,
    executor: ElasticsearchExecutor,
  ) {
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
      const { index, docId } = uriToIndexAndDocId(uri, this.indexPrefix);
      const doc = await this.executor.get(index, docId);

      if (!doc) {
        return {
          success: false,
          uri,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }

      const record = doc as unknown as PersistenceRecord;
      const decodedData = decodeBinaryFromJson(record.data) as T;

      return {
        success: true,
        uri,
        record: { ts: record.ts, data: decodedData },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        uri,
        error: msg,
        errorDetail: Errors.storageError(msg, uri),
      };
    }
  }

  private async _list<T = unknown>(uri: string): Promise<ReadResult<T>[]> {
    try {
      const { index, docId } = uriToIndexAndDocId(uri, this.indexPrefix);
      const pathPrefix = docId;

      const searchBody: Record<string, unknown> = {
        query: { prefix: { _id: pathPrefix } },
        size: 10000,
      };

      const searchResult = await this.executor.search(index, searchBody);

      if (!searchResult.hits.length) {
        return [];
      }

      const results: ReadResult<T>[] = [];
      for (const hit of searchResult.hits) {
        const hitUri = indexAndDocIdToUri(index, this.indexPrefix, hit._id);
        const record = hit._source as unknown as PersistenceRecord;
        const decodedData = decodeBinaryFromJson(record.data) as T;
        results.push({
          success: true,
          uri: hitUri,
          record: { ts: record.ts, data: decodedData },
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
      const alive = await this.executor.ping();
      if (!alive) {
        return {
          status: "unhealthy",
          message: "Elasticsearch cluster is not reachable",
        };
      }

      return {
        status: "healthy",
        schema: [],
        message: "Elasticsearch client is operational",
        details: {
          indexPrefix: this.indexPrefix,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

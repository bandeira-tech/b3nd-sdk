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
  type ReadResult,
  type ReceiveResult,
  type StatusResult,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";

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
  delete?: (
    index: string,
    id: string,
  ) => Promise<void>;
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
      if (inputs && this.executor.delete) {
        for (const inputUri of inputs) {
          const { index, docId } = uriToIndexAndDocId(
            inputUri,
            this.indexPrefix,
          );
          await this.executor.delete(index, docId);
        }
      }

      // Write every output
      if (outputs) {
        for (const [outUri, outValues, outData] of outputs) {
          const encodedData = encodeBinaryForJson(outData);
          const { index, docId } = uriToIndexAndDocId(
            outUri,
            this.indexPrefix,
          );
          await this.executor.index(index, docId, {
            values: outValues,
            data: encodedData,
          });
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

      const valuesValue = (doc.values ?? {}) as Record<string, number>;
      const decodedData = decodeBinaryFromJson(doc.data) as T;

      return {
        success: true,
        uri,
        record: { values: valuesValue, data: decodedData },
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
        const valuesValue = (hit._source.values ?? {}) as Record<string, number>;
        const decodedData = decodeBinaryFromJson(hit._source.data) as T;
        results.push({
          success: true,
          uri: hitUri,
          record: { values: valuesValue, data: decodedData },
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

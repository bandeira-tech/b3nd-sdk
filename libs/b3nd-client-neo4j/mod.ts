/**
 * Neo4jClient - Neo4j graph database implementation of NodeProtocolInterface
 *
 * Stores data as labeled nodes in a Neo4j graph. Each record is a :Record
 * node with a unique `uri` property, a JSON-serialized `data` property, and
 * a numeric `timestamp`. Uses an injected executor so the SDK does not
 * depend on a specific Neo4j driver.
 *
 * URL format: neo4j://host:7687/database or bolt://host:7687/database
 */

import {
  Errors,
  type DeleteResult,
  type HealthStatus,
  type ListItem,
  type ListOptions,
  type ListResult,
  type Message,
  type Neo4jClientConfig,
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
 * Neo4j executor interface.
 * Abstracts Cypher execution so the client works with the official driver,
 * test stubs, or alternative libraries.
 */
export interface Neo4jExecutor {
  /**
   * Run a read Cypher query. Returns rows as plain objects.
   * Property names come from the RETURN clause aliases.
   */
  run(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]>;

  /**
   * Run a write Cypher query. Returns mutation counters.
   */
  write(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<{
    nodesCreated?: number;
    nodesDeleted?: number;
    propertiesSet?: number;
  }>;

  /**
   * Run multiple operations in an ACID transaction.
   * When provided, MessageData envelopes and their outputs are stored
   * atomically. If not implemented, outputs are stored sequentially.
   */
  transaction?: <T>(fn: (tx: Neo4jExecutor) => Promise<T>) => Promise<T>;

  /** Verify connectivity to the Neo4j instance. */
  ping(): Promise<boolean>;

  /** Optional cleanup (close driver, etc.) */
  cleanup?: () => Promise<void>;
}

export class Neo4jClient implements NodeProtocolInterface {
  private readonly schema: Schema;
  private readonly database: string;
  private readonly connectionString: string;
  private readonly executor: Neo4jExecutor;
  private connected = false;

  constructor(config: Neo4jClientConfig, executor?: Neo4jExecutor) {
    if (!config) {
      throw new Error("Neo4jClientConfig is required");
    }
    if (!config.connectionString) {
      throw new Error("connectionString is required in Neo4jClientConfig");
    }
    if (!config.schema) {
      throw new Error("schema is required in Neo4jClientConfig");
    }
    if (!executor) {
      throw new Error("executor is required");
    }

    this.schema = config.schema;
    this.database = config.database ?? "neo4j";
    this.connectionString = config.connectionString;
    this.executor = executor;
    this.connected = true;
  }

  /**
   * Ensure the unique constraint and indexes exist.
   * Safe to call multiple times (IF NOT EXISTS).
   */
  async initializeSchema(): Promise<void> {
    await this.executor.write(
      "CREATE CONSTRAINT b3nd_record_uri IF NOT EXISTS FOR (n:Record) REQUIRE n.uri IS UNIQUE",
    );
    await this.executor.write(
      "CREATE INDEX b3nd_record_timestamp IF NOT EXISTS FOR (n:Record) ON (n.timestamp)",
    );
  }

  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    return this.receiveWithExecutor(msg, this.executor);
  }

  private async receiveWithExecutor<D = unknown>(
    msg: Message<D>,
    executor: Neo4jExecutor,
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

      const readFn = <T = unknown>(readUri: string): Promise<ReadResult<T>> =>
        this.readWithExecutor<T>(readUri, executor);
      const validation = await validator({
        uri,
        value: data,
        read: readFn,
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
      const dataJson = JSON.stringify(encodedData);

      // If MessageData with outputs, wrap in a transaction for atomicity
      if (isMessageData(data) && executor.transaction) {
        await executor.transaction(async (tx) => {
          await tx.write(
            `MERGE (n:Record {uri: $uri})
             SET n.data = $data, n.timestamp = $ts, n.updatedAt = timestamp()
             ON CREATE SET n.createdAt = timestamp()`,
            { uri, data: dataJson, ts },
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
        await executor.write(
          `MERGE (n:Record {uri: $uri})
           SET n.data = $data, n.timestamp = $ts, n.updatedAt = timestamp()
           ON CREATE SET n.createdAt = timestamp()`,
          { uri, data: dataJson, ts },
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
    return this.readWithExecutor<T>(uri, this.executor);
  }

  private async readWithExecutor<T = unknown>(
    uri: string,
    executor: Neo4jExecutor,
  ): Promise<ReadResult<T>> {
    try {
      const rows = await executor.run(
        "MATCH (n:Record {uri: $uri}) RETURN n.data AS data, n.timestamp AS timestamp",
        { uri },
      );

      if (rows.length === 0) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }

      const row = rows[0];
      const parsed = JSON.parse(row.data as string);
      const decodedData = decodeBinaryFromJson(parsed) as T;

      return {
        success: true,
        record: {
          ts: typeof row.timestamp === "number"
            ? row.timestamp
            : Number(row.timestamp),
          data: decodedData,
        },
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
      const rows = await this.executor.run(
        "MATCH (n:Record) WHERE n.uri IN $uris RETURN n.uri AS uri, n.data AS data, n.timestamp AS timestamp",
        { uris },
      );

      const found = new Map<string, PersistenceRecord<T>>();
      for (const row of rows) {
        const docUri = row.uri as string;
        const parsed = JSON.parse(row.data as string);
        const decodedData = decodeBinaryFromJson(parsed) as T;
        found.set(docUri, {
          ts: typeof row.timestamp === "number"
            ? row.timestamp
            : Number(row.timestamp),
          data: decodedData,
        });
      }

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
      // Fallback to individual reads
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
      const prefix = uri.endsWith("/") ? uri : `${uri}/`;

      const page = options?.page ?? 1;
      const limit = options?.limit ?? 50;
      const offset = (page - 1) * limit;

      // Build WHERE clause
      let whereClause = "n.uri STARTS WITH $prefix";
      const params: Record<string, unknown> = { prefix };

      if (options?.pattern) {
        whereClause += " AND n.uri =~ $pattern";
        params.pattern = `.*${options.pattern}.*`;
      }

      // Sort
      const sortField = options?.sortBy === "timestamp"
        ? "n.timestamp"
        : "n.uri";
      const sortDir = options?.sortOrder === "desc" ? "DESC" : "ASC";

      // Count total
      const countRows = await this.executor.run(
        `MATCH (n:Record) WHERE ${whereClause} RETURN count(n) AS total`,
        params,
      );
      const total = Number(countRows[0]?.total ?? 0);

      // Fetch paginated results
      const rows = await this.executor.run(
        `MATCH (n:Record) WHERE ${whereClause}
         RETURN n.uri AS uri
         ORDER BY ${sortField} ${sortDir}
         SKIP $offset LIMIT $limit`,
        { ...params, offset, limit },
      );

      const data: ListItem[] = rows.map((row) => ({ uri: row.uri as string }));

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
      const result = await this.executor.write(
        "MATCH (n:Record {uri: $uri}) DELETE n",
        { uri },
      );

      const deleted = (result.nodesDeleted ?? 0) > 0;
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
          message: "Not connected to Neo4j",
        };
      }

      const ok = await this.executor.ping();
      if (!ok) {
        return {
          status: "unhealthy",
          message: "Neo4j ping failed",
        };
      }

      return {
        status: "healthy",
        message: "Neo4j client is operational",
        details: {
          database: this.database,
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
}

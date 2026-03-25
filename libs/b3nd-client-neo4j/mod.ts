/**
 * Neo4jClient - Neo4j graph database implementation of NodeProtocolInterface
 *
 * Stores data as labeled nodes in a Neo4j graph. Each record is a :Record
 * node with a unique `uri` property, a JSON-serialized `data` property, and
 * a numeric `timestamp`. Uses an injected executor so the SDK does not
 * depend on a specific Neo4j driver.
 *
 * Graph features beyond basic CRUD:
 *   - URI hierarchy: :CHILD_OF edges model the URI tree (e.g.
 *     store://users/alice -[:CHILD_OF]-> store://users).
 *   - Provenance: MessageData envelopes create :PRODUCES edges to each
 *     output and :CONSUMES edges from each input.
 *   - Traversal queries: ancestors(), descendants(), provenance(), related().
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
    relationshipsCreated?: number;
    relationshipsDeleted?: number;
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

/** A node in a graph traversal result. */
export interface GraphNode {
  uri: string;
  relationship: string;
  depth: number;
}

/** Result of a graph traversal query. */
export interface GraphTraversalResult {
  success: boolean;
  nodes: GraphNode[];
  error?: string;
}

/** Provenance information for a record. */
export interface ProvenanceResult {
  success: boolean;
  /** The envelope URI that produced this record (if any). */
  producedBy?: string;
  /** URIs that this envelope consumes (inputs). */
  consumes: string[];
  /** URIs that this envelope produces (outputs). */
  produces: string[];
  error?: string;
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
    /** When set, the envelope URI that is producing this record. */
    envelopeUri?: string,
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

      // Helper: upsert a record node + create CHILD_OF hierarchy edge
      const upsertRecord = async (tx: Neo4jExecutor, nodeUri: string, nodeData: string, nodeTs: number) => {
        await tx.write(
          `MERGE (n:Record {uri: $uri})
           SET n.data = $data, n.timestamp = $ts, n.updatedAt = timestamp()
           ON CREATE SET n.createdAt = timestamp()`,
          { uri: nodeUri, data: nodeData, ts: nodeTs },
        );

        // Create CHILD_OF edge to parent URI if it exists as a prefix
        const parentUri = this.parentUri(nodeUri);
        if (parentUri) {
          await tx.write(
            `MATCH (child:Record {uri: $childUri})
             MERGE (parent:Record {uri: $parentUri})
             ON CREATE SET parent.timestamp = $ts, parent.createdAt = timestamp(), parent.updatedAt = timestamp()
             MERGE (child)-[:CHILD_OF]->(parent)`,
            { childUri: nodeUri, parentUri, ts: nodeTs },
          );
        }
      };

      // If MessageData with outputs, wrap in a transaction for atomicity
      if (isMessageData(data) && executor.transaction) {
        await executor.transaction(async (tx) => {
          await upsertRecord(tx, uri, dataJson, ts);

          // Create CONSUMES edges from envelope to each input
          for (const inputUri of data.payload.inputs) {
            await tx.write(
              `MATCH (envelope:Record {uri: $envelopeUri})
               MERGE (input:Record {uri: $inputUri})
               ON CREATE SET input.timestamp = $ts, input.createdAt = timestamp(), input.updatedAt = timestamp()
               MERGE (envelope)-[:CONSUMES]->(input)`,
              { envelopeUri: uri, inputUri, ts },
            );
          }

          for (const [outputUri, outputValue] of data.payload.outputs) {
            const outputResult = await this.receiveWithExecutor(
              [outputUri, outputValue],
              tx,
              uri,
            );
            if (!outputResult.accepted) {
              throw new Error(
                outputResult.error || `Failed to store output: ${outputUri}`,
              );
            }
          }
        });
      } else {
        await upsertRecord(executor, uri, dataJson, ts);

        // Create PRODUCES edge from envelope to this output
        if (envelopeUri) {
          await executor.write(
            `MATCH (envelope:Record {uri: $envelopeUri}), (output:Record {uri: $outputUri})
             MERGE (envelope)-[:PRODUCES]->(output)`,
            { envelopeUri, outputUri: uri },
          );
        }

        // Store outputs sequentially (no atomicity guarantees without transaction)
        if (isMessageData(data)) {
          // Create CONSUMES edges
          for (const inputUri of data.payload.inputs) {
            await executor.write(
              `MATCH (envelope:Record {uri: $envelopeUri})
               MERGE (input:Record {uri: $inputUri})
               ON CREATE SET input.timestamp = $ts, input.createdAt = timestamp(), input.updatedAt = timestamp()
               MERGE (envelope)-[:CONSUMES]->(input)`,
              { envelopeUri: uri, inputUri, ts },
            );
          }

          for (const [outputUri, outputValue] of data.payload.outputs) {
            const outputResult = await this.receiveWithExecutor(
              [outputUri, outputValue],
              executor,
              uri,
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

      // For transactional path, create PRODUCES edges after outputs exist
      if (isMessageData(data) && executor.transaction) {
        for (const [outputUri] of data.payload.outputs) {
          await executor.write(
            `MATCH (envelope:Record {uri: $envelopeUri}), (output:Record {uri: $outputUri})
             MERGE (envelope)-[:PRODUCES]->(output)`,
            { envelopeUri: uri, outputUri },
          );
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
      if (row.data === undefined || row.data === null) {
        return {
          success: false,
          error: `Not found: ${uri}`,
          errorDetail: Errors.notFound(uri),
        };
      }
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
        if (row.data === undefined || row.data === null) continue;
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

      // Exclude stub nodes (created only for CHILD_OF hierarchy, no data)
      whereClause += " AND n.data IS NOT NULL";

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
      // DETACH DELETE removes the node and all its relationships
      const result = await this.executor.write(
        "MATCH (n:Record {uri: $uri}) DETACH DELETE n",
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

  // ── Graph-specific query methods ─────────────────────────────────────

  /**
   * Get provenance information for a record.
   * Returns the envelope that produced it and the inputs/outputs of that envelope.
   */
  async provenance(uri: string): Promise<ProvenanceResult> {
    try {
      // Find the envelope that PRODUCES this URI
      const producerRows = await this.executor.run(
        `MATCH (envelope:Record)-[:PRODUCES]->(target:Record {uri: $uri})
         RETURN envelope.uri AS envelopeUri`,
        { uri },
      );

      const producedBy = producerRows.length > 0
        ? (producerRows[0].envelopeUri as string)
        : undefined;

      // Find what this URI produces (if it's an envelope)
      const producesRows = await this.executor.run(
        `MATCH (envelope:Record {uri: $uri})-[:PRODUCES]->(output:Record)
         RETURN output.uri AS outputUri`,
        { uri },
      );
      const produces = producesRows.map((r) => r.outputUri as string);

      // Find what this URI consumes (if it's an envelope)
      const consumesRows = await this.executor.run(
        `MATCH (envelope:Record {uri: $uri})-[:CONSUMES]->(input:Record)
         RETURN input.uri AS inputUri`,
        { uri },
      );
      const consumes = consumesRows.map((r) => r.inputUri as string);

      return { success: true, producedBy, consumes, produces };
    } catch (error) {
      return {
        success: false,
        consumes: [],
        produces: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get ancestors of a URI by following CHILD_OF edges upward.
   * Returns parent, grandparent, etc. up to maxDepth (default 10).
   */
  async ancestors(uri: string, maxDepth = 10): Promise<GraphTraversalResult> {
    try {
      const rows = await this.executor.run(
        `MATCH path = (start:Record {uri: $uri})-[:CHILD_OF*1..${maxDepth}]->(ancestor:Record)
         RETURN ancestor.uri AS uri, length(path) AS depth
         ORDER BY depth ASC`,
        { uri },
      );

      const nodes: GraphNode[] = rows.map((r) => ({
        uri: r.uri as string,
        relationship: "CHILD_OF",
        depth: typeof r.depth === "number" ? r.depth : Number(r.depth),
      }));

      return { success: true, nodes };
    } catch (error) {
      return {
        success: false,
        nodes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get descendants of a URI by following CHILD_OF edges downward.
   * Returns children, grandchildren, etc. up to maxDepth (default 10).
   */
  async descendants(
    uri: string,
    maxDepth = 10,
  ): Promise<GraphTraversalResult> {
    try {
      const rows = await this.executor.run(
        `MATCH path = (descendant:Record)-[:CHILD_OF*1..${maxDepth}]->(start:Record {uri: $uri})
         RETURN descendant.uri AS uri, length(path) AS depth
         ORDER BY depth ASC`,
        { uri },
      );

      const nodes: GraphNode[] = rows.map((r) => ({
        uri: r.uri as string,
        relationship: "CHILD_OF",
        depth: typeof r.depth === "number" ? r.depth : Number(r.depth),
      }));

      return { success: true, nodes };
    } catch (error) {
      return {
        success: false,
        nodes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Find all records related to a URI through any relationship type,
   * up to maxDepth hops (default 3). Useful for exploring the graph
   * around a particular record.
   */
  async related(uri: string, maxDepth = 3): Promise<GraphTraversalResult> {
    try {
      const rows = await this.executor.run(
        `MATCH path = (start:Record {uri: $uri})-[r*1..${maxDepth}]-(related:Record)
         WHERE related.uri <> $uri
         RETURN DISTINCT related.uri AS uri, type(head(r)) AS rel, length(path) AS depth
         ORDER BY depth ASC`,
        { uri },
      );

      const nodes: GraphNode[] = rows.map((r) => ({
        uri: r.uri as string,
        relationship: r.rel as string,
        depth: typeof r.depth === "number" ? r.depth : Number(r.depth),
      }));

      return { success: true, nodes };
    } catch (error) {
      return {
        success: false,
        nodes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private extractProgramKey(uri: string): string {
    const url = new URL(uri);
    return `${url.protocol}//${url.hostname}`;
  }

  /**
   * Extract the parent URI for hierarchy edges.
   * e.g. "store://users/alice" → "store://users"
   *      "store://files/docs/2024" → "store://files/docs"
   * Returns undefined if the URI is already a root (e.g. "store://users").
   *
   * Works on the raw string to handle URI schemes where new URL() puts
   * path segments into the hostname (e.g. store://users/alice →
   * hostname="users", pathname="/alice").
   */
  private parentUri(uri: string): string | undefined {
    // Find the :// separator
    const schemeEnd = uri.indexOf("://");
    if (schemeEnd === -1) return undefined;
    // Everything after :// is the authority + path
    const rest = uri.substring(schemeEnd + 3); // "users/alice"
    const lastSlash = rest.lastIndexOf("/");
    if (lastSlash <= 0) return undefined; // already at root (e.g. "users")
    return uri.substring(0, schemeEnd + 3) + rest.substring(0, lastSlash);
  }
}

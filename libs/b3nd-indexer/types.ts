/**
 * @module
 * B3nd Indexer Core Types
 *
 * Type definitions for the indexer system: field definitions, indexer
 * declarations, query/filter interfaces, aggregation pipelines, and
 * the backend storage interface.
 */

// ── Field & Indexer Definition ──────────────────────────────────────

/**
 * Describes a single field within an indexer's schema.
 */
export interface IndexFieldDefinition {
  /** Field name */
  name: string;
  /** Data type of the field */
  type: "string" | "number" | "boolean" | "date" | "json";
  /** Whether this field is indexed for fast lookups (default true) */
  indexed?: boolean;
  /** Whether this field participates in full-text search (default false) */
  searchable?: boolean;
  /** Whether this field can be null (default true) */
  nullable?: boolean;
}

/**
 * Declares an indexer: which URIs it watches, which fields it extracts,
 * and the schema version for evolution.
 */
export interface IndexerDefinition {
  /** Unique indexer name */
  name: string;
  /** Schema version (for evolution) */
  version: number;
  /** URI prefixes this indexer watches */
  uriPatterns: string[];
  /**
   * Field extraction function.
   * Returns extracted fields for a given URI/data pair, or null to skip.
   */
  extract: (
    uri: string,
    data: unknown,
  ) => Record<string, unknown> | null;
  /** Field definitions for this indexer */
  fields: IndexFieldDefinition[];
}

// ── Query Types ─────────────────────────────────────────────────────

/**
 * Filter operators for querying indexed data.
 */
export type FilterOperator = {
  $eq?: unknown;
  $ne?: unknown;
  $gt?: unknown;
  $gte?: unknown;
  $lt?: unknown;
  $lte?: unknown;
  $in?: unknown[];
  $nin?: unknown[];
  $contains?: string;
  $startsWith?: string;
};

/**
 * Query against indexed data with filtering, searching, sorting, and pagination.
 */
export interface IndexQuery {
  /** Field-level filters */
  filter?: Record<string, FilterOperator>;
  /** Full-text search string */
  search?: string;
  /** Fields to return (projection) */
  select?: string[];
  /** Sort order */
  sort?: Array<{ field: string; order: "asc" | "desc" }>;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Result of an index query.
 */
export interface IndexQueryResult {
  items: Array<{
    uri: string;
    fields: Record<string, unknown>;
    version?: number;
  }>;
  total: number;
  hasMore: boolean;
}

/**
 * Options for full-text search.
 */
export interface SearchOptions {
  /** Fields to search within */
  fields?: string[];
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// ── Aggregation Types ───────────────────────────────────────────────

/**
 * Aggregate operators for $group stages.
 */
export type AggregateOp =
  | { $sum: string }
  | { $avg: string }
  | { $min: string }
  | { $max: string }
  | { $count: true };

/**
 * A single stage in an aggregation pipeline.
 * Modeled after MongoDB-style aggregation.
 */
export type AggregationStage =
  | { $match: Record<string, FilterOperator> }
  | {
    $group: {
      _id: string | string[];
      [key: string]: AggregateOp | string | string[];
    };
  }
  | { $sort: Record<string, 1 | -1> }
  | { $limit: number }
  | { $project: Record<string, boolean | string> };

/**
 * Result of an aggregation pipeline.
 */
export interface AggregationResult {
  rows: Record<string, unknown>[];
  total: number;
}

// ── Backend Interface ───────────────────────────────────────────────

/**
 * Storage backend interface for indexed data.
 *
 * Implementations provide the actual storage, querying, and aggregation
 * capabilities (e.g. PostgreSQL, SQLite, in-memory).
 */
export interface IndexerBackend {
  /** Initialize the backend for a given indexer definition (e.g. create tables) */
  initialize(definition: IndexerDefinition): Promise<void>;
  /** Index a document's extracted fields */
  index(
    uri: string,
    fields: Record<string, unknown>,
    version?: number,
  ): Promise<void>;
  /** Remove a document from the index */
  remove(uri: string): Promise<void>;
  /** Query the index */
  query(query: IndexQuery): Promise<IndexQueryResult>;
  /** Full-text search */
  search(text: string, options?: SearchOptions): Promise<IndexQueryResult>;
  /** Run an aggregation pipeline */
  aggregate(pipeline: AggregationStage[]): Promise<AggregationResult>;
  /** Health check */
  health(): Promise<{
    healthy: boolean;
    documentCount: number;
    lastIndexedAt?: number;
  }>;
  /** Tear down the backend (e.g. drop tables) */
  teardown(): Promise<void>;
  /** Clean up resources (e.g. close connections) */
  cleanup(): Promise<void>;
}

/**
 * @b3nd/sdk Types
 * Core types for the universal B3nd protocol interface
 */

/**
 * Persistence record with timestamp
 */
export interface PersistenceRecord<T = unknown> {
  ts: number;
  data: T;
}

/**
 * Result of a write operation
 */
export interface WriteResult<T = unknown> {
  success: boolean;
  record?: PersistenceRecord<T>;
  error?: string;
}

/**
 * Result of a read operation
 */
export interface ReadResult<T> {
  success: boolean;
  record?: PersistenceRecord<T>;
  error?: string;
}

/**
 * Result for a single URI in a multi-read operation
 */
export type ReadMultiResultItem<T = unknown> =
  | { uri: string; success: true; record: PersistenceRecord<T> }
  | { uri: string; success: false; error: string };

/**
 * Result of reading multiple URIs in a single operation
 */
export interface ReadMultiResult<T = unknown> {
  /** true if at least one read succeeded */
  success: boolean;
  /** Per-URI results */
  results: ReadMultiResultItem<T>[];
  /** Summary statistics */
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

/**
 * Result of a delete operation
 */
export interface DeleteResult {
  success: boolean;
  error?: string;
}

/**
 * Item returned from list operations
 */
export interface ListItem {
  uri: string;
}

/**
 * Options for list operations
 */
export interface ListOptions {
  page?: number;
  limit?: number;
  pattern?: string;
  sortBy?: "name" | "timestamp";
  sortOrder?: "asc" | "desc";
}

/**
 * Result of a list operation
 */
export type ListResult =
  | {
    success: true;
    data: ListItem[];
    pagination: {
      page: number;
      limit: number;
      total?: number;
    };
  }
  | {
    success: false;
    error: string;
  };

/**
 * Health status response
 */
export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Validation function for write operations
 * Returns an object with valid boolean and optional error message
 */
export type ValidationFn = (write: {
  uri: string;
  value: unknown;
  read: <T = unknown>(uri: string) => Promise<ReadResult<T>>;
}) => Promise<{ valid: boolean; error?: string }>;

/**
 * Schema mapping program keys to validation functions
 */
export type Schema = Record<string, ValidationFn>;

/**
 * Result of a receive operation
 */
export interface ReceiveResult {
  accepted: boolean;
  error?: string;
}

/**
 * Message type — the minimal primitive: [uri, data]
 */
export type Message<D = unknown> = [uri: string, data: D];

/** @deprecated Use `Message` instead */
export type Transaction<D = unknown> = Message<D>;

/**
 * NodeProtocolInterface - The universal interface implemented by all clients
 *
 * All B3nd clients (Memory, HTTP, WebSocket, Postgres, IndexedDB, etc.)
 * implement this interface, enabling recursive composition and uniform usage.
 */
export interface NodeProtocolWriteInterface {
  /** Receive a message - the unified entry point for all state changes */
  receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult>;
  /** Delete data at a URI */
  delete(uri: string): Promise<DeleteResult>;
  /** Health status */
  health(): Promise<HealthStatus>;
  /** Supported program keys */
  getSchema(): Promise<string[]>;
  /** Cleanup resources */
  cleanup(): Promise<void>;
}

export interface NodeProtocolReadInterface {
  /** Read data from a URI */
  read<T = unknown>(uri: string): Promise<ReadResult<T>>;
  /**
   * Read multiple URIs in a single operation.
   * Implementations may optimize for batch reads (e.g., SQL IN clause).
   * @param uris - Array of URIs to read (max 50)
   * @returns ReadMultiResult with per-URI results and summary
   */
  readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>>;
  /** List items at a URI path */
  list(uri: string, options?: ListOptions): Promise<ListResult>;
  /**
   * Query records under a URI prefix with structured filters, sorting, and projection.
   * Backends translate the query descriptor into their native form.
   * Optional — clients that don't support it return { success: false, error: "query not supported" }.
   */
  query?<T = unknown>(options: QueryOptions): Promise<QueryResult<T>>;
  /** Health status */
  health(): Promise<HealthStatus>;
  /** Supported program keys */
  getSchema(): Promise<string[]>;
  /** Cleanup resources */
  cleanup(): Promise<void>;
}

// Backward-compatible alias for existing clients and tests
export type NodeProtocolInterface =
  & NodeProtocolWriteInterface
  & NodeProtocolReadInterface;

/**
 * Configuration for MemoryClient
 */
export interface MemoryClientConfig {
  /**
   * Schema definition for the client
   */
  schema?: Schema;

  /**
   * Optional pre-existing storage
   */
  storage?: Map<string, unknown>;
}

/**
 * Configuration for HttpClient
 */
export interface HttpClientConfig {
  /**
   * Base URL of the HTTP API
   */
  url: string;

  /**
   * Optional custom headers
   */
  headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds (default: 30000)
   */
  timeout?: number;
}

/**
 * Configuration for WebSocketClient
 */
export interface WebSocketClientConfig {
  /**
   * WebSocket server URL
   */
  url: string;

  /**
   * Optional authentication configuration
   */
  auth?: {
    type: "bearer" | "basic" | "custom";
    token?: string;
    username?: string;
    password?: string;
    custom?: Record<string, unknown>;
  };

  /**
   * Optional reconnection configuration
   */
  reconnect?: {
    enabled: boolean;
    maxAttempts?: number;
    interval?: number;
    backoff?: "linear" | "exponential";
  };

  /**
   * Request timeout in milliseconds (default: 30000)
   */
  timeout?: number;
}

/**
 * Configuration for LocalStorageClient
 */
export interface LocalStorageClientConfig {
  /**
   * Optional prefix for localStorage keys to avoid collisions
   */
  keyPrefix?: string;

  /**
   * Optional schema for validation (like MemoryClient)
   */
  schema?: Schema;

  /**
   * Optional serialization functions
   */
  serializer?: {
    serialize?: (data: unknown) => string;
    deserialize?: (data: string) => unknown;
  };

  /**
   * Optional injectable storage dependency (defaults to global localStorage)
   */
  storage?: Storage;
}

/**
 * Configuration for IndexedDBClient
 */
export interface IndexedDBClientConfig {
  /**
   * Database name
   */
  databaseName?: string;

  /**
   * Object store name
   */
  storeName?: string;

  /**
   * Database version
   */
  version?: number;

  /**
   * Optional schema for validation
   */
  schema?: Schema;

  /**
   * Optional injectable indexedDB dependency (defaults to global indexedDB)
   */
  // deno-lint-ignore no-explicit-any
  indexedDB?: any;
}

/**
 * Configuration for PostgresClient
 */
export interface PostgresClientConfig {
  /**
   * PostgreSQL connection string or configuration
   * Examples:
   *   - "postgresql://user:password@localhost:5432/database"
   *   - { host: "localhost", port: 5432, database: "mydb", user: "user", password: "pass" }
   */
  connection: string | {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean | object;
  };

  /**
   * Schema for validation - must be explicitly provided
   */
  schema: Schema;

  /**
   * Table name prefix for b3nd data - must be explicitly provided
   */
  tablePrefix: string;

  /**
   * Connection pool size - must be explicitly provided
   */
  poolSize: number;

  /**
   * Connection timeout in milliseconds - must be explicitly provided
   */
  connectionTimeout: number;
}

/**
 * Configuration for MongoClient
 */
export interface MongoClientConfig {
  /**
   * MongoDB connection string
   * Example: "mongodb://user:password@localhost:27017/database"
   */
  connectionString: string;

  /**
   * Schema for validation - must be explicitly provided
   */
  schema: Schema;

  /**
   * Collection name for b3nd data - must be explicitly provided
   */
  collectionName: string;
}

/**
 * Error class for client operations
 * Preserves error context without hiding details
 */
export class ClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

/**
 * Link value - just a string URI pointing to another resource
 */
export type LinkValue = string;

/**
 * Content-addressed data metadata (optional wrapper for hash:// data)
 */
export interface ContentData<T = unknown> {
  type?: string;
  encoding?: string;
  data: T;
}


/**
 * Advanced query types for structured data queries
 *
 * Provides a portable query descriptor that backends translate into
 * their native form (SQL for Postgres, query operators for Mongo,
 * JS filter/sort for in-memory).
 */

/**
 * A single comparison condition on a data field.
 * Supports nested paths via dot notation (e.g., "address.city").
 */
export type WhereCondition =
  | { field: string; op: "eq"; value: unknown }
  | { field: string; op: "neq"; value: unknown }
  | { field: string; op: "gt"; value: unknown }
  | { field: string; op: "gte"; value: unknown }
  | { field: string; op: "lt"; value: unknown }
  | { field: string; op: "lte"; value: unknown }
  | { field: string; op: "in"; value: unknown[] }
  | { field: string; op: "contains"; value: string }
  | { field: string; op: "startsWith"; value: string }
  | { field: string; op: "endsWith"; value: string }
  | { field: string; op: "exists"; value: boolean };

/**
 * Recursive WHERE clause combining conditions with logical operators.
 */
export type WhereClause =
  | WhereCondition
  | { and: WhereClause[] }
  | { or: WhereClause[] }
  | { not: WhereClause };

/**
 * Mode 1 — Portable DSL query: filter/sort/project using the structured descriptor.
 */
export interface PortableQueryOptions {
  /** URI prefix to scope the query (required) */
  prefix: string;

  /** Filter records by data field values */
  where?: WhereClause;

  /** Select specific fields from data (projection). Omit to return all fields. */
  select?: string[];

  /** Sort by data fields */
  orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;

  /** Maximum number of records to return (default: 50) */
  limit?: number;

  /** Number of records to skip (default: 0) */
  offset?: number;
}

/**
 * Mode 2 — Native passthrough: send the backend's own query language directly.
 *
 * The node enforces `prefix` scoping but otherwise passes `native` through as-is.
 *
 * @example MongoDB native query
 * ```typescript
 * await client.query({
 *   prefix: "store://users",
 *   native: {
 *     filter: { age: { $gte: 18 }, "address.city": "NYC" },
 *     sort: { age: -1 },
 *     projection: { name: 1, email: 1 },
 *     limit: 10,
 *   },
 * });
 * ```
 *
 * @example PostgreSQL native query (WHERE-clause fragment)
 * ```typescript
 * await client.query({
 *   prefix: "store://users",
 *   native: {
 *     sql: "data->>'role' = $1 AND (data->>'age')::int > $2",
 *     params: ["admin", 25],
 *     orderBy: "data->>'name' ASC",
 *     limit: 10,
 *   },
 * });
 * ```
 */
export interface NativeQueryOptions {
  /** URI prefix to scope the query (required) */
  prefix: string;

  /** Backend-specific query descriptor, passed through as-is */
  native: unknown;
}

/**
 * Mode 3 — Stored query: execute a pre-defined query by URI reference.
 *
 * The stored query is itself a b3nd record that contains the native query
 * template and parameter definitions. The node reads it, substitutes the
 * args, and executes the resolved query.
 *
 * @example
 * ```typescript
 * // Node operator stored this query at mutable://queries/users-by-city
 * // App developer runs it:
 * await client.query({
 *   ref: "mutable://queries/users-by-city",
 *   args: { city: "NYC" },
 * });
 * ```
 */
export interface StoredQueryOptions {
  /** URI of the stored query definition */
  ref: string;

  /** Arguments to substitute into the stored query template */
  args?: Record<string, unknown>;
}

/**
 * Stored query definition — the shape of the b3nd record at the `ref` URI.
 */
export interface StoredQueryDefinition {
  /** Human-readable description */
  description?: string;

  /** URI prefix for scoping (can be overridden by args) */
  prefix: string;

  /** The native query template with $paramName placeholders */
  native: unknown;

  /** Parameter declarations */
  params?: Record<string, {
    type?: "string" | "number" | "boolean";
    required?: boolean;
    default?: unknown;
  }>;
}

/**
 * Union of all query modes.
 * Discriminated by the presence of `native`, `ref`, or `where`/plain prefix.
 */
export type QueryOptions =
  | PortableQueryOptions
  | NativeQueryOptions
  | StoredQueryOptions;

/**
 * A single record in a query result
 */
export interface QueryRecord<T = unknown> {
  uri: string;
  data: T;
  ts: number;
}

/**
 * Result of a query operation
 */
export type QueryResult<T = unknown> =
  | {
      success: true;
      records: QueryRecord<T>[];
      total?: number;
    }
  | {
      success: false;
      error: string;
    };

/**
 * WebSocket protocol types for request/response communication
 */
export interface WebSocketRequest {
  id: string;
  type:
    | "receive"
    | "read"
    | "readMulti"
    | "list"
    | "query"
    | "delete"
    | "health"
    | "getSchema";
  payload: unknown;
}

export interface WebSocketResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

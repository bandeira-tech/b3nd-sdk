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
  errorDetail?: B3ndError;
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
  errorDetail?: B3ndError;
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
  message?: unknown;
}) => Promise<{ valid: boolean; error?: string }>;

/**
 * Schema mapping program keys to validation functions
 */
export type Schema = Record<string, ValidationFn>;

/**
 * Result of a receive operation.
 * `error` remains a string for backward compatibility.
 * `errorDetail` provides structured error info for programmatic handling.
 */
export interface ReceiveResult {
  accepted: boolean;
  error?: string;
  errorDetail?: B3ndError;
}

/**
 * Message type — the minimal primitive: [uri, data]
 */
export type Message<D = unknown> = [uri: string, data: D];

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

/** Operations that can be filtered by `accepts()`. */
export type ClientOperation = "receive" | "read" | "list" | "delete";

/**
 * Optional per-operation URI acceptance.
 *
 * Clients can declare which URIs they handle for each operation.
 * The rig uses this to route — only forwarding operations to clients
 * that accept the URI. Clients without `accepts` accept everything.
 *
 * @example
 * ```ts
 * // A read-only cache
 * client.accepts("read", "mutable://app/users/alice")   // true
 * client.accepts("receive", "mutable://app/users/alice") // false
 *
 * // A write-only event sink
 * client.accepts("receive", "rig://event/foo")  // true
 * client.accepts("read", "rig://event/foo")     // false
 * ```
 */
export interface ClientAccepts {
  accepts(operation: ClientOperation, uri: string): boolean;
}

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
 * Configuration for FilesystemClient
 */
export interface FsClientConfig {
  /**
   * Root directory for data storage
   * All URI paths are stored relative to this root
   */
  rootDir: string;

  /**
   * Schema for validation - must be explicitly provided
   */
  schema: Schema;
}

/**
 * Configuration for SqliteClient
 */
export interface SqliteClientConfig {
  /**
   * Path to the SQLite database file, or ":memory:" for in-memory databases
   * Example: "/data/b3nd.db" or ":memory:"
   */
  path: string;

  /**
   * Schema for validation - must be explicitly provided
   */
  schema: Schema;

  /**
   * Table name prefix for b3nd data tables
   * Must start with a letter and contain only letters, numbers, and underscores
   */
  tablePrefix: string;
}

/**
 * Structured error codes for programmatic error handling.
 * Callers can switch on `error.code` without string parsing.
 */
export enum ErrorCode {
  // Auth errors
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  // Validation errors
  INVALID_URI = "INVALID_URI",
  INVALID_SCHEMA = "INVALID_SCHEMA",
  INVALID_SEQUENCE = "INVALID_SEQUENCE",
  // State errors
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  // Internal errors
  STORAGE_ERROR = "STORAGE_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Structured error returned by protocol operations.
 */
export interface B3ndError {
  code: ErrorCode;
  message: string;
  uri?: string;
  details?: unknown;
}

/**
 * Convenience constructors for B3ndError
 */
export const Errors = {
  unauthorized: (uri: string, msg?: string): B3ndError => ({
    code: ErrorCode.UNAUTHORIZED,
    message: msg ?? "Unauthorized",
    uri,
  }),
  forbidden: (uri: string, msg?: string): B3ndError => ({
    code: ErrorCode.FORBIDDEN,
    message: msg ?? "Forbidden",
    uri,
  }),
  invalidUri: (uri: string, msg?: string): B3ndError => ({
    code: ErrorCode.INVALID_URI,
    message: msg ?? "Invalid URI",
    uri,
  }),
  invalidSchema: (uri: string, details?: unknown): B3ndError => ({
    code: ErrorCode.INVALID_SCHEMA,
    message: "Schema validation failed",
    uri,
    details,
  }),
  invalidSequence: (uri: string, msg?: string): B3ndError => ({
    code: ErrorCode.INVALID_SEQUENCE,
    message: msg ?? "Invalid sequence number",
    uri,
  }),
  notFound: (uri: string): B3ndError => ({
    code: ErrorCode.NOT_FOUND,
    message: `Not found: ${uri}`,
    uri,
  }),
  conflict: (uri: string, msg?: string): B3ndError => ({
    code: ErrorCode.CONFLICT,
    message: msg ?? "Conflict",
    uri,
  }),
  storageError: (msg: string, uri?: string): B3ndError => ({
    code: ErrorCode.STORAGE_ERROR,
    message: msg,
    uri,
  }),
  internal: (msg: string, uri?: string): B3ndError => ({
    code: ErrorCode.INTERNAL_ERROR,
    message: msg,
    uri,
  }),
};

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
 * WebSocket protocol types for request/response communication
 */
export interface WebSocketRequest {
  id: string;
  type:
    | "receive"
    | "read"
    | "readMulti"
    | "list"
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

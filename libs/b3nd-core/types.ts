/**
 * @b3nd/sdk Types
 * Core types for the universal B3nd protocol interface
 */

/**
 * Persistence record — values + data.
 * Values are conserved quantities (Record<string, number>).
 * Data is the stored content.
 */
export interface PersistenceRecord<T = unknown> {
  values: Record<string, number>;
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
 * Result of a read operation.
 * `uri` is present when the result comes from a list (trailing-slash read).
 */
export interface ReadResult<T> {
  success: boolean;
  uri?: string;
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
 * Status response — replaces health() + getSchema().
 * Each client reports its health + capabilities.
 * The rig aggregates and adds schema info.
 */
export interface StatusResult {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  schema?: string[];
  details?: Record<string, unknown>;
}

/**
 * Output — the universal addressed-content primitive: [uri, values, data]
 *
 * - uri: identity/address
 * - values: conserved quantities ({} for none, always present)
 * - data: always { inputs: string[], outputs: Output[] }
 */
export type Output<T = unknown> = [
  uri: string,
  values: Record<string, number>,
  data: T,
];

/**
 * Message — alias for Output. A message is an addressed output.
 */
export type Message<D = unknown> = Output<D>;

/**
 * Read function for storage lookups.
 * Single-URI convenience — returns first result from read().
 */
export type ReadFn = <T = unknown>(uri: string) => Promise<ReadResult<T>>;

/**
 * Receive function — batch of messages through the rig pipeline.
 */
export type ReceiveFn = (msgs: Message[]) => Promise<ReceiveResult[]>;

// ── Program model ───────────────────────────────────────────────────

/**
 * Program result — classification of a message by a program.
 * Programs return protocol-defined codes, not binary valid/invalid.
 */
export interface ProgramResult {
  code: string;
  error?: string;
}

/**
 * Program — classifies a message and returns a protocol-defined code.
 *
 * - `output`   — the [uri, values, data] being classified
 * - `upstream` — the parent output (undefined at top level)
 * - `read`     — storage lookup (only confirmed state)
 * - `receive`  — the rig's full receive pipeline (for recursive sub-messages)
 */
export type Program<T = unknown> = (
  output: Output<T>,
  upstream: Output | undefined,
  read: ReadFn,
  receive: ReceiveFn,
) => Promise<ProgramResult>;

/**
 * Code handler — what to do when a program returns a specific code.
 * Handlers get broadcast (direct to clients, bypasses programs) and read.
 *
 * - `message`   — the classified message
 * - `broadcast` — direct dispatch to clients (trusted, no re-validation)
 * - `read`      — storage lookup (confirmed state)
 */
export type CodeHandler = (
  message: Message,
  broadcast: ReceiveFn,
  read: ReadFn,
) => Promise<void>;

// ── Deprecated validation types (transitional) ─────────────────────

/**
 * @deprecated Use ProgramResult instead.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * @deprecated Use Program instead.
 */
export type Validator<T = unknown> = (
  output: Output<T>,
  upstream: Output | undefined,
  read: ReadFn,
) => Promise<ValidationResult>;

/**
 * @deprecated Use Record<string, Program> instead.
 */
export type Schema = Record<string, Validator>;

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
 * NodeProtocolInterface — the universal interface implemented by all clients.
 *
 * Four primitives:
 * - `receive` — all state changes (writes)
 * - `read`    — all queries (single, multi, list via trailing slash)
 * - `observe` — stream of changes matching a pattern (client handles transport)
 * - `status`  — health + capabilities
 *
 * All B3nd clients (Memory, HTTP, WebSocket, Postgres, IndexedDB, etc.)
 * implement this interface, enabling recursive composition and uniform usage.
 */
export interface NodeProtocolInterface {
  /**
   * Receive a batch of messages — the unified entry point for all state changes.
   *
   * Each message is [uri, values, data] where data is { inputs, outputs }.
   * Clients are mechanical: delete inputs, write outputs for each message.
   * Returns one ReceiveResult per message.
   */
  receive(msgs: Message[]): Promise<ReceiveResult[]>;

  /**
   * Read data from one or more URIs.
   *
   * - Single URI: `read("mutable://open/users/alice")` → one result
   * - Multiple URIs: `read(["mutable://x", "hash://y"])` → batch results
   * - Trailing slash: `read("mutable://open/users/")` → list all under path
   *
   * Always returns an array of results, one per resolved URI.
   */
  read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]>;

  /**
   * Observe changes matching a URI pattern.
   *
   * Returns an async iterable that yields `ReadResult` items as changes
   * arrive. The client handles the transport — SSE for HTTP, internal
   * events for memory, LISTEN/NOTIFY for Postgres, etc.
   *
   * The `signal` controls lifecycle — abort to stop observing.
   *
   * @example
   * ```ts
   * const abort = new AbortController();
   * for await (const result of client.observe("mutable://market/*", abort.signal)) {
   *   console.log(result.uri, result.record.data);
   * }
   * ```
   */
  observe<T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>>;

  /**
   * Status — health + capabilities.
   * Clients report health. The rig aggregates and adds schema.
   */
  status(): Promise<StatusResult>;
}

// ── Deprecated interfaces (transitional) ──

/** @deprecated Use NodeProtocolInterface directly */
export type NodeProtocolWriteInterface = NodeProtocolInterface;
/** @deprecated Use NodeProtocolInterface directly */
export type NodeProtocolReadInterface = NodeProtocolInterface;

/** Operations that can be filtered by `accepts()`. */
export type ClientOperation = "receive" | "read" | "observe";

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
   * Table name prefix for b3nd data tables
   * Must start with a letter and contain only letters, numbers, and underscores
   */
  tablePrefix: string;
}

/**
 * Configuration for S3Client
 */
export interface S3ClientConfig {
  /**
   * S3 bucket name
   */
  bucket: string;

  /**
   * Optional key prefix for all objects (e.g., "b3nd/" or "prod/data/")
   * Must end with "/" if provided.
   */
  prefix?: string;
}

/**
 * Configuration for ConsoleClient
 */
export interface ConsoleClientConfig {
  /**
   * Optional label prefix for console output (default: "b3nd")
   */
  label?: string;

  /**
   * Optional custom logger (defaults to console.log)
   */
  logger?: (message: string) => void;
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
    | "status";
  payload: unknown;
}

export interface WebSocketResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

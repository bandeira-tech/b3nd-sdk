/**
 * @b3nd/sdk Types
 * Core types for the universal B3nd protocol interface
 */

/**
 * Result of a write operation
 */
export interface WriteResult<T = unknown> {
  success: boolean;
  record?: { values: Record<string, number>; data: T };
  error?: string;
}

/**
 * Result of a read operation.
 * `uri` is present when the result comes from a list (trailing-slash read).
 */
export interface ReadResult<T> {
  success: boolean;
  uri?: string;
  record?: { values: Record<string, number>; data: T };
  error?: string;
  errorDetail?: B3ndError;
}

/**
 * Result for a single URI in a multi-read operation
 */
export type ReadMultiResultItem<T = unknown> =
  | {
    uri: string;
    success: true;
    record: { values: Record<string, number>; data: T };
  }
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
 * Programs are pure classifiers with no side effects. A protocol ships its
 * own programs as a closed package — sub-output classification is handled
 * internally by the protocol, not by calling back into the rig.
 *
 * - `output`   — the [uri, values, data] being classified
 * - `upstream` — the parent output (undefined at top level)
 * - `read`     — storage lookup (only confirmed state)
 */
export type Program<T = unknown> = (
  output: Output<T>,
  upstream: Output | undefined,
  read: ReadFn,
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

// ── Store — batch-native storage primitive ────────────────────────

/**
 * Entry for a batch write operation.
 *
 * @example
 * ```typescript
 * await store.write([
 *   { uri: "mutable://users/alice", values: {}, data: { name: "Alice" } },
 *   { uri: "mutable://users/bob", values: {}, data: { name: "Bob" } },
 * ]);
 * ```
 */
export interface StoreEntry<T = unknown> {
  uri: string;
  values: Record<string, number>;
  data: T;
}

/**
 * Per-entry result of a write operation.
 */
export interface StoreWriteResult {
  success: boolean;
  error?: string;
}

/**
 * Optional capability reporting for a Store.
 *
 * Backends declare what they can do so protocol clients and rigs
 * can make informed decisions (e.g., wrap deletes+writes in a
 * transaction when atomicBatch is true).
 */
export interface StoreCapabilities {
  /** Whether write+delete within a single call can be made atomic. */
  atomicBatch?: boolean;
  /** Whether this store supports observe(). */
  observe?: boolean;
  /** Whether this store can handle binary (Uint8Array) data natively. */
  binaryData?: boolean;
}

/**
 * Store — the batch-native storage abstraction.
 *
 * Every operation takes arrays and returns per-item results.
 * This lets each backend optimize for its technology:
 * Postgres → single multi-row INSERT, S3 → parallel PutObject, etc.
 *
 * The Store knows nothing about protocols, envelopes, or message
 * semantics. It is pure mechanical storage: write entries, read
 * entries, delete entries, observe changes.
 *
 * Protocol clients (SimpleClient, FirecatDataClient) wrap a Store
 * with protocol semantics to produce a NodeProtocolInterface.
 *
 * @example
 * ```typescript
 * const store = new MemoryStore();
 *
 * // Write
 * await store.write([
 *   { uri: "mutable://app/config", values: {}, data: { theme: "dark" } },
 * ]);
 *
 * // Read
 * const results = await store.read(["mutable://app/config"]);
 *
 * // Delete
 * await store.delete(["mutable://app/config"]);
 * ```
 */
export interface Store {
  /**
   * Write entries in batch. Returns one result per entry.
   */
  write(entries: StoreEntry[]): Promise<StoreWriteResult[]>;

  /**
   * Read data from URIs in batch. Returns one result per URI.
   *
   * Trailing-slash URIs list all entries under that path prefix —
   * the result array may contain multiple items for a single input URI.
   */
  read<T = unknown>(uris: string[]): Promise<ReadResult<T>[]>;

  /**
   * Delete URIs in batch. Returns one result per URI.
   */
  delete(uris: string[]): Promise<DeleteResult[]>;

  /**
   * Observe changes matching a URI pattern.
   *
   * Not all backends can observe natively (e.g., S3).
   * Check `capabilities().observe` before calling.
   *
   * @example
   * ```typescript
   * const ac = new AbortController();
   * for await (const result of store.observe("mutable://app/*", ac.signal)) {
   *   console.log(result.uri, result.record?.data);
   * }
   * ```
   */
  observe?<T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>>;

  /**
   * Health and capability status.
   */
  status(): Promise<StatusResult>;

  /**
   * Optional capability reporting.
   */
  capabilities?(): StoreCapabilities;
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

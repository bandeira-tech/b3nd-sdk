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
export interface ReadResult<T = unknown> {
  success: boolean;
  record?: PersistenceRecord<T>;
  error?: string;
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
  type: "file" | "directory";
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
export interface ListResult {
  data: ListItem[];
  pagination: {
    page: number;
    limit: number;
    total?: number;
  };
}

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
}) => Promise<{ valid: boolean; error?: string }>;

/**
 * Schema mapping program keys to validation functions
 */
export type Schema = Record<string, ValidationFn>;

/**
 * NodeProtocolInterface - The universal interface implemented by all clients
 *
 * All B3nd clients (Memory, HTTP, WebSocket, Postgres, IndexedDB, etc.)
 * implement this interface, enabling recursive composition and uniform usage.
 */
export interface NodeProtocolInterface {
  /**
   * Write data to a URI
   * @param uri - The URI to write to (e.g., "users://alice/profile")
   * @param value - The data to write
   * @returns Promise resolving to WriteResult with success status and record
   */
  write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>>;

  /**
   * Read data from a URI
   * @param uri - The URI to read from
   * @returns Promise resolving to ReadResult with success status and record
   */
  read<T = unknown>(uri: string): Promise<ReadResult<T>>;

  /**
   * List items at a URI path
   * @param uri - The URI path to list
   * @param options - Optional pagination and filtering options
   * @returns Promise resolving to ListResult with items and pagination info
   */
  list(uri: string, options?: ListOptions): Promise<ListResult>;

  /**
   * Delete data at a URI
   * @param uri - The URI to delete
   * @returns Promise resolving to DeleteResult with success status
   */
  delete(uri: string): Promise<DeleteResult>;

  /**
   * Get health status of this client
   * @returns Promise resolving to HealthStatus
   */
  health(): Promise<HealthStatus>;

  /**
   * Get schema information (program keys) supported by this client
   * @returns Promise resolving to array of program keys (e.g., ["users://", "posts://"])
   */
  getSchema(): Promise<string[]>;

  /**
   * Cleanup resources and close connections
   */
  cleanup(): Promise<void>;
}

/**
 * Configuration for MemoryClient
 */
export interface MemoryClientConfig {
  /**
   * Schema mapping program keys to validation functions
   * Each key represents a program (e.g., "users://", "cache://")
   * and maps to a validation function that accepts or rejects writes
   */
  schema: Schema;
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
   * Optional instance ID for multi-instance APIs
   */
  instanceId?: string;

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
 * WebSocket protocol types for request/response communication
 */
export interface WebSocketRequest {
  id: string;
  type: "write" | "read" | "list" | "delete" | "health" | "getSchema";
  payload: unknown;
}

export interface WebSocketResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

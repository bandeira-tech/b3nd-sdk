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
export interface NodeProtocolWriteInterface {
  /** Write data to a URI */
  write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>>;
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

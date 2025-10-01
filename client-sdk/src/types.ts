/**
 * Client SDK Types
 * Common types used across different backend adapters
 */

export interface PersistenceRecord<T = unknown> {
  ts: number;
  data: T;
}

export interface WriteResult<T = unknown> {
  success: boolean;
  record?: PersistenceRecord<T>;
  error?: string;
}

export interface ReadResult<T = unknown> {
  success: boolean;
  record?: PersistenceRecord<T>;
  error?: string;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export interface ListItem {
  uri: string;  // Primary identifier (e.g., "users://alice/profile")
  type: "file" | "directory";
  // name removed - redundant with uri
  // ts removed - available via separate read operation
}

export interface ListOptions {
  page?: number;
  limit?: number;
  pattern?: string;
  sortBy?: "name" | "timestamp";
  sortOrder?: "asc" | "desc";
}

export interface ListResult {
  data: ListItem[];
  pagination: {
    page: number;
    limit: number;
  };
}

/**
 * Base client configuration
 */
export interface ClientConfig {
  /**
   * Type of backend (http, websocket, local)
   */
  type: "http" | "websocket" | "local";

  /**
   * Backend-specific options
   */
  options?: Record<string, unknown>;
}

/**
 * HTTP backend configuration
 */
export interface HttpClientConfig extends ClientConfig {
  type: "http";
  baseUrl: string;
  instanceId?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * WebSocket backend configuration
 */
export interface WebSocketClientConfig extends ClientConfig {
  type: "websocket";
  url: string;
  auth?: {
    type: "bearer" | "basic" | "custom";
    token?: string;
    username?: string;
    password?: string;
    custom?: Record<string, unknown>;
  };
  reconnect?: {
    enabled: boolean;
    maxAttempts?: number;
    interval?: number;
    backoff?: "linear" | "exponential";
  };
  timeout?: number;
}

/**
 * Local backend configuration
 */
export interface LocalClientConfig extends ClientConfig {
  type: "local";
  persistence: any; // Reference to a Persistence instance
}

/**
 * Client interface that all backend implementations must conform to
 */
export interface B3ndClient {
  /**
   * Write data to a URI
   */
  write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>>;

  /**
   * Read data from a URI
   */
  read<T = unknown>(uri: string): Promise<ReadResult<T>>;

  /**
   * List items at a path
   */
  list(uri: string, options?: ListOptions): Promise<ListResult>;

  /**
   * Delete data at a URI
   */
  delete(uri: string): Promise<DeleteResult>;

  /**
   * Get client health status
   */
  health(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
  }>;

  /**
   * Get schema information for this client instance
   */
  getSchema(): Promise<string[]>;

  /**
   * Cleanup/disconnect
   */
  cleanup(): Promise<void>;
}

/**
 * Request/Response types for WebSocket protocol
 */
export interface WebSocketRequest {
  id: string;
  type: "write" | "read" | "list" | "delete" | "health";
  payload: unknown;
}

export interface WebSocketResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Error thrown by client operations
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
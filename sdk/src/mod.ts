/**
 * @b3nd/sdk
 *
 * Universal B3nd persistence interface for all platforms
 */

// Core types
export type {
  ClientError,
  DeleteResult,
  HealthStatus,
  HttpClientConfig,
  IndexedDBClientConfig,
  ListItem,
  ListOptions,
  ListResult,
  LocalStorageClientConfig,
  MemoryClientConfig,
  NodeProtocolInterface,
  PersistenceRecord,
  PostgresClientConfig,
  ReadResult,
  Schema,
  ValidationFn,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "./types.ts";

// Client implementations
export { MemoryClient } from "./memory-client.ts";
export { HttpClient } from "./http-client.ts";
export { WebSocketClient } from "./websocket-client.ts";
export { LocalStorageClient } from "./local-storage-client.ts";
export { IndexedDBClient } from "./indexed-db-client.ts";
export { PostgresClient } from "./postgres-client.ts";

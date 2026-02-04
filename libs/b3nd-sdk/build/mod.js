/**
 * @b3nd/sdk
 *
 * Universal B3nd persistence interface for all platforms
 */

// Core types
export {
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
  ReadResult,
  Schema,
  ValidationFn,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "./types.js";

// Client implementations
export { MemoryClient } from "./memory-client.js";
export { HttpClient } from "./http-client.js";
export { WebSocketClient } from "./websocket-client.js";
export { LocalStorageClient } from "./local-storage-client.js";
export { IndexedDBClient } from "./indexed-db-client.js";

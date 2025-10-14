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
export { MemoryClient } from "../clients/memory/mod.ts";
export { HttpClient } from "../clients/http/mod.ts";
export { WebSocketClient } from "../clients/websocket/mod.ts";
export { LocalStorageClient } from "../clients/local-storage/mod.ts";
export { IndexedDBClient } from "../clients/indexed-db/mod.ts";
export { PostgresClient } from "../clients/postgres/mod.ts";

// PostgreSQL schema utilities
export {
  extractSchemaVersion,
  generateCompleteSchemaSQL,
  generatePostgresSchema,
  type SchemaInitOptions,
} from "../clients/postgres/schema.ts";

// Combinators
export { parallelBroadcast } from "../clients/combinators/parallel-broadcast.ts";
export { firstMatchSequence } from "../clients/combinators/first-match-sequence.ts";

// Server primitives
export { createServerNode } from "../servers/node.ts";
export * as servers from "../servers/http.ts";
export * as wsservers from "../servers/websocket.ts";

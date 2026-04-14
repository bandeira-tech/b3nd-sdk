/**
 * @module
 * Universal B3nd persistence SDK for all platforms.
 *
 * Provides URI-based data addressing with multiple backend support,
 * encryption, and schema validation.
 *
 * @example Basic usage with MemoryClient
 * ```typescript
 * import { MemoryClient } from "@bandeira-tech/b3nd-sdk";
 *
 * const client = new MemoryClient();
 *
 * // Receive a message (the unified interface for all state changes)
 * await client.receive([["mutable://users/alice", {}, { name: "Alice", age: 30 }]]);
 *
 * // Read data
 * const results = await client.read("mutable://users/alice");
 * console.log(results[0]?.record?.data); // { name: "Alice", age: 30 }
 *
 * // List items (trailing slash)
 * const list = await client.read("mutable://users/");
 * console.log(list.map(r => r.uri)); // ["mutable://users/alice"]
 * ```
 *
 * @example Using HttpClient with a remote backend
 * ```typescript
 * import { HttpClient } from "@bandeira-tech/b3nd-sdk";
 *
 * const client = new HttpClient({ url: "https://api.example.com" });
 *
 * // Same interface as MemoryClient
 * await client.receive([["mutable://data/key", {}, { value: 123 }]]);
 * const result = await client.read("mutable://data/key");
 * ```
 *
 * @example Schema validation
 * ```typescript
 * import { MemoryClient } from "@bandeira-tech/b3nd-sdk";
 *
 * const client = new MemoryClient({
 *   schema: {
 *     "mutable://users": async (uri, data) => {
 *       if (!data?.name) return { valid: false, error: "name required" };
 *       return { valid: true };
 *     },
 *   },
 * });
 * ```
 */

// Core types
export type {
  B3ndError,
  ClientError,
  ConsoleClientConfig,
  DeleteResult,
  FsClientConfig,
  HealthStatus,
  HttpClientConfig,
  IndexedDBClientConfig,
  ListItem,
  ListOptions,
  ListResult,
  LocalStorageClientConfig,
  MemoryClientConfig,
  MongoClientConfig,
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  Output,
  PostgresClientConfig,
  ReadFn,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  S3ClientConfig,
  Schema,
  SqliteClientConfig,
  StatusResult,
  Store,
  StoreCapabilities,
  StoreEntry,
  StoreWriteResult,
  ValidationResult,
  Validator,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "../libs/b3nd-core/types.ts";
export { ErrorCode, Errors } from "../libs/b3nd-core/types.ts";

// Store implementations
export { MemoryStore } from "../libs/b3nd-client-memory/store.ts";

// Protocol clients (Store → NodeProtocolInterface)
export { SimpleClient } from "../libs/b3nd-core/simple-client.ts";

// Client implementations
export { MemoryClient } from "../libs/b3nd-client-memory/mod.ts";
export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { PostgresClient } from "../libs/b3nd-client-postgres/mod.ts";
export { MongoClient } from "../libs/b3nd-client-mongo/mod.ts";
export { SqliteClient } from "../libs/b3nd-client-sqlite/mod.ts";
export { FilesystemClient } from "../libs/b3nd-client-fs/mod.ts";
export { ConsoleClient } from "../libs/b3nd-client-console/mod.ts";
export { S3Client } from "../libs/b3nd-client-s3/mod.ts";
export type { S3Executor } from "../libs/b3nd-client-s3/mod.ts";
export { ElasticsearchClient } from "../libs/b3nd-client-elasticsearch/mod.ts";
export type {
  ElasticsearchClientConfig,
  ElasticsearchExecutor,
} from "../libs/b3nd-client-elasticsearch/mod.ts";
// Note: LocalStorageClient and IndexedDBClient are browser-only
// and not included in the JSR package. Use the npm package for browser support.

// PostgreSQL schema utilities
export {
  extractSchemaVersion,
  generateCompleteSchemaSQL,
  generatePostgresSchema,
  type SchemaInitOptions,
} from "../libs/b3nd-client-postgres/schema.ts";

// SQLite schema utilities
export { generateSqliteSchema } from "../libs/b3nd-client-sqlite/schema.ts";

// Combinators
export {
  firstMatchSequence,
  parallelBroadcast,
} from "../libs/b3nd-combinators/mod.ts";

// Crypto utilities
export { pemToCryptoKey } from "../libs/b3nd-encrypt/mod.ts";
export { deriveObfuscatedPath } from "../libs/b3nd-encrypt/utils.ts";

// FunctionalClient (new primary pattern)
export { FunctionalClient } from "../libs/b3nd-core/functional-client.ts";
export type { FunctionalClientConfig } from "../libs/b3nd-core/functional-client.ts";

// Validated client convenience
export { createValidatedClient } from "../libs/b3nd-compose/validated-client.ts";

// Unified Node system (deprecated — use createValidatedClient instead)
export { createNode } from "../libs/b3nd-compose/mod.ts";
export type {
  Node,
  NodeConfig,
  Processor,
  ReadInterface,
} from "../libs/b3nd-compose/mod.ts";
export {
  // Built-in validators
  accept,
  // Composition utilities
  all,
  any,
  // Built-in processors
  emit,
  firstMatch,
  format,
  log,
  // Message schema validator (new name)
  msgSchema,
  noop,
  parallel,
  pipeline,
  reject,
  requireFields,
  schema as schemaValidator,
  seq,
  uriPattern,
  when,
} from "../libs/b3nd-compose/mod.ts";

// Message layer (new names)
export { createMessageNode } from "../libs/b3nd-msg/node-mod.ts";
export type {
  MessageNode,
  MessageNodeConfig,
  MessageValidator,
  SubmitResult,
} from "../libs/b3nd-msg/node-mod.ts";

// Message data convention (Level 2)
export {
  combineValidators,
  createOutputValidator,
  extractProgram,
  isMessageData,
  message,
  send,
} from "../libs/b3nd-msg/data/mod.ts";
export type {
  MessageData,
  MessageValidationContext,
  ProgramSchema,
  ProgramValidator,
  SendResult,
  StateMessage,
} from "../libs/b3nd-msg/data/mod.ts";

// Rig — the universal harness
export {
  createClientFromUrl,
  getSupportedProtocols,
  Identity,
  Rig,
  SUPPORTED_PROTOCOLS,
} from "../libs/b3nd-rig/mod.ts";
export type {
  ElasticsearchExecutorFactory,
  ExportedIdentity,
  HandlerOptions,
  MongoExecutor,
  PostgresExecutor,
  RigConfig,
  RigInfo,
  S3Executor as S3ExecutorFactory,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "../libs/b3nd-rig/mod.ts";

// HTTP API — standalone function for serving a rig over HTTP
export { createRigHandler, httpApi } from "../libs/b3nd-rig/http.ts";

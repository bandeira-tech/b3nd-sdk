/**
 * @module
 * Universal B3nd persistence SDK for all platforms.
 *
 * Provides URI-based data addressing with multiple backend support,
 * encryption, and schema validation.
 *
 * @example Basic usage with Store + protocol client
 * ```typescript
 * import { MemoryStore, MessageDataClient } from "@bandeira-tech/b3nd-sdk";
 *
 * const client = new MessageDataClient(new MemoryStore());
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
 * // Same NodeProtocolInterface as Store-backed clients
 * await client.receive([["mutable://data/key", {}, { value: 123 }]]);
 * const result = await client.read("mutable://data/key");
 * ```
 */

// Core types
export type {
  B3ndError,
  ClientError,
  DeleteResult,
  HealthStatus,
  HttpClientConfig,
  ListItem,
  ListOptions,
  ListResult,
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  Output,
  ReadFn,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  Schema,
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
export { PostgresStore } from "../libs/b3nd-client-postgres/store.ts";
export { SqliteStore } from "../libs/b3nd-client-sqlite/store.ts";
export { MongoStore } from "../libs/b3nd-client-mongo/store.ts";
export { S3Store } from "../libs/b3nd-client-s3/store.ts";
export { ElasticsearchStore } from "../libs/b3nd-client-elasticsearch/store.ts";
export { FsStore } from "../libs/b3nd-client-fs/store.ts";
export { IpfsStore } from "../libs/b3nd-client-ipfs/store.ts";
// Note: LocalStorageStore and IndexedDBStore are browser-only
// and not included in the JSR package. Use the npm package for browser support.

// Protocol clients (Store → NodeProtocolInterface)
export { SimpleClient } from "../libs/b3nd-core/simple-client.ts";
export { MessageDataClient } from "../libs/b3nd-core/message-data-client.ts";

// Transport clients (direct NodeProtocolInterface, no Store)
export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { ConsoleClient } from "../libs/b3nd-client-console/client.ts";

// Executor types (for injecting platform-specific drivers)
export type { S3Executor } from "../libs/b3nd-client-s3/mod.ts";
export type {
  ElasticsearchClientConfig,
  ElasticsearchExecutor,
} from "../libs/b3nd-client-elasticsearch/mod.ts";

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
  createClientResolver,
  createStoreFromUrl,
  createStoreResolver,
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
  StoreClientConstructor,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "../libs/b3nd-rig/mod.ts";

// HTTP API — standalone function for serving a rig over HTTP
export { createRigHandler, httpApi } from "../libs/b3nd-rig/http.ts";

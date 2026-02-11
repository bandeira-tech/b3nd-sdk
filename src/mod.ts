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
 * await client.receive(["mutable://users/alice", { name: "Alice", age: 30 }]);
 *
 * // Read data
 * const result = await client.read("mutable://users/alice");
 * console.log(result.record?.data); // { name: "Alice", age: 30 }
 *
 * // List items
 * const list = await client.list("mutable://users");
 * console.log(list.data); // [{ uri: "mutable://users/alice", ... }]
 * ```
 *
 * @example Using HttpClient with a remote backend
 * ```typescript
 * import { HttpClient } from "@bandeira-tech/b3nd-sdk";
 *
 * const client = new HttpClient({ url: "https://api.example.com" });
 *
 * // Same interface as MemoryClient
 * await client.receive(["mutable://data/key", { value: 123 }]);
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
  MongoClientConfig,
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  PersistenceRecord,
  PostgresClientConfig,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  Schema,
  ValidationFn,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "../libs/b3nd-core/types.ts";

// Client implementations
export { MemoryClient } from "../libs/b3nd-client-memory/mod.ts";
export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { PostgresClient } from "../libs/b3nd-client-postgres/mod.ts";
export { MongoClient } from "../libs/b3nd-client-mongo/mod.ts";
// Note: LocalStorageClient and IndexedDBClient are browser-only
// and not included in the JSR package. Use the npm package for browser support.

// PostgreSQL schema utilities
export {
  extractSchemaVersion,
  generateCompleteSchemaSQL,
  generatePostgresSchema,
  type SchemaInitOptions,
} from "../libs/b3nd-client-postgres/schema.ts";

// Combinators
export {
  firstMatchSequence,
  parallelBroadcast,
} from "../libs/b3nd-combinators/mod.ts";

// Server primitives
export { createServerNode } from "../libs/b3nd-servers/node.ts";
export * as servers from "../libs/b3nd-servers/http.ts";
export * as wsservers from "../libs/b3nd-servers/websocket.ts";

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
  Message,
  Node,
  NodeConfig,
  Processor,
  ReadInterface,
  ReceiveResult,
  /** @deprecated Use `Message` instead */
  Transaction,
  Validator,
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
  /** @deprecated Use `msgSchema` instead */
  txnSchema,
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

// Legacy message layer (deprecated aliases)
export { createTransactionNode } from "../libs/b3nd-msg/node-mod.ts";
export type {
  Transaction as LegacyTransaction,
  TransactionNode,
  TransactionNodeConfig,
  TransactionValidator,
} from "../libs/b3nd-msg/node-mod.ts";

// Message data convention (Level 2) — new names
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

// Deprecated aliases
export { isTransactionData } from "../libs/b3nd-msg/data/mod.ts";
export type {
  StateTransaction,
  TransactionData,
  TransactionValidationContext,
} from "../libs/b3nd-msg/data/mod.ts";

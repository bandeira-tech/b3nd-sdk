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
 * // Receive a transaction (the unified interface for all state changes)
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
} from "@b3nd/core/types";

// Client implementations
export { MemoryClient } from "@b3nd/client-memory";
export { HttpClient } from "@b3nd/client-http";
export { WebSocketClient } from "@b3nd/client-ws";
export { PostgresClient } from "@b3nd/client-postgres";
export { MongoClient } from "@b3nd/client-mongo";
// Note: LocalStorageClient and IndexedDBClient are browser-only
// and not included in the JSR package. Use the npm package for browser support.

// PostgreSQL schema utilities
export {
  extractSchemaVersion,
  generateCompleteSchemaSQL,
  generatePostgresSchema,
  type SchemaInitOptions,
} from "@b3nd/client-postgres/schema";

// Combinators
export { firstMatchSequence, parallelBroadcast } from "@b3nd/combinators";

// Server primitives
export { createServerNode } from "@b3nd/servers/node";
export * as servers from "@b3nd/servers/http";
export * as wsservers from "@b3nd/servers/websocket";

// Crypto utilities
export { pemToCryptoKey } from "@b3nd/encrypt";
export { deriveObfuscatedPath } from "@b3nd/encrypt/utils";

// Unified Node system
export { createNode } from "@b3nd/compose";
export type {
  Node,
  NodeConfig,
  Processor,
  ReadInterface,
  ReceiveResult,
  Transaction,
  Validator,
} from "@b3nd/compose";
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
  noop,
  parallel,
  pipeline,
  reject,
  requireFields,
  schema as schemaValidator,
  seq,
  txnSchema,
  uriPattern,
  when,
} from "@b3nd/compose";

// Legacy transaction layer (deprecated - use node system instead)
export { createTransactionNode } from "@b3nd/txn/node";
export type {
  SubmitResult,
  Transaction as LegacyTransaction,
  TransactionNode,
  TransactionNodeConfig,
  TransactionValidator,
} from "@b3nd/txn/node";

// Transaction data convention (Level 2)
export {
  combineValidators,
  createOutputValidator,
  extractProgram,
  isTransactionData,
} from "@b3nd/txn/data";
export type {
  ProgramSchema,
  ProgramValidator,
  StateTransaction,
  TransactionData,
  TransactionValidationContext,
} from "@b3nd/txn/data";

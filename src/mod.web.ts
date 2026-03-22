/**
 * @bandeira-tech/b3nd-web - Browser/NPM Distribution
 *
 * Browser-safe surface: core types, clients, wallet, identity, rig,
 * composition utilities, message layer, encryption helpers, and
 * browser-friendly storage clients.
 */

// Core types
export type {
  B3ndError,
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
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  Schema,
  ValidationFn,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "../libs/b3nd-core/types.ts";
export { ErrorCode, Errors } from "../libs/b3nd-core/types.ts";

// Client implementations (browser-safe)
export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { MemoryClient } from "../libs/b3nd-client-memory/mod.ts";
export { LocalStorageClient } from "../libs/b3nd-client-localstorage/mod.ts";
export { IndexedDBClient } from "../libs/b3nd-client-indexeddb/mod.ts";

// Wallet & Apps
export { WalletClient } from "../libs/b3nd-wallet/mod.ts";
export { AppsClient } from "../libs/b3nd-apps/mod.ts";

// Encryption
export * as encrypt from "../libs/b3nd-encrypt/mod.ts";
export { pemToCryptoKey } from "../libs/b3nd-encrypt/mod.ts";

// Rig — the universal harness (browser-safe)
export { Identity } from "../libs/b3nd-rig/identity.ts";
export { Rig } from "../libs/b3nd-rig/rig.ts";
export type { RigConfig } from "../libs/b3nd-rig/types.ts";

// Composition utilities
export {
  accept,
  all,
  any,
  createValidatedClient,
  msgSchema,
  reject,
  requireFields,
  schema as schemaValidator,
  uriPattern,
} from "../libs/b3nd-compose/mod.ts";
export type {
  Message,
  Node,
  NodeConfig,
  Validator,
} from "../libs/b3nd-compose/mod.ts";

// Combinators
export {
  firstMatchSequence,
  parallelBroadcast,
} from "../libs/b3nd-combinators/mod.ts";

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

// FunctionalClient
export { FunctionalClient } from "../libs/b3nd-core/functional-client.ts";
export type { FunctionalClientConfig } from "../libs/b3nd-core/functional-client.ts";

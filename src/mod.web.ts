/**
 * @bandeira-tech/b3nd-web - Browser/NPM Distribution
 *
 * Full browser-safe surface: core types, clients, identity, rig,
 * message layer, encryption, and protocol discovery.
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
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
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

// Client implementations
export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { MemoryClient } from "../libs/b3nd-client-memory/mod.ts";
export { LocalStorageClient } from "../libs/b3nd-client-localstorage/mod.ts";
export { IndexedDBClient } from "../libs/b3nd-client-indexeddb/mod.ts";
export { WalletClient } from "../libs/b3nd-wallet/mod.ts";
export { AppsClient } from "../libs/b3nd-apps/mod.ts";

// FunctionalClient (composable client pattern)
export { FunctionalClient } from "../libs/b3nd-core/functional-client.ts";
export type { FunctionalClientConfig } from "../libs/b3nd-core/functional-client.ts";

// Encryption
export * as encrypt from "../libs/b3nd-encrypt/mod.ts";

// Identity — signing + encryption keypair bundle
export { Identity } from "../libs/b3nd-rig/identity.ts";
export type { ExportedIdentity } from "../libs/b3nd-rig/identity.ts";

// Rig — universal harness
export { Rig } from "../libs/b3nd-rig/rig.ts";
export type {
  HandlerOptions,
  RigConfig,
  RigInfo,
  Unsubscribe,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "../libs/b3nd-rig/types.ts";
export {
  createClientFromUrl,
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
} from "../libs/b3nd-rig/backend-factory.ts";

// Message layer — structured state transitions
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

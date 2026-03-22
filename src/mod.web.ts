/**
 * @bandeira-tech/b3nd-web - Browser/NPM Distribution
 *
 * Full browser-safe SDK: core types, clients (HTTP, WebSocket, Memory,
 * LocalStorage, IndexedDB), Identity & Rig harness, message layer,
 * composition/validation, wallet/apps clients, and encryption helpers.
 */

// ── Core types ──
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

// ── Client implementations ──
export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { MemoryClient } from "../libs/b3nd-client-memory/mod.ts";
export { LocalStorageClient } from "../libs/b3nd-client-localstorage/mod.ts";
export { IndexedDBClient } from "../libs/b3nd-client-indexeddb/mod.ts";

// ── Wallet & Apps ──
export { WalletClient } from "../libs/b3nd-wallet/mod.ts";
export { AppsClient } from "../libs/b3nd-apps/mod.ts";

// ── Encryption ──
export * as encrypt from "../libs/b3nd-encrypt/mod.ts";
export { pemToCryptoKey } from "../libs/b3nd-encrypt/mod.ts";
export { deriveObfuscatedPath } from "../libs/b3nd-encrypt/utils.ts";

// ── FunctionalClient (primary composition pattern) ──
export { FunctionalClient } from "../libs/b3nd-core/functional-client.ts";
export type { FunctionalClientConfig } from "../libs/b3nd-core/functional-client.ts";

// ── Validated client convenience ──
export { createValidatedClient } from "../libs/b3nd-compose/validated-client.ts";

// ── Identity & Rig — universal harness ──
export { Identity } from "../libs/b3nd-rig/identity.ts";
export { Rig } from "../libs/b3nd-rig/rig.ts";
export type { RigConfig } from "../libs/b3nd-rig/types.ts";

// ── Message data convention (Level 2) ──
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

// ── Combinators ──
export {
  firstMatchSequence,
  parallelBroadcast,
} from "../libs/b3nd-combinators/mod.ts";

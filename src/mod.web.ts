/**
 * @bandeira-tech/b3nd-web - Browser/NPM Distribution
 *
 * Browser-safe surface: core types, clients (Http, WebSocket, LocalStorage,
 * IndexedDB, Memory), composition utilities, message data convention,
 * encryption helpers, and functional client pattern.
 *
 * @example Basic usage with MemoryClient (testing)
 * ```typescript
 * import { MemoryClient } from "@bandeira-tech/b3nd-web";
 *
 * const client = new MemoryClient();
 * await client.receive(["mutable://users/alice", { name: "Alice" }]);
 * const result = await client.read("mutable://users/alice");
 * ```
 *
 * @example Validated client with schema
 * ```typescript
 * import {
 *   createValidatedClient,
 *   HttpClient,
 *   MemoryClient,
 *   msgSchema,
 * } from "@bandeira-tech/b3nd-web";
 *
 * const client = createValidatedClient({
 *   write: new HttpClient({ url: "https://api.example.com" }),
 *   read: new HttpClient({ url: "https://api.example.com" }),
 *   validate: msgSchema(mySchema),
 * });
 * ```
 *
 * @example Message data convention
 * ```typescript
 * import { message, send } from "@bandeira-tech/b3nd-web";
 *
 * const msg = message({
 *   inputs: ["utxo://alice/1"],
 *   outputs: [["utxo://bob/99", 50]],
 * });
 *
 * await send(msg, client);
 * ```
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
  Schema,
  ValidationFn,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "../libs/b3nd-core/types.ts";
export { ErrorCode, Errors } from "../libs/b3nd-core/types.ts";

// Client implementations (browser-safe)
export { MemoryClient } from "../libs/b3nd-client-memory/mod.ts";
export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { LocalStorageClient } from "../libs/b3nd-client-localstorage/mod.ts";
export { IndexedDBClient } from "../libs/b3nd-client-indexeddb/mod.ts";

// Wallet & Apps clients
export { WalletClient } from "../libs/b3nd-wallet/mod.ts";
export { AppsClient } from "../libs/b3nd-apps/mod.ts";

// FunctionalClient (primary composition pattern)
export { FunctionalClient } from "../libs/b3nd-core/functional-client.ts";
export type { FunctionalClientConfig } from "../libs/b3nd-core/functional-client.ts";

// Validated client convenience
export { createValidatedClient } from "../libs/b3nd-compose/validated-client.ts";

// Combinators
export {
  firstMatchSequence,
  parallelBroadcast,
} from "../libs/b3nd-combinators/mod.ts";

// Compose — validators and composition utilities
export type {
  Message,
  Node,
  NodeConfig,
  Processor,
  ReadInterface,
  ReceiveResult,
  Validator,
} from "../libs/b3nd-compose/mod.ts";
export {
  accept,
  all,
  any,
  createValidatedClient as createValidatedNode,
  firstMatch,
  format,
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

// Encryption utilities
export * as encrypt from "../libs/b3nd-encrypt/mod.ts";
export { pemToCryptoKey } from "../libs/b3nd-encrypt/mod.ts";

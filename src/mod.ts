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
 * await client.receive([["mutable://users/alice", { name: "Alice", age: 30 }]]);
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
 * await client.receive([["mutable://data/key", { value: 123 }]]);
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
  Output,
  ReadFn,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  StatusResult,
  Store,
  StoreCapabilities,
  StoreEntry,
  StoreWriteResult,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "../libs/b3nd-core/types.ts";
export { ErrorCode, Errors } from "../libs/b3nd-core/types.ts";

// Binary encoding utilities (used by storage backends for JSON round-tripping)
export {
  decodeBinaryFromJson,
  encodeBinaryForJson,
  isBinary,
  isEncodedBinary,
} from "../libs/b3nd-core/binary.ts";

// Store implementations (core — ships with SDK)
export { MemoryStore } from "../libs/b3nd-client-memory/store.ts";

// Protocol clients (Store → NodeProtocolInterface)
export { SimpleClient } from "../libs/b3nd-core/simple-client.ts";
export { MessageDataClient } from "../libs/b3nd-core/message-data-client.ts";

// Transport clients (direct NodeProtocolInterface, no Store)
export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { ConsoleClient } from "../libs/b3nd-client-console/client.ts";

// Crypto utilities
export { pemToCryptoKey } from "../libs/b3nd-encrypt/mod.ts";
export { deriveObfuscatedPath } from "../libs/b3nd-encrypt/utils.ts";

// FunctionalClient (new primary pattern)
export { FunctionalClient } from "../libs/b3nd-core/functional-client.ts";
export type { FunctionalClientConfig } from "../libs/b3nd-core/functional-client.ts";

// ObserveEmitter — client-side observe primitive
export { ObserveEmitter } from "../libs/b3nd-core/observe-emitter.ts";
export type { ObserveListener } from "../libs/b3nd-core/observe-emitter.ts";

// Message data convention (inputs / outputs)
export { message, send } from "../libs/b3nd-msg/data/mod.ts";
export type {
  MessageData,
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
} from "../libs/b3nd-rig/mod.ts";
export type {
  BackendResolver,
  ExportedIdentity,
  RigConfig,
  RigInfo,
  StoreClientConstructor,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "../libs/b3nd-rig/mod.ts";

// HTTP API — standalone function for serving a rig over HTTP
export { httpApi } from "../libs/b3nd-rig/http.ts";

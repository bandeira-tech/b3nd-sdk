/**
 * @bandeira-tech/b3nd-web - Browser/NPM Distribution
 *
 * Full browser-safe surface: core types, clients, composition utilities,
 * validators, processors, message layer, encryption, auth, and hash.
 *
 * All exports use only Web APIs (crypto.subtle, URL, TextEncoder, etc.)
 * and are safe for browsers and edge runtimes.
 *
 * @example Basic usage with HttpClient
 * ```typescript
 * import { HttpClient, msgSchema, createValidatedClient } from "@bandeira-tech/b3nd-web";
 *
 * const client = new HttpClient({ url: "https://api.example.com" });
 *
 * await client.receive(["mutable://users/alice", { name: "Alice" }]);
 * const result = await client.read("mutable://users/alice");
 * ```
 *
 * @example Validated client with schema
 * ```typescript
 * import {
 *   HttpClient, createValidatedClient, msgSchema,
 *   firstMatchSequence, parallelBroadcast,
 * } from "@bandeira-tech/b3nd-web";
 *
 * const primary = new HttpClient({ url: "https://node-1.example.com" });
 * const replica = new HttpClient({ url: "https://node-2.example.com" });
 *
 * const client = createValidatedClient({
 *   write: parallelBroadcast([primary, replica]),
 *   read: firstMatchSequence([primary, replica]),
 *   validate: msgSchema(SCHEMA),
 * });
 * ```
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------
export type {
  B3ndError,
  ClientError,
  DeleteResult,
  HealthStatus,
  HttpClientConfig,
  ListItem,
  ListOptions,
  ListResult,
  LocalStorageClientConfig,
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

// ---------------------------------------------------------------------------
// Browser-safe client implementations
// ---------------------------------------------------------------------------
export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { LocalStorageClient } from "../libs/b3nd-client-localstorage/mod.ts";
export { IndexedDBClient } from "../libs/b3nd-client-indexeddb/mod.ts";
export { WalletClient } from "../libs/b3nd-wallet/mod.ts";
export { AppsClient } from "../libs/b3nd-apps/mod.ts";

// ---------------------------------------------------------------------------
// FunctionalClient (primary pattern for custom wiring)
// ---------------------------------------------------------------------------
export { FunctionalClient } from "../libs/b3nd-core/functional-client.ts";
export type { FunctionalClientConfig } from "../libs/b3nd-core/functional-client.ts";

// ---------------------------------------------------------------------------
// Combinators (multi-client read/write strategies)
// ---------------------------------------------------------------------------
export {
  firstMatchSequence,
  parallelBroadcast,
} from "../libs/b3nd-combinators/mod.ts";

// ---------------------------------------------------------------------------
// Composition system — validators, processors, and utilities
// ---------------------------------------------------------------------------
export { createValidatedClient } from "../libs/b3nd-compose/validated-client.ts";

export { createNode } from "../libs/b3nd-compose/mod.ts";
export type {
  Message,
  Node,
  NodeConfig,
  Processor,
  ReadInterface,
  Validator,
} from "../libs/b3nd-compose/mod.ts";

// Built-in validators
export {
  accept,
  format,
  msgSchema,
  reject,
  requireFields,
  schema as schemaValidator,
  uriPattern,
} from "../libs/b3nd-compose/mod.ts";

// Composition utilities (seq, any, all, parallel, pipeline, etc.)
export {
  all,
  any,
  firstMatch,
  parallel,
  pipeline,
  seq,
} from "../libs/b3nd-compose/mod.ts";

// Built-in processors
export { emit, log, noop, when } from "../libs/b3nd-compose/mod.ts";

// ---------------------------------------------------------------------------
// Message layer (Level 2 — inputs/outputs convention)
// ---------------------------------------------------------------------------
export { createMessageNode } from "../libs/b3nd-msg/node-mod.ts";
export type {
  MessageNode,
  MessageNodeConfig,
  MessageValidator,
  SubmitResult,
} from "../libs/b3nd-msg/node-mod.ts";

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

// ---------------------------------------------------------------------------
// Crypto utilities (all use Web Crypto API — browser-safe)
// ---------------------------------------------------------------------------
export * as encrypt from "../libs/b3nd-encrypt/mod.ts";
export { pemToCryptoKey } from "../libs/b3nd-encrypt/mod.ts";
export { deriveObfuscatedPath } from "../libs/b3nd-encrypt/utils.ts";

// ---------------------------------------------------------------------------
// Hash utilities (content-addressed storage)
// ---------------------------------------------------------------------------
export {
  computeSha256,
  generateHashUri,
  generateLinkUri,
  hashValidator,
  isValidSha256Hash,
  parseHashUri,
  validateLinkValue,
  verifyHashContent,
} from "../libs/b3nd-hash/mod.ts";

// ---------------------------------------------------------------------------
// Auth utilities (Ed25519 signature validation — uses Web Crypto)
// ---------------------------------------------------------------------------
export {
  authValidation,
  createCombinedAccess,
  createPubkeyBasedAccess,
  createRelativePathAccess,
} from "../libs/b3nd-auth/mod.ts";

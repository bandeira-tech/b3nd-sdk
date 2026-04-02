/**
 * @bandeira-tech/b3nd-web — the browser bundle.
 *
 * Single import for everything: rig, identity, hash, encrypt,
 * clients, message layer, and core types.
 *
 * Individual tools have their own packages (`@b3nd/rig`, subpath exports).
 * This bundle is the convergence — all tools, one import.
 */

// ── Core types ──

export type {
  B3ndError,
  ClientError,
  ConsoleClientConfig,
  DeleteResult,
  HealthStatus,
  HttpClientConfig,
  IndexedDBClientConfig,
  ListItem,
  ListOptions,
  ListResult,
  LocalStorageClientConfig,
  MemoryClientConfig,
  Message,
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  Output,
  PersistenceRecord,
  ReadFn,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  Schema,
  StatusResult,
  ValidationResult,
  Validator,
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
export { ConsoleClient } from "../libs/b3nd-client-console/mod.ts";
export { WalletClient } from "../libs/b3nd-wallet/mod.ts";
export { AppsClient } from "../libs/b3nd-apps/mod.ts";

// FunctionalClient (composable client pattern)
export { FunctionalClient } from "../libs/b3nd-core/functional-client.ts";
export type { FunctionalClientConfig } from "../libs/b3nd-core/functional-client.ts";

// ── Rig — universal harness ──

export { Identity } from "../libs/b3nd-rig/identity.ts";
export type { ExportedIdentity } from "../libs/b3nd-rig/identity.ts";
export { Rig } from "../libs/b3nd-rig/rig.ts";
export { connection } from "../libs/b3nd-rig/connection.ts";
export type {
  Connection,
  ConnectionPatterns,
} from "../libs/b3nd-rig/connection.ts";
export type {
  HandlerOptions,
  RigConfig,
  RigInfo,
  Unsubscribe,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "../libs/b3nd-rig/types.ts";
export type { BackendFactoryOptions } from "../libs/b3nd-rig/backend-factory.ts";
export {
  createClientFromUrl,
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
} from "../libs/b3nd-rig/backend-factory.ts";

// ── Content addressing (hash) ──

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

// ── Encryption & auth ──

export {
  createAuthenticatedMessage,
  createSignedEncryptedMessage,
  decrypt,
  decryptSymmetric,
  deriveEncryptionKeyPairFromSeed,
  deriveSigningKeyPairFromSeed,
  encrypt,
  encryptSymmetric,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  IdentityKey,
  pemToCryptoKey,
  PublicEncryptionKey,
  SecretEncryptionKey,
  sign,
  signPayload,
  verify,
  verifyAndDecryptMessage,
  verifyPayload,
} from "../libs/b3nd-encrypt/mod.ts";
export type {
  AuthenticatedMessage,
  EncryptedPayload,
  SignedEncryptedMessage,
} from "../libs/b3nd-encrypt/mod.ts";

// ── Message layer ──

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

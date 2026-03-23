/**
 * @bandeira-tech/b3nd-web - Browser/NPM Distribution
 *
 * Browser-safe surface: core types, Http client, wallet/apps clients,
 * encryption helpers, and browser-friendly storage clients.
 */

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
  NodeProtocolInterface,
  PersistenceRecord,
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

export { HttpClient } from "../libs/b3nd-client-http/mod.ts";
export { WebSocketClient } from "../libs/b3nd-client-ws/mod.ts";
export { LocalStorageClient } from "../libs/b3nd-client-localstorage/mod.ts";
export { IndexedDBClient } from "../libs/b3nd-client-indexeddb/mod.ts";
export { WalletClient } from "../libs/b3nd-wallet/mod.ts";
export { AppsClient } from "../libs/b3nd-apps/mod.ts";
export * as encrypt from "../libs/b3nd-encrypt/mod.ts";

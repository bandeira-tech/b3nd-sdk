/**
 * @bandeira-tech/b3nd-web - Browser/NPM Distribution
 *
 * Browser-safe surface: core types, Http client, wallet/apps clients,
 * encryption helpers, and browser-friendly storage clients.
 */

export type {
  ClientError,
  DeleteResult,
  HealthStatus,
  HttpClientConfig,
  ListItem,
  ListOptions,
  ListResult,
  LocalStorageClientConfig,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadResult,
  Schema,
  ValidationFn,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "./types.ts";

export { HttpClient } from "../clients/http/mod.ts";
export { WebSocketClient } from "../clients/websocket/mod.ts";
export { LocalStorageClient } from "../clients/local-storage/mod.ts";
export { WalletClient } from "../../b3nd-wallet/mod.ts";
export { AppsClient } from "../../b3nd-apps/mod.ts";
export * as encrypt from "../../b3nd-encrypt/mod.ts";

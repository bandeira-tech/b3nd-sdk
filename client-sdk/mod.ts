/**
 * b3nd/client-sdk - Client libraries for connecting to b3nd/persistence servers
 *
 * Provides client adapters for different backend types:
 * - HTTP: Connect to b3nd HTTP API servers
 * - WebSocket: Connect to b3nd WebSocket servers
 * - Local: Direct in-process connection to Persistence instances
 */

export * from "./src/types.ts";
export { HttpClient } from "./src/http-client.ts";
export { WebSocketClient } from "./src/websocket-client.ts";
export { LocalClient } from "./src/local-client.ts";

import type {
  B3ndClient,
  ClientConfig,
  HttpClientConfig,
  LocalClientConfig,
  WebSocketClientConfig,
} from "./src/types.ts";
import { HttpClient } from "./src/http-client.ts";
import { WebSocketClient } from "./src/websocket-client.ts";
import { LocalClient } from "./src/local-client.ts";

/**
 * Create a client instance based on configuration
 */
export function createClient(
  config: HttpClientConfig | WebSocketClientConfig | LocalClientConfig,
): B3ndClient {
  switch (config.type) {
    case "http":
      return new HttpClient(config);
    case "websocket":
      return new WebSocketClient(config);
    case "local":
      return new LocalClient(config);
    default:
      throw new Error(`Unknown client type: ${(config as ClientConfig).type}`);
  }
}

/**
 * Convenience function to create an HTTP client
 */
export function createHttpClient(
  baseUrl: string,
  options?: Partial<Omit<HttpClientConfig, "type" | "baseUrl">>,
): B3ndClient {
  return new HttpClient({
    type: "http",
    baseUrl,
    ...options,
  });
}

/**
 * Convenience function to create a WebSocket client
 */
export function createWebSocketClient(
  url: string,
  options?: Partial<Omit<WebSocketClientConfig, "type" | "url">>,
): B3ndClient {
  return new WebSocketClient({
    type: "websocket",
    url,
    ...options,
  });
}

/**
 * Convenience function to create a local client
 */
export function createLocalClient(persistence: any): B3ndClient {
  return new LocalClient({
    type: "local",
    persistence,
  });
}
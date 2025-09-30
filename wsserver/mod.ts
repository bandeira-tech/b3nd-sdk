/**
 * b3nd/wsserver - WebSocket server for b3nd/persistence
 *
 * Provides a WebSocket server module and runner that runs a single local
 * b3nd/persistence instance and can be the backend for b3nd/httpapi via
 * b3nd/client-sdk
 */

export { WebSocketServer } from "./src/server.ts";
export type { WebSocketServerConfig } from "./src/server.ts";
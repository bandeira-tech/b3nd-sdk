/**
 * BluetoothClient - Bluetooth implementation of NodeProtocolInterface
 *
 * Connects to B3nd nodes over Bluetooth (Web Bluetooth GATT or RFCOMM).
 * Follows the same request/response protocol as WebSocketClient:
 *   - Sends JSON-encoded { id, type, payload } requests
 *   - Receives JSON-encoded { id, success, data?, error? } responses
 *   - Routes responses to pending request promises by id
 *
 * Transport is injectable: real Web Bluetooth, native RFCOMM, or mock.
 * The client is transport-agnostic — it only cares about send/receive of strings.
 */

import type {
  DeleteResult,
  HealthStatus,
  ListOptions,
  ListResult,
  Message,
  NodeProtocolInterface,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
} from "../b3nd-core/types.ts";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
} from "../b3nd-core/binary.ts";

// ---------------------------------------------------------------------------
// Transport abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal transport interface for Bluetooth communication.
 *
 * Implementations:
 *   - WebBluetoothTransport  (browser, Web Bluetooth API)
 *   - RfcommTransport        (Node/Deno native, e.g. via noble/bleno)
 *   - MockBluetoothTransport (tests)
 */
export interface BluetoothTransport {
  /** Connect to the remote device. Resolves when ready to send/receive. */
  connect(): Promise<void>;

  /** Send a UTF-8 string message to the remote device. */
  send(data: string): Promise<void>;

  /** Register a handler for incoming messages from the remote device. */
  onMessage(handler: (data: string) => void): void;

  /** Register a handler for transport-level errors. */
  onError(handler: (error: Error) => void): void;

  /** Register a handler for disconnection events. */
  onDisconnect(handler: () => void): void;

  /** Disconnect and release resources. */
  disconnect(): Promise<void>;

  /** Whether the transport is currently connected. */
  readonly connected: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BluetoothClientConfig {
  /**
   * The Bluetooth transport to use.
   * Inject a WebBluetoothTransport, RfcommTransport, or MockBluetoothTransport.
   */
  transport: BluetoothTransport;

  /**
   * Request timeout in milliseconds (default: 30000).
   * Bluetooth can be slower than HTTP/WS, so a generous default is appropriate.
   */
  timeout?: number;

  /**
   * Reconnection configuration.
   */
  reconnect?: {
    enabled: boolean;
    maxAttempts?: number;
    interval?: number;
    backoff?: "linear" | "exponential";
  };
}

// ---------------------------------------------------------------------------
// Request / response wire types (same as WebSocket protocol)
// ---------------------------------------------------------------------------

interface BluetoothRequest {
  id: string;
  type:
    | "receive"
    | "read"
    | "readMulti"
    | "list"
    | "delete"
    | "health"
    | "getSchema";
  payload: unknown;
}

interface BluetoothResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

export class BluetoothClient implements NodeProtocolInterface {
  private transport: BluetoothTransport;
  private timeout: number;
  private reconnectConfig: BluetoothClientConfig["reconnect"];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: BluetoothResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(config: BluetoothClientConfig) {
    this.transport = config.transport;
    this.timeout = config.timeout ?? 30000;
    this.reconnectConfig = {
      enabled: true,
      maxAttempts: 5,
      interval: 1000,
      backoff: "exponential",
      ...config.reconnect,
    };

    // Wire up transport event handlers
    this.transport.onMessage((data: string) => this.handleMessage(data));
    this.transport.onError((_error: Error) => this.handleError());
    this.transport.onDisconnect(() => this.handleDisconnect());
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  private async ensureConnected(): Promise<void> {
    if (this.transport.connected) return;
    await this.connect();
  }

  private async connect(): Promise<void> {
    try {
      await this.transport.connect();
      this.reconnectAttempts = 0;
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private handleMessage(raw: string): void {
    try {
      const response: BluetoothResponse = JSON.parse(raw);
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    } catch (_error) {
      // Malformed message — ignore
    }
  }

  private handleError(): void {
    this.cleanupPendingRequests(new Error("Bluetooth transport error"));
  }

  private handleDisconnect(): void {
    this.cleanupPendingRequests(new Error("Bluetooth connection lost"));

    if (
      this.reconnectConfig?.enabled &&
      this.reconnectAttempts < (this.reconnectConfig.maxAttempts ?? 5)
    ) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    const base = this.reconnectConfig?.interval ?? 1000;
    const delay = this.reconnectConfig?.backoff === "exponential"
      ? base * Math.pow(2, this.reconnectAttempts)
      : base;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {
        // Will retry if attempts remain
      });
    }, delay);
  }

  private cleanupPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  // -----------------------------------------------------------------------
  // Request / response plumbing
  // -----------------------------------------------------------------------

  private async sendRequest<T>(
    type: BluetoothRequest["type"],
    payload: unknown,
  ): Promise<T> {
    await this.ensureConnected();

    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      const request: BluetoothRequest = { id, type, payload };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${this.timeout}ms`));
      }, this.timeout);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.success) {
            resolve(response.data as T);
          } else {
            reject(new Error(response.error ?? "Request failed"));
          }
        },
        reject,
        timeout,
      });

      this.transport.send(JSON.stringify(request)).catch((err) => {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // -----------------------------------------------------------------------
  // NodeProtocolInterface
  // -----------------------------------------------------------------------

  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    const [uri] = msg;
    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Message URI is required" };
    }

    try {
      const encodedMsg: Message = [uri, encodeBinaryForJson(msg[1])];
      return await this.sendRequest<ReceiveResult>("receive", {
        tx: encodedMsg,
      });
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const result = await this.sendRequest<ReadResult<T>>("read", { uri });
      if (result.success && result.record) {
        result.record.data = decodeBinaryFromJson(result.record.data) as T;
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    if (uris.length === 0) {
      return {
        success: false,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      };
    }

    if (uris.length > 50) {
      return {
        success: false,
        results: [],
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    }

    try {
      return await this.sendRequest<ReadMultiResult<T>>("readMulti", { uris });
    } catch {
      // Fallback to individual reads
      const results: ReadMultiResultItem<T>[] = await Promise.all(
        uris.map(async (uri): Promise<ReadMultiResultItem<T>> => {
          const result = await this.read<T>(uri);
          if (result.success && result.record) {
            return { uri, success: true, record: result.record };
          }
          return { uri, success: false, error: result.error ?? "Read failed" };
        }),
      );

      const succeeded = results.filter((r) => r.success).length;
      return {
        success: succeeded > 0,
        results,
        summary: {
          total: uris.length,
          succeeded,
          failed: uris.length - succeeded,
        },
      };
    }
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      return await this.sendRequest<ListResult>("list", { uri, options });
    } catch {
      return {
        success: true,
        data: [],
        pagination: {
          page: options?.page ?? 1,
          limit: options?.limit ?? 50,
        },
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      return await this.sendRequest<DeleteResult>("delete", { uri });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(): Promise<HealthStatus> {
    try {
      return await this.sendRequest<HealthStatus>("health", {});
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getSchema(): Promise<string[]> {
    try {
      return await this.sendRequest<string[]>("getSchema", {});
    } catch {
      return [];
    }
  }

  async cleanup(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.cleanupPendingRequests(new Error("Client cleanup"));

    await this.transport.disconnect();
    this.reconnectAttempts = 0;
  }
}

// ---------------------------------------------------------------------------
// Mock Bluetooth transport (for testing)
// ---------------------------------------------------------------------------

/**
 * In-memory Bluetooth transport that simulates a B3nd node.
 * Mirrors the MockWebSocket pattern from WebSocketClient tests.
 *
 * Usage:
 *   const transport = new MockBluetoothTransport();
 *   const client = new BluetoothClient({ transport });
 */
export class MockBluetoothTransport implements BluetoothTransport {
  private messageHandler: ((data: string) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;
  private storage = new Map<string, { data: unknown; ts: number }>();
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    this._connected = true;
  }

  async send(data: string): Promise<void> {
    if (!this._connected) {
      throw new Error("Transport not connected");
    }

    // Process and respond asynchronously (like real BT latency)
    setTimeout(() => {
      try {
        const request = JSON.parse(data);
        const response = this.generateResponse(request);
        this.messageHandler?.(JSON.stringify(response));
      } catch {
        this.errorHandler?.(new Error("Malformed request"));
      }
    }, 5);
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
  }

  /** Simulate a remote disconnection (for testing reconnection). */
  simulateDisconnect(): void {
    this._connected = false;
    this.disconnectHandler?.();
  }

  /** Simulate a transport error (for testing error handling). */
  simulateError(error: Error): void {
    this.errorHandler?.(error);
  }

  // Same response generation as MockWebSocket
  protected generateResponse(request: {
    id: string;
    type: string;
    payload: any;
  }): BluetoothResponse {
    switch (request.type) {
      case "receive": {
        const [uri, data] = request.payload.tx;
        this.storage.set(uri, { data, ts: Date.now() });
        return {
          id: request.id,
          success: true,
          data: { accepted: true },
        };
      }

      case "read": {
        const stored = this.storage.get(request.payload.uri);
        if (stored) {
          return {
            id: request.id,
            success: true,
            data: {
              success: true,
              record: { ts: stored.ts, data: stored.data },
            },
          };
        }
        return {
          id: request.id,
          success: true,
          data: { success: false, error: "Not found" },
        };
      }

      case "readMulti": {
        const uris: string[] = request.payload.uris;
        const results = uris.map((uri: string) => {
          const s = this.storage.get(uri);
          if (s) {
            return {
              uri,
              success: true,
              record: { ts: s.ts, data: s.data },
            };
          }
          return { uri, success: false, error: "Not found" };
        });
        const succeeded = results.filter(
          (r: { success: boolean }) => r.success,
        ).length;
        return {
          id: request.id,
          success: true,
          data: {
            success: succeeded > 0,
            results,
            summary: {
              total: uris.length,
              succeeded,
              failed: uris.length - succeeded,
            },
          },
        };
      }

      case "list": {
        const uri: string = request.payload.uri;
        const prefix = uri.endsWith("/") ? uri : `${uri}/`;
        const options = request.payload.options;
        let items: { uri: string }[] = [];

        for (const storedUri of this.storage.keys()) {
          if (storedUri.startsWith(prefix)) {
            items.push({ uri: storedUri });
          }
        }

        if (options?.pattern) {
          const regex = new RegExp(options.pattern);
          items = items.filter((item: { uri: string }) => regex.test(item.uri));
        }

        const page = options?.page ?? 1;
        const limit = options?.limit ?? 50;
        const offset = (page - 1) * limit;
        const paginated = items.slice(offset, offset + limit);

        return {
          id: request.id,
          success: true,
          data: {
            success: true,
            data: paginated,
            pagination: { page, limit, total: items.length },
          },
        };
      }

      case "delete": {
        if (this.storage.has(request.payload.uri)) {
          this.storage.delete(request.payload.uri);
          return {
            id: request.id,
            success: true,
            data: { success: true },
          };
        }
        return {
          id: request.id,
          success: true,
          data: { success: false, error: "Not found" },
        };
      }

      case "health":
        return {
          id: request.id,
          success: true,
          data: {
            status: "healthy" as const,
            message: "Bluetooth node operational",
            details: { transport: "bluetooth" },
          },
        };

      case "getSchema":
        return {
          id: request.id,
          success: true,
          data: ["store://", "users://"],
        };

      default:
        return {
          id: request.id,
          success: false,
          error: `Unknown request type: ${request.type}`,
        };
    }
  }
}

/**
 * Mock transport that always fails to connect.
 * Used for connection-error test factories.
 */
export class FailingBluetoothTransport implements BluetoothTransport {
  private errorHandler: ((error: Error) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;

  get connected(): boolean {
    return false;
  }

  async connect(): Promise<void> {
    throw new Error("Bluetooth connection failed: device not found");
  }

  async send(_data: string): Promise<void> {
    throw new Error("Not connected");
  }

  onMessage(_handler: (data: string) => void): void {}
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }
  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  async disconnect(): Promise<void> {}
}

/**
 * Mock transport that rejects writes without a `name` field.
 * Used for validation-error test factories.
 */
export class ValidationFailingBluetoothTransport extends MockBluetoothTransport {
  protected override generateResponse(request: {
    id: string;
    type: string;
    payload: any;
  }): BluetoothResponse {
    if (request.type === "receive") {
      const [, data] = request.payload.tx;
      if (!data?.name) {
        return {
          id: request.id,
          success: true,
          data: { accepted: false, error: "Name is required" },
        };
      }
    }
    return super.generateResponse(request);
  }
}

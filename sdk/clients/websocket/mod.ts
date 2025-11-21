/**
 * WebSocketClient - WebSocket implementation of NodeProtocolInterface
 *
 * Connects to B3nd WebSocket servers and forwards operations.
 * Handles reconnection and connection pooling.
 */

import type {
  DeleteResult,
  HealthStatus,
  ListOptions,
  ListResult,
  NodeProtocolInterface,
  ReadResult,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "../../src/types.ts";

export class WebSocketClient implements NodeProtocolInterface {
  private config: WebSocketClientConfig;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<string, {
    resolve: (value: WebSocketResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private messageHandler = this.handleMessage.bind(this);
  private closeHandler = this.handleClose.bind(this);
  private errorHandler = this.handleError.bind(this);

  constructor(config: WebSocketClientConfig) {
    this.config = {
      timeout: 30000,
      ...config,
      reconnect: {
        enabled: true,
        maxAttempts: 5,
        interval: 1000,
        backoff: "exponential",
        ...config.reconnect,
      },
    };
  }

  /**
   * Ensure WebSocket connection is established
   */
  private async ensureConnected(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      // Wait for connection to complete
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connection timeout")), this.config.timeout);

        const checkConnection = () => {
          if (this.connected) {
            clearTimeout(timeout);
            resolve();
          } else if (this.ws?.readyState === WebSocket.CLOSED || this.ws?.readyState === WebSocket.CLOSING) {
            clearTimeout(timeout);
            reject(new Error("Connection failed"));
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });
    }

    return this.connect();
  }

  /**
   * Establish WebSocket connection
   */
  private async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const url = new URL(this.config.url);

        // Add auth to URL if needed
        if (this.config.auth) {
          switch (this.config.auth.type) {
            case "bearer":
              url.searchParams.set("token", this.config.auth.token || "");
              break;
            case "basic":
              url.username = this.config.auth.username || "";
              url.password = this.config.auth.password || "";
              break;
          }
        }

        this.ws = new WebSocket(url.toString());
        this.ws.addEventListener("open", () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          resolve();
        });
        this.ws.addEventListener("message", this.messageHandler);
        this.ws.addEventListener("close", this.closeHandler);
        this.ws.addEventListener("error", this.errorHandler);

        const timeout = setTimeout(() => {
          this.ws?.close();
          reject(new Error("Connection timeout"));
        }, this.config.timeout);

        // Clean up timeout on successful connection
        this.ws.addEventListener("open", () => clearTimeout(timeout), { once: true });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle WebSocket messages
   */
  private handleMessage(event: MessageEvent) {
    try {
      const response: WebSocketResponse = JSON.parse(event.data);
      const pending = this.pendingRequests.get(response.id);

      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    } catch (error) {
      console.error("Failed to parse WebSocket message:", error);
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose() {
    this.connected = false;
    this.cleanupPendingRequests(new Error("WebSocket connection closed"));

    if (this.config.reconnect?.enabled && this.reconnectAttempts < (this.config.reconnect.maxAttempts || 5)) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket errors
   */
  private handleError(_error: Event) {
    this.connected = false;
    this.cleanupPendingRequests(new Error("WebSocket error"));
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = this.config.reconnect?.backoff === "exponential"
      ? (this.config.reconnect.interval || 1000) * Math.pow(2, this.reconnectAttempts)
      : this.config.reconnect?.interval || 1000;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {
        // Connection failed, will retry if attempts remain
      });
    }, delay);
  }

  /**
   * Cleanup pending requests with error
   */
  private cleanupPendingRequests(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Send request and wait for response
   */
  private async sendRequest<T>(type: WebSocketRequest["type"], payload: unknown): Promise<T> {
    await this.ensureConnected();

    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      const request: WebSocketRequest = { id, type, payload };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.success) {
            resolve(response.data as T);
          } else {
            reject(new Error(response.error || "Request failed"));
          }
        },
        reject,
        timeout,
      });

      try {
        this.ws?.send(JSON.stringify(request));
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  async write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>> {
    try {
      const result = await this.sendRequest<WriteResult<T>>("write", { uri, value });
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const result = await this.sendRequest<ReadResult<T>>("read", { uri });
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const result = await this.sendRequest<ListResult>("list", { uri, options });
      return result;
    } catch (error) {
      return {
        success: true,
        data: [],
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 50,
        },
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const result = await this.sendRequest<DeleteResult>("delete", { uri });
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(): Promise<HealthStatus> {
    try {
      const result = await this.sendRequest<HealthStatus>("health", {});
      return result;
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getSchema(): Promise<string[]> {
    try {
      const result = await this.sendRequest<string[]>("getSchema", {});
      return result;
    } catch (error) {
      return [];
    }
  }

  async cleanup(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.cleanupPendingRequests(new Error("Client cleanup"));

    if (this.ws) {
      this.ws.removeEventListener("message", this.messageHandler);
      this.ws.removeEventListener("close", this.closeHandler);
      this.ws.removeEventListener("error", this.errorHandler);

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.connected = false;
    this.reconnectAttempts = 0;
  }
}

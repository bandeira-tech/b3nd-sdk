/**
 * WebSocket Client Implementation
 * Connects to b3nd WebSocket servers
 */

import type {
  B3ndClient,
  DeleteResult,
  ListOptions,
  ListResult,
  ReadResult,
  WebSocketClientConfig,
  WebSocketRequest,
  WebSocketResponse,
  WriteResult,
} from "./types.ts";

export class WebSocketClient implements B3ndClient {
  private ws: WebSocket | null = null;
  private url: string;
  private config: WebSocketClientConfig;
  private connected = false;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timeout: number;
    }
  >();

  constructor(config: WebSocketClientConfig) {
    this.config = config;
    this.url = config.url;
  }

  /**
   * Connect to WebSocket server
   */
  private async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.connected = true;
          this.reconnecting = false;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
        };

        this.ws.onclose = () => {
          this.connected = false;
          this.handleDisconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const response: WebSocketResponse = JSON.parse(data);
      const pending = this.pendingRequests.get(response.id);

      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);

        if (response.success) {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(response.error || "Request failed"));
        }
      }
    } catch (error) {
      console.error("Failed to parse WebSocket message:", error);
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnect(): void {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
      this.pendingRequests.delete(id);
    }

    // Attempt reconnection if enabled
    if (
      this.config.reconnect?.enabled &&
      !this.reconnecting &&
      this.reconnectAttempts <
        (this.config.reconnect.maxAttempts || Number.POSITIVE_INFINITY)
    ) {
      this.reconnecting = true;
      this.reconnectAttempts++;

      const interval = this.config.reconnect.interval || 1000;
      const backoff = this.config.reconnect.backoff || "linear";

      const delay = backoff === "exponential"
        ? interval * Math.pow(2, this.reconnectAttempts - 1)
        : interval * this.reconnectAttempts;

      setTimeout(() => {
        this.connect().catch((error) => {
          console.error("Reconnection failed:", error);
          this.reconnecting = false;
        });
      }, delay);
    }
  }

  /**
   * Send request and wait for response
   */
  private async sendRequest(
    type: WebSocketRequest["type"],
    payload: unknown,
  ): Promise<any> {
    if (!this.connected) {
      await this.connect();
    }

    const id = crypto.randomUUID();
    const request: WebSocketRequest = { id, type, payload };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error("Request timeout"));
      }, this.config.timeout || 30000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  async write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>> {
    try {
      const result = await this.sendRequest("write", { uri, value });
      return {
        success: true,
        record: result.record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Write failed",
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const result = await this.sendRequest("read", { uri });
      return {
        success: true,
        record: result.record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Read failed",
      };
    }
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const result = await this.sendRequest("list", { uri, options });
      return result;
    } catch (error) {
      return {
        data: [],
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 50,
          total: 0,
          hasNext: false,
          hasPrev: false,
        },
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      await this.sendRequest("delete", { uri });
      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
      };
    }
  }

  async health(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
  }> {
    try {
      const result = await this.sendRequest("health", {});
      return result;
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : "Health check failed",
      };
    }
  }

  async cleanup(): Promise<void> {
    // Clear all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Client cleanup"));
      this.pendingRequests.delete(id);
    }

    // Close WebSocket connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
  }
}
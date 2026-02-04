/**
 * WebSocketClient - WebSocket implementation of NodeProtocolInterface
 *
 * Connects to B3nd WebSocket servers and forwards operations.
 * Handles reconnection and connection pooling.
 */

import {
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
} from "./types.js";

export class WebSocketClient {
  config: WebSocketClientConfig;
  ws: WebSocket | null = null;
  connected = false;
  reconnectAttempts = 0;
  reconnectTimer: number | null = null;
  pendingRequests = new Map<string, {
    resolve: (value) => void;
    reject: (error) => void;
    timeout: number;
  }>();
  messageHandler = this.handleMessage.bind(this);
  closeHandler = this.handleClose.bind(this);
  errorHandler = this.handleError.bind(this);

  constructor(config) {
    this.config = {
      timeout: 30000,
      ...config,
      reconnect: {
        enabled,
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
  async ensureConnected(){
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      // Wait for connection to complete
      return new Promise((resolve, reject) => {
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
  async connect(){
    return new Promise((resolve, reject) => {
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
  handleMessage(event) {
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
  handleClose() {
    this.connected = false;
    this.cleanupPendingRequests(new Error("WebSocket connection closed"));

    if (this.config.reconnect?.enabled && this.reconnectAttempts {
      this.reconnectAttempts++;
      this.connect().catch(() => {
        // Connection failed, will retry if attempts remain
      });
    }, delay);
  }

  /**
   * Cleanup pending requests with error
   */
  cleanupPendingRequests(error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Send request and wait for response
   */
  async sendRequest(type: WebSocketRequest["type"], payload){
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const request: WebSocketRequest = { id, type, payload };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.success) {
            resolve(response.data);
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

  async write(uri, value){
    try {
      const result = await this.sendRequest<WriteResult<T>>("write", { uri, value });
      return result;
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read(uri){
    try {
      const result = await this.sendRequest<ReadResult<T>>("read", { uri });
      return result;
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async list(uri, options?: ListOptions){
    try {
      const result = await this.sendRequest("list", { uri, options });
      return result;
    } catch (error) {
      return {
        data: [],
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 50,
        },
      };
    }
  }

  async delete(uri){
    try {
      const result = await this.sendRequest("delete", { uri });
      return result;
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(){
    try {
      const result = await this.sendRequest("health", {});
      return result;
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getSchema(){
    try {
      const result = await this.sendRequest("getSchema", {});
      return result;
    } catch (error) {
      return [];
    }
  }

  async cleanup(){
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
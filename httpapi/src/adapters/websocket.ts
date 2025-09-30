/**
 * WebSocket Adapter
 *
 * A persistence adapter that connects to a remote persistence server
 * via WebSocket. This allows for distributed persistence with authentication
 * and secure connections.
 */

import {
  BaseAdapter,
  type AdapterConfig,
  type ListOptions,
  type ListResult,
  type WebSocketConfig,
  type PersistenceRecord,
  AdapterError,
} from "./types.ts";

interface WebSocketMessage {
  id: string;
  type: "request" | "response" | "error";
  method: "write" | "read" | "list" | "delete" | "health";
  params?: unknown;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class WebSocketAdapter extends BaseAdapter {
  private ws?: WebSocket;
  private wsConfig!: WebSocketConfig;
  private requestMap = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: number;
  }>();
  private reconnectAttempts = 0;
  private isConnected = false;
  private reconnectTimer?: number;

  protected async doInitialize(): Promise<void> {
    const options = this.config.options as WebSocketConfig;
    if (!options?.url) {
      throw new AdapterError(
        "WebSocket URL is required",
        "CONFIG_ERROR",
        { config: this.config }
      );
    }

    this.wsConfig = {
      url: options.url,
      auth: options.auth,
      reconnect: {
        enabled: true,
        maxAttempts: 10,
        interval: 5000,
        backoff: "exponential",
        ...options.reconnect,
      },
      timeout: options.timeout || 30000,
      compression: options.compression ?? true,
    };

    await this.connect();
  }

  private async connect(): Promise<void> {
    try {
      console.log(`[WebSocketAdapter] Connecting to ${this.wsConfig.url}`);

      // Create WebSocket connection
      this.ws = new WebSocket(this.wsConfig.url);

      // Set up event handlers
      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (event) => this.handleMessage(event);
      this.ws.onerror = (error) => this.handleError(error);
      this.ws.onclose = () => this.handleClose();

      // Wait for connection to be established
      await this.waitForConnection();
    } catch (error) {
      console.error(`[WebSocketAdapter] Connection failed:`, error);
      throw new AdapterError(
        "Failed to connect to WebSocket server",
        "CONNECTION_ERROR",
        { url: this.wsConfig.url, error }
      );
    }
  }

  private waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, this.wsConfig.timeout);

      const checkConnection = setInterval(() => {
        if (this.isConnected) {
          clearInterval(checkConnection);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });
  }

  private handleOpen(): void {
    console.log(`[WebSocketAdapter] Connected to ${this.wsConfig.url}`);
    this.isConnected = true;
    this.reconnectAttempts = 0;

    // Send authentication if configured
    if (this.wsConfig.auth) {
      this.authenticate();
    }
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as WebSocketMessage;

      if (message.type === "response" || message.type === "error") {
        const request = this.requestMap.get(message.id);
        if (request) {
          clearTimeout(request.timeout);
          this.requestMap.delete(message.id);

          if (message.type === "error") {
            request.reject(new AdapterError(
              message.error?.message || "Unknown error",
              message.error?.code || "UNKNOWN_ERROR",
              message.error?.details
            ));
          } else {
            request.resolve(message.result);
          }
        }
      }
    } catch (error) {
      console.error(`[WebSocketAdapter] Error handling message:`, error);
    }
  }

  private handleError(error: Event): void {
    console.error(`[WebSocketAdapter] WebSocket error:`, error);
  }

  private handleClose(): void {
    console.log(`[WebSocketAdapter] Connection closed`);
    this.isConnected = false;

    // Cancel all pending requests
    for (const [id, request] of this.requestMap) {
      clearTimeout(request.timeout);
      request.reject(new AdapterError(
        "Connection closed",
        "CONNECTION_CLOSED"
      ));
    }
    this.requestMap.clear();

    // Attempt reconnection if configured
    if (this.wsConfig.reconnect?.enabled) {
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    if (
      this.wsConfig.reconnect?.maxAttempts &&
      this.reconnectAttempts >= this.wsConfig.reconnect.maxAttempts
    ) {
      console.error(
        `[WebSocketAdapter] Max reconnection attempts (${this.wsConfig.reconnect.maxAttempts}) reached`
      );
      return;
    }

    this.reconnectAttempts++;

    const interval = this.calculateReconnectInterval();
    console.log(
      `[WebSocketAdapter] Attempting reconnection #${this.reconnectAttempts} in ${interval}ms`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error(`[WebSocketAdapter] Reconnection failed:`, error);
        this.attemptReconnect();
      }
    }, interval);
  }

  private calculateReconnectInterval(): number {
    const baseInterval = this.wsConfig.reconnect?.interval || 5000;

    if (this.wsConfig.reconnect?.backoff === "exponential") {
      return Math.min(
        baseInterval * Math.pow(2, this.reconnectAttempts - 1),
        60000 // Max 1 minute
      );
    }

    return baseInterval;
  }

  private async authenticate(): Promise<void> {
    if (!this.wsConfig.auth) return;

    console.log(`[WebSocketAdapter] Authenticating...`);

    // Implementation depends on auth type
    // This is a placeholder for actual authentication logic
    const authMessage = {
      type: "auth",
      ...this.wsConfig.auth,
    };

    this.ws?.send(JSON.stringify(authMessage));
  }

  private async sendRequest(
    method: string,
    params: unknown
  ): Promise<unknown> {
    if (!this.isConnected || !this.ws) {
      throw new AdapterError(
        "WebSocket is not connected",
        "NOT_CONNECTED"
      );
    }

    const id = crypto.randomUUID();
    const message: WebSocketMessage = {
      id,
      type: "request",
      method: method as any,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestMap.delete(id);
        reject(new AdapterError(
          "Request timeout",
          "TIMEOUT",
          { method, params }
        ));
      }, this.wsConfig.timeout);

      this.requestMap.set(id, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify(message));
    });
  }

  async write(
    protocol: string,
    domain: string,
    path: string,
    value: unknown,
  ): Promise<{
    success: boolean;
    record?: PersistenceRecord<unknown>;
    error?: string;
  }> {
    try {
      const result = await this.sendRequest("write", {
        protocol,
        domain,
        path,
        value,
      }) as any;

      return result;
    } catch (error) {
      console.error(`[WebSocketAdapter] Write error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown write error",
      };
    }
  }

  async read(
    protocol: string,
    domain: string,
    path: string,
  ): Promise<PersistenceRecord<unknown> | null> {
    try {
      const result = await this.sendRequest("read", {
        protocol,
        domain,
        path,
      });

      return result as PersistenceRecord<unknown> | null;
    } catch (error) {
      console.error(`[WebSocketAdapter] Read error:`, error);
      return null;
    }
  }

  async listPath(
    protocol: string,
    domain: string,
    path: string,
    options: ListOptions = {},
  ): Promise<ListResult> {
    try {
      const result = await this.sendRequest("list", {
        protocol,
        domain,
        path,
        options,
      });

      return result as ListResult;
    } catch (error) {
      console.error(`[WebSocketAdapter] List error:`, error);
      return {
        data: [],
        pagination: {
          page: options.page || 1,
          limit: options.limit || 50,
          total: 0,
          hasNext: false,
          hasPrev: false,
        },
      };
    }
  }

  async delete(
    protocol: string,
    domain: string,
    path: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.sendRequest("delete", {
        protocol,
        domain,
        path,
      }) as any;

      return result;
    } catch (error) {
      console.error(`[WebSocketAdapter] Delete error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown delete error",
      };
    }
  }

  async cleanup(): Promise<void> {
    console.log(`[WebSocketAdapter] Cleaning up instance '${this.config.id}'`);

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Close WebSocket connection
    if (this.ws) {
      this.ws.close(1000, "Cleanup");
      this.ws = undefined;
    }

    // Clear pending requests
    for (const [id, request] of this.requestMap) {
      clearTimeout(request.timeout);
      request.reject(new AdapterError(
        "Adapter cleanup",
        "CLEANUP"
      ));
    }
    this.requestMap.clear();
  }

  async health(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
    details?: Record<string, unknown>;
    lastCheck: number;
  }> {
    if (!this.isConnected) {
      return {
        status: "unhealthy",
        message: "WebSocket is not connected",
        details: {
          url: this.wsConfig.url,
          reconnectAttempts: this.reconnectAttempts,
        },
        lastCheck: Date.now(),
      };
    }

    try {
      const result = await this.sendRequest("health", {}) as any;
      return {
        status: "healthy",
        message: "WebSocket adapter is operational",
        details: {
          url: this.wsConfig.url,
          remote: result,
        },
        lastCheck: Date.now(),
      };
    } catch (error) {
      return {
        status: "degraded",
        message: "WebSocket is connected but health check failed",
        details: {
          url: this.wsConfig.url,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        lastCheck: Date.now(),
      };
    }
  }
}

/**
 * Factory function for creating WebSocketAdapter instances
 */
export async function createWebSocketAdapter(
  config: AdapterConfig
): Promise<WebSocketAdapter> {
  const adapter = new WebSocketAdapter();
  await adapter.initialize(config);
  return adapter;
}

// Export as default for module loading
export default createWebSocketAdapter;

/**
 * WebSocket Server Implementation
 * Provides WebSocket interface to b3nd/persistence
 */

import type { B3ndClient } from "../../client-sdk/mod.ts";
import type {
  WebSocketRequest,
  WebSocketResponse,
} from "../../client-sdk/src/types.ts";

export interface WebSocketServerConfig {
  port: number;
  hostname?: string;
  persistence: B3ndClient;
  auth?: {
    enabled: boolean;
    validateToken?: (token: string) => Promise<boolean>;
  };
}

export class WebSocketServer {
  private config: WebSocketServerConfig;
  private clients = new Set<WebSocket>();
  private server: Deno.HttpServer | null = null;

  constructor(config: WebSocketServerConfig) {
    this.config = config;
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    const handler = (req: Request): Response => {
      // Handle WebSocket upgrade
      if (req.headers.get("upgrade") === "websocket") {
        const { socket, response } = Deno.upgradeWebSocket(req);

        socket.onopen = () => {
          this.clients.add(socket);
          console.log("Client connected");
        };

        socket.onmessage = async (event) => {
          await this.handleMessage(socket, event.data);
        };

        socket.onclose = () => {
          this.clients.delete(socket);
          console.log("Client disconnected");
        };

        socket.onerror = (error) => {
          console.error("WebSocket error:", error);
        };

        return response;
      }

      // Return 400 for non-WebSocket requests
      return new Response("WebSocket endpoint", { status: 400 });
    };

    const hostname = this.config.hostname || "0.0.0.0";
    const port = this.config.port;

    console.log(`Starting WebSocket server on ${hostname}:${port}`);
    this.server = Deno.serve({ hostname, port, handler });
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(
    socket: WebSocket,
    data: string,
  ): Promise<void> {
    try {
      const request: WebSocketRequest = JSON.parse(data);

      // Validate authentication if enabled
      if (this.config.auth?.enabled && this.config.auth.validateToken) {
        // TODO: Extract token from request and validate
        // For now, we'll skip auth validation
      }

      let response: WebSocketResponse;

      switch (request.type) {
        case "write":
          response = await this.handleWrite(request);
          break;
        case "read":
          response = await this.handleRead(request);
          break;
        case "list":
          response = await this.handleList(request);
          break;
        case "delete":
          response = await this.handleDelete(request);
          break;
        case "health":
          response = await this.handleHealth(request);
          break;
        default:
          response = {
            id: request.id,
            success: false,
            error: `Unknown request type: ${request.type}`,
          };
      }

      socket.send(JSON.stringify(response));
    } catch (error) {
      console.error("Error handling message:", error);
      const errorResponse: WebSocketResponse = {
        id: "unknown",
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      };
      socket.send(JSON.stringify(errorResponse));
    }
  }

  /**
   * Handle write request
   */
  private async handleWrite(
    request: WebSocketRequest,
  ): Promise<WebSocketResponse> {
    try {
      const { uri, value } = request.payload as {
        uri: string;
        value: unknown;
      };
      const result = await this.config.persistence.write(uri, value);

      return {
        id: request.id,
        success: result.success,
        data: result.record,
        error: result.error,
      };
    } catch (error) {
      return {
        id: request.id,
        success: false,
        error: error instanceof Error ? error.message : "Write failed",
      };
    }
  }

  /**
   * Handle read request
   */
  private async handleRead(
    request: WebSocketRequest,
  ): Promise<WebSocketResponse> {
    try {
      const { uri } = request.payload as { uri: string };
      const result = await this.config.persistence.read(uri);

      return {
        id: request.id,
        success: result.success,
        data: { record: result.record },
        error: result.error,
      };
    } catch (error) {
      return {
        id: request.id,
        success: false,
        error: error instanceof Error ? error.message : "Read failed",
      };
    }
  }

  /**
   * Handle list request
   */
  private async handleList(
    request: WebSocketRequest,
  ): Promise<WebSocketResponse> {
    try {
      const { uri, options } = request.payload as {
        uri: string;
        options?: any;
      };
      const result = await this.config.persistence.list(uri, options);

      return {
        id: request.id,
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        id: request.id,
        success: false,
        error: error instanceof Error ? error.message : "List failed",
      };
    }
  }

  /**
   * Handle delete request
   */
  private async handleDelete(
    request: WebSocketRequest,
  ): Promise<WebSocketResponse> {
    try {
      const { uri } = request.payload as { uri: string };
      const result = await this.config.persistence.delete(uri);

      return {
        id: request.id,
        success: result.success,
        error: result.error,
      };
    } catch (error) {
      return {
        id: request.id,
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
      };
    }
  }

  /**
   * Handle health request
   */
  private async handleHealth(
    request: WebSocketRequest,
  ): Promise<WebSocketResponse> {
    try {
      const result = await this.config.persistence.health();

      return {
        id: request.id,
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        id: request.id,
        success: false,
        error: error instanceof Error ? error.message : "Health check failed",
      };
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Close all client connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Shutdown server
    if (this.server) {
      await this.server.shutdown();
      this.server = null;
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }
}
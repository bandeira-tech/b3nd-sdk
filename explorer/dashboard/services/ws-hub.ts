/// <reference lib="deno.ns" />

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * WebSocket hub for broadcasting messages to all connected clients
 */
export class WsHub {
  private clients: Set<WebSocket> = new Set();
  private messageQueue: WsMessage[] = [];
  private flushInterval: number | null = null;

  constructor() {
    // Batch messages and flush every 50ms for efficiency
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 50);
  }

  /**
   * Add a new WebSocket client
   */
  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    console.log(`[WsHub] Client connected. Total clients: ${this.clients.size}`);

    ws.addEventListener("close", () => {
      this.clients.delete(ws);
      console.log(`[WsHub] Client disconnected. Total clients: ${this.clients.size}`);
    });

    ws.addEventListener("error", (e) => {
      console.error("[WsHub] WebSocket error:", e);
      this.clients.delete(ws);
    });
  }

  /**
   * Queue a message for broadcast
   */
  send(message: WsMessage): void {
    this.messageQueue.push(message);
  }

  /**
   * Immediately broadcast a message to all clients
   */
  broadcast(message: WsMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (e) {
          console.error("[WsHub] Failed to send message:", e);
          this.clients.delete(client);
        }
      }
    }
  }

  /**
   * Flush queued messages
   */
  private flush(): void {
    if (this.messageQueue.length === 0) return;

    const messages = this.messageQueue.splice(0);
    for (const message of messages) {
      this.broadcast(message);
    }
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Close all connections and cleanup
   */
  close(): void {
    if (this.flushInterval !== null) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();
  }
}

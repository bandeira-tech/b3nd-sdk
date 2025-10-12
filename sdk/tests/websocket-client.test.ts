/**
 * WebSocketClient tests with proper mocking
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { WebSocketClient } from "../clients/websocket/mod.ts";
import { runSharedSuite, type TestClientFactories } from "./shared-suite.ts";

/**
 * Mock WebSocket class that simulates WebSocket behavior without network
 */
class MockWebSocket {
  private listeners: Map<string, Set<(event: any) => void>> = new Map();
  private storage: Map<string, any> = new Map();
  private timers: Set<number> = new Set();
  readyState: number;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(public url: string) {
    this.readyState = MockWebSocket.CONNECTING;
    // Simulate connection opening after a short delay
    const timer = setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent({ type: 'open' });
    }, 10);
    this.timers.add(timer);
  }

  addEventListener(event: string, handler: (event: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  removeEventListener(event: string, handler: (event: any) => void) {
    this.listeners.get(event)?.delete(handler);
  }

  dispatchEvent(event: any) {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      handlers.forEach(handler => handler(event));
    }
  }

  send(data: string) {
    // Simulate server response
    const timer = setTimeout(() => {
      try {
        const request = JSON.parse(data);
        const response = this.generateResponse(request);
        this.dispatchEvent({
          type: 'message',
          data: JSON.stringify(response)
        });
      } catch (error) {
        this.dispatchEvent({
          type: 'error',
          error: 'Invalid request format'
        });
      }
    }, 5);
    this.timers.add(timer);
  }

  close(code?: number, reason?: string) {
    // Clear all timers
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent({ type: 'close', code, reason });
  }

  protected generateResponse(request: any): any {
    const responses = {
      write: () => {
        // Store the data
        this.storage.set(request.payload.uri, request.payload.value);
        return {
          id: request.id,
          success: true,
          data: {
            success: true,
            record: {
              ts: Date.now(),
              data: request.payload.value,
            },
          },
        };
      },
      read: () => {
        const data = this.storage.get(request.payload.uri);
        if (data) {
          return {
            id: request.id,
            success: true,
            data: {
              success: true,
              record: {
                ts: Date.now(),
                data: data,
              },
            },
          };
        } else {
          return {
            id: request.id,
            success: true,
            data: {
              success: false,
              error: "Not found",
            },
          };
        }
      },
      list: {
        id: request.id,
        success: true,
        data: {
          data: (() => {
            const allItems = [
              { uri: "users://alice/profile", type: "file" as const },
              { uri: "users://bob/profile", type: "file" as const },
              { uri: "users://charlie/profile", type: "file" as const },
            ];
            const pattern = request.payload.options?.pattern;
            if (pattern) {
              return allItems.filter(item => item.uri.includes(pattern));
            }
            return allItems;
          })(),
          pagination: {
            page: request.payload.options?.page || 1,
            limit: request.payload.options?.limit || 50,
            total: 3,
          },
        },
      },
      delete: () => {
        const existed = this.storage.has(request.payload.uri);
        if (existed) {
          this.storage.delete(request.payload.uri);
          return {
            id: request.id,
            success: true,
            data: { success: true },
          };
        } else {
          return {
            id: request.id,
            success: true,
            data: { success: false, error: "Not found" },
          };
        }
      },
      health: {
        id: request.id,
        success: true,
        data: {
          status: "healthy" as const,
          message: "WebSocket server is operational",
          details: {
            connectedClients: 1,
          },
        },
      },
      getSchema: {
        id: request.id,
        success: true,
        data: ["users://", "posts://"],
      },
    };

    const responseGenerator = responses[request.type as keyof typeof responses];
    if (responseGenerator) {
      return typeof responseGenerator === 'function' ? responseGenerator() : responseGenerator;
    } else {
      return {
        id: request.id,
        success: false,
        error: "Unknown request type",
      };
    }
  }
}

/**
 * Mock WebSocket implementation that replaces the global WebSocket
 */
function createMockWebSocketClient() {
  // Store original WebSocket
  const OriginalWebSocket = (globalThis as any).WebSocket;

  // Replace with mock
  (globalThis as any).WebSocket = MockWebSocket;

  return {
    restore: () => {
      (globalThis as any).WebSocket = OriginalWebSocket;
    }
  };
}

/**
 * Factory functions for shared test suite
 */
const factories: TestClientFactories = {
  happy: () => {
    const mock = createMockWebSocketClient();
    const client = new WebSocketClient({
      url: 'ws://localhost:8765',
      reconnect: { enabled: false },
    });

    // Override cleanup to also restore the mock
    const originalCleanup = client.cleanup.bind(client);
    client.cleanup = async () => {
      await originalCleanup();
      mock.restore();
    };

    return client;
  },

  connectionError: () => {
    const mock = createMockWebSocketClient();

    // Create a mock that simulates connection failure
    class FailingMockWebSocket extends MockWebSocket {
      constructor(url: string) {
        super(url);
        // Override to simulate connection failure - never open the connection
        this.readyState = MockWebSocket.CLOSED;
      }

      override send(data: string) {
        // Simulate connection failure when trying to send
        setTimeout(() => {
          this.dispatchEvent({ type: 'error', error: 'Connection failed' });
          this.dispatchEvent({ type: 'close', code: 1006, reason: 'Connection failed' });
        }, 5);
      }
    }

    (globalThis as any).WebSocket = FailingMockWebSocket;

    const client = new WebSocketClient({
      url: 'ws://localhost:8766', // Different port
      reconnect: { enabled: false },
    });

    // Override cleanup to also restore the mock
    const originalCleanup = client.cleanup.bind(client);
    client.cleanup = async () => {
      await originalCleanup();
      mock.restore();
    };

    return client;
  },

  validationError: () => {
    const mock = createMockWebSocketClient();

    // Create a mock that simulates validation failure
    class ValidationFailingMockWebSocket extends MockWebSocket {
      protected override generateResponse(request: any): any {
        if (request.type === 'write' && request.payload.uri.includes('invalid')) {
          return {
            id: request.id,
            success: true,
            data: {
              success: false,
              error: 'Validation failed: invalid data',
            },
          };
        }
        return super.generateResponse(request);
      }
    }

    (globalThis as any).WebSocket = ValidationFailingMockWebSocket;

    const client = new WebSocketClient({
      url: 'ws://localhost:8765',
      reconnect: { enabled: false },
    });

    // Override cleanup to also restore the mock
    const originalCleanup = client.cleanup.bind(client);
    client.cleanup = async () => {
      await originalCleanup();
      mock.restore();
    };

    return client;
  },
};

/**
 * Run shared test suite
 */
runSharedSuite("WebSocketClient", factories);

/**
 * WebSocket-specific tests
 */
Deno.test({
  name: "WebSocketClient - connection management",
  fn: async () => {
    const mock = createMockWebSocketClient();
    const client = new WebSocketClient({
      url: 'ws://localhost:8765',
      reconnect: { enabled: false },
    });

    // Wait for connection to establish
    await new Promise(resolve => setTimeout(resolve, 50));

    // First operation should work
    const writeResult = await client.write("users://test/data", { value: 123 });
    assertEquals(writeResult.success, true);

    await client.cleanup();
    mock.restore();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "WebSocketClient - reconnection configuration",
  fn: async () => {
    const mock = createMockWebSocketClient();
    const client = new WebSocketClient({
      url: 'ws://localhost:8765',
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        interval: 100,
        backoff: "linear",
      },
    });

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should work normally
    const result1 = await client.write("users://test/data", { value: 123 });
    assertEquals(result1.success, true);

    await client.cleanup();
    mock.restore();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "WebSocketClient - authentication configuration",
  fn: async () => {
    const mock = createMockWebSocketClient();
    const client = new WebSocketClient({
      url: 'ws://localhost:8765',
      auth: {
        type: "bearer",
        token: "test-token-123",
      },
      reconnect: { enabled: false },
    });

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should work with auth
    const result = await client.write("users://test/data", { value: 123 });
    assertEquals(result.success, true);

    await client.cleanup();
    mock.restore();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "WebSocketClient - timeout configuration",
  fn: async () => {
    const mock = createMockWebSocketClient();
    const client = new WebSocketClient({
      url: 'ws://localhost:8765',
      timeout: 5000,
      reconnect: { enabled: false },
    });

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should work with custom timeout
    const result = await client.write("users://test/data", { value: 123 });
    assertEquals(result.success, true);

    await client.cleanup();
    mock.restore();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
/**
 * Browser-compatible Instance Manager
 * Follows the same pattern as httpapi's ClientManager but for browser environments
 */

import type { B3ndClient } from "./types.ts";
import type { InstanceManager, InstancesConfig, InstanceConfig } from "./instance-config.ts";
import { createHttpClient, createWebSocketClient } from "./mod.ts";

/**
 * Mock client for browser testing (adapter pattern)
 */
class MockClient implements B3ndClient {
  private mockData = new Map<string, any>();

  async write<T>(uri: string, value: T) {
    const record = { ts: Date.now(), data: value };
    this.mockData.set(uri, record);
    return { success: true, record };
  }

  async read<T>(uri: string) {
    const record = this.mockData.get(uri);
    if (!record) {
      return { success: false, error: "Not found" };
    }
    return { success: true, record };
  }

  async list(uri: string, options?: any) {
    const entries = Array.from(this.mockData.keys())
      .filter(key => key.startsWith(uri))
      .map(key => ({
        uri: key,
        name: key.split('/').pop() || key,
        type: "file" as const,
      }));

    return {
      data: entries,
      pagination: {
        page: options?.page || 1,
        limit: options?.limit || 50,
      },
    };
  }

  async delete(uri: string) {
    if (this.mockData.has(uri)) {
      this.mockData.delete(uri);
      return { success: true };
    }
    return { success: false, error: "Not found" };
  }

  async health() {
    return { status: "healthy" as const, message: "Mock client operational" };
  }

  async getSchema() {
    return ["mock://example"];
  }

  async cleanup() {
    this.mockData.clear();
  }
}

/**
 * Browser Instance Manager
 */
export class BrowserInstanceManager implements InstanceManager {
  private clients = new Map<string, B3ndClient>();
  private defaultInstance?: string;

  async initialize(config: InstancesConfig): Promise<void> {
    this.defaultInstance = config.default;

    for (const [name, instanceConfig] of Object.entries(config.instances)) {
      const client = this.createClient(name, instanceConfig);
      this.clients.set(name, client);
      console.log(`[BrowserInstanceManager] Initialized instance '${name}'`);
    }

    // Set default to first instance if not specified
    if (!this.defaultInstance && this.clients.size > 0) {
      this.defaultInstance = this.clients.keys().next().value;
      console.log(`[BrowserInstanceManager] Using '${this.defaultInstance}' as default instance`);
    }
  }

  private createClient(name: string, config: InstanceConfig): B3ndClient {
    switch (config.type) {
      case "http":
        return createHttpClient(config.baseUrl, {
          instanceId: config.instanceId,
          headers: config.headers,
          timeout: config.timeout,
        });

      case "websocket":
        return createWebSocketClient(config.url, {
          auth: config.auth,
          reconnect: config.reconnect,
          timeout: config.timeout,
        });

      case "mock":
        return new MockClient();

      default:
        throw new Error(`Unknown client type: ${(config as InstanceConfig).type}`);
    }
  }

  getClient(name?: string): B3ndClient {
    const instanceName = name || this.defaultInstance;

    if (!instanceName) {
      throw new Error("No instance name provided and no default instance set");
    }

    const client = this.clients.get(instanceName);
    if (!client) {
      throw new Error(
        `Client instance '${instanceName}' not found. Available: ${
          Array.from(this.clients.keys()).join(", ")
        }`,
      );
    }

    return client;
  }

  getInstanceNames(): string[] {
    return Array.from(this.clients.keys());
  }

  getDefaultInstance(): string | undefined {
    return this.defaultInstance;
  }

  async getSchemas(): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    for (const [name, client] of this.clients) {
      result[name] = await client.getSchema();
    }
    return result;
  }

  async cleanup(): Promise<void> {
    const cleanupPromises = Array.from(this.clients.values()).map((client) =>
      client.cleanup()
    );
    await Promise.all(cleanupPromises);
    this.clients.clear();
  }
}

// Singleton instance for browser
let browserManagerInstance: BrowserInstanceManager | null = null;

/**
 * Get the singleton browser instance manager
 */
export function getBrowserInstanceManager(): BrowserInstanceManager {
  if (!browserManagerInstance) {
    browserManagerInstance = new BrowserInstanceManager();
  }
  return browserManagerInstance;
}

/**
 * Reset the browser instance manager (for testing)
 */
export function resetBrowserInstanceManager(): void {
  if (browserManagerInstance) {
    browserManagerInstance.cleanup();
    browserManagerInstance = null;
  }
}

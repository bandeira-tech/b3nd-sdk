/**
 * Client Instance Manager
 *
 * Simple manager for multiple B3ndClient instances.
 * Uses a Map to store name -> client mappings.
 */

import type { B3ndClient } from "../../client-sdk/mod.ts";
import { createLocalClient } from "../../client-sdk/mod.ts";
import { Persistence } from "../../persistence/mod.ts";

export interface ClientInstanceConfig {
  type: "local" | "http" | "websocket";
  schema?: string;
  options?: Record<string, unknown>;
}

export interface InstancesConfig {
  default?: string;
  instances: Record<string, ClientInstanceConfig>;
}

class ClientManager {
  private clients = new Map<string, B3ndClient>();
  private defaultInstance?: string;

  /**
   * Initialize clients from configuration
   */
  async initialize(config: InstancesConfig): Promise<void> {
    this.defaultInstance = config.default;

    for (const [name, instanceConfig] of Object.entries(config.instances)) {
      const client = await this.createClient(name, instanceConfig);
      this.clients.set(name, client);
      console.log(`[ClientManager] Initialized instance '${name}'`);
    }

    // Set default to first instance if not specified
    if (!this.defaultInstance && this.clients.size > 0) {
      this.defaultInstance = this.clients.keys().next().value;
      console.log(`[ClientManager] Using '${this.defaultInstance}' as default instance`);
    }
  }

  /**
   * Create a client instance based on configuration
   */
  private async createClient(
    name: string,
    config: ClientInstanceConfig,
  ): Promise<B3ndClient> {
    switch (config.type) {
      case "local": {
        // Load schema if provided
        let schema = {};
        if (config.schema) {
          schema = await this.loadSchema(config.schema);
        }

        // Create persistence instance
        const persistence = new Persistence({ schema });

        // Create local client
        return createLocalClient(persistence);
      }
      // TODO: Add http and websocket client types when needed
      default:
        throw new Error(`Unknown client type: ${config.type}`);
    }
  }

  /**
   * Load schema from TypeScript module
   */
  private async loadSchema(schemaPath: string): Promise<Record<string, any>> {
    const schemaUrl = new URL(schemaPath, `file://${Deno.cwd()}/`).href;
    const schemaModule = await import(schemaUrl);
    const schema = schemaModule.default || schemaModule.schema;

    if (!schema || typeof schema !== "object") {
      throw new Error(
        `Schema module at '${schemaPath}' must export a default object`,
      );
    }

    return schema;
  }

  /**
   * Get a client instance by name
   */
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

  /**
   * Get all client instance names
   */
  getInstanceNames(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get default instance name
   */
  getDefaultInstance(): string | undefined {
    return this.defaultInstance;
  }

  /**
   * Get schemas for all instances
   * Delegates to each client's getSchema() method
   */
  async getSchemas(): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    for (const [name, client] of this.clients) {
      result[name] = await client.getSchema();
    }
    return result;
  }

  /**
   * Cleanup all clients
   */
  async cleanup(): Promise<void> {
    const cleanupPromises = Array.from(this.clients.values()).map((client) =>
      client.cleanup()
    );
    await Promise.all(cleanupPromises);
    this.clients.clear();
  }
}

// Singleton instance
let managerInstance: ClientManager | null = null;

/**
 * Get the singleton client manager
 */
export function getClientManager(): ClientManager {
  if (!managerInstance) {
    managerInstance = new ClientManager();
  }
  return managerInstance;
}

/**
 * Reset the client manager (for testing)
 */
export function resetClientManager(): void {
  if (managerInstance) {
    managerInstance.cleanup();
    managerInstance = null;
  }
}

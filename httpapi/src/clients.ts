/**
 * Client Instance Manager
 *
 * Simple manager for multiple NodeProtocolInterface instances.
 * Works with pre-instantiated clients - no configuration mapping needed.
 * Developers create their own clients and register them here.
 */

import type { NodeProtocolInterface } from "@bandeira-tech/b3nd-sdk";

export interface ClientRegistration {
  name: string;
  client: NodeProtocolInterface;
  isDefault?: boolean;
}

export interface ClientManagerConfig {
  clients: ClientRegistration[];
}

class ClientManager {
  private clients = new Map<string, NodeProtocolInterface>();
  private defaultInstance?: string;

  /**
   * Initialize clients from pre-instantiated client registrations
   */
  async initialize(config: ClientManagerConfig): Promise<void> {
    for (const registration of config.clients) {
      this.clients.set(registration.name, registration.client);
      console.log(`[ClientManager] Registered instance '${registration.name}'`);

      if (registration.isDefault) {
        this.defaultInstance = registration.name;
      }
    }

    // Set default to first instance if not specified
    if (!this.defaultInstance && this.clients.size > 0) {
      this.defaultInstance = this.clients.keys().next().value;
      console.log(`[ClientManager] Using '${this.defaultInstance}' as default instance`);
    }
  }

  /**
   * Register a client instance directly
   */
  registerClient(name: string, client: NodeProtocolInterface, isDefault = false): void {
    this.clients.set(name, client);
    console.log(`[ClientManager] Registered instance '${name}'`);

    if (isDefault || (!this.defaultInstance && this.clients.size === 1)) {
      this.defaultInstance = name;
      console.log(`[ClientManager] Using '${name}' as default instance`);
    }
  }

  /**
   * Get a client instance by name
   */
  getClient(name?: string): NodeProtocolInterface {
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
    this.defaultInstance = undefined;
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
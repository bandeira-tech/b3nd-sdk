/**
 * Main Adapter Interface for HTTP API
 *
 * This module provides the adapter interface that the HTTP API routes use
 * to interact with persistence. It delegates to the AdapterManager which
 * handles multiple adapter instances based on configuration.
 */

import { AdapterManager } from "./adapters/manager.ts";
import type { PersistenceRecord, ListResult } from "./adapters/types.ts";

export interface PersistenceAdapter {
  write(
    protocol: string,
    domain: string,
    path: string,
    value: unknown,
    instanceId?: string,
  ): Promise<{
    success: boolean;
    record?: PersistenceRecord<unknown>;
    error?: string;
  }>;

  read(
    protocol: string,
    domain: string,
    path: string,
    instanceId?: string,
  ): Promise<PersistenceRecord<unknown> | null>;

  listPath(
    protocol: string,
    domain: string,
    path: string,
    options?: { page?: number; limit?: number },
    instanceId?: string,
  ): Promise<ListResult>;

  delete(
    protocol: string,
    domain: string,
    path: string,
    instanceId?: string,
  ): Promise<{ success: boolean; error?: string }>;
}

/**
 * Main adapter implementation that delegates to AdapterManager
 */
class ManagedPersistenceAdapter implements PersistenceAdapter {
  private manager: AdapterManager;
  private initialized = false;

  constructor() {
    this.manager = AdapterManager.getInstance();
  }

  /**
   * Ensure the adapter manager is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      try {
        await this.manager.initialize();
        this.initialized = true;
      } catch (error) {
        console.error("Failed to initialize adapter manager:", error);
        throw new Error(`Adapter initialization failed: ${error}`);
      }
    }
  }

  async write(
    protocol: string,
    domain: string,
    path: string,
    value: unknown,
    instanceId?: string,
  ): Promise<{
    success: boolean;
    record?: PersistenceRecord<unknown>;
    error?: string;
  }> {
    try {
      await this.ensureInitialized();
      const adapter = this.manager.getAdapter(instanceId);
      return await adapter.write(protocol, domain, path, value);
    } catch (error) {
      console.error(`Write error for instance '${instanceId}':`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Write failed",
      };
    }
  }

  async read(
    protocol: string,
    domain: string,
    path: string,
    instanceId?: string,
  ): Promise<PersistenceRecord<unknown> | null> {
    try {
      await this.ensureInitialized();
      const adapter = this.manager.getAdapter(instanceId);
      return await adapter.read(protocol, domain, path);
    } catch (error) {
      console.error(`Read error for instance '${instanceId}':`, error);
      return null;
    }
  }

  async listPath(
    protocol: string,
    domain: string,
    path: string,
    options?: { page?: number; limit?: number },
    instanceId?: string,
  ): Promise<ListResult> {
    try {
      await this.ensureInitialized();
      const adapter = this.manager.getAdapter(instanceId);
      return await adapter.listPath(protocol, domain, path, options);
    } catch (error) {
      console.error(`List error for instance '${instanceId}':`, error);
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

  async delete(
    protocol: string,
    domain: string,
    path: string,
    instanceId?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      const adapter = this.manager.getAdapter(instanceId);
      return await adapter.delete(protocol, domain, path);
    } catch (error) {
      console.error(`Delete error for instance '${instanceId}':`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
      };
    }
  }

  /**
   * Get health status of all adapters
   */
  async health(): Promise<Map<string, any>> {
    try {
      await this.ensureInitialized();
      return await this.manager.checkHealth();
    } catch (error) {
      console.error("Health check error:", error);
      return new Map([
        [
          "error",
          {
            status: "unhealthy",
            message: "Health check failed",
            error: error instanceof Error ? error.message : "Unknown error",
          },
        ],
      ]);
    }
  }

  /**
   * Cleanup all adapters
   */
  async cleanup(): Promise<void> {
    if (this.initialized) {
      await this.manager.cleanup();
      this.initialized = false;
    }
  }
}

// Singleton instance
let adapterInstance: ManagedPersistenceAdapter | null = null;

/**
 * Get the singleton adapter instance
 */
export function getAdapter(): PersistenceAdapter {
  if (!adapterInstance) {
    adapterInstance = new ManagedPersistenceAdapter();
  }
  return adapterInstance;
}

/**
 * Reset the adapter (mainly for testing)
 */
export async function resetAdapter(): Promise<void> {
  if (adapterInstance) {
    await adapterInstance.cleanup();
    adapterInstance = null;
  }
  AdapterManager.reset();
}

// Export types for convenience
export type { PersistenceRecord, ListResult } from "./adapters/types.ts";

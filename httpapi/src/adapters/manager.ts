/**
 * Adapter Manager
 *
 * Manages persistence adapter instances, loading them from configuration
 * and providing a unified interface for the HTTP API server.
 */

import {
  type PersistenceAdapter,
  type AdapterConfig,
  type InstanceConfig,
  type InstancesConfig,
  AdapterError,
} from "./types.ts";

export class AdapterManager {
  private static instance: AdapterManager | null = null;
  private adapters = new Map<string, PersistenceAdapter>();
  private config?: InstancesConfig;
  private defaultInstance?: string;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance of AdapterManager
   */
  static getInstance(): AdapterManager {
    if (!AdapterManager.instance) {
      AdapterManager.instance = new AdapterManager();
    }
    return AdapterManager.instance;
  }

  /**
   * Initialize the adapter manager with configuration
   */
  async initialize(configPath?: string): Promise<void> {
    try {
      // Load instances configuration
      this.config = await this.loadInstancesConfig(configPath);

      if (
        !this.config.instances ||
        Object.keys(this.config.instances).length === 0
      ) {
        throw new Error("No instances configured");
      }

      // Set default instance
      this.defaultInstance = this.config.default;

      // If no default is set, use the first instance
      if (!this.defaultInstance) {
        this.defaultInstance = Object.keys(this.config.instances)[0];
        console.warn(
          `[AdapterManager] No default instance configured, using '${this.defaultInstance}'`,
        );
      }

      // Load all configured instances
      await this.loadAllInstances();

      console.log(
        `[AdapterManager] Initialized with ${this.adapters.size} instance(s)`,
      );
    } catch (error) {
      console.error(`[AdapterManager] Initialization failed:`, error);
      throw error;
    }
  }

  /**
   * Load instances configuration from file
   */
  private async loadInstancesConfig(
    configPath?: string,
  ): Promise<InstancesConfig> {
    const path = configPath || "./config/instances.json";

    try {
      const content = await Deno.readTextFile(path);
      const config = JSON.parse(content) as InstancesConfig;

      console.log(`[AdapterManager] Loaded configuration from ${path}`);
      return config;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`Configuration file not found: ${path}`);
      }
      throw new Error(`Failed to load configuration from ${path}: ${error}`);
    }
  }

  /**
   * Load all configured instances
   */
  private async loadAllInstances(): Promise<void> {
    if (!this.config?.instances) {
      throw new Error("No instances configuration available");
    }

    const loadPromises: Promise<void>[] = [];

    for (const [instanceId, instanceConfig] of Object.entries(
      this.config.instances,
    )) {
      loadPromises.push(this.loadInstance(instanceId, instanceConfig));
    }

    await Promise.all(loadPromises);
  }

  /**
   * Load a single instance
   */
  private async loadInstance(
    instanceId: string,
    instanceConfig: InstanceConfig,
  ): Promise<void> {
    try {
      console.log(
        `[AdapterManager] Loading instance '${instanceId}' from ${instanceConfig.adapter}`,
      );

      // Load the adapter module
      const adapterModule = await this.loadAdapterModule(
        instanceConfig.adapter,
      );

      // Create adapter configuration
      const adapterConfig: AdapterConfig = {
        id: instanceId,
        ...instanceConfig.config,
      };

      // Create adapter instance
      const adapter = await this.createAdapterInstance(
        adapterModule,
        adapterConfig,
      );

      // Store the adapter
      this.adapters.set(instanceId, adapter);

      console.log(
        `[AdapterManager] Successfully loaded instance '${instanceId}'`,
      );
    } catch (error) {
      console.error(
        `[AdapterManager] Failed to load instance '${instanceId}':`,
        error,
      );
      // Preserve the original error with its stack trace
      if (error instanceof Error) {
        error.message = `Failed to load instance '${instanceId}': ${error.message}`;
        throw error;
      }
      throw new Error(`Failed to load instance '${instanceId}': ${error}`);
    }
  }

  /**
   * Load an adapter module
   */
  private async loadAdapterModule(adapterPath: string): Promise<any> {
    try {
      // Handle built-in adapters
      if (adapterPath.startsWith("@adapters/")) {
        const adapterName = adapterPath.replace("@adapters/", "");
        const modulePath = new URL(`./${adapterName}.ts`, import.meta.url).href;
        return await import(modulePath);
      }

      // Handle external module paths
      const modulePath = new URL(adapterPath, `file://${Deno.cwd()}/`).href;
      return await import(modulePath);
    } catch (error) {
      throw new Error(
        `Failed to load adapter module '${adapterPath}': ${error}`,
      );
    }
  }

  /**
   * Create an adapter instance from a module
   */
  private async createAdapterInstance(
    module: any,
    config: AdapterConfig,
  ): Promise<PersistenceAdapter> {
    // Check if module has a default export (factory function)
    if (typeof module.default === "function") {
      const adapter = await module.default(config);
      if (this.isPersistenceAdapter(adapter)) {
        return adapter;
      }
      throw new Error(
        "Factory function did not return a valid PersistenceAdapter",
      );
    }

    // Check if module exports a factory function by convention
    const factoryName = `create${config.type.charAt(0).toUpperCase() + config.type.slice(1)}Adapter`;
    if (typeof module[factoryName] === "function") {
      const adapter = await module[factoryName](config);
      if (this.isPersistenceAdapter(adapter)) {
        return adapter;
      }
      throw new Error(
        `${factoryName} did not return a valid PersistenceAdapter`,
      );
    }

    // Check if module exports a class
    const className = `${config.type.charAt(0).toUpperCase() + config.type.slice(1)}Adapter`;
    if (module[className] && typeof module[className] === "function") {
      const adapter = new module[className]();
      if (this.isPersistenceAdapter(adapter)) {
        await adapter.initialize(config);
        return adapter;
      }
      throw new Error(`${className} is not a valid PersistenceAdapter`);
    }

    throw new Error(`Module does not export a valid adapter factory or class`);
  }

  /**
   * Check if an object implements the PersistenceAdapter interface
   */
  private isPersistenceAdapter(obj: any): obj is PersistenceAdapter {
    return (
      obj &&
      typeof obj.initialize === "function" &&
      typeof obj.write === "function" &&
      typeof obj.read === "function" &&
      typeof obj.listPath === "function" &&
      typeof obj.delete === "function" &&
      typeof obj.health === "function" &&
      typeof obj.cleanup === "function"
    );
  }

  /**
   * Get an adapter instance by ID
   */
  getAdapter(instanceId?: string): PersistenceAdapter {
    const id = instanceId || this.defaultInstance;

    if (!id) {
      throw new AdapterError(
        "No instance ID provided and no default instance configured",
        "NO_INSTANCE",
      );
    }

    const adapter = this.adapters.get(id);

    if (!adapter) {
      throw new AdapterError(
        `Instance '${id}' not found`,
        "INSTANCE_NOT_FOUND",
        { availableInstances: Array.from(this.adapters.keys()) },
      );
    }

    return adapter;
  }

  /**
   * Get all loaded adapter instances
   */
  getAllAdapters(): Map<string, PersistenceAdapter> {
    return new Map(this.adapters);
  }

  /**
   * Get the default instance ID
   */
  getDefaultInstanceId(): string | undefined {
    return this.defaultInstance;
  }

  /**
   * Check health of all adapters
   */
  async checkHealth(): Promise<Map<string, any>> {
    const healthChecks = new Map<string, any>();

    for (const [id, adapter] of this.adapters) {
      try {
        const health = await adapter.health();
        healthChecks.set(id, health);
      } catch (error) {
        healthChecks.set(id, {
          status: "unhealthy",
          message: "Health check failed",
          error: error instanceof Error ? error.message : "Unknown error",
          lastCheck: Date.now(),
        });
      }
    }

    return healthChecks;
  }

  /**
   * Reload a specific instance
   */
  async reloadInstance(instanceId: string): Promise<void> {
    if (!this.config?.instances[instanceId]) {
      throw new AdapterError(
        `Instance '${instanceId}' not found in configuration`,
        "INSTANCE_NOT_FOUND",
      );
    }

    // Clean up existing instance
    const existingAdapter = this.adapters.get(instanceId);
    if (existingAdapter) {
      await existingAdapter.cleanup();
      this.adapters.delete(instanceId);
    }

    // Load the instance again
    await this.loadInstance(instanceId, this.config.instances[instanceId]);
  }

  /**
   * Cleanup all adapters
   */
  async cleanup(): Promise<void> {
    console.log(
      `[AdapterManager] Cleaning up ${this.adapters.size} adapter(s)`,
    );

    const cleanupPromises: Promise<void>[] = [];

    for (const [id, adapter] of this.adapters) {
      cleanupPromises.push(
        adapter.cleanup().catch((error) => {
          console.error(
            `[AdapterManager] Error cleaning up instance '${id}':`,
            error,
          );
        }),
      );
    }

    await Promise.all(cleanupPromises);
    this.adapters.clear();

    console.log(`[AdapterManager] Cleanup complete`);
  }

  /**
   * Reset the singleton instance (mainly for testing)
   */
  static reset(): void {
    if (AdapterManager.instance) {
      // Don't await cleanup in reset
      AdapterManager.instance.cleanup().catch((error) => {
        console.error(`[AdapterManager] Error during reset cleanup:`, error);
      });
      AdapterManager.instance = null;
    }
  }
}

// Export singleton getter for convenience
export const getAdapterManager = AdapterManager.getInstance;

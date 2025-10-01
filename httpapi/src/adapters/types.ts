/**
 * Persistence Adapter Types and Interfaces
 *
 * Defines the contract for persistence adapters that can be used
 * with the HTTP API server. All adapters must implement these interfaces.
 */

import type {
  PersistenceRecord,
  PersistenceValidationFn,
  PersistenceWrite,
} from "../../../persistence/mod.ts";

/**
 * Base persistence adapter interface
 * All adapter implementations must conform to this interface
 */
export interface PersistenceAdapter {
  /**
   * Initialize the adapter with configuration
   */
  initialize(config: AdapterConfig): Promise<void>;

  /**
   * Write data to persistence
   */
  write(
    protocol: string,
    domain: string,
    path: string,
    value: unknown,
  ): Promise<{
    success: boolean;
    record?: PersistenceRecord<unknown>;
    error?: string;
  }>;

  /**
   * Read data from persistence
   */
  read(
    protocol: string,
    domain: string,
    path: string,
  ): Promise<PersistenceRecord<unknown> | null>;

  /**
   * List items in a path
   */
  listPath(
    protocol: string,
    domain: string,
    path: string,
    options?: ListOptions,
  ): Promise<ListResult>;

  /**
   * Delete data from persistence
   */
  delete(
    protocol: string,
    domain: string,
    path: string,
  ): Promise<{ success: boolean; error?: string }>;

  /**
   * Get adapter health/status
   */
  health(): Promise<HealthStatus>;

  /**
   * Cleanup resources (called on shutdown)
   */
  cleanup(): Promise<void>;
}

/**
 * Configuration for an adapter instance
 */
export interface AdapterConfig {
  /**
   * Unique identifier for this instance
   */
  id: string;

  /**
   * Type of adapter (local-evergreen, local-denokv, websocket, etc.)
   */
  type: string;

  /**
   * Path to schema TypeScript module that exports a map of URL patterns to validation functions
   */
  schema?: string;

  /**
   * Adapter-specific options
   */
  options?: Record<string, unknown>;
}

/**
 * Options for listing paths
 */
export interface ListOptions {
  page?: number;
  limit?: number;
  pattern?: string;
  sortBy?: "name" | "timestamp";
  sortOrder?: "asc" | "desc";
}

/**
 * Result of a list operation
 */
export interface ListResult {
  data: Array<string>;
  pagination: {
    page: number;
    limit: number;
  };
}

/**
 * Health status of an adapter
 */
export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  details?: Record<string, unknown>;
  lastCheck: number;
}

/**
 * Factory function type for creating adapter instances
 */
export type AdapterFactory = (
  config: AdapterConfig,
) => Promise<PersistenceAdapter>;

/**
 * Registry of available adapter types
 */
export interface AdapterRegistry {
  [key: string]: AdapterFactory;
}

/**
 * Instance configuration from the instances config file
 */
export interface InstanceConfig {
  /**
   * Path to the adapter module
   */
  adapter: string;

  /**
   * Configuration to pass to the adapter
   */
  config: Omit<AdapterConfig, "id">;
}

/**
 * Full instances configuration
 */
export interface InstancesConfig {
  /**
   * Map of instance names to their configurations
   */
  instances: Record<string, InstanceConfig>;

  /**
   * Default instance name (optional)
   */
  default?: string;
}

/**
 * Connection configuration for WebSocket adapters
 */
export interface WebSocketConfig {
  /**
   * WebSocket connection URL
   */
  url: string;

  /**
   * Authentication token or credentials
   */
  auth?: {
    type: "bearer" | "basic" | "custom";
    token?: string;
    username?: string;
    password?: string;
    custom?: Record<string, unknown>;
  };

  /**
   * Reconnection options
   */
  reconnect?: {
    enabled: boolean;
    maxAttempts?: number;
    interval?: number;
    backoff?: "linear" | "exponential";
  };

  /**
   * Request timeout in milliseconds
   */
  timeout?: number;

  /**
   * Enable compression
   */
  compression?: boolean;
}

/**
 * Storage options for local adapters
 */
export interface LocalStorageOptions {
  /**
   * Storage backend type
   */
  type: "memory" | "denokv" | "file";

  /**
   * Path for file-based storage
   */
  path?: string;

  /**
   * Enable persistence across restarts (for denokv)
   */
  persistent?: boolean;

  /**
   * Auto-save interval in milliseconds (for denokv)
   */
  autoSaveInterval?: number;

  /**
   * Maximum storage size in bytes (optional)
   */
  maxSize?: number;
}

/**
 * Base adapter class with common functionality
 */
export abstract class BaseAdapter implements PersistenceAdapter {
  protected config!: AdapterConfig;
  protected schema?: Record<string, PersistenceValidationFn<unknown>>;
  protected initialized = false;

  async initialize(config: AdapterConfig): Promise<void> {
    this.config = config;

    // Load schema if provided
    if (config.schema) {
      this.schema = await this.loadSchema(config.schema);
    }

    // Call adapter-specific initialization
    await this.doInitialize();
    this.initialized = true;
  }

  protected abstract doInitialize(): Promise<void>;

  protected async loadSchema(
    schemaPath: string,
  ): Promise<Record<string, PersistenceValidationFn<unknown>>> {
    console.log({ schemaPath });

    // Load TypeScript module with validation functions
    const schemaUrl = new URL(schemaPath, `file://${Deno.cwd()}/`).href;
    console.log({ schemaUrl });

    const schemaModule = await import(schemaUrl);
    const schema = schemaModule.default || schemaModule.schema;

    if (!schema || typeof schema !== "object") {
      throw new Error(
        `Schema module at '${schemaPath}' must export a default object mapping URL patterns to validation functions`,
      );
    }

    // Validate that all values are functions
    for (const [key, value] of Object.entries(schema)) {
      if (typeof value !== "function") {
        throw new Error(
          `Schema key '${key}' must map to a validation function, got ${typeof value}`,
        );
      }
    }

    return schema as Record<string, PersistenceValidationFn<unknown>>;
  }

  protected buildUri(protocol: string, domain: string, path: string): string {
    const normalizedPath = path.startsWith("/") ? path : "/" + path;
    return `${protocol}://${domain}${normalizedPath}`;
  }

  async health(): Promise<HealthStatus> {
    return {
      status: this.initialized ? "healthy" : "unhealthy",
      message: this.initialized
        ? "Adapter is operational"
        : "Adapter not initialized",
      lastCheck: Date.now(),
    };
  }

  abstract write(
    protocol: string,
    domain: string,
    path: string,
    value: unknown,
  ): Promise<{
    success: boolean;
    record?: PersistenceRecord<unknown>;
    error?: string;
  }>;

  abstract read(
    protocol: string,
    domain: string,
    path: string,
  ): Promise<PersistenceRecord<unknown> | null>;

  abstract listPath(
    protocol: string,
    domain: string,
    path: string,
    options?: ListOptions,
  ): Promise<ListResult>;

  abstract delete(
    protocol: string,
    domain: string,
    path: string,
  ): Promise<{ success: boolean; error?: string }>;

  abstract cleanup(): Promise<void>;
}

/**
 * Error thrown when an adapter operation fails
 */
export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

/**
 * Validation helper for adapter configuration
 */
export function validateAdapterConfig(
  config: unknown,
): config is AdapterConfig {
  if (!config || typeof config !== "object") {
    return false;
  }

  const c = config as Record<string, unknown>;

  return (
    typeof c.id === "string" &&
    typeof c.type === "string" &&
    (c.schema === undefined ||
      typeof c.schema === "string" ||
      typeof c.schema === "object")
  );
}

/**
 * Shared Instance Configuration Types and Manager Pattern
 * Used by both httpapi (server-side) and explorer (browser) for consistent instance management
 * Each application maintains its own configuration, but uses the same management pattern
 */

import type { B3ndClient } from "./types.ts";

/**
 * Base configuration for all instance types
 */
export interface BaseInstanceConfig {
  type: "http" | "websocket" | "mock";
  name?: string;
}

/**
 * HTTP instance configuration
 */
export interface HttpInstanceConfig extends BaseInstanceConfig {
  type: "http";
  baseUrl: string;
  instanceId?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * WebSocket instance configuration
 */
export interface WebSocketInstanceConfig extends BaseInstanceConfig {
  type: "websocket";
  url: string;
  auth?: {
    type: "bearer" | "basic" | "custom";
    token?: string;
    username?: string;
    password?: string;
    custom?: Record<string, unknown>;
  };
  reconnect?: {
    enabled: boolean;
    maxAttempts?: number;
    interval?: number;
    backoff?: "linear" | "exponential";
  };
  timeout?: number;
}

/**
 * Mock instance configuration (browser-only)
 */
export interface MockInstanceConfig extends BaseInstanceConfig {
  type: "mock";
  // Mock-specific options can be added here
}

/**
 * Union type for all instance configurations
 */
export type InstanceConfig = HttpInstanceConfig | WebSocketInstanceConfig | MockInstanceConfig;

/**
 * Instances configuration file format
 */
export interface InstancesConfig {
  default?: string;
  instances: Record<string, InstanceConfig>;
}

/**
 * Base instance manager interface that both server and browser implementations follow
 */
export interface InstanceManager {
  /**
   * Initialize clients from configuration
   */
  initialize(config: InstancesConfig): Promise<void>;

  /**
   * Get a client instance by name
   */
  getClient(name?: string): B3ndClient;

  /**
   * Get all client instance names
   */
  getInstanceNames(): string[];

  /**
   * Get default instance name
   */
  getDefaultInstance(): string | undefined;

  /**
   * Get schemas for all instances
   */
  getSchemas(): Promise<Record<string, string[]>>;

  /**
   * Cleanup all clients
   */
  cleanup(): Promise<void>;
}

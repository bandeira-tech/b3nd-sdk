/**
 * Client SDK Adapter
 *
 * A persistence adapter that uses the b3nd/client-sdk to connect to
 * various backend types (HTTP, WebSocket, Local). This provides a unified
 * interface for connecting to different persistence backends.
 */

import {
  type AdapterConfig,
  AdapterError,
  BaseAdapter,
  type ListOptions,
  type ListResult,
  type PersistenceRecord,
} from "./types.ts";
import type { B3ndClient } from "../../../client-sdk/mod.ts";
import { createClient } from "../../../client-sdk/mod.ts";

export interface ClientSdkAdapterConfig {
  /**
   * Client configuration to pass to the SDK
   */
  clientConfig: {
    type: "http" | "websocket" | "local";
    [key: string]: unknown;
  };
}

export class ClientSdkAdapter extends BaseAdapter {
  private client!: B3ndClient;

  protected async doInitialize(): Promise<void> {
    const options = this.config.options as ClientSdkAdapterConfig;
    if (!options?.clientConfig) {
      throw new AdapterError(
        "Client configuration is required",
        "CONFIG_ERROR",
        { config: this.config },
      );
    }

    try {
      // Create client using the SDK
      this.client = createClient(options.clientConfig as any);

      console.log(
        `[ClientSdkAdapter] Initialized instance '${this.config.id}' with ${options.clientConfig.type} client`,
      );
    } catch (error) {
      throw new AdapterError(
        "Failed to initialize client",
        "INIT_ERROR",
        { error, config: options.clientConfig },
      );
    }
  }

  async write(
    protocol: string,
    domain: string,
    path: string,
    value: unknown,
  ): Promise<{
    success: boolean;
    record?: PersistenceRecord<unknown>;
    error?: string;
  }> {
    try {
      const uri = this.buildUri(protocol, domain, path);
      const result = await this.client.write(uri, value);

      return result;
    } catch (error) {
      console.error(`[ClientSdkAdapter] Write error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown write error",
      };
    }
  }

  async read(
    protocol: string,
    domain: string,
    path: string,
  ): Promise<PersistenceRecord<unknown> | null> {
    try {
      const uri = this.buildUri(protocol, domain, path);
      const result = await this.client.read(uri);

      if (!result.success) {
        return null;
      }

      return result.record || null;
    } catch (error) {
      console.error(`[ClientSdkAdapter] Read error:`, error);
      return null;
    }
  }

  async listPath(
    protocol: string,
    domain: string,
    path: string,
    options: ListOptions = {},
  ): Promise<ListResult> {
    console.log("adapter/client-sdk");
    try {
      const uri = this.buildUri(protocol, domain, path);
      const result = await this.client.list(uri, options);

      return result;
    } catch (error) {
      console.error(`[ClientSdkAdapter] List error:`, error);
      return {
        data: [],
        pagination: {
          page: options.page || 1,
          limit: options.limit || 50,
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
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const uri = this.buildUri(protocol, domain, path);
      const result = await this.client.delete(uri);

      return result;
    } catch (error) {
      console.error(`[ClientSdkAdapter] Delete error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown delete error",
      };
    }
  }

  async cleanup(): Promise<void> {
    console.log(`[ClientSdkAdapter] Cleaning up instance '${this.config.id}'`);
    await this.client.cleanup();
  }

  async health(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
    details?: Record<string, unknown>;
    lastCheck: number;
  }> {
    try {
      const result = await this.client.health();
      return {
        status: result.status,
        message: result.message,
        lastCheck: Date.now(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: "Health check failed",
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        lastCheck: Date.now(),
      };
    }
  }
}

/**
 * Factory function for creating ClientSdkAdapter instances
 */
export async function createClientSdkAdapter(
  config: AdapterConfig,
): Promise<ClientSdkAdapter> {
  const adapter = new ClientSdkAdapter();
  await adapter.initialize(config);
  return adapter;
}

// Export as default for module loading
export default createClientSdkAdapter;

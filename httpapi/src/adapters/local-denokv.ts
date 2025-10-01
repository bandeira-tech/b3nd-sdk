/// <reference lib="deno.unstable" />
/**
 * Local Deno KV Adapter
 *
 * A persistence adapter that uses Deno KV for storage, providing
 * persistence across server restarts. Data is stored in a local
 * Deno KV database and can be configured with auto-save intervals.
 */

import {
  Persistence,
  type PersistenceRecord,
  type PersistenceWrite,
} from "../../../persistence/mod.ts";
import {
  type AdapterConfig,
  AdapterError,
  BaseAdapter,
  type ListOptions,
  type ListResult,
  type LocalStorageOptions,
} from "./types.ts";

export class LocalDenoKvAdapter extends BaseAdapter {
  private persistence!: Persistence<unknown>;
  private kv!: Deno.Kv;
  private kvPath?: string;
  private autoSaveTimer?: number;
  private isDirty = false;

  protected async doInitialize(): Promise<void> {
    const options = this.config.options as LocalStorageOptions | undefined;

    // Open Deno KV database
    this.kvPath = options?.path || `./${this.config.id}.db`;

    // Ensure parent directory exists
    const dir = this.kvPath.substring(0, this.kvPath.lastIndexOf("/"));
    if (dir) {
      try {
        await Deno.mkdir(dir, { recursive: true });
      } catch (error) {
        // Ignore if directory already exists
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          throw error;
        }
      }
    }

    this.kv = await Deno.openKv(this.kvPath);

    // Initialize persistence with schema
    this.persistence = new Persistence({
      schema: this.schema || {},
    });

    // Load existing data from KV
    await this.loadFromKv();

    // Set up auto-save if configured
    if (options?.autoSaveInterval && options.autoSaveInterval > 0) {
      this.setupAutoSave(options.autoSaveInterval);
    }

    console.log(
      `[LocalDenoKvAdapter] Initialized instance '${this.config.id}' with Deno KV at ${this.kvPath}`,
    );
  }

  private async loadFromKv(): Promise<void> {
    try {
      const storage = (this.persistence as any).storage;

      // List all keys and load data
      const entries = this.kv.list({ prefix: ["data"] });
      for await (const entry of entries) {
        const key = entry.key as string[];
        if (key.length === 5 && key[0] === "data") {
          // Format: ["data", protocol, domain, pathname, "record"]
          const protocol = key[1];
          const domain = key[2];
          const pathname = key[3];
          const record = entry.value as PersistenceRecord<unknown>;

          // Recreate storage structure
          if (!storage[protocol]) {
            storage[protocol] = {};
          }
          if (!storage[protocol][domain]) {
            storage[protocol][domain] = {};
          }
          storage[protocol][domain][pathname] = record;
        }
      }

      console.log(`[LocalDenoKvAdapter] Loaded existing data from Deno KV`);
    } catch (error) {
      console.error(`[LocalDenoKvAdapter] Error loading from KV:`, error);
    }
  }

  private setupAutoSave(interval: number): void {
    this.autoSaveTimer = setInterval(async () => {
      if (this.isDirty) {
        await this.saveToKv();
        this.isDirty = false;
      }
    }, interval);

    console.log(
      `[LocalDenoKvAdapter] Auto-save enabled with interval: ${interval}ms`,
    );
  }

  private async saveToKv(): Promise<void> {
    try {
      const storage = (this.persistence as any).storage;

      // Create atomic transaction
      const atomic = this.kv.atomic();

      // Clear existing data
      const existingKeys = this.kv.list({ prefix: ["data"] });
      for await (const entry of existingKeys) {
        atomic.delete(entry.key);
      }

      // Save all current data
      for (const [protocol, domains] of Object.entries(storage)) {
        for (
          const [domain, paths] of Object.entries(
            domains as Record<string, unknown>,
          )
        ) {
          for (
            const [pathname, record] of Object.entries(
              paths as Record<string, unknown>,
            )
          ) {
            const key = ["data", protocol, domain, pathname, "record"];
            atomic.set(key, record);
          }
        }
      }

      // Commit transaction
      const result = await atomic.commit();
      if (!result.ok) {
        throw new Error("Failed to commit KV transaction");
      }

      console.log(`[LocalDenoKvAdapter] Saved data to Deno KV`);
    } catch (error) {
      console.error(`[LocalDenoKvAdapter] Error saving to KV:`, error);
      throw error;
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
      const write: PersistenceWrite<unknown> = { uri, value };

      // Use persistence for validation and processing
      const [error, record] = await this.persistence.write(write);

      if (error) {
        return {
          success: false,
          error: error.message || "Write validation failed",
        };
      }

      if (record) {
        // Save to KV immediately for important writes
        const pathname = path.startsWith("/") ? path : "/" + path;
        const key = ["data", protocol, domain, pathname, "record"];
        await this.kv.set(key, record);
        this.isDirty = true;
      }

      return { success: true, record };
    } catch (error) {
      console.error(`[LocalDenoKvAdapter] Write error:`, error);
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
      // First try to read from persistence instance (in-memory cache)
      const uri = this.buildUri(protocol, domain, path);
      const record = await this.persistence.read(uri);
      if (record) {
        return record;
      }

      // Fallback to KV store
      const pathname = path.startsWith("/") ? path : "/" + path;
      const key = ["data", protocol, domain, pathname, "record"];
      const kvEntry = await this.kv.get<PersistenceRecord<unknown>>(key);

      return kvEntry.value || null;
    } catch (error) {
      console.error(`[LocalDenoKvAdapter] Read error:`, error);
      return null;
    }
  }
  async listPath(
    protocol: string,
    domain: string,
    path: string,
    options: ListOptions = {},
  ): Promise<ListResult> {
    let data = Object.keys(
      this.persistence.storage[`${protocol}:`][domain] ?? {},
    );

    return Promise.resolve({
      data,
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        hasNext: false,
        hasPrev: false,
      },
    });
  }

  async delete(
    protocol: string,
    domain: string,
    path: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const pathname = path.startsWith("/") ? path : "/" + path;

      // Delete from KV store
      const key = ["data", protocol, domain, pathname, "record"];
      await this.kv.delete(key);

      // Also delete from in-memory persistence
      const storage = (this.persistence as any).storage;
      if (storage[protocol]?.[domain]?.[pathname]) {
        delete storage[protocol][domain][pathname];

        // Clean up empty structures
        if (Object.keys(storage[protocol][domain]).length === 0) {
          delete storage[protocol][domain];
        }
        if (Object.keys(storage[protocol]).length === 0) {
          delete storage[protocol];
        }
      }

      this.isDirty = true;
      return { success: true };
    } catch (error) {
      console.error(`[LocalDenoKvAdapter] Delete error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown delete error",
      };
    }
  }

  async cleanup(): Promise<void> {
    console.log(
      `[LocalDenoKvAdapter] Cleaning up instance '${this.config.id}'`,
    );

    // Stop auto-save timer
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    // Save any pending changes
    if (this.isDirty) {
      await this.saveToKv();
    }

    // Close KV connection
    this.kv.close();
  }

  async health(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
    details?: Record<string, unknown>;
    lastCheck: number;
  }> {
    try {
      // Test KV connection with a simple operation
      const testKey = ["health", "check"];
      await this.kv.set(testKey, Date.now());
      await this.kv.delete(testKey);

      return {
        status: "healthy",
        message: "Deno KV adapter is operational",
        details: {
          kvPath: this.kvPath,
          isDirty: this.isDirty,
        },
        lastCheck: Date.now(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: "Deno KV connection error",
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        lastCheck: Date.now(),
      };
    }
  }
}

/**
 * Factory function for creating LocalDenoKvAdapter instances
 */
export async function createLocalDenoKvAdapter(
  config: AdapterConfig,
): Promise<LocalDenoKvAdapter> {
  const adapter = new LocalDenoKvAdapter();
  await adapter.initialize(config);
  return adapter;
}

// Export as default for module loading
export default createLocalDenoKvAdapter;

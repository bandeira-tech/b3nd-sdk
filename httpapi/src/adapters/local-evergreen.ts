/**
 * Local Evergreen Adapter
 *
 * A persistence adapter that maintains data in memory only during the
 * server's lifetime. All data is lost when the server restarts.
 * Useful for development, testing, and temporary data scenarios.
 */

import { Persistence, type PersistenceRecord, type PersistenceWrite } from "../../../persistence/mod.ts";
import {
  BaseAdapter,
  type AdapterConfig,
  type ListOptions,
  type ListResult,
  type LocalStorageOptions,
  AdapterError
} from "./types.ts";

export class LocalEvergreenAdapter extends BaseAdapter {
  private persistence!: Persistence<unknown>;
  private storageMap = new Map<string, PersistenceRecord<unknown>>();

  protected async doInitialize(): Promise<void> {
    const options = this.config.options as LocalStorageOptions | undefined;

    // Initialize with schema if provided
    this.persistence = new Persistence({
      schema: this.schema || {},
    });

    // Log initialization
    console.log(`[LocalEvergreenAdapter] Initialized instance '${this.config.id}' with ephemeral storage`);

    if (options?.maxSize) {
      console.log(`[LocalEvergreenAdapter] Max storage size: ${options.maxSize} bytes`);
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

      // Use the persistence instance for validation and processing
      const [error, record] = await this.persistence.write(write);

      if (error) {
        return {
          success: false,
          error: error.message || "Write validation failed",
        };
      }

      // Store in our map for retrieval
      if (record) {
        this.storageMap.set(uri, record);
      }

      return { success: true, record };
    } catch (error) {
      console.error(`[LocalEvergreenAdapter] Write error:`, error);
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

      // Try to read from persistence instance first
      const record = await this.persistence.read(uri);
      if (record) {
        return record;
      }

      // Fallback to our storage map
      return this.storageMap.get(uri) || null;
    } catch (error) {
      console.error(`[LocalEvergreenAdapter] Read error:`, error);
      return null;
    }
  }

  async listPath(
    protocol: string,
    domain: string,
    path: string,
    options: ListOptions = {},
  ): Promise<ListResult> {
    try {
      const basePath = path.startsWith("/") ? path : "/" + path;
      const baseUri = `${protocol}://${domain}${basePath}`;

      const items: Array<{
        uri: string;
        type: "file" | "directory";
      }> = [];

      // Get items from persistence storage
      const storage = (this.persistence as any).storage;
      const protocolStorage = storage[protocol];

      if (protocolStorage && protocolStorage[domain]) {
        const domainStorage = protocolStorage[domain];

        for (const [pathname, record] of Object.entries(domainStorage)) {
          if (pathname.startsWith(basePath)) {
            const relativePath = pathname.slice(basePath.length);

            // Skip if it's not a direct child (has more path separators)
            if (relativePath.startsWith("/")) {
              const parts = relativePath.slice(1).split("/");
              if (parts.length > 1 && !parts[1]) {
                // It's a directory
                items.push({
                  uri: `${protocol}://${domain}${pathname}`,
                  type: "directory",
                });
              } else if (parts.length === 1) {
                // It's a file
                items.push({
                  uri: `${protocol}://${domain}${pathname}`,
                  type: "file",
                });
              }
            }
          }
        }
      }

      // Also check our storage map for additional items
      for (const [uri, record] of this.storageMap) {
        if (uri.startsWith(baseUri)) {
          const exists = items.find(item => item.uri === uri);
          if (!exists) {
            const parts = uri.slice(baseUri.length).split("/").filter(Boolean);
            if (parts.length > 0) {
              items.push({
                uri,
                type: uri.endsWith("/") ? "directory" : "file",
              });
            }
          }
        }
      }

      // Apply pattern filtering if provided
      let filteredItems = items;
      if (options.pattern) {
        const pattern = new RegExp(options.pattern.replace(/\*/g, ".*"));
        filteredItems = items.filter(item => {
          // Extract name from URI for pattern matching
          const name = item.uri.split("/").pop() || "";
          return pattern.test(name);
        });
      }

      // Sort items by URI (name is no longer available)
      const sortBy = options.sortBy || "name";
      const sortOrder = options.sortOrder || "asc";

      filteredItems.sort((a, b) => {
        const nameA = a.uri.split("/").pop() || "";
        const nameB = b.uri.split("/").pop() || "";
        return sortOrder === "asc"
          ? nameA.localeCompare(nameB)
          : nameB.localeCompare(nameA);
      });

      // Paginate
      const page = options.page || 1;
      const limit = options.limit || 50;
      const start = (page - 1) * limit;
      const data = filteredItems.slice(start, start + limit);

      return {
        data,
        pagination: {
          page,
          limit,
        },
      };
    } catch (error) {
      console.error(`[LocalEvergreenAdapter] List error:`, error);
      return {
        data: [],
        pagination: {
          page: options.page || 1,
          limit: options.limit || 50,
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

      // Delete from persistence storage
      const storage = (this.persistence as any).storage;
      const pathname = path.startsWith("/") ? path : "/" + path;

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

      // Also delete from our storage map
      this.storageMap.delete(uri);

      return { success: true };
    } catch (error) {
      console.error(`[LocalEvergreenAdapter] Delete error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown delete error",
      };
    }
  }

  async cleanup(): Promise<void> {
    console.log(`[LocalEvergreenAdapter] Cleaning up instance '${this.config.id}'`);
    this.storageMap.clear();

    // Clear persistence storage
    const storage = (this.persistence as any).storage;
    for (const protocol of Object.keys(storage)) {
      delete storage[protocol];
    }
  }
}

/**
 * Factory function for creating LocalEvergreenAdapter instances
 */
export async function createLocalEvergreenAdapter(
  config: AdapterConfig
): Promise<LocalEvergreenAdapter> {
  const adapter = new LocalEvergreenAdapter();
  await adapter.initialize(config);
  return adapter;
}

// Export as default for module loading
export default createLocalEvergreenAdapter;

/**
 * MemoryClient - In-memory implementation of NodeProtocolInterface
 *
 * Stores data in memory with schema-based validation.
 * Data is lost on restart (ephemeral/evergreen).
 */

import type {
  DeleteResult,
  HealthStatus,
  ListItem,
  ListOptions,
  ListResult,
  MemoryClientConfig,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadResult,
  WriteResult,
} from "../../src/types.ts";

export class MemoryClient implements NodeProtocolInterface {
  private store: Map<string, PersistenceRecord<unknown>>;
  private schema: MemoryClientConfig["schema"];

  constructor(config: MemoryClientConfig) {
    this.store = new Map();
    this.schema = config.schema;
  }

  async write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>> {
    try {
      // Extract program key (protocol://toplevel)
      const programKey = this.extractProgramKey(uri);

      // Find matching validation function
      const validator = this.schema[programKey];

      if (!validator) {
        return {
          success: false,
          error: `No schema defined for program key: ${programKey}`,
        };
      }

      // Validate the write
      const validation = await validator({ uri, value });

      if (!validation.valid) {
        return {
          success: false,
          error: validation.error || "Validation failed",
        };
      }

      // Create record with timestamp
      const record: PersistenceRecord<T> = {
        ts: Date.now(),
        data: value,
      };

      // Store the record
      this.store.set(uri, record);

      return {
        success: true,
        record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const record = this.store.get(uri) as PersistenceRecord<T> | undefined;

      if (!record) {
        return {
          success: false,
          error: `Not found: ${uri}`,
        };
      }

      return {
        success: true,
        record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const page = options?.page || 1;
      const limit = options?.limit || 100;
      const pattern = options?.pattern;

      // Ensure URI has proper format: protocol://domain[/path]
      // Must have at least protocol://domain (not just protocol://)
      if (!uri.includes("://") || uri.endsWith("://")) {
        return {
          data: [],
          pagination: { page, limit, total: 0 },
        };
      }

      // Add trailing slash if not present (for proper prefix matching)
      const searchPrefix = uri.endsWith("/") ? uri : uri + "/";

      // Collect matching items
      let items: ListItem[] = [];
      const seenItems = new Set<string>();

      for (const key of this.store.keys()) {
        // Check if key starts with the search prefix
        if (!key.startsWith(searchPrefix)) continue;

        // Apply pattern filter if provided
        if (pattern && !key.includes(pattern)) continue;

        // Extract the relative path after the search prefix
        const relativePath = key.slice(searchPrefix.length);

        // Skip if empty relative path
        if (!relativePath) continue;

        // Include the full URI of stored items
        if (seenItems.has(key)) continue;
        seenItems.add(key);

        items.push({
          uri: key,
          type: "file",
        });
      }

      // Sort if requested
      if (options?.sortBy === "name") {
        items.sort((a, b) => {
          const comparison = a.uri.localeCompare(b.uri);
          return options.sortOrder === "desc" ? -comparison : comparison;
        });
      } else if (options?.sortBy === "timestamp") {
        items.sort((a, b) => {
          const aRecord = this.store.get(a.uri);
          const bRecord = this.store.get(b.uri);
          const aTs = aRecord?.ts || 0;
          const bTs = bRecord?.ts || 0;
          const comparison = aTs - bTs;
          return options.sortOrder === "desc" ? -comparison : comparison;
        });
      }

      // Apply pagination
      const total = items.length;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      items = items.slice(startIndex, endIndex);

      return {
        data: items,
        pagination: {
          page,
          limit,
          total,
        },
      };
    } catch (error) {
      // Return empty result on error
      return {
        data: [],
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 100,
        },
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const existed = this.store.has(uri);

      if (!existed) {
        return {
          success: false,
          error: `Not found: ${uri}`,
        };
      }

      this.store.delete(uri);

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(): Promise<HealthStatus> {
    return {
      status: "healthy",
      message: "MemoryClient is operational",
      details: {
        itemCount: this.store.size,
        schemaKeys: Object.keys(this.schema),
      },
    };
  }

  async getSchema(): Promise<string[]> {
    return Object.keys(this.schema);
  }

  async cleanup(): Promise<void> {
    this.store.clear();
  }

  /**
   * Extract program key from URI (protocol://toplevel)
   * Examples:
   *   "users://alice/profile" -> "users://"
   *   "cache://session/123" -> "cache://"
   */
  private extractProgramKey(uri: string): string {
    const match = uri.match(/^([^:]+:\/\/)/);
    return match ? match[1] : "";
  }
}

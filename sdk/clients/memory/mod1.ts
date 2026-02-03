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
  private store: Map<string, Map<string, PersistenceRecord<unknown>>>;
  private schema: MemoryClientConfig["schema"];

  constructor(config: MemoryClientConfig) {
    this.store = new Map();
    this.schema = config.schema;
  }

  async write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>> {
    try {
      const url = URL.parse(uri)!;
      const programKey = `${url.protocol}//${url.hostname}`;

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

      let programStore = this.store.get(programKey);
      if (!programStore) {
        programStore = new Map();
        this.store.set(programKey, programStore);
      }
      programStore.set(url.pathname, record);

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
      const url = URL.parse(uri)!;
      const programKey = `${url.protocol}//${url.hostname}`;
      const pathname = url.pathname;

      const programStore = this.store.get(programKey);
      if (!programStore) {
        return {
          success: false,
          error: `Not found: ${uri}`,
        };
      }

      const record = programStore.get(pathname) as
        | PersistenceRecord<T>
        | undefined;

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

      // Parse URI to get program key (protocol://domain) and path prefix
      const url = URL.parse(uri)!;
      const programKey = `${url.protocol}//${url.hostname}`;
      const pathPrefix = url.pathname || "/";

      // Get the domain's storage
      const stored = this.store.get(programKey);
      if (!stored) {
        return {
          data: [],
          pagination: { page, limit, total: 0 },
        };
      }

      // Collect all matching items from this domain's storage
      const items: ListItem[] = [];

      for (const [pathname, record] of stored.entries()) {
        // Only include items that match the path prefix
        if (!pathname.startsWith(pathPrefix)) continue;

        // Apply pattern filter if provided
        if (pattern) {
          // Convert wildcard pattern to regex
          // e.g., "*test*" -> /test/
          const regexPattern = pattern
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".");
          const regex = new RegExp(regexPattern);
          if (!regex.test(pathname)) continue;
        }

        // Reconstruct full URI
        const fullUri = `${programKey}${pathname}`;

        items.push({
          uri: fullUri,
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
          const aRecord = this.store.get(
            a.uri.split("://")[0] + "://" + a.uri.split("/")[2],
          )?.get(a.uri.substring(a.uri.indexOf("/", a.uri.indexOf("://") + 3)));
          const bRecord = this.store.get(
            b.uri.split("://")[0] + "://" + b.uri.split("/")[2],
          )?.get(b.uri.substring(b.uri.indexOf("/", b.uri.indexOf("://") + 3)));
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
      const paginatedItems = items.slice(startIndex, endIndex);

      return {
        data: paginatedItems,
        pagination: {
          page,
          limit,
          total,
        },
      };
    } catch (error) {
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
      const url = URL.parse(uri)!;
      const programKey = `${url.protocol}//${url.hostname}`;
      const pathname = url.pathname;

      const programStore = this.store.get(programKey);
      if (!programStore) {
        return {
          success: false,
          error: `Not found: ${uri}`,
        };
      }

      const existed = programStore.has(pathname);
      if (!existed) {
        return {
          success: false,
          error: `Not found: ${uri}`,
        };
      }

      programStore.delete(pathname);

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
}

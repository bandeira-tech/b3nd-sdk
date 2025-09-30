/**
 * Local Client Implementation
 * Connects to b3nd Persistence instances directly (in-process)
 */

import type {
  B3ndClient,
  DeleteResult,
  ListOptions,
  ListResult,
  LocalClientConfig,
  ReadResult,
  WriteResult,
} from "./types.ts";

export class LocalClient implements B3ndClient {
  private persistence: any;

  constructor(config: LocalClientConfig) {
    this.persistence = config.persistence;
  }

  /**
   * Parse URI into components
   */
  private parseUri(uri: string): {
    protocol: string;
    domain: string;
    path: string;
  } {
    const url = new URL(uri);
    return {
      protocol: url.protocol.replace(":", ""),
      domain: url.hostname,
      path: url.pathname,
    };
  }

  async write<T = unknown>(uri: string, value: T): Promise<WriteResult<T>> {
    try {
      const [error, record] = await this.persistence.write({ uri, value });

      if (error) {
        return {
          success: false,
          error: "Write validation failed",
        };
      }

      return {
        success: true,
        record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Write failed",
      };
    }
  }

  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    try {
      const record = await this.persistence.read(uri);

      if (!record || record.ts === 0) {
        return {
          success: false,
          error: "Not found",
        };
      }

      return {
        success: true,
        record,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Read failed",
      };
    }
  }

  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);

      // Get all paths in storage for this protocol/domain
      const storage = this.persistence.storage;
      const protocolStorage = storage[protocol + ":"];
      if (!protocolStorage) {
        return {
          data: [],
          pagination: {
            page: 1,
            limit: options?.limit || 50,
            total: 0,
            hasNext: false,
            hasPrev: false,
          },
        };
      }

      const domainStorage = protocolStorage[domain];
      if (!domainStorage) {
        return {
          data: [],
          pagination: {
            page: 1,
            limit: options?.limit || 50,
            total: 0,
            hasNext: false,
            hasPrev: false,
          },
        };
      }

      // Filter paths that start with the given path
      const allPaths = Object.keys(domainStorage);
      const filteredPaths = allPaths.filter((p) =>
        p.startsWith(path === "/" ? "" : path)
      );

      // Get immediate children (files and directories)
      const pathPrefix = path === "/" ? "/" : path + "/";
      const children = new Set<string>();

      for (const p of filteredPaths) {
        if (p === path) continue; // Skip the path itself

        const relativePath = p.startsWith(pathPrefix)
          ? p.slice(pathPrefix.length)
          : p;
        const parts = relativePath.split("/").filter((part) => part.length > 0);

        if (parts.length > 0) {
          children.add(parts[0]);
        }
      }

      // Create list items
      const items = Array.from(children).map((name) => {
        const childPath = path === "/"
          ? `/${name}`
          : `${path}/${name}`;
        const fullChildPath = pathPrefix + name;

        // Check if it's a file or directory
        const isFile = domainStorage[fullChildPath] !== undefined;
        const record = isFile ? domainStorage[fullChildPath] : null;

        return {
          uri: `${protocol}://${domain}${fullChildPath}`,
          name,
          type: isFile ? "file" as const : "directory" as const,
          ts: record?.ts || Date.now(),
          size: record ? JSON.stringify(record.data).length : undefined,
        };
      });

      // Apply sorting
      const sortBy = options?.sortBy || "name";
      const sortOrder = options?.sortOrder || "asc";

      items.sort((a, b) => {
        let comparison = 0;
        if (sortBy === "name") {
          comparison = a.name.localeCompare(b.name);
        } else if (sortBy === "timestamp") {
          comparison = a.ts - b.ts;
        }
        return sortOrder === "asc" ? comparison : -comparison;
      });

      // Apply pagination
      const page = options?.page || 1;
      const limit = options?.limit || 50;
      const start = (page - 1) * limit;
      const end = start + limit;
      const paginatedItems = items.slice(start, end);

      return {
        data: paginatedItems,
        pagination: {
          page,
          limit,
          total: items.length,
          hasNext: end < items.length,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      return {
        data: [],
        pagination: {
          page: 1,
          limit: options?.limit || 50,
          total: 0,
          hasNext: false,
          hasPrev: false,
        },
      };
    }
  }

  async delete(uri: string): Promise<DeleteResult> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);

      const storage = this.persistence.storage;
      const protocolKey = protocol + ":";
      const hostKey = domain;
      const pathKey = path;

      if (
        storage[protocolKey]?.[hostKey]?.[pathKey]
      ) {
        delete storage[protocolKey][hostKey][pathKey];
        return {
          success: true,
        };
      }

      return {
        success: false,
        error: "Not found",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
      };
    }
  }

  async health(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
  }> {
    return {
      status: "healthy",
      message: "Local persistence is operational",
    };
  }

  async cleanup(): Promise<void> {
    // No cleanup needed for local client
  }
}
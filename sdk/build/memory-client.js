/**
 * MemoryClient - In-memory implementation of NodeProtocolInterface
 *
 * Stores data in memory with schema-based validation.
 * Data is lost on restart (ephemeral/evergreen).
 */

import {
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
} from "./types.js";

export class MemoryClient {
  store, PersistenceRecord<unknown>>;
  schema: MemoryClientConfig["schema"];

  constructor(config) {
    this.store = new Map();
    this.schema = config.schema;
  }

  async write(uri, value){
    try {
      // Extract program key (protocol://toplevel)
      const programKey = this.extractProgramKey(uri);

      // Find matching validation function
      const validator = this.schema[programKey];

      if (!validator) {
        return {
          success,
          error: `No schema defined for program key: ${programKey}`,
        };
      }

      // Validate the write
      const validation = await validator({ uri, value });

      if (!validation.valid) {
        return {
          success,
          error: validation.error || "Validation failed",
        };
      }

      // Create record with timestamp
      const record: PersistenceRecord<T> = {
        ts: Date.now(),
        data,
      };

      // Store the record
      this.store.set(uri, record);

      return {
        success,
      };
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read(uri){
    try {
      const record = this.store.get(uri) as PersistenceRecord<T> | undefined;

      if (!record) {
        return {
          success,
          error: `Not found: ${uri}`,
        };
      }

      return {
        success,
      };
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async list(uri, options?: ListOptions){
    try {
      const page = options?.page || 1;
      const limit = options?.limit || 100;
      const pattern = options?.pattern;

      // Normalize URI for prefix matching
      const prefix = uri.endsWith("/") ? uri : uri + "/";

      // Find all URIs that start with the prefix
      let items: ListItem[] = [];

      for (const key of this.store.keys()) {
        if (key.startsWith(prefix) || key === uri) {
          // Apply pattern filter if provided
          if (pattern && !key.includes(pattern)) {
            continue;
          }

          // Determine if this is a file or directory
          const relativePath = key.slice(prefix.length);
          const hasNestedPath = relativePath.includes("/");
          // TODO, and thus should list only the next level nodes
          items.push({
            uri,
            type: hasNestedPath ? "directory" : "file",
          });
        }
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
        data,
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

  async delete(uri){
    try {
      const existed = this.store.has(uri);

      if (!existed) {
        return {
          success,
          error: `Not found: ${uri}`,
        };
      }

      this.store.delete(uri);

      return {
        success,
      };
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(){
    return {
      status: "healthy",
      message: "MemoryClient is operational",
      details: {
        itemCount: this.store.size,
        schemaKeys: Object.keys(this.schema),
      },
    };
  }

  async getSchema(){
    return Object.keys(this.schema);
  }

  async cleanup(){
    this.store.clear();
  }

  /**
   * Extract program key from URI (protocol://toplevel)
   * Examples:
   *   "users://alice/profile" -> "users://"
   *   "cache://session/123" -> "cache://"
   */
  extractProgramKey(uri){
    const match = uri.match(/^([^:]+:\/\/)/);
    return match ? match[1] : "";
  }
}

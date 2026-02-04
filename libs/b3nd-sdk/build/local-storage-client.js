/**
 * LocalStorageClient - Browser localStorage implementation of NodeProtocolInterface
 *
 * Provides persistent storage in browser environments using localStorage.
 * Supports schema validation and custom serialization.
 */

import {
  DeleteResult,
  HealthStatus,
  ListItem,
  ListOptions,
  ListResult,
  LocalStorageClientConfig,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadResult,
  Schema,
  ValidationFn,
  WriteResult,
} from "./types.js";

export class LocalStorageClient {
  config: Required<LocalStorageClientConfig>;
  schema: Schema;

  constructor(config) {
    this.config = {
      keyPrefix: config.keyPrefix || "b3nd:",
      schema: config.schema || {},
      serializer: {
        serialize: (data) => JSON.stringify(data),
        deserialize: (data) => JSON.parse(data),
        ...config.serializer,
      },
    };
    this.schema = this.config.schema;

    // Check if localStorage is available
    if (typeof localStorage === "undefined") {
      throw new Error("localStorage is not available in this environment");
    }
  }

  /**
   * Get the localStorage key for a URI
   */
  getKey(uri){
    return `${this.config.keyPrefix}${uri}`;
  }

  /**
   * Validate write operation against schema
   */
  async validateWrite(uri, value){ valid: boolean; error?: string }> {
    // Find matching schema validation function
    const programKey = this.findMatchingProgram(uri);
    if (programKey && this.schema[programKey]) {
      const validator = this.schema[programKey];
      return await validator({ uri, value });
    }

    // No schema defined for this URI, allow write
    return { valid: true };
  }

  /**
   * Find matching program key for URI
   */
  findMatchingProgram(uri){
    // Look for exact matches first
    if (this.schema[uri]) {
      return uri;
    }

    // Look for prefix matches (e.g., "users://" matches "users://alice/profile")
    for (const programKey of Object.keys(this.schema)) {
      if (uri.startsWith(programKey)) {
        return programKey;
      }
    }

    return null;
  }

  /**
   * Serialize data using configured serializer
   */
  serialize(data){
    return this.config.serializer!.serialize!(data);
  }

  /**
   * Deserialize data using configured serializer
   */
  deserialize(data){
    return this.config.serializer!.deserialize!(data);
  }

  async write(uri, value){
    try {
      // Validate against schema if present
      const validation = await this.validateWrite(uri, value);
      if (!validation.valid) {
        return {
          success,
          error: validation.error || "Validation failed",
        };
      }

      const key = this.getKey(uri);
      const record: PersistenceRecord<T> = {
        ts: Date.now(),
        data,
      };

      const serialized = this.serialize(record);
      localStorage.setItem(key, serialized);

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
      const key = this.getKey(uri);
      const serialized = localStorage.getItem(key);

      if (serialized === null) {
        return {
          success,
          error: "Not found",
        };
      }

      const record = this.deserialize(serialized) as PersistenceRecord<T>;
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
      const { page = 1, limit = 50, pattern, sortBy = "name", sortOrder = "asc" } = options || {};

      const items: ListItem[] = [];
      const prefix = this.getKey(uri);

      // Iterate through all localStorage keys
      for (let i = 0; i {
        let comparison = 0;
        if (sortBy === "name") {
          comparison = a.uri.localeCompare(b.uri);
        } else if (sortBy === "timestamp") {
          // Get timestamps from stored data for comparison
          const aData = this.getStoredData(a.uri);
          const bData = this.getStoredData(b.uri);
          const aTs = aData?.ts || 0;
          const bTs = bData?.ts || 0;
          comparison = aTs - bTs;
        }

        return sortOrder === "asc" ? comparison : -comparison;
      });

      // Apply pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedItems = items.slice(startIndex, endIndex);

      return {
        data,
        pagination: {
          page,
          limit,
          total: items.length,
        },
      };
    } catch (error) {
      return {
        data: [],
        pagination: {
          page: options?.page || 1,
          limit: options?.limit || 50,
        },
      };
    }
  }

  /**
   * Check if a URI has children (is a directory)
   */
  hasChildren(uri){
    const prefix = this.getKey(uri) + "/";
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get stored data for a URI (for timestamp sorting)
   */
  getStoredData(uri){
    try {
      const key = this.getKey(uri);
      const serialized = localStorage.getItem(key);
      if (serialized) {
        return this.deserialize(serialized) as PersistenceRecord;
      }
    } catch {
      // Ignore errors, return null
    }
    return null;
  }

  async delete(uri){
    try {
      const key = this.getKey(uri);
      const exists = localStorage.getItem(key) !== null;

      if (!exists) {
        return {
          success,
          error: "Not found",
        };
      }

      localStorage.removeItem(key);
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
    try {
      // Check if localStorage is accessible
      const testKey = `${this.config.keyPrefix}health-check`;
      localStorage.setItem(testKey, "test");
      localStorage.removeItem(testKey);

      const stats = this.getStorageStats();

      return {
        status: "healthy",
        message: "LocalStorage client is operational",
        details,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get localStorage usage statistics
   */
  getStorageStats(){
    try {
      let totalKeys = 0;
      let b3ndKeys = 0;
      let totalSize = 0;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          totalKeys++;
          const value = localStorage.getItem(key) || "";
          totalSize += key.length + value.length;

          if (key.startsWith(this.config.keyPrefix)) {
            b3ndKeys++;
          }
        }
      }

      return {
        totalKeys,
        b3ndKeys,
        totalSize,
        keyPrefix: this.config.keyPrefix,
        estimatedRemainingSpace: this.estimateRemainingSpace(),
      };
    } catch {
      return {};
    }
  }

  /**
   * Estimate remaining localStorage space (rough approximation)
   */
  estimateRemainingSpace(){
    try {
      // This is a rough estimate - localStorage limit is typically 5-10MB
      const typicalLimit = 5 * 1024 * 1024; // 5MB
      let currentSize = 0;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key) || "";
          currentSize += key.length + value.length;
        }
      }

      return Math.max(0, typicalLimit - currentSize);
    } catch {
      return 0;
    }
  }

  async getSchema(){
    return Object.keys(this.schema);
  }

  async cleanup(){
    // Remove all keys with our prefix
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.config.keyPrefix)) {
        keysToRemove.push(key);
      }
    }

    // Remove the keys
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  }
}
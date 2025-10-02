/**
 * IndexedDBClient - Browser IndexedDB implementation of NodeProtocolInterface
 *
 * Provides large-scale persistent storage in browser environments using IndexedDB.
 * Supports schema validation and efficient querying.
 */

import {
  DeleteResult,
  HealthStatus,
  ListItem,
  ListOptions,
  ListResult,
  IndexedDBClientConfig,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadResult,
  Schema,
  WriteResult,
} from "./types.js";

// Type definitions for IndexedDB (simplified for cross-platform compatibility)


declare global {


  var indexedDB: IDBFactory;
}


export class IndexedDBClient {
  config: Required<IndexedDBClientConfig>;
  schema: Schema;
  db: IDBDatabase | null = null;

  constructor(config) {
    this.config = {
      databaseName: config.databaseName || "b3nd",
      storeName: config.storeName || "records",
      version: config.version || 1,
      schema: config.schema || {},
    };
    this.schema = this.config.schema;

    // Check if IndexedDB is available
    if (typeof (globalThis).indexedDB === "undefined") {
      throw new Error("IndexedDB is not available in this environment");
    }
  }

  /**
   * Initialize the database connection
   */
  async initDB(){
    if (this.db) {
      return this.db;
    }

    try {
      const indexedDB = (globalThis).indexedDB;
      if (!indexedDB) {
        throw new Error("IndexedDB not available");
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.config.databaseName, this.config.version);

        request.onerror = () => {
          reject(new Error(`Failed to open IndexedDB: ${request.error}`));
        };

        request.onsuccess = () => {
          const db = request.result;
          if (db) {
            this.db = db;
            resolve(db);
          } else {
            reject(new Error("IndexedDB open succeeded but no database returned"));
          }
        };

        request.onupgradeneeded = () => {
          try {
            const db = request.result;

            // Create object store if it doesn't exist
            if (!db.objectStoreNames || !db.objectStoreNames.contains(this.config.storeName)) {
              const store = db.createObjectStore(this.config.storeName, { keyPath: "uri" });
              // Create index for efficient querying by URI prefix
              store.createIndex("uri_index", "uri");
              // Create index for timestamp-based sorting
              store.createIndex("ts_index", "ts");
            }
          } catch (error) {
            reject(new Error(`Failed to upgrade database: ${error}`));
          }
        };
      });
    } catch (error) {
      throw new Error(`IndexedDB initialization failed: ${error}`);
    }
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
   * Get a transaction and object store
   */
  async getStore(mode: IDBTransactionMode = "readonly"){
    const db = await this.initDB();
    const transaction = db.transaction([this.config.storeName], mode);
    return transaction.objectStore(this.config.storeName);
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

      const store = await this.getStore("readwrite");
      const record: PersistenceRecord<T> = {
        ts: Date.now(),
        data,
      };

      const storedRecord: StoredRecord = {
        uri,
        data,
        ts: record.ts,
      };

      return new Promise<WriteResult<T>>((resolve) => {
        const request = store.put(storedRecord);

        request.onsuccess = () => {
          resolve({
            success,
          });
        };

        request.onerror = () => {
          resolve({
            success,
            error: `Failed to write record: ${request.error}`,
          });
        };
      });
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async read(uri){
    try {
      const store = await this.getStore();

      return new Promise<ReadResult<T>>((resolve) => {
        const request = store.get(uri);

        request.onsuccess = () => {
          const storedRecord = request.result;

          if (!storedRecord) {
            resolve({
              success,
              error: "Not found",
            });
            return;
          }

          const record: PersistenceRecord<T> = {
            ts: storedRecord.ts,
            data: storedRecord.data};

          resolve({
            success,
          });
        };

        request.onerror = () => {
          resolve({
            success,
            error: `Failed to read record: ${request.error}`,
          });
        };
      });
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
      const store = await this.getStore();
      const index = store.index("uri_index");

      const items: ListItem[] = [];

      return new Promise((resolve) => {
        const request = index.openCursor();

        request.onsuccess = () => {
          const cursor = request.result;

          if (cursor) {
            const record = cursor.value;

            // Check if this record matches our URI criteria
            if (record.uri.startsWith(uri)) {
              // Apply pattern filter if specified
              if (!pattern || record.uri.includes(pattern)) {
                // Determine if this is a directory or file
                const isDirectory = this.hasChildren(record.uri);

                items.push({
                  uri: record.uri,
                  type: isDirectory ? "directory" : "file",
                });
              }
            }

            cursor.continue();
          } else {
            // All records processed, apply sorting and pagination
            this.processListResults(items, { page, limit, sortBy, sortOrder })
              .then(resolve)
              .catch((error) => {
                resolve({
                  data: [],
                  pagination: { page, limit },
                });
              });
          }
        };

        request.onerror = () => {
          resolve({
            data: [],
            pagination: { page, limit },
          });
        };
      });
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
   * Process list results with sorting and pagination
   */
  async processListResults(
    items,
    options: { page: number; limit: number; sortBy: string; sortOrder: string }
  ){
    const { page, limit, sortBy, sortOrder } = options;

    // Sort items
    if (sortBy === "timestamp") {
      // Get timestamps for all items
      const itemsWithTimestamps = await Promise.all(
        items.map(async (item) => {
          const record = await this.getStoredRecord(item.uri);
          return {
            ...item,
            ts: record?.ts || 0,
          };
        })
      );

      itemsWithTimestamps.sort((a, b) => {
        const comparison = a.ts - b.ts;
        return sortOrder === "asc" ? comparison : -comparison;
      });

      items = itemsWithTimestamps.map(({ uri, type }) => ({ uri, type }));
    } else {
      // Sort by name
      items.sort((a, b) => {
        const comparison = a.uri.localeCompare(b.uri);
        return sortOrder === "asc" ? comparison : -comparison;
      });
    }

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
  }

  /**
   * Get stored record for timestamp sorting
   */
  async getStoredRecord(uri){
    try {
      const store = await this.getStore();
      return new Promise((resolve) => {
        const request = store.get(uri);
        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => {
          resolve(null);
        };
      });
    } catch {
      return null;
    }
  }

  /**
   * Check if a URI has children (is a directory)
   */
  hasChildren(uri){
    // This is a simplified check - in a real implementation,
    // we'd need to query the database more efficiently
    return false; // For now, assume all are files
  }

  async delete(uri){
    try {
      const store = await this.getStore("readwrite");

      return new Promise((resolve) => {
        // First check if it exists
        const getRequest = store.get(uri);

        getRequest.onsuccess = () => {
          if (!getRequest.result) {
            resolve({
              success,
              error: "Not found",
            });
            return;
          }

          // Delete the record
          const deleteRequest = store.delete(uri);

          deleteRequest.onsuccess = () => {
            resolve({
              success,
            });
          };

          deleteRequest.onerror = () => {
            resolve({
              success,
              error: `Failed to delete record: ${deleteRequest.error}`,
            });
          };
        };

        getRequest.onerror = () => {
          resolve({
            success,
            error: `Failed to check record existence: ${getRequest.error}`,
          });
        };
      });
    } catch (error) {
      return {
        success,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async health(){
    try {
      // Try to open the database
      const db = await this.initDB();

      if (!db) {
        return {
          status: "unhealthy",
          message: "Failed to connect to IndexedDB",
        };
      }

      const stats = await this.getDatabaseStats();

      return {
        status: "healthy",
        message: "IndexedDB client is operational",
        details: {
          databaseName: this.config.databaseName,
          storeName: this.config.storeName,
          version: this.config.version,
          ...stats,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(){
    try {
      const store = await this.getStore();
      const index = store.index("uri_index");

      return new Promise<Record<string, unknown>>((resolve) => {
        let totalRecords = 0;

        const request = index.openCursor();

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            totalRecords++;
            cursor.continue();
          } else {
            resolve({
              totalRecords,
            });
          }
        };

        request.onerror = () => {
          resolve({
            totalRecords: 0,
          });
        };
      });
    } catch {
      return {
        totalRecords: 0,
      };
    }
  }

  async getSchema(){
    return Object.keys(this.schema);
  }

  async cleanup(){
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    // Clear all data from the object store
    try {
      const store = await this.getStore("readwrite");
      await new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error(`Failed to clear store: ${request.error}`));
      });
    } catch {
      // Ignore cleanup errors
    }
  }
}
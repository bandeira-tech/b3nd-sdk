import type {
  Persistence,
  PersistenceRecord,
  PersistenceWrite,
  PersistenceValidationFn,
} from "../../persistence/mod.ts";
import type { PersistenceConfig } from "./config.ts";

// Dummy validation function: Always allows writes for dev (used for JSON bool=true)
const dummyValidationFn = async (
  _write: PersistenceWrite<unknown>,
): Promise<boolean> => {
  return true;
};

export interface PersistenceAdapter {
  write(
    protocol: string,
    domain: string,
    path: string,
    value: unknown,
    instanceId?: string,
  ): Promise<{
    success: boolean;
    record?: PersistenceRecord<unknown>;
    error?: string;
  }>;
  read(
    protocol: string,
    domain: string,
    path: string,
    instanceId?: string,
  ): Promise<PersistenceRecord<unknown> | null>;
  listPath(
    protocol: string,
    domain: string,
    path: string,
    options?: { page?: number; limit?: number },
    instanceId?: string,
  ): Promise<{
    data: Array<{
      uri: string;
      name: string;
      type: "file" | "directory";
      ts: number;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }>;
  delete(
    protocol: string,
    domain: string,
    path: string,
    instanceId?: string,
  ): Promise<{ success: boolean; error?: string }>;
}

class DefaultPersistenceAdapter implements PersistenceAdapter {
  private static instance: DefaultPersistenceAdapter | null = null;
  private instances: Map<string, Persistence<unknown>> = new Map();
  private config: PersistenceConfig | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  private async ensureConfig(): Promise<void> {
    if (this.config === null) {
      this.config = await import("./config.ts").then((m) =>
        m.loadPersistenceConfig(),
      );
    }
  }

  private async getOrCreateInstance(
    instanceId: string = "default",
  ): Promise<Persistence<unknown>> {
    await this.ensureConfig();
    if (!this.instances.has(instanceId)) {
      const instanceConfig = this.config[instanceId];
      if (!instanceConfig) {
        throw new Error(
          `Persistence instance '${instanceId}' not found in config`,
        );
      }
      let schema: Record<string, PersistenceValidationFn<unknown>>;
      try {
        const schemaPath = instanceConfig.schema;
        const pathExt = schemaPath.split(".").pop()?.toLowerCase();
        if (pathExt === "json") {
          // Load JSON and convert bools to dummy fns
          const content = await Deno.readTextFile(schemaPath);
          const rawSchema = JSON.parse(content);
          schema = Object.fromEntries(
            Object.entries(rawSchema).map(([key, val]) => [
              key,
              typeof val === "boolean"
                ? val
                  ? dummyValidationFn
                  : async () => false
                : dummyValidationFn,
            ]),
          );
        } else {
          // Assume TS module
          const schemaUrl = new URL(schemaPath, `file://${Deno.cwd()}/`).href;
          const schemaModule = await import(schemaUrl);
          schema = schemaModule.default || schemaModule;
          // Ensure it's a record of validation fns
          if (typeof schema !== "object" || schema === null) {
            throw new Error("Schema must be an object of validation functions");
          }
          for (const [key, fn] of Object.entries(schema)) {
            if (typeof fn !== "function") {
              throw new Error(`Schema key '${key}' must be a function`);
            }
          }
        }
      } catch (error) {
        throw new Error(
          `Schema load failed for instance ${instanceId} from ${instanceConfig.schema}: ${error}. Ensure a valid TS module or JSON with bools is provided.`,
        );
      }
      this.instances.set(instanceId, new Persistence({ schema }));
    }
    return this.instances.get(instanceId)!;
  }

  async write(
    protocol: string,
    domain: string,
    path: string,
    value: unknown,
    instanceId?: string,
  ): Promise<{
    success: boolean;
    record?: PersistenceRecord<unknown>;
    error?: string;
  }> {
    const uri = `${protocol}://${domain}${path.startsWith("/") ? path : "/" + path}`;
    const write: PersistenceWrite<unknown> = { uri, value };
    const instance = await this.getOrCreateInstance(instanceId);
    const [error, record] = await instance.write(write);
    if (error) {
      return {
        success: false,
        error: "Write failed (validation or storage error)",
      };
    }
    return { success: true, record };
  }

  async read(
    protocol: string,
    domain: string,
    path: string,
    instanceId?: string,
  ): Promise<PersistenceRecord<unknown> | null> {
    const uri = `${protocol}://${domain}${path.startsWith("/") ? path : "/" + path}`;
    const instance = await this.getOrCreateInstance(instanceId);
    try {
      return await instance.read(uri);
    } catch (error) {
      console.warn(`Read error for ${uri}:`, error);
      return null;
    }
  }

  async listPath(
    protocol: string,
    domain: string,
    path: string,
    options = { page: 1, limit: 50 },
    instanceId?: string,
  ) {
    const instance = (await this.getOrCreateInstance(instanceId)) as any;
    const storage = instance.storage as Record<
      string,
      Record<string, Record<string, PersistenceRecord<unknown>>>
    >;

    const basePath = path.startsWith("/") ? path : "/" + path;
    const hostStorage = storage[protocol]?.[domain] || {};
    if (!hostStorage) {
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

    const items: Array<{
      uri: string;
      name: string;
      type: "file" | "directory";
      ts: number;
    }> = [];
    for (const [pathname, record] of Object.entries(hostStorage)) {
      if (pathname.startsWith(basePath)) {
        const name = pathname.split("/").pop() || pathname;
        const type = pathname.endsWith("/") ? "directory" : "file";
        items.push({
          uri: `${protocol}://${domain}${pathname}`,
          name,
          type,
          ts: record.ts,
        });
      }
    }

    items.sort((a, b) => b.ts - a.ts); // Newest first

    const page = options.page || 1;
    const limit = options.limit || 50;
    const total = items.length;
    const start = (page - 1) * limit;
    const data = items.slice(start, start + limit);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        hasNext: start + limit < total,
        hasPrev: page > 1,
      },
    };
  }

  async delete(
    protocol: string,
    domain: string,
    path: string,
    instanceId?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const instance = (await this.getOrCreateInstance(instanceId)) as any;
      const storage = instance.storage as Record<
        string,
        Record<string, Record<string, PersistenceRecord<unknown>>>
      >;
      const pathname = path.startsWith("/") ? path : "/" + path;
      const hostStorage = storage[protocol]?.[domain];
      if (hostStorage && hostStorage[pathname]) {
        delete hostStorage[pathname];
        return { success: true };
      }
      return { success: false, error: "Not found" };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  static getAdapter(): DefaultPersistenceAdapter {
    if (!DefaultPersistenceAdapter.instance) {
      DefaultPersistenceAdapter.instance = new DefaultPersistenceAdapter();
    }
    return DefaultPersistenceAdapter.instance;
  }
}

export const getAdapter = DefaultPersistenceAdapter.getAdapter;

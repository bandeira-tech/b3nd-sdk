import type {
  Persistence,
  PersistenceRecord,
  PersistenceWrite,
} from "../../persistence/mod.ts";
import type { PersistenceConfig } from "./config.ts";

// Dummy validation function: Always allows writes for dev
const dummyValidationFn = async (
  _write: PersistenceWrite<unknown>,
): Promise<boolean> => {
  return true;
};

// Schema with realistic keys for dev (protocol://domain as keys)
const devSchema: Record<
  string,
  (write: PersistenceWrite<unknown>) => Promise<boolean>
> = {
  "users://nataliarsand": dummyValidationFn,
  "notes://nataliarsand": dummyValidationFn,
  // Add more as needed
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

export class DefaultPersistenceAdapter implements PersistenceAdapter {
  private instances: Record<string, Persistence<unknown>> = {};

  constructor() {
    this.initInstances().catch(console.error);
  }

  private async initInstances() {
    // Use devSchema for now; load from config.schema in future
    const schema = devSchema;
    // Load config to get instance IDs
    const persistenceConfig = await import("./config.ts").then((m) =>
      m.loadPersistenceConfig(),
    );
    for (const [id] of Object.entries(persistenceConfig)) {
      this.instances[id] = new Persistence({ schema });
    }
  }

  private getInstance(instanceId = "default"): Persistence<unknown> {
    const instance = this.instances[instanceId];
    if (!instance) {
      throw new Error(`Persistence instance '${instanceId}' not found`);
    }
    return instance;
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
    const instance = this.getInstance(instanceId);
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
    const instance = this.getInstance(instanceId);
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
    const instance = this.getInstance(instanceId) as any;
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
      const instance = this.getInstance(instanceId) as any;
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
}

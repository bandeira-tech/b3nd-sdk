import type {
  DeleteResult,
  HealthStatus,
  ListItem,
  ListOptions,
  ListResult,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadResult,
  Schema,
  WriteResult,
} from "../../src/types.ts";

type MemoryClientStorageNode<T> = {
  value?: T;
  children?: Map<string, MemoryClientStorageNode<unknown>>;
};

type MemoryClientStorage = Map<
  string,
  MemoryClientStorageNode<unknown>
>;

export interface MemoryClientConfig {
  schema: Schema;
  storage?: MemoryClientStorage;
}

type TargetResult =
  | {
    success: true;
    program: string;
    path: string;
    node: MemoryClientStorageNode<unknown>;
    parts: string[];
  }
  | { success: false; error: string };

function target(
  uri: string,
  schema: Schema,
  storage: MemoryClientStorage,
): TargetResult {
  const url = URL.parse(uri)!;
  const program = `${url.protocol}//${url.hostname}`;

  if (!schema[program]) {
    return { success: false, error: "Program not found" };
  }

  const node = storage.get(program);
  if (!node) {
    return { success: false, error: "Storage not initialized for program" };
  }

  const parts = url.pathname.substring(1).split("/");

  return {
    success: true,
    program,
    path: url.pathname,
    node,
    parts,
  };
}

export class MemoryClient implements NodeProtocolInterface {
  protected storage: MemoryClientStorage;
  protected schema: Schema;
  constructor(config: MemoryClientConfig) {
    this.schema = config.schema!;
    this.storage = config.storage || new Map();
    this.cleanup();
  }

  public async write<T = unknown>(
    uri: string,
    payload: T,
  ): Promise<WriteResult<T>> {
    const result = target(uri, this.schema, this.storage);
    if (!result.success) {
      return result;
    }
    const { program, node, parts } = result;

    // Validate the write against the schema
    const validator = this.schema[program];
    const validation = await validator({ uri, value: payload, read: this.read.bind(this) });
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || "Validation failed",
      };
    }

    const record = {
      ts: Date.now(),
      data: payload,
    };

    let prev = node;
    parts.filter(Boolean).forEach((ns) => {
      if (!prev.children) prev.children = new Map();
      if (!prev.children.get(ns)) {
        const newnode = {};
        prev.children.set(ns, newnode);
        prev = newnode;
      } else {
        prev = prev.children.get(ns)!;
      }
    });

    prev.value = record;

    return {
      success: true,
      record,
    };
  }
  public read<T>(uri: string): Promise<ReadResult<T>> {
    const result = target(uri, this.schema, this.storage);
    if (!result.success) {
      return Promise.resolve(result);
    }
    const { node, parts } = result;

    let current: MemoryClientStorageNode<unknown> | undefined = node;

    for (const part of parts.filter(Boolean)) {
      current = current?.children?.get(part);
      if (!current) {
        return Promise.resolve({
          success: false,
          error: `Path not found: ${part}`,
        });
      }
    }

    if (!current.value) {
      return Promise.resolve({
        success: false,
        error: "Not found",
      });
    }

    return Promise.resolve({
      success: true,
      record: current.value as PersistenceRecord<T>,
    });
  }
  public list(uri: string, options?: ListOptions): Promise<ListResult> {
    const result = target(uri, this.schema, this.storage);
    if (!result.success) {
      return Promise.resolve(result);
    }
    const { node, parts, program, path } = result;
    let current: MemoryClientStorageNode<unknown> | undefined = node;

    const filteredParts = parts.filter(Boolean);

    for (const part of filteredParts) {
      current = current?.children?.get(part);
      if (!current) {
        return Promise.resolve({
          success: false,
          error: `Path not found: ${part}`,
        });
      }
    }

    if (!current.children?.size) {
      return Promise.resolve({
        success: true,
        data: [],
        pagination: {
          page: options?.page ?? 1,
          limit: options?.limit ?? 50,
          total: 0,
        },
      });
    }

    let items: ListItem[] = Array.from(current.children.entries()).map((
      [key, child],
    ) => ({
      uri: path.endsWith("/")
        ? `${program}://${path}${key}`
        : `${program}://${path}/${key}`,
      type: child.value ? "file" : "directory",
    }));

    if (options?.pattern) {
      const regex = new RegExp(options.pattern);
      items = items.filter((item) => regex.test(item.uri));
    }

    if (options?.sortBy === "name") {
      items.sort((a, b) => a.uri.localeCompare(b.uri));
    } else if (options?.sortBy === "timestamp") {
      items.sort((a, b) => {
        const aTs =
          (current.children?.get(a.uri.split("/").pop()!)?.value as any)?.ts ??
            0;
        const bTs =
          (current.children?.get(b.uri.split("/").pop()!)?.value as any)?.ts ??
            0;
        return aTs - bTs;
      });
    }

    if (options?.sortOrder === "desc") {
      items.reverse();
    }

    const page = options?.page ?? 1;
    const limit = options?.limit ?? 50;
    const offset = (page - 1) * limit;
    const paginated = items.slice(offset, offset + limit);

    return Promise.resolve({
      success: true,
      data: paginated,
      pagination: { page, limit, total: items.length },
    });
  }
  public health(): Promise<HealthStatus> {
    return Promise.resolve({
      status: "healthy",
    });
  }
  public getSchema(): Promise<string[]> {
    return Promise.resolve(Object.keys(this.schema));
  }
  public cleanup(): Promise<void> {
    Object.keys(this.schema).forEach((program) => {
      if (!this.storage.get(program)) {
        this.storage.set(program, { children: new Map() });
      }
    });
    return Promise.resolve();
  }
  public delete(uri: string): Promise<DeleteResult> {
    const result = target(uri, this.schema, this.storage);
    if (!result.success) {
      return Promise.resolve(result);
    }
    const { node, parts } = result;

    const filteredParts = parts.filter(Boolean);

    if (filteredParts.length === 0) {
      return Promise.resolve({
        success: false,
        error: "Cannot delete root path",
      });
    }

    // Navigate to parent node
    let current: MemoryClientStorageNode<unknown> | undefined = node;
    const lastPart = filteredParts.pop()!;
    for (const part of filteredParts) {
      current = current?.children?.get(part);
      if (!current) {
        return Promise.resolve({
          success: false,
          error: `Path not found: ${part}`,
        });
      }
    }

    // Remove the target from parent's children
    if (!current.children?.has(lastPart)) {
      return Promise.resolve({
        success: false,
        error: `Item not found: ${lastPart}`,
      });
    }

    current.children.delete(lastPart);

    return Promise.resolve({
      success: true,
    });
  }
}

import type {
  DeleteResult,
  ListItem,
  ListOptions,
  ListResult,
  Message,
  NodeProtocolInterface,
  NodeStatus,
  PersistenceRecord,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  ReceiveResult,
  Schema,
} from "../b3nd-core/types.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";

type MemoryClientStorageNode<T> = {
  value?: T;
  children?: Map<string, MemoryClientStorageNode<unknown>>;
};

type MemoryClientStorage = Map<
  string,
  MemoryClientStorageNode<unknown>
>;

export interface MemoryClientConfig {
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
  storage: MemoryClientStorage,
): TargetResult {
  const url = URL.parse(uri)!;
  const program = `${url.protocol}//${url.hostname}`;

  // Auto-create storage for any program — validation is the rig's concern.
  let node = storage.get(program);
  if (!node) {
    node = { children: new Map() };
    storage.set(program, node);
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

  constructor(config: MemoryClientConfig = {}) {
    this.storage = config.storage || new Map();
  }

  public async receive<D = unknown>(
    msg: Message<D>,
  ): Promise<ReceiveResult> {
    const [uri, data] = msg;

    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Message URI is required" };
    }

    const result = target(uri, this.storage);
    if (!result.success) {
      return { accepted: false, error: result.error };
    }
    const { node, parts } = result;

    // Store the data at this URI
    const record = {
      ts: Date.now(),
      data,
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

    // If MessageData, also store each output at its own URI
    if (isMessageData(data)) {
      for (const [outputUri, outputValue] of data.payload.outputs) {
        const outputResult = await this.receive([outputUri, outputValue]);
        if (!outputResult.accepted) {
          return {
            accepted: false,
            error: outputResult.error || `Failed to store output: ${outputUri}`,
          };
        }
      }
    }

    return { accepted: true };
  }

  public read<T>(uri: string): Promise<ReadResult<T>> {
    const result = target(uri, this.storage);
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

  public readMulti<T = unknown>(
    uris: string[],
  ): Promise<ReadMultiResult<T>> {
    if (uris.length === 0) {
      return Promise.resolve({
        success: false,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0 },
      });
    }

    if (uris.length > 50) {
      return Promise.resolve({
        success: false,
        results: [],
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      });
    }

    const results: ReadMultiResultItem<T>[] = [];
    let succeeded = 0;

    for (const uri of uris) {
      const result = target(uri, this.storage);
      if (!result.success) {
        results.push({ uri, success: false, error: result.error });
        continue;
      }

      let current: MemoryClientStorageNode<unknown> | undefined = result.node;
      let found = true;

      for (const part of result.parts.filter(Boolean)) {
        current = current?.children?.get(part);
        if (!current) {
          found = false;
          break;
        }
      }

      if (found && current?.value) {
        results.push({
          uri,
          success: true,
          record: current.value as PersistenceRecord<T>,
        });
        succeeded++;
      } else {
        results.push({ uri, success: false, error: "Not found" });
      }
    }

    return Promise.resolve({
      success: succeeded > 0,
      results,
      summary: {
        total: uris.length,
        succeeded,
        failed: uris.length - succeeded,
      },
    });
  }

  public list(uri: string, options?: ListOptions): Promise<ListResult> {
    const result = target(uri, this.storage);
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

    const prefix = path.endsWith("/")
      ? `${program}${path}`
      : `${program}${path}/`;
    let items: ListItem[] = [];

    function collectLeaves(
      node: MemoryClientStorageNode<unknown>,
      currentUri: string,
    ) {
      if (node.value !== undefined) {
        items.push({ uri: currentUri });
      }
      if (node.children) {
        for (const [key, child] of node.children) {
          collectLeaves(child, `${currentUri}/${key}`);
        }
      }
    }

    for (const [key, child] of current.children) {
      collectLeaves(child, `${prefix}${key}`);
    }

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

  public status(): Promise<NodeStatus> {
    return Promise.resolve({
      healthy: true,
      programs: [...this.storage.keys()],
    });
  }

  public cleanup(): Promise<void> {
    return Promise.resolve();
  }

  public delete(uri: string): Promise<DeleteResult> {
    const result = target(uri, this.storage);
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

/**
 * Default schema for testing that accepts all writes.
 * Includes common b3nd protocol prefixes.
 * This is a rig-level schema (validators), not a client config.
 */
export function createTestSchema(): Schema {
  const acceptAll = async () => ({ valid: true });
  return {
    "mutable://accounts": acceptAll,
    "mutable://open": acceptAll,
    "mutable://data": acceptAll,
    "immutable://accounts": acceptAll,
    "immutable://open": acceptAll,
    "immutable://data": acceptAll,
  };
}

import type {
  DeleteResult,
  HealthStatus,
  ListItem,
  ListOptions,
  ListResult,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadMultiResult,
  ReadMultiResultItem,
  ReadResult,
  Schema,
} from "../../src/types.ts";
import type { Node, ReceiveResult, Transaction } from "../../src/node/types.ts";
import { isTransactionData } from "../../txn-data/detect.ts";

type MemoryClientStorageNode<T> = {
  value?: T;
  children?: Map<string, MemoryClientStorageNode<unknown>>;
};

type MemoryClientStorage = Map<
  string,
  MemoryClientStorageNode<unknown>
>;

export interface MemoryClientConfig {
  /**
   * Schema mapping protocol://hostname to validators.
   *
   * Keys MUST be in format: "protocol://hostname"
   * Examples: "mutable://accounts", "immutable://data", "mutable://open"
   *
   * @example
   * ```typescript
   * const schema = {
   *   "mutable://accounts": async () => ({ valid: true }),
   *   "immutable://accounts": async () => ({ valid: true }),
   * };
   * const client = new MemoryClient({ schema });
   * ```
   */
  schema: Schema;
  storage?: MemoryClientStorage;
}

/**
 * Validate schema key format
 * Keys must be in format: "protocol://hostname"
 */
function validateSchemaKey(key: string): boolean {
  return /^[a-z]+:\/\/[a-z0-9-]+$/.test(key);
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

export class MemoryClient implements NodeProtocolInterface, Node {
  protected storage: MemoryClientStorage;
  protected schema: Schema;

  /**
   * Create a new MemoryClient
   *
   * @param config - Configuration with schema mapping
   * @throws Error if schema keys are not in "protocol://hostname" format
   */
  constructor(config: MemoryClientConfig) {
    // Validate schema key format
    const invalidKeys = Object.keys(config.schema).filter((key) =>
      !validateSchemaKey(key)
    );
    if (invalidKeys.length > 0) {
      throw new Error(
        `Invalid schema key format: ${
          invalidKeys.map((k) => `"${k}"`).join(", ")
        }. ` +
          `Keys must be in "protocol://hostname" format (e.g., "mutable://accounts", "immutable://data").`,
      );
    }

    this.schema = config.schema!;
    this.storage = config.storage || new Map();
    this.cleanup();
  }

  /**
   * Receive a transaction - the unified entry point for all state changes
   * @param tx - Transaction tuple [uri, data]
   * @returns ReceiveResult indicating acceptance
   */
  public async receive<D = unknown>(
    tx: Transaction<D>,
  ): Promise<ReceiveResult> {
    const [uri, data] = tx;

    // Basic URI validation
    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Transaction URI is required" };
    }

    const result = target(uri, this.schema, this.storage);
    if (!result.success) {
      return { accepted: false, error: result.error };
    }
    const { program, node, parts } = result;

    // Validate the write against the schema
    const validator = this.schema[program];
    const validation = await validator({
      uri,
      value: data,
      read: this.read.bind(this),
    });
    if (!validation.valid) {
      return {
        accepted: false,
        error: validation.error || "Validation failed",
      };
    }

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

    // If TransactionData, also store each output at its own URI
    if (isTransactionData(data)) {
      for (const [outputUri, outputValue] of data.outputs) {
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

  public async readMulti<T = unknown>(
    uris: string[],
  ): Promise<ReadMultiResult<T>> {
    // Enforce batch size limit
    if (uris.length > 50) {
      return {
        success: false,
        results: [],
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    }

    const results: ReadMultiResultItem<T>[] = await Promise.all(
      uris.map(async (uri): Promise<ReadMultiResultItem<T>> => {
        const result = await this.read<T>(uri);
        if (result.success && result.record) {
          return { uri, success: true, record: result.record };
        }
        return { uri, success: false, error: result.error || "Read failed" };
      }),
    );

    const succeeded = results.filter((r) => r.success).length;
    return {
      success: succeeded > 0,
      results,
      summary: {
        total: uris.length,
        succeeded,
        failed: uris.length - succeeded,
      },
    };
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

    // Recursively collect all leaf nodes (files) under this path
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

/**
 * Default schema for testing that accepts all writes.
 * Includes common b3nd protocol prefixes.
 *
 * @example
 * ```typescript
 * import { MemoryClient, createTestSchema } from "@bandeira-tech/b3nd-web/clients/memory";
 *
 * const backend = new MemoryClient({ schema: createTestSchema() });
 * ```
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

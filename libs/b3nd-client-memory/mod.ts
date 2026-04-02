import type {
  Message,
  NodeProtocolInterface,
  PersistenceRecord,
  ReadResult,
  ReceiveResult,
  Schema,
  StatusResult,
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

  public read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    const results: ReadResult<T>[] = [];

    for (const uri of uriList) {
      // Trailing slash = list mode
      if (uri.endsWith("/")) {
        results.push(...this._list<T>(uri));
      } else {
        results.push(this._readOne<T>(uri));
      }
    }

    return Promise.resolve(results);
  }

  private _readOne<T>(uri: string): ReadResult<T> {
    const result = target(uri, this.storage);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    const { parts, node } = result;

    let current: MemoryClientStorageNode<unknown> | undefined = node;
    for (const part of parts.filter(Boolean)) {
      current = current?.children?.get(part);
      if (!current) {
        return { success: false, error: `Path not found: ${part}` };
      }
    }

    if (!current.value) {
      return { success: false, error: "Not found" };
    }

    return {
      success: true,
      record: current.value as PersistenceRecord<T>,
    };
  }

  private _list<T>(uri: string): ReadResult<T>[] {
    const result = target(uri, this.storage);
    if (!result.success) {
      return [{ success: false, error: result.error }];
    }
    const { node, parts, program, path } = result;
    let current: MemoryClientStorageNode<unknown> | undefined = node;

    const filteredParts = parts.filter(Boolean);
    for (const part of filteredParts) {
      current = current?.children?.get(part);
      if (!current) {
        return [];
      }
    }

    if (!current.children?.size) {
      return [];
    }

    const prefix = `${program}${path}`;
    const results: ReadResult<T>[] = [];

    function collectLeaves(
      node: MemoryClientStorageNode<unknown>,
      currentUri: string,
    ) {
      if (node.value !== undefined) {
        results.push({
          success: true,
          uri: currentUri,
          record: node.value as PersistenceRecord<T>,
        });
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

    return results;
  }

  public status(): Promise<StatusResult> {
    return Promise.resolve({
      status: "healthy",
      schema: [...this.storage.keys()],
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

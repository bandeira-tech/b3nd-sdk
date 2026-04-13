/**
 * MemoryClient — in-memory implementation of NodeProtocolInterface.
 *
 * Mechanical storage: delete inputs, write outputs. No validation,
 * no conservation — the rig handles classification via programs.
 *
 * Message primitive: [uri, values, data] where data is always
 * { inputs: string[], outputs: Output[] }.
 */

import type {
  Message,
  NodeProtocolInterface,

  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";

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

  /** Internal write listeners for observe(). */
  private _writeListeners = new Set<
    (uri: string, data: unknown) => void
  >();

  constructor(config: MemoryClientConfig = {}) {
    this.storage = config.storage || new Map();
  }

  // ── Mechanical storage ──────────────────────────────────────────────

  /**
   * Receive a batch of messages. For each message:
   * 1. Delete every URI in data.inputs
   * 2. Write every [uri, values, data] in data.outputs
   */
  public async receive(
    msgs: Message[],
  ): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];

    for (const msg of msgs) {
      results.push(this._receiveOne(msg));
    }

    return results;
  }

  private _receiveOne(msg: Message): ReceiveResult {
    const [uri, values, data] = msg;

    if (!uri || typeof uri !== "string") {
      return { accepted: false, error: "Message URI is required" };
    }

    // Check if data follows the { inputs, outputs } envelope convention
    const msgData = data as {
      inputs?: unknown;
      outputs?: unknown;
    } | null;

    const isEnvelope = msgData != null &&
      typeof msgData === "object" &&
      Array.isArray(msgData.inputs) &&
      Array.isArray(msgData.outputs);

    // Always store the message at its URI as a persistence record
    this._write(uri, { values: values || {}, data });

    if (isEnvelope) {
      // Additionally process inputs/outputs mechanically
      const inputs = msgData!.inputs as string[];
      const outputs = msgData!.outputs as [string, Record<string, number>, unknown][];

      for (const inputUri of inputs) {
        this._delete(inputUri);
      }
      for (const [outUri, outValues, outData] of outputs) {
        this._write(outUri, { values: outValues || {}, data: outData });
      }
    }

    return { accepted: true };
  }

  private _write(uri: string, record: { values: Record<string, number>; data: unknown }): void {
    const result = target(uri, this.storage);
    if (!result.success) return;

    const { node, parts } = result;

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

    // Notify observe listeners
    for (const listener of this._writeListeners) {
      listener(uri, record.data);
    }
  }

  private _delete(uri: string): void {
    const result = target(uri, this.storage);
    if (!result.success) return;

    const { node, parts } = result;
    const filteredParts = parts.filter(Boolean);

    let current: MemoryClientStorageNode<unknown> | undefined = node;
    const ancestors: { node: MemoryClientStorageNode<unknown>; key: string }[] = [];

    for (const part of filteredParts) {
      if (!current?.children?.has(part)) return; // doesn't exist
      ancestors.push({ node: current, key: part });
      current = current.children.get(part)!;
    }

    // Remove the value
    delete current.value;

    // Clean up empty ancestors (leaf-to-root)
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const { node: parent, key } = ancestors[i];
      const child = parent.children!.get(key)!;
      if (!child.value && (!child.children || child.children.size === 0)) {
        parent.children!.delete(key);
      } else {
        break;
      }
    }
  }

  // ── Read ────────────────────────────────────────────────────────────

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
      record: current.value as { values: Record<string, number>; data: T },
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
          record: node.value as { values: Record<string, number>; data: T },
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

  // ── Observe ─────────────────────────────────────────────────────────

  async *observe<T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    const { matchPattern } = await import("../b3nd-core/match-pattern.ts");
    const segments = pattern.split("/");

    // Yield matching writes as they arrive
    while (!signal.aborted) {
      const result = await new Promise<ReadResult<T> | null>((resolve) => {
        // Resolve when aborted
        const onAbort = () => {
          cleanup();
          resolve(null);
        };

        const listener = (uri: string, data: unknown) => {
          const params = matchPattern(segments, uri);
          if (params !== null) {
            cleanup();
            resolve({
              success: true,
              uri,
              record: { data: data as T, values: {} },
              params,
            } as ReadResult<T>);
          }
        };

        const cleanup = () => {
          this._writeListeners.delete(listener);
          signal.removeEventListener("abort", onAbort);
        };

        signal.addEventListener("abort", onAbort, { once: true });
        this._writeListeners.add(listener);
      });

      if (result === null) break; // aborted
      yield result;
    }
  }

  // ── Status ──────────────────────────────────────────────────────────

  public status(): Promise<StatusResult> {
    return Promise.resolve({
      status: "healthy",
      schema: [...this.storage.keys()],
    });
  }
}

/**
 * Create a permissive test schema that accepts all common URI patterns.
 */
export function createTestSchema(): Record<string, () => Promise<{ valid: boolean }>> {
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

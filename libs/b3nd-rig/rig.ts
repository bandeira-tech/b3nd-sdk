/**
 * @module
 * Rig — the universal harness for b3nd.
 *
 * Single object that wires up backends, identity, and serving.
 * Two core actions: send (outward to the network) and receive
 * (inward from external sources). Everything else is observation.
 *
 * Supports per-operation client routing, synchronous hooks
 * (pre/post), async events, and URI-pattern reactions.
 */

import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
  ReceiveResult,
  StatusResult,
} from "../b3nd-core/types.ts";
import type { MessageData } from "../b3nd-msg/data/types.ts";
import type { SendResult } from "../b3nd-msg/data/send.ts";
import { send } from "../b3nd-msg/data/send.ts";
import type { Schema, Validator } from "../b3nd-core/types.ts";
import { msgSchema } from "../b3nd-compose/validators.ts";
import type {
  RigConfig,
  RigInfo,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "./types.ts";
import type { ReadCtx, ReceiveCtx, RigHooks, SendCtx } from "./hooks.ts";
import { resolveHooks, runAfter, runBefore } from "./hooks.ts";
import type { EventHandler, RigEventName } from "./events.ts";
import { RigEventEmitter } from "./events.ts";
import type { ReactionHandler } from "./reactions.ts";
import { ReactionRegistry } from "./reactions.ts";
import type { Connection } from "./connection.ts";

/**
 * Rig — pure orchestration for b3nd.
 *
 * The rig is identity-free — it routes, validates, and dispatches.
 * For authenticated operations, use `identity.rig(rig)` to create
 * an AuthenticatedRig session.
 *
 * @example Unsigned operations
 * ```typescript
 * const rig = new Rig({
 *   connections: [connection(client, { receive: ["*"], read: ["*"] })],
 * });
 * await rig.receive(["mutable://open/app/x", data]);
 * const result = await rig.readData("mutable://open/app/x");
 * ```
 *
 * @example Authenticated session
 * ```typescript
 * const id = await Identity.fromSeed("my-secret");
 * const session = id.rig(rig);
 * await session.send({ inputs: [], outputs: [["mutable://app/key", data]] });
 * ```
 *
 * @example With schema, hooks, events, and react
 * ```typescript
 * const rig = new Rig({
 *   connections: [connection(new MemoryClient(), { receive: ["*"], read: ["*"] })],
 *   schema,
 *   hooks: {
 *     beforeReceive: (ctx) => { rateLimit(ctx.uri); },
 *     afterRead: (ctx, result) => { audit(ctx.uri, result); },
 *   },
 *   on: {
 *     "send:success": [audit],
 *   },
 *   reactions: {
 *     "mutable://app/users/:id": (uri, data, { id }) => {
 *       console.log(`User ${id} updated`);
 *     },
 *   },
 * });
 * ```
 */
export class Rig {
  // ── Internal state ──
  private readonly _connections: Connection[];
  private readonly _dispatch: NodeProtocolInterface;
  private readonly _schema: Schema | null;
  private readonly _validator: Validator | null;
  private readonly _hooks: RigHooks;
  private readonly _events: RigEventEmitter;
  private readonly _reactors: ReactionRegistry;

  constructor(config: RigConfig) {
    if (!config.connections || config.connections.length === 0) {
      throw new Error(
        "Rig: `connections` array is required and must not be empty.",
      );
    }

    this._connections = config.connections;
    this._dispatch = createConnectionDispatch(config.connections);
    this._schema = config.schema ?? null;
    this._validator = this._schema ? msgSchema(this._schema) : null;
    this._hooks = resolveHooks(config.hooks);

    // Build event emitter
    this._events = new RigEventEmitter();
    if (config.on) {
      for (const [name, handlers] of Object.entries(config.on)) {
        if (handlers) {
          for (const handler of handlers) {
            this._events.on(name as RigEventName, handler);
          }
        }
      }
    }

    // Build react registry
    this._reactors = new ReactionRegistry();
    if (config.reactions) {
      for (const [pattern, handler] of Object.entries(config.reactions)) {
        this._reactors.add(pattern, handler);
      }
    }
  }

  /**
   * Raw composite client — bypasses hooks, events, and react.
   *
   * Prefer passing the Rig itself (it satisfies `NodeProtocolInterface`).
   * This getter exists for third-party code that requires a plain object.
   */
  get client(): NodeProtocolInterface {
    const d = this._dispatch;
    return {
      receive: (msg) => d.receive(msg),
      read: (uris) => d.read(uris),
      observe: (pattern, signal) => d.observe(pattern, signal),
      status: () => d.status(),
    };
  }

  // ── Core actions ──

  /**
   * Send a pre-built MessageData envelope to the network.
   *
   * Content-addresses the message to `hash://sha256/{hex}` and dispatches it.
   * The rig does NOT sign — pass a pre-signed MessageData (use
   * `identity.rig(rig).send()` or `identity.sign()` for signing).
   *
   * @example Pre-signed via AuthenticatedRig
   * ```typescript
   * const session = identity.rig(rig);
   * await session.send({ inputs: [], outputs: [["mutable://app/x", data]] });
   * ```
   *
   * @example Manual signing
   * ```typescript
   * const payload = { inputs: [], outputs: [["mutable://app/x", data]] };
   * const auth = [await identity.sign(payload)];
   * await rig.send({ auth, payload });
   * ```
   */
  async send<V = unknown>(
    data: MessageData<V>,
  ): Promise<SendResult> {
    // Before-hook — throw to reject
    const ctx: SendCtx = {
      message: data,
    };
    const sendCtx = await runBefore(this._hooks.beforeSend, ctx);
    const messageData = sendCtx.message;

    let result: SendResult;
    try {
      result = await send(messageData, this._dispatch);
    } catch (err) {
      this._events.emit("send:error", {
        op: "send",
        error: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
      throw err;
    }

    // After-hook — observe only
    await runAfter(this._hooks.afterSend, sendCtx, result);

    // Events + react
    if (result.accepted) {
      this._events.emit("send:success", {
        op: "send",
        uri: result.uri,
        data: messageData,
        result,
        ts: Date.now(),
      });
      for (const [outputUri, outputData] of messageData.payload.outputs) {
        this._reactors.match(outputUri, outputData);
      }
    } else {
      this._events.emit("send:error", {
        op: "send",
        error: result.error,
        ts: Date.now(),
      });
    }

    return result;
  }

  /**
   * Receive an external message into the rig.
   *
   * Passes a raw message tuple `[uri, data]` to the underlying client.
   * This is for messages arriving from external sources — other rigs,
   * users, or systems — distinct from what the rig sends to the network.
   *
   * @example
   * ```typescript
   * // Receive a message from an external source
   * const result = await rig.receive(["mutable://open/external", { source: "webhook" }]);
   * console.log(result.accepted); // true
   * ```
   */
  async receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    const [uri, data] = msg;

    // Before-hook — throw to reject
    const ctx: ReceiveCtx = { uri, data };
    const recvCtx = await runBefore(this._hooks.beforeReceive, ctx);
    const finalUri = recvCtx.uri;
    const finalData = recvCtx.data;

    // Schema validation — application-level gatekeeper
    if (this._validator) {
      const readFn = async <T = unknown>(u: string) => {
        const results = await this._dispatch.read<T>(u);
        return results[0] ??
          {
            success: false,
            error: "No results",
          } as import("../b3nd-core/types.ts").ReadResult<T>;
      };
      const validation = await this._validator(
        [finalUri, finalData],
        undefined,
        readFn,
      );
      if (!validation.valid) {
        const error = validation.error || "Schema validation failed";
        this._events.emit("receive:error", {
          op: "receive",
          uri: finalUri,
          error,
          ts: Date.now(),
        });
        return { accepted: false, error };
      }
    }

    // Execute
    let result: ReceiveResult;
    try {
      result = await this._dispatch.receive([finalUri, finalData]);
    } catch (err) {
      this._events.emit("receive:error", {
        op: "receive",
        uri: finalUri,
        error: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
      throw err;
    }

    // After-hook — observe only
    await runAfter(this._hooks.afterReceive, recvCtx, result);

    // Events + react
    if (result.accepted) {
      this._events.emit("receive:success", {
        op: "receive",
        uri: finalUri,
        data: finalData,
        result,
        ts: Date.now(),
      });
      this._reactors.match(finalUri, finalData);
    } else {
      this._events.emit("receive:error", {
        op: "receive",
        uri: finalUri,
        error: result.error,
        ts: Date.now(),
      });
    }

    return result;
  }

  // ── Observation ──

  /**
   * Read data from one or more URIs.
   *
   * - Single URI: returns array with one result
   * - Multiple URIs: returns array with one result per URI
   * - Trailing slash: lists all items under path
   */
  async read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
    const uriList = Array.isArray(uris) ? uris : [uris];

    // Before-hook on each URI
    const finalUris: string[] = [];
    for (const uri of uriList) {
      const ctx: ReadCtx = { uri };
      const readCtx = await runBefore(this._hooks.beforeRead, ctx);
      finalUris.push(readCtx.uri);
    }

    // Execute
    let results: ReadResult<T>[];
    try {
      results = await this._dispatch.read<T>(finalUris);
    } catch (err) {
      for (const uri of finalUris) {
        this._events.emit("read:error", {
          op: "read",
          uri,
          error: err instanceof Error ? err.message : String(err),
          ts: Date.now(),
        });
      }
      throw err;
    }

    // After-hook + events per result
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const requestUri = finalUris[Math.min(i, finalUris.length - 1)];
      const uri = result.uri ?? requestUri;
      await runAfter(this._hooks.afterRead, { uri }, result);

      if (result.success) {
        this._events.emit("read:success", {
          op: "read",
          uri,
          result,
          ts: Date.now(),
        });
      } else {
        this._events.emit("read:error", {
          op: "read",
          uri,
          error: result.error,
          ts: Date.now(),
        });
      }
    }

    return results;
  }

  /**
   * Read just the data from a single URI, returning `null` if not found.
   */
  async readData<T = unknown>(uri: string): Promise<T | null> {
    const results = await this.read<T>(uri);
    const result = results[0];
    return result?.success && result.record ? result.record.data : null;
  }

  /**
   * Read data from a single URI, throwing if not found.
   */
  async readOrThrow<T = unknown>(uri: string): Promise<T> {
    const results = await this.read<T>(uri);
    const result = results[0];
    if (!result?.success || !result.record) {
      throw new Error(
        `Rig.readOrThrow: no data at ${uri}${
          result?.error ? ` (${result.error})` : ""
        }`,
      );
    }
    return result.record.data;
  }

  /**
   * Check if data exists at a URI.
   */
  async exists(uri: string): Promise<boolean> {
    const results = await this.read(uri);
    return results[0]?.success ?? false;
  }

  /**
   * Count items under a URI prefix.
   * Uses trailing-slash read to list items.
   */
  async count(uri: string): Promise<number> {
    const prefix = uri.endsWith("/") ? uri : `${uri}/`;
    const results = await this.read(prefix);
    return results.filter((r) => r.success).length;
  }

  /**
   * List URIs under a prefix — convenience for read with trailing slash.
   * Returns URI strings extracted from successful results.
   */
  private async listData(prefix: string): Promise<string[]> {
    const listUri = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const results = await this.read(listUri);
    return results
      .filter((r) => r.success)
      .map((r) => r.uri ?? "")
      .filter(Boolean);
  }

  // ── Observe (client-backed streaming) ──

  /**
   * Observe changes matching a URI pattern.
   *
   * Routes to the first connection that accepts `observe` for the pattern,
   * then delegates to the client's native transport (SSE, internal events, etc).
   *
   * @example
   * ```typescript
   * const abort = new AbortController();
   * for await (const result of rig.observe("mutable://data/market/*", abort.signal)) {
   *   console.log(result.uri, result.record?.data);
   * }
   * ```
   */
  async *observe<T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    // Strip :param and * segments to get the matchable prefix
    const segments = pattern.split("/");
    const matchUri = segments
      .filter((s) => !s.startsWith(":") && s !== "*")
      .join("/");

    // Find the first connection that accepts observe for this prefix
    for (const conn of this._connections) {
      if (conn.accepts("observe", matchUri)) {
        yield* conn.client.observe<T>(pattern, signal);
        return;
      }
    }
    // No connection accepts observe — empty stream
  }

  // ── Inspection ──

  /**
   * Get a snapshot of this rig's current state.
   *
   * Pure local inspection, no network calls.
   *
   * @example
   * ```typescript
   * const info = rig.info();
   * console.log(info.behavior.hooks);
   * console.log(info.behavior.reactors);
   * ```
   */
  info(): RigInfo {
    const hooks: string[] = [];
    const h = this._hooks;
    if (h.beforeSend) hooks.push("beforeSend");
    if (h.afterSend) hooks.push("afterSend");
    if (h.beforeReceive) hooks.push("beforeReceive");
    if (h.afterReceive) hooks.push("afterReceive");
    if (h.beforeRead) hooks.push("beforeRead");
    if (h.afterRead) hooks.push("afterRead");

    return {
      behavior: {
        hooks,
        events: this._events.counts(),
        reactors: this._reactors.size,
      },
    };
  }

  // ── Infrastructure ──

  /**
   * Status — health + schema.
   * Aggregates client status and includes rig schema if set.
   */
  async status(): Promise<StatusResult> {
    const clientStatus = await this._dispatch.status();
    if (this._schema) {
      return { ...clientStatus, schema: Object.keys(this._schema) };
    }
    return clientStatus;
  }

  /**
   * Return any in-flight event handler promises and clear the queue.
   */
  drain(): Promise<void>[] {
    return this._events.pending();
  }

  // ── Runtime API: events, react ──
  // Hooks are immutable after init — see createHookChains().

  /**
   * Register an event handler at runtime. Returns an unsubscribe function.
   *
   * @example
   * ```typescript
   * const unsub = rig.on("send:success", (event) => {
   *   console.log(`Sent to ${event.uri}`);
   * });
   *
   * // Later:
   * unsub();
   * ```
   */
  on(event: RigEventName, handler: EventHandler): () => void {
    return this._events.on(event, handler);
  }

  /** Remove a specific event handler. */
  off(event: RigEventName, handler: EventHandler): void {
    this._events.off(event, handler);
  }

  /**
   * Register a react pattern at runtime. Returns an unsubscribe function.
   *
   * Fires on successful `send()` or `receive()` when the written URI
   * matches the pattern. Fire-and-forget — errors are caught and logged.
   *
   * @example
   * ```typescript
   * const unsub = rig.reaction("mutable://app/users/:id", (uri, data, { id }) => {
   *   console.log(`User ${id} updated:`, data);
   * });
   *
   * // Later:
   * unsub();
   * ```
   */
  reaction(pattern: string, handler: ReactionHandler): () => void {
    return this._reactors.add(pattern, handler);
  }

  // ── Reactive ──

  /**
   * Watch a URI for changes, yielding new values as they appear.
   *
   * Polls the URI at `intervalMs` (default 1000ms) and yields the value
   * whenever it changes. Uses JSON comparison for deduplication — only
   * emits when the data actually differs from the previous read.
   *
   * Pass an `AbortSignal` to stop watching.
   *
   * @example
   * ```typescript
   * const abort = new AbortController();
   *
   * for await (const profile of rig.watch<UserProfile>(
   *   "mutable://app/users/alice",
   *   { intervalMs: 2000, signal: abort.signal },
   * )) {
   *   console.log("Profile updated:", profile);
   * }
   * ```
   */
  async *watch<T = unknown>(
    uri: string,
    options?: WatchOptions,
  ): AsyncGenerator<T | null, void, unknown> {
    const interval = options?.intervalMs ?? 1000;
    const signal = options?.signal;

    let lastJson: string | undefined;

    while (!signal?.aborted) {
      const value = await this.readData<T>(uri);
      const json = JSON.stringify(value);

      if (json !== lastJson) {
        lastJson = json;
        yield value;
      }

      // Wait for next poll or abort
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, interval);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  }

  /**
   * Watch a URI prefix for collection-level changes.
   *
   * Polls the prefix, reads all items, and yields a snapshot whenever the
   * collection changes — items added, removed, or modified. Useful for
   * dashboards, lists, and any UI that renders a collection.
   *
   * @example
   * ```typescript
   * const abort = new AbortController();
   *
   * for await (const snapshot of rig.watchAll<UserProfile>(
   *   "mutable://app/users",
   *   { intervalMs: 2000, signal: abort.signal },
   * )) {
   *   console.log(`${snapshot.items.size} users`);
   *   console.log("Added:", snapshot.added);
   *   console.log("Removed:", snapshot.removed);
   *   console.log("Changed:", snapshot.changed);
   * }
   * ```
   */
  async *watchAll<T = unknown>(
    prefix: string,
    options?: WatchAllOptions,
  ): AsyncGenerator<WatchAllSnapshot<T>, void, unknown> {
    const interval = options?.intervalMs ?? 1000;
    const signal = options?.signal;

    let lastItems = new Map<string, string>(); // uri → JSON

    while (!signal?.aborted) {
      const listPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
      const results = await this.read<T>(listPrefix);
      const items = new Map<string, T>();
      for (const r of results) {
        if (r.success && r.record && r.uri) {
          items.set(r.uri, r.record.data);
        }
      }
      const currentJson = new Map<string, string>();
      for (const [uri, data] of items) {
        currentJson.set(uri, JSON.stringify(data));
      }

      // Diff against previous
      const added: string[] = [];
      const removed: string[] = [];
      const changed: string[] = [];

      for (const uri of currentJson.keys()) {
        if (!lastItems.has(uri)) {
          added.push(uri);
        } else if (lastItems.get(uri) !== currentJson.get(uri)) {
          changed.push(uri);
        }
      }
      for (const uri of lastItems.keys()) {
        if (!currentJson.has(uri)) {
          removed.push(uri);
        }
      }

      // Emit if anything changed (or on first poll)
      if (
        lastItems.size === 0 || added.length > 0 || removed.length > 0 ||
        changed.length > 0
      ) {
        yield { items, added, removed, changed };
      }

      lastItems = currentJson;

      // Wait for next poll or abort
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, interval);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  }

  /**
   * Send multiple pre-built MessageData envelopes in sequence.
   *
   * Each entry becomes its own content-hashed envelope. Use
   * `session.sendMany()` (on AuthenticatedRig) for the signed convenience.
   *
   * @example
   * ```typescript
   * const session = identity.rig(rig);
   * const results = await session.sendMany([
   *   { inputs: [], outputs: [["mutable://app/counter", { value: 1 }]] },
   *   { inputs: [], outputs: [["mutable://app/log/1", { event: "init" }]] },
   * ]);
   * ```
   */
  async sendMany<V = unknown>(
    envelopes: MessageData<V>[],
  ): Promise<SendResult[]> {
    if (envelopes.length === 0) return [];
    const results: SendResult[] = [];
    for (const envelope of envelopes) {
      results.push(await this.send(envelope));
    }
    return results;
  }
}

// ── Init helpers ──

/**
 * Build dispatch from connections.
 *
 * Each operation is routed through connections:
 * - Writes (receive): broadcast to ALL matching connections.
 * - Reads (read): first-match in declaration order.
 * - Observe: first-match in declaration order (client handles transport).
 * - Status: aggregate across unique clients.
 */
function createConnectionDispatch(
  connections: Connection[],
): NodeProtocolInterface {
  return {
    async receive(msg) {
      const [uri] = msg;
      const matching = connections.filter((s) => s.accepts("receive", uri));
      if (matching.length === 0) {
        return {
          accepted: false,
          error: `No connection accepts receive for ${uri}`,
        };
      }
      const results = await Promise.all(
        matching.map((s) => s.client.receive(msg)),
      );
      const failed = results.find((r) => !r.accepted);
      if (failed) return failed;
      return results[0];
    },

    async read<T = unknown>(uris: string | string[]): Promise<ReadResult<T>[]> {
      const uriList = Array.isArray(uris) ? uris : [uris];
      const allResults: ReadResult<T>[] = [];

      for (const uri of uriList) {
        // Strip trailing slash for pattern matching (read patterns cover both)
        const isList = uri.endsWith("/");
        const matchUri = isList ? uri.slice(0, -1) : uri;
        let found = false;
        for (const s of connections) {
          if (!s.accepts("read", matchUri)) continue;
          const results = await s.client.read<T>(uri);
          // For list (trailing-slash) reads, an empty array is a valid result
          // meaning "prefix exists but has no items" — don't fall through to error.
          if (isList) {
            allResults.push(...results);
            found = true;
            break;
          }
          if (results.length > 0 && results.some((r) => r.success)) {
            allResults.push(...results);
            found = true;
            break;
          }
        }
        if (!found) {
          allResults.push({
            success: false,
            error: `No connection has data for ${uri}`,
          });
        }
      }

      return allResults;
    },

    async *observe<T = unknown>(
      pattern: string,
      signal: AbortSignal,
    ): AsyncIterable<ReadResult<T>> {
      // Strip :param and * segments to get the matchable prefix
      const segments = pattern.split("/");
      const matchUri = segments
        .filter((s) => !s.startsWith(":") && s !== "*")
        .join("/");

      for (const conn of connections) {
        if (conn.accepts("observe", matchUri)) {
          yield* conn.client.observe<T>(pattern, signal);
          return;
        }
      }
    },

    async status(): Promise<StatusResult> {
      const seen = new Set<NodeProtocolInterface>();
      const unique: NodeProtocolInterface[] = [];
      for (const s of connections) {
        if (!seen.has(s.client)) {
          seen.add(s.client);
          unique.push(s.client);
        }
      }
      const results = await Promise.all(unique.map((c) => c.status()));
      const allSchema = new Set<string>();
      for (const r of results) {
        if (r.schema) {
          for (const k of r.schema) allSchema.add(k);
        }
      }
      const unhealthy = results.find((r) => r.status === "unhealthy");
      if (unhealthy) return { ...unhealthy, schema: [...allSchema] };
      const degraded = results.find((r) => r.status === "degraded");
      if (degraded) return { ...degraded, schema: [...allSchema] };
      return { status: "healthy", schema: [...allSchema] };
    },
  };
}

// ── Compile-time assertion ──
// Rig structurally satisfies NodeProtocolInterface, so it can be
// passed directly to any function that expects a client.
// deno-lint-ignore no-unused-vars
const _rigIsClient: NodeProtocolInterface = null! as Rig;

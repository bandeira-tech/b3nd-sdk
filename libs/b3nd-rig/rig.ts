/**
 * @module
 * Rig — the universal harness for b3nd.
 *
 * Single object that wires up backends, identity, and serving.
 * Two core actions: send (outward to the network) and receive
 * (inward from external sources). Everything else is observation.
 *
 * Supports per-operation client routing, synchronous hooks
 * (pre/post), async events, and URI-pattern observe reactions.
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
  SubscribeHandler,
  SubscribeOptions,
  Unsubscribe,
  WatchAllOptions,
  WatchAllSnapshot,
  WatchOptions,
} from "./types.ts";
import type { ReadCtx, ReceiveCtx, RigHooks, SendCtx } from "./hooks.ts";
import { resolveHooks, runAfter, runBefore } from "./hooks.ts";
import type { EventHandler, RigEventName } from "./events.ts";
import { RigEventEmitter } from "./events.ts";
import type { ObserveHandler } from "./observe.ts";
import { ObserveRegistry } from "./observe.ts";
import type { Connection } from "./connection.ts";
import { createRigHandler } from "./http-handler.ts";
import { openSseStream } from "../b3nd-client-http/sse.ts";
import { matchPattern } from "./observe.ts";

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
 * @example With schema, hooks, events, and observe
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
 *   observe: {
 *     "mutable://app/users/:id": (uri, data, { id }) => {
 *       console.log(`User ${id} updated`);
 *     },
 *   },
 * });
 * ```
 */
export class Rig {
  // ── Internal state ──
  private readonly _dispatch: NodeProtocolInterface;
  private readonly _schema: Schema | null;
  private readonly _validator: Validator | null;
  private readonly _hooks: RigHooks;
  private readonly _events: RigEventEmitter;
  private readonly _observers: ObserveRegistry;
  /** Base URL for SSE subscriptions. */
  private readonly _sseBaseUrl: string | null;

  constructor(config: RigConfig) {
    if (!config.connections || config.connections.length === 0) {
      throw new Error(
        "Rig: `connections` array is required and must not be empty.",
      );
    }

    this._dispatch = createConnectionDispatch(config.connections);
    this._schema = config.schema ?? null;
    this._validator = this._schema ? msgSchema(this._schema) : null;
    this._hooks = resolveHooks(config.hooks);
    this._sseBaseUrl = config.sseBaseUrl ?? null;

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

    // Build observe registry
    this._observers = new ObserveRegistry();
    if (config.observe) {
      for (const [pattern, handler] of Object.entries(config.observe)) {
        this._observers.add(pattern, handler);
      }
    }
  }

  /**
   * Raw composite client — bypasses hooks, events, and observe.
   *
   * Prefer passing the Rig itself (it satisfies `NodeProtocolInterface`).
   * This getter exists for third-party code that requires a plain object.
   */
  get client(): NodeProtocolInterface {
    const d = this._dispatch;
    return {
      receive: (msg) => d.receive(msg),
      read: (uris) => d.read(uris),
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

    // Events + observe
    if (result.accepted) {
      this._events.emit("send:success", {
        op: "send",
        uri: result.uri,
        data: messageData,
        result,
        ts: Date.now(),
      });
      for (const [outputUri, outputData] of messageData.payload.outputs) {
        this._observers.match(outputUri, outputData);
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

    // Events + observe
    if (result.accepted) {
      this._events.emit("receive:success", {
        op: "receive",
        uri: finalUri,
        data: finalData,
        result,
        ts: Date.now(),
      });
      this._observers.match(finalUri, finalData);
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
      const uri = finalUris[Math.min(i, finalUris.length - 1)];
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
    return results.length;
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

  // ── Inspection ──

  /**
   * Get a snapshot of this rig's current state.
   *
   * Pure local inspection, no network calls.
   *
   * @example
   * ```typescript
   * const info = rig.info();
   * console.log(info.pubkey);     // "ab12..." or null
   * console.log(info.canSign);    // true
   * console.log(info.canEncrypt); // true
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
        observers: this._observers.size,
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

  // ── Runtime API: events, observe ──
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
   * Register an observe pattern at runtime. Returns an unsubscribe function.
   *
   * Fires on successful `send()` or `receive()` when the written URI
   * matches the pattern.
   *
   * @example
   * ```typescript
   * const unsub = rig.observe("mutable://app/users/:id", (uri, data, { id }) => {
   *   console.log(`User ${id} updated:`, data);
   * });
   *
   * // Later:
   * unsub();
   * ```
   */
  observe(pattern: string, handler: ObserveHandler): () => void {
    return this._observers.add(pattern, handler);
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
   * Subscribe to changes at a URI or URI pattern.
   *
   * **Single URI** (legacy): wraps `watch()` into callback style.
   * **URI pattern**: uses SSE when available, falls back to polling.
   * Patterns use Express-style matching: `:param` captures a segment,
   * `*` matches the rest.
   *
   * @example Single URI
   * ```typescript
   * const unsub = rig.subscribe<UserProfile>(
   *   "mutable://app/users/alice",
   *   (value) => setProfile(value),
   *   { intervalMs: 2000 },
   * );
   * ```
   *
   * @example URI pattern (fires for any matching write)
   * ```typescript
   * const unsub = rig.subscribe<MarketMessage>(
   *   "mutable://data/market/X/:msgId",
   *   (uri, data, { msgId }) => {
   *     console.log(`New message ${msgId}:`, data);
   *   },
   * );
   * ```
   */
  subscribe<T = unknown>(
    uri: string,
    callback: (value: T | null) => void,
    options?: SubscribeOptions,
  ): Unsubscribe;
  subscribe<T = unknown>(
    pattern: string,
    handler: SubscribeHandler<T>,
    options?: SubscribeOptions,
  ): Unsubscribe;
  subscribe<T = unknown>(
    uriOrPattern: string,
    handler:
      | ((value: T | null) => void)
      | SubscribeHandler<T>,
    options?: SubscribeOptions,
  ): Unsubscribe {
    // Detect pattern vs single URI — patterns have :param or *
    const isPattern = uriOrPattern.includes("/:") ||
      uriOrPattern.endsWith("/*");

    if (isPattern) {
      return this._subscribePattern<T>(
        uriOrPattern,
        handler as SubscribeHandler<T>,
        options,
      );
    }

    // Legacy single-URI subscribe via watch()
    const abort = new AbortController();
    const opts: WatchOptions = {
      intervalMs: options?.intervalMs,
      signal: options?.signal ?? abort.signal,
    };
    const callback = handler as (value: T | null) => void;

    (async () => {
      for await (const value of this.watch<T>(uriOrPattern, opts)) {
        if (abort.signal.aborted) break;
        callback(value);
      }
    })();

    return () => abort.abort();
  }

  /** Pattern-based subscription — SSE when available, polling fallback. */
  private _subscribePattern<T>(
    pattern: string,
    handler: SubscribeHandler<T>,
    options?: SubscribeOptions,
  ): Unsubscribe {
    const abort = new AbortController();
    const signal = options?.signal;
    const patternSegments = pattern.split("/");

    // Link external signal to our abort
    if (signal) {
      signal.addEventListener("abort", () => abort.abort(), { once: true });
    }

    // Extract prefix from pattern (strip :param and * segments)
    const prefix = patternSegments
      .filter((s) => !s.startsWith(":") && s !== "*")
      .join("/");

    if (this._sseBaseUrl) {
      // SSE transport — real-time push
      this._subscribeSse<T>(
        prefix,
        patternSegments,
        handler,
        abort,
      );
    } else {
      // Polling fallback
      this._subscribePoll<T>(
        prefix,
        patternSegments,
        handler,
        options?.intervalMs ?? 2000,
        abort,
      );
    }

    return () => abort.abort();
  }

  /** SSE-based subscription. */
  private _subscribeSse<T>(
    prefix: string,
    patternSegments: string[],
    handler: SubscribeHandler<T>,
    abort: AbortController,
  ): void {
    // Convert URI prefix to SSE endpoint path
    // "mutable://data/market/X" → "/api/v1/subscribe/mutable/data/market/X"
    const uriPath = prefix.replace("://", "/");
    const url = `${this._sseBaseUrl}/api/v1/subscribe/${uriPath}`;

    (async () => {
      try {
        for await (
          const event of openSseStream(url, { signal: abort.signal })
        ) {
          if (abort.signal.aborted) break;
          const params = matchPattern(patternSegments, event.uri);
          if (params !== null) {
            try {
              await handler(event.uri, event.data as T, params);
            } catch (err) {
              console.warn(
                `[rig] subscribe handler error for "${event.uri}":`,
                err,
              );
            }
          }
        }
      } catch {
        // Stream ended or aborted
      }
    })();
  }

  /** Polling-based subscription fallback. */
  private _subscribePoll<T>(
    prefix: string,
    patternSegments: string[],
    handler: SubscribeHandler<T>,
    intervalMs: number,
    abort: AbortController,
  ): void {
    const seen = new Set<string>();

    (async () => {
      while (!abort.signal.aborted) {
        try {
          const uris = await this.listData(prefix);
          for (const uri of uris) {
            if (seen.has(uri)) continue;
            seen.add(uri);

            const params = matchPattern(patternSegments, uri);
            if (params === null) continue;

            const data = await this.readData<T>(uri);
            if (data !== null) {
              try {
                await handler(uri, data, params);
              } catch (err) {
                console.warn(
                  `[rig] subscribe handler error for "${uri}":`,
                  err,
                );
              }
            }
          }
        } catch {
          // List/read failed — retry on next poll
        }

        // Wait for next poll or abort
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, intervalMs);
          abort.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
    })();
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

  // ── Handler ──

  /**
   * Create an HTTP fetch handler for this rig's client.
   *
   * Returns a standard `(Request) => Promise<Response>` function — no
   * framework, no CORS, no port binding. Plug it into any server:
   *
   * @example Deno.serve
   * ```typescript
   * const handler = await rig.handler();
   * Deno.serve({ port: 3000 }, handler);
   * ```
   *
   * @example Hono (add CORS, middleware, etc.)
   * ```typescript
   * const app = new Hono();
   * app.use("*", cors({ origin: "*" }));
   * const handler = await rig.handler();
   * app.all("/api/*", (c) => handler(c.req.raw));
   * ```
   */
  /**
   * Create an HTTP request handler backed by this rig.
   *
   * Returns a standard `(Request) => Promise<Response>` — plug it
   * into `Deno.serve()`, Hono, or any HTTP framework.
   *
   * SSE subscriptions are powered by rig events — when `rig.receive()`
   * or `rig.send()` succeeds, SSE subscribers with matching prefixes
   * receive the event in real-time. No external subscription bus needed.
   *
   * @example Deno.serve
   * ```typescript
   * const handler = rig.handler();
   * Deno.serve({ port: 3000 }, handler);
   * ```
   *
   * @example Hono (add CORS, middleware, etc.)
   * ```typescript
   * const app = new Hono();
   * app.use("*", cors({ origin: "*" }));
   * const handler = rig.handler();
   * app.all("/api/*", (c) => handler(c.req.raw));
   * ```
   */
  handler(options?: {
    healthMeta?: Record<string, unknown>;
  }): (req: Request) => Promise<Response> {
    return createRigHandler(this, options);
  }
}

// ── Init helpers ──

/**
 * Build dispatch from connections.
 *
 * Each operation is routed through connections:
 * - Writes (receive): broadcast to ALL matching connections.
 * - Reads (read): first-match in declaration order.
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

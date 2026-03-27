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
  DeleteResult,
  HealthStatus,
  ListOptions,
  ListResult,
  Message,
  NodeProtocolInterface,
  ReadMultiResult,
  ReadResult,
  ReceiveResult,
} from "../b3nd-core/types.ts";
import type { MessageData } from "../b3nd-msg/data/types.ts";
import type { SendResult } from "../b3nd-msg/data/send.ts";
import { send } from "../b3nd-msg/data/send.ts";
import { parallelBroadcast } from "../b3nd-combinators/parallel-broadcast.ts";
import { firstMatchSequence } from "../b3nd-combinators/first-match-sequence.ts";
import { createValidatedClient } from "../b3nd-compose/validated-client.ts";
import { msgSchema } from "../b3nd-compose/validators.ts";
import { createClientFromUrl } from "./backend-factory.ts";
import type { Identity } from "./identity.ts";
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
import type { HookChains, HookContext } from "./hooks.ts";
import { createHookChains, runPostHooks, runPreHooks } from "./hooks.ts";
import type { EventHandler, RigEventName } from "./events.ts";
import { RigEventEmitter } from "./events.ts";
import type { ObserveHandler } from "./observe.ts";
import { ObserveRegistry } from "./observe.ts";
import { clientAccepts } from "./filter.ts";
import { createRigHandler } from "./http-handler.ts";
import { openSseStream } from "../b3nd-client-http/sse.ts";
import { matchPattern } from "./observe.ts";

/** Per-operation client map. */
interface OpClients {
  send: NodeProtocolInterface;
  receive: NodeProtocolInterface;
  read: NodeProtocolInterface;
  list: NodeProtocolInterface;
  delete: NodeProtocolInterface;
}

/**
 * Rig — the single import for working with b3nd.
 *
 * Two core actions model network communication:
 * - `send({ inputs, outputs })` — send a structured envelope to the network
 * - `receive([uri, data])` — receive an external message into the rig
 *
 * Everything else is observation: read, list, watch, exists.
 *
 * Supports per-operation client routing, hooks, events, and observe:
 *
 * @example Basic
 * ```typescript
 * import { Rig, Identity } from "@b3nd/rig";
 *
 * const id = await Identity.fromSeed("my-secret");
 * const rig = await Rig.init({
 *   identity: id,
 *   use: "https://node.b3nd.net",
 * });
 *
 * await rig.send({
 *   inputs: [],
 *   outputs: [["mutable://app/key", { hello: "world" }]],
 * });
 * ```
 *
 * @example With hooks, events, and observe
 * ```typescript
 * const rig = await Rig.init({
 *   use: "memory://",
 *   identity: id,
 *   hooks: {
 *     receive: { pre: [validateSchema] },
 *     read:    { post: [decrypt] },
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
  /** The current identity. Swappable at any time. */
  identity: Identity | null;

  // ── Internal state ──
  private readonly _clients: OpClients;
  private readonly _hooks: HookChains;
  private readonly _events: RigEventEmitter;
  private readonly _observers: ObserveRegistry;
  /** Base URL for SSE subscriptions — set when init'd via HTTP URL. */
  private readonly _sseBaseUrl: string | null;

  private constructor(
    clients: OpClients,
    identity: Identity | null,
    hooks: HookChains,
    events: RigEventEmitter,
    observers: ObserveRegistry,
    sseBaseUrl: string | null = null,
  ) {
    this._clients = clients;
    this.identity = identity;
    this._hooks = hooks;
    this._events = events;
    this._observers = observers;
    this._sseBaseUrl = sseBaseUrl;
  }

  /**
   * Raw composite client — bypasses hooks, events, and observe.
   *
   * Prefer passing the Rig itself (it satisfies `NodeProtocolInterface`).
   * This getter exists for third-party code that requires a plain object.
   *
   * @deprecated Pass the Rig instance directly instead.
   */
  get client(): NodeProtocolInterface {
    const c = this._clients;
    return {
      receive: (msg) => c.receive.receive(msg),
      read: (uri) => c.read.read(uri),
      readMulti: (uris) => c.read.readMulti(uris),
      list: (uri, opts) => c.list.list(uri, opts),
      delete: (uri) => c.delete.delete(uri),
      health: () => c.read.health(),
      getSchema: () => c.read.getSchema(),
      cleanup: () => this._cleanupAllClients(),
    };
  }

  // ── Init ──

  /**
   * Initialize a Rig from config.
   *
   * - `use: "https://..."` → single HttpClient
   * - `use: ["postgresql://...", "https://..."]` → parallelBroadcast writes, firstMatchSequence reads
   * - `client: myClient` → use a pre-built client directly
   * - `clients: [...]` → array of filtered clients, rig routes by `accepts()`
   * - `clients: { read: [...], send: [...] }` → per-operation routing (legacy)
   * - `hooks`, `on`, `observe` → behavior layers
   */
  static async init(config: RigConfig): Promise<Rig> {
    let opClients: OpClients;

    if (Array.isArray(config.clients)) {
      // Array form — clients declare what they accept via accepts()
      opClients = createDispatchClients(config.clients);
    } else {
      // Legacy form — use/client with optional per-op overrides
      const defaultClient = await resolveDefaultClient(config);
      opClients = await resolveOpClients(config, defaultClient);
    }

    // 3. Build hook chains (frozen — immutable after init)
    const hooks = createHookChains(config.hooks);

    // 4. Build event emitter
    const events = new RigEventEmitter();
    if (config.on) {
      for (const [name, handlers] of Object.entries(config.on)) {
        if (handlers) {
          for (const handler of handlers) {
            events.on(name as RigEventName, handler);
          }
        }
      }
    }

    // 5. Build observe registry
    const observers = new ObserveRegistry();
    if (config.observe) {
      for (const [pattern, handler] of Object.entries(config.observe)) {
        observers.add(pattern, handler);
      }
    }

    // 6. Detect SSE base URL from config
    let sseBaseUrl: string | null = null;
    if (typeof config.use === "string") {
      const url = config.use;
      if (url.startsWith("http://") || url.startsWith("https://")) {
        sseBaseUrl = url.replace(/\/$/, "");
      }
    } else if (Array.isArray(config.use)) {
      // Use first HTTP URL if available
      const httpUrl = config.use.find(
        (u) =>
          typeof u === "string" &&
          (u.startsWith("http://") || u.startsWith("https://")),
      );
      if (httpUrl) sseBaseUrl = httpUrl.replace(/\/$/, "");
    }

    return new Rig(
      opClients,
      config.identity ?? null,
      hooks,
      events,
      observers,
      sseBaseUrl,
    );
  }

  // ── Core actions ──

  /**
   * Send a structured envelope to the network.
   *
   * Builds a MessageData envelope with auth (signed by the current identity),
   * content-addresses it to `hash://sha256/{hex}`, and sends it. The receiving
   * node unpacks the outputs and processes them according to its schema.
   *
   * This is the Rig's outward action — messages going into the network.
   *
   * @throws If no identity is set.
   *
   * @example
   * ```typescript
   * await rig.send({
   *   inputs: ["mutable://app/counter"],
   *   outputs: [["mutable://app/counter", { value: 42 }]],
   * });
   * ```
   */
  async send<V = unknown>(
    data: { inputs: string[]; outputs: [uri: string, value: V][] },
  ): Promise<SendResult> {
    if (!this.identity) {
      throw new Error(
        "Rig.send: no identity set — cannot sign. Set rig.identity first.",
      );
    }

    // Pre-hooks — throw to reject
    const ctx: HookContext = {
      op: "send",
      envelope: { inputs: data.inputs, outputs: data.outputs },
      identity: this.identity,
    };
    const sendCtx = await runPreHooks(this._hooks.send.pre, ctx);
    const envelope = sendCtx.op === "send" ? sendCtx.envelope : data;

    // Execute
    const payload = { inputs: envelope.inputs, outputs: envelope.outputs };
    const auth = [await this.identity.sign(payload)];
    const messageData = { auth, payload } as MessageData<V>;

    let result: SendResult;
    try {
      result = await send(messageData, this._clients.send);
    } catch (err) {
      this._events.emit("send:error", {
        op: "send",
        error: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
      throw err;
    }

    // Post-hooks — observe only, cannot modify result
    await runPostHooks(this._hooks.send.post, sendCtx, result);

    // Events + observe
    if (result.accepted) {
      this._events.emit("send:success", {
        op: "send",
        uri: result.uri,
        data: envelope,
        result,
        ts: Date.now(),
      });
      for (const [outputUri, outputData] of envelope.outputs) {
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

    // Pre-hooks — throw to reject
    const ctx: HookContext = { op: "receive", uri, data };
    const recvCtx = await runPreHooks(this._hooks.receive.pre, ctx);
    const finalUri = recvCtx.op === "receive" ? recvCtx.uri : uri;
    const finalData = recvCtx.op === "receive" ? recvCtx.data : data;

    // Execute
    let result: ReceiveResult;
    try {
      result = await this._clients.receive.receive([finalUri, finalData]);
    } catch (err) {
      this._events.emit("receive:error", {
        op: "receive",
        uri: finalUri,
        error: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
      throw err;
    }

    // Post-hooks — observe only
    await runPostHooks(this._hooks.receive.post, recvCtx, result);

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

  /** Read data from a URI. */
  async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    // Pre-hooks — throw to reject
    const ctx: HookContext = { op: "read", uri };
    const readCtx = await runPreHooks(this._hooks.read.pre, ctx);
    const finalUri = readCtx.op === "read" ? readCtx.uri : uri;

    // Execute
    let result: ReadResult<T>;
    try {
      result = await this._clients.read.read<T>(finalUri);
    } catch (err) {
      this._events.emit("read:error", {
        op: "read",
        uri: finalUri,
        error: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
      throw err;
    }

    // Post-hooks — observe only
    await runPostHooks(this._hooks.read.post, readCtx, result);

    // Events
    if (result.success) {
      this._events.emit("read:success", {
        op: "read",
        uri: finalUri,
        result,
        ts: Date.now(),
      });
    } else {
      this._events.emit("read:error", {
        op: "read",
        uri: finalUri,
        error: result.error,
        ts: Date.now(),
      });
    }

    return result;
  }

  /** Batch read multiple URIs. Fires read events per-URI. */
  async readMany<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    const result = await this._clients.read.readMulti<T>(uris);

    // Fire events for each URI result
    for (const item of result.results) {
      if (item.success) {
        this._events.emit("read:success", {
          op: "read",
          uri: item.uri,
          result: item,
          ts: Date.now(),
        });
      } else {
        this._events.emit("read:error", {
          op: "read",
          uri: item.uri,
          error: "error" in item
            ? (item as { error?: string }).error
            : undefined,
          ts: Date.now(),
        });
      }
    }

    return result;
  }

  /**
   * Alias for `readMany` — satisfies `NodeProtocolInterface.readMulti`.
   *
   * The Rig structurally implements `NodeProtocolInterface`, so it can be
   * passed directly to any function that expects a client.
   */
  readMulti<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    return this.readMany<T>(uris);
  }

  /** List items at a URI path. */
  async list(uri: string, options?: ListOptions): Promise<ListResult> {
    // Pre-hooks — throw to reject
    const ctx: HookContext = { op: "list", uri, options };
    const listCtx = await runPreHooks(this._hooks.list.pre, ctx);
    const finalUri = listCtx.op === "list" ? listCtx.uri : uri;
    const finalOpts = listCtx.op === "list" ? listCtx.options : options;

    // Execute
    let result: ListResult;
    try {
      result = await this._clients.list.list(finalUri, finalOpts);
    } catch (err) {
      this._events.emit("list:error", {
        op: "list",
        uri: finalUri,
        error: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
      throw err;
    }

    // Post-hooks — observe only
    await runPostHooks(this._hooks.list.post, listCtx, result);

    // Events
    if (result.success) {
      this._events.emit("list:success", {
        op: "list",
        uri: finalUri,
        result,
        ts: Date.now(),
      });
    } else {
      this._events.emit("list:error", {
        op: "list",
        uri: finalUri,
        error: "error" in result
          ? (result as { error?: string }).error
          : undefined,
        ts: Date.now(),
      });
    }

    return result;
  }

  /**
   * List URIs at a path, returning just the URI strings.
   *
   * Returns an empty array if the list fails.
   *
   * @example
   * ```typescript
   * const uris = await rig.listData("mutable://app/users");
   * for (const uri of uris) {
   *   const user = await rig.readData(uri);
   *   console.log(user);
   * }
   * ```
   */
  async listData(uri: string, options?: ListOptions): Promise<string[]> {
    const result = await this.list(uri, options);
    if (!result.success) return [];
    return result.data.map((item) => item.uri);
  }

  /**
   * Read all data under a URI prefix.
   *
   * Combines `list()` + `readDataMany()` into a single call.
   * Returns a Map of URI → data for all items under the prefix.
   *
   * @example
   * ```typescript
   * const users = await rig.readAll<UserProfile>("mutable://app/users");
   * for (const [uri, profile] of users) {
   *   console.log(`${uri}: ${profile.name}`);
   * }
   * ```
   */
  async readAll<T = unknown>(
    uri: string,
    options?: ListOptions,
  ): Promise<Map<string, T>> {
    const uris = await this.listData(uri, options);
    if (uris.length === 0) return new Map();
    return this.readDataMany<T>(uris);
  }

  /**
   * Read just the data from a URI, returning `null` if not found.
   *
   * @example
   * ```typescript
   * const profile = await rig.readData<UserProfile>("mutable://app/users/alice");
   * if (profile) {
   *   console.log(profile.name);
   * }
   * ```
   */
  async readData<T = unknown>(uri: string): Promise<T | null> {
    const result = await this.read<T>(uri);
    return result.success && result.record ? result.record.data : null;
  }

  /**
   * Batch read data values for multiple URIs.
   *
   * Returns a Map of URI → data for all URIs that had data.
   * Missing URIs are silently omitted from the map.
   *
   * @example
   * ```typescript
   * const data = await rig.readDataMany<UserProfile>([
   *   "mutable://app/users/alice",
   *   "mutable://app/users/bob",
   * ]);
   * console.log(data.get("mutable://app/users/alice")?.name);
   * ```
   */
  async readDataMany<T = unknown>(uris: string[]): Promise<Map<string, T>> {
    if (uris.length === 0) return new Map();
    const multi = await this.readMany<T>(uris);
    const map = new Map<string, T>();
    for (const item of multi.results) {
      if (item.success) {
        map.set(item.uri, item.record.data);
      }
    }
    return map;
  }

  /**
   * Read data from a URI, throwing if not found.
   *
   * @throws {Error} If the URI has no data or the read fails.
   *
   * @example
   * ```typescript
   * const config = await rig.readOrThrow<AppConfig>("mutable://app/config");
   * ```
   */
  async readOrThrow<T = unknown>(uri: string): Promise<T> {
    const result = await this.read<T>(uri);
    if (!result.success || !result.record) {
      throw new Error(
        `Rig.readOrThrow: no data at ${uri}${
          result.error ? ` (${result.error})` : ""
        }`,
      );
    }
    return result.record.data;
  }

  /**
   * Check if data exists at a URI.
   *
   * @example
   * ```typescript
   * if (await rig.exists("mutable://app/user/alice")) {
   *   // user exists
   * }
   * ```
   */
  async exists(uri: string): Promise<boolean> {
    const result = await this.read(uri);
    return result.success;
  }

  /**
   * Send a signed envelope with encrypted output values.
   *
   * Each output value is JSON-serialized, encrypted to the specified
   * recipient (defaults to self), and stored as an EncryptedPayload.
   * The envelope is then signed and content-addressed, just like `send()`.
   *
   * Use `readEncrypted()` to read the values back.
   *
   * @param data - Inputs and outputs for the envelope.
   * @param recipientEncPubkeyHex - Recipient's X25519 public key hex.
   *   Defaults to this identity's own encryption public key (encrypt to self).
   * @throws If no identity is set or identity lacks encryption keys.
   *
   * @example
   * ```typescript
   * // Encrypt to self
   * await rig.sendEncrypted({
   *   inputs: [],
   *   outputs: [["mutable://accounts/:key/secrets", { apiKey: "sk-..." }]],
   * });
   *
   * // Encrypt to another party
   * await rig.sendEncrypted({
   *   inputs: [],
   *   outputs: [["mutable://shared/msg", { text: "hello" }]],
   * }, recipientPubkey);
   * ```
   */
  async sendEncrypted<V = unknown>(
    data: { inputs: string[]; outputs: [uri: string, value: V][] },
    recipientEncPubkeyHex?: string,
  ): Promise<SendResult> {
    if (!this.identity) {
      throw new Error(
        "Rig.sendEncrypted: no identity set — cannot sign or encrypt.",
      );
    }
    if (!this.identity.canEncrypt) {
      throw new Error(
        "Rig.sendEncrypted: identity has no encryption keys.",
      );
    }

    const recipient = recipientEncPubkeyHex || this.identity.encryptionPubkey;

    // Encrypt each output value
    const encryptedOutputs: [string, unknown][] = await Promise.all(
      data.outputs.map(async ([uri, value]) => {
        const plaintext = new TextEncoder().encode(JSON.stringify(value));
        const encrypted = await this.identity!.encrypt(plaintext, recipient);
        return [uri, encrypted] as [string, unknown];
      }),
    );

    // Delegate to send() which handles hooks/events/observe
    return this.send({
      inputs: data.inputs,
      outputs: encryptedOutputs,
    });
  }

  /**
   * Count items under a URI prefix.
   *
   * Convenience for `listData(uri).length` — useful in dashboards,
   * pagination, and conditional logic without fetching all data.
   *
   * @example
   * ```typescript
   * const userCount = await rig.count("mutable://app/users");
   * console.log(`${userCount} users registered`);
   * ```
   */
  async count(uri: string, options?: ListOptions): Promise<number> {
    const uris = await this.listData(uri, options);
    return uris.length;
  }

  /**
   * Read and decrypt JSON data from a URI.
   *
   * Reads an EncryptedPayload from the backend, decrypts it with this
   * identity's encryption private key, and parses the JSON. Returns `null`
   * if the URI has no data.
   *
   * @throws If no identity is set or identity lacks decryption keys.
   * @throws If the stored data is not a valid EncryptedPayload.
   *
   * @example
   * ```typescript
   * const secrets = await rig.readEncrypted<{ apiKey: string }>(
   *   "mutable://accounts/:key/secrets",
   * );
   * if (secrets) {
   *   console.log(secrets.apiKey);
   * }
   * ```
   */
  async readEncrypted<T = unknown>(uri: string): Promise<T | null> {
    if (!this.identity) {
      throw new Error("Rig.readEncrypted: no identity set.");
    }
    if (!this.identity.canEncrypt) {
      throw new Error(
        "Rig.readEncrypted: identity has no encryption/decryption keys.",
      );
    }

    const result = await this.read(uri);
    if (!result.success || !result.record) return null;

    const payload = result.record.data;
    if (
      !payload || typeof payload !== "object" ||
      !("data" in (payload as Record<string, unknown>)) ||
      !("nonce" in (payload as Record<string, unknown>))
    ) {
      throw new Error(
        `Rig.readEncrypted: data at ${uri} is not an EncryptedPayload`,
      );
    }

    const decrypted = await this.identity.decrypt(
      payload as import("../b3nd-encrypt/mod.ts").EncryptedPayload,
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  }

  /**
   * Read and decrypt multiple URIs in parallel.
   *
   * Returns an array of results in the same order as the input URIs.
   * Missing entries are returned as `null`.
   *
   * @throws If no identity is set or identity lacks decryption keys.
   *
   * @example
   * ```typescript
   * const [a, b] = await rig.readEncryptedMany<{ key: string }>([
   *   "mutable://secrets/a",
   *   "mutable://secrets/b",
   * ]);
   * ```
   */
  async readEncryptedMany<T = unknown>(
    uris: readonly string[],
  ): Promise<(T | null)[]> {
    if (uris.length === 0) return [];
    if (!this.identity) {
      throw new Error("Rig.readEncryptedMany: no identity set.");
    }
    if (!this.identity.canEncrypt) {
      throw new Error(
        "Rig.readEncryptedMany: identity has no encryption/decryption keys.",
      );
    }

    return Promise.all(uris.map((uri) => this.readEncrypted<T>(uri)));
  }

  /** Delete data at a URI. */
  async delete(uri: string): Promise<DeleteResult> {
    // Pre-hooks — throw to reject
    const ctx: HookContext = { op: "delete", uri };
    const delCtx = await runPreHooks(this._hooks.delete.pre, ctx);
    const finalUri = delCtx.op === "delete" ? delCtx.uri : uri;

    // Execute
    let result: DeleteResult;
    try {
      result = await this._clients.delete.delete(finalUri);
    } catch (err) {
      this._events.emit("delete:error", {
        op: "delete",
        uri: finalUri,
        error: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
      throw err;
    }

    // Post-hooks — observe only
    await runPostHooks(this._hooks.delete.post, delCtx, result);

    // Events
    if (result.success) {
      this._events.emit("delete:success", {
        op: "delete",
        uri: finalUri,
        result,
        ts: Date.now(),
      });
    } else {
      this._events.emit("delete:error", {
        op: "delete",
        uri: finalUri,
        error: result.error,
        ts: Date.now(),
      });
    }

    return result;
  }

  /**
   * Batch delete multiple URIs in parallel.
   *
   * @example
   * ```typescript
   * const results = await rig.deleteMany([
   *   "mutable://app/users/alice",
   *   "mutable://app/users/bob",
   * ]);
   * ```
   */
  async deleteMany(uris: string[]): Promise<DeleteResult[]> {
    if (uris.length === 0) return [];
    return Promise.all(uris.map((uri) => this.delete(uri)));
  }

  /**
   * Delete all items under a URI prefix.
   *
   * Combines `listData()` + `deleteMany()` into a single call.
   *
   * @example
   * ```typescript
   * const results = await rig.deleteAll("mutable://app/sessions");
   * console.log(`Deleted ${results.length} sessions`);
   * ```
   */
  async deleteAll(
    uri: string,
    options?: ListOptions,
  ): Promise<DeleteResult[]> {
    const uris = await this.listData(uri, options);
    if (uris.length === 0) return [];
    return this.deleteMany(uris);
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
    const hooks: Record<string, { pre: number; post: number }> = {};
    for (
      const op of ["send", "receive", "read", "list", "delete"] as const
    ) {
      const h = this._hooks[op];
      if (h.pre.length > 0 || h.post.length > 0) {
        hooks[op] = { pre: h.pre.length, post: h.post.length };
      }
    }

    return {
      pubkey: this.identity?.pubkey ?? null,
      encryptionPubkey: this.identity?.encryptionPubkey ?? null,
      canSign: this.canSign,
      canEncrypt: this.canEncrypt,
      hasIdentity: this.identity !== null,
      behavior: {
        hooks,
        events: this._events.counts(),
        observers: this._observers.size,
      },
    };
  }

  // ── Infrastructure ──

  /** Health check. */
  health(): Promise<HealthStatus> {
    return this._clients.read.health();
  }

  /** Get the schema keys from the backend. */
  getSchema(): Promise<string[]> {
    return this._clients.read.getSchema();
  }

  /** Clean up all backend resources. */
  cleanup(): Promise<void> {
    return this._cleanupAllClients();
  }

  /**
   * Return any in-flight event handler promises and clear the queue.
   *
   * Call before cleanup when you need to ensure event handlers complete:
   *
   * @example
   * ```typescript
   * await Promise.allSettled(rig.drain()); // wait for audit events
   * await rig.cleanup();
   * ```
   *
   * @example Fire-and-forget (default — just ignore pending events)
   * ```typescript
   * await rig.cleanup(); // pending events are abandoned
   * ```
   */
  drain(): Promise<void>[] {
    return this._events.pending();
  }

  // ── Convenience factories ──

  /**
   * Quick connect to a single backend URL.
   *
   * @example
   * ```typescript
   * const rig = await Rig.connect("https://node.b3nd.net");
   * const data = await rig.read("mutable://open/key");
   * ```
   *
   * @example With identity
   * ```typescript
   * const id = await Identity.fromSeed("my-secret");
   * const rig = await Rig.connect("memory://", id);
   * await rig.send({ inputs: [], outputs: [["mutable://open/x", 1]] });
   * ```
   */
  static async connect(
    url: string,
    identity?: Identity,
  ): Promise<Rig> {
    return Rig.init({ use: url, identity });
  }

  /**
   * Check if this rig has a signing identity.
   *
   * Useful for UI logic that needs to know whether send
   * is available without catching errors.
   */
  get canSign(): boolean {
    return this.identity !== null && this.identity.canSign;
  }

  /**
   * Check if this rig has an encryption-capable identity.
   *
   * Useful for UI logic that needs to know whether encrypt/decrypt
   * operations are available.
   */
  get canEncrypt(): boolean {
    return this.identity !== null && this.identity.canEncrypt;
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
      const items = await this.readAll<T>(prefix, options?.listOptions);
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
   * Send multiple envelopes in sequence.
   *
   * Each entry becomes its own signed envelope with its own content hash.
   * Useful when a single logical action requires multiple state transitions
   * across different protocol domains.
   *
   * @example
   * ```typescript
   * const results = await rig.sendMany([
   *   { inputs: [], outputs: [["mutable://app/counter", { value: 1 }]] },
   *   { inputs: [], outputs: [["mutable://app/log/1", { event: "init" }]] },
   * ]);
   * ```
   */
  async sendMany<V = unknown>(
    envelopes: { inputs: string[]; outputs: [uri: string, value: V][] }[],
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

  // ── Private ──

  /** Cleanup all unique clients (deduplicates if same client used for multiple ops). */
  private async _cleanupAllClients(): Promise<void> {
    const seen = new Set<NodeProtocolInterface>();
    for (const client of Object.values(this._clients)) {
      if (!seen.has(client)) {
        seen.add(client);
        await client.cleanup();
      }
    }
  }
}

// ── Init helpers ──

/** Resolve the default client from `use` or `client` config. */
async function resolveDefaultClient(
  config: RigConfig,
): Promise<NodeProtocolInterface> {
  if (config.client) {
    return config.client;
  }

  if (config.use) {
    const urls = Array.isArray(config.use) ? config.use : [config.use];
    if (urls.length === 0) {
      throw new Error("Rig.init: `use` must contain at least one URL");
    }

    const factoryOpts = {
      schema: config.schema,
      executors: config.executors,
    };

    const clients = await Promise.all(
      urls.map((url) => createClientFromUrl(url, factoryOpts)),
    );

    if (clients.length === 1) {
      if (config.schema) {
        return createValidatedClient({
          write: clients[0],
          read: clients[0],
          validate: msgSchema(config.schema),
        });
      }
      return clients[0];
    }

    // Multi-backend
    const write = parallelBroadcast(clients);
    const read = firstMatchSequence(clients);

    if (config.schema) {
      return createValidatedClient({
        write,
        read,
        validate: msgSchema(config.schema),
      });
    }

    return {
      receive: (msg) => write.receive(msg),
      read: (uri) => read.read(uri),
      readMulti: (uris) => read.readMulti(uris),
      list: (uri, opts) => read.list(uri, opts),
      delete: (uri) => write.delete(uri),
      health: () => read.health(),
      getSchema: () => read.getSchema(),
      cleanup: async () => {
        await write.cleanup();
        await read.cleanup();
      },
    };
  }

  throw new Error("Rig.init: either `use` or `client` is required");
}

/** Resolve per-operation clients, falling back to the default. */
async function resolveOpClients(
  config: RigConfig,
  defaultClient: NodeProtocolInterface,
): Promise<OpClients> {
  const opClients: OpClients = {
    send: defaultClient,
    receive: defaultClient,
    read: defaultClient,
    list: defaultClient,
    delete: defaultClient,
  };

  // Only called for object-form config (array form uses createDispatchClients)
  if (!config.clients || Array.isArray(config.clients)) return opClients;
  const clientsConfig = config.clients;

  const factoryOpts = {
    schema: config.schema,
    executors: config.executors,
  };

  // Write-like ops use parallelBroadcast, read-like use firstMatchSequence
  const writeOps: (keyof OpClients)[] = ["send", "receive", "delete"];
  const readOps: (keyof OpClients)[] = ["read", "list"];

  for (const op of [...writeOps, ...readOps]) {
    const entry = clientsConfig[op as keyof typeof clientsConfig] as
      | string[]
      | NodeProtocolInterface
      | undefined;
    if (!entry) continue;

    if (Array.isArray(entry)) {
      // URL strings — resolve and compose
      const clients = await Promise.all(
        entry.map((url: string) => createClientFromUrl(url, factoryOpts)),
      );
      if (clients.length === 1) {
        opClients[op] = clients[0];
      } else if (writeOps.includes(op)) {
        opClients[op] = parallelBroadcast(clients);
      } else {
        opClients[op] = firstMatchSequence(clients);
      }
    } else {
      // Pre-built client
      opClients[op] = entry as NodeProtocolInterface;
    }
  }

  return opClients;
}

/**
 * Build dispatch clients from a flat array.
 *
 * Each operation is backed by a synthetic client that iterates all
 * clients in order, checking `accepts(operation, uri)`.
 *
 * - Writes (receive, delete): broadcast to ALL accepting clients.
 *   If none accept, returns an error.
 * - Reads (read, list): first-match — tries each accepting client
 *   in order, returns the first success.
 * - Send delegates to receive (the envelope is a receive to the network).
 *
 * Clients without `accepts()` accept everything (backwards compat).
 */
function createDispatchClients(
  clients: NodeProtocolInterface[],
): OpClients {
  if (clients.length === 0) {
    throw new Error("Rig.init: `clients` array must not be empty");
  }

  const dispatch: NodeProtocolInterface = {
    async receive(msg) {
      const [uri] = msg;
      const accepting = clients.filter((c) => clientAccepts(c, "receive", uri));
      if (accepting.length === 0) {
        return {
          accepted: false,
          error: `No client accepts receive for ${uri}`,
        };
      }
      // Broadcast — all must accept
      const results = await Promise.all(accepting.map((c) => c.receive(msg)));
      const failed = results.find((r) => !r.accepted);
      if (failed) return failed;
      return results[0];
    },

    async read<T = unknown>(uri: string): Promise<ReadResult<T>> {
      // First match — try accepting clients in order
      for (const c of clients) {
        if (!clientAccepts(c, "read", uri)) continue;
        const result = await c.read<T>(uri);
        if (result.success) return result;
      }
      return { success: false, error: `No client has data for ${uri}` };
    },

    async readMulti<T = unknown>(
      uris: string[],
    ): Promise<ReadMultiResult<T>> {
      // Delegate each URI to the first accepting client
      const items = await Promise.all(uris.map(async (uri) => {
        for (const c of clients) {
          if (!clientAccepts(c, "read", uri)) continue;
          const r = await c.read<T>(uri);
          if (r.success && r.record) {
            return {
              uri,
              success: true as const,
              record: r.record,
            };
          }
        }
        return {
          uri,
          success: false as const,
          error: `No client has data for ${uri}`,
        };
      }));
      const succeeded = items.filter((r) => r.success).length;
      return {
        success: succeeded > 0,
        results: items as ReadMultiResult<T>["results"],
        summary: {
          total: uris.length,
          succeeded,
          failed: uris.length - succeeded,
        },
      };
    },

    async list(uri, options) {
      // First non-empty — try accepting clients in order
      for (const c of clients) {
        if (!clientAccepts(c, "list", uri)) continue;
        const result = await c.list(uri, options);
        if (result.success && result.data.length > 0) return result;
      }
      // No data found — return empty success
      return {
        success: true,
        data: [],
        pagination: { page: 1, limit: options?.limit ?? 50, total: 0 },
      } as ListResult;
    },

    async delete(uri) {
      const accepting = clients.filter((c) => clientAccepts(c, "delete", uri));
      if (accepting.length === 0) {
        return { success: false, error: `No client accepts delete for ${uri}` };
      }
      const results = await Promise.all(accepting.map((c) => c.delete(uri)));
      const failed = results.find((r) => !r.success);
      if (failed) return failed;
      return results[0];
    },

    async health() {
      // Aggregate health from all clients
      const results = await Promise.all(clients.map((c) => c.health()));
      const unhealthy = results.find((r) => r.status === "unhealthy");
      if (unhealthy) return unhealthy;
      const degraded = results.find((r) => r.status === "degraded");
      if (degraded) return degraded;
      return results[0] ?? { status: "healthy" as const };
    },

    async getSchema() {
      // Union of all client schemas
      const all = new Set<string>();
      for (const c of clients) {
        const schemas = await c.getSchema();
        for (const s of schemas) all.add(s);
      }
      return [...all];
    },

    async cleanup() {
      await Promise.all(clients.map((c) => c.cleanup()));
    },
  };

  // All ops go through the same dispatch — filtering is per-call
  return {
    send: dispatch,
    receive: dispatch,
    read: dispatch,
    list: dispatch,
    delete: dispatch,
  };
}

// ── Compile-time assertion ──
// Rig structurally satisfies NodeProtocolInterface, so it can be
// passed directly to any function that expects a client.
// deno-lint-ignore no-unused-vars
const _rigIsClient: NodeProtocolInterface = null! as Rig;

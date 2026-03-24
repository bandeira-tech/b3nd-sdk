/**
 * @module
 * Rig — the universal harness for b3nd.
 *
 * Single object that wires up backends, identity, and serving.
 * Two core actions: send (outward to the network) and receive
 * (inward from external sources). Everything else is observation.
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
  WatchOptions,
} from "./types.ts";

/**
 * Rig — the single import for working with b3nd.
 *
 * Two core actions model network communication:
 * - `send({ inputs, outputs })` — send a structured envelope to the network
 * - `receive([uri, data])` — receive an external message into the rig
 *
 * Everything else is observation: read, list, watch, exists.
 *
 * @example
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
 */
export class Rig {
  /** The composed NodeProtocolInterface client. */
  readonly client: NodeProtocolInterface;

  /** The current identity. Swappable at any time. */
  identity: Identity | null;

  private constructor(
    client: NodeProtocolInterface,
    identity: Identity | null,
  ) {
    this.client = client;
    this.identity = identity;
  }

  /**
   * Initialize a Rig from config.
   *
   * - `use: "https://..."` → single HttpClient
   * - `use: ["postgresql://...", "https://..."]` → parallelBroadcast writes, firstMatchSequence reads
   * - `client: myClient` → use a pre-built client directly
   */
  static async init(config: RigConfig): Promise<Rig> {
    let client: NodeProtocolInterface;

    if (config.client) {
      // Pre-built client — use directly
      client = config.client;
    } else if (config.use) {
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
        // Single backend — if we have a schema, wrap with validation
        if (config.schema) {
          client = createValidatedClient({
            write: clients[0],
            read: clients[0],
            validate: msgSchema(config.schema),
          });
        } else {
          client = clients[0];
        }
      } else {
        // Multi-backend — parallel writes, sequential read fallback
        const write = parallelBroadcast(clients);
        const read = firstMatchSequence(clients);

        if (config.schema) {
          client = createValidatedClient({
            write,
            read,
            validate: msgSchema(config.schema),
          });
        } else {
          // No schema — compose without validation
          client = {
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
      }
    } else {
      throw new Error("Rig.init: either `use` or `client` is required");
    }

    return new Rig(client, config.identity ?? null);
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

    const payload = { inputs: data.inputs, outputs: data.outputs };
    const auth = [await this.identity.sign(payload)];
    const messageData: MessageData<V> = { auth, payload };

    return send(messageData, this.client);
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
  receive<D = unknown>(msg: Message<D>): Promise<ReceiveResult> {
    return this.client.receive(msg);
  }

  // ── Observation ──

  /** Read data from a URI. */
  read<T = unknown>(uri: string): Promise<ReadResult<T>> {
    return this.client.read<T>(uri);
  }

  /** Batch read multiple URIs. */
  readMany<T = unknown>(uris: string[]): Promise<ReadMultiResult<T>> {
    return this.client.readMulti<T>(uris);
  }

  /** List items at a URI path. */
  list(uri: string, options?: ListOptions): Promise<ListResult> {
    return this.client.list(uri, options);
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
    const result = await this.client.list(uri, options);
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
    const result = await this.client.read<T>(uri);
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
    const multi = await this.client.readMulti<T>(uris);
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
    const result = await this.client.read<T>(uri);
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
    const result = await this.client.read(uri);
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

    // Build and send the signed envelope with encrypted outputs
    const payload = { inputs: data.inputs, outputs: encryptedOutputs };
    const auth = [await this.identity.sign(payload)];
    const messageData: MessageData = { auth, payload };

    return send(messageData, this.client);
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

    const result = await this.client.read(uri);
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
  delete(uri: string): Promise<DeleteResult> {
    return this.client.delete(uri);
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
    return Promise.all(uris.map((uri) => this.client.delete(uri)));
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
    return {
      pubkey: this.identity?.pubkey ?? null,
      encryptionPubkey: this.identity?.encryptionPubkey ?? null,
      canSign: this.canSign,
      canEncrypt: this.canEncrypt,
      hasIdentity: this.identity !== null,
    };
  }

  // ── Infrastructure ──

  /** Health check. */
  health(): Promise<HealthStatus> {
    return this.client.health();
  }

  /** Get the schema keys from the backend. */
  getSchema(): Promise<string[]> {
    return this.client.getSchema();
  }

  /** Clean up all backend resources. */
  cleanup(): Promise<void> {
    return this.client.cleanup();
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

}

/**
 * @module
 * Rig — the universal harness for b3nd.
 *
 * Single object that wires up backends, identity, signing, and serving.
 * Convention over configuration: strings become clients, multi-backend
 * gets parallel-broadcast writes and first-match reads automatically.
 */

import type {
  DeleteResult,
  HealthStatus,
  ListOptions,
  ListResult,
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
  ServeOptions,
  WatchOptions,
} from "./types.ts";

/**
 * Rig — the single import for working with b3nd.
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

  // ── Write operations ──

  /**
   * Send a MessageData envelope with auto-signing.
   *
   * Builds the auth array from the current identity, hashes the envelope,
   * and sends it to the backend.
   *
   * @throws If no identity is set.
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
   * Raw write — no MessageData wrapping, no signing.
   * Calls client.receive([uri, data]) directly.
   */
  async write<D = unknown>(uri: string, data: D): Promise<ReceiveResult> {
    return this.client.receive([uri, data]);
  }

  /**
   * Batch write multiple URI/data pairs in parallel.
   *
   * Parallels `readMany()` for writes. Each entry is written independently
   * via `client.receive()`, so partial failures are possible — check
   * each result's `accepted` field.
   *
   * @example
   * ```typescript
   * const results = await rig.writeMany([
   *   ["mutable://app/users/alice", { name: "Alice" }],
   *   ["mutable://app/users/bob", { name: "Bob" }],
   * ]);
   * console.log(results.every(r => r.success)); // true
   * ```
   */
  async writeMany(
    entries: readonly [uri: string, data: unknown][],
  ): Promise<ReceiveResult[]> {
    if (entries.length === 0) return [];
    return Promise.all(
      entries.map(([uri, data]) => this.client.receive([uri, data])),
    );
  }

  /**
   * Write with signing — wraps data in an AuthenticatedMessage.
   *
   * @throws If no identity is set.
   */
  async writeSigned<D = unknown>(uri: string, data: D): Promise<ReceiveResult> {
    if (!this.identity) {
      throw new Error("Rig.writeSigned: no identity set — cannot sign.");
    }

    const msg = await this.identity.signMessage(data);
    return this.client.receive([uri, msg]);
  }

  /**
   * Batch write with signing — wraps each entry in an AuthenticatedMessage.
   *
   * Parallels `writeMany()` but signs each write with the current identity.
   * Each entry is written independently, so partial failures are possible.
   *
   * @throws If no identity is set.
   *
   * @example
   * ```typescript
   * const results = await rig.writeSignedMany([
   *   ["mutable://app/settings/theme", { dark: true }],
   *   ["mutable://app/settings/lang", { code: "en" }],
   * ]);
   * ```
   */
  async writeSignedMany(
    entries: readonly [uri: string, data: unknown][],
  ): Promise<ReceiveResult[]> {
    if (!this.identity) {
      throw new Error("Rig.writeSignedMany: no identity set — cannot sign.");
    }
    if (entries.length === 0) return [];
    return Promise.all(
      entries.map(async ([uri, data]) => {
        const msg = await this.identity!.signMessage(data);
        return this.client.receive([uri, msg]);
      }),
    );
  }

  // ── Read operations ──

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
   * The most common list pattern in apps — skips the full ListResult/ListItem
   * when you just need the URIs. Returns an empty array if the list fails.
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
   * Combines `list()` + `readDataMany()` into a single call — the most
   * common pattern for loading collections. Returns a Map of URI → data
   * for all items that exist under the prefix.
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

  // ── Convenience operations ──

  /**
   * Read-modify-write in one call.
   *
   * Reads the current value at `uri`, passes it to `updater`, and writes
   * the result back. If the URI doesn't exist, `updater` receives `null`.
   * Returns the new value.
   *
   * This is the most common app pattern — incrementing counters, toggling
   * flags, merging partial updates into objects, etc.
   *
   * @example
   * ```typescript
   * // Increment a counter
   * const count = await rig.update<number>("mutable://app/counter", (n) => (n ?? 0) + 1);
   *
   * // Merge partial updates
   * await rig.update<UserProfile>("mutable://app/users/alice", (profile) => ({
   *   ...profile,
   *   lastLogin: Date.now(),
   * }));
   * ```
   */
  async update<T = unknown>(
    uri: string,
    updater: (current: T | null) => T | Promise<T>,
  ): Promise<T> {
    const current = await this.readData<T>(uri);
    const next = await updater(current);
    await this.write(uri, next);
    return next;
  }

  /**
   * Read-modify-write with signing.
   *
   * Like `update()`, but wraps the write in an AuthenticatedMessage.
   * Use for URIs with auth-based access control where the update
   * must prove who made the change.
   *
   * @throws If no identity is set.
   *
   * @example
   * ```typescript
   * // Update a user profile with signing
   * await rig.updateSigned<UserProfile>(
   *   `mutable://accounts/${rig.identity!.pubkey}/profile`,
   *   (profile) => ({ ...profile, lastLogin: Date.now() }),
   * );
   * ```
   */
  async updateSigned<T = unknown>(
    uri: string,
    updater: (current: T | null) => T | Promise<T>,
  ): Promise<T> {
    if (!this.identity) {
      throw new Error("Rig.updateSigned: no identity set — cannot sign.");
    }
    const current = await this.readData<T>(uri);
    const next = await updater(current);
    await this.writeSigned(uri, next);
    return next;
  }

  /**
   * Read just the data from a URI, returning `null` if not found.
   *
   * The most common read pattern in apps — skips the full ReadResult
   * when you just need the value.
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
   * Parallels `readMany()` but returns only the data values,
   * not full ReadResult objects.
   *
   * @example
   * ```typescript
   * const data = await rig.readDataMany<UserProfile>([
   *   "mutable://app/users/alice",
   *   "mutable://app/users/bob",
   *   "mutable://app/users/unknown",
   * ]);
   * // data.size === 2 (unknown is omitted)
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
   * Use when missing data is an error condition rather than an expected case.
   *
   * @throws {Error} If the URI has no data or the read fails.
   *
   * @example
   * ```typescript
   * const config = await rig.readOrThrow<AppConfig>("mutable://app/config");
   * // config is guaranteed to be AppConfig — no null check needed
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
   * Convenience wrapper around `read()` that returns a boolean.
   * Useful for conditional logic without needing to handle the full ReadResult.
   *
   * @example
   * ```typescript
   * if (await rig.exists("mutable://app/user/alice")) {
   *   // user exists, read their data
   * }
   * ```
   */
  async exists(uri: string): Promise<boolean> {
    const result = await this.client.read(uri);
    return result.success;
  }

  /**
   * Write data, throwing if the write is not accepted.
   *
   * Use when a failed write is an error condition rather than an expected case.
   * Parallels `readOrThrow()` for writes.
   *
   * @throws {Error} If the write is not accepted by the backend.
   *
   * @example
   * ```typescript
   * // Guaranteed write — throws on schema rejection or backend failure
   * await rig.writeOrThrow("mutable://app/config", { version: 2 });
   * ```
   */
  async writeOrThrow<D = unknown>(
    uri: string,
    data: D,
  ): Promise<ReceiveResult> {
    const result = await this.client.receive([uri, data]);
    if (!result.accepted) {
      throw new Error(
        `Rig.writeOrThrow: write rejected at ${uri}${
          result.error ? ` (${result.error})` : ""
        }`,
      );
    }
    return result;
  }

  /** Delete data at a URI. */
  delete(uri: string): Promise<DeleteResult> {
    return this.client.delete(uri);
  }

  /**
   * Batch delete multiple URIs in parallel.
   *
   * Parallels `writeMany()` for deletes. Each URI is deleted independently,
   * so partial failures are possible — check each result's `success` field.
   *
   * @example
   * ```typescript
   * const results = await rig.deleteMany([
   *   "mutable://app/users/alice",
   *   "mutable://app/users/bob",
   * ]);
   * console.log(results.every(r => r.success)); // true
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
   * Returns the individual delete results. Useful for cleanup,
   * clearing collections, or resetting state.
   *
   * @example
   * ```typescript
   * // Clear all user sessions
   * const results = await rig.deleteAll("mutable://app/sessions");
   * console.log(`Deleted ${results.length} sessions`);
   *
   * // Clear and verify
   * await rig.deleteAll("mutable://app/temp");
   * const remaining = await rig.listData("mutable://app/temp");
   * console.log(remaining.length); // 0
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

  // ── Encrypted operations ──

  /**
   * Write encrypted JSON data to a URI.
   *
   * Serializes `data` to JSON, encrypts it for the given recipient
   * (or self if no recipient specified), and writes the EncryptedPayload
   * to the backend. Requires an identity with encryption capability.
   *
   * @param uri - The URI to write to.
   * @param data - The JSON-serializable value to encrypt and store.
   * @param recipientEncPubkeyHex - Recipient's X25519 public key hex.
   *   Defaults to this identity's own encryption pubkey (encrypt-to-self).
   *
   * @throws If no identity is set or identity lacks encryption keys.
   *
   * @example
   * ```typescript
   * // Encrypt to self
   * await rig.writeEncrypted("mutable://accounts/:key/secrets", {
   *   apiKey: "sk-...",
   * });
   *
   * // Encrypt to another user
   * await rig.writeEncrypted(
   *   "mutable://shared/alice-to-bob",
   *   { message: "hello" },
   *   bobEncPubkeyHex,
   * );
   * ```
   */
  async writeEncrypted<T = unknown>(
    uri: string,
    data: T,
    recipientEncPubkeyHex?: string,
  ): Promise<ReceiveResult> {
    if (!this.identity) {
      throw new Error("Rig.writeEncrypted: no identity set.");
    }
    if (!this.identity.canEncrypt) {
      throw new Error(
        "Rig.writeEncrypted: identity has no encryption keys.",
      );
    }

    const recipient = recipientEncPubkeyHex ?? this.identity.encryptionPubkey;
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const encrypted = await this.identity.encrypt(plaintext, recipient);
    return this.client.receive([uri, encrypted]);
  }

  /**
   * Encrypt and write multiple entries in parallel.
   *
   * Each entry is encrypted individually with the recipient's public key
   * (defaults to this identity's own encryption key for self-encryption).
   *
   * @throws If no identity is set or identity lacks encryption keys.
   *
   * @example
   * ```typescript
   * const results = await rig.writeEncryptedMany([
   *   ["mutable://secrets/a", { key: "val-a" }],
   *   ["mutable://secrets/b", { key: "val-b" }],
   * ]);
   * ```
   */
  async writeEncryptedMany<T = unknown>(
    entries: readonly [uri: string, data: T][],
    recipientEncPubkeyHex?: string,
  ): Promise<ReceiveResult[]> {
    if (entries.length === 0) return [];
    if (!this.identity) {
      throw new Error("Rig.writeEncryptedMany: no identity set.");
    }
    if (!this.identity.canEncrypt) {
      throw new Error(
        "Rig.writeEncryptedMany: identity has no encryption keys.",
      );
    }

    const recipient = recipientEncPubkeyHex ?? this.identity.encryptionPubkey;
    return Promise.all(
      entries.map(async ([uri, data]) => {
        const plaintext = new TextEncoder().encode(JSON.stringify(data));
        const encrypted = await this.identity!.encrypt(plaintext, recipient);
        return this.client.receive([uri, encrypted]);
      }),
    );
  }

  /**
   * Read and decrypt multiple URIs in parallel.
   *
   * Each URI is read and decrypted individually. Returns an array of
   * results in the same order as the input URIs. Missing entries are
   * returned as `null`.
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

  // ── Inspection ──

  /**
   * Get a snapshot of this rig's current state.
   *
   * Useful for debugging, logging, and UI display. Returns
   * identity info, backend capabilities, and connection status
   * without making any network calls.
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
   * Shorter alternative to `Rig.init({ use: url })` for the common case
   * of connecting to one node without identity or schema.
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
   * Useful for UI logic that needs to know whether send/writeSigned
   * are available without catching errors.
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

  // ── Serve ──

  /**
   * Start an HTTP server exposing this rig's client via the b3nd API.
   *
   * Dynamically imports Hono and the b3nd HTTP server module.
   * Only available in Deno.
   */
  async serve(options: ServeOptions): Promise<void> {
    const { Hono } = await import("npm:hono");
    const { cors } = await import("npm:hono/cors");
    const { httpServer } = await import("../b3nd-servers/http.ts");

    const app = new Hono();
    if (options.cors) {
      app.use("*", cors({ origin: options.cors }));
    }

    const frontend = httpServer(app as any, {
      healthMeta: options.healthMeta,
    });

    frontend.configure({ client: this.client });
    frontend.listen(options.port);
  }
}

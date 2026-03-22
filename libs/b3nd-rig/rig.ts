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
import type { RigConfig, ServeOptions } from "./types.ts";

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

  // ── Other operations ──

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

  /** Delete data at a URI. */
  delete(uri: string): Promise<DeleteResult> {
    return this.client.delete(uri);
  }

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

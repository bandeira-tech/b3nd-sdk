/**
 * @module
 * shared-infra SDK — the app-facing API for the shared-infra protocol.
 *
 * Apps never import the schema. They import `appClient()` (or
 * `createAppSession()` for signed operations) and call high-level helpers
 * like `putContent`, `setLatest`, `saveUserDoc`, `appendLog`, `listIndex`.
 *
 * The SDK hides:
 *   - URI construction (paths, trailing slashes, hash URIs)
 *   - Envelope assembly (send(), inputs/outputs)
 *   - Content addressing (sha256 + generateHashUri)
 *   - Signing for /users/{pubkey}/* paths
 *
 * The goal is that app code reads like it's talking to a namespaced KV
 * store, even though under the hood it's exercising the full b3nd pipeline
 * (validation → broadcast → replication → read).
 */

import {
  HttpClient,
  type NodeProtocolInterface,
  send,
} from "../../../src/mod.ts";
import {
  computeSha256,
  generateHashUri,
} from "../../../libs/b3nd-hash/mod.ts";
import * as encrypt from "../../../libs/b3nd-encrypt/mod.ts";

// ── URI builders ─────────────────────────────────────────────────────

export const uri = {
  registry: (appId: string) => `mutable://registry/apps/${appId}`,
  config: (appId: string) => `mutable://app/${appId}/config`,
  userDoc: (appId: string, pubkey: string, path: string) =>
    `mutable://app/${appId}/users/${pubkey}/${stripSlashes(path)}`,
  index: (appId: string, key: string) =>
    `mutable://app/${appId}/index/${stripSlashes(key)}`,
  shared: (appId: string, path: string) =>
    `mutable://app/${appId}/shared/${stripSlashes(path)}`,
  latest: (appId: string, name: string) =>
    `link://app/${appId}/latest/${stripSlashes(name)}`,
  log: (appId: string, path: string) =>
    `log://app/${appId}/events/${stripSlashes(path)}`,
  hash: (hex: string) => generateHashUri(hex),
};

function stripSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, "");
}

// ── Session: unauthenticated client ─────────────────────────────────

export interface AppClientConfig {
  /** Node URL, e.g. `http://localhost:9942` */
  nodeUrl?: string;
  /** Or an already-built client (for tests using MessageDataClient). */
  client?: NodeProtocolInterface;
  /** Application id, must match the registry record. */
  appId: string;
}

/**
 * An app handle without an identity — useful for reads, public writes,
 * and CI/bootstrap scripts. Apps that need user-owned paths should call
 * `withIdentity()` or use `createUserSession()`.
 */
export class AppClient {
  readonly appId: string;
  readonly client: NodeProtocolInterface;

  constructor(config: AppClientConfig) {
    if (!config.client && !config.nodeUrl) {
      throw new Error("AppClient needs either `client` or `nodeUrl`");
    }
    this.appId = config.appId;
    this.client = config.client ??
      new HttpClient({ url: config.nodeUrl! });
  }

  /** Register the app with the shared-infra registry (dev mode only). */
  async register(meta: Record<string, unknown> = {}) {
    return send({
      inputs: [],
      outputs: [[
        uri.registry(this.appId),
        {},
        { appId: this.appId, createdAt: Date.now(), ...meta },
      ]],
    }, this.client);
  }

  /** Write a public mutable doc at `/config`. */
  async putConfig(data: Record<string, unknown>) {
    return send({
      inputs: [],
      outputs: [[uri.config(this.appId), {}, data]],
    }, this.client);
  }

  async getConfig<T = Record<string, unknown>>(): Promise<T | undefined> {
    const [res] = await this.client.read<T>(uri.config(this.appId));
    return res.record?.data;
  }

  /** Store immutable content and return its hash URI. */
  async putContent(data: unknown): Promise<string> {
    const hash = await computeSha256(data);
    const hashUri = generateHashUri(hash);
    const result = await send({
      inputs: [],
      outputs: [[hashUri, {}, data]],
    }, this.client);
    if (!result.accepted) {
      // Already stored (write-once) is fine — rethrow other errors.
      if (!/already exists/i.test(result.error ?? "")) {
        throw new Error(
          `putContent failed for ${hashUri}: ${result.error ?? "unknown"}`,
        );
      }
    }
    return hashUri;
  }

  async getContent<T = unknown>(hashUri: string): Promise<T | undefined> {
    const [res] = await this.client.read<T>(hashUri);
    return res.record?.data;
  }

  /**
   * Publish content and point a named latest-link at it atomically.
   * The envelope contains both outputs, so replication either stores both
   * or none.
   */
  async publish(
    name: string,
    data: unknown,
  ): Promise<{ hashUri: string; linkUri: string }> {
    const hash = await computeSha256(data);
    const hashUri = generateHashUri(hash);
    const linkUri = uri.latest(this.appId, name);
    await send({
      inputs: [],
      outputs: [
        [hashUri, {}, data],
        [linkUri, {}, hashUri],
      ],
    }, this.client);
    return { hashUri, linkUri };
  }

  /** Update an existing latest pointer to newly-published content. */
  async setLatest(name: string, data: unknown): Promise<string> {
    return (await this.publish(name, data)).linkUri;
  }

  /** Follow a latest-link and dereference the content. */
  async getLatest<T = unknown>(name: string): Promise<T | undefined> {
    const [link] = await this.client.read<string>(
      uri.latest(this.appId, name),
    );
    const target = link.record?.data;
    if (!target) return undefined;
    const [content] = await this.client.read<T>(target);
    return content.record?.data;
  }

  /** Write to a shared mutable key (no per-user signing). */
  async putShared(path: string, data: unknown) {
    return send({
      inputs: [],
      outputs: [[uri.shared(this.appId, path), {}, data]],
    }, this.client);
  }

  async getShared<T = unknown>(path: string): Promise<T | undefined> {
    const [res] = await this.client.read<T>(uri.shared(this.appId, path));
    return res.record?.data;
  }

  /** Write to the app index — arbitrary key/value under `/index/...`. */
  async putIndex(key: string, data: unknown) {
    return send({
      inputs: [],
      outputs: [[uri.index(this.appId, key), {}, data]],
    }, this.client);
  }

  async listIndex(prefix = ""): Promise<
    { uri: string; data: unknown }[]
  > {
    const base = `mutable://app/${this.appId}/index/${stripSlashes(prefix)}`;
    const trailing = base.endsWith("/") ? base : base + "/";
    const rows = await this.client.read(trailing);
    return rows
      .filter((r): r is typeof r & { uri: string } => !!r.uri)
      .map((r) => ({ uri: r.uri, data: r.record?.data }));
  }

  /** Append an event to the app log (write-once path). */
  async appendLog(path: string, data: unknown) {
    return send({
      inputs: [],
      outputs: [[uri.log(this.appId, path), {}, data]],
    }, this.client);
  }

  async listLog(prefix = ""): Promise<
    { uri: string; data: unknown }[]
  > {
    const base = `log://app/${this.appId}/events/${stripSlashes(prefix)}`;
    const trailing = base.endsWith("/") ? base : base + "/";
    const rows = await this.client.read(trailing);
    return rows
      .filter((r): r is typeof r & { uri: string } => !!r.uri)
      .map((r) => ({ uri: r.uri, data: r.record?.data }));
  }

  /** Attach an identity to get a user session. */
  withIdentity(identity: UserIdentity): UserSession {
    return new UserSession(this, identity);
  }
}

// ── Identity / signed user session ──────────────────────────────────

export interface UserIdentity {
  pubkeyHex: string;
  privateKeyHex: string;
}

/** Generate a fresh user identity (Ed25519). */
export async function generateIdentity(): Promise<UserIdentity> {
  const keys = await encrypt.generateSigningKeyPair();
  return {
    pubkeyHex: keys.publicKeyHex,
    privateKeyHex: keys.privateKeyHex,
  };
}

/**
 * Session bound to a user's identity — unlocks writes to
 * `mutable://app/{appId}/users/{pubkey}/…`.
 */
export class UserSession {
  constructor(
    readonly app: AppClient,
    readonly identity: UserIdentity,
  ) {}

  get pubkey(): string {
    return this.identity.pubkeyHex;
  }

  /** Sign+write user-scoped document. */
  async saveDoc(path: string, data: Record<string, unknown>) {
    const envelope = await encrypt.createAuthenticatedMessageWithHex(
      data,
      this.identity.pubkeyHex,
      this.identity.privateKeyHex,
    );
    return send({
      inputs: [],
      outputs: [[
        uri.userDoc(this.app.appId, this.identity.pubkeyHex, path),
        {},
        envelope,
      ]],
    }, this.app.client);
  }

  async readDoc<T = unknown>(
    path: string,
  ): Promise<T | undefined> {
    const [res] = await this.app.client.read<
      { payload: T } | undefined
    >(uri.userDoc(this.app.appId, this.identity.pubkeyHex, path));
    return res.record?.data?.payload;
  }

  async listMyDocs(): Promise<{ uri: string; data: unknown }[]> {
    const base =
      `mutable://app/${this.app.appId}/users/${this.identity.pubkeyHex}/`;
    const rows = await this.app.client.read(base);
    return rows
      .filter((r): r is typeof r & { uri: string } => !!r.uri)
      .map((r) => ({ uri: r.uri, data: r.record?.data }));
  }
}

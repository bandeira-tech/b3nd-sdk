/**
 * @module
 * AuthenticatedRig — identity-driven wrapper around a Rig.
 *
 * Created via `identity.rig(rig)`. The identity is the security principal;
 * the rig is pure orchestration. Signing and encryption never touch the rig.
 *
 * @example
 * ```typescript
 * const rig = await Rig.connect("https://node.b3nd.net");
 * const alice = await Identity.fromSeed("alice-secret");
 *
 * const session = alice.rig(rig);
 * await session.send({ inputs: [], outputs: [["mutable://app/x", data]] });
 * ```
 */

import type { EncryptedPayload } from "../b3nd-encrypt/mod.ts";
import type { SendResult } from "../b3nd-msg/data/send.ts";
import type { Identity } from "./identity.ts";
import type { Rig } from "./rig.ts";

/**
 * An authenticated view of a rig — identity drives, rig delivers.
 *
 * All signing and encryption happens here, never in the rig.
 * The rig only sees pre-signed MessageData.
 */
export class AuthenticatedRig {
  /** The identity backing this session. */
  readonly identity: Identity;
  /** The underlying rig for dispatch. */
  readonly rig: Rig;

  constructor(identity: Identity, rig: Rig) {
    this.identity = identity;
    this.rig = rig;
  }

  // ── Authenticated writes ──

  /**
   * Sign an envelope and send it through the rig.
   *
   * Signs `{ inputs, outputs }` with this identity, wraps it as
   * MessageData with auth, then dispatches via `rig.send()`.
   *
   * @example
   * ```typescript
   * await session.send({
   *   inputs: [],
   *   outputs: [["mutable://accounts/" + id.pubkey + "/app/x", data]],
   * });
   * ```
   */
  async send<V = unknown>(
    data: { inputs: string[]; outputs: [uri: string, value: V][] },
  ): Promise<SendResult> {
    const payload = { inputs: data.inputs, outputs: data.outputs };
    const auth = [await this.identity.sign(payload)];
    return this.rig.send({ auth, payload });
  }

  /**
   * Encrypt outputs, sign, and send.
   *
   * Each output value is JSON-serialized, encrypted to the recipient's
   * X25519 public key, then the envelope is signed and dispatched.
   * Omit `recipientEncPubkeyHex` to self-encrypt.
   *
   * @example
   * ```typescript
   * // Self-encrypt
   * await session.sendEncrypted({
   *   inputs: [],
   *   outputs: [["mutable://secrets/x", { apiKey: "sk-abc" }]],
   * });
   *
   * // Encrypt to another party
   * await session.sendEncrypted(envelope, bob.encryptionPubkey);
   * ```
   */
  async sendEncrypted<V = unknown>(
    data: { inputs: string[]; outputs: [uri: string, value: V][] },
    recipientEncPubkeyHex?: string,
  ): Promise<SendResult> {
    if (!this.identity.canEncrypt) {
      throw new Error(
        "AuthenticatedRig.sendEncrypted: identity has no encryption keys.",
      );
    }

    const recipient = recipientEncPubkeyHex || this.identity.encryptionPubkey;

    const encryptedOutputs: [string, unknown][] = await Promise.all(
      data.outputs.map(async ([uri, value]) => {
        const plaintext = new TextEncoder().encode(JSON.stringify(value));
        const encrypted = await this.identity.encrypt(plaintext, recipient);
        return [uri, encrypted] as [string, unknown];
      }),
    );

    return this.send({
      inputs: data.inputs,
      outputs: encryptedOutputs,
    });
  }

  /**
   * Sign and send multiple envelopes in sequence.
   *
   * Each entry becomes its own signed envelope with its own content hash.
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

  // ── Authenticated reads ──

  /**
   * Read and decrypt JSON data from a URI.
   *
   * Reads an EncryptedPayload from the backend via the rig, decrypts it
   * with this identity's encryption private key, and parses the JSON.
   * Returns `null` if the URI has no data.
   *
   * @example
   * ```typescript
   * const secrets = await session.readEncrypted<{ apiKey: string }>(
   *   "mutable://accounts/" + id.pubkey + "/secrets",
   * );
   * ```
   */
  async readEncrypted<T = unknown>(uri: string): Promise<T | null> {
    if (!this.identity.canEncrypt) {
      throw new Error(
        "AuthenticatedRig.readEncrypted: identity has no encryption/decryption keys.",
      );
    }

    const result = await this.rig.read(uri);
    if (!result.success || !result.record) return null;

    const payload = result.record.data;
    if (
      !payload || typeof payload !== "object" ||
      !("data" in (payload as Record<string, unknown>)) ||
      !("nonce" in (payload as Record<string, unknown>))
    ) {
      throw new Error(
        `AuthenticatedRig.readEncrypted: data at ${uri} is not an EncryptedPayload`,
      );
    }

    const decrypted = await this.identity.decrypt(
      payload as EncryptedPayload,
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  }

  /**
   * Read and decrypt multiple URIs in parallel.
   *
   * Returns an array of results in the same order as the input URIs.
   * Missing entries are returned as `null`.
   */
  async readEncryptedMany<T = unknown>(
    uris: readonly string[],
  ): Promise<(T | null)[]> {
    if (uris.length === 0) return [];
    return Promise.all(uris.map((uri) => this.readEncrypted<T>(uri)));
  }

  // ── Identity convenience ──

  /** Whether this identity can sign messages. */
  get canSign(): boolean {
    return this.identity.canSign;
  }

  /** Whether this identity can encrypt/decrypt. */
  get canEncrypt(): boolean {
    return this.identity.canEncrypt;
  }

  /** Ed25519 public key hex. */
  get pubkey(): string {
    return this.identity.pubkey;
  }

  /** X25519 encryption public key hex. */
  get encryptionPubkey(): string {
    return this.identity.encryptionPubkey;
  }
}

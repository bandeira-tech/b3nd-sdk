/**
 * @module
 * AuthenticatedRig — identity-driven wrapper around a Rig.
 *
 * @deprecated Provisional. Signing and encryption are application
 * concerns that bind to a protocol's auth conventions; baking them
 * into a framework helper saddles users with type assumptions and
 * limits how they configure their own setup. Slated for retirement —
 * use `Identity` directly with `message()` and `rig.send()` in
 * application code.
 *
 * @example (still works for now)
 * ```typescript
 * const rig = new Rig({ connections: [connection(client, { receive: ["*"], read: ["*"] })] });
 * const alice = await Identity.fromSeed("alice-secret");
 *
 * const session = alice.rig(rig);
 * await session.send({ inputs: [], outputs: [["mutable://app/x", data]] });
 * ```
 */

import type { Output } from "../b3nd-core/types.ts";
import type { EncryptedPayload } from "../b3nd-encrypt/mod.ts";
import { message } from "../b3nd-msg/data/message.ts";
import type { SendResult } from "../b3nd-msg/data/send.ts";
import type { Identity } from "./identity.ts";
import type { Rig } from "./rig.ts";

/**
 * An authenticated view of a rig — identity drives, rig delivers.
 *
 * @deprecated See module-level note. Going away in a future release.
 *
 * Builds a content-addressed, signed `MessageData` envelope and calls
 * `rig.send([envelope])`. **Decomposition of the envelope's outputs
 * does not happen here** — install `messageDataProgram` and
 * `messageDataHandler` (canon, opt-in) on the Rig if you want the
 * inner outputs persisted.
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
    data: { inputs: string[]; outputs: Output<V>[] },
  ): Promise<SendResult> {
    const auth = [
      await this.identity.sign({ inputs: data.inputs, outputs: data.outputs }),
    ];
    const envelope = await message({
      auth,
      inputs: data.inputs,
      outputs: data.outputs,
    });
    const [result] = await this.rig.send([envelope]);
    return { ...result, uri: envelope[0] };
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
    data: { inputs: string[]; outputs: Output<V>[] },
    recipientEncPubkeyHex?: string,
  ): Promise<SendResult> {
    if (!this.identity.canEncrypt) {
      throw new Error(
        "AuthenticatedRig.sendEncrypted: identity has no encryption keys.",
      );
    }

    const recipient = recipientEncPubkeyHex || this.identity.encryptionPubkey;

    const encryptedOutputs: Output[] = await Promise.all(
      data.outputs.map(async ([uri, value]) => {
        const plaintext = new TextEncoder().encode(JSON.stringify(value));
        const encrypted = await this.identity.encrypt(plaintext, recipient);
        return [uri, encrypted] as Output;
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
    envelopes: { inputs: string[]; outputs: Output<V>[] }[],
  ): Promise<SendResult[]> {
    if (envelopes.length === 0) return [];
    const built: Output[] = await Promise.all(
      envelopes.map(async (env) => {
        const auth = [
          await this.identity.sign({ inputs: env.inputs, outputs: env.outputs }),
        ];
        return await message({
          auth,
          inputs: env.inputs,
          outputs: env.outputs,
        });
      }),
    );
    const results = await this.rig.send(built);
    return results.map((r, i) => ({ ...r, uri: built[i][0] }));
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

    const results = await this.rig.read(uri);
    const result = results[0];
    if (!result?.success || !result.record) return null;

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

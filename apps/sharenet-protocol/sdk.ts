/**
 * @module
 * sharenet SDK — app-facing helpers.
 *
 * Apps never touch the schema directly. They get an `Identity`, pick an
 * `appId`, and call the methods on a `SharenetSession`. Every write
 * travels through a signed envelope; `setPrivate` and `sendEncryptedTo`
 * additionally encrypt the payload before it leaves the process.
 */

import type { Identity } from "@b3nd/rig";
import { AuthenticatedRig, Rig } from "@b3nd/rig";
import type { AuthenticatedMessage } from "@bandeira-tech/b3nd-sdk/encrypt";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-sdk/hash";
import type { SendResult } from "@bandeira-tech/b3nd-sdk";
import type { AppManifest } from "./schema.ts";
import {
  linkUri,
  registryUri,
  sharedListUri,
  sharedUri,
  userListUri,
  userUri,
} from "./uris.ts";

/**
 * Register (or overwrite) an app in the network registry.
 *
 * Must be called by a network operator identity — an identity whose
 * pubkey appears in `SharenetConfig.operators` on the nodes. The app
 * manifest is signed directly by the operator (not only via the envelope)
 * so it carries portable provenance.
 */
export async function registerApp(
  rig: Rig,
  operator: Identity,
  manifest: Omit<AppManifest, "createdAt"> & { createdAt?: string },
): Promise<SendResult> {
  const full: AppManifest = {
    createdAt: new Date().toISOString(),
    ...manifest,
  };
  const signed = await operator.signMessage(full);
  const session = operator.rig(rig);
  return session.send({
    inputs: [],
    outputs: [[registryUri(full.appId), {}, signed]],
  });
}

/** Fetch an app manifest from the registry. */
export async function getAppManifest(
  rig: Rig,
  appId: string,
): Promise<AppManifest | null> {
  const [r] = await rig.read<AuthenticatedMessage<AppManifest>>(
    registryUri(appId),
  );
  return r?.record?.data.payload ?? null;
}

/**
 * Signed per-app session bound to a single user identity.
 *
 * Hides URI construction, signing, and (optionally) encryption. The
 * session's `AuthenticatedRig` signs every envelope under the hood; the
 * schema checks the envelope signature against the pubkey embedded in
 * the target URI, so apps get end-to-end authenticity for free.
 */
export class SharenetSession {
  readonly appId: string;
  readonly identity: Identity;
  readonly session: AuthenticatedRig;

  constructor(rig: Rig, appId: string, identity: Identity) {
    this.appId = appId;
    this.identity = identity;
    this.session = new AuthenticatedRig(identity, rig);
  }

  get pubkey(): string {
    return this.identity.pubkey;
  }

  get encryptionPubkey(): string {
    return this.identity.encryptionPubkey;
  }

  // ── Mutable user data ───────────────────────────────────────

  /** Write a signed, per-user value. Overwrites on every call. */
  async setItem<T>(path: string, value: T): Promise<SendResult> {
    return this.session.send({
      inputs: [],
      outputs: [[userUri(this.appId, this.pubkey, path), {}, value]],
    });
  }

  /** Read a value previously written via `setItem`. */
  async getItem<T>(path: string): Promise<T | null> {
    const [r] = await this.session.rig.read<T>(
      userUri(this.appId, this.pubkey, path),
    );
    return r?.record?.data ?? null;
  }

  /** List all items under a user path (trailing-slash prefix query). */
  async listItems<T>(path = ""): Promise<Array<{ uri: string; data: T }>> {
    const results = await this.session.rig.read<T>(
      userListUri(this.appId, this.pubkey, path),
    );
    return results
      .filter((r) => r.success && r.uri && r.record)
      .map((r) => ({ uri: r.uri!, data: r.record!.data }));
  }

  // ── Shared (per-app) feed ──────────────────────────────────

  /** Append a signed, origin-stamped value to the shared feed. */
  async setShared<T>(path: string, value: T): Promise<SendResult> {
    return this.session.send({
      inputs: [],
      outputs: [[sharedUri(this.appId, this.pubkey, path), {}, value]],
    });
  }

  /** List the whole shared feed for this app. */
  async listShared<T>(): Promise<
    Array<{ uri: string; pubkey: string; data: T }>
  > {
    const results = await this.session.rig.read<T>(sharedListUri(this.appId));
    return results
      .filter((r) => r.success && r.uri && r.record)
      .map((r) => ({
        uri: r.uri!,
        pubkey: extractPubkeyFromShared(r.uri!),
        data: r.record!.data,
      }));
  }

  // ── Content-addressed blobs + links ────────────────────────

  /**
   * Publish an immutable blob and return its `hash://sha256/{hex}` URI.
   *
   * Blobs deduplicate by content hash across the whole network — safe to
   * call with the same payload twice.
   */
  async publishBlob(value: unknown): Promise<string> {
    const hash = await computeSha256(value);
    const uri = generateHashUri(hash);
    await this.session.rig.receive([[uri, {}, value]]);
    return uri;
  }

  /**
   * Create/update a signed link at `link://sharenet/{appId}/{pubkey}/{path}`.
   *
   * NOTE: the target hash URI is referenced (read during validation) but
   * **not** placed in `inputs` — envelope `inputs` are consumed (deleted)
   * by `MessageDataClient`, which would evict the blob we're trying to
   * point at. The schema re-reads `data` during validation instead.
   */
  async setLink(path: string, target: string): Promise<SendResult> {
    if (!target.startsWith("hash://sha256/")) {
      throw new Error("sharenet: link target must be a hash://sha256/ URI");
    }
    return this.session.send({
      inputs: [],
      outputs: [[linkUri(this.appId, this.pubkey, path), {}, target]],
    });
  }

  /** Resolve a link and return the referenced content. */
  async resolveLink<T>(path: string): Promise<T | null> {
    const [link] = await this.session.rig.read<string>(
      linkUri(this.appId, this.pubkey, path),
    );
    const target = link?.record?.data;
    if (typeof target !== "string") return null;
    const [content] = await this.session.rig.read<T>(target);
    return content?.record?.data ?? null;
  }

  // ── Encrypted (private) variants ───────────────────────────

  /** Store an encrypted-to-self payload under the user's private namespace. */
  async setPrivate<T>(path: string, value: T): Promise<SendResult> {
    return this.session.sendEncrypted({
      inputs: [],
      outputs: [[userUri(this.appId, this.pubkey, path), {}, value]],
    });
  }

  /** Read and decrypt a previously stored private value. */
  async getPrivate<T>(path: string): Promise<T | null> {
    return this.session.readEncrypted<T>(
      userUri(this.appId, this.pubkey, path),
    );
  }

  /** Send a signed+encrypted payload to another user's shared slot. */
  async sendEncryptedTo<T>(
    recipientEncryptionPubkey: string,
    path: string,
    value: T,
  ): Promise<SendResult> {
    return this.session.sendEncrypted(
      {
        inputs: [],
        outputs: [[sharedUri(this.appId, this.pubkey, path), {}, value]],
      },
      recipientEncryptionPubkey,
    );
  }
}

function extractPubkeyFromShared(uri: string): string {
  try {
    const u = new URL(uri);
    const parts = u.pathname.split("/").filter(Boolean);
    // {appId}/shared/{pubkey}/...
    return parts[2] ?? "";
  } catch {
    return "";
  }
}

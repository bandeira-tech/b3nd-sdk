/**
 * @module
 * sharenet — shared-infrastructure DePIN protocol schema.
 *
 * A single b3nd network that hosts many app backends. Operators run shared
 * nodes; apps register themselves in an on-network registry; users own
 * pubkey-scoped namespaces per app.
 *
 * The schema enforces, for every incoming message:
 *
 *  - envelope must be signed by the pubkey baked into the target URI path;
 *  - the target app must exist in the on-network registry;
 *  - payloads stay below size limits (mutable: small, hash: larger-but-bounded);
 *  - `link://sharenet/...` values must point at existing `hash://sha256/...`
 *    content.
 *
 * The only non-scalar dependency is `@bandeira-tech/b3nd-sdk/encrypt`'s
 * `verify()` — we verify envelope signatures directly instead of relying
 * on per-value AuthenticatedMessages, which lets encrypted writes and
 * plain signed writes share the same validation path.
 */

import type { Schema, Validator } from "@bandeira-tech/b3nd-sdk/types";
import { hashValidator } from "@bandeira-tech/b3nd-sdk/hash";
import { isMessageData } from "@bandeira-tech/b3nd-sdk";
import { verify } from "@bandeira-tech/b3nd-sdk/encrypt";

/** Runtime configuration injected when the node boots. */
export interface SharenetConfig {
  /** Operator pubkeys that may write to `app://registry/{appId}`. */
  operators: string[];
  /**
   * Maximum serialized size (in bytes) for a single mutable write.
   * Apps are expected to stash large payloads behind `hash://` and link to
   * them; the mutable layer is for small, frequently-updated state.
   */
  maxMutableBytes?: number;
  /** Maximum serialized size for a single hash:// blob. */
  maxBlobBytes?: number;
}

const DEFAULTS = {
  maxMutableBytes: 64 * 1024, // 64 KiB
  maxBlobBytes: 2 * 1024 * 1024, // 2 MiB
};

/** App metadata signed by a network operator. */
export interface AppManifest {
  appId: string;
  name: string;
  description?: string;
  ownerPubkey: string;
  version: number;
  createdAt: string;
}

const APP_ID_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const PUBKEY_RE = /^[0-9a-f]{64}$/i;

/** Build the sharenet schema bound to the given runtime configuration. */
export function createSchema(config: SharenetConfig): Schema {
  const operators = new Set(config.operators.map((k) => k.toLowerCase()));
  const maxMutableBytes = config.maxMutableBytes ?? DEFAULTS.maxMutableBytes;
  const maxBlobBytes = config.maxBlobBytes ?? DEFAULTS.maxBlobBytes;

  // ── app://registry ────────────────────────────────────────────
  // Writable only by a network operator. Value is an AuthenticatedMessage
  // (operator-signed) whose payload is the AppManifest.
  const registryValidator: Validator = async ([uri, , data]) => {
    const envelope = data as {
      auth?: { pubkey: string; signature: string }[];
      payload?: AppManifest;
    };
    const manifest = envelope?.payload;
    if (!manifest || typeof manifest !== "object") {
      return { valid: false, error: "registry: payload required" };
    }
    if (!APP_ID_RE.test(manifest.appId)) {
      return { valid: false, error: "registry: invalid manifest.appId" };
    }
    const tail = uri.split("/").pop() ?? "";
    if (manifest.appId !== tail) {
      return {
        valid: false,
        error: "registry: URI path must match manifest.appId",
      };
    }
    const auths = envelope.auth ?? [];
    const operatorAuth = auths.find((a) =>
      operators.has(a.pubkey.toLowerCase())
    );
    if (!operatorAuth) {
      return { valid: false, error: "registry: signer is not an operator" };
    }
    const ok = await verify(
      operatorAuth.pubkey,
      operatorAuth.signature,
      manifest,
    );
    if (!ok) {
      return {
        valid: false,
        error: "registry: signature verification failed",
      };
    }
    return { valid: true };
  };

  // ── mutable://sharenet ────────────────────────────────────────
  //
  //   mutable://sharenet/{appId}/users/{pubkey}/...
  //   mutable://sharenet/{appId}/shared/{pubkey}/...
  //
  // Every write must travel inside an envelope signed by {pubkey} — that's
  // the invariant that makes this a "private network" (no anonymous writes)
  // while still letting apps keep data opaque via end-to-end encryption.
  const mutableValidator: Validator = async ([uri, , data], upstream, read) => {
    if (byteSize(data) > maxMutableBytes) {
      return {
        valid: false,
        error: `mutable: payload exceeds ${maxMutableBytes} bytes`,
      };
    }

    const parts = parseSharenetPath(uri);
    if (!parts) {
      return {
        valid: false,
        error:
          "mutable: expected mutable://sharenet/{appId}/users|shared/{pubkey}/...",
      };
    }
    const { appId, pubkey } = parts;

    const registry = await read(`app://registry/${appId}`);
    if (!registry.success) {
      return { valid: false, error: `mutable: app "${appId}" not registered` };
    }

    const ok = await verifyEnvelopeSignedBy(upstream, pubkey);
    if (!ok) {
      return {
        valid: false,
        error: "mutable: envelope not signed by path pubkey",
      };
    }
    return { valid: true };
  };

  // ── hash://sha256 ─────────────────────────────────────────────
  // Content-addressed, write-once. Size-capped so a single client cannot
  // exhaust the shared store. Envelopes themselves pass through this
  // program on the way in — short-circuit them to let per-output
  // validators do their thing.
  const hashBase = hashValidator();
  const hashed: Validator = async (output, upstream, read) => {
    if (isMessageData(output[2])) return { valid: true };
    const [, , value] = output;
    if (byteSize(value) > maxBlobBytes) {
      return { valid: false, error: `hash: blob exceeds ${maxBlobBytes} bytes` };
    }
    return hashBase(output, upstream, read);
  };

  // ── link://sharenet ───────────────────────────────────────────
  //   link://sharenet/{appId}/{pubkey}/...  →  hash://sha256/{hex}
  //
  // Writable only by {pubkey}; the referenced hash content must exist at
  // write time (dangling links are programmer error).
  const linkValidator: Validator = async ([uri, , data], upstream, read) => {
    const parts = parseLinkPath(uri);
    if (!parts) {
      return {
        valid: false,
        error: "link: expected link://sharenet/{appId}/{pubkey}/...",
      };
    }
    const { appId, pubkey } = parts;

    const registry = await read(`app://registry/${appId}`);
    if (!registry.success) {
      return { valid: false, error: `link: app "${appId}" not registered` };
    }

    const ok = await verifyEnvelopeSignedBy(upstream, pubkey);
    if (!ok) {
      return { valid: false, error: "link: envelope not signed by path pubkey" };
    }

    const target =
      typeof data === "string"
        ? data
        : (data as { payload?: string })?.payload;
    if (typeof target !== "string" || !target.startsWith("hash://sha256/")) {
      return {
        valid: false,
        error: "link: value must point to a hash://sha256/ URI",
      };
    }
    const content = await read(target);
    if (!content.success) {
      return { valid: false, error: "link: target content not found" };
    }
    return { valid: true };
  };

  return {
    "app://registry": registryValidator,
    "mutable://sharenet": mutableValidator,
    "hash://sha256": hashed,
    "link://sharenet": linkValidator,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function byteSize(value: unknown): number {
  if (value instanceof Uint8Array) return value.byteLength;
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function parseSharenetPath(
  uri: string,
): { appId: string; pubkey: string } | null {
  // mutable://sharenet/{appId}/(users|shared)/{pubkey}/...
  try {
    const u = new URL(uri);
    if (u.protocol !== "mutable:" || u.hostname !== "sharenet") return null;
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length < 3) return null;
    const [appId, lane, pubkey] = segs;
    if (!APP_ID_RE.test(appId)) return null;
    if (lane !== "users" && lane !== "shared") return null;
    if (!PUBKEY_RE.test(pubkey)) return null;
    return { appId, pubkey };
  } catch {
    return null;
  }
}

function parseLinkPath(
  uri: string,
): { appId: string; pubkey: string } | null {
  // link://sharenet/{appId}/{pubkey}/...
  try {
    const u = new URL(uri);
    if (u.protocol !== "link:" || u.hostname !== "sharenet") return null;
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length < 2) return null;
    const [appId, pubkey] = segs;
    if (!APP_ID_RE.test(appId)) return null;
    if (!PUBKEY_RE.test(pubkey)) return null;
    return { appId, pubkey };
  } catch {
    return null;
  }
}

/**
 * Verify that the surrounding envelope is authenticated by `pubkey`.
 *
 * `AuthenticatedRig.send()` signs `{ inputs, outputs }` with the
 * identity's Ed25519 key and carries the result in the envelope's `auth`
 * array. We look for a matching pubkey entry and re-verify its signature
 * over the same payload shape.
 */
async function verifyEnvelopeSignedBy(
  upstream: [string, Record<string, number>, unknown] | undefined,
  pubkey: string,
): Promise<boolean> {
  if (!upstream) return false;
  const envelope = upstream[2] as {
    auth?: { pubkey: string; signature: string }[];
    inputs?: string[];
    outputs?: unknown[];
  };
  if (!envelope || !Array.isArray(envelope.auth)) return false;
  const match = envelope.auth.find((a) =>
    a.pubkey.toLowerCase() === pubkey.toLowerCase()
  );
  if (!match) return false;
  return verify(match.pubkey, match.signature, {
    inputs: envelope.inputs ?? [],
    outputs: envelope.outputs ?? [],
  });
}

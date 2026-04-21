/**
 * @module
 * shared-infra — a B3nd protocol for a private network that hosts multiple
 * app backends on shared nodes.
 *
 * The protocol gives every app a sandbox under `/{appId}/...`, enforces
 * per-app registration + write quota, and exposes content-addressed storage
 * plus mutable pointers that the b3nd-sdk apps consume.
 *
 * Programs:
 *
 * - `hash://sha256`                      — immutable content, write-once
 * - `mutable://registry`                 — operator-only app registration
 * - `mutable://app`                      — per-app mutable namespaces
 *                                          (config, user data, pointers)
 * - `link://app`                         — app-scoped mutable pointers that
 *                                          must reference a `hash://` URI
 * - `log://app`                          — append-only event/audit log
 *                                          (write-once, arbitrary path)
 *
 * URI conventions used by apps:
 *
 *   mutable://registry/apps/{appId}                 — app record
 *   mutable://app/{appId}/config                    — app-level config
 *   mutable://app/{appId}/users/{pubkey}/{…}        — pubkey-guarded user data
 *   mutable://app/{appId}/index/{…}                 — shared mutable index
 *   link://app/{appId}/latest/{…}                   — named pointer → hash://
 *   log://app/{appId}/events/{…}                    — append-only log entry
 *   hash://sha256/{hex}                             — immutable content
 */

import type { Schema, Validator } from "../../../libs/b3nd-core/types.ts";
import { hashValidator } from "../../../libs/b3nd-hash/mod.ts";
import {
  authValidation,
  createPubkeyBasedAccess,
} from "../../../libs/b3nd-auth/mod.ts";

/** Config for building the protocol schema. */
export interface SharedInfraConfig {
  /**
   * Operator pubkeys allowed to register/unregister apps in the registry.
   * If empty, the registry accepts any signed message — useful for dev mode.
   */
  operatorPubkeys?: string[];

  /**
   * Maximum payload size (bytes of JSON) for a single output.
   * Applied to every `hash://`, `mutable://app`, `log://app` write.
   */
  maxPayloadBytes?: number;

  /**
   * When true, require `mutable://registry/apps/{appId}` to exist before
   * allowing writes to `mutable://app/{appId}/…`, `link://app/{appId}/…`
   * or `log://app/{appId}/…`. Enforced via a cross-program read.
   */
  requireAppRegistration?: boolean;
}

const DEFAULT_MAX_PAYLOAD = 256 * 1024;

/**
 * Build the shared-infra protocol schema.
 *
 * The schema is returned from a factory rather than exported as a constant so
 * node operators can parameterize allowed operators / quota without editing
 * the protocol source.
 */
export function createSharedInfraSchema(
  config: SharedInfraConfig = {},
): Schema {
  const max = config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD;
  const operatorPubkeys = new Set(config.operatorPubkeys ?? []);
  const requireRegistration = config.requireAppRegistration ?? true;

  const withinQuota = (data: unknown): { valid: boolean; error?: string } => {
    try {
      const size = JSON.stringify(data ?? null).length;
      if (size > max) {
        return {
          valid: false,
          error: `Payload too large: ${size}B > ${max}B`,
        };
      }
      return { valid: true };
    } catch {
      return { valid: false, error: "Payload is not JSON-serializable" };
    }
  };

  const parseAppUri = (
    uri: string,
  ): { appId: string; rest: string } | null => {
    const match = uri.match(/^[a-z]+:\/\/[^/]+\/([^/]+)(\/.*)?$/);
    if (!match) return null;
    return { appId: match[1], rest: match[2] ?? "" };
  };

  const ensureAppRegistered = async (
    appId: string,
    read: (u: string) => Promise<{ success: boolean }>,
  ): Promise<{ valid: boolean; error?: string }> => {
    if (!requireRegistration) return { valid: true };
    const found = await read(`mutable://registry/apps/${appId}`);
    if (!found.success) {
      return { valid: false, error: `App not registered: ${appId}` };
    }
    return { valid: true };
  };

  // ── hash:// — immutable content (quota-enforced) ─────────────────────
  const hash = hashValidator();
  const hashProgram: Validator = async (output, upstream, read) => {
    const [, , data] = output;
    const quota = withinQuota(data);
    if (!quota.valid) return quota;
    return hash(output, upstream, read);
  };

  // ── mutable://registry — operator-guarded app registry ───────────────
  const registryProgram: Validator = async ([uri, , data]) => {
    if (!uri.startsWith("mutable://registry/apps/")) {
      return {
        valid: false,
        error: "Registry only accepts writes under /apps/{appId}",
      };
    }
    if (!data || typeof data !== "object") {
      return { valid: false, error: "App record must be an object" };
    }
    const rec = data as Record<string, unknown>;
    if (typeof rec.appId !== "string" || !/^[a-z0-9-]+$/.test(rec.appId)) {
      return {
        valid: false,
        error: "app record missing appId (lowercase, digits, dashes)",
      };
    }
    if (typeof rec.name !== "string" || rec.name.length === 0) {
      return { valid: false, error: "app record missing `name`" };
    }
    // Dev-mode shortcut: no operators configured → accept
    if (operatorPubkeys.size === 0) return withinQuota(rec);

    // Require an auth envelope whose signer is a configured operator
    const access = async () => [...operatorPubkeys];
    const validator = authValidation(access);
    const ok = await validator({ uri, value: data as any });
    if (!ok) {
      return {
        valid: false,
        error: "Registry writes must be signed by a configured operator",
      };
    }
    return withinQuota(rec);
  };

  // ── mutable://app — per-app user-scoped mutable state ────────────────
  const appMutableProgram: Validator = async ([uri, , data], _up, read) => {
    const parsed = parseAppUri(uri);
    if (!parsed) {
      return { valid: false, error: `Invalid app URI: ${uri}` };
    }
    const reg = await ensureAppRegistered(parsed.appId, read);
    if (!reg.valid) return reg;

    const quota = withinQuota(data);
    if (!quota.valid) return quota;

    // `/users/{pubkey}/…` paths require a signature from {pubkey}
    if (parsed.rest.startsWith("/users/")) {
      const pubkey = parsed.rest.split("/")[2];
      if (!pubkey) {
        return { valid: false, error: "Missing pubkey in users path" };
      }
      if (!data || typeof data !== "object") {
        return {
          valid: false,
          error: "User-scoped data must be a signed envelope",
        };
      }
      const access = async () => [pubkey];
      const validator = authValidation(access);
      const ok = await validator({ uri, value: data as any });
      if (!ok) {
        return {
          valid: false,
          error: `Signature does not match owner pubkey ${pubkey}`,
        };
      }
      return { valid: true };
    }

    // `/config`, `/index/...` — public mutable (like an app-wide doc)
    if (
      parsed.rest === "/config" ||
      parsed.rest.startsWith("/index/") ||
      parsed.rest.startsWith("/shared/")
    ) {
      return { valid: true };
    }

    return {
      valid: false,
      error: `Unsupported mutable path for app ${parsed.appId}: ${parsed.rest}`,
    };
  };

  // ── link://app — mutable pointers, value must be a hash:// URI ──────
  const appLinkProgram: Validator = async ([uri, , data], upstream, read) => {
    const parsed = parseAppUri(uri);
    if (!parsed) return { valid: false, error: `Invalid link URI: ${uri}` };

    const reg = await ensureAppRegistered(parsed.appId, read);
    if (!reg.valid) return reg;

    if (typeof data !== "string" || !data.startsWith("hash://sha256/")) {
      return {
        valid: false,
        error: "Link value must be a hash://sha256/ URI",
      };
    }

    // The referenced content must either already exist on this node, OR
    // appear as a sibling output in the same envelope (atomic publish).
    const target = await read(data);
    if (target.success) return { valid: true };

    if (upstream) {
      const [, , envData] = upstream;
      const siblings = (envData as { outputs?: Array<[string, unknown, unknown]> })
        ?.outputs;
      if (siblings && siblings.some(([u]) => u === data)) {
        return { valid: true };
      }
    }

    return { valid: false, error: `Linked content not found: ${data}` };
  };

  // ── log://app — append-only, write-once per path ─────────────────────
  const appLogProgram: Validator = async ([uri, , data], _up, read) => {
    const parsed = parseAppUri(uri);
    if (!parsed) return { valid: false, error: `Invalid log URI: ${uri}` };
    const reg = await ensureAppRegistered(parsed.appId, read);
    if (!reg.valid) return reg;

    const existing = await read(uri);
    if (existing.success) {
      return {
        valid: false,
        error: `Log entry already exists: ${uri} (log:// is write-once)`,
      };
    }
    return withinQuota(data);
  };

  return {
    "hash://sha256": hashProgram,
    "mutable://registry": registryProgram,
    "mutable://app": appMutableProgram,
    "link://app": appLinkProgram,
    "log://app": appLogProgram,
  };
}

/**
 * Default schema — useful for tests and the `SCHEMA_MODULE` env var of
 * `apps/b3nd-node`. Runs in dev mode: no operator gate, 256 KB payload cap,
 * app registration required.
 */
const defaultSchema: Schema = createSharedInfraSchema();
export default defaultSchema;

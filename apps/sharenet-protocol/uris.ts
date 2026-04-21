/**
 * @module
 * URI builders for the sharenet protocol.
 *
 * URI conventions are the surface area that apps consume. Keep them
 * predictable and well-formed by constructing them through these helpers
 * instead of string concatenation at call sites.
 *
 * Namespace layout:
 *
 *   app://registry/{appId}
 *     Operator-signed app metadata. Writing requires an operator pubkey.
 *
 *   mutable://sharenet/{appId}/users/{pubkey}/{...path}
 *     Per-user mutable data. Writer must sign with {pubkey}.
 *
 *   mutable://sharenet/{appId}/shared/{...path}
 *     App-shared mutable data. Any registered user may write, first path
 *     segment after "shared/" is the writer's pubkey (origin-stamped).
 *
 *   hash://sha256/{hex}
 *     Content-addressed immutable blobs. Write-once, hash-verified.
 *
 *   link://sharenet/{appId}/{pubkey}/{...path}
 *     Per-user mutable pointers to hash:// URIs.
 */

const APP_ID_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const PUBKEY_RE = /^[0-9a-f]{64}$/i;

export function assertAppId(appId: string): void {
  if (!APP_ID_RE.test(appId)) {
    throw new Error(
      `sharenet: invalid appId "${appId}" (expected ${APP_ID_RE})`,
    );
  }
}

export function assertPubkey(pubkey: string): void {
  if (!PUBKEY_RE.test(pubkey)) {
    throw new Error(`sharenet: invalid pubkey "${pubkey}" (expected 64-hex)`);
  }
}

/** Registry URI for a given app. */
export function registryUri(appId: string): string {
  assertAppId(appId);
  return `app://registry/${appId}`;
}

/** Per-user mutable URI. */
export function userUri(appId: string, pubkey: string, path: string): string {
  assertAppId(appId);
  assertPubkey(pubkey);
  const p = normalizePath(path);
  return `mutable://sharenet/${appId}/users/${pubkey}${p}`;
}

/** Trailing-slash list URI over a user's path. */
export function userListUri(
  appId: string,
  pubkey: string,
  path = "",
): string {
  return `${userUri(appId, pubkey, path).replace(/\/*$/, "")}/`;
}

/** Shared (per-app) mutable URI, origin-stamped with writer's pubkey. */
export function sharedUri(
  appId: string,
  pubkey: string,
  path: string,
): string {
  assertAppId(appId);
  assertPubkey(pubkey);
  const p = normalizePath(path);
  return `mutable://sharenet/${appId}/shared/${pubkey}${p}`;
}

/** Prefix-list URI over all shared writes for an app. */
export function sharedListUri(appId: string): string {
  assertAppId(appId);
  return `mutable://sharenet/${appId}/shared/`;
}

/** Per-user link URI pointing at a hash:// target. */
export function linkUri(appId: string, pubkey: string, path: string): string {
  assertAppId(appId);
  assertPubkey(pubkey);
  const p = normalizePath(path);
  return `link://sharenet/${appId}/${pubkey}${p}`;
}

function normalizePath(path: string): string {
  if (!path) return "";
  return path.startsWith("/") ? path : `/${path}`;
}

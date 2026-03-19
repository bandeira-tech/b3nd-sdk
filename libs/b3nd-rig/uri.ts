/**
 * @module
 * URI utilities for b3nd — builders, validators, and parsers.
 *
 * B3nd URIs follow the pattern: `protocol://path/segments`
 *
 * Common protocols:
 * - `mutable://` — mutable key-value data
 * - `hash://` — content-addressed immutable data
 * - `accounts://` — identity-scoped data (pubkey-gated)
 *
 * @example
 * ```typescript
 * import { uri } from "@b3nd/rig";
 *
 * // Build URIs safely
 * uri.mutable("users", alice.pubkey, "profile")
 * // → "mutable://users/{pubkey}/profile"
 *
 * // Parse and inspect
 * const parsed = uri.parse("mutable://open/items/42");
 * // → { protocol: "mutable", segments: ["open", "items", "42"] }
 *
 * // Validate
 * uri.isValid("mutable://open/test")  // → true
 * uri.isValid("bad-uri")              // → false
 * ```
 */

/** Supported URI protocols in b3nd. */
export type UriProtocol = "mutable" | "hash" | "accounts";

/** Parsed representation of a b3nd URI. */
export interface ParsedUri {
  /** The protocol scheme (mutable, hash, accounts). */
  protocol: UriProtocol;
  /** Path segments after the protocol. */
  segments: string[];
  /** The full original URI string. */
  raw: string;
}

const VALID_PROTOCOLS: ReadonlySet<string> = new Set([
  "mutable",
  "hash",
  "accounts",
]);

/**
 * Parse a b3nd URI into its components.
 *
 * @returns ParsedUri or null if the URI is invalid.
 */
export function parse(raw: string): ParsedUri | null {
  const match = raw.match(/^(\w+):\/\/(.*)$/);
  if (!match) return null;

  const [, protocol, path] = match;
  if (!VALID_PROTOCOLS.has(protocol)) return null;

  const segments = path.split("/").filter((s) => s.length > 0);

  return {
    protocol: protocol as UriProtocol,
    segments,
    raw,
  };
}

/**
 * Check if a string is a valid b3nd URI.
 */
export function isValid(raw: string): boolean {
  return parse(raw) !== null;
}

/**
 * Check if a URI uses the mutable protocol.
 */
export function isMutable(raw: string): boolean {
  return raw.startsWith("mutable://");
}

/**
 * Check if a URI uses the hash protocol (content-addressed).
 */
export function isHash(raw: string): boolean {
  return raw.startsWith("hash://");
}

/**
 * Check if a URI uses the accounts protocol (identity-scoped).
 */
export function isAccounts(raw: string): boolean {
  return raw.startsWith("accounts://");
}

/**
 * Build a mutable URI from path segments.
 *
 * @example
 * ```typescript
 * mutable("open", "items", "42")
 * // → "mutable://open/items/42"
 * ```
 */
export function mutable(...segments: string[]): string {
  return `mutable://${segments.join("/")}`;
}

/**
 * Build a hash URI from algorithm and digest.
 *
 * @example
 * ```typescript
 * hash("sha256", "abc123...")
 * // → "hash://sha256/abc123..."
 * ```
 */
export function hash(algorithm: string, digest: string): string {
  return `hash://${algorithm}/${digest}`;
}

/**
 * Build an accounts URI from a public key and path segments.
 *
 * @example
 * ```typescript
 * accounts(alice.pubkey, "profile")
 * // → "accounts://{pubkey}/profile"
 * ```
 */
export function accounts(pubkey: string, ...path: string[]): string {
  return `accounts://${pubkey}${path.length ? "/" + path.join("/") : ""}`;
}

/**
 * Get the parent prefix of a URI (for list operations).
 *
 * @example
 * ```typescript
 * parent("mutable://open/items/42")
 * // → "mutable://open/items"
 * ```
 */
export function parent(raw: string): string | null {
  const parsed = parse(raw);
  if (!parsed || parsed.segments.length === 0) return null;

  const parentSegments = parsed.segments.slice(0, -1);
  return `${parsed.protocol}://${parentSegments.join("/")}`;
}

/**
 * Get the last segment of a URI (the "key" or "name").
 *
 * @example
 * ```typescript
 * key("mutable://open/items/42")
 * // → "42"
 * ```
 */
export function key(raw: string): string | null {
  const parsed = parse(raw);
  if (!parsed || parsed.segments.length === 0) return null;
  return parsed.segments[parsed.segments.length - 1];
}

/**
 * Join a base URI with additional path segments.
 *
 * @example
 * ```typescript
 * join("mutable://open/items", "42", "meta")
 * // → "mutable://open/items/42/meta"
 * ```
 */
export function join(base: string, ...segments: string[]): string {
  // Remove trailing slash from base if present
  const clean = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${clean}/${segments.join("/")}`;
}

/**
 * The `uri` namespace — all URI utilities in one import.
 *
 * @example
 * ```typescript
 * import { uri } from "@b3nd/rig";
 *
 * const u = uri.mutable("open", "items", "42");
 * const parsed = uri.parse(u);
 * const parentUri = uri.parent(u);
 * ```
 */
export const uri = {
  parse,
  isValid,
  isMutable,
  isHash,
  isAccounts,
  mutable,
  hash,
  accounts,
  parent,
  key,
  join,
} as const;

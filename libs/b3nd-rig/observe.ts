/**
 * @module
 * URI pattern matcher and observe registry for the Rig.
 *
 * Observe reactions fire on successful writes (send/receive).
 * URI patterns use Express-style matching:
 * - `:param` captures a single segment
 * - `*` matches one or more remaining segments
 * - Literal segments must match exactly
 *
 * Handlers are fire-and-forget — errors are caught and logged.
 *
 * Pure module — no Rig dependency, testable in isolation.
 */

// ── Types ──

/** Observe handler — called when a write matches the URI pattern. */
export type ObserveHandler = (
  uri: string,
  data: unknown,
  params: Record<string, string>,
) => void | Promise<void>;

interface ObserveEntry {
  /** The original pattern string. */
  pattern: string;
  /** Pre-split pattern segments for matching. */
  segments: string[];
  /** The handler to call on match. */
  handler: ObserveHandler;
}

// ── Pattern matching ──

/**
 * Match a URI against an Express-style pattern.
 *
 * Returns captured params on match, or `null` on no match.
 *
 * @example
 * ```ts
 * matchPattern("mutable://app/users/:id", "mutable://app/users/alice")
 * // → { id: "alice" }
 *
 * matchPattern("hash://sha256/*", "hash://sha256/abc123")
 * // → { "*": "abc123" }
 *
 * matchPattern("mutable://app/config", "mutable://app/other")
 * // → null
 * ```
 */
export function matchPattern(
  patternSegments: string[],
  uri: string,
): Record<string, string> | null {
  const uriSegments = uri.split("/");
  const params: Record<string, string> = {};

  for (let i = 0; i < patternSegments.length; i++) {
    const pat = patternSegments[i];

    if (pat === "*") {
      // Wildcard — matches rest of segments
      params["*"] = uriSegments.slice(i).join("/");
      return params;
    }

    if (i >= uriSegments.length) return null;

    if (pat.startsWith(":")) {
      // Named param — captures one segment
      params[pat.slice(1)] = uriSegments[i];
    } else if (pat !== uriSegments[i]) {
      // Literal — must match exactly
      return null;
    }
  }

  // All pattern segments consumed — URI must not have extra segments
  if (uriSegments.length !== patternSegments.length) return null;

  return params;
}

// ── Registry ──

/**
 * Registry of URI-pattern-matched observe handlers.
 *
 * Handlers fire asynchronously on `match()`. Errors are caught
 * and logged to console.warn, never propagated.
 */
export class ObserveRegistry {
  private entries: ObserveEntry[] = [];

  /**
   * Register an observe handler for a URI pattern.
   * Returns an unsubscribe function.
   */
  add(pattern: string, handler: ObserveHandler): () => void {
    const entry: ObserveEntry = {
      pattern,
      segments: pattern.split("/"),
      handler,
    };
    this.entries.push(entry);
    return () => {
      const idx = this.entries.indexOf(entry);
      if (idx >= 0) this.entries.splice(idx, 1);
    };
  }

  /**
   * Fire matching handlers for a URI. Async, fire-and-forget.
   * Errors in handlers are caught and logged.
   */
  match(uri: string, data: unknown): void {
    for (const entry of this.entries) {
      const params = matchPattern(entry.segments, uri);
      if (params !== null) {
        Promise.resolve().then(() => entry.handler(uri, data, params)).catch(
          (err) => {
            console.warn(
              `[rig] observe handler error on "${entry.pattern}":`,
              err,
            );
          },
        );
      }
    }
  }

  /** Whether any patterns are registered. */
  get size(): number {
    return this.entries.length;
  }
}

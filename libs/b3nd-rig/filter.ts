/**
 * @module
 * Client URI filter — wraps any client with per-operation URI patterns.
 *
 * Uses the same Express-style pattern matching as observe:
 * - `:param` matches a single segment
 * - `*` matches one or more remaining segments
 * - Literal segments must match exactly
 *
 * A filtered client's `accepts(operation, uri)` method returns true only
 * when the URI matches one of the patterns declared for that operation.
 *
 * @example
 * ```ts
 * import { withFilter } from "./filter.ts";
 *
 * // Read-only cache for specific patterns
 * const cache = withFilter(redisClient, {
 *   read: ["mutable://accounts/:key/*", "hash://sha256/*"],
 * });
 *
 * // Full b3nd node
 * const node = withFilter(httpClient, {
 *   receive: ["mutable://*", "immutable://*", "hash://*", "link://*"],
 *   read:    ["mutable://*", "immutable://*", "hash://*", "link://*"],
 *   list:    ["mutable://*", "immutable://*"],
 *   delete:  ["mutable://*"],
 * });
 *
 * // Write-only event sink
 * const console = withFilter(consoleClient, {
 *   receive: ["rig://event/*"],
 * });
 *
 * // Rig routes to the right clients automatically
 * const rig = new Rig({ connections: [cache, node, console] });
 * ```
 */

import type {
  ClientAccepts,
  ClientOperation,
  NodeProtocolInterface,
} from "../b3nd-core/types.ts";
import { matchPattern } from "./reactions.ts";

// ── Types ──

/** Per-operation URI patterns. Only listed operations are accepted. */
export interface FilterPatterns {
  receive?: string[];
  read?: string[];
  list?: string[];
  delete?: string[];
}

/** A client with `accepts()` — the rig uses this for routing. */
export type FilteredClient = NodeProtocolInterface & ClientAccepts;

// ── Matching ──

/** Pre-compiled pattern: original string + pre-split segments. */
interface CompiledPattern {
  pattern: string;
  segments: string[];
}

function compilePatterns(patterns: string[]): CompiledPattern[] {
  return patterns.map((p) => ({ pattern: p, segments: p.split("/") }));
}

function matchesAny(compiled: CompiledPattern[], uri: string): boolean {
  for (const { segments } of compiled) {
    if (matchPattern(segments, uri) !== null) return true;
  }
  return false;
}

// ── withFilter ──

/**
 * Wrap a client with per-operation URI filters.
 *
 * The returned client has an `accepts(operation, uri)` method that the
 * rig uses for routing. Operations not listed in the filter patterns
 * are not accepted.
 *
 * All methods delegate to the underlying client unchanged — the filter
 * only affects routing decisions, not behavior.
 */
export function withFilter(
  client: NodeProtocolInterface,
  patterns: FilterPatterns,
): FilteredClient {
  const compiled: Record<string, CompiledPattern[]> = {};
  for (const op of ["receive", "read", "list", "delete"] as const) {
    if (patterns[op]) {
      compiled[op] = compilePatterns(patterns[op]!);
    }
  }

  return Object.create(client, {
    accepts: {
      value(operation: ClientOperation, uri: string): boolean {
        const opPatterns = compiled[operation];
        if (!opPatterns) return false; // operation not listed → not accepted
        return matchesAny(opPatterns, uri);
      },
      enumerable: true,
    },
  }) as FilteredClient;
}

/**
 * Check if a client accepts a specific operation + URI.
 *
 * If the client has an `accepts` method, uses it.
 * Otherwise returns `true` — unfiltered clients accept everything.
 */
export function clientAccepts(
  client: NodeProtocolInterface,
  operation: ClientOperation,
  uri: string,
): boolean {
  if ("accepts" in client && typeof client.accepts === "function") {
    return (client as ClientAccepts).accepts(operation, uri);
  }
  return true; // no filter → accept all
}

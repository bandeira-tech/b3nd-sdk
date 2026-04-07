/**
 * @module
 * Reaction registry for the Rig.
 *
 * Reactions fire on successful writes (send/receive) matching a URI pattern.
 * URI patterns use Express-style matching (see `matchPattern` in b3nd-core).
 *
 * Handlers are fire-and-forget — errors are caught and logged.
 *
 * Pure module — no Rig dependency, testable in isolation.
 */

import { matchPattern } from "../b3nd-core/match-pattern.ts";

// Re-export matchPattern from core — used by connections, clients, and the rig
export { matchPattern };

// ── Types ──

/** Reaction handler — called when a write matches the URI pattern. */
export type ReactionHandler = (
  uri: string,
  data: unknown,
  params: Record<string, string>,
) => void | Promise<void>;

interface ReactionEntry {
  /** The original pattern string. */
  pattern: string;
  /** Pre-split pattern segments for matching. */
  segments: string[];
  /** The handler to call on match. */
  handler: ReactionHandler;
}

// ── Registry ──

/**
 * Registry of URI-pattern-matched reaction handlers.
 *
 * Handlers fire asynchronously on `match()`. Errors are caught
 * and logged to console.warn, never propagated.
 */
export class ReactionRegistry {
  private entries: ReactionEntry[] = [];

  /**
   * Register a reaction handler for a URI pattern.
   * Returns an unsubscribe function.
   */
  add(pattern: string, handler: ReactionHandler): () => void {
    const entry: ReactionEntry = {
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
              `[rig] reaction handler error on "${entry.pattern}":`,
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

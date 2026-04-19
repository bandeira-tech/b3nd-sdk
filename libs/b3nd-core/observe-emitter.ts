/**
 * @module
 * ObserveEmitter — the shared listener + async-iterator machinery used by
 * clients (SimpleClient, MessageDataClient) to expose `observe()`.
 *
 * Observe is a client concern. Clients orchestrate writes and deletes —
 * they know when state changes. Stores are mechanical and should not
 * carry observe responsibility.
 *
 * Events:
 *   - write  → `_emit(uri, data)`
 *   - delete → `_emit(uri, null)` (via `_emitDeletes([uri, ...])`)
 *
 * Listeners receive every URI change; the async iterator filters by
 * pattern before yielding.
 */
import { matchPattern } from "./match-pattern.ts";
import type { ReadResult } from "./types.ts";

export type ObserveListener = (uri: string, data: unknown) => void;

/**
 * Base class providing a write/delete listener bus and an async iterator
 * for observing URI-pattern changes.
 *
 * Subclasses call `_emit(uri, data)` on successful writes and
 * `_emitDeletes(uris)` on successful deletes. `observe(pattern, signal)`
 * is a plug-and-play `NodeProtocolInterface.observe` implementation.
 */
export class ObserveEmitter {
  private _listeners = new Set<ObserveListener>();

  /** Notify all listeners of a URI change. */
  protected _emit(uri: string, data: unknown): void {
    for (const listener of this._listeners) {
      try {
        listener(uri, data);
      } catch {
        // Listener errors must never break the emitter.
      }
    }
  }

  /** Notify all listeners that each URI was deleted (data = null). */
  protected _emitDeletes(uris: readonly string[]): void {
    for (const uri of uris) this._emit(uri, null);
  }

  /**
   * Async iterator yielding `ReadResult` for each URI change matching
   * the pattern. Runs until `signal` aborts.
   *
   * Deletes surface as `{ success: true, uri, record: { data: null, values: {} } }`.
   */
  async *observe<T = unknown>(
    pattern: string,
    signal: AbortSignal,
  ): AsyncIterable<ReadResult<T>> {
    const segments = pattern.split("/");

    while (!signal.aborted) {
      const result = await new Promise<ReadResult<T> | null>((resolve) => {
        const onAbort = () => {
          cleanup();
          resolve(null);
        };

        const listener: ObserveListener = (uri, data) => {
          if (matchPattern(segments, uri) !== null) {
            cleanup();
            resolve({
              success: true,
              uri,
              record: { data: data as T, values: {} },
            });
          }
        };

        const cleanup = () => {
          this._listeners.delete(listener);
          signal.removeEventListener("abort", onAbort);
        };

        signal.addEventListener("abort", onAbort, { once: true });
        this._listeners.add(listener);
      });

      if (result === null) break;
      yield result;
    }
  }
}

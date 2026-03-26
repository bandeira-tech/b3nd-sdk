/**
 * @module
 * In-process subscription bus for server-side change notifications.
 *
 * The bus connects the receive handler to SSE subscribers: when a write
 * succeeds, `notify(uri, data, ts)` fans out to all listeners whose
 * prefix matches the URI.
 *
 * Pure module — no server framework dependency.
 */

/** Payload delivered to subscribers. */
export interface BusEvent {
  uri: string;
  data: unknown;
  ts: number;
}

type BusHandler = (event: BusEvent) => void;

/**
 * In-process pub/sub for URI-based change notifications.
 *
 * Subscribers register a URI prefix; any `notify()` call whose URI
 * starts with that prefix triggers the handler synchronously.
 *
 * @example
 * ```ts
 * const bus = new SubscriptionBus();
 *
 * const unsub = bus.subscribe("mutable://data/market", (event) => {
 *   console.log(`Change at ${event.uri}:`, event.data);
 * });
 *
 * bus.notify("mutable://data/market/X/msg123", { price: 42 }, Date.now());
 * // handler fires
 *
 * bus.notify("mutable://other/path", {}, Date.now());
 * // handler does NOT fire (prefix doesn't match)
 *
 * unsub();
 * ```
 */
export class SubscriptionBus {
  private listeners = new Map<string, Set<BusHandler>>();

  /**
   * Notify all subscribers whose prefix matches the URI.
   * Called by the receive handler after a successful write.
   */
  notify(uri: string, data: unknown, ts: number): void {
    const event: BusEvent = { uri, data, ts };
    for (const [prefix, handlers] of this.listeners) {
      if (uri.startsWith(prefix) || prefix === "*") {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch (err) {
            console.warn(
              `[subscription-bus] handler error for "${prefix}":`,
              err,
            );
          }
        }
      }
    }
  }

  /**
   * Subscribe to URI changes at a prefix.
   * Returns an unsubscribe function.
   */
  subscribe(prefix: string, handler: BusHandler): () => void {
    if (!this.listeners.has(prefix)) {
      this.listeners.set(prefix, new Set());
    }
    this.listeners.get(prefix)!.add(handler);

    return () => {
      const set = this.listeners.get(prefix);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this.listeners.delete(prefix);
      }
    };
  }

  /** Number of active prefix subscriptions. */
  get size(): number {
    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }
}

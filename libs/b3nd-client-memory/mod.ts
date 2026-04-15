/**
 * Memory backend for b3nd.
 *
 * In-memory Store implementation. No executor needed.
 */

export { MemoryStore } from "./store.ts";

/**
 * Create a permissive test schema that accepts all common URI patterns.
 */
export function createTestSchema(): Record<string, () => Promise<{ valid: boolean }>> {
  const acceptAll = async () => ({ valid: true });
  return {
    "mutable://accounts": acceptAll,
    "mutable://open": acceptAll,
    "mutable://data": acceptAll,
    "immutable://accounts": acceptAll,
    "immutable://open": acceptAll,
    "immutable://data": acceptAll,
  };
}

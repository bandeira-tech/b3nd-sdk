/**
 * @module
 * Built-in processors for common processing patterns
 */

import type { Processor, Transaction } from "./types.ts";

/**
 * Emit processor
 * Calls a callback function with the transaction (for events, logging, etc.)
 *
 * @example
 * ```typescript
 * const process = emit(async (tx) => {
 *   await webhookService.notify(tx)
 * })
 * ```
 */
export function emit<D = unknown>(
  callback: (tx: Transaction<D>) => Promise<void> | void,
): Processor<D> {
  return async (tx) => {
    try {
      await callback(tx);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Conditional processor
 * Only processes if the condition is met
 *
 * @example
 * ```typescript
 * const process = when(
 *   (tx) => tx[0].startsWith("mutable://important/"),
 *   parallel(postgresClient)
 * )
 * ```
 */
export function when<D = unknown>(
  condition: (tx: Transaction<D>) => boolean | Promise<boolean>,
  processor: Processor<D>,
): Processor<D> {
  return async (tx) => {
    const shouldProcess = await condition(tx);
    if (shouldProcess) {
      return processor(tx);
    }
    return { success: true }; // Skip silently
  };
}

/**
 * Log processor
 * Logs the transaction (for debugging)
 *
 * @example
 * ```typescript
 * const process = pipeline(
 *   log("Received transaction"),
 *   parallel(postgresClient)
 * )
 * ```
 */
export function log<D = unknown>(prefix = "tx"): Processor<D> {
  // deno-lint-ignore require-await
  return async (tx) => {
    const [uri] = tx;
    console.log(`[${prefix}] ${uri}`);
    return { success: true };
  };
}

/**
 * Noop processor
 * Does nothing, always succeeds
 *
 * @example
 * ```typescript
 * const process = when(
 *   (tx) => tx[0].startsWith("mutable://temp/"),
 *   noop() // Don't persist temporary data
 * )
 * ```
 */
export function noop<D = unknown>(): Processor<D> {
  // deno-lint-ignore require-await
  return async () => ({ success: true });
}

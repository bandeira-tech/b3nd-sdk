/**
 * @module
 * Built-in processors for common processing patterns
 */

import type { Message, Processor } from "./types.ts";

/**
 * Emit processor
 * Calls a callback function with the message (for events, logging, etc.)
 *
 * @example
 * ```typescript
 * const process = emit(async (msg) => {
 *   await webhookService.notify(msg)
 * })
 * ```
 */
export function emit<D = unknown>(
  callback: (msg: Message<D>) => Promise<void> | void,
): Processor<D> {
  return async (msg) => {
    try {
      await callback(msg);
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
 *   (msg) => msg[0].startsWith("mutable://important/"),
 *   parallel(postgresClient)
 * )
 * ```
 */
export function when<D = unknown>(
  condition: (msg: Message<D>) => boolean | Promise<boolean>,
  processor: Processor<D>,
): Processor<D> {
  return async (msg) => {
    const shouldProcess = await condition(msg);
    if (shouldProcess) {
      return processor(msg);
    }
    return { success: true }; // Skip silently
  };
}

/**
 * Log processor
 * Logs the message (for debugging)
 *
 * @example
 * ```typescript
 * const process = pipeline(
 *   log("Received message"),
 *   parallel(postgresClient)
 * )
 * ```
 */
export function log<D = unknown>(prefix = "msg"): Processor<D> {
  // deno-lint-ignore require-await
  return async (msg) => {
    const [uri] = msg;
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
 *   (msg) => msg[0].startsWith("mutable://temp/"),
 *   noop() // Don't persist temporary data
 * )
 * ```
 */
export function noop<D = unknown>(): Processor<D> {
  // deno-lint-ignore require-await
  return async () => ({ success: true });
}

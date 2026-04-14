/**
 * @module
 * Built-in processors for common processing patterns
 *
 * @deprecated Use CodeHandler from b3nd-core instead.
 */

import type { Message } from "../b3nd-core/types.ts";
import type { Processor } from "./types.ts";

/**
 * Emit processor
 * Calls a callback function with the message
 *
 * @deprecated Use CodeHandler from b3nd-core instead.
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
 * @deprecated
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
    return { success: true };
  };
}

/**
 * Log processor
 * Logs the message URI
 *
 * @deprecated
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
 * @deprecated
 */
export function noop<D = unknown>(): Processor<D> {
  // deno-lint-ignore require-await
  return async () => ({ success: true });
}

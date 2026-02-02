/**
 * @module
 * Built-in processors for common processing patterns
 */

import type { Node, Processor, Transaction } from "./types.ts";

/**
 * Store processor
 * Persists the transaction to a storage backend
 *
 * The backend must implement a receive method (or be a Node).
 *
 * @example
 * ```typescript
 * const process = store(postgresClient)
 * ```
 */
export function store<D = unknown>(
  backend: Node | { receive: Node["receive"] }
): Processor<D> {
  return async (tx) => {
    const result = await backend.receive(tx);
    return {
      success: result.accepted,
      error: result.error,
    };
  };
}

/**
 * Forward processor
 * Forwards the transaction to another node
 *
 * @example
 * ```typescript
 * const process = forward(replicaNode)
 * ```
 */
export function forward<D = unknown>(node: Node): Processor<D> {
  return async (tx) => {
    const result = await node.receive(tx);
    return {
      success: result.accepted,
      error: result.error,
    };
  };
}

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
  callback: (tx: Transaction<D>) => Promise<void> | void
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
 *   store(postgresClient)
 * )
 * ```
 */
export function when<D = unknown>(
  condition: (tx: Transaction<D>) => boolean | Promise<boolean>,
  processor: Processor<D>
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
 *   store(postgresClient)
 * )
 * ```
 */
export function log<D = unknown>(prefix = "tx"): Processor<D> {
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
  return async () => ({ success: true });
}

/**
 * @module
 * Composition utilities for validators and processors
 *
 * Build complex validation and processing pipelines from simple primitives.
 */

import type { ReadResult, ReceiveResult, Transaction } from "../types.ts";
import type { Processor, ReadInterface, Validator } from "./types.ts";

/**
 * Sequential validator composition
 * Runs validators in order, stops at first failure
 *
 * @example
 * ```typescript
 * const validate = seq(
 *   uriPattern(/^mutable:\/\//),
 *   requireFields(["data"]),
 *   schema(SCHEMA)
 * )
 * ```
 */
export function seq<D = unknown>(...validators: Validator<D>[]): Validator<D> {
  return async (tx, read) => {
    for (const validator of validators) {
      const result = await validator(tx, read);
      if (!result.valid) {
        return result;
      }
    }
    return { valid: true };
  };
}

/**
 * Any-match validator composition
 * First validator to pass wins, returns error only if all fail
 *
 * @example
 * ```typescript
 * const validate = any(
 *   uriPattern(/^mutable:\/\/open\//),  // Public writes
 *   signatureValid(),                    // Authenticated writes
 * )
 * ```
 */
export function any<D = unknown>(...validators: Validator<D>[]): Validator<D> {
  return async (tx, read) => {
    const errors: string[] = [];

    for (const validator of validators) {
      const result = await validator(tx, read);
      if (result.valid) {
        return { valid: true };
      }
      if (result.error) {
        errors.push(result.error);
      }
    }

    return {
      valid: false,
      error: errors.length > 0 ? errors.join("; ") : "All validators failed",
    };
  };
}

/**
 * Parallel validator composition
 * All validators must pass (runs in parallel)
 *
 * @example
 * ```typescript
 * const validate = all(
 *   uriPattern(/^mutable:\/\//),
 *   signatureValid(),
 *   balanceCheck()
 * )
 * ```
 */
export function all<D = unknown>(...validators: Validator<D>[]): Validator<D> {
  return async (tx, read) => {
    const results = await Promise.all(
      validators.map((v) => v(tx, read))
    );

    const failures = results.filter((r) => !r.valid);
    if (failures.length > 0) {
      const errors = failures
        .map((f) => f.error)
        .filter(Boolean)
        .join("; ");
      return {
        valid: false,
        error: errors || "Validation failed",
      };
    }

    return { valid: true };
  };
}

/**
 * A receiver is anything with a `receive` method (clients, nodes, etc.)
 */
type Receiver = { receive<D = unknown>(tx: Transaction<D>): Promise<ReceiveResult> };

/**
 * Accepts a Processor function or a receiver (client/node).
 * Receivers are automatically adapted — their `receive` method is called
 * and `accepted` is mapped to `success`.
 */
type ProcessorOrReceiver<D = unknown> = Processor<D> | Receiver;

function isReceiver(item: unknown): item is Receiver {
  return typeof item === "object" && item !== null && "receive" in item && typeof (item as Receiver).receive === "function";
}

function toProcessor<D>(item: ProcessorOrReceiver<D>): Processor<D> {
  if (isReceiver(item)) {
    return async (tx) => {
      const result = await item.receive(tx);
      return { success: result.accepted, error: result.error };
    };
  }
  return item as Processor<D>;
}

/**
 * Parallel processor composition
 * Run processors/receivers in parallel, at least one must succeed
 *
 * Accepts Processor functions or receivers (anything with a `receive` method).
 * Receivers are automatically adapted.
 *
 * @example
 * ```typescript
 * // Pass clients directly — no wrapping needed
 * const process = parallel(postgresClient, replicaClient)
 *
 * // Mix with custom processors
 * const process = parallel(
 *   postgresClient,
 *   emit(webhookCallback)
 * )
 * ```
 */
export function parallel<D = unknown>(...items: ProcessorOrReceiver<D>[]): Processor<D> {
  const processors = items.map(toProcessor);

  return async (tx) => {
    const results = await Promise.allSettled(
      processors.map((p) => p(tx))
    );

    const successes = results.filter(
      (r) => r.status === "fulfilled" && r.value.success
    );

    if (successes.length === 0) {
      const errors = results
        .map((r, i) => {
          if (r.status === "rejected") {
            return `[${i}]: ${r.reason}`;
          }
          if (r.status === "fulfilled" && !r.value.success) {
            return `[${i}]: ${r.value.error || "failed"}`;
          }
          return null;
        })
        .filter(Boolean)
        .join("; ");

      return {
        success: false,
        error: errors || "All failed",
      };
    }

    return { success: true };
  };
}

/**
 * Pipeline processor composition
 * Run processors in sequence, all must succeed
 *
 * @example
 * ```typescript
 * const process = pipeline(
 *   log("received"),
 *   emit(webhookCallback)
 * )
 * ```
 */
export function pipeline<D = unknown>(...processors: Processor<D>[]): Processor<D> {
  return async (tx) => {
    for (const processor of processors) {
      const result = await processor(tx);
      if (!result.success) {
        return result;
      }
    }
    return { success: true };
  };
}

/**
 * First-match reader composition
 * Try readers until one succeeds
 *
 * @example
 * ```typescript
 * const read = firstMatch(
 *   cacheClient,
 *   postgresClient,
 *   remoteClient
 * )
 * ```
 */
export function firstMatch(...readers: ReadInterface[]): ReadInterface {
  return {
    async read<T>(uri: string): Promise<ReadResult<T>> {
      for (const reader of readers) {
        const result = await reader.read<T>(uri);
        if (result.success) {
          return result;
        }
      }
      return { success: false, error: "Not found in any reader" };
    },

    async readMulti<T>(uris: string[]) {
      // For simplicity, use first reader that has any results
      for (const reader of readers) {
        const result = await reader.readMulti<T>(uris);
        if (result.success && result.summary.succeeded > 0) {
          return result;
        }
      }
      // Fall back to first reader's response
      if (readers.length > 0) {
        return readers[0].readMulti<T>(uris);
      }
      return {
        success: false,
        results: [],
        summary: { total: uris.length, succeeded: 0, failed: uris.length },
      };
    },

    async list(uri, options) {
      for (const reader of readers) {
        const result = await reader.list(uri, options);
        if (result.success) {
          return result;
        }
      }
      return { success: false, error: "Not found in any reader" };
    },
  };
}

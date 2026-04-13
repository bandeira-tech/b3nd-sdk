/**
 * @module
 * Composition utilities for validators and processors
 *
 * Build complex validation and processing pipelines from simple primitives.
 */

import type {
  Message,
  Output,
  ReadResult,
  ReceiveResult,
  Validator,
} from "../b3nd-core/types.ts";
import type { Processor, ReadInterface } from "./types.ts";

/**
 * Sequential validator composition
 * Runs validators in order, stops at first failure
 */
export function seq<T = unknown>(...validators: Validator<T>[]): Validator<T> {
  return async (output, upstream, read) => {
    for (const validator of validators) {
      const result = await validator(output, upstream, read);
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
 */
export function any<T = unknown>(...validators: Validator<T>[]): Validator<T> {
  return async (output, upstream, read) => {
    const errors: string[] = [];

    for (const validator of validators) {
      const result = await validator(output, upstream, read);
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
 */
export function all<T = unknown>(...validators: Validator<T>[]): Validator<T> {
  return async (output, upstream, read) => {
    const results = await Promise.all(
      validators.map((v) => v(output, upstream, read)),
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
 * A receiver is anything with a batch `receive` method (clients, nodes, etc.)
 */
type Receiver = {
  receive(msgs: Message[]): Promise<ReceiveResult[]>;
};

/**
 * @deprecated Use NodeProtocolInterface.receive() directly.
 */
type ProcessorOrReceiver<D = unknown> = Processor<D> | Receiver;

function isReceiver(item: unknown): item is Receiver {
  return typeof item === "object" && item !== null && "receive" in item &&
    typeof (item as Receiver).receive === "function";
}

function toProcessor<D>(item: ProcessorOrReceiver<D>): Processor<D> {
  if (isReceiver(item)) {
    return async (msg) => {
      const results = await item.receive([msg]);
      const result = results[0];
      return { success: result?.accepted ?? false, error: result?.error };
    };
  }
  return item as Processor<D>;
}

/**
 * Parallel processor composition
 * Run processors/receivers in parallel, at least one must succeed
 *
 * @deprecated Use parallelBroadcast from b3nd-combinators instead.
 */
export function parallel<D = unknown>(
  ...items: ProcessorOrReceiver<D>[]
): Processor<D> {
  const processors = items.map(toProcessor);

  return async (msg) => {
    const results = await Promise.allSettled(
      processors.map((p) => p(msg)),
    );

    const successes = results.filter(
      (r) => r.status === "fulfilled" && r.value.success,
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
 * @deprecated Use createValidatedClient with sequential logic instead.
 */
export function pipeline<D = unknown>(
  ...processors: Processor<D>[]
): Processor<D> {
  return async (msg) => {
    for (const processor of processors) {
      const result = await processor(msg);
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
 * @deprecated Use firstMatchSequence from b3nd-combinators instead.
 */
export function firstMatch(...readers: ReadInterface[]): ReadInterface {
  return {
    async read<T>(uris: string | string[]): Promise<ReadResult<T>[]> {
      const uriList = Array.isArray(uris) ? uris : [uris];
      const allResults: ReadResult<T>[] = [];

      for (const uri of uriList) {
        let found = false;
        for (const reader of readers) {
          const results = await reader.read<T>(uri);
          if (results.length > 0 && results.some((r) => r.success)) {
            allResults.push(...results);
            found = true;
            break;
          }
        }
        if (!found) {
          allResults.push({ success: false, error: "Not found in any reader" });
        }
      }

      return allResults;
    },
  };
}

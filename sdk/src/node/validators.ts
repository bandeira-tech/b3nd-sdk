/**
 * @module
 * Built-in validators for common validation patterns
 */

import type { Schema } from "../types.ts";
import type { Transaction, Validator } from "./types.ts";
import { isTransactionData } from "../../txn-data/detect.ts";

/**
 * Format validator
 * Validates the structure of transaction data using a check function
 *
 * @example
 * ```typescript
 * const validate = format((tx) => {
 *   const [uri, data] = tx
 *   return typeof data === "object" && data !== null
 * })
 * ```
 */
export function format<D = unknown>(
  checkFn: (tx: Transaction<D>) => boolean | string
): Validator<D> {
  // deno-lint-ignore require-await
  return async (tx) => {
    const result = checkFn(tx);
    if (result === true) {
      return { valid: true };
    }
    return {
      valid: false,
      error: typeof result === "string" ? result : "Format validation failed",
    };
  };
}

/**
 * Schema validator
 * Per-program validation using the existing Schema type
 *
 * @example
 * ```typescript
 * const SCHEMA = {
 *   "mutable://users": async ({ uri, value }) => {
 *     if (!value?.name) return { valid: false, error: "name required" }
 *     return { valid: true }
 *   }
 * }
 *
 * const validate = schema(SCHEMA)
 * ```
 */
export function schema<D = unknown>(programSchema: Schema): Validator<D> {
  // deno-lint-ignore require-await
  return async (tx, read) => {
    const [uri, data] = tx;

    // Parse the URI to get the program key
    const url = URL.parse(uri);
    if (!url) {
      return { valid: false, error: "Invalid URI format" };
    }

    const program = `${url.protocol}//${url.hostname}`;
    const validator = programSchema[program];

    if (!validator) {
      return { valid: false, error: `Unknown program: ${program}` };
    }

    return validator({ uri, value: data, read });
  };
}

/**
 * URI pattern validator
 * Validates that the transaction URI matches a regex pattern
 *
 * @example
 * ```typescript
 * const validate = uriPattern(/^mutable:\/\/users\/[a-z0-9-]+\/profile$/)
 * ```
 */
export function uriPattern(pattern: RegExp): Validator {
  // deno-lint-ignore require-await
  return async (tx) => {
    const [uri] = tx;
    if (pattern.test(uri)) {
      return { valid: true };
    }
    return {
      valid: false,
      error: `URI does not match pattern: ${pattern}`,
    };
  };
}

/**
 * Require fields validator
 * Validates that the transaction data contains specific fields
 *
 * @example
 * ```typescript
 * const validate = requireFields(["name", "email"])
 * ```
 */
export function requireFields(fields: string[]): Validator {
  // deno-lint-ignore require-await
  return async (tx) => {
    const [, data] = tx;

    if (typeof data !== "object" || data === null) {
      return { valid: false, error: "Data must be an object" };
    }

    const missing = fields.filter(
      (field) => !(field in (data as Record<string, unknown>))
    );

    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing required fields: ${missing.join(", ")}`,
      };
    }

    return { valid: true };
  };
}

/**
 * Pass-through validator
 * Always accepts the transaction (useful for open/public programs)
 *
 * @example
 * ```typescript
 * const validate = any(
 *   uriPattern(/^mutable:\/\/open\//),
 *   accept()
 * )
 * ```
 */
export function accept(): Validator {
  // deno-lint-ignore require-await
  return async () => ({ valid: true });
}

/**
 * Transaction schema validator
 * Routes validation based on data shape:
 * - If data IS TransactionData: validates the envelope URI AND each output against schema
 * - If data is NOT TransactionData: validates as a plain transaction against schema
 *
 * This is a complete validator that replaces `any(schema(), ...)` for nodes
 * that need to handle both plain transactions and TransactionData envelopes.
 *
 * @example
 * ```typescript
 * const validate = txnSchema(SCHEMA)
 * // Handles both plain writes and TransactionData envelopes
 * ```
 */
export function txnSchema<D = unknown>(programSchema: Schema): Validator<D> {
  const plainValidator = schema<D>(programSchema);

  return async (tx, read) => {
    const [uri, data] = tx;

    if (!isTransactionData(data)) {
      return plainValidator(tx, read);
    }

    // Validate the envelope URI against schema
    const envelopeUrl = URL.parse(uri);
    if (!envelopeUrl) {
      return { valid: false, error: "Invalid envelope URI format" };
    }

    const envelopeProgram = `${envelopeUrl.protocol}//${envelopeUrl.hostname}`;
    const envelopeValidator = programSchema[envelopeProgram];

    if (!envelopeValidator) {
      return { valid: false, error: `Unknown program: ${envelopeProgram}` };
    }

    const envelopeResult = await envelopeValidator({ uri, value: data, read });
    if (!envelopeResult.valid) {
      return {
        valid: false,
        error: envelopeResult.error || `Envelope validation failed`,
      };
    }

    // Validate each output against its program validator
    for (const [outputUri, outputValue] of data.outputs) {
      const url = URL.parse(outputUri);
      if (!url) {
        return { valid: false, error: `Invalid output URI: ${outputUri}` };
      }

      const program = `${url.protocol}//${url.hostname}`;
      const validator = programSchema[program];

      if (!validator) {
        return { valid: false, error: `Unknown program: ${program}` };
      }

      const result = await validator({ uri: outputUri, value: outputValue, read });
      if (!result.valid) {
        return {
          valid: false,
          error: result.error || `Validation failed for output: ${outputUri}`,
        };
      }
    }

    return { valid: true };
  };
}

/**
 * Reject validator
 * Always rejects the transaction with an optional message
 *
 * @example
 * ```typescript
 * const validate = reject("This program is disabled")
 * ```
 */
export function reject(message = "Rejected"): Validator {
  // deno-lint-ignore require-await
  return async () => ({ valid: false, error: message });
}

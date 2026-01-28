/**
 * Validator utilities for the inputs/outputs convention
 */

import type { TransactionValidator } from "../txn/types.ts";
import type {
  TransactionData,
  ProgramSchema,
  TransactionValidationContext,
} from "./types.ts";

/**
 * Extract the program prefix from a URI
 *
 * @example
 * ```typescript
 * extractProgram("immutable://blob/abc123")
 * // => "immutable://blob"
 *
 * extractProgram("mutable://accounts/alice/profile")
 * // => "mutable://accounts"
 * ```
 */
export function extractProgram(uri: string): string | null {
  const url = URL.parse(uri);
  if (!url) return null;
  return `${url.protocol}//${url.hostname}`;
}

/**
 * Create a transaction validator that validates outputs against a program schema
 *
 * This validator:
 * 1. Runs your custom pre-validator (signature checks, etc.)
 * 2. Validates each output against its program validator (if defined)
 *
 * @param options - Validator options
 * @param options.schema - Program schema mapping prefixes to validators
 * @param options.preValidate - Optional pre-validation (signature, format, etc.)
 *
 * @example
 * ```typescript
 * import { createOutputValidator } from "b3nd/txn-data"
 *
 * const validator = createOutputValidator({
 *   schema: {
 *     "immutable://blob": async (ctx) => {
 *       const fee = ctx.outputs.find(([uri]) => uri.startsWith("fees://"))
 *       if (!fee) return { valid: false, error: "fee_required" }
 *       return { valid: true }
 *     },
 *     "mutable://accounts": async (ctx) => {
 *       // Validate account writes
 *       return { valid: true }
 *     }
 *   },
 *   preValidate: async (tx, read) => {
 *     const [uri, data] = tx
 *     // Check signature, etc.
 *     return { valid: true }
 *   }
 * })
 *
 * const node = createTransactionNode({
 *   validate: validator,
 *   read: myReadInterface,
 *   peers: myPeers
 * })
 * ```
 */
export function createOutputValidator<V = unknown>(options: {
  schema: ProgramSchema<V>;
  preValidate?: TransactionValidator<TransactionData<V>>;
}): TransactionValidator<TransactionData<V>> {
  const { schema, preValidate } = options;

  return async (tx, read) => {
    const [uri, data] = tx;

    // 1. Pre-validation (signature, format, etc.)
    if (preValidate) {
      const preResult = await preValidate(tx, read);
      if (!preResult.valid) return preResult;
    }

    // 2. Validate data structure
    if (!data || typeof data !== "object") {
      return { valid: false, error: "Invalid transaction data" };
    }

    if (!Array.isArray(data.inputs)) {
      return { valid: false, error: "inputs must be an array" };
    }

    if (!Array.isArray(data.outputs)) {
      return { valid: false, error: "outputs must be an array" };
    }

    // 3. Validate each output against its program validator
    for (const [outputUri, outputValue] of data.outputs) {
      const program = extractProgram(outputUri);
      if (!program) {
        return { valid: false, error: `Invalid output URI: ${outputUri}` };
      }

      const programValidator = schema[program];
      if (programValidator) {
        const ctx: TransactionValidationContext<V> = {
          uri: outputUri,
          value: outputValue,
          inputs: data.inputs,
          outputs: data.outputs,
          read,
        };

        const result = await programValidator(ctx);
        if (!result.valid) {
          return {
            valid: false,
            error: `${program}: ${result.error || "validation failed"}`,
          };
        }
      }
    }

    return { valid: true };
  };
}

/**
 * Combine multiple validators into one (all must pass)
 *
 * @example
 * ```typescript
 * const validator = combineValidators(
 *   signatureValidator,
 *   balanceValidator,
 *   outputValidator
 * )
 * ```
 */
export function combineValidators<D>(
  ...validators: TransactionValidator<D>[]
): TransactionValidator<D> {
  return async (tx, read) => {
    for (const validator of validators) {
      const result = await validator(tx, read);
      if (!result.valid) return result;
    }
    return { valid: true };
  };
}

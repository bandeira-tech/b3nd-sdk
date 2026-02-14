/**
 * Validator utilities for the inputs/outputs convention
 */

import type { MessageValidator } from "../node-types.ts";
import type {
  MessageData,
  MessageValidationContext,
  ProgramSchema,
} from "./types.ts";

/**
 * Extract the program prefix from a URI
 *
 * @example
 * ```typescript
 * extractProgram("immutable://open/abc123")
 * // => "immutable://open"
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
 * Create a message validator that validates outputs against a program schema
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
 * import { createOutputValidator } from "b3nd/msg-data"
 *
 * const validator = createOutputValidator({
 *   schema: {
 *     "immutable://open": async (ctx) => {
 *       const fee = ctx.outputs.find(([uri]) => uri.startsWith("fees://"))
 *       if (!fee) return { valid: false, error: "fee_required" }
 *       return { valid: true }
 *     },
 *     "mutable://accounts": async (ctx) => {
 *       // Validate account writes
 *       return { valid: true }
 *     }
 *   },
 *   preValidate: async (msg, read) => {
 *     const [uri, data] = msg
 *     // Check signature, etc.
 *     return { valid: true }
 *   }
 * })
 *
 * const node = createMessageNode({
 *   validate: validator,
 *   read: myReadInterface,
 *   peers: myPeers
 * })
 * ```
 */
export function createOutputValidator<V = unknown>(options: {
  schema: ProgramSchema<V>;
  preValidate?: MessageValidator<MessageData<V>>;
}): MessageValidator<MessageData<V>> {
  const { schema, preValidate } = options;

  return async (msg, read) => {
    const [uri, data] = msg;

    // 1. Pre-validation (signature, format, etc.)
    if (preValidate) {
      const preResult = await preValidate(msg, read);
      if (!preResult.valid) return preResult;
    }

    // 2. Validate data structure
    if (!data || typeof data !== "object") {
      return { valid: false, error: "Invalid message data" };
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
        const ctx: MessageValidationContext<V> = {
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
  ...validators: MessageValidator<D>[]
): MessageValidator<D> {
  return async (msg, read) => {
    for (const validator of validators) {
      const result = await validator(msg, read);
      if (!result.valid) return result;
    }
    return { valid: true };
  };
}

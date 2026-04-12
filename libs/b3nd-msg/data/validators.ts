/**
 * Validator utilities for the inputs/outputs convention
 *
 * @deprecated Use Program from b3nd-core and scoped sub-program routing instead.
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
 * Create a message validator that validates outputs against a program schema.
 *
 * @deprecated Use Program from b3nd-core with scoped sub-program routing instead.
 */
export function createOutputValidator(options: {
  schema: ProgramSchema;
  preValidate?: MessageValidator;
}): MessageValidator {
  const { schema, preValidate } = options;

  return async (msg, read) => {
    const [, , data] = msg;

    // 1. Pre-validation (signature, format, etc.)
    if (preValidate) {
      const preResult = await preValidate(msg, read);
      if (!preResult.valid) return preResult;
    }

    // 2. Validate data structure
    const msgData = data as MessageData | null;
    if (!msgData || typeof msgData !== "object") {
      return { valid: false, error: "Invalid message data" };
    }

    if (!Array.isArray(msgData.inputs)) {
      return { valid: false, error: "inputs must be an array" };
    }

    if (!Array.isArray(msgData.outputs)) {
      return { valid: false, error: "outputs must be an array" };
    }

    // 3. Validate each output against its program validator
    for (const output of msgData.outputs) {
      const [outputUri, outputValues, outputData] = output;
      const program = extractProgram(outputUri);
      if (!program) {
        return { valid: false, error: `Invalid output URI: ${outputUri}` };
      }

      const programValidator = schema[program];
      if (programValidator) {
        const ctx: MessageValidationContext = {
          uri: outputUri,
          values: outputValues,
          data: outputData,
          inputs: msgData.inputs,
          outputs: msgData.outputs,
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
 * @deprecated Use Program composition with scoped sub-program routing instead.
 */
export function combineValidators(
  ...validators: MessageValidator[]
): MessageValidator {
  return async (msg, read) => {
    for (const validator of validators) {
      const result = await validator(msg, read);
      if (!result.valid) return result;
    }
    return { valid: true };
  };
}

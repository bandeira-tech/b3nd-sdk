/**
 * @module
 * Built-in validators for common validation patterns
 *
 * All validators use the canonical Validator signature:
 *   (output, upstream, read) => Promise<ValidationResult>
 */

import type { Output, Schema, Validator, ValidationResult, ReadFn } from "../b3nd-core/types.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";
import { verifyHashContent } from "../b3nd-hash/mod.ts";

/**
 * Extract the program prefix from a URI.
 *
 * @example
 * ```typescript
 * extractProgram("mutable://users/alice") // => "mutable://users"
 * extractProgram("hash://sha256/abc...")   // => "hash://sha256"
 * ```
 */
export function extractProgram(uri: string): string | null {
  const url = URL.parse(uri);
  if (!url) return null;
  return `${url.protocol}//${url.hostname}`;
}

/**
 * Format validator
 * Validates the structure of output data using a check function
 *
 * @example
 * ```typescript
 * const validate = format((output) => {
 *   const [uri, data] = output
 *   return typeof data === "object" && data !== null
 * })
 * ```
 */
export function format<T = unknown>(
  checkFn: (output: Output<T>) => boolean | string,
): Validator<T> {
  // deno-lint-ignore require-await
  return async (output) => {
    const result = checkFn(output);
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
 * Schema dispatch — routes validation by program key
 *
 * For plain writes: `validator(output, undefined, read)`
 *
 * @example
 * ```typescript
 * const SCHEMA = {
 *   "mutable://users": async ([uri, value], upstream, read) => {
 *     if (!value?.name) return { valid: false, error: "name required" }
 *     return { valid: true }
 *   }
 * }
 *
 * const validate = schema(SCHEMA)
 * ```
 */
export function schema(programSchema: Schema): Validator {
  return async (output, upstream, read) => {
    const [uri, data] = output;

    // Enforce content hash integrity (structural, not policy)
    const hashCheck = await enforceContentHash(uri, data);
    if (!hashCheck.valid) return hashCheck;

    const program = extractProgram(uri);
    if (!program) {
      return { valid: false, error: "Invalid URI format" };
    }

    const validator = programSchema[program];
    if (!validator) {
      return { valid: false, error: `Unknown program: ${program}` };
    }

    return validator(output, upstream, read);
  };
}

/**
 * URI pattern validator
 * Validates that the output URI matches a regex pattern
 *
 * @example
 * ```typescript
 * const validate = uriPattern(/^mutable:\/\/users\/[a-z0-9-]+\/profile$/)
 * ```
 */
export function uriPattern(pattern: RegExp): Validator {
  // deno-lint-ignore require-await
  return async (output) => {
    const [uri] = output;
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
 * Validates that the output data contains specific fields
 *
 * @example
 * ```typescript
 * const validate = requireFields(["name", "email"])
 * ```
 */
export function requireFields(fields: string[]): Validator {
  // deno-lint-ignore require-await
  return async (output) => {
    const [, data] = output;

    if (typeof data !== "object" || data === null) {
      return { valid: false, error: "Data must be an object" };
    }

    const missing = fields.filter(
      (field) => !(field in (data as Record<string, unknown>)),
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
 * Built-in content-hash enforcement.
 * If the URI uses the hash:// scheme, verifies content matches the digest.
 * This is a structural property of the scheme, not a per-schema policy.
 */
async function enforceContentHash(
  uri: string,
  value: unknown,
): Promise<ValidationResult> {
  const url = URL.parse(uri);
  if (!url || url.protocol !== "hash:") {
    return { valid: true };
  }
  const result = await verifyHashContent(uri, value);
  return { valid: result.valid, error: result.error };
}

/**
 * Pass-through validator
 * Always accepts the output (useful for open/public programs)
 *
 * @example
 * ```typescript
 * const SCHEMA = {
 *   "mutable://open": accept()
 * }
 * ```
 */
export function accept(): Validator {
  // deno-lint-ignore require-await
  return async () => ({ valid: true });
}

/**
 * Message schema validator — envelope cascading
 *
 * Routes validation based on data shape:
 * - If data IS MessageData: validates envelope, then each output with envelope as upstream
 * - If data is NOT MessageData: validates as a plain output via schema()
 *
 * Protocols choose to use this when they want cascading validation over
 * message payloads. This is NOT automatic at the b3nd level.
 *
 * @example
 * ```typescript
 * const validate = msgSchema(SCHEMA)
 * // Handles both plain writes and MessageData envelopes
 * ```
 */
export function msgSchema(programSchema: Schema): Validator {
  const plainDispatch = schema(programSchema);

  return async (output, upstream, read) => {
    const [uri, data] = output;

    if (!isMessageData(data)) {
      return plainDispatch(output, upstream, read);
    }

    // Validate the envelope itself against its program validator
    const envelopeProgram = extractProgram(uri);
    if (!envelopeProgram) {
      return { valid: false, error: "Invalid envelope URI format" };
    }

    const envelopeValidator = programSchema[envelopeProgram];
    if (!envelopeValidator) {
      return { valid: false, error: `Unknown program: ${envelopeProgram}` };
    }

    const envelopeResult = await envelopeValidator(output, upstream, read);
    if (!envelopeResult.valid) {
      return {
        valid: false,
        error: envelopeResult.error || `Envelope validation failed`,
      };
    }

    // Cascade: validate each inner output with this envelope as upstream
    for (const inner of data.payload.outputs) {
      const [outputUri, outputValue] = inner;

      // Enforce content hash integrity on outputs (structural, not policy)
      const hashCheck = await enforceContentHash(outputUri, outputValue);
      if (!hashCheck.valid) {
        return {
          valid: false,
          error: hashCheck.error || `Content hash verification failed: ${outputUri}`,
        };
      }

      const program = extractProgram(outputUri);
      if (!program) {
        return { valid: false, error: `Invalid output URI: ${outputUri}` };
      }

      const validator = programSchema[program];
      if (!validator) {
        return { valid: false, error: `Unknown program: ${program}` };
      }

      const result = await validator(inner, output, read);
      //                              ↑      ↑
      //                         inner out  envelope is upstream
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
 * Always rejects with an optional message
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

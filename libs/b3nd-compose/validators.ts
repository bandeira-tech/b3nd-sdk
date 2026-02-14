/**
 * @module
 * Built-in validators for common validation patterns
 */

import type { Schema } from "../b3nd-core/types.ts";
import type { Message, Validator } from "./types.ts";
import { isMessageData } from "../b3nd-msg/data/detect.ts";
import { verifyHashContent } from "../b3nd-hash/mod.ts";

/**
 * Format validator
 * Validates the structure of message data using a check function
 *
 * @example
 * ```typescript
 * const validate = format((msg) => {
 *   const [uri, data] = msg
 *   return typeof data === "object" && data !== null
 * })
 * ```
 */
export function format<D = unknown>(
  checkFn: (msg: Message<D>) => boolean | string,
): Validator<D> {
  // deno-lint-ignore require-await
  return async (msg) => {
    const result = checkFn(msg);
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
  return async (msg, read) => {
    const [uri, data] = msg;

    // Enforce content hash integrity (structural, not policy)
    const hashCheck = await enforceContentHash(uri, data);
    if (!hashCheck.valid) return hashCheck;

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
 * Validates that the message URI matches a regex pattern
 *
 * @example
 * ```typescript
 * const validate = uriPattern(/^mutable:\/\/users\/[a-z0-9-]+\/profile$/)
 * ```
 */
export function uriPattern(pattern: RegExp): Validator {
  // deno-lint-ignore require-await
  return async (msg) => {
    const [uri] = msg;
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
 * Validates that the message data contains specific fields
 *
 * @example
 * ```typescript
 * const validate = requireFields(["name", "email"])
 * ```
 */
export function requireFields(fields: string[]): Validator {
  // deno-lint-ignore require-await
  return async (msg) => {
    const [, data] = msg;

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
): Promise<{ valid: boolean; error?: string }> {
  const url = URL.parse(uri);
  if (!url || url.protocol !== "hash:") {
    return { valid: true };
  }
  const result = await verifyHashContent(uri, value);
  return { valid: result.valid, error: result.error };
}

/**
 * Pass-through validator
 * Always accepts the message (useful for open/public programs)
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
 * Message schema validator
 * Routes validation based on data shape:
 * - If data IS MessageData: validates the envelope URI AND each output against schema
 * - If data is NOT MessageData: validates as a plain message against schema
 *
 * This is a complete validator that replaces `any(schema(), ...)` for nodes
 * that need to handle both plain messages and MessageData envelopes.
 *
 * @example
 * ```typescript
 * const validate = msgSchema(SCHEMA)
 * // Handles both plain writes and MessageData envelopes
 * ```
 */
export function msgSchema<D = unknown>(programSchema: Schema): Validator<D> {
  const plainValidator = schema<D>(programSchema);

  return async (msg, read) => {
    const [uri, data] = msg;

    if (!isMessageData(data)) {
      return plainValidator(msg, read);
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
      // Enforce content hash integrity on outputs (structural, not policy)
      const hashCheck = await enforceContentHash(outputUri, outputValue);
      if (!hashCheck.valid) {
        return {
          valid: false,
          error: hashCheck.error || `Content hash verification failed: ${outputUri}`,
        };
      }

      const url = URL.parse(outputUri);
      if (!url) {
        return { valid: false, error: `Invalid output URI: ${outputUri}` };
      }

      const program = `${url.protocol}//${url.hostname}`;
      const validator = programSchema[program];

      if (!validator) {
        return { valid: false, error: `Unknown program: ${program}` };
      }

      const result = await validator({
        uri: outputUri,
        value: outputValue,
        read,
      });
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

/** @deprecated Use `msgSchema` instead */
export const txnSchema = msgSchema;

/**
 * Reject validator
 * Always rejects the message with an optional message
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

/**
 * @module
 * Error classification helpers for b3nd operations.
 *
 * Helps app developers decide whether to retry failed operations.
 *
 * @example
 * ```typescript
 * import { isTransientError, isAuthError } from "@b3nd/rig";
 *
 * const result = await rig.read("mutable://open/key");
 * if (!result.success && result.errorDetail) {
 *   if (isTransientError(result.errorDetail)) {
 *     // Safe to retry — network issue, storage hiccup
 *   } else if (isAuthError(result.errorDetail)) {
 *     // Don't retry — fix auth first
 *   }
 * }
 * ```
 */

import { type B3ndError, ErrorCode } from "../b3nd-core/types.ts";

/** Error codes that indicate transient/retry-able failures. */
const TRANSIENT_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.STORAGE_ERROR,
  ErrorCode.INTERNAL_ERROR,
]);

/** Error codes that indicate authentication/authorization failures. */
const AUTH_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.UNAUTHORIZED,
  ErrorCode.FORBIDDEN,
]);

/** Error codes that indicate validation failures (bad input). */
const VALIDATION_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.INVALID_URI,
  ErrorCode.INVALID_SCHEMA,
  ErrorCode.INVALID_SEQUENCE,
]);

/**
 * Check if an error is transient and safe to retry.
 *
 * Transient errors include storage failures and internal errors —
 * these are typically caused by network issues, database hiccups,
 * or temporary server problems.
 */
export function isTransientError(error: B3ndError): boolean {
  return TRANSIENT_CODES.has(error.code);
}

/**
 * Check if an error is an authentication/authorization failure.
 *
 * Auth errors should NOT be retried — the caller needs to fix
 * their identity, permissions, or signing before trying again.
 */
export function isAuthError(error: B3ndError): boolean {
  return AUTH_CODES.has(error.code);
}

/**
 * Check if an error is a validation failure (bad input).
 *
 * Validation errors should NOT be retried with the same input —
 * the caller needs to fix the URI, data, or sequence number.
 */
export function isValidationError(error: B3ndError): boolean {
  return VALIDATION_CODES.has(error.code);
}

/**
 * Check if an error indicates that the resource was not found.
 */
export function isNotFoundError(error: B3ndError): boolean {
  return error.code === ErrorCode.NOT_FOUND;
}

/**
 * Check if an error indicates a conflict (e.g., concurrent writes).
 */
export function isConflictError(error: B3ndError): boolean {
  return error.code === ErrorCode.CONFLICT;
}

/**
 * Classify an error into a category for error handling.
 */
export function classifyError(
  error: B3ndError,
): "transient" | "auth" | "validation" | "not_found" | "conflict" {
  if (isTransientError(error)) return "transient";
  if (isAuthError(error)) return "auth";
  if (isValidationError(error)) return "validation";
  if (isNotFoundError(error)) return "not_found";
  return "conflict";
}

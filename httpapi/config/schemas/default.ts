/**
 * Default Schema Module
 *
 * Simple allow/deny rules for common URI patterns.
 * This is a TypeScript module that exports validation functions.
 *
 * The schema maps "protocol://domain" patterns to validation functions.
 * For example: "test://example" or "notes://nataliarsand"
 */

import type { PersistenceValidationFn } from "../../../persistence/mod.ts";

/**
 * Allow all writes
 */
const allow: PersistenceValidationFn<unknown> = async (_write) => {
  return true;
};

/**
 * Deny all writes
 */
const deny: PersistenceValidationFn<unknown> = async (_write) => {
  return false;
};

/**
 * Default schema export
 * Maps "protocol://domain" patterns to validation functions
 *
 * Note: The persistence layer will look up schema[`${protocol}://${domain}`]
 * For example, for URI "test://write-test/path", it looks for "test://write-test"
 */
const schema: Record<string, PersistenceValidationFn<unknown>> = {
  // Test protocol - used in e2e tests
  "test://write-test": allow,
  "test://read-test": allow,
  "test://list-test": allow,
  "test://auth-test": allow,
  "test://encrypt-test": allow,
  "test://signed-encrypted-test": allow,

  // Notes protocol
  "notes://nataliarsand": allow,

  // Users protocol
  "users://nataliarsand": allow,
  "users://alice": allow,
  "users://bob": allow,

  // Common patterns
  "data://example": allow,
  "api://example": allow,
  "user://example": allow,
  "public://example": allow,
  "temp://example": allow,
  "cache://example": allow,
  "session://example": allow,

  // Blocked patterns
  "admin://example": deny,
  "system://example": deny,
  "private://example": deny,
  "internal://example": deny,
};

export default schema;

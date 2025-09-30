/**
 * Advanced TypeScript Schema Module
 *
 * This module exports validation functions for persistence operations.
 * Each function validates writes to specific URI patterns and can perform
 * complex validation logic including authentication checks, data validation,
 * and business rules enforcement.
 */

import type { PersistenceWrite, PersistenceValidationFn } from "../../../persistence/mod.ts";

/**
 * Validate authenticated messages
 * Ensures the payload has proper authentication structure
 */
export const auth: PersistenceValidationFn<unknown> = async (write: PersistenceWrite<unknown>) => {
  const value = write.value as any;

  // Check if it has auth structure
  if (!value?.auth || !Array.isArray(value.auth)) {
    return false;
  }

  // Validate each auth entry
  for (const authEntry of value.auth) {
    if (!authEntry.pubkey || typeof authEntry.pubkey !== 'string') {
      return false;
    }
    if (!authEntry.signature || typeof authEntry.signature !== 'string') {
      return false;
    }
  }

  // Check if payload exists
  if (value.payload === undefined) {
    return false;
  }

  return true;
};

/**
 * Validate user data
 * Ensures user objects have required fields
 */
export const user: PersistenceValidationFn<unknown> = async (write: PersistenceWrite<unknown>) => {
  const value = write.value as any;

  // Check URI pattern
  if (!write.uri.includes('/user/') && !write.uri.includes('/users/')) {
    return false;
  }

  // Validate user object structure
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  // Required fields for user
  if (!value.id && !value.pubkey && !value.username) {
    return false; // Need at least one identifier
  }

  // Optional but validated fields
  if (value.email && typeof value.email !== 'string') {
    return false;
  }

  if (value.role && !['admin', 'user', 'guest', 'moderator'].includes(value.role)) {
    return false;
  }

  return true;
};

/**
 * Validate document data with versioning support
 */
export const document: PersistenceValidationFn<unknown> = async (write: PersistenceWrite<unknown>) => {
  const value = write.value as any;

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  // Documents must have content
  if (!value.content && !value.data && !value.body) {
    return false;
  }

  // If versioned, validate version info
  if (value.version !== undefined) {
    if (typeof value.version !== 'number' || value.version < 0) {
      return false;
    }

    // Version 0 must not have previousVersion
    if (value.version === 0 && value.previousVersion !== undefined) {
      return false;
    }

    // Versions > 0 must reference previous version
    if (value.version > 0 && typeof value.previousVersion !== 'string') {
      return false;
    }
  }

  return true;
};

/**
 * Validate encrypted payloads
 */
export const encrypted: PersistenceValidationFn<unknown> = async (write: PersistenceWrite<unknown>) => {
  const value = write.value as any;

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  // Check for encrypted payload structure
  if (!value.data || typeof value.data !== 'string') {
    return false; // Missing encrypted data
  }

  if (!value.nonce || typeof value.nonce !== 'string') {
    return false; // Missing nonce for decryption
  }

  // If using ECDH, ephemeral public key is required
  if (value.algorithm === 'ECDH' && !value.ephemeralPublicKey) {
    return false;
  }

  return true;
};

/**
 * Validate API configuration data
 */
export const api: PersistenceValidationFn<unknown> = async (write: PersistenceWrite<unknown>) => {
  const value = write.value as any;

  // API configs should be objects
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  // Check for API configuration fields
  if (value.endpoint) {
    try {
      new URL(value.endpoint); // Validate URL format
    } catch {
      return false;
    }
  }

  if (value.rateLimit !== undefined) {
    if (typeof value.rateLimit !== 'number' || value.rateLimit <= 0) {
      return false;
    }
  }

  if (value.methods && !Array.isArray(value.methods)) {
    return false;
  }

  return true;
};

/**
 * Validate time-sensitive data
 */
export const temporal: PersistenceValidationFn<unknown> = async (write: PersistenceWrite<unknown>) => {
  const value = write.value as any;

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  // Must have timestamp
  if (typeof value.timestamp !== 'number') {
    return false;
  }

  // Check if timestamp is reasonable (not too far in future/past)
  const now = Date.now();
  const maxFuture = now + (24 * 60 * 60 * 1000); // 1 day in future
  const maxPast = now - (365 * 24 * 60 * 60 * 1000); // 1 year in past

  if (value.timestamp > maxFuture || value.timestamp < maxPast) {
    return false;
  }

  // If it has expiry, validate it
  if (value.expiresAt !== undefined) {
    if (typeof value.expiresAt !== 'number') {
      return false;
    }

    // Expiry must be after timestamp
    if (value.expiresAt <= value.timestamp) {
      return false;
    }
  }

  return true;
};

/**
 * Validate data size limits
 */
export const limited: PersistenceValidationFn<unknown> = async (write: PersistenceWrite<unknown>) => {
  const value = write.value;

  // Check size of serialized data
  const serialized = JSON.stringify(value);
  const sizeInBytes = new TextEncoder().encode(serialized).length;

  // Max 1MB per record
  const maxSize = 1024 * 1024;

  if (sizeInBytes > maxSize) {
    console.warn(`Data too large: ${sizeInBytes} bytes (max: ${maxSize})`);
    return false;
  }

  return true;
};

/**
 * Validate structured data with JSON schema-like rules
 */
export const structured: PersistenceValidationFn<unknown> = async (write: PersistenceWrite<unknown>) => {
  const value = write.value as any;

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  // Check for required top-level fields
  const requiredFields = ['type', 'data'];
  for (const field of requiredFields) {
    if (!(field in value)) {
      return false;
    }
  }

  // Validate type field
  const validTypes = ['record', 'message', 'event', 'state', 'config'];
  if (!validTypes.includes(value.type)) {
    return false;
  }

  // Type-specific validation
  switch (value.type) {
    case 'message':
      if (!value.data.from || !value.data.to || !value.data.content) {
        return false;
      }
      break;

    case 'event':
      if (!value.data.name || !value.data.timestamp) {
        return false;
      }
      break;

    case 'state':
      if (value.data.status && !['active', 'inactive', 'pending', 'error'].includes(value.data.status)) {
        return false;
      }
      break;
  }

  return true;
};

/**
 * Always allow - for backwards compatibility or testing
 */
export const test: PersistenceValidationFn<unknown> = async (_write: PersistenceWrite<unknown>) => {
  return true;
};

/**
 * Always deny - for blocking certain paths
 */
export const blocked: PersistenceValidationFn<unknown> = async (_write: PersistenceWrite<unknown>) => {
  return false;
};

/**
 * Validate based on URI pattern
 */
export const pattern: PersistenceValidationFn<unknown> = async (write: PersistenceWrite<unknown>) => {
  const uri = write.uri;

  // Allow only specific protocols
  const allowedProtocols = ['test', 'data', 'api', 'user'];
  const protocol = uri.split('://')[0];

  if (!allowedProtocols.includes(protocol)) {
    return false;
  }

  // Block certain paths
  const blockedPaths = ['/admin/', '/system/', '/.hidden/'];
  for (const blocked of blockedPaths) {
    if (uri.includes(blocked)) {
      return false;
    }
  }

  // Validate path depth (max 5 levels)
  const pathPart = uri.split('://')[1]?.split('/').slice(1);
  if (pathPart && pathPart.length > 5) {
    return false;
  }

  return true;
};

/**
 * Default schema export
 * Map protocol prefixes to validation functions
 */
const schema: Record<string, PersistenceValidationFn<unknown>> = {
  auth,
  user,
  document,
  encrypted,
  api,
  temporal,
  limited,
  structured,
  test,
  blocked,
  pattern,

  // Additional mappings
  data: structured,
  config: api,
  message: structured,
  event: temporal,
  public: test,
  private: auth,
  admin: blocked,
  system: blocked,
  temp: temporal,
  cache: temporal,
  session: temporal,
};

export default schema;

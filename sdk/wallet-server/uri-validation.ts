/**
 * URI Validation Utilities
 *
 * Provides validation for B3nd URIs to prevent malicious input.
 */

/**
 * Allowed URI protocols in B3nd
 */
const ALLOWED_PROTOCOLS = ["mutable:", "immutable:", "users:", "cache:", "open:", "private:", "protected:", "public:"];

/**
 * Pattern for valid URI path characters
 * Allows alphanumeric, dash, underscore, and forward slash
 */
const VALID_PATH_CHARS = /^[a-zA-Z0-9\-_\/]+$/;

/**
 * Maximum URI length to prevent DoS via huge URIs
 */
const MAX_URI_LENGTH = 2048;

export interface UriValidationResult {
  valid: boolean;
  error?: string;
  protocol?: string;
  domain?: string;
  path?: string;
}

/**
 * Validate a B3nd URI for security and format correctness
 *
 * Checks:
 * - URI is not too long (DoS prevention)
 * - Protocol is one of the allowed B3nd protocols
 * - No path traversal sequences (.., etc.)
 * - No null bytes or other dangerous characters
 * - Valid URL structure
 *
 * @param uri - The URI to validate
 * @returns Validation result with parsed components if valid
 */
export function validateUri(uri: string): UriValidationResult {
  // Check for null/undefined
  if (!uri || typeof uri !== "string") {
    return { valid: false, error: "URI is required and must be a string" };
  }

  // Check length
  if (uri.length > MAX_URI_LENGTH) {
    return { valid: false, error: `URI exceeds maximum length of ${MAX_URI_LENGTH} characters` };
  }

  // Check for null bytes (security)
  if (uri.includes("\0")) {
    return { valid: false, error: "URI contains invalid null bytes" };
  }

  // Check for path traversal attempts
  if (uri.includes("..") || uri.includes("./") || uri.includes("/.")) {
    return { valid: false, error: "URI contains path traversal sequences" };
  }

  // Check for other dangerous patterns
  if (uri.includes("\\") || uri.includes("%2e%2e") || uri.includes("%2e/") || uri.includes("/%2e")) {
    return { valid: false, error: "URI contains potentially malicious patterns" };
  }

  // Try to parse as URL
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { valid: false, error: "URI is not a valid URL format" };
  }

  // Validate protocol
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    return {
      valid: false,
      error: `Invalid protocol '${url.protocol}'. Allowed: ${ALLOWED_PROTOCOLS.join(", ")}`,
    };
  }

  // Validate domain is present
  if (!url.hostname) {
    return { valid: false, error: "URI must have a domain/hostname" };
  }

  // Validate path characters (if path exists)
  const path = url.pathname;
  if (path && path !== "/" && !VALID_PATH_CHARS.test(path.substring(1))) {
    return { valid: false, error: "URI path contains invalid characters" };
  }

  // Check for query strings or fragments (not supported in B3nd URIs)
  if (url.search || url.hash) {
    return { valid: false, error: "URI should not contain query strings or fragments" };
  }

  // Valid URI
  return {
    valid: true,
    protocol: url.protocol.replace(":", ""),
    domain: url.hostname,
    path: path,
  };
}

/**
 * Validate URI and throw if invalid
 * Convenience wrapper for use in request handlers
 *
 * @param uri - The URI to validate
 * @throws Error if URI is invalid
 * @returns Parsed URI components
 */
export function assertValidUri(uri: string): {
  protocol: string;
  domain: string;
  path: string;
} {
  const result = validateUri(uri);
  if (!result.valid) {
    throw new Error(`Invalid URI: ${result.error}`);
  }
  return {
    protocol: result.protocol!,
    domain: result.domain!,
    path: result.path!,
  };
}

/**
 * Sanitize a URI path segment
 * Removes any potentially dangerous characters
 *
 * @param segment - A single path segment to sanitize
 * @returns Sanitized segment
 */
export function sanitizePathSegment(segment: string): string {
  // Remove null bytes
  let safe = segment.replace(/\0/g, "");
  // Replace backslashes with forward slashes
  safe = safe.replace(/\\/g, "/");
  // Remove path traversal
  safe = safe.replace(/\.\./g, "");
  // Remove leading/trailing dots
  safe = safe.replace(/^\.+|\.+$/g, "");
  // Keep only allowed characters
  safe = safe.replace(/[^a-zA-Z0-9\-_]/g, "");
  return safe;
}

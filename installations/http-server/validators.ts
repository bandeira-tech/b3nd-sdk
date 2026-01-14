/**
 * Validation utilities for B3nd protocols
 */

/**
 * Compute SHA256 hash of a value
 * @param value - The value to hash (will be JSON.stringify'd)
 * @returns Hex-encoded SHA256 hash
 */
export async function computeSha256(value: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(value));

  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Validate link value (must be a string URI)
 * @param value - The value to validate
 * @returns Validation result with valid boolean and optional error
 */
export function validateLinkValue(
  value: unknown,
): { valid: boolean; error?: string } {
  // Link must be a string
  if (typeof value !== "string") {
    return { valid: false, error: "Link value must be a string URI" };
  }

  // Validate that it's a valid URI
  try {
    new URL(value);
  } catch {
    return { valid: false, error: "Link value must be a valid URI" };
  }

  return { valid: true };
}

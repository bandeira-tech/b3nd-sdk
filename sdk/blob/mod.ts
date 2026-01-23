/**
 * Blob and Link utilities for B3nd content-addressed storage
 *
 * @module blob
 *
 * @example
 * ```typescript
 * import { computeSha256, generateBlobUri, validateLinkValue } from "@bandeira-tech/b3nd-sdk/blob";
 *
 * // Compute hash and generate blob URI
 * const data = { title: "Hello", content: "World" };
 * const hash = await computeSha256(data);
 * const blobUri = generateBlobUri(hash);
 * // blobUri = "blob://open/sha256:2cf24dba..."
 *
 * // Validate a link value
 * const result = validateLinkValue("blob://open/sha256:abc123...");
 * // result = { valid: true }
 * ```
 */

/**
 * Compute SHA256 hash of a value
 * @param value - The value to hash (Uint8Array for binary, otherwise JSON-stringified)
 * @returns Hex-encoded SHA256 hash (64 characters)
 */
export async function computeSha256(value: Uint8Array | unknown): Promise<string> {
  let data: Uint8Array;

  if (value instanceof Uint8Array) {
    // Binary data - hash raw bytes
    data = value;
  } else {
    // Non-binary - hash JSON representation
    const encoder = new TextEncoder();
    data = encoder.encode(JSON.stringify(value));
  }

  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a blob URI from a SHA256 hash
 * @param hash - Hex-encoded SHA256 hash (64 characters)
 * @returns Blob URI in format "blob://open/sha256:{hash}"
 */
export function generateBlobUri(hash: string): string {
  return `blob://open/sha256:${hash}`;
}

/**
 * Parse a blob URI to extract the hash
 * @param uri - Blob URI in format "blob://open/sha256:{hash}"
 * @returns Object with algorithm and hash, or null if invalid
 */
export function parseBlobUri(uri: string): { algorithm: string; hash: string } | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "blob:") return null;

    const match = url.pathname.match(/^\/([^:]+):([a-f0-9]+)$/i);
    if (!match) return null;

    return { algorithm: match[1], hash: match[2] };
  } catch {
    return null;
  }
}

/**
 * Validate that a value is a valid link (string URI)
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

/**
 * Generate a link URI for authenticated links
 * @param pubkey - Public key (hex) of the account
 * @param path - Path within the account namespace
 * @returns Link URI in format "link://accounts/{pubkey}/{path}"
 */
export function generateLinkUri(pubkey: string, path: string): string {
  return `link://accounts/${pubkey}/${path}`;
}

/**
 * Validate a SHA256 hash format
 * @param hash - Hash string to validate
 * @returns true if valid 64-character hex string
 */
export function isValidSha256Hash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

/**
 * Verify that content matches its blob URI hash
 * @param uri - Blob URI containing the expected hash
 * @param value - Content to verify
 * @returns Object with valid boolean and computed hash
 */
export async function verifyBlobContent(
  uri: string,
  value: Uint8Array | unknown,
): Promise<{ valid: boolean; expectedHash?: string; actualHash: string; error?: string }> {
  const parsed = parseBlobUri(uri);
  if (!parsed) {
    const actualHash = await computeSha256(value);
    return { valid: false, actualHash, error: "Invalid blob URI format" };
  }

  if (parsed.algorithm !== "sha256") {
    const actualHash = await computeSha256(value);
    return { valid: false, actualHash, error: `Unsupported algorithm: ${parsed.algorithm}` };
  }

  const actualHash = await computeSha256(value);
  const valid = actualHash.toLowerCase() === parsed.hash.toLowerCase();

  return {
    valid,
    expectedHash: parsed.hash,
    actualHash,
    error: valid ? undefined : "Content hash mismatch",
  };
}

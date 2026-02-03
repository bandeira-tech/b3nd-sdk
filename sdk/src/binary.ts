/**
 * Binary data encoding utilities for JSON-based storage backends
 * 
 * Since JSON.stringify(Uint8Array) produces {0: x, 1: y, ...} instead of
 * proper binary representation, we need to encode binary data to base64
 * with a type marker for round-trip serialization.
 */

const BINARY_MARKER = "__b3nd_binary__";

interface EncodedBinary {
  [BINARY_MARKER]: true;
  data: string; // base64 encoded
}

/**
 * Check if a value is a Uint8Array or ArrayBuffer
 */
export function isBinary(value: unknown): value is Uint8Array | ArrayBuffer {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

/**
 * Check if a value is an encoded binary object
 */
export function isEncodedBinary(value: unknown): value is EncodedBinary {
  return (
    typeof value === "object" &&
    value !== null &&
    BINARY_MARKER in value &&
    (value as EncodedBinary)[BINARY_MARKER] === true
  );
}

/**
 * Encode binary data for JSON storage
 * Returns the original value if not binary
 */
export function encodeBinaryForJson<T>(value: T): T | EncodedBinary {
  if (value instanceof Uint8Array) {
    return {
      [BINARY_MARKER]: true,
      data: btoa(String.fromCharCode(...value)),
    };
  }
  if (value instanceof ArrayBuffer) {
    return {
      [BINARY_MARKER]: true,
      data: btoa(String.fromCharCode(...new Uint8Array(value))),
    };
  }
  return value;
}

/**
 * Decode binary data from JSON storage
 * Returns the original value if not encoded binary
 */
export function decodeBinaryFromJson<T>(value: T): T | Uint8Array {
  if (isEncodedBinary(value)) {
    const binary = atob(value.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return value;
}

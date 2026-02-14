/**
 * @module
 * Message data detection utilities
 */

import type { MessageData } from "./types.ts";

/**
 * Type guard detecting MessageData shape
 *
 * Checks that data is an object with:
 * - `payload.inputs`: string[]
 * - `payload.outputs`: [string, unknown][]
 *
 * @example
 * ```typescript
 * if (isMessageData(data)) {
 *   // data is MessageData
 *   for (const [uri, value] of data.payload.outputs) {
 *     await backend.receive([uri, value]);
 *   }
 * }
 * ```
 */
export function isMessageData(data: unknown): data is MessageData {
  if (data === null || typeof data !== "object") return false;
  const payload = (data as MessageData).payload;
  if (!payload || typeof payload !== "object") return false;
  return (
    Array.isArray(payload.inputs) &&
    Array.isArray(payload.outputs) &&
    payload.outputs.every(
      (o: unknown) =>
        Array.isArray(o) && o.length === 2 && typeof o[0] === "string",
    )
  );
}

/** @deprecated Use `isMessageData` instead */
export const isTransactionData = isMessageData;
